const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'index.css'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');

assert.match(
  html,
  /id="resume-change"[^>]*>Change PDF<\/button>/,
  'The selected brochure must expose a visible Change PDF button'
);
assert.match(
  html,
  /id="resume-info"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<!-- Product Photos Card -->/,
  'The brochure card must close before the product photos card starts'
);
assert.match(css, /#resume-name\s*\{[\s\S]*?text-overflow:\s*ellipsis;/, 'Long brochure names must truncate');
assert.match(css, /\.resume-file\s*\{[\s\S]*?min-width:\s*0;/, 'The brochure row must be allowed to shrink');
assert.match(
  renderer,
  /resumeChangeBtn\.addEventListener\('click',\s*handleUpload\)/,
  'The Change PDF button must call the upload handler directly'
);
assert.match(renderer, /if \(pdfUploadInProgress\) return;/, 'Concurrent PDF dialogs must be prevented');

console.log('dashboard UI smoke test passed');
