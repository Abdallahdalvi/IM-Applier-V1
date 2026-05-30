const { chromium } = require("playwright");

(async () => {
  // Attach to Dalvi browser
  const browser = await chromium.connectOverCDP("http://localhost:9222");

  const context = browser.contexts()[0];
  const page = context.pages()[0];

  await page.waitForLoadState("domcontentloaded");

  // Control Dalvi directly
  await page.click('textarea[name="q"], input[name="q"]');
  await page.type(
    'textarea[name="q"], input[name="q"]',
    "Dalvi controls its own browser",
    { delay: 100 }
  );

  await page.keyboard.press("Enter");
})();
