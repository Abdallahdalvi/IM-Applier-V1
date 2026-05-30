/**
 * dalvi-internshala-discovery.js
 *
 * Uses Playwright to interact with Internshala's sidebar filters directly.
 * NO URL-based filtering — everything done via the page UI.
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

/* ── Paths ────────────────────────────────────────────────── */
const JOB_QUEUE_PATH = path.join(__dirname, "job-queue.json");

const user    = process.env.DALVI_USER || "default";
const userDir = path.join(__dirname, "users", user);
const configPath = path.join(userDir, "config.json");

/* ── Load user config ─────────────────────────────────────── */
let config = {
  allowedKeywords: [],
  blockKeywords: [],
  location: "",
  minSalary: 0,
  workFromHome: false,
  partTime: false,
  experienceRange: "",
};

if (fs.existsSync(configPath)) {
  config = { ...config, ...JSON.parse(fs.readFileSync(configPath, "utf-8")) };
} else {
  console.warn("⚠ No config.json found – upload a resume first!");
}

// Internshala sidebar only accepts up to 3 profile keywords
const KEYWORDS = (config.allowedKeywords || []).map(k => k.trim()).filter(Boolean).slice(0, 3);

const BLOCKED  = (config.blockKeywords   || []).map(k => k.trim().toLowerCase()).filter(Boolean);
const LOCATION = (config.location || "").trim();
const MIN_SALARY = config.minSalary || 0;
const MIN_SALARY_LAKHS = Math.round(MIN_SALARY / 100000);
const WFH      = config.workFromHome || false;
const PART_TIME = config.partTime || false;

console.log(`\n📋 Keywords (${KEYWORDS.length}): ${KEYWORDS.join(', ') || '(all jobs)'}`);
console.log(`📍 Location: ${LOCATION || 'All India'}`);
console.log(`⚙️  Filters: salary ≥ ₹${MIN_SALARY}/yr (${MIN_SALARY_LAKHS}L), WFH=${WFH}, part-time=${PART_TIME}`);
/* ── Helper: wait for Internshala loader to disappear ──────── */
async function waitForLoader(page) {
  try {
    await page.waitForTimeout(400); // Wait a bit for loader to appear
    
    // Check if loaders are present and visible using a non-blocking timeout
    await page.evaluate(() => {
      return new Promise((resolve) => {
        let elapsed = 0;
        const check = () => {
          const el1 = document.querySelector('.loading_image');
          const el2 = document.querySelector('#loading_toast');
          const el3 = document.querySelector('.loading_toast');
          
          const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            // Also check opacity and z-index to handle hidden loaders
            return style.display !== 'none' && 
                   style.visibility !== 'hidden' && 
                   style.opacity !== '0' && 
                   style.zIndex !== '-1' && 
                   el.offsetHeight > 0;
          };
          
          // Wait at most 4 seconds total
          if (elapsed >= 4000 || (!isVisible(el1) && !isVisible(el2) && !isVisible(el3))) {
            resolve();
          } else {
            elapsed += 100;
            setTimeout(check, 100);
          }
        };
        check();
      });
    });
    await page.waitForTimeout(300);
  } catch (err) {
    await page.waitForTimeout(400);
  }
}
/* ── Helper: type into a Chosen.js dropdown and pick suggestion ─ */
async function addChosenItem(page, containerSelector, text) {
  try {
    // Locate the container freshly
    let chosenContainer = await page.$(containerSelector);
    if (!chosenContainer) {
      // Fallback: first chosen container on the page
      const chosenContainers = await page.$$('.chosen-container');
      chosenContainer = chosenContainers[0];
    }
    
    if (!chosenContainer) {
      console.log(`   ⚠ Chosen container not found`);
      return false;
    }

    // 1. Check if already selected
    const alreadyAdded = await chosenContainer.$$eval('.search-choice', els => els.map(el => el.innerText.trim().toLowerCase()));
    const cleanText = text.trim().toLowerCase();
    if (alreadyAdded.some(item => item.includes(cleanText))) {
      console.log(`      ✅ "${text}" (already selected)`);
      return true;
    }

    // 2. Locate input
    let input = await chosenContainer.$('.chosen-choices .search-field input, .chosen-search input, input');
    if (!input) {
      console.log(`   ⚠ No input found in Chosen container`);
      return false;
    }

    // 3. Scroll and click
    await input.scrollIntoViewIfNeeded().catch(() => {});
    await input.click({ force: true }).catch(async () => {
      await input.evaluate(el => el.click());
    });
    await page.waitForTimeout(300);

    // 4. Re-locate both container and input in case click caused a DOM refresh
    chosenContainer = await page.$(containerSelector) || chosenContainer;
    input = await chosenContainer.$('.chosen-choices .search-field input, .chosen-search input, input') || input;

    // 5. Fill and type
    await input.fill('');
    await input.type(text, { delay: 100 });
    await page.waitForTimeout(1500);

    // 6. Select from suggestions
    const result = await chosenContainer.$('.chosen-results .active-result');
    if (result) {
      await result.click();
      await waitForLoader(page);
      return true;
    }

    // Fallback: press Enter
    await input.press('Enter');
    await waitForLoader(page);
    return true;
  } catch (e) {
    console.log(`   ⚠ Chosen input error for "${text}": ${e.message}`);
    return false;
  }
}

/* ── Helper: toggle checkbox by label text (handles nested & sibling checkboxes) ── */
async function toggleCheckboxByLabelText(page, text, shouldBeChecked) {
  try {
    const labels = await page.$$('label');
    for (const label of labels) {
      if (!(await label.isVisible())) continue;
      const inner = await label.innerText();
      if (inner.toLowerCase().includes(text.toLowerCase())) {
        const isChecked = await page.evaluate((lbl) => {
          let input = lbl.querySelector('input[type="checkbox"]');
          if (!input) {
            const htmlFor = lbl.getAttribute('for');
            if (htmlFor) {
              input = document.getElementById(htmlFor);
            }
          }
          if (!input) {
            input = lbl.parentElement.querySelector('input[type="checkbox"]');
          }
          return input ? input.checked : false;
        }, label);

        if (shouldBeChecked !== isChecked) {
          await label.click().catch(async () => {
            await label.evaluate(el => el.click());
          });
          console.log(`   ✅ Toggled checkbox "${inner.trim()}" to ${shouldBeChecked}`);
          await waitForLoader(page);
        } else {
          console.log(`   ✅ Checkbox "${inner.trim()}" is already ${shouldBeChecked}`);
        }
        return true;
      }
    }
  } catch (e) {
    console.log(`   ⚠ Checkbox error for "${text}": ${e.message}`);
  }
  return false;
}

/* ── Apply all Internshala sidebar filters ────────────────── */
async function applyFilters(page) {
  console.log("🔧 Applying filters via Internshala sidebar...\n");

  const filtersContainer = await page.$('#filters_container #filters, #filters');
  if (!filtersContainer) {
    console.log("   ⚠ Filters container (#filters) not found!");
    return;
  }

  // ── 1. Add Profile keywords ────────────────────────────────
  if (KEYWORDS.length > 0) {
    console.log(`   📝 Adding ${KEYWORDS.length} profiles...`);
    const PROFILE_CHOSEN_SELECTOR = '#profile_filter_container .chosen-container, .form-group:has-text("Profile") .chosen-container, .form-group:has-text("Category") .chosen-container';
    for (const kw of KEYWORDS) {
      await waitForLoader(page);
      const added = await addChosenItem(page, PROFILE_CHOSEN_SELECTOR, kw);
      if (added) {
        console.log(`      ✅ "${kw}"`);
      } else {
        console.log(`      ⚠ Could not add "${kw}"`);
      }
    }
  }

  // ── 2. Set Location ────────────────────────────────────────
  if (LOCATION) {
    console.log(`   📍 Setting location: "${LOCATION}"...`);
    await waitForLoader(page);
    
    try {
      const input = await page.$('#location, input.location-input, #location_filter input, input[placeholder*="e.g. Delhi"]');
      if (input) {
        await input.scrollIntoViewIfNeeded().catch(() => {});
        await input.click({ force: true });
        await input.fill('');
        await input.type(LOCATION, { delay: 100 });
        await page.waitForTimeout(1500);

        // Wait for autocomplete dropdown and click the first suggestion
        const suggestion = page.locator(".ui-menu-item, .ui-autocomplete li, [role='option'], .suggestion").first();
        if (await suggestion.count() && await suggestion.isVisible()) {
          await suggestion.click();
          console.log(`      ✅ Location set to "${LOCATION}" via autocomplete`);
        } else {
          await input.press("Enter");
          console.log(`      ✅ Location set to "${LOCATION}" via Enter`);
        }
        await waitForLoader(page);
      } else {
        console.log(`      ⚠ Could not find location input field`);
      }
    } catch (e) {
      console.log(`      ⚠ Could not set location: ${e.message}`);
    }
  }

  // ── 3. Work from home checkbox ─────────────────────────────
  await toggleCheckboxByLabelText(page, 'Work from home', WFH);

  // ── 4. Part-time checkbox ──────────────────────────────────
  await toggleCheckboxByLabelText(page, 'Part-time', PART_TIME);

  // ── 5. Salary slider ──────────────────────────────────────
  if (MIN_SALARY_LAKHS > 0) {
    try {
      const slider = await page.$('#salary_filter');
      if (slider) {
        const val = Math.min(MIN_SALARY_LAKHS, 10);
        await slider.evaluate((el, v) => {
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, val);
        console.log(`   💰 Salary slider set to: ≥ ${val} LPA`);
        await waitForLoader(page);
      } else {
        console.log(`   ⚠ Salary slider #salary_filter not found`);
      }
    } catch (e) {
      console.log(`   ⚠ Salary slider error: ${e.message}`);
    }
  }

  // Wait for all filters to apply
  console.log("\n   ⏳ Waiting for filtered results...");
  await waitForLoader(page);
}

/* ── Main scraper ─────────────────────────────────────────── */
(async () => {
  console.log("🌐 Connecting to Dalvi browser...");

  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const context = browser.contexts()[0];
  const allPages = context.pages();
  const page = allPages.find(p => !p.url().startsWith('http://localhost') && !p.url().startsWith('devtools://')) || allPages[0];

  console.log("✅ Connected\n");

  const BASE_URL = "https://internshala.com/jobs/";
  console.log(`🔗 Navigating to ${BASE_URL}`);
  
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 25000 });
  } catch (e) {
    console.error(`❌ Failed to load Internshala: ${e.message}`);
    process.exit(1);
  }
  await page.waitForTimeout(3000);

  // Apply all filters via the sidebar UI
  await applyFilters(page);

  const filteredUrl = page.url();
  console.log(`\n🔗 Filtered URL: ${filteredUrl}`);

  // Scrape results across pages
  const jobQueue = [];
  const seenIds  = new Set();
  const MAX_PAGES = 30;
  let pageNum = 1;

  while (pageNum <= MAX_PAGES) {
    console.log(`\n📄 Page ${pageNum}...`);

    if (pageNum > 1) {
      // Find and click next page
      const nextBtn = page.locator('#next_page, a:has-text("Next"), .next_page, .arrow.next, div.next');
      if (await nextBtn.count() && await nextBtn.first().isVisible()) {
        await nextBtn.first().click();
        await page.waitForTimeout(3000);
      } else {
        console.log("   No more pages found.");
        break;
      }
    }

    // Extract job cards
    const cards = await page.$$('.individual_internship, .job-container');
    console.log(`   Found ${cards.length} total cards on DOM`);

    if (cards.length === 0) break;

    let newOnThisPage = 0;
    for (const card of cards) {
      try {
        const id = await card.getAttribute('internshipid') || await card.getAttribute('internship_id') || await card.getAttribute('data-id');
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        newOnThisPage++;

        const title = await card.$eval('#job_title, .job-title-href, .job-internship-name a, .profile, .job-title, h4', el => el.innerText.trim());
        const company = await card.$eval('.company-name, .company_name, p', el => el.innerText.trim());
        
        let jobLink = "";
        try {
          jobLink = await card.$eval('a.view_detail_button, a[href*="/job/detail/"], #job_title, .job-title-href', el => el.href);
        } catch {
          // Fallback: construct if we have ID
          jobLink = `https://internshala.com/job/detail/${id}`;
        }

        // Skip external job links that will redirect away from Internshala
        if (!jobLink.includes('internshala.com')) continue;

        jobQueue.push({ id, title, company, jobLink });
      } catch (e) {
        // Skip malformed cards
      }
    }

    console.log(`   ✅ ${newOnThisPage} new jobs found (total unique: ${jobQueue.length})`);

    // Break if no new jobs were found on this page (Internshala appended duplicates or end of results)
    if (pageNum > 1 && newOnThisPage === 0) {
      console.log("   No new jobs on this page — stopping pagination.");
      break;
    }

    pageNum++;
  }

  // Save discovered queue
  fs.writeFileSync(JOB_QUEUE_PATH, JSON.stringify(jobQueue, null, 2));
  console.log(`\n✅ Saved ${jobQueue.length} jobs to job-queue.json`);
  
  await browser.close();
})();
