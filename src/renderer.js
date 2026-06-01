import './index.css';

/* ════════════════════════════════════════════════════════════
   IndiaMART Seller Bot Renderer UI Logic
   ════════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

// ── State ────────────────────────────────────────────────────
let running = false;
const stats = { discovered: 0, filtered: 0, applied: 0, skipped: 0, errors: 0 };

// ── DOM Refs ─────────────────────────────────────────────────
const dropZone          = $('drop-zone');
const resumeInfo        = $('resume-info');
const resumeNameEl      = $('resume-name');
const previewBox        = $('extracted-preview-box');
const previewName       = $('p-preview-name');
const previewCat        = $('p-preview-cat');
const previewPrice      = $('p-preview-price');

// Photos variables
let selectedPhotos = [];
const photosDropZone = $('photos-drop-zone');
const photosInfo = $('photos-info');
const photosCountEl = $('photos-count');

const openaiApiKey      = $('openai-api-key');
const openaiModel       = $('openai-model');
const fetchModelsBtn    = $('fetch-models-btn');
const dailyTarget       = $('daily-target');
const fixedPrice        = $('fixed-price');
const dryRunCheck       = $('dry-run-check');

const runBtn            = $('run-btn');
const applyBtn          = $('apply-btn');
const stopBtn           = $('stop-btn');
const saveBtn           = $('save-btn');
const clearBtn          = $('clear-btn');
const browserBtn        = $('browser-btn');
const terminal          = $('terminal');
const statusChip        = $('status-chip');
const statusText        = $('status-text');
const saveToast         = $('save-toast');

// ── Load config on startup ───────────────────────────────────
async function loadConfig() {
  if (!window.dalvi) {
    log('⚠️ Running outside Electron – IPC disabled.', 'warn');
    return;
  }
  try {
    const cfg = await window.dalvi.getConfig('default');
    if (!cfg) return;
    openaiApiKey.value   = cfg.openaiApiKey || '';
    dailyTarget.value    = cfg.dailyTarget || 30;
    fixedPrice.value     = cfg.fixedPrice || 4999;
    dryRunCheck.checked  = cfg.dryRun || false;
    $('selected-category').value = cfg.selectedCategory || 'Air Quality Monitors';

    const modelVal = cfg.openaiModel || 'gpt-4o-mini';
    if (!Array.from(openaiModel.options).some(o => o.value === modelVal)) {
      const opt = document.createElement('option');
      opt.value = modelVal;
      opt.textContent = modelVal;
      openaiModel.appendChild(opt);
    }
    openaiModel.value = modelVal;

    selectedPhotos = cfg.selectedPhotos || [];
    if (selectedPhotos.length > 0) {
      photosDropZone.style.display = 'none';
      photosInfo.style.display = 'block';
      photosCountEl.textContent = `${selectedPhotos.length} photos selected`;
    }
  } catch (e) {
    log('⚠️ Could not load config: ' + e.message, 'warn');
  }
}
loadConfig();

// ── PDF Brochure Upload ──────────────────────────────────────
dropZone.addEventListener('click', handleUpload);

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  handleUpload();
});

async function handleUpload() {
  try {
    const result = await window.dalvi.uploadPdf('default');
    if (!result) return;

    // Show PDF upload status
    dropZone.style.display   = 'none';
    resumeInfo.style.display = 'block';
    resumeNameEl.textContent = result.name;

    log('📄 Brochure uploaded: ' + result.name, 'success');

    // Show AI preview
    if (result.ai) {
      previewBox.style.display = 'block';
      previewName.textContent = result.ai.productName || 'N/A';
      previewCat.textContent = result.ai.categorySuggestion || 'N/A';
      previewPrice.textContent = result.ai.price ? `₹${result.ai.price} / ${result.ai.unit || 'Piece'}` : 'Not Specified';

      log('🤖 AI Extracted product details successfully.', 'success');
    } else {
      previewBox.style.display = 'none';
    }
  } catch (e) {
    log('❌ Upload failed: ' + e.message, 'error');
  }
}

// Brochure change button
document.addEventListener('click', e => {
  if (e.target.closest('#resume-change')) {
    handleUpload();
  } else if (e.target.closest('#photos-change')) {
    handlePhotosUpload();
  }
});

// Product Photos Upload
photosDropZone.addEventListener('click', handlePhotosUpload);
photosDropZone.addEventListener('dragover', e => {
  e.preventDefault();
  photosDropZone.classList.add('drag-over');
});
photosDropZone.addEventListener('dragleave', () => {
  photosDropZone.classList.remove('drag-over');
});
photosDropZone.addEventListener('drop', e => {
  e.preventDefault();
  photosDropZone.classList.remove('drag-over');
  handlePhotosUpload();
});

async function handlePhotosUpload() {
  try {
    const result = await window.dalvi.uploadPhotos();
    if (!result) return;

    selectedPhotos = result;
    photosDropZone.style.display = 'none';
    photosInfo.style.display = 'block';
    photosCountEl.textContent = `${result.length} photos selected`;

    log(`📸 ${result.length} product photos selected successfully.`, 'success');
  } catch (e) {
    log('❌ Photos selection failed: ' + e.message, 'error');
  }
}

// ── Save Settings ────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
  try {
    const config = buildConfig();
    await window.dalvi.saveConfig('default', config);
    showToast();
    log('💾 Settings saved successfully', 'success');
  } catch (e) {
    log('❌ Save failed: ' + e.message, 'error');
  }
});

function buildConfig() {
  return {
    openaiApiKey: openaiApiKey.value.trim(),
    openaiModel:  openaiModel.value,
    dailyTarget:  parseInt(dailyTarget.value) || 30,
    fixedPrice:   parseInt(fixedPrice.value) || 4999,
    dryRun:       dryRunCheck.checked,
    selectedPhotos: selectedPhotos,
    selectedCategory: $('selected-category').value
  };
}

function showToast() {
  saveToast.style.display = 'flex';
  setTimeout(() => { saveToast.style.display = 'none'; }, 2500);
}

// ── Pipeline runner interface ────────────────────────────────
async function launchBot(mode) {
  if (running) return;

  // Auto-save config first
  try {
    await window.dalvi.saveConfig('default', buildConfig());
  } catch(e) {}

  running = true;
  setStatus('running');
  resetStats();

  // Clean listeners
  window.dalvi.offLog();
  window.dalvi.offDone();

  // Listen for logs
  window.dalvi.onLog(({ type, text }) => {
    log(text, type);
    parseStats(text);
  });

  // Listen for completion
  window.dalvi.onDone(({ error }) => {
    running = false;
    if (error) {
      setStatus('error');
      log('\n⛔ Bot stopped due to errors.\n', 'error');
    } else {
      setStatus('done');
      log('\n🎉 Bot completed run successfully!\n', 'success');
    }
  });

  let res;
  if (mode === 'apply') {
    log('\n🚀 Starting Auto-Listing on IndiaMART seller panel...\n', 'info');
    res = await window.dalvi.applyOnly('default');
  } else {
    log('\n⚡ Launching full IndiaMART Seller pipeline...\n', 'info');
    res = await window.dalvi.startBot('default');
  }

  if (res && res.error) {
    log('❌ ' + res.error, 'error');
    running = false;
    setStatus('error');
  }
}

// ── Action Buttons ───────────────────────────────────────────
runBtn.addEventListener('click', () => launchBot('full'));
applyBtn.addEventListener('click', () => launchBot('apply'));

stopBtn.addEventListener('click', async () => {
  try {
    await window.dalvi.stopBot();
    running = false;
    setStatus('idle');
    log('\n⏹ Bot execution stopped by user.\n', 'warn');
  } catch(e) {
    log('❌ Stop failed: ' + e.message, 'error');
  }
});

browserBtn.addEventListener('click', () => {
  window.dalvi.toggleBrowser();
});

clearBtn.addEventListener('click', () => {
  terminal.innerHTML = '<div class="log-line log-info">Terminal console cleared.</div>';
});

// ── Fetch OpenAI Models ──────────────────────────────────────
fetchModelsBtn.addEventListener('click', async () => {
  const key = openaiApiKey.value.trim();
  if (!key) {
    log('⚠️ Please enter an OpenAI API Key first.', 'warn');
    return;
  }
  
  fetchModelsBtn.disabled = true;
  fetchModelsBtn.textContent = '⏳ ...';
  log('🔄 Fetching live chat models from OpenAI...', 'info');
  
  try {
    const list = await window.dalvi.fetchModels(key);
    if (list && list.length > 0) {
      openaiModel.innerHTML = '';
      list.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        openaiModel.appendChild(opt);
      });
      log(`✅ Successfully loaded ${list.length} chat models from OpenAI`, 'success');
    } else {
      log('⚠️ No chat models found in response.', 'warn');
    }
  } catch (e) {
    log('❌ Failed to fetch models: ' + e.message, 'error');
  } finally {
    fetchModelsBtn.disabled = false;
    fetchModelsBtn.textContent = '🔄 Fetch';
  }
});

// ── UI Helpers ───────────────────────────────────────────────
function setStatus(state) {
  statusChip.className = 'chip chip-' + state;
  runBtn.disabled   = state === 'running';
  applyBtn.disabled = state === 'running';
  stopBtn.disabled  = state !== 'running';

  const labels = { idle: 'Idle', running: 'Running…', done: 'Complete', error: 'Error' };
  statusText.textContent = labels[state] || 'Idle';
}

function resetStats() {
  Object.keys(stats).forEach(k => { stats[k] = 0; });
  updateStatsUI();
}

function updateStatsUI() {
  $('s-discovered').textContent = stats.discovered || '—';
  $('s-filtered').textContent   = stats.filtered   || '—';
  $('s-applied').textContent    = stats.applied    || '—';
  $('s-skipped').textContent    = stats.skipped    || '—';
  $('s-errors').textContent     = stats.errors     || '—';
}

function parseStats(text) {
  if (!text) return;
  const matchers = {
    discovered: /Found\s*(\d+)\s*PDF files/,
    filtered:   /Filtered queue contains\s*(\d+)\s*of/,
    applied:    /posted\s*│\s*(\d+)/,
    skipped:    /skipped_disk\s*│\s*(\d+)/,
    errors:     /errors\s*│\s*(\d+)/,
  };
  let changed = false;
  for (const [key, rx] of Object.entries(matchers)) {
    const match = text.match(rx);
    if (match) {
      stats[key] = parseInt(match[1]);
      changed = true;
    }
  }
  if (changed) updateStatsUI();
}

function log(text, type = 'out') {
  const div = document.createElement('div');
  div.className = 'log-line log-' + type;
  div.textContent = text;
  terminal.appendChild(div);
  terminal.scrollTop = terminal.scrollHeight;
}
