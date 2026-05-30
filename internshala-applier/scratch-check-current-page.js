const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log("Connecting...");
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('internshala.com/job/detail/'));
  if (!page) {
    console.log("❌ No Internshala details page found among open tabs.");
    return;
  }
  
  const url = page.url();
  const title = await page.title();
  console.log(`Checking page: ${title} (${url})`);
  
  // Dump text
  const text = await page.innerText('body');
  console.log("\n--- Lines with 'applied' in innerText ---");
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.toLowerCase().includes('applied')) {
      console.log(`- "${line.trim()}"`);
    }
  }

  // Evaluate the cloned container selector to check what isAlreadyAppliedUI evaluates to
  const uiApplied = await page.evaluate(() => {
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
    
    const hasAppliedText = 
      textToCheck.includes("you have applied to this") || 
      textToCheck.includes("you applied to this") || 
      textToCheck.includes("you've applied to this") || 
      textToCheck.includes("already applied to this") ||
      textToCheck.includes("already applied for this") ||
      textToCheck.includes("already applied") ||
      textToCheck.includes("applied successfully") ||
      textToCheck.includes("application status: applied") ||
      textToCheck.includes("applied on");
      
    // Status banner check
    let statusApplied = false;
    let matchingStatusBanner = null;
    const statusBanners = clone.querySelectorAll(
      '.applied_status, .applied-status, .status-container, .application_status, .application-status, .status_container, #application_status, #applied_status, .alert, .toast, .notification, .status_link, .status-heading, .status-text, .status_heading, .status_text, .status-badge, .status_badge, .badge'
    );
    for (const banner of statusBanners) {
      const bannerText = banner.innerText.toLowerCase();
      if (bannerText.includes("applied") || bannerText.includes("already applied") || bannerText.includes("you have applied") || bannerText.includes("status: applied")) {
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
      if (btnText === 'applied' || btnText.includes('already applied') || btnText === 'already_applied') {
        buttonApplied = true;
        matchingButton = btnText;
        break;
      }
    }
    
    return {
      textToCheck: textToCheck.slice(0, 500),
      hasAppliedText,
      statusApplied,
      matchingStatusBanner,
      buttonApplied,
      matchingButton,
      result: hasAppliedText || statusApplied || buttonApplied
    };
  });

  console.log("\n--- isAlreadyAppliedUI Evaluation ---");
  console.log(JSON.stringify(uiApplied, null, 2));

  // Find all buttons on the page and their outer HTML or class list
  const buttonsInfo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"]'))
      .map(btn => ({
        tag: btn.tagName,
        id: btn.id,
        className: btn.className,
        text: btn.innerText?.trim(),
        html: btn.outerHTML.slice(0, 200)
      }))
      .filter(b => b.text && b.text.length > 0);
  });
  console.log("\n--- All Buttons with Text ---");
  console.log(buttonsInfo.slice(0, 20));

})().catch(console.error);
