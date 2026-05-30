const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  await page.goto('https://internshala.com/jobs/sales-jobs-in-mumbai/page-2');
  await page.waitForTimeout(3000);
  
  const cards = await page.$$('div.internship_meta');
  for (const card of cards) {
    const hasCompany = await card.$('.company-name');
    if (hasCompany) {
      const html = await card.innerHTML();
      console.log("CARD HTML:", html.replace(/\s+/g, ' ').slice(0, 2000));
      break;
    }
  }
  
  // Close browser is handled externally since it's persistent, but we don't close it so user can see it
  // We'll just exit
})();
