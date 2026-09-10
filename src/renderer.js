import './index.css';

/* ════════════════════════════════════════════════════════════
   IndiaMART Seller Bot Renderer UI Logic
   ════════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const ALLOWED_CATEGORIES = ['Solar Monitoring System', 'Air Quality Monitors', 'IoT Gateway', 'Mobile Phones', 'Nokia Mobile Phones', 'Nokia E5', 'Nokia C5', 'BlackBerry KeyOne', 'BlackBerry Classic Q20', 'Nokia Mobiles'];
const DEFAULT_CATEGORY = 'Air Quality Monitors';

// ── State ────────────────────────────────────────────────────
let running = false;
const stats = { discovered: 0, filtered: 0, applied: 0, skipped: 0, errors: 0 };
let selectedPdfPath = '';
let selectedPhotos = [];
let pdfUploadInProgress = false;
let configHydrated = false;
let autoSaveTimer = null;
let lastSavedConfigJson = '';
let saveQueue = Promise.resolve();
const DEFAULT_MODEL_OPTIONS = ['gpt-4o-mini', 'gpt-4o', 'o1-mini'];

// ── DOM Refs ─────────────────────────────────────────────────
const dropZone          = $('drop-zone');
const resumeInfo        = $('resume-info');
const resumeNameEl      = $('resume-name');
const resumeChangeBtn   = $('resume-change');
const previewBox        = $('extracted-preview-box');
const previewName       = $('p-preview-name');
const previewCat        = $('p-preview-cat');
const previewPrice      = $('p-preview-price');

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
const actionHint        = document.querySelector('.btn-hint');

applyBtn.title = 'Skips brochure parsing and lists the existing validated queue only.';
if (actionHint) {
  actionHint.textContent = '▶ = Discover + validate + list | 🚀 = List the existing validated queue only';
}

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
    const selectedCategory = ALLOWED_CATEGORIES.includes(cfg.selectedCategory)
      ? cfg.selectedCategory
      : DEFAULT_CATEGORY;
    $('selected-category').value = selectedCategory;

    const modelVal = cfg.openaiModel || 'gpt-4o-mini';
    setModelOptions(cfg.availableModels || DEFAULT_MODEL_OPTIONS, modelVal);

    selectedPdfPath = cfg.selectedPdf || '';
    if (selectedPdfPath) {
      dropZone.style.display = 'none';
      resumeInfo.style.display = 'block';
      resumeNameEl.textContent = selectedPdfPath.split(/[\\/]/).pop();
      resumeNameEl.title = selectedPdfPath;
    }

    selectedPhotos = cfg.selectedPhotos || [];
    if (selectedPhotos.length > 0) {
      photosDropZone.style.display = 'none';
      photosInfo.style.display = 'block';
      photosCountEl.textContent = `${selectedPhotos.length} photos selected`;
    }

    lastSavedConfigJson = JSON.stringify(buildConfig());
    configHydrated = true;
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
  if (pdfUploadInProgress) return;

  pdfUploadInProgress = true;
  resumeChangeBtn.disabled = true;
  resumeChangeBtn.textContent = 'Selecting...';

  try {
    const result = await window.dalvi.uploadPdf('default');
    if (!result) return;

    // Show PDF upload status
    selectedPdfPath = result.storedPath || '';
    dropZone.style.display   = 'none';
    resumeInfo.style.display = 'block';
    resumeNameEl.textContent = result.name;
    resumeNameEl.title = result.storedPath || result.name;

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

    scheduleAutoSave({ delay: 0, toastText: 'Brochure saved' });
  } catch (e) {
    log('❌ Upload failed: ' + e.message, 'error');
  } finally {
    pdfUploadInProgress = false;
    resumeChangeBtn.disabled = false;
    resumeChangeBtn.textContent = 'Change PDF';
  }
}

resumeChangeBtn.addEventListener('click', handleUpload);
$('photos-change').addEventListener('click', handlePhotosUpload);

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

    selectedPhotos = [...new Set(result)];
    photosDropZone.style.display = 'none';
    photosInfo.style.display = 'block';
    photosCountEl.textContent = `${selectedPhotos.length} photos selected`;
    scheduleAutoSave({ delay: 0, toastText: 'Photos saved' });

    log(`📸 ${selectedPhotos.length} product photos selected successfully.`, 'success');
  } catch (e) {
    log('❌ Photos selection failed: ' + e.message, 'error');
  }
}

// ── Save Settings ────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
  try {
    await persistConfig({ showToastMessage: true, toastText: 'Settings saved', logSuccess: false });
    log('💾 Settings saved successfully', 'success');
  } catch (e) {
    log('❌ Save failed: ' + e.message, 'error');
  }
});

function getCurrentModelOptions() {
  return [...new Set(Array.from(openaiModel.options)
    .map(option => option.value)
    .filter(Boolean))];
}

function setModelOptions(models, selectedValue) {
  const uniqueModels = [...new Set([...(models || []), ...DEFAULT_MODEL_OPTIONS, selectedValue].filter(Boolean))];
  openaiModel.innerHTML = '';

  uniqueModels.forEach(model => {
    const opt = document.createElement('option');
    opt.value = model;
    opt.textContent = model === 'gpt-4o-mini' ? `${model} (Default)` : model;
    openaiModel.appendChild(opt);
  });

  openaiModel.value = uniqueModels.includes(selectedValue) ? selectedValue : uniqueModels[0];
}

async function persistConfig({ showToastMessage = true, toastText = 'Settings saved', logSuccess = false } = {}) {
  if (!window.dalvi) return false;

  const nextJson = JSON.stringify(buildConfig());
  if (nextJson === lastSavedConfigJson) {
    return false;
  }

  saveQueue = saveQueue.catch(() => false).then(async () => {
    const latestConfig = buildConfig();
    const latestJson = JSON.stringify(latestConfig);
    if (latestJson === lastSavedConfigJson) {
      return false;
    }

    await window.dalvi.saveConfig('default', latestConfig);
    lastSavedConfigJson = latestJson;

    if (showToastMessage) {
      showToast(toastText);
    }
    if (logSuccess) {
      log('Settings saved successfully', 'success');
    }

    return true;
  });

  return saveQueue;
}

function scheduleAutoSave({ delay = 700, toastText = 'Auto-saved' } = {}) {
  if (!configHydrated) return;

  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    persistConfig({ showToastMessage: true, toastText }).catch((e) => {
      log('Auto-save failed: ' + e.message, 'error');
    });
  }, delay);
}

function buildConfig() {
  return {
    openaiApiKey: openaiApiKey.value.trim(),
    openaiModel:  openaiModel.value,
    dailyTarget:  parseInt(dailyTarget.value) || 30,
    fixedPrice:   parseInt(fixedPrice.value) || 4999,
    dryRun:       dryRunCheck.checked,
    selectedPdf:  selectedPdfPath,
    selectedPhotos: [...new Set(selectedPhotos)],
    selectedCategory: $('selected-category').value,
    availableModels: getCurrentModelOptions()
  };
}

function showToast(message = 'Settings saved') {
  saveToast.textContent = message;
  saveToast.style.display = 'flex';
  setTimeout(() => { saveToast.style.display = 'none'; }, 2500);
}

[
  openaiApiKey,
  dailyTarget,
  fixedPrice
].forEach((input) => {
  input.addEventListener('input', () => scheduleAutoSave());
});

[
  openaiModel,
  dryRunCheck,
  $('selected-category')
].forEach((input) => {
  input.addEventListener('change', () => scheduleAutoSave());
});

// ── Pipeline runner interface ────────────────────────────────
async function launchBot(mode) {
  if (running) return;

  // Auto-save config first
  try {
    await persistConfig({ showToastMessage: false });
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
    if (error || stats.errors > 0) {
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
      const selectedModel = list.includes(openaiModel.value) ? openaiModel.value : (list[0] || openaiModel.value);
      setModelOptions(list, selectedModel);
      await persistConfig({ showToastMessage: true, toastText: 'Models updated' });
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
  $('s-discovered').textContent = String(stats.discovered);
  $('s-filtered').textContent   = String(stats.filtered);
  $('s-applied').textContent    = String(stats.applied);
  $('s-skipped').textContent    = String(stats.skipped);
  $('s-errors').textContent     = String(stats.errors);
}

function parseStats(text) {
  if (!text) return;
  const matchers = {
    discovered: /Found\s*(\d+)\s*PDF file(?:s|\(s\))/,
    filtered:   /Filtered queue contains\s*(\d+)\s*of/,
    applied:    /posted\s*(?:│|\|)\s*(\d+)/,
    skipped:    /skipped(?:_no_form)?\s*\D+\s*(\d+)/,
    errors:     /errors\s*(?:│|\|)\s*(\d+)/,
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
