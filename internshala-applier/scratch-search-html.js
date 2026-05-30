const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const htmlPath = path.join(__dirname, 'scratch-page-dump.html');
  if (!fs.existsSync(htmlPath)) {
    console.log("❌ scratch-page-dump.html not found.");
    return;
  }
  const html = fs.readFileSync(htmlPath, 'utf-8');

  console.log("Connecting to running browser over CDP...");
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('internshala.com') || !p.url().startsWith('http://localhost') && !p.url().startsWith('devtools://'));
  if (!page) {
    console.log("❌ No suitable active page found to run analysis.");
    return;
  }

  console.log(`Using active page: ${page.url()}`);
  
  const results = await page.evaluate((htmlContent) => {
    // Create a temp iframe to render and parse the HTML
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();

    const matched = [];
    const elements = Array.from(doc.querySelectorAll('*'));
    elements.forEach(el => {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;

      const id = el.id || '';
      const cls = el.className || '';
      
      // Get direct text
      let directText = '';
      for (let i = 0; i < el.childNodes.length; i++) {
        if (el.childNodes[i].nodeType === 3) { // Text Node
          directText += el.childNodes[i].nodeValue;
        }
      }
      directText = directText.trim();

      const idMatch = id.toLowerCase().includes('applied') || id.toLowerCase().includes('apply');
      const clsMatch = typeof cls === 'string' && (cls.toLowerCase().includes('applied') || cls.toLowerCase().includes('apply'));
      const textMatch = directText.toLowerCase().includes('applied') || directText.toLowerCase().includes('apply');

      if (idMatch || clsMatch || textMatch) {
        matched.push({
          tag: el.tagName,
          id: id,
          class: typeof cls === 'string' ? cls : '',
          directText: directText.slice(0, 100),
          htmlSnippet: el.outerHTML.slice(0, 200)
        });
      }
    });

    // Remove the iframe
    iframe.remove();
    return matched;
  }, html);

  console.log(`\nFound ${results.length} elements containing 'apply' or 'applied':`);
  console.log(JSON.stringify(results.slice(0, 30), null, 2));

})().catch(console.error);
