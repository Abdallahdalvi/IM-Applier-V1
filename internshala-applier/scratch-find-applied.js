const { chromium } = require('playwright');

(async () => {
  console.log("Connecting to browser...");
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('internshala.com/job/detail/') || p.url().includes('internshala.com/internship/detail/'));
  if (!page) {
    console.log("❌ No Internshala details page found.");
    return;
  }

  const url = page.url();
  console.log(`Analyzing page: ${url}`);

  const elementsInfo = await page.evaluate(() => {
    // 1. Find the main job details container
    const mainContainer = document.querySelector(
      '.detail_view, .job_details_container, .internship_details, #details_container, #job_details, #internship_details'
    );
    if (!mainContainer) return { error: "No container found" };

    const clone = mainContainer.cloneNode(true);
    // Remove unwanted (mirroring the clean logic)
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

    const info = [];
    // Search in the cleaned clone
    const allEls = clone.querySelectorAll('*');
    allEls.forEach(el => {
      const text = el.innerText?.trim() || '';
      if (text.toLowerCase().includes('applied')) {
        info.push({
          tag: el.tagName,
          id: el.id,
          className: el.className,
          text: text.slice(0, 150),
          childCount: el.children.length
        });
      }
    });
    return info;
  });

  console.log("\n--- Elements containing 'applied' in the cleaned container ---");
  console.log(JSON.stringify(elementsInfo, null, 2));

})().catch(console.error);
