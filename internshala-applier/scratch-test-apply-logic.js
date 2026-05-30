const { chromium } = require('playwright');

(async () => {
  console.log("Connecting...");
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('internshala.com/job/detail/'));
  if (!page) {
    console.log("❌ No Internshala details page found.");
    return;
  }

  const url = page.url();
  const title = await page.title();
  console.log(`Testing on: ${title} (${url})`);

  const evaluation = await page.evaluate(() => {
    const mainContainer = document.querySelector(
      '.detail_view, .job_details_container, .internship_details, #details_container, #job_details, #internship_details'
    );
    if (!mainContainer) return { error: "No container found" };
    
    const clone = mainContainer.cloneNode(true);
    
    // Remove unwanted
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
      '.about_the_job', '.job-description', '.job_description', '.text-container',
      '.about_company', '.about-company', '.about_employer'
    ];
    selectorsToRemove.forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    });
    
    const textToCheck = clone.innerText.toLowerCase();
    
    // Refined check
    let hasAppliedText = 
      textToCheck.includes("you have applied to this") || 
      textToCheck.includes("you applied to this") || 
      textToCheck.includes("you've applied to this") || 
      textToCheck.includes("already applied to this") ||
      textToCheck.includes("already applied for this") ||
      textToCheck.includes("applied successfully") ||
      textToCheck.includes("application status: applied") ||
      textToCheck.includes("you applied on");

    let matchedGeneralText = null;
    let matchedGeneralPreceding = null;
    if (!hasAppliedText) {
      // If we find "already applied", verify it is not referring to other candidates/applicants
      const idx = textToCheck.indexOf("already applied");
      if (idx !== -1) {
        const preceding = textToCheck.substring(Math.max(0, idx - 60), idx);
        const matchesCandidates = /(candidates|applicants|others|people|\b\d+\b)/i.test(preceding);
        matchedGeneralText = "already applied";
        matchedGeneralPreceding = preceding;
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
        matchedGeneralText = "applied on";
        matchedGeneralPreceding = preceding;
        if (!matchesCandidates) {
          hasAppliedText = true;
        }
      }
    }
      
    // Status banner check
    let statusApplied = false;
    let matchingStatusBanner = null;
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
        matchingStatusBanner = bannerText;
        break;
      }
    }
    
    // Check buttons
    let buttonApplied = false;
    let matchingButton = null;
    const buttonsToCheck = Array.from(clone.querySelectorAll('button, a, input[type="button"], input[type="submit"]'));
    for (const btn of buttonsToCheck) {
      const btnText = btn.innerText?.trim().toLowerCase() || '';
      if (btnText.includes("candidates") || btnText.includes("applicants")) {
        continue;
      }
      if (btnText === 'applied' || btnText === 'already applied' || btnText === 'already_applied') {
        buttonApplied = true;
        matchingButton = btnText;
        break;
      }
    }
    
    return {
      textToCheck: textToCheck.slice(0, 500),
      hasAppliedText,
      matchedGeneralText,
      matchedGeneralPreceding,
      statusApplied,
      matchingStatusBanner,
      buttonApplied,
      matchingButton,
      result: hasAppliedText || statusApplied || buttonApplied
    };
  });

  console.log("\n--- Refined isAlreadyAppliedUI Evaluation ---");
  console.log(JSON.stringify(evaluation, null, 2));

})().catch(console.error);
