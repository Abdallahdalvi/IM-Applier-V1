/**
 * internshala-auto-apply.js
 *
 * Main application runner. Reads from job-queue-filtered.json (post-filter),
 * fills Internshala forms smartly, and tracks applied jobs on disk.
 *
 * Fixes applied vs. original version:
 *  ✅  Reads job-queue-FILTERED.json (not the raw queue)
 *  ✅  resume.txt loaded with absolute path (__dirname-relative)
 *  ✅  Full JD + company + role forwarded to every AI call
 *  ✅  AI answers generated fresh for every question (no cache)
 *  ✅  cover_letter question type recognised and handled
 *  ✅  Rating/proficiency scales auto-selected as 4 or 5
 *  ✅  AI output sanitized - no smart quotes/em-dashes that trigger language warnings
 */

const { chromium } = require("playwright");
const fs   = require("fs");
const path = require("path");

/* ── AI helpers ──────────────────────────────────────────── */
const { classifyQuestion } = require("../ai/question-classifier");
const { getAnswer }        = require("../ai/answer-engine");

// Read filtered jobs from job-queue-filtered.json
const JOB_QUEUE_PATH   = path.join(__dirname, "../job-queue-filtered.json");
const APPLIED_JOBS_PATH = path.join(__dirname, "applied-jobs.json");
const SKIP_REASONS_PATH = path.join(__dirname, "skip-reasons.json");

const user = process.env.DALVI_USER || "default";
const USER_DIR = path.join(__dirname, "../users", user);
const RESUME_PATH = path.join(USER_DIR, "resume.txt");
const CONFIG_PATH = path.join(USER_DIR, "config.json");

// No apply limit — bot runs through the entire filtered queue

/* ── Stats ───────────────────────────────────────────────── */
const stats = {
  applied:           0,
  skipped_disk:      0,
  skipped_ui:        0,
  skipped_redirect:  0,
  skipped_text:      0,
  skipped_no_cta:    0,
  skipped_external:  0,
  cache_hits:        0,
  errors:            0
};

/* ── Storage helpers ─────────────────────────────────────── */
function loadAppliedJobs() {
  if (!fs.existsSync(APPLIED_JOBS_PATH)) return new Set();
  return new Set(JSON.parse(fs.readFileSync(APPLIED_JOBS_PATH, "utf-8")));
}
function saveAppliedJobs(set) {
  fs.writeFileSync(APPLIED_JOBS_PATH, JSON.stringify([...set], null, 2));
}
function loadSkipReasons() {
  if (!fs.existsSync(SKIP_REASONS_PATH)) return {};
  return JSON.parse(fs.readFileSync(SKIP_REASONS_PATH, "utf-8"));
}
function saveSkipReasons(obj) {
  fs.writeFileSync(SKIP_REASONS_PATH, JSON.stringify(obj, null, 2));
}

/* ── Page helpers ────────────────────────────────────────── */
async function forceClickApply(page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2000); // Wait for scroll animation and rendering

  // If the apply modal is already open from a previous interaction, skip clicking Apply
  const modalAlreadyOpen = await page.evaluate(() => {
    const modal = document.querySelector('#easy_apply_modal, .modal.show, [role="dialog"]');
    return modal && window.getComputedStyle(modal).display !== 'none';
  });
  if (modalAlreadyOpen) {
    console.log('   ℹ️ Apply modal already open — skipping Apply button click');
    return true;
  }

  const applySelectors = [
    '#easy_apply_button',
    '#top_easy_apply_button',
    '#mobile_easy_apply_button',
    'button:has-text("Apply now")',
    'button:has-text("Apply")',
    'a.btn:has-text("Apply")',
    'a.btn:has-text("Apply now")'
  ];

  for (const sel of applySelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.count() && await btn.isVisible()) {
        await btn.scrollIntoViewIfNeeded();
        // Use force:true to bypass any overlay intercepting the click
        await btn.click({ delay: 200, force: true });
        console.log(`   ✅ Clicked Apply button using selector: ${sel}`);
        await page.waitForTimeout(2000); // Wait 2s for modal animation/transition
        return true;
      }
    } catch {}
  }

  // Fallback: getByRole
  const btn = page.getByRole('button', { name: /apply/i });
  if (await btn.count()) {
    await btn.first().scrollIntoViewIfNeeded();
    await btn.first().click({ delay: 200, force: true });
    console.log(`   ✅ Clicked Apply button using getByRole fallback`);
    await page.waitForTimeout(2000);
    return true;
  }

  return false;
}

async function isApplyModalOpen(page) {
  return await page.evaluate(() => {
    // Exclude the Internshala resume review page — it has a form but is NOT the apply form
    const bodyText = document.body.innerText.toLowerCase();
    if (bodyText.includes('your internshala resume') || bodyText.includes('internshala resume')) return false;
    return Boolean(
      document.querySelector('form') ||
      document.querySelector('textarea') ||
      document.querySelector("button[type='submit']")
    );
  });
}

/* ── Handle Internshala Resume Review Page ───────────────── */
// When applying, Internshala sometimes shows a "Your Internshala resume" review
// page with a Proceed button at the bottom. We must click Proceed to continue.
async function handleResumePage(page) {
  try {
    const isResumePage = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('your internshala resume') || text.includes('internshala resume');
    });

    if (!isResumePage) return false;

    console.log('   📋 Resume review page detected — looking for Proceed button...');

    // Scroll to bottom where the Proceed button is
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000); // Let page stabilize

    // Try multiple selectors for the Proceed button
    const proceedSelectors = [
      'button:has-text("Proceed")',
      'a:has-text("Proceed")',
      'button:has-text("Continue")',
      'a:has-text("Continue")',
      'button:has-text("Next")',
      '.proceed-btn',
      '#proceed_btn',
      'input[value="Proceed"]',
    ];

    for (const sel of proceedSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.count() && await btn.isVisible()) {
          await btn.scrollIntoViewIfNeeded();
          await btn.click({ delay: 200 });
          console.log(`   ✅ Clicked Proceed button (${sel})`);
          await page.waitForTimeout(2000); // 2s wait for page transition
          return true;
        }
      } catch {}
    }

    // Fallback: find any blue/primary button at the bottom
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]'));
      // Find the last visible primary-style button on the page
      const primaryBtn = buttons.reverse().find(btn => {
        const text = btn.innerText?.trim().toLowerCase();
        const cls  = btn.className?.toLowerCase();
        return (
          text && (text.includes('proceed') || text.includes('continue') || text.includes('next') || text.includes('apply')) &&
          (cls.includes('btn-primary') || cls.includes('btn-blue') || cls.includes('proceed') || cls.includes('continue'))
        );
      });
      if (primaryBtn) { primaryBtn.click(); return true; }
      return false;
    });

    if (clicked) {
      console.log('   ✅ Clicked primary proceed button via fallback');
      await page.waitForTimeout(2000); // 2s wait
      return true;
    }

    console.log('   ⚠ Could not find Proceed button on resume page');
    return false;
  } catch (e) {
    console.log(`   ⚠ Resume page handler error: ${e.message}`);
    return false;
  }
}

async function clickSubmit(page) {
  const submitSelectors = [
    '#submit',
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit")',
    'button:has-text("Submit application")',
    'button:has-text("Apply")',
    'input[value="Submit"]',
    '.submit-button',
    '.btn-primary'
  ];
  
  for (const sel of submitSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.count() && await btn.isVisible()) {
        // Double check it's not a secondary button like cancel
        const text = await btn.innerText();
        if (text && (text.toLowerCase().includes("cancel") || text.toLowerCase().includes("back"))) {
          continue;
        }
        await btn.scrollIntoViewIfNeeded();
        await btn.click({ delay: 200 });
        console.log(`   🚀 Clicked Submit button (selector: ${sel})`);
        await page.waitForTimeout(2000); // 2s processing delay
        return true;
      }
    } catch {}
  }
  
  try {
    const btn = page.locator('text="Submit"').first();
    if (await btn.count()) {
      await btn.scrollIntoViewIfNeeded();
      await btn.click({ delay: 200 });
      console.log("   🚀 Clicked 'Submit' text");
      await page.waitForTimeout(2000); // 2s processing delay
      return true;
    }
  } catch {}
  
  return false;
}

async function isAlreadyAppliedUI(page) {
  const url = page.url();
  if (!url.includes("internshala.com") || !url.includes("/detail/")) {
    console.log(`   ℹ️ isAlreadyAppliedUI: URL (${url}) is not a details page. Skipping.`);
    return false;
  }

  return await page.evaluate(() => {
    // 1. Find the main job details container
    const mainContainer = document.querySelector(
      '.detail_view, .job_details_container, .internship_details, #details_container, #job_details, #internship_details'
    );
    
    // Choose the root element to search
    // If mainContainer is not found, return false to avoid false positives on other pages.
    if (!mainContainer) return false;
    const rootEl = mainContainer;
    
    // 2. Clone it so we can strip elements without affecting the live page
    const clone = rootEl.cloneNode(true);
    
    // 3. Remove all recommendation/similar sections, headers, footers, job descriptions, and promotional/ad content (to prevent false positive matches)
    const selectorsToRemove = [
      '#similar_internships', '.similar_internships',
      '#similar_jobs', '.similar_jobs',
      '.similar_internships_container', '.similar_jobs_container',
      '#similar_internships_container', '#similar_jobs_container',
      '.other_internships', '.other_jobs',
      '.recommended_internships', '.recommended_jobs',
      '.recommendations', '#recommendations',
      '.suggested', '#suggested',
      '.suggested_internships', '.suggested_jobs',
      '.similar_jobs_list', '.similar-jobs-list',
      '#similar_jobs_list', '#similar-jobs-list',
      '#similar_courses', '.similar_courses',
      '#similar_internships_list_container',
      '#similar_jobs_list_container',
      '#similar_internships_list',
      '#similar_jobs_list',
      'footer', '.footer', 'header', '#navigation', '.navigation',
      '.right_container', '#right-container', '#right_container',
      '.similar_list_container', '.similar-list-container',
      '.similar_internships_list', '.similar-internships-list',
      
      // Remove job description content to avoid matching text like "if you already applied..."
      '.about_the_job', '.job-description', '.job_description', '.text-container',
      '.about_company', '.about-company', '.about_employer',

      // Remove promotional/ad/upsell/IS Pro sections and scripts to prevent false positive matches on banners
      'script', 'style',
      '.is_pro_ad', '.is_pro_ad_container', '.is-pro-ad', '.is-pro-ad-container',
      '[class*="pro_ad"]', '[class*="pro-ad"]', '[class*="upgrade"]',
      '[id*="pro_ad"]', '[id*="pro-ad"]', '[id*="upgrade"]',
      '.premium_nudge', '.premium-nudge', '.pro-nudge', '.upgrade-nudge'
    ];
    
    selectorsToRemove.forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    });
    
    const textToCheck = clone.innerText.toLowerCase();
    
    // Check if the cleaned text contains indicators that the CURRENT job is applied
    let hasAppliedText = 
      textToCheck.includes("you have applied to this") || 
      textToCheck.includes("you applied to this") || 
      textToCheck.includes("you've applied to this") || 
      textToCheck.includes("already applied to this") ||
      textToCheck.includes("already applied for this") ||
      textToCheck.includes("applied successfully") ||
      textToCheck.includes("application status: applied") ||
      textToCheck.includes("you applied on");

    if (!hasAppliedText) {
      // If we find "already applied", verify it is not referring to other candidates/applicants
      const idx = textToCheck.indexOf("already applied");
      if (idx !== -1) {
        const preceding = textToCheck.substring(Math.max(0, idx - 60), idx);
        const matchesCandidates = /(candidates|applicants|others|people|\b\d+\b)/i.test(preceding);
        if (!matchesCandidates) {
          hasAppliedText = true;
        }
      }
    }

    if (!hasAppliedText) {
      // If we find "applied on", verify it is not referring to other candidates/applicants
      const idx = textToCheck.indexOf("applied on");
      if (idx !== -1) {
        const preceding = textToCheck.substring(Math.max(0, idx - 60), idx);
        const matchesCandidates = /(candidates|applicants|others|people)/i.test(preceding);
        if (!matchesCandidates) {
          hasAppliedText = true;
        }
      }
    }
      
    // Check if any status element/badge in the cleaned clone contains "applied"
    let statusApplied = false;
    const statusBanners = clone.querySelectorAll(
      '.applied_status, .applied-status, .status-container, .application_status, .application-status, .status_container, #application_status, #applied_status, .alert, .toast, .notification, .status_link, .status-heading, .status-text, .status_heading, .status_text, .status-badge, .status_badge, .badge'
    );
    for (const banner of statusBanners) {
      const bannerText = banner.innerText.toLowerCase();
      // Ensure we don't match candidate counts in general banners
      if (bannerText.includes("candidates") || bannerText.includes("applicants")) {
        continue;
      }
      if (bannerText.includes("already applied") || bannerText.includes("you have applied") || bannerText.includes("status: applied") || bannerText.trim() === 'applied') {
        statusApplied = true;
        break;
      }
    }
    
    // Check the main apply button text inside the cleaned clone
    let buttonApplied = false;
    const buttonsToCheck = Array.from(clone.querySelectorAll('button, a, input[type="button"], input[type="submit"]'));
    for (const btn of buttonsToCheck) {
      const btnText = btn.innerText?.trim().toLowerCase() || '';
      if (btnText.includes("candidates") || btnText.includes("applicants")) {
        continue;
      }
      if (btnText === 'applied' || btnText === 'already applied' || btnText === 'already_applied') {
        buttonApplied = true;
        break;
      }
    }
    
    return hasAppliedText || statusApplied || buttonApplied;
  });
}

async function hasBlockingRequiredFields(page) {
  return await page.evaluate(() => {
    // Only check visible textarea and text inputs — NOT selects
    // (native selects are often hidden by custom dropdowns but we fill them anyway)
    const selectors = ["textarea[required]", "input[required]"];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const s = window.getComputedStyle(el);
        if (
          s.display !== "none" &&
          s.visibility !== "hidden" &&
          el.offsetHeight > 0 &&
          !el.value
        ) {
          return true;
        }
      }
    }
    return false;
  });
}

/* ── Smart form filler ───────────────────────────────────── */
async function smartFillForm(page, job) {
  const resume  = fs.readFileSync(RESUME_PATH, "utf-8");
  const profile = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  const goal = profile.targetApplicationGoal || "";

  // Full JD context passed to every AI call
  const jdText = job.jdText || `${job.title} at ${job.company}`;

  // Helper: extract the question text near a form element
  async function getQuestionText(el) {
    return await page.evaluate(e => {
      // Collect all candidate text strings by walking up the DOM
      const candidates = [];

      // 1. Check closest label
      const label = e.closest('label');
      if (label) return label.innerText.trim();

      // 2. Walk up to 6 parent levels looking for question containers
      let current = e.parentElement;
      let depth = 0;
      while (current && depth < 6) {
        const isContainer = [
          'form-group', 'question_container', 'assessment_question',
          'additional_question', 'form-field', 'field-wrapper'
        ].some(cls => current.classList.contains(cls));

        if (isContainer || depth <= 2) {
          // Gather all text-bearing children (labels, p, h4, h5, span, div with direct text)
          const textEls = current.querySelectorAll('label, p, h4, h5, h6, .question_text, .assessment_question_text, .field-label');
          for (const textEl of textEls) {
            // Skip if it's a descendant of the actual input element
            if (textEl.contains(e) || e.contains(textEl)) continue;
            const txt = textEl.innerText?.trim();
            // Must be substantial (real question) and not a placeholder/error
            if (txt && txt.length > 12 &&
                !txt.toLowerCase().includes('select range') &&
                !txt.toLowerCase().includes('enter numeric') &&
                !txt.toLowerCase().includes('this field is required') &&
                !txt.toLowerCase().includes('required')) {
              candidates.push(txt);
            }
          }
        }

        current = current.parentElement;
        depth++;
      }

      // Pick the best candidate: prefer the longest (most specific question text)
      if (candidates.length > 0) {
        return candidates.sort((a, b) => b.length - a.length)[0];
      }

      // 3. Check previous sibling text
      let prev = e.previousElementSibling;
      while (prev) {
        const txt = prev.innerText?.trim();
        if (txt && txt.length > 5 && !txt.toLowerCase().includes('required')) return txt;
        prev = prev.previousElementSibling;
      }

      // 4. Placeholder
      if (e.placeholder && e.placeholder.length > 5) return e.placeholder;

      return 'Explain why you are a good fit for this role';
    }, el);
  }

  /* ── 1. GATHER ALL UNFILLED TEXT-LIKE FIELDS ──────────────── */
  const textFields = [];

  // 1a. Textareas
  const textareas = await page.$$("textarea");
  for (const el of textareas) {
    if (!(await el.isVisible())) continue;
    if ((await el.inputValue()).trim()) continue; // already filled
    const question = await getQuestionText(el);
    const type = classifyQuestion(question);
    textFields.push({ el, question, type, tagName: "textarea" });
  }

  // 1b. Contenteditable divs
  const editableDivs = await page.$$("[contenteditable='true']");
  for (const el of editableDivs) {
    if (!(await el.isVisible())) continue;
    const existing = await el.innerText();
    if (existing && existing.trim().length > 10) continue; // already filled
    const question = await getQuestionText(el);
    const type = classifyQuestion(question);
    textFields.push({ el, question, type, tagName: "contenteditable" });
  }

  // 1c. Text inputs
  const inputs = await page.$$("input");
  for (const el of inputs) {
    if (!(await el.isVisible())) continue;
    const t = (await el.getAttribute("type")) || "text";
    if (["radio", "checkbox", "file", "hidden", "submit", "button"].includes(t)) continue;
    if ((await el.inputValue()).trim()) continue; // already filled
    const question = await getQuestionText(el);
    const type = classifyQuestion(question);
    textFields.push({ el, question, type, tagName: "input", inputType: t });
  }

  /* ── 2. ANSWER ALL TEXT FIELDS IN A SINGLE BATCH CALL ─────── */
  let answersMap = {};
  if (textFields.length > 0) {
    console.log(`   📝 Scraped ${textFields.length} text fields. Requesting batch answers via AI...`);
    const questionsForAI = textFields.map((tf, index) => ({
      id: index,
      question: tf.question,
      type: tf.type
    }));

    const { askAIBatch } = require("../ai-helper");
    answersMap = await askAIBatch({
      questions: questionsForAI,
      jd: jdText,
      resume,
      company: job.company,
      role: job.title,
      goal,
      profile
    });
  }

  /* ── 3. FILL THE FIELDS SEQUENTIALLY ──────────────────────── */
  for (const [index, tf] of textFields.entries()) {
    let answer = answersMap[String(index)];

    // Fallback to single getAnswer if batch answer is missing/invalid
    if (answer === undefined || answer === null || answer === "" || answer === "NOT_SURE") {
      console.log(`      ⚠ No batch answer for: "${tf.question.substring(0, 40)}...". Falling back to individual generation...`);
      answer = await getAnswer({
        question: tf.question,
        type: tf.type,
        job: { ...job, jdText },
        resume,
        goal,
        profile
      });
    }

    if (answer !== null && answer !== undefined && answer !== "" && answer !== "NOT_SURE") {
      if (tf.tagName === "textarea") {
        await tf.el.fill(String(answer));
        console.log(`      ✅ Textarea: "${tf.question.substring(0, 40)}..." → "${String(answer).substring(0, 50)}..."`);
        await page.waitForTimeout(1000);
      } else if (tf.tagName === "contenteditable") {
        await tf.el.click();
        await page.waitForTimeout(1000);
        await tf.el.evaluate((node, value) => {
          node.innerText = value;
          node.dispatchEvent(new Event("input", { bubbles: true }));
        }, String(answer));
        console.log(`      ✅ Contenteditable: "${tf.question.substring(0, 40)}..."`);
        await page.waitForTimeout(1000);
      } else if (tf.tagName === "input") {
        let finalVal = String(answer);
        if (tf.inputType === "number") {
          finalVal = finalVal.replace(/[^\d]/g, '');
          if (!finalVal) {
            if (["salary", "notice_period", "joining_days", "months_experience", "experience"].includes(tf.type)) {
              finalVal = "0";
            } else {
              continue; // skip
            }
          }
        }
        await tf.el.fill(finalVal);
        console.log(`      ✅ Input: "${tf.question.substring(0, 40)}..." → ${tf.type}: "${finalVal}"`);
        await page.waitForTimeout(1000);

        if (tf.type === "location") {
          try {
            await page.waitForTimeout(1500);
            const suggestion = page.locator(".ui-menu-item, .ui-autocomplete li, [role='option'], .suggestion").first();
            if (await suggestion.count() && await suggestion.isVisible()) {
              await suggestion.click({ delay: 100 });
              console.log("         ✅ Clicked city autocomplete suggestion");
              await page.waitForTimeout(1000);
            } else {
              await tf.el.press("Enter");
              await page.waitForTimeout(1000);
            }
          } catch (err) {
            console.log(`         ⚠ City autocomplete error: ${err.message}`);
          }
        }
      }
    } else {
      console.log(`      ⚠ No answer generated for: "${tf.question.substring(0, 40)}..."`);
    }
  }

  

  /* ── RADIO BUTTONS ──────────────────────────────────────── */
  try {
    const radioNames = await page.evaluate(() => {
      const names = new Set();
      document.querySelectorAll("input[type='radio']").forEach(r => {
        const name = r.getAttribute("name");
        if (name) names.add(name);
      });
      return Array.from(names);
    });

    console.log(`   🔘 Found ${radioNames.length} radio button groups`);
    
    for (const name of radioNames) {
      await page.evaluate((groupName) => {
        const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${groupName}"]`));
        if (radios.length === 0) return;

        // Skip if group already has a checked option
        const alreadyChecked = radios.some(r => r.checked);
        if (alreadyChecked) return;

        // 1. Try to find an option whose label text contains "yes"
        let target = radios.find(r => {
          const label = r.closest('label') || document.querySelector(`label[for="${r.id}"]`) || r.parentElement;
          return label && label.innerText.toLowerCase().includes('yes');
        });

        // 2. If no "yes" option, look for "immediate" (availability options)
        if (!target) {
          target = radios.find(r => {
            const label = r.closest('label') || document.querySelector(`label[for="${r.id}"]`) || r.parentElement;
            return label && label.innerText.toLowerCase().includes('immediate');
          });
        }

        // 3. Fallback: select the first option in the group
        if (!target) {
          target = radios[0];
        }

        if (target) {
          const label = target.closest('label') || document.querySelector(`label[for="${target.id}"]`);
          if (label) {
            label.click();
          } else {
            target.click();
          }
          target.checked = true;
          target.dispatchEvent(new Event('click', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, name);
      await page.waitForTimeout(2000); // 2s delay for radio selection change to settle
    }
  } catch (e) {
    console.log(`   ⚠ Radio button group handling error: ${e.message}`);
  }

  /* ── NATIVE & CUSTOM SELECT DROPDOWNS ───────────────────── */
  const selects = await page.$$("select");
  for (const sel of selects) {
    try {
      // Determine if this select is managed by Chosen.js
      const isChosen = await page.evaluate(s => {
        let sibling = s.nextElementSibling;
        while (sibling) {
          if (sibling.classList.contains('chosen-container')) return true;
          sibling = sibling.nextElementSibling;
        }
        return s.classList.contains('chosen-select');
      }, sel);

      const isVisible = await sel.isVisible().catch(() => false);
      if (!isVisible && !isChosen) continue;

      const options = await sel.evaluate(s => {
        return Array.from(s.options).map((o, idx) => ({ text: o.text, value: o.value, index: idx }));
      }).catch(() => []);
      if (options.length <= 1) continue;

      const value = await sel.inputValue().catch(() => '');
      // If it already has a selected non-placeholder option, skip
      if (value && value !== "" && value !== options[0].value) continue;

      const question = await getQuestionText(sel);
      const questionLower = question.toLowerCase();
      const type = classifyQuestion(question);

      // Skip selects that are inside a radio 'Other' option container
      const isOtherContainer = await sel.evaluate(s => {
        let el = s.parentElement;
        for (let i = 0; i < 3; i++) {
          if (!el) break;
          const cls = el.className?.toLowerCase() || '';
          if (cls.includes('other-option') || cls.includes('other_option') || cls.includes('other-container') || cls.includes('other_container')) {
            return true;
          }
          el = el.parentElement;
        }
        return false;
      }).catch(() => false);
      if (isOtherContainer) {
        console.log(`      ⏩ Skipping select inside radio 'Other' container`);
        continue;
      }

      const isRatingQuestion = type === 'rating' || 
                               questionLower.includes('scale') || 
                               questionLower.includes('proficiency') || 
                               questionLower.includes('rate your') || 
                               questionLower.includes('rate yourself') ||
                               (() => {
                                 const texts = options.map(o => o.text.trim());
                                 const hasSelectRange = texts.some(t => t.toLowerCase() === 'select range');
                                 const numericOpts = texts.filter(t => /^\d+$/.test(t)).map(Number);
                                 const isScale = numericOpts.length >= 4 && Math.max(...numericOpts) <= 10;
                                 return hasSelectRange || isScale;
                               })();

      // Get target answer value
      let answer = null;
      if (isRatingQuestion) {
        // Find options that are exactly "4" or "5" (or contain them)
        const fourOpt = options.find(o => o.text.trim() === '4' || o.text.trim().toLowerCase().startsWith('4 '));
        const fiveOpt = options.find(o => o.text.trim() === '5' || o.text.trim().toLowerCase().startsWith('5 '));
        
        if (fiveOpt) {
          answer = fiveOpt.text.trim();
        } else if (fourOpt) {
          answer = fourOpt.text.trim();
        } else {
          // Look for text matching Expert, Advanced, Fluent, High
          const highOpt = options.find(o => {
            const t = o.text.toLowerCase();
            return t.includes('expert') || t.includes('advanced') || t.includes('fluent') || t.includes('high') || t.includes('proficient');
          });
          if (highOpt) {
            answer = highOpt.text.trim();
          } else {
            const lastIdx = options.length - 1;
            answer = options[lastIdx > 1 ? lastIdx - 1 : lastIdx].text.trim();
          }
        }
      } else {
        answer = await getAnswer({
          question, type,
          job: { ...job, jdText },
          resume, goal, profile
        });
      }

      console.log(`   📝 Select "${question.substring(0, 40)}..." → type: ${type} (target: ${answer})`);

      if (isChosen) {
        // Handle Chosen.js custom select elements with coordinate-based clicking first
        let selected = false;
        try {
          // Scroll container into view first
          await page.evaluate(s => {
            let container = s.nextElementSibling;
            while (container && !container.classList.contains('chosen-container')) {
              container = container.nextElementSibling;
            }
            if (container) {
              container.scrollIntoView({ block: 'center', inline: 'center' });
            }
          }, sel);
          await page.waitForTimeout(1000); // let scroll settle

          // Get the coordinates of the chosen-container's link element (.chosen-single)
          const containerCoords = await page.evaluate(s => {
            let container = s.nextElementSibling;
            while (container && !container.classList.contains('chosen-container')) {
              container = container.nextElementSibling;
            }
            if (!container) return null;
            const link = container.querySelector('.chosen-single');
            if (!link) return null;
            const rect = link.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return null;
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          }, sel);

          if (containerCoords && containerCoords.x > 0 && containerCoords.y > 0) {
            console.log(`      Clicking Chosen.js container link at (${containerCoords.x.toFixed(1)}, ${containerCoords.y.toFixed(1)})`);
            await page.mouse.click(containerCoords.x, containerCoords.y);
            await page.waitForTimeout(1000); // Wait for dropdown list to render/open

            const targetText = String(answer).toLowerCase().trim();
            // Get option coordinates
            const optionCoords = await page.evaluate(([s, target]) => {
              let container = s.nextElementSibling;
              while (container && !container.classList.contains('chosen-container')) {
                container = container.nextElementSibling;
              }
              if (!container) return null;

              const results = Array.from(container.querySelectorAll('.chosen-results li'));
              let match = results.find(r => {
                const txt = r.innerText.toLowerCase().trim();
                return txt === target || txt.includes(target) || target.includes(txt);
              });

              // Fallback for rating: if target is "5" or "4", try to find 5 or 4
              if (!match && (target === "5" || target === "4")) {
                match = results.find(r => {
                  const txt = r.innerText.trim();
                  return txt === "5" || txt === "4";
                });
              }

              // Fallback 2: click the last active option (usually the highest rating)
              if (!match && (target === "5" || target === "4" || target === "9")) {
                const activeResults = results.filter(r => r.classList.contains('active-result'));
                if (activeResults.length > 0) {
                  match = activeResults[activeResults.length - 1];
                }
              }

              // Fallback 3: click index 1 (first real option)
              if (!match && results.length > 1) {
                match = results[1];
              }

              if (match) {
                const rect = match.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, text: match.innerText };
              }
              return null;
            }, [sel, targetText]);

            if (optionCoords && optionCoords.x > 0 && optionCoords.y > 0) {
              console.log(`      Clicking Chosen.js option "${optionCoords.text}" at (${optionCoords.x.toFixed(1)}, ${optionCoords.y.toFixed(1)})`);
              await page.mouse.click(optionCoords.x, optionCoords.y);
              await page.waitForTimeout(2000); // Wait for selection change events
              selected = true;
            }
          }
        } catch (err) {
          console.log(`      ⚠ Mouse click Chosen.js error: ${err.message}. Falling back to page.evaluate click...`);
        }

        if (!selected) {
          // Handle Chosen.js custom select elements via page.evaluate
          selected = await page.evaluate(async ([s, ans]) => {
            let container = s.nextElementSibling;
            while (container && !container.classList.contains('chosen-container')) {
              container = container.nextElementSibling;
            }
            if (!container) return false;

            const link = container.querySelector('.chosen-single');
            if (link) {
              link.click();
              await new Promise(r => setTimeout(r, 500)); // wait for dropdown to open

              const results = Array.from(container.querySelectorAll('.chosen-results .active-result, .chosen-results li'));
              const targetText = String(ans).toLowerCase().trim();

              const match = results.find(r => {
                const txt = r.innerText.toLowerCase().trim();
                return txt === targetText || txt.includes(targetText) || targetText.includes(txt);
              });

              if (match) {
                match.click();
                return true;
              }

              // Fallback for rating/scales: if target is "5" or "4", click the last option
              if (targetText === "5" || targetText === "4" || targetText === "9") {
                const activeResults = results.filter(r => r.classList.contains('active-result'));
                if (activeResults.length > 0) {
                  activeResults[activeResults.length - 1].click();
                  return true;
                }
              }
              
              // Fallback: click index 1 (first real option)
              if (results.length > 1) {
                results[1].click();
                return true;
              }
            }
            return false;
          }, [sel, answer]);
        }

        if (selected) {
          console.log(`      ✅ Chosen.js dropdown selected option matching "${answer}"`);
          await page.waitForTimeout(2000);
          continue;
        }
      }

      // Standard native select fallback
      const optionValue = await sel.evaluate((s, ans, qType) => {
        if (ans === null || ans === undefined || ans === "") return null;
        const targetText = String(ans).toLowerCase();
        
        for (let i = 0; i < s.options.length; i++) {
          const optText = s.options[i].text.toLowerCase();
          const optVal = s.options[i].value;
          if (optText.includes(targetText) || targetText.includes(optText)) {
            return optVal;
          }
        }
        
        if (qType === 'experience' || qType === 'notice_period' || qType === 'joining_days') {
          const num = parseInt(ans, 10);
          if (!isNaN(num)) {
            let bestOption = null;
            let minDiff = Infinity;
            for (let i = 0; i < s.options.length; i++) {
              const optNum = parseInt(s.options[i].text.replace(/\D/g, ''), 10);
              if (!isNaN(optNum)) {
                const diff = Math.abs(optNum - num);
                if (diff < minDiff) {
                  minDiff = diff;
                  bestOption = s.options[i].value;
                }
              }
            }
            if (bestOption !== null) return bestOption;
          }
        }
        return null;
      }, answer, type);

      if (optionValue) {
        await sel.evaluate((s, val) => {
          s.value = val;
          s.dispatchEvent(new Event('change', { bubbles: true }));
          s.dispatchEvent(new Event('input', { bubbles: true }));
        }, optionValue);
        console.log(`      ✅ Selected option value: "${optionValue}"`);
        await page.waitForTimeout(2000);
      } else {
        const optionCount = options.length;
        if (optionCount > 1) {
          await sel.evaluate((s, val) => {
            s.value = val;
            s.dispatchEvent(new Event('change', { bubbles: true }));
            s.dispatchEvent(new Event('input', { bubbles: true }));
          }, options[1].value);
          console.log(`      ✅ Fallback selected index 1: "${options[1].text}"`);
          await page.waitForTimeout(2000);
        }
      }
    } catch (err) {
      console.log(`   ⚠ Select option error: ${err.message}`);
    }
  }

  /* ── CUSTOM COMBOBOXES (ARIA) ───────────────────────────── */
  const comboboxes = await page.$$("[role='combobox'], button[aria-haspopup='listbox']");
  for (const box of comboboxes) {
    if (!(await box.isVisible())) continue;
    try {
      await box.click();
      await page.waitForTimeout(2000); // Wait 2s for combobox menu transition
      const options = await page.$$("[role='option']");
      if (options.length > 0) {
        const targetOption = options[1] || options[0];
        if (targetOption) {
          await targetOption.click();
          await page.waitForTimeout(2000); // Wait 2s for selection animation/transition
        }
      }
    } catch {}
  }

  /* ── CHECKBOXES ─────────────────────────────────────────── */
  try {
    const checkboxes = await page.$$("input[type='checkbox']");
    for (const cb of checkboxes) {
      if (!(await cb.isVisible())) continue;
      const isChecked = await cb.isChecked();
      if (!isChecked) {
        console.log(`   ☑ Checking checkbox...`);
        await cb.evaluate(el => {
          const label = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
          if (label) {
            label.click();
          } else {
            el.click();
          }
          el.checked = true;
          el.dispatchEvent(new Event('click', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForTimeout(2000); // Wait 2s after checkbox toggle
      }
    }
  } catch (e) {
    console.log(`   ⚠ Checkbox handling error: ${e.message}`);
  }
}

/* ── Confirmation check ──────────────────────────────────── */
async function internshalaConfirmed(page) {
  // Check for up to 10 seconds for any confirmation indicators
  for (let i = 0; i < 10; i++) {
    const status = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      const url = window.location.href;

      const toasts = Array.from(document.querySelectorAll('.toast, .notification, .success, [class*="toast"], [class*="notification"], .alert-success'));
      const toastText = toasts.map(t => t.innerText.toLowerCase()).join(' ');

      const successWords = [
        "successfully applied",
        "application submitted",
        "applied successfully",
        "application sent",
        "applied!",
        "success"
      ];

      const hasSuccessWord = successWords.some(word => text.includes(word) || toastText.includes(word));
      const hasSuccessUrl = url.includes("/applications");

      return { hasSuccessWord, hasSuccessUrl, url };
    });

    if (status.hasSuccessWord || status.hasSuccessUrl) {
      console.log(`   🟢 Application confirmation detected! (URL: ${status.url})`);
      return true;
    }

    await page.waitForTimeout(1000);
  }
  return false;
}

/* ── MAIN ────────────────────────────────────────────────── */
(async () => {
  // Guard: filtered queue must exist
  if (!fs.existsSync(JOB_QUEUE_PATH)) {
    console.error("❌  job-queue-filtered.json not found.");
    console.error("   Run: node job-engine/job-filter.js  first.");
    process.exit(1);
  }

  // Guard: resume must exist
  if (!fs.existsSync(RESUME_PATH)) {
    console.error("❌  resume.txt not found at:", RESUME_PATH);
    process.exit(1);
  }

  console.log("🌐  Connecting to Dalvi browser...");
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const context = browser.contexts()[0];
  // Pick the Internshala page, not the webpack control panel
  const allPages = context.pages();
  const page = allPages.find(p => !p.url().includes('main_window') && !p.url().startsWith('devtools://')) || allPages[0];
  console.log("✅  Connected");

  // Disable beforeunload handlers completely to prevent navigation aborts
  await page.addInitScript(() => {
    try {
      if (window.BeforeUnloadEvent) {
        Object.defineProperty(BeforeUnloadEvent.prototype, 'returnValue', {
          get() { return undefined; },
          set() {},
          configurable: true
        });
      }
      const orgPrevent = Event.prototype.preventDefault;
      Event.prototype.preventDefault = function() {
        if (this.type === 'beforeunload') return;
        return orgPrevent.apply(this, arguments);
      };
      Object.defineProperty(window, 'onbeforeunload', {
        get() { return null; },
        set() {},
        configurable: true,
        enumerable: true
      });
    } catch (e) {}
  });

  // Run it immediately on the connected page in case it's already loaded and dirty
  try {
    await page.evaluate(() => {
      if (window.BeforeUnloadEvent) {
        Object.defineProperty(BeforeUnloadEvent.prototype, 'returnValue', {
          get() { return undefined; },
          set() {},
          configurable: true
        });
      }
      const orgPrevent = Event.prototype.preventDefault;
      Event.prototype.preventDefault = function() {
        if (this.type === 'beforeunload') return;
        return orgPrevent.apply(this, arguments);
      };
      window.onbeforeunload = null;
    }).catch(() => {});
  } catch (e) {}

  // Handle dialogs (like alert, confirm, beforeunload) safely to prevent crashes
  page.on('dialog', async dialog => {
    console.log(`💬  Browser dialog popped up: [${dialog.type()}] "${dialog.message()}"`);
    try {
      await dialog.accept();
    } catch (err) {
      console.log(`   ⚠ Dialog handle error (possibly already closed): ${err.message}`);
    }
  });

  const jobs       = JSON.parse(fs.readFileSync(JOB_QUEUE_PATH, "utf-8"));
  const appliedJobs = loadAppliedJobs();
  const skipReasons = loadSkipReasons();

  console.log(`📋  ${jobs.length} jobs in filtered queue`);

  for (const job of jobs) {


    if (appliedJobs.has(job.id)) {
      stats.skipped_disk++;
      continue;
    }

    console.log(`\n➡️  Applying: ${job.title} @ ${job.company}`);

    try {
      // 1. Disable beforeunload dialog before navigating
      try {
        await page.evaluate(() => { window.onbeforeunload = null; }).catch(() => {});
      } catch (unloadErr) {}

      console.log(`   Navigating to: ${job.jobLink}`);
      try {
        await page.goto(job.jobLink, { waitUntil: "load", timeout: 30000 });
      } catch (gotoErr) {
        console.log(`   ⚠️ Navigation error: ${gotoErr.message}`);
        throw gotoErr; // Rethrow to skip this job and trigger finally cleanup
      }

      // Wait for URL to settle to Internshala details page or external redirect
      try {
        await page.waitForURL(url => 
          url.href.includes('internshala.com/job/detail/') || 
          url.href.includes('internshala.com/internship/detail/') || 
          !url.href.includes('internshala.com'), 
          { timeout: 10000 }
        );
      } catch (urlWaitErr) {
        console.log(`   ⚠️ Timeout waiting for details page or redirect: ${urlWaitErr.message}`);
      }

      await page.waitForTimeout(2000); // Wait 2s for details to render and settle redirects

      const currentUrl = page.url();

      // Check if account is put on hold / blocked
      const isBlocked = await page.evaluate(() => {
        const modal = document.querySelector('#employer_blocked_error_modal, .modal.show, [id*="blocked"], [class*="blocked"]');
        if (modal && window.getComputedStyle(modal).display !== 'none') {
          const text = modal.innerText.toLowerCase();
          return text.includes('hold') || text.includes('blocked') || text.includes('violation');
        }
        return document.body.innerText.toLowerCase().includes('account is put on hold');
      });

      if (isBlocked) {
        console.error("\n❌  CRITICAL ERROR: Internshala account is put on hold / blocked!");
        console.error("   Aborting run immediately to prevent further issues.");
        process.exit(1);
      }

      // Redirect check
      if (!currentUrl.includes("internshala.com")) {
        console.log("⚠️  External redirect, skipping");
        stats.skipped_external++;
        skipReasons[job.id] = "external_redirect";
        continue;
      }

      // Verify that we are on a job details page
      if (!currentUrl.includes("/detail/")) {
        console.log(`   ⚠️ Not on an Internshala details page (URL: ${currentUrl}). Skipping.`);
        continue;
      }

      // Already applied?
      if (await isAlreadyAppliedUI(page)) {
        console.log("⏭️  Already applied (UI), skipping");
        stats.skipped_ui++;
        appliedJobs.add(job.id);   // prevent future checks
        continue;
      }

      /* ── Extract JD BEFORE clicking Apply ─────────────── */
      // Once the apply modal opens, the JD content may be obscured
      let jdText = "";
      try {
        jdText = await page.$eval(
          ".internship_details, .job_details_container, .about_the_job, .text-container",
          el => el.innerText.trim()
        );
      } catch {
        // Fallback: grab entire page text (capped)
        jdText = (await page.innerText("body")).slice(0, 3000);
      }

      // Click Apply button
      if (!(await forceClickApply(page))) {
        console.log("🚫  No Apply button found");
        stats.skipped_no_cta++;
        skipReasons[job.id] = "no_cta";
        continue;
      }

      await page.waitForTimeout(2000); // 2s delay

      // Handle Internshala resume review page (shows before apply form sometimes)
      await handleResumePage(page);
      await page.waitForTimeout(2000); // 2s delay

      // Handle resume page again in case it appeared after a redirect
      await handleResumePage(page);
      await page.waitForTimeout(2000); // 2s delay

      if (!(await isApplyModalOpen(page))) {
        console.log("🚫  Apply modal did not open");
        continue;
      }

      /* ── Fill the form ─────────────────────────────────── */
      await smartFillForm(page, { ...job, jdText });
      await page.waitForTimeout(2000);

      /* ── Blocking required fields? ─────────────────────── */
      if (await hasBlockingRequiredFields(page)) {
        console.log("🚫  Unfilled required fields — skipping");
        stats.skipped_text++;
        skipReasons[job.id] = "unfilled_required";
        continue;
      }

      /* ── Submit ────────────────────────────────────────── */
      if (process.env.DALVI_DRY_RUN === "true") {
        console.log("   🧪 [DRY RUN] Form filled. Taking screenshot and skipping submit.");
        const screenshotPath = path.join(__dirname, `../scratch/dry_run_${job.id}.png`);
        try {
          await page.screenshot({ path: screenshotPath, timeout: 5000 });
          console.log(`   📸 Screenshot saved to: ${screenshotPath}`);
        } catch (err) {
          console.log(`   ⚠️ Screenshot failed (timeout/error): ${err.message}`);
        }
        continue;
      }
      await clickSubmit(page);
      await page.waitForTimeout(3000);

      /* ── Confirm success ───────────────────────────────── */
      if (!(await internshalaConfirmed(page))) {
        console.log("❓  Could not confirm application success");
        continue;
      }

      console.log("🟢  APPLICATION CONFIRMED");
      appliedJobs.add(job.id);
      stats.applied++;

    } catch (e) {
      console.log("❌  Error:", e.message);
      stats.errors++;
    } finally {
      // Clean up the page context and reset page state to about:blank to terminate background activities
      try {
        console.log("   🧹 Cleaning up page state (navigating to about:blank)...");
        try {
          await page.evaluate(() => {
            if (window.BeforeUnloadEvent) {
              Object.defineProperty(BeforeUnloadEvent.prototype, 'returnValue', {
                get() { return undefined; },
                set() {},
                configurable: true
              });
            }
            const orgPrevent = Event.prototype.preventDefault;
            Event.prototype.preventDefault = function() {
              if (this.type === 'beforeunload') return;
              return orgPrevent.apply(this, arguments);
            };
            window.onbeforeunload = null;
          }).catch(() => {});
        } catch (e) {}
        await page.goto("about:blank", { timeout: 10000 }).catch(() => {});
      } catch (blankErr) {
        console.log(`   ⚠️ about:blank navigation error: ${blankErr.message}`);
      }
      // Polite delay between applications
      await page.waitForTimeout(3000);
    }
  }

  saveAppliedJobs(appliedJobs);
  saveSkipReasons(skipReasons);

  console.log("\n📊  RUN SUMMARY");
  console.table(stats);
})();
