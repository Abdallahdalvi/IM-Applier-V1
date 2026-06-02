/**
 * src/main.js – IndiaMART Seller Auto-Lister Electron Main Process
 *
 * Creates two windows:
 *  1. browserWindow  – loads seller.indiamart.com (Playwright attaches here via CDP port 9222)
 *  2. mainWindow     – the control-panel UI
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs   = require('fs');
const { spawn } = require('child_process');

// ── Remote debugging for Playwright ──────────────────────────
app.commandLine.appendSwitch('remote-debugging-port', '9222');

if (require('electron-squirrel-startup')) app.quit();

let mainWindow   = null;
let browserWindow = null;
let currentProc  = null;

const PROJECT_ROOT = app.getAppPath();

function createWindows() {
  // 1. Browser window – where the user logs in to IndiaMART
  browserWindow = new BrowserWindow({
    width: 1100, height: 800,
    title: 'IndiaMART Seller Portal - Login & Live Session',
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  browserWindow.loadURL('https://seller.indiamart.com/');
  browserWindow.on('close', e => { e.preventDefault(); browserWindow.hide(); });

  // 2. Main Control panel dashboard
  mainWindow = new BrowserWindow({
    width: 1420, height: 900, minWidth: 1100, minHeight: 700,
    title: 'IndiaMART Seller Auto-Lister Dashboard',
    backgroundColor: '#f8f9fa', // Material Design 3 Light Theme
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false,
    },
  });
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  mainWindow.on('closed', () => { browserWindow && browserWindow.destroy(); });
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

/* ─────────────────────────────────────────────────────────────
   IPC HANDLERS
   ───────────────────────────────────────────────────────────── */

// Load config
ipcMain.handle('dalvi:get-config', async (_e, user = 'default') => {
  const p = path.join(PROJECT_ROOT, 'product-engine', 'config.json');
  let config = {
    openaiApiKey: '',
    openaiModel: 'gpt-4o-mini',
    dailyTarget: 30,
    fixedPrice: 4999,
    dryRun: false
  };
  if (fs.existsSync(p)) {
    config = JSON.parse(fs.readFileSync(p, 'utf-8'));
  }
  // Load from .env if key is blank
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    if (!config.openaiApiKey && process.env.OPENAI_API_KEY) {
      config.openaiApiKey = process.env.OPENAI_API_KEY.trim();
    }
    if (process.env.OPENAI_MODEL) {
      config.openaiModel = process.env.OPENAI_MODEL.trim();
    }
    if (process.env.DRY_RUN) {
      config.dryRun = process.env.DRY_RUN === 'true';
    }
  }
  return config;
});

// Save config
ipcMain.handle('dalvi:save-config', async (_e, { config }) => {
  const dir = path.join(PROJECT_ROOT, 'product-engine');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));

  // Write/Update .env file to match config
  const envPath = path.join(PROJECT_ROOT, '.env');
  let envContent = '';
  if (config.openaiApiKey) envContent += `OPENAI_API_KEY=${config.openaiApiKey.trim()}\n`;
  if (config.openaiModel) envContent += `OPENAI_MODEL=${config.openaiModel.trim()}\n`;
  envContent += `DRY_RUN=${config.dryRun ? 'true' : 'false'}\n`;
  envContent += `PORT=9222\n`;
  fs.writeFileSync(envPath, envContent);

  return true;
});

// Fetch live models
ipcMain.handle('dalvi:fetch-models', async (_e, apiKey) => {
  if (!apiKey || !apiKey.trim() || apiKey.startsWith('sk-xx')) {
    return ['gpt-4o-mini', 'gpt-4o'];
  }
  try {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: apiKey.trim() });
    const response = await client.models.list();
    return response.data
      .map(m => m.id)
      .filter(id => id.startsWith('gpt') || id.startsWith('o1') || id.startsWith('o3'))
      .sort();
  } catch (err) {
    return ['gpt-4o-mini', 'gpt-4o'];
  }
});

// Upload Brochure PDF & extract details instantly
ipcMain.handle('dalvi:upload-pdf', async (_e) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Product Brochure / Datasheet PDF',
    properties: ['openFile'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;

  const pdfPath = result.filePaths[0];
  const brochuresDir = path.join(PROJECT_ROOT, 'brochures');
  fs.mkdirSync(brochuresDir, { recursive: true });

  const destPath = path.join(brochuresDir, path.basename(pdfPath));
  fs.copyFileSync(pdfPath, destPath);

  send('bot:log', { type: 'info', text: `📁 Copied brochure to project brochures/ directory` });

  // Parse text
  const pdfParse = require('pdf-parse/lib/pdf-parse.js');
  const buffer = fs.readFileSync(destPath);
  const data = await pdfParse(buffer);
  const text = data.text.trim();

  // Instant AI Extract
  let aiSuggestions = null;
  try {
    const envPath = path.join(PROJECT_ROOT, '.env');
    require('dotenv').config({ path: envPath });
    const apiKey = (process.env.OPENAI_API_KEY || '').trim();

    if (apiKey && !apiKey.startsWith('sk-xx')) {
      send('bot:log', { type: 'info', text: '🤖 Analysing brochure with OpenAI...' });
      const { extractProductDetails } = require('./ai-helper');
      aiSuggestions = await extractProductDetails(text);
      send('bot:log', { type: 'success', text: `✅ Extracted details for: "${aiSuggestions.productName}"` });
    } else {
      send('bot:log', { type: 'warn', text: '⚠️ No valid OpenAI API key configured. Immediate AI extraction skipped.' });
    }
  } catch (err) {
    send('bot:log', { type: 'warn', text: `⚠️ AI analysis skipped: ${err.message}` });
  }

  return {
    name: path.basename(pdfPath),
    preview: text.slice(0, 300),
    ai: aiSuggestions
  };
});

// Upload Product Photos
ipcMain.handle('dalvi:upload-photos', async (_e) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Product Photos',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Image Files', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;

  const brochuresDir = path.join(PROJECT_ROOT, 'brochures');
  fs.mkdirSync(brochuresDir, { recursive: true });

  const copiedPaths = [];
  result.filePaths.forEach(filePath => {
    const destPath = path.join(brochuresDir, path.basename(filePath));
    fs.copyFileSync(filePath, destPath);
    copiedPaths.push(destPath);
  });

  send('bot:log', { type: 'info', text: `📸 Copied ${copiedPaths.length} photos to project brochures/ directory` });
  return copiedPaths;
});

// Toggle browser visibility
ipcMain.handle('dalvi:toggle-browser', async () => {
  if (!browserWindow) return;
  if (browserWindow.isVisible()) {
    browserWindow.hide();
  } else {
    if (browserWindow.isMinimized()) browserWindow.restore();
    browserWindow.show();
    browserWindow.focus();
    // Force to foreground on Windows
    browserWindow.setAlwaysOnTop(true);
    browserWindow.setAlwaysOnTop(false);
  }
});

// Run pipeline runner
function runPipeline(steps) {
  if (currentProc) return { error: 'Bot is already running' };

  const runStep = (i) => {
    if (i >= steps.length) {
      send('bot:log', { type: 'success', text: '\n✅ Pipeline complete!\n' });
      send('bot:done', {});
      currentProc = null;
      return;
    }
    const step = steps[i];
    send('bot:log', { type: 'header', text: `\n${'─'.repeat(40)}\n${step.label}\n${'─'.repeat(40)}\n` });

    const electronPath = process.execPath;
    const proc = spawn(electronPath, step.args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      shell: false
    });
    currentProc = proc;

    proc.stdout.on('data', d => send('bot:log', { type: 'out', text: d.toString() }));
    proc.stderr.on('data', d => send('bot:log', { type: 'err', text: d.toString() }));
    proc.on('close', code => {
      if (code === 0) {
        runStep(i + 1);
      } else {
        send('bot:log', { type: 'error', text: `\n❌ Step failed (exit code ${code})\n` });
        send('bot:done', { error: true });
        currentProc = null;
      }
    });
  };

  runStep(0);
  return { started: true };
}

// Start full pipeline
ipcMain.handle('dalvi:start-bot', async () => {
  return runPipeline([
    { label: '🔍 Discover Products', args: ['indiamart-product-discovery.js'] },
    { label: '🧹 Validate & Filter', args: ['product-engine/product-filter.js'] },
    { label: '🚀 Auto-List on IndiaMART', args: ['product-engine/indiamart-auto-list.js'] }
  ]);
});

// Auto-list only
ipcMain.handle('dalvi:apply-only', async () => {
  const queuePath = path.join(PROJECT_ROOT, 'product-queue-filtered.json');
  if (!fs.existsSync(queuePath)) {
    send('bot:log', { type: 'error', text: '❌ No filtered product queue found. Run the full pipeline first.' });
    send('bot:done', { error: true });
    return { error: 'No product-queue-filtered.json' };
  }
  return runPipeline([
    { label: '🚀 Auto-List on IndiaMART', args: ['product-engine/indiamart-auto-list.js'] }
  ]);
});

// Stop listing process
ipcMain.handle('dalvi:stop-bot', async () => {
  if (currentProc) {
    const pid = currentProc.pid;
    currentProc = null;
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: true });
      } else {
        process.kill(-pid, 'SIGKILL');
      }
    } catch (e) {}
    send('bot:done', {});
    return true;
  }
  return false;
});

app.whenReady().then(() => {
  createWindows();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindows(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
