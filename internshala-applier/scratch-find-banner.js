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

  const results = await page.evaluate(() => {
    // Find all elements containing "already applied"
    const elements = Array.from(document.querySelectorAll('*'));
    const matched = [];
    elements.forEach(el => {
      // Direct text check (to avoid parent containers matching everything)
      const text = el.innerText || '';
      if (text.toLowerCase().includes('already applied') && el.children.length <= 5) {
        matched.push({
          tagName: el.tagName,
          className: el.className,
          id: el.id,
          innerText: text.trim().replace(/\s+/g, ' ').slice(0, 200),
          parentTagName: el.parentElement ? el.parentElement.tagName : null,
          parentClassName: el.parentElement ? el.parentElement.className : null
        });
      }
    });
    return matched;
  });

  console.log("\n--- Elements containing 'already applied' ---");
  console.log(JSON.stringify(results, null, 2));

  // Also look for the Apply button at the bottom of the page
  const applyButtons = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, a, input'));
    return btns
      .filter(b => {
        const t = (b.innerText || b.value || '').toLowerCase().trim();
        return t.includes('apply') || t === 'applied' || t.includes('already');
      })
      .map(b => ({
        tagName: b.tagName,
        className: b.className,
        id: b.id,
        text: (b.innerText || b.value || '').trim().replace(/\s+/g, ' '),
        html: b.outerHTML.slice(0, 250)
      }));
  });

  console.log("\n--- Apply / Applied / Already buttons on the page ---");
  console.log(JSON.stringify(applyButtons, null, 2));

})().catch(console.error);
