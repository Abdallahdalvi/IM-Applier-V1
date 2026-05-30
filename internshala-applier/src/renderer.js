import './index.css';

/* ════════════════════════════════════════════════════════════
   Dalvi Renderer – Control Panel Logic (Material Design)
════════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

// ── State ────────────────────────────────────────────────────
let running = false;
const stats = { discovered: 0, filtered: 0, applied: 0, skipped: 0, errors: 0 };

// ── DOM Refs ─────────────────────────────────────────────────
const dropZone     = $('drop-zone');
const resumeInfo   = $('resume-info');
const resumeNameEl = $('resume-name');

const minSalary    = $('min-salary');
const openaiApiKey = $('openai-api-key');
const openaiModel  = $('openai-model');
const fetchModelsBtn = $('fetch-models-btn');
const locationInput = $('location');
const wfhCheck     = $('wfh-check');
const partTimeCheck = $('part-time-check');
const expRange     = $('exp-range');
const allowedKw    = $('allowed-kw');
const blockKw      = $('block-kw');
const appGoal      = $('app-goal');
const runBtn       = $('run-btn');
const stopBtn      = $('stop-btn');
const saveBtn      = $('save-btn');
const clearBtn     = $('clear-btn');
const browserBtn   = $('browser-btn');
const terminal     = $('terminal');
const statusChip   = $('status-chip');
const statusText   = $('status-text');
const saveToast    = $('save-toast');

// ── Load config on startup ───────────────────────────────────
async function loadConfig() {
  if (!window.dalvi) { log('⚠ Running outside Electron – IPC disabled.', 'warn'); return; }
  try {
    const cfg = await window.dalvi.getConfig('default');
    if (!cfg) return;
    minSalary.value       = cfg.minSalary || 300000;
    openaiApiKey.value    = cfg.openaiApiKey || '';
    const modelVal = cfg.openaiModel || 'gpt-5.4';
    if (!Array.from(openaiModel.options).some(o => o.value === modelVal)) {
      const opt = document.createElement('option');
      opt.value = modelVal;
      opt.textContent = modelVal;
      openaiModel.appendChild(opt);
    }
    openaiModel.value = modelVal;
    locationInput.value   = (cfg.location || '').toLowerCase();
    wfhCheck.checked      = cfg.workFromHome || false;
    partTimeCheck.checked = cfg.partTime || false;
    expRange.value        = cfg.experienceRange || '';
    allowedKw.value       = (cfg.allowedKeywords || []).join('\n');
    blockKw.value         = (cfg.blockKeywords   || []).join('\n');
    appGoal.value         = cfg.targetApplicationGoal || '';
  } catch (e) {
    log('⚠ Could not load config: ' + e.message, 'warn');
  }
}
loadConfig();

// ── PDF Upload ───────────────────────────────────────────────
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

    // Show resume info
    dropZone.style.display   = 'none';
    resumeInfo.style.display = 'block';
    resumeNameEl.textContent = result.name;


    log('📄 Resume uploaded: ' + result.name, 'success');

    // ── Apply AI suggestions if available ────────────────────
    if (result.ai) {
      const ai = result.ai;

      if (ai.allowedKeywords?.length) {
        allowedKw.value = ai.allowedKeywords.join('\n');
        markAiField('allowed-kw-label');
        log('🤖 AI suggested include keywords: ' + ai.allowedKeywords.join(', '), 'info');
      }

      if (ai.blockKeywords?.length) {
        blockKw.value = ai.blockKeywords.join('\n');
        markAiField('block-kw-label');
        log('🤖 AI suggested exclude keywords: ' + ai.blockKeywords.join(', '), 'info');
      }

      if (ai.goal) {
        appGoal.value = ai.goal;
        markAiField('goal-label');
        log('🤖 AI generated goal: ' + ai.goal, 'info');
      }

      if (ai.location) {
        locationInput.value = ai.location.toLowerCase();
      }

      if (ai.expectedSalary?.yearly) {
        minSalary.value = ai.expectedSalary.yearly;
      }
    } else {
      log('   Preview: ' + result.preview.slice(0, 100) + '…', 'out');
    }
  } catch (e) {
    log('❌ Upload failed: ' + e.message, 'error');
  }
}

function markAiField(labelId) {
  const el = document.getElementById(labelId);
  if (!el) return;
  // Remove existing badge
  const old = el.querySelector('.ai-parsed-badge');
  if (old) old.remove();
  const badge = document.createElement('span');
  badge.className = 'ai-parsed-badge';
  badge.textContent = '✨ AI';
  el.appendChild(badge);
}

// Resume change button
document.addEventListener('click', e => {
  if (e.target.id === 'resume-change') {
    dropZone.style.display   = 'block';
    resumeInfo.style.display = 'none';
    handleUpload();
  }
});

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
  const salaryRaw = minSalary.value.trim();
  const salary = salaryRaw === '' ? 0 : (parseInt(salaryRaw) || 0);
  return {
    minSalary:             salary,
    openaiApiKey:          openaiApiKey.value.trim(),
    openaiModel:           openaiModel.value,
    location:              locationInput.value,
    workFromHome:          wfhCheck.checked,
    partTime:              partTimeCheck.checked,
    experienceRange:       expRange.value,
    allowedKeywords:       allowedKw.value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 3),
    blockKeywords:         blockKw.value.split('\n').map(s => s.trim()).filter(Boolean),
    targetApplicationGoal: appGoal.value.trim(),
    availability:          'Immediate',
    noticePeriodDays:      0,
    expectedSalary:        { monthly: Math.round(salary / 12), yearly: salary },
  };
}

function showToast() {
  saveToast.style.display = 'flex';
  setTimeout(() => { saveToast.style.display = 'none'; }, 2500);
}

// ── Shared bot launcher ─────────────────────────────────────
async function launchBot(mode) {
  if (running) return;

  // Auto-save config first
  try {
    await window.dalvi.saveConfig('default', buildConfig());
  } catch(e) { /* non-fatal */ }

  running = true;
  setStatus('running');
  resetStats();

  // Clean listeners
  window.dalvi.offLog();
  window.dalvi.offDone();

  // Listen for log output
  window.dalvi.onLog(({ type, text }) => {
    log(text, type);
    parseStats(text);
  });

  // Listen for completion
  window.dalvi.onDone(({ error }) => {
    running = false;
    if (error) {
      setStatus('error');
      log('\n⛔ Bot stopped with errors.\n', 'error');
    } else {
      setStatus('done');
      log('\n🎉 Bot finished successfully!\n', 'success');
    }
  });

  let res;
  if (mode === 'apply') {
    log('\n🚀 Applying to saved jobs…\n', 'info');
    res = await window.dalvi.applyOnly('default');
  } else {
    log('\n⚡ Starting full Dalvi pipeline…\n', 'info');
    res = await window.dalvi.startBot('default');
  }

  if (res && res.error) {
    log('❌ ' + res.error, 'error');
    running = false;
    setStatus('error');
  }
}

// ── Run Bot (full pipeline) ─────────────────────────────────
runBtn.addEventListener('click', () => launchBot('full'));

// ── Apply Now (filter + apply only) ─────────────────────────
const applyBtn = $('apply-btn');
applyBtn.addEventListener('click', () => launchBot('apply'));

// ── Stop Bot ─────────────────────────────────────────────────
stopBtn.addEventListener('click', async () => {
  try {
    await window.dalvi.stopBot();
    running = false;
    setStatus('idle');
    log('\n⏹ Bot stopped by user.\n', 'warn');
  } catch(e) {
    log('❌ Stop failed: ' + e.message, 'error');
  }
});

// ── Browser Toggle ───────────────────────────────────────────
browserBtn.addEventListener('click', () => {
  window.dalvi.toggleBrowser();
});

// ── Clear Terminal ───────────────────────────────────────────
clearBtn.addEventListener('click', () => {
  terminal.innerHTML = '<div class="log-line log-info">Terminal cleared.</div>';
});

// ── Fetch OpenAI Models ──────────────────────────────────────
fetchModelsBtn.addEventListener('click', async () => {
  const key = openaiApiKey.value.trim();
  if (!key) {
    log('⚠ Please enter an OpenAI API Key first.', 'warn');
    return;
  }
  
  fetchModelsBtn.disabled = true;
  fetchModelsBtn.textContent = '⏳ ...';
  log('🔄 Fetching live models from OpenAI...', 'info');
  
  try {
    const list = await window.dalvi.fetchModels(key);
    if (list && list.length > 0) {
      // Clear existing options
      openaiModel.innerHTML = '';
      list.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        openaiModel.appendChild(opt);
      });
      log(`✅ Successfully loaded ${list.length} chat models from OpenAI`, 'success');
    } else {
      log('⚠ No chat models found in response.', 'warn');
    }
  } catch (e) {
    log('❌ Failed to fetch models: ' + e.message, 'error');
  } finally {
    fetchModelsBtn.disabled = false;
    fetchModelsBtn.textContent = '🔄 Fetch';
  }
});

// ── Helpers ──────────────────────────────────────────────────
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
    discovered: /TOTAL JOBS SAVED:\s*(\d+)/,
    filtered:   /Filtered jobs.*?:\s*(\d+)/,
    applied:    /applied\s*│\s*(\d+)/,
    skipped:    /skipped_disk\s*│\s*(\d+)/,
    errors:     /errors\s*│\s*(\d+)/,
  };
  let changed = false;
  for (const [key, rx] of Object.entries(matchers)) {
    const match = text.match(rx);
    if (match) { stats[key] = parseInt(match[1]); changed = true; }
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
