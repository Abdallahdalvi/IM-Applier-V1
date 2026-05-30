/**
 * main.js – Dalvi Electron Main Process
 *
 * Creates two windows:
 *  1. browserWindow  – loads internshala.com (Playwright attaches here via CDP port 9222)
 *  2. mainWindow     – the Dalvi control-panel UI
 *
 * All bot orchestration (spawn, stream logs) happens here so the scripts
 * always have access to port 9222 — fixing the ECONNREFUSED bug permanently.
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

/* ─────────────────────────────────────────────────────────────
   PROJECT ROOT — resolves correctly even when webpack bundles
   main.js to .webpack/main/index.js
───────────────────────────────────────────────────────────── */
const PROJECT_ROOT = app.getAppPath(); // resolves to resources/app when packaged

/* ─────────────────────────────────────────────────────────────
   WINDOW CREATION
───────────────────────────────────────────────────────────── */
function createWindows() {
  // 1. Browser window – CREATED FIRST so Playwright's pages()[0] finds it
  browserWindow = new BrowserWindow({
    width: 1050, height: 780,
    title: 'Dalvi Internshala Applier V2 - Browser',
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  browserWindow.loadURL('https://www.internshala.com');
  browserWindow.on('close', e => { e.preventDefault(); browserWindow.hide(); });

  // 2. Control panel
  mainWindow = new BrowserWindow({
    width: 1420, height: 900, minWidth: 1100, minHeight: 700,
    title: 'Dalvi Internshala Applier V2',
    backgroundColor: '#ffffff',
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

/* ─────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────── */
function userDir(user) {
  return path.join(PROJECT_ROOT, 'users', user || 'default');
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

/* ─────────────────────────────────────────────────────────────
   IPC HANDLERS
───────────────────────────────────────────────────────────── */

// get config
ipcMain.handle('dalvi:get-config', async (_e, user = 'default') => {
  const p = path.join(userDir(user), 'config.json');
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  return {
    minSalary: 300000,
    allowedKeywords: [],
    blockKeywords: [],
    targetApplicationGoal: '',
    availability: 'Immediate', location: 'Mumbai', noticePeriodDays: 0,
    experienceYears: { sales: 2, customer_support: 3, digital_marketing: 1 },
    expectedSalary: { monthly: 25000, yearly: 300000 },
  };
});

// save config
ipcMain.handle('dalvi:save-config', async (_e, { user, config }) => {
  const dir = userDir(user);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
  return true;
});

// fetch live models
ipcMain.handle('dalvi:fetch-models', async (_e, apiKey) => {
  if (!apiKey || !apiKey.trim()) throw new Error('API key is required to fetch models');
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: apiKey.trim() });
  const response = await client.models.list();
  const chatModels = response.data
    .map(m => m.id)
    .filter(id => id.startsWith('gpt') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('chatgpt'))
    .sort();
  return chatModels;
});

// pick & parse PDF  +  AI auto-extract keywords / goal
ipcMain.handle('dalvi:upload-pdf', async (_e, user = 'default') => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Resume PDF',
    properties: ['openFile'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;

  // ⚠ Use the internal lib path — the top-level require('pdf-parse') has a
  //   known side-effect that tries to open test/data/05-versions-space.pdf
  const pdfParse = require('pdf-parse/lib/pdf-parse.js');
  const dir = userDir(user);
  fs.mkdirSync(dir, { recursive: true });

  const buffer = fs.readFileSync(result.filePaths[0]);
  fs.writeFileSync(path.join(dir, 'resume.pdf'), buffer);

  const data = await pdfParse(buffer);
  let text = data.text.trim();

  // Scan PDF binary buffer for hyperlinks (like LinkedIn and Canva/Google Drive portfolio)
  try {
    const binaryStr = buffer.toString('binary');
    const matches = binaryStr.match(/https?:\/\/[^\s\)\(<>]+/g);
    if (matches) {
      const uniqueLinks = Array.from(new Set(matches));
      const linkedin = uniqueLinks.find(l => l.includes('linkedin.com/in/'));
      const portfolio = uniqueLinks.find(l => l.includes('canva.com/') || l.includes('drive.google.com/'));
      
      if (linkedin) {
        text = text.replace(/LinkedIn\b/gi, `LinkedIn: ${linkedin}`);
      }
      if (portfolio) {
        text = text.replace(/Portfolio\b/gi, `Portfolio: ${portfolio}`);
      }
    }
  } catch (err) {
    console.warn("Could not scan binary links:", err.message);
  }

  fs.writeFileSync(path.join(dir, 'resume.txt'), text);

  // ── AI: auto-extract keywords + goal + profile from resume ─
  let aiSuggestions = null;
  try {
    let fileApiKey = '';
    let fileModel = '';
    const configPath = path.join(dir, 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config) {
          if (config.openaiApiKey) fileApiKey = config.openaiApiKey.trim();
          if (config.openaiModel) fileModel = config.openaiModel.trim();
        }
      } catch (err) {}
    }

    require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });
    const apiKey = (process.env.OPENAI_API_KEY || fileApiKey || '').trim();
    const validKey = apiKey && apiKey !== 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

    if (validKey) {
      send('bot:log', { type: 'info', text: '🤖 AI is analysing your resume…' });
      const OpenAI = require('openai');
      const client = new OpenAI({ apiKey });
      const model  = (process.env.OPENAI_MODEL || fileModel || 'gpt-5.4').trim();

      const prompt = `
You are a career assistant. Read the resume below and extract job search data.

CRITICAL RULES FOR allowedKeywords:
- Generate EXACTLY 3 keywords (Internshala sidebar only accepts 3).
- Each keyword MUST be 2-3 words (compound role names). NEVER use single words.
- BAD examples: "social", "digital", "content", "media", "growth"
- GOOD examples: "social media", "digital marketing", "content writing", "graphic design", "seo executive"
- These become Internshala search URLs like /jobs/digital-marketing-jobs-in-mumbai/
- Pick the 3 keywords that BEST match the person's core skills and experience

Extract:
1. "allowedKeywords": EXACTLY 3 compound job search keywords (2-3 words each, lowercase)
2. "blockKeywords": 3–5 role types to AVOID (e.g. "telecaller", "data entry", "accountant")
3. "goal": One sentence (max 25 words) describing their target job, first person
4. "location": Their city from resume (lowercase, e.g. "mumbai")
5. "experienceYears": Object with skill areas and years, e.g. {"digital_marketing": 2}
6. "expectedSalary": {"monthly": number, "yearly": number} based on experience level

Respond with ONLY valid JSON:
{"allowedKeywords":[],"blockKeywords":[],"goal":"","location":"","experienceYears":{},"expectedSalary":{"monthly":0,"yearly":0}}

RESUME:
${text.slice(0, 4000)}
`.trim();

      const tokenParam = model.startsWith('gpt-5') || model.startsWith('o')
        ? { max_completion_tokens: 400 }
        : { max_tokens: 400 };

      const resp = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        ...tokenParam,
      });

      const raw = resp.choices[0].message.content.trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiSuggestions = JSON.parse(jsonMatch[0]);

        // ── AUTO-SAVE config so discovery script uses correct keywords ──
        const existingConfig = fs.existsSync(path.join(dir, 'config.json'))
          ? JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8'))
          : {};

        const merged = {
          ...existingConfig,
          allowedKeywords:       (aiSuggestions.allowedKeywords || existingConfig.allowedKeywords || []).slice(0, 3),
          blockKeywords:         aiSuggestions.blockKeywords   || existingConfig.blockKeywords   || [],
          targetApplicationGoal: aiSuggestions.goal            || existingConfig.targetApplicationGoal || '',
          location:              aiSuggestions.location        || existingConfig.location || 'mumbai',
          experienceYears:       aiSuggestions.experienceYears || existingConfig.experienceYears || {},
          expectedSalary:        aiSuggestions.expectedSalary  || existingConfig.expectedSalary || {},
          minSalary:             existingConfig.minSalary      || (aiSuggestions.expectedSalary?.yearly || 300000),
          availability:          existingConfig.availability   || 'Immediate',
          noticePeriodDays:      existingConfig.noticePeriodDays ?? 0,
        };

        fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(merged, null, 2));
        send('bot:log', { type: 'success', text: '✅ AI extracted keywords & goal — config saved!' });
        send('bot:log', { type: 'info', text: '🔑 Keywords: ' + (aiSuggestions.allowedKeywords || []).join(', ') });
        send('bot:log', { type: 'info', text: '🚫 Blocked:  ' + (aiSuggestions.blockKeywords || []).join(', ') });
        send('bot:log', { type: 'info', text: '🎯 Goal:     ' + (aiSuggestions.goal || '') });
      }
    } else {
      send('bot:log', { type: 'warn', text: '⚠ No OpenAI API key — keywords/goal not auto-filled. Add OPENAI_API_KEY to .env.' });
    }
  } catch (err) {
    send('bot:log', { type: 'warn', text: `⚠ AI extraction skipped: ${err.message}` });
  }

  return {
    name:    path.basename(result.filePaths[0]),
    preview: text.slice(0, 200),
    ai:      aiSuggestions,
  };
});

// show/hide internshala browser
ipcMain.handle('dalvi:toggle-browser', async () => {
  if (!browserWindow) return;
  if (browserWindow.isVisible()) {
    browserWindow.hide();
  } else {
    browserWindow.show();
    browserWindow.focus();
  }
});

// ── Shared pipeline runner ──────────────────────────────────
function runPipeline(steps, user = 'default') {
  if (currentProc) return { error: 'Already running' };

  const cwd = PROJECT_ROOT;
  const env = { ...process.env, DALVI_USER: user };

  const runStep = (i) => {
    if (i >= steps.length) {
      send('bot:log', { type: 'success', text: '\n✅  All steps complete!\n' });
      send('bot:done', {});
      currentProc = null;
      return;
    }
    const step = steps[i];
    send('bot:log', { type: 'header', text: `\n${'─'.repeat(40)}\n${step.label}\n${'─'.repeat(40)}\n` });

    const electronPath = process.execPath;
    const proc = spawn(electronPath, step.args, {
      cwd,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      shell: true
    });
    currentProc = proc;

    proc.stdout.on('data', d => send('bot:log', { type: 'out', text: d.toString() }));
    proc.stderr.on('data', d => send('bot:log', { type: 'err', text: d.toString() }));
    proc.on('close', code => {
      if (code === 0) { runStep(i + 1); }
      else {
        send('bot:log', { type: 'error', text: `\n❌  Step failed (exit ${code})\n` });
        send('bot:done', { error: true });
        currentProc = null;
      }
    });
  };

  runStep(0);
  return { started: true };
}

// start full pipeline: Prepare → Discover → Filter → Apply
ipcMain.handle('dalvi:start-bot', async (_e, user = 'default') => {
  return runPipeline([
    { label: '⚙️  Prepare', args: ['prepare-user.js'] },
    { label: '🔍  Discover', args: ['dalvi-internshala-discovery.js'] },
    { label: '🧹  Filter',   args: ['job-engine/job-filter.js'] },
    { label: '🚀  Apply',    args: ['job-engine/internshala-auto-apply.js'] },
  ], user);
});

// apply-only: Filter and Apply to already-discovered jobs
ipcMain.handle('dalvi:apply-only', async (_e, user = 'default') => {
  const queuePath = path.join(PROJECT_ROOT, 'job-queue.json');
  if (!fs.existsSync(queuePath)) {
    send('bot:log', { type: 'error', text: '❌ No discovered jobs found. Run the full bot first.' });
    send('bot:done', { error: true });
    return { error: 'No job-queue.json' };
  }
  const jobs = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
  send('bot:log', { type: 'info', text: `📋 Found ${jobs.length} previously discovered jobs` });

  return runPipeline([
    { label: '🧹  Filter',   args: ['job-engine/job-filter.js'] },
    { label: '🚀  Apply',    args: ['job-engine/internshala-auto-apply.js'] },
  ], user);
});

// stop bot — Windows needs taskkill to kill the process tree
ipcMain.handle('dalvi:stop-bot', async () => {
  if (currentProc) {
    const pid = currentProc.pid;
    currentProc = null;
    try {
      // Kill entire process tree on Windows
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: true });
      } else {
        process.kill(-pid, 'SIGKILL');
      }
    } catch (e) { /* process may already be dead */ }
    send('bot:done', {});
    return true;
  }
  return false;
});

/* ─────────────────────────────────────────────────────────────
   APP LIFECYCLE
───────────────────────────────────────────────────────────── */
app.whenReady().then(() => {
  createWindows();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindows(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
