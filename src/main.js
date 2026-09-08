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
const sharp = require('sharp');

// ── Remote debugging for Playwright ──────────────────────────
app.commandLine.appendSwitch('remote-debugging-port', '9222');

if (require('electron-squirrel-startup')) app.quit();

let mainWindow   = null;
let browserWindow = null;
let currentProc  = null;

const PROJECT_ROOT = app.getAppPath();
const DEFAULT_MODEL_OPTIONS = ['gpt-4o-mini', 'gpt-4o', 'o1-mini'];
const ALLOWED_CATEGORIES = ['Solar Monitoring System', 'Air Quality Monitors', 'IoT Gateway', 'Mobile Phones', 'Nokia Mobile Phones', 'Nokia E5', 'Nokia C5', 'BlackBerry KeyOne'];
const DEFAULT_CATEGORY = 'Air Quality Monitors';
const CONTROLLED_ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'DRY_RUN', 'PORT'];
const INDIAMART_MIN_IMAGE_DIMENSION = 1000;
const INDIAMART_NORMALIZED_IMAGE_DIMENSION = 1200;
const INDIAMART_SUPPORTED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

function uniqueNonEmpty(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))];
}

function normalizeConfig(config = {}) {
  const requestedCategory = typeof config.selectedCategory === 'string' ? config.selectedCategory.trim() : '';
  const normalized = {
    openaiApiKey: typeof config.openaiApiKey === 'string' ? config.openaiApiKey : '',
    openaiModel: typeof config.openaiModel === 'string' && config.openaiModel.trim() ? config.openaiModel.trim() : 'gpt-4o-mini',
    dailyTarget: Number.isFinite(parseInt(config.dailyTarget, 10)) ? parseInt(config.dailyTarget, 10) : 30,
    fixedPrice: Number.isFinite(parseInt(config.fixedPrice, 10)) ? parseInt(config.fixedPrice, 10) : 4999,
    dryRun: Boolean(config.dryRun),
    selectedPdf: typeof config.selectedPdf === 'string' ? config.selectedPdf : '',
    selectedPhotos: uniqueNonEmpty(config.selectedPhotos),
    selectedCategory: ALLOWED_CATEGORIES.includes(requestedCategory)
      ? requestedCategory
      : DEFAULT_CATEGORY,
    availableModels: uniqueNonEmpty(config.availableModels)
  };

  normalized.availableModels = uniqueNonEmpty([
    ...DEFAULT_MODEL_OPTIONS,
    ...normalized.availableModels,
    normalized.openaiModel
  ]);

  return normalized;
}

function readEnvFileValues(envPath) {
  if (!fs.existsSync(envPath)) {
    return {};
  }

  try {
    const dotenv = require('dotenv');
    return dotenv.parse(fs.readFileSync(envPath, 'utf-8'));
  } catch (error) {
    return {};
  }
}

function upsertEnvFile(envPath, updates) {
  const existingLines = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)
    : [];
  const preserved = [];
  const seen = new Set();

  existingLines.forEach(line => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/i);
    if (!match) {
      if (line.trim()) preserved.push(line);
      return;
    }

    const key = match[1];
    if (!CONTROLLED_ENV_KEYS.includes(key)) {
      preserved.push(line);
      return;
    }

    seen.add(key);
    const value = updates[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      preserved.push(`${key}=${value}`);
    }
  });

  CONTROLLED_ENV_KEYS.forEach(key => {
    if (seen.has(key)) return;
    const value = updates[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      preserved.push(`${key}=${value}`);
    }
  });

  fs.writeFileSync(envPath, `${preserved.join('\n').replace(/\n{3,}/g, '\n\n')}\n`);
}

function getUniqueDestinationPath(targetDir, originalName) {
  const parsed = path.parse(originalName);
  let candidate = path.join(targetDir, originalName);
  let counter = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(targetDir, `${parsed.name}-${counter}${parsed.ext}`);
    counter += 1;
  }

  return candidate;
}

function copyFileIntoProject(sourcePath, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  const resolvedSource = path.resolve(sourcePath);
  const initialTarget = path.join(targetDir, path.basename(resolvedSource));
  const destinationPath = fs.existsSync(initialTarget) && path.resolve(initialTarget) !== resolvedSource
    ? getUniqueDestinationPath(targetDir, path.basename(resolvedSource))
    : initialTarget;

  if (path.resolve(destinationPath) !== resolvedSource) {
    fs.copyFileSync(resolvedSource, destinationPath);
  }

  return destinationPath;
}

async function normalizeImageForIndiaMart(sourcePath, targetDir) {
  const resolvedSource = path.resolve(sourcePath);
  let metadata;
  try {
    metadata = await sharp(resolvedSource, { failOn: 'error' }).metadata();
  } catch (_error) {
    throw new Error(`Unable to read selected image: ${path.basename(resolvedSource)}`);
  }
  if (!metadata.width || !metadata.height) {
    throw new Error(`Selected image has invalid dimensions: ${path.basename(resolvedSource)}`);
  }

  const sourceSize = { width: metadata.width, height: metadata.height };
  const sourceExtension = path.extname(resolvedSource).toLowerCase();
  const mustResize = Math.max(sourceSize.width, sourceSize.height) < INDIAMART_MIN_IMAGE_DIMENSION;
  const mustConvert = !INDIAMART_SUPPORTED_IMAGE_EXTENSIONS.has(sourceExtension);

  if (!mustResize && !mustConvert) {
    return {
      path: copyFileIntoProject(resolvedSource, targetDir),
      changed: false,
      sourceSize,
      outputSize: sourceSize
    };
  }

  const scale = mustResize
    ? INDIAMART_NORMALIZED_IMAGE_DIMENSION / Math.max(sourceSize.width, sourceSize.height)
    : 1;
  const outputSize = {
    width: Math.max(1, Math.round(sourceSize.width * scale)),
    height: Math.max(1, Math.round(sourceSize.height * scale))
  };
  fs.mkdirSync(targetDir, { recursive: true });
  const sourceName = path.basename(resolvedSource, sourceExtension);
  const destinationPath = getUniqueDestinationPath(targetDir, `${sourceName}-indiamart.png`);
  let pipeline = sharp(resolvedSource, { failOn: 'error' });
  if (mustResize) {
    pipeline = pipeline.resize(outputSize.width, outputSize.height, { fit: 'fill', kernel: 'lanczos3' });
  }
  await pipeline.png({ compressionLevel: 9 }).toFile(destinationPath);

  return {
    path: destinationPath,
    changed: true,
    sourceSize,
    outputSize,
    converted: mustConvert,
    resized: mustResize
  };
}

function synchronizeQueueImages(queuePath, selectedPdf, selectedPhotos) {
  if (!fs.existsSync(queuePath)) return false;

  let queue;
  try {
    queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
  } catch (_error) {
    return false;
  }

  if (!Array.isArray(queue)) return false;

  const selectedPdfName = selectedPdf ? path.basename(selectedPdf) : '';
  let changed = false;
  queue.forEach(product => {
    if (selectedPdfName && product.pdfFile !== selectedPdfName) return;
    if (JSON.stringify(product.images || []) === JSON.stringify(selectedPhotos)) return;
    product.images = [...selectedPhotos];
    changed = true;
  });

  if (changed) {
    fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  }
  return changed;
}

async function prepareSelectedImagesForPipeline() {
  const configPath = path.join(PROJECT_ROOT, 'product-engine', 'config.json');
  const brochuresDir = path.join(PROJECT_ROOT, 'brochures');
  const existingConfig = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    : {};
  const config = normalizeConfig(existingConfig);

  if (config.selectedPhotos.length === 0) {
    throw new Error('Select at least one product photo before running the bot.');
  }

  const normalizedResults = await Promise.all(config.selectedPhotos.map(async photoPath => {
    if (!fs.existsSync(photoPath)) {
      throw new Error(`Selected image is missing: ${path.basename(photoPath)}`);
    }
    return await normalizeImageForIndiaMart(photoPath, brochuresDir);
  }));
  const selectedPhotos = uniqueNonEmpty(normalizedResults.map(result => result.path));
  config.selectedPhotos = selectedPhotos;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  synchronizeQueueImages(path.join(PROJECT_ROOT, 'product-queue.json'), config.selectedPdf, selectedPhotos);
  synchronizeQueueImages(path.join(PROJECT_ROOT, 'product-queue-filtered.json'), config.selectedPdf, selectedPhotos);

  return {
    selectedPhotos,
    normalizedCount: normalizedResults.filter(result => result.changed).length
  };
}

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
  let config = normalizeConfig();
  if (fs.existsSync(p)) {
    config = normalizeConfig(JSON.parse(fs.readFileSync(p, 'utf-8')));
  }
  // Load from .env if key is blank
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const envValues = readEnvFileValues(envPath);
    if (!config.openaiApiKey && envValues.OPENAI_API_KEY) {
      config.openaiApiKey = envValues.OPENAI_API_KEY.trim();
    }
    if (envValues.OPENAI_MODEL) {
      config.openaiModel = envValues.OPENAI_MODEL.trim();
    }
    if (envValues.DRY_RUN) {
      config.dryRun = envValues.DRY_RUN === 'true';
    }
  }
  return normalizeConfig(config);
});

// Save config
ipcMain.handle('dalvi:save-config', async (_e, { config }) => {
  const dir = path.join(PROJECT_ROOT, 'product-engine');
  const normalized = normalizeConfig(config);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(normalized, null, 2));

  // Preserve unrelated env keys while keeping bot settings in sync.
  const envPath = path.join(PROJECT_ROOT, '.env');
  upsertEnvFile(envPath, {
    OPENAI_API_KEY: normalized.openaiApiKey.trim(),
    OPENAI_MODEL: normalized.openaiModel.trim(),
    DRY_RUN: normalized.dryRun ? 'true' : 'false',
    PORT: '9222'
  });

  return true;
});

// Fetch live models
ipcMain.handle('dalvi:fetch-models', async (_e, apiKey) => {
  if (!apiKey || !apiKey.trim() || apiKey.startsWith('sk-xx')) {
    return DEFAULT_MODEL_OPTIONS;
  }
  try {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: apiKey.trim() });
    const response = await client.models.list();
    return uniqueNonEmpty(response.data
      .map(m => m.id)
      .filter(id => /^(gpt|o\d)/.test(id))
      .sort());
  } catch (err) {
    return DEFAULT_MODEL_OPTIONS;
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
  const destPath = copyFileIntoProject(pdfPath, brochuresDir);

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
    const envValues = readEnvFileValues(envPath);
    const apiKey = (envValues.OPENAI_API_KEY || '').trim();

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
    name: path.basename(destPath),
    storedPath: destPath,
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
  const copiedPaths = [];
  const seenSourcePaths = new Set();

  for (const filePath of result.filePaths) {
    const resolvedPath = path.resolve(filePath);
    if (seenSourcePaths.has(resolvedPath)) continue;

    seenSourcePaths.add(resolvedPath);
    const destPath = (await normalizeImageForIndiaMart(resolvedPath, brochuresDir)).path;

    if (!copiedPaths.includes(destPath)) {
      copiedPaths.push(destPath);
    }
  }

  send('bot:log', { type: 'info', text: `📸 Prepared ${copiedPaths.length} IndiaMART-ready photo(s).` });
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
    const nodeModulesPath = path.join(PROJECT_ROOT, 'node_modules');
    const proc = spawn(electronPath, step.args, {
      cwd: PROJECT_ROOT,
      env: { 
        ...process.env, 
        ELECTRON_RUN_AS_NODE: '1',
        NODE_PATH: nodeModulesPath
      },
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
  try {
    const preflight = await prepareSelectedImagesForPipeline();
    if (preflight.normalizedCount > 0) {
      send('bot:log', {
        type: 'info',
        text: `🖼️ Normalized ${preflight.normalizedCount} photo(s) to IndiaMART-compatible PNG files.`
      });
    }
  } catch (error) {
    send('bot:log', { type: 'error', text: `❌ Image preflight failed: ${error.message}` });
    send('bot:done', { error: true });
    return { error: error.message };
  }
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
  try {
    const preflight = await prepareSelectedImagesForPipeline();
    if (preflight.normalizedCount > 0) {
      send('bot:log', {
        type: 'info',
        text: `🖼️ Normalized ${preflight.normalizedCount} photo(s) to IndiaMART-compatible PNG files.`
      });
    }
  } catch (error) {
    send('bot:log', { type: 'error', text: `❌ Image preflight failed: ${error.message}` });
    send('bot:done', { error: true });
    return { error: error.message };
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
