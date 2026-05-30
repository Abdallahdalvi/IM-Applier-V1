const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--disable-infobars",
      "--disable-notifications",
      "--disable-features=TranslateUI",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const context = await browser.newContext({
    locale: "en-IN",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  await page.goto("https://www.google.com", {
    waitUntil: "domcontentloaded",
  });

  const searchBox = 'textarea[name="q"], input[name="q"]';

  await page.waitForSelector(searchBox, { timeout: 10000 });
  await page.click(searchBox);
  await page.type(searchBox, "Dalvi browser automation", { delay: 120 });

  // IMPORTANT: submit form directly
  await page.evaluate(() => {
    document.querySelector("form").submit();
  });

})();
