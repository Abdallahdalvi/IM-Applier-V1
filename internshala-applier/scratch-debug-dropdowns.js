const { chromium } = require("playwright");

(async () => {
  console.log("Connecting to Dalvi browser...");
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const context = browser.contexts()[0];
  const allPages = context.pages();
  const page = allPages.find(p => p.url().includes('/application/') || p.url().includes('/apply/')) || allPages[0];

  console.log("Connected to page:", page.url());

  const dropdownMarkup = await page.evaluate(() => {
    const results = [];
    
    // Find all select elements
    document.querySelectorAll('select').forEach((sel, i) => {
      results.push({
        type: 'select',
        name: sel.getAttribute('name'),
        id: sel.getAttribute('id'),
        options: Array.from(sel.options).map(o => o.text),
        outerHTML: sel.outerHTML.substring(0, 500)
      });
    });

    // Find elements containing "Select Range" or having role combobox/listbox
    const all = document.querySelectorAll('*');
    all.forEach(el => {
      const text = el.innerText?.trim();
      if (text === 'Select Range' || el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') {
        results.push({
          type: 'custom_dropdown_candidate',
          tagName: el.tagName,
          id: el.getAttribute('id'),
          class: el.getAttribute('class'),
          outerHTML: el.outerHTML.substring(0, 500)
        });
      }
    });

    return results;
  });

  console.log("=================== DROPDOWNS MARKUP ===================");
  console.log(JSON.stringify(dropdownMarkup, null, 2));

  await browser.close();
})();
