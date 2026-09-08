/**
 * Production-oriented IndiaMART auto-listing runner.
 *
 * The workflow is intentionally state-driven:
 *  1. Upload Assets
 *  2. Open Add Product
 *  3. Fill Product Form
 *  4. Upload Images
 *  5. Upload PDF
 *  6. Save And Continue
 *  7. Fill Category Attributes
 *  8. Final Submit
 *  9. Success Verification
 */

const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

require("dotenv").config();

const FILTERED_QUEUE_PATH = path.join(__dirname, "../product-queue-filtered.json");
const SKIP_REASONS_PATH = path.join(__dirname, "skip-reasons.json");
const CATEGORY_CONFIG_PATH = path.join(__dirname, "category-radio-config.json");

function resolveScratchRoot(environment = process.env) {
  const configuredPath = String(environment.DALVI_LOG_DIR || "").trim();
  if (configuredPath) return path.resolve(configuredPath);

  const userDataRoot = environment.LOCALAPPDATA || environment.APPDATA || os.tmpdir();
  return path.join(userDataRoot, "DalviBot", "logs");
}

const SCRATCH_ROOT = resolveScratchRoot();

const DRY_RUN = process.env.DRY_RUN === "true";
const CDP_PORT = process.env.PORT || "9222";
const DEFAULT_MAX_RETRIES = 3;
const IMAGE_READY_TIMEOUT_MS = 45000;
const IMAGE_MODAL_CLOSE_TIMEOUT_MS = 45000;
const IMAGE_VERIFICATION_TIMEOUT_MS = 45000;
const PDF_VERIFICATION_TIMEOUT_MS = 60000;
const ASSET_POLL_INTERVAL_MS = 1000;
const READY_STATE_SETTLE_MS = 2500;
const FILE_INPUT_BIND_TIMEOUT_MS = 90000;
const FILE_INPUT_VERIFY_TIMEOUT_MS = 12000;
const CROPPER_APPEAR_TIMEOUT_MS = 15000;

const configPath = path.join(__dirname, "config.json");
const config = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, "utf-8"))
  : {};

const fixedPrice = config.fixedPrice ? parseInt(config.fixedPrice, 10) : null;
const dailyTarget = config.dailyTarget ? parseInt(config.dailyTarget, 10) : null;
const selectedCategory = config.selectedCategory || null;
const CATEGORY_TARGET_ALIASES = {
  "Nokia E5": "Nokia Mobile Phones",
  "Nokia C5": "Nokia Mobile Phones",
  "BlackBerry KeyOne": "BlackBerry Mobile Phones"
};

const stats = {
  posted: 0,
  skipped_no_form: 0,
  errors: 0
};

const workflowStates = [
  "Upload Assets",
  "Open Add Product",
  "Fill Product Form",
  "Upload Images",
  "Upload PDF",
  "Save And Continue",
  "Fill Category Attributes",
  "Final Submit",
  "Success Verification"
];

const selectors = {
  addProduct: [
    ".MPSD_addCTA",
    "#addProduct",
    "xpath=//*[contains(@class, 'MPSD_addCTA')]",
    "xpath=//*[contains(@class, 'MPSD_addCTA')]/ancestor::*[self::a or self::button or @role='button'][1]",
    "button:has-text('Add Product')",
    "a:has-text('Add Product')",
    "span:has-text('Add Product')",
    "xpath=//*[self::button or self::a or self::span][contains(normalize-space(.), 'Add Product')]"
  ],
  title: [
    "#nameOfProduct",
    "input[name='product_name']",
    "input[name='name']",
    "input[name='product_add_name']",
    "input[placeholder*='Product Name' i]",
    "input[placeholder*='Product/Service Name' i]"
  ],
  category: [
    "input[name='category']",
    "input[placeholder*='category' i]",
    "input[id*='category']"
  ],
  price: [
    "#priceOfProduct",
    "input[name='price']",
    "input[name='selling_price']",
    "input[id*='price']",
    "input[placeholder*='Price' i]"
  ],
  unit: [
    "#unitOfProduct",
    "input[name='unit']"
  ],
  shortDescription: [
    "textarea[name*='short' i]",
    "textarea[id*='short' i]",
    "input[name*='short' i]",
    "input[id*='short' i]"
  ],
  keywords: [
    "textarea[name*='keyword' i]",
    "textarea[id*='keyword' i]",
    "input[name*='keyword' i]",
    "input[id*='keyword' i]"
  ],
  descriptionTextarea: [
    "textarea[name='description']",
    "textarea[name='desc']",
    "textarea[id*='desc']",
    "textarea[placeholder*='description' i]"
  ],
  imageEntryPoints: [
    "#editProductPopup .MPSD_prdimgwh a",
    "#editProductPopup .MPSD_prdimgwh",
    "#editProductPopup .MPSD_imgcont .MPSD_PRImg",
    "#editProductPopup a:has-text('Add Photo')",
    "#editProductPopup span:has-text('Add Photo')",
    "#editProductPopup p:has-text('Add Photo')"
  ],
  imageFileInputs: [
    "#multipleImageUploader",
    "input[type='file'][accept*='image']",
    "input[type='file'][multiple]"
  ],
  pdfButtons: [
    "#editProductPopup .actionPDF",
    "#editProductPopup .pdfBlog",
    "#editProductPopup button:has-text('Add PDF')",
    "#editProductPopup a:has-text('Add PDF')",
    "#editProductPopup span:has-text('Add PDF')",
    "#editProductPopup p:has-text('Add PDF')",
    ".actionPDF",
    ".pdfBlog",
    "button:has-text('Add PDF')",
    "a:has-text('Add PDF')",
    "span:has-text('Add PDF')",
    "p:has-text('Add PDF')"
  ],
  pdfFileInputs: [
    "input[type='file'][accept*='pdf']",
    "#addPDF"
  ],
  saveAndContinue: [
    "#saveBasic",
    ".MPSD_AdEditSVCon",
    "button:has-text('Save and Continue')",
    "button:has-text('Continue')",
    "button:has-text('Next')"
  ],
  finish: [
    "#save_isq",
    "button:has-text('Finish')",
    "a:has-text('Finish')"
  ]
};

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    return fallback;
  }
}

function saveJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function sanitizeIndiaMartTitle(value) {
  return String(value || "")
    .replace(/[|:;<>[\]{}!?@#$^*+=~`\\]+/g, " ")
    .replace(/\s*&\s*/g, " & ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 80);
}

function sanitizeIndiaMartDescription(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.)])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .trim()
    .slice(0, 1800);
}

function compactText(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

function normalizeUniquePaths(paths) {
  const seen = new Set();
  const normalized = [];

  for (const item of paths || []) {
    if (!item) continue;
    const resolved = path.resolve(item);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    normalized.push(resolved);
  }

  return normalized;
}

function toSafeFileFragment(value) {
  return String(value || "unknown")
    .replace(/[^a-z0-9-_]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "item";
}

function summarizeLogMeta(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > 180 ? `${value.slice(0, 177)}...` : value;
  }
  if (typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 5).map((entry) => summarizeLogMeta(entry, depth + 1));
    if (value.length > 5) {
      items.push(`... +${value.length - 5} more`);
    }
    return items;
  }

  const entries = Object.entries(value);
  if (depth >= 2) {
    return `[object ${entries.map(([key]) => key).slice(0, 6).join(", ")}${entries.length > 6 ? ", ..." : ""}]`;
  }

  const summarized = {};
  for (const [key, entry] of entries.slice(0, 12)) {
    summarized[key] = summarizeLogMeta(entry, depth + 1);
  }
  if (entries.length > 12) {
    summarized._truncatedKeys = entries.length - 12;
  }
  return summarized;
}

function createLogger(productId) {
  return (level, state, message, meta = null) => {
    const prefix = `[${new Date().toISOString()}] [${level}] [${productId}] [${state}]`;
    console.log(meta ? `${prefix} ${message} ${JSON.stringify(summarizeLogMeta(meta))}` : `${prefix} ${message}`);
  };
}

function isFatalListingError(error) {
  const message = String(error && error.message ? error.message : error || "").toLowerCase();
  return message.includes("not logged in")
    || message.includes("seller session")
    || message.includes("login page")
    || message.includes("target page, context or browser has been closed")
    || message.includes("browser has been closed")
    || message.includes("connection closed")
    || message.includes("has been closed");
}

async function waitForPageReady(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);
}

async function locatorVisible(locator) {
  try {
    return await locator.count() > 0 && await locator.first().isVisible();
  } catch (error) {
    return false;
  }
}

async function firstVisibleLocator(page, selectorList) {
  for (const selector of selectorList) {
    const locator = page.locator(selector).first();
    if (await locatorVisible(locator)) {
      return locator;
    }
  }

  return null;
}

async function readBlockingOverlayState(page) {
  return await page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };

    const blockingSelectors = [
      ".MPMisphotoScrn",
      ".AddPrPopup_wrp",
      "[class*='BannrPS']",
      ".SLC_pf.SLC_z999",
      "#dedupalert"
    ];

    const visibleBlockers = blockingSelectors.filter((selector) =>
      Array.from(document.querySelectorAll(selector)).some((element) => isVisible(element))
    );

    const visibleActions = Array.from(document.querySelectorAll("button, a, span"))
      .filter((element) => isVisible(element))
      .map((element) => normalize(element.innerText || element.getAttribute("aria-label") || element.getAttribute("title")))
      .filter((text) => text && /done|close|cancel|no|ok/.test(text))
      .slice(0, 8);

    return {
      blocking: visibleBlockers.length > 0,
      visibleBlockers,
      visibleActions
    };
  }).catch(() => ({
    blocking: false,
    visibleBlockers: [],
    visibleActions: []
  }));
}

async function injectIndiaMartGlobals(page) {
  const bootstrap = () => {
    if (typeof window.userDataCookie !== "function") {
      window.userDataCookie = function userDataCookie() {
        if (!(this instanceof window.userDataCookie)) {
          return new window.userDataCookie();
        }

        this.get = () => "";
        this.set = () => "";
        this.remove = () => {};
      };
      window.userDataCookie.get = () => "";
      window.userDataCookie.set = () => "";
      window.userDataCookie.remove = () => {};
    }
    if (typeof window.itemIdOfProduct === "undefined") {
      window.itemIdOfProduct = "";
    }
    if (typeof window.primeMcatIdOfProduct === "undefined") {
      window.primeMcatIdOfProduct = "";
    }
  };

  await page.addInitScript(bootstrap).catch(() => {});
  await page.evaluate(bootstrap).catch(() => {});
}

async function clearCodexEditorBridge(page) {
  return await page.evaluate(() => {
    if (typeof window.callbackForEditor === "function" && window.callbackForEditor.__codexEditorBridge) {
      try {
        delete window.callbackForEditor;
      } catch (error) {
        window.callbackForEditor = undefined;
      }
    }

    try {
      delete window.__codexEditorBridgeState;
    } catch (error) {
      window.__codexEditorBridgeState = undefined;
    }

    return {
      callbackForEditorType: typeof window.callbackForEditor,
      saveImagesToAddScreenType: typeof window.saveImagesToAddScreen
    };
  }).catch(() => ({
    callbackForEditorType: "unknown",
    saveImagesToAddScreenType: "unknown"
  }));
}

async function clearImageUploadRuntimeState(page, log, state, options = {}) {
  const { clearHiddenImages = false } = options;
  const result = await page.evaluate(({ shouldClearHiddenImages }) => {
    const parseHiddenImages = () => {
      const hidden = document.getElementById("changeImageHidden");
      if (!hidden || !hidden.value) return [];
      try {
        const parsed = JSON.parse(hidden.value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    };

    const resetArray = (name) => {
      if (!Array.isArray(window[name])) {
        return 0;
      }

      const previousLength = window[name].length;
      window[name].length = 0;
      return previousLength;
    };

    const hidden = document.getElementById("changeImageHidden");
    const hiddenCountBefore = parseHiddenImages().length;
    if (shouldClearHiddenImages && hidden) {
      hidden.value = "[]";
    }

    let clearedInputCount = 0;
    const inputSelectors = [
      "#multipleImageUploader",
      "input[type='file'][accept*='image']",
      "input[type='file'][multiple]"
    ];
    const seenInputs = new Set();
    for (const selector of inputSelectors) {
      for (const input of Array.from(document.querySelectorAll(selector))) {
        if (!(input instanceof HTMLInputElement) || seenInputs.has(input)) {
          continue;
        }
        seenInputs.add(input);
        if (input.value) {
          input.value = "";
          clearedInputCount += 1;
        }
      }
    }

    return {
      clearHiddenImages: shouldClearHiddenImages,
      hiddenCountBefore,
      clearedInputCount,
      cropperArrayCounts: {
        allUploadedImagesIMCropper: resetArray("allUploadedImagesIMCropper"),
        multipleImageIMCropperSuccessArr: resetArray("multipleImageIMCropperSuccessArr"),
        multipleImageIMCropperFailureArr: resetArray("multipleImageIMCropperFailureArr")
      }
    };
  }, { shouldClearHiddenImages: clearHiddenImages }).catch(() => null);

  if (result) {
    log("INFO", state, "Cleared stale IndiaMART image runtime state", result);
  }

  return result;
}

async function readImageUploadContext(page) {
  return await page.evaluate(() => ({
    callbackForEditorType: typeof window.callbackForEditor,
    saveImagesToAddScreenType: typeof window.saveImagesToAddScreen,
    modeOfOperation: window.initOptions?.modeOfOperation || null,
    imageId: window.initOptions?.imageId || null,
    cropperVisible: !!document.getElementById("im-crop-block")
  })).catch(() => ({
    callbackForEditorType: "unknown",
    saveImagesToAddScreenType: "unknown",
    modeOfOperation: null,
    imageId: null,
    cropperVisible: false
  }));
}

function parseScoreValue(text) {
  const match = String(text || "").match(/(\d+)\s*\/\s*(\d+)/);
  return match ? Number(match[1]) : 0;
}

async function findInputByLabelText(page, labelText, selector = "input, textarea, select") {
  const handle = await page.evaluateHandle(([text, selectorString]) => {
    const normalizedTarget = text.trim().toLowerCase();
    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };

    const isEditableField = (element) => {
      if (!isVisible(element) || element.disabled || element.readOnly) return false;

      const tag = element.tagName.toLowerCase();
      if (tag === "textarea" || tag === "select") return true;
      if (tag !== "input") return false;

      const blockedTypes = new Set([
        "hidden",
        "submit",
        "button",
        "reset",
        "image",
        "file",
        "radio",
        "checkbox"
      ]);

      const type = (element.getAttribute("type") || "text").toLowerCase();
      return !blockedTypes.has(type);
    };

    const nearestEditable = (root, labelElement) => {
      const labelRect = labelElement.getBoundingClientRect();
      const editableFields = Array.from(root.querySelectorAll(selectorString))
        .filter((element) => isEditableField(element));

      if (editableFields.length === 0) return null;

      editableFields.sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        const leftScore = Math.abs(leftRect.top - labelRect.top) + Math.abs(leftRect.left - labelRect.left);
        const rightScore = Math.abs(rightRect.top - labelRect.top) + Math.abs(rightRect.left - labelRect.left);
        return leftScore - rightScore;
      });

      return editableFields[0] || null;
    };

    const labels = Array.from(document.querySelectorAll("label, span, div, p, td, th"))
      .filter((element) => isVisible(element))
      .map((element) => ({
        element,
        text: (element.innerText || "").trim().toLowerCase()
      }))
      .filter(({ text: value }) => value === normalizedTarget || value.startsWith(normalizedTarget) || value.includes(normalizedTarget))
      .sort((left, right) => {
        const leftScore = left.text === normalizedTarget ? 0 : left.text.startsWith(normalizedTarget) ? 1 : 2;
        const rightScore = right.text === normalizedTarget ? 0 : right.text.startsWith(normalizedTarget) ? 1 : 2;
        if (leftScore !== rightScore) return leftScore - rightScore;
        return left.text.length - right.text.length;
      });

    for (const { element: matchingLabel } of labels) {
      const forAttr = matchingLabel.getAttribute("for");
      if (forAttr) {
        const linked = document.getElementById(forAttr);
        if (isEditableField(linked)) return linked;
      }

      const nested = nearestEditable(matchingLabel, matchingLabel);
      if (nested) return nested;

      let parent = matchingLabel.parentElement;
      let depth = 0;

      while (parent && depth < 4) {
        const candidate = nearestEditable(parent, matchingLabel);
        if (candidate) return candidate;
        parent = parent.parentElement;
        depth += 1;
      }
    }

    return null;
  }, [labelText, selector]);

  const element = handle.asElement();
  return element ? element : null;
}

async function elementHandleToLocator(page, handle) {
  if (!handle) return null;
  const id = await handle.evaluate((element) => {
    if (!element.id) {
      element.id = `codex-auto-${Math.random().toString(36).slice(2, 10)}`;
    }
    return element.id;
  });
  return page.locator(`#${id}`).first();
}

async function captureFailureArtifacts(page, runDir, state, attempt, error) {
  const stateKey = `${toSafeFileFragment(state)}_attempt-${attempt}`;
  const screenshotPath = path.join(runDir, `${stateKey}.png`);
  const htmlPath = path.join(runDir, `${stateKey}.html`);
  const jsonPath = path.join(runDir, `${stateKey}.json`);

  fs.mkdirSync(runDir, { recursive: true });

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 10000 });
  } catch (screenshotError) {}

  try {
    fs.writeFileSync(htmlPath, await page.content(), "utf-8");
  } catch (htmlError) {}

  try {
    fs.writeFileSync(jsonPath, JSON.stringify({
      capturedAt: new Date().toISOString(),
      state,
      attempt,
      url: page.url(),
      error: error ? error.message : null
    }, null, 2));
  } catch (jsonError) {}
}

async function runWithRetries({ page, runDir, state, log, attempts = DEFAULT_MAX_RETRIES, task }) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    log("INFO", state, `Starting attempt ${attempt} of ${attempts}`);
    try {
      const result = await task(attempt);
      log("INFO", state, `Attempt ${attempt} succeeded`);
      return result;
    } catch (error) {
      lastError = error;
      log("ERROR", state, `Attempt ${attempt} failed`, { error: error.message });
      await captureFailureArtifacts(page, runDir, state, attempt, error);
      if (attempt < attempts) {
        await page.waitForTimeout(1000 * attempt);
      }
    }
  }

  throw lastError;
}

async function dismissBlockingOverlays(page, log = null, state = "Overlay Guard", options = {}) {
  const { useEscape = true } = options;
  const dismissalSelectors = [
    ".MPMisphotoScrn button:has-text('Done')",
    ".MPMisphotoScrn button:has-text('Close')",
    ".MPMisphotoScrn button:has-text('Cancel')",
    ".MPMisphotoScrn button:has-text('No')",
    ".MPMisphotoScrn .close",
    ".MPMisphotoScrn [class*='close' i]",
    "[class*='BannrPS'] button:has-text('Done')",
    "[class*='BannrPS'] .BannrPS_clsbtn",
    ".AddPrPopup_wrp .close",
    ".AddPrPopup_wrp [class*='close' i]",
    ".AddPrPopup_wrp .BannrPS_clsbtn",
    ".AddPrPopup_wrp button:has-text('Done')",
    ".AddPrPopup_wrp button:has-text('Close')",
    ".AddPrPopup_wrp button:has-text('Cancel')",
    ".AddPrPopup_wrp button:has-text('No')",
    ".SLC_pf.SLC_z999 .close",
    ".SLC_pf.SLC_z999 [class*='close' i]",
    ".SLC_pf.SLC_z999 button:has-text('Close')",
    ".SLC_pf.SLC_z999 button:has-text('Cancel')",
    ".SLC_pf.SLC_z999 button:has-text('No')",
    ".SLC_pf.SLC_z999 button:has-text('Done')",
    "#dedupalert .close-button",
    "#dedupalert button:has-text('OK')",
    "#dedupalert button:has-text('Close')"
  ];

  const actions = [];
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    if (useEscape) {
      await page.keyboard.press("Escape").catch(() => {});
    }
    let clickedOnAttempt = false;

    for (const selector of dismissalSelectors) {
      const locator = page.locator(selector).first();
      if (!await locatorVisible(locator)) {
        continue;
      }

      await locator.click({ force: true, timeout: 2000 }).catch(async () => {
        await locator.evaluate((element) => element.click());
      }).catch(() => {});

      actions.push(selector);
      clickedOnAttempt = true;
      await page.waitForTimeout(250);
    }

    const overlayState = await readBlockingOverlayState(page);
    if (!overlayState.blocking && !clickedOnAttempt) {
      break;
    }

    if (!overlayState.blocking) {
      break;
    }

    await page.waitForTimeout(400);
  }

  if (actions.length > 0 && log) {
    log("INFO", state, "Dismissed blocking overlay controls", {
      actions: Array.from(new Set(actions))
    });
  }
}

async function isLoginPage(page) {
  return await page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const text = normalize(document.body.innerText || "");
    const url = normalize(window.location.href || "");
    const title = normalize(document.title || "");
    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const positiveSellerSignals = [
      "#addProduct",
      ".MPSD_addCTA",
      "a[href*='manageproducts']",
      ".MPSD_prdimgwh",
      ".MPSD_imgcont"
    ].some((selector) => document.querySelector(selector));

    if (positiveSellerSignals || text.includes("add product") || text.includes("quick add")) {
      return false;
    }

    if (url.includes("/login") || url.includes("/signin") || title.includes("sign in")) {
      return true;
    }

    const authInputsVisible = Array.from(document.querySelectorAll("input, textarea"))
      .filter((element) => isVisible(element))
      .some((element) => {
        const combined = normalize([
          element.name,
          element.id,
          element.placeholder,
          element.getAttribute("aria-label"),
          element.type
        ].join(" "));
        return /mobile|phone|otp|password|signin|login|verify/.test(combined);
      });

    const authActionVisible = Array.from(document.querySelectorAll("button, a, label, span, div"))
      .filter((element) => isVisible(element))
      .some((element) => {
        const combined = normalize([
          element.innerText,
          element.getAttribute("aria-label"),
          element.getAttribute("title")
        ].join(" "));
        return combined.includes("enter mobile number")
          || combined.includes("login with otp")
          || combined.includes("verify otp")
          || combined.includes("sign in")
          || combined.includes("log in")
          || combined.includes("continue with mobile");
      });

    return authInputsVisible && authActionVisible;
  });
}

async function waitForTitleField(page, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let locator = await firstVisibleLocator(page, selectors.title);
    if (locator) return locator;

    const handle = await findInputByLabelText(page, "Product Name", "input");
    if (handle) {
      locator = await elementHandleToLocator(page, handle);
      if (locator && await locatorVisible(locator)) {
        return locator;
      }
    }

    await page.waitForTimeout(500).catch(() => {});
  }

  return null;
}

async function waitForProductEditor(page, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const titleField = await waitForTitleField(page, 1200);
    if (titleField) {
      return {
        ready: true,
        signal: "title-field",
        locator: titleField
      };
    }

    const editorVisible = await locatorVisible(page.locator("#editProductPopup").first()).catch(() => false);
    const priceVisible = await firstVisibleLocator(page, selectors.price);
    const saveVisible = await firstVisibleLocator(page, selectors.saveAndContinue);
    if (editorVisible && (priceVisible || saveVisible)) {
      return {
        ready: true,
        signal: priceVisible ? "editor-with-price" : "editor-with-save",
        locator: titleField || null
      };
    }

    await page.waitForTimeout(500).catch(() => {});
  }

  return {
    ready: false,
    signal: "timeout",
    locator: null
  };
}

async function clickAddProductButton(page, locator) {
  await locator.evaluate((element) => {
    const target = element.closest("a, button, [role='button']") || element;
    target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  }).catch(() => {});

  try {
    await locator.click({ timeout: 5000 });
    return { strategy: "playwright-click" };
  } catch (error) {
    const fallback = await page.evaluate(() => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };

      const selectorsToTry = [
        "#addProduct",
        ".MPSD_addCTA"
      ];

      for (const selector of selectorsToTry) {
        const matches = Array.from(document.querySelectorAll(selector));
        for (const element of matches) {
          if (!isVisible(element)) {
            continue;
          }

          const clickable = element.closest("a, button, [role='button']") || element;
          clickable.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
          clickable.click();
          return {
            strategy: "dom-click",
            selector,
            tagName: clickable.tagName.toLowerCase()
          };
        }
      }

      const fallbackTarget = Array.from(document.querySelectorAll("a, button, div, span"))
        .find((element) => {
          if (!isVisible(element)) {
            return false;
          }

          const text = normalize(element.innerText || element.getAttribute("aria-label") || element.getAttribute("title"));
          return text.includes("add product");
        });

      if (!fallbackTarget) {
        return null;
      }

      const clickable = fallbackTarget.closest("a, button, [role='button']") || fallbackTarget;
      clickable.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      clickable.click();
      return {
        strategy: "dom-click",
        selector: "text:add product",
        tagName: clickable.tagName.toLowerCase()
      };
    });

    if (!fallback) {
      throw error;
    }

    return fallback;
  }
}

async function clickAddProductButtonWithFallbacks(page, locator, log, state) {
  const attempts = [
    {
      name: "playwright-click",
      run: async () => {
        await locator.click({ timeout: 5000 });
        return { strategy: "playwright-click" };
      }
    },
    {
      name: "force-click",
      run: async () => {
        await locator.click({ timeout: 5000, force: true });
        return { strategy: "force-click" };
      }
    },
    {
      name: "dom-dispatch",
      run: async () => {
        const result = await locator.evaluate((element) => {
          const target = element.closest("a, button, [role='button']") || element;
          target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });

          const mouseInit = { bubbles: true, cancelable: true, composed: true, view: window };
          const events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
          for (const type of events) {
            const ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
            target.dispatchEvent(new ctor(type, mouseInit));
          }

          return {
            strategy: "dom-dispatch",
            tagName: target.tagName.toLowerCase()
          };
        });
        return result;
      }
    },
    {
      name: "mouse-center-click",
      run: async () => {
        const box = await locator.boundingBox();
        if (!box) {
          throw new Error("Could not resolve Add Product button coordinates for mouse fallback.");
        }
        await page.mouse.click(box.x + (box.width / 2), box.y + (box.height / 2));
        return {
          strategy: "mouse-center-click",
          x: Math.round(box.x + (box.width / 2)),
          y: Math.round(box.y + (box.height / 2))
        };
      }
    }
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const clickMeta = await attempt.run();
      log("INFO", state, "Triggered Add Product click", clickMeta);

      const editorState = await waitForProductEditor(page, 6000);
      if (editorState.ready) {
        return {
          clickMeta,
          editorState
        };
      }

      lastError = new Error(`Editor did not appear after ${attempt.name}.`);
      log("INFO", state, "Add Product editor not visible yet after click strategy", {
        strategy: attempt.name
      });
    } catch (error) {
      lastError = error;
      log("INFO", state, "Add Product click strategy failed", {
        strategy: attempt.name,
        error: error.message
      });
    }
  }

  throw lastError || new Error("All Add Product click strategies failed.");
}

async function resolveAddProductTrigger(page) {
  let locator = await firstVisibleLocator(page, selectors.addProduct);
  if (!locator) {
    return null;
  }

  const normalizedText = normalizeText(await locator.innerText().catch(() => ""));
  if (normalizedText.includes("quick add") || normalizedText.includes("more options")) {
    const nestedCta = locator.locator(".MPSD_addCTA").first();
    if (await locatorVisible(nestedCta)) {
      locator = nestedCta;
    }
  }

  return locator;
}

async function openAddProduct(page, runDir, log) {
  const state = "Open Add Product";
  await injectIndiaMartGlobals(page);

  await page.goto("https://seller.indiamart.com/product/manageproducts/", {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });
  await waitForPageReady(page);
  await dismissBlockingOverlays(page, log, state, { useEscape: true });

  const alreadyOnEditor = await waitForProductEditor(page, 2000);
  if (alreadyOnEditor.ready) {
    log("INFO", state, "Product editor already visible before Add Product click", {
      signal: alreadyOnEditor.signal
    });
    return;
  }

  if (await isLoginPage(page)) {
    throw new Error("IndiaMART seller session is not logged in.");
  }

  await runWithRetries({
    page,
    runDir,
    state,
    log,
    task: async () => {
      await waitForPageReady(page);
      await dismissBlockingOverlays(page, log, state, { useEscape: true });
      const overlayState = await readBlockingOverlayState(page);
      if (overlayState.blocking) {
        log("INFO", state, "Blocking overlays detected before Add Product click", overlayState);
      }

      const editorBeforeClick = await waitForProductEditor(page, 1200);
      if (editorBeforeClick.ready) {
        log("INFO", state, "Product editor already active at attempt start", {
          signal: editorBeforeClick.signal
        });
        return;
      }

      const button = await resolveAddProductTrigger(page);
      if (!button) {
        throw new Error("Add Product button was not found via selector, text, or XPath fallback.");
      }

      await button.scrollIntoViewIfNeeded().catch(() => {});

      const clickResult = await clickAddProductButtonWithFallbacks(page, button, log, state);
      await dismissBlockingOverlays(page, log, state, { useEscape: false });
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      const editorState = clickResult.editorState.ready ? clickResult.editorState : await waitForProductEditor(page, 12000);
      if (!editorState.ready) {
        if (await isLoginPage(page)) {
          throw new Error("IndiaMART seller session is not logged in.");
        }
        throw new Error("Add Product page did not load after clicking the button.");
      }

      log("INFO", state, "Detected Add Product editor after click", {
        signal: editorState.signal
      });
    }
  });
}

async function fillInput(page, selectorList, value) {
  if (value === null || value === undefined || value === "") return false;

  let locator = await firstVisibleLocator(page, selectorList);
  if (!locator) {
    return false;
  }

  await locator.fill(String(value));
  return true;
}

async function fillInputByLabel(page, label, value) {
  if (value === null || value === undefined || value === "") return false;

  const handle = await findInputByLabelText(page, label);
  if (!handle) return false;

  const locator = await elementHandleToLocator(page, handle);
  if (!locator) return false;

  const tag = await locator.evaluate((element) => element.tagName.toLowerCase());
  if (tag === "select") {
    await locator.selectOption({ label: String(value) }).catch(async () => {
      await locator.selectOption(String(value)).catch(() => {});
    });
  } else {
    await locator.fill(String(value));
  }

  return true;
}

async function fillCategoryField(page, category) {
  if (!category) return false;

  let locator = await firstVisibleLocator(page, selectors.category);
  if (!locator) {
    const handle = await findInputByLabelText(page, "Category", "input");
    locator = await elementHandleToLocator(page, handle);
  }

  if (!locator) return false;

  await locator.fill(category);
  await page.waitForTimeout(1200);

  const suggestionHandle = await page.evaluateHandle((rawCategory) => {
    const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const desired = normalize(rawCategory);
    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };

    const candidates = Array.from(document.querySelectorAll(
      ".ui-menu-item, .ui-autocomplete li, [role='option'], .suggestion-list li, .category-suggestion"
    ))
      .filter((element) => isVisible(element))
      .map((element) => ({
        element,
        text: normalize(element.innerText)
      }))
      .filter(({ text }) => text)
      .sort((left, right) => {
        const leftScore = left.text === desired ? 0 : left.text.includes(desired) ? 1 : 2;
        const rightScore = right.text === desired ? 0 : right.text.includes(desired) ? 1 : 2;
        if (leftScore !== rightScore) return leftScore - rightScore;
        return left.text.length - right.text.length;
      });

    return candidates[0]?.element || null;
  }, category);
  const suggestion = await elementHandleToLocator(page, suggestionHandle.asElement());

  if (suggestion && await suggestion.count() > 0) {
    await suggestion.click({ delay: 100 });
  } else {
    await locator.press("Enter").catch(() => {});
    await locator.press("Tab").catch(() => {});
  }

  return true;
}

async function readSpecificationCategories(page) {
  return await page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const root = document.querySelector("#editProductPopup .mappedCatEditScreen");
    if (!root) return [];

    return Array.from(new Set(Array.from(root.querySelectorAll(".MPSD_Catopt a, .MPSD_Catopt li, a.MPSD_c5"))
      .map((element) => normalize(element.innerText))
      .filter(Boolean)));
  });
}

async function readCategoryPopupState(page) {
  return await page.evaluate(() => {
    const popup = document.getElementById("catpopup");
    const overlay = document.querySelector(".CatPop_overlay");
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };

    if (!popup || !isVisible(popup)) {
      return {
        visible: false,
        overlayVisible: !!overlay && isVisible(overlay),
        title: "",
        mappedCategories: [],
        suggestedCategories: [],
        saveVisible: false,
        errorText: ""
      };
    }

    const uniqueNames = (values) => Array.from(new Set(values.map((value) => normalize(value)).filter(Boolean)));
    const mappedCategories = uniqueNames(Array.from(
      popup.querySelectorAll("#old_catmap_rearrange input[data-mcatname], #old_catmap_rearrange h4")
    ).map((element) => element.getAttribute?.("data-mcatname") || element.innerText));
    const suggestedCategories = uniqueNames(Array.from(
      popup.querySelectorAll("#sugg_catmap_rearrange input[data-mcatname], #sugg_catmap_rearrange h4")
    ).map((element) => element.getAttribute?.("data-mcatname") || element.innerText));
    const saveButton = popup.querySelector("#savemcatpopbtn");
    const errorText = normalize(popup.querySelector("#savemcatErr")?.innerText || "");

    return {
      visible: true,
      overlayVisible: !!overlay && isVisible(overlay),
      title: normalize(popup.querySelector("#mcatnameoverflow")?.innerText || ""),
      mappedCategories,
      suggestedCategories,
      saveVisible: !!saveButton && isVisible(saveButton),
      errorText
    };
  });
}

async function ensureCategoryPopupContains(page, category) {
  if (!category) {
    return {
      found: false,
      selected: []
    };
  }

  return await page.evaluate((rawCategory) => {
    const popupRoot = document.getElementById("catpopup");
    const normalizeValue = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };

    if (!popupRoot || !isVisible(popupRoot)) {
      return {
        found: false,
        selected: []
      };
    }

    const desiredValue = normalizeValue(rawCategory);
    const categoryBoxes = Array.from(popupRoot.querySelectorAll("input[type='checkbox'][data-mcatname]"))
      .filter((input) => isVisible(input) || isVisible(input.closest("li")));
    const desiredBox = categoryBoxes.find((input) => normalizeValue(input.getAttribute("data-mcatname")) === desiredValue);

    const clickToggle = (input) => {
      const label = input.id ? popupRoot.querySelector(`label[for="${input.id}"]`) : null;
      if (label) {
        label.click();
      } else {
        input.click();
      }
    };

    if (!desiredBox) {
      return {
        found: false,
        selected: categoryBoxes.filter((input) => input.checked).map((input) => input.getAttribute("data-mcatname"))
      };
    }

    if (!desiredBox.checked) {
      clickToggle(desiredBox);
    }

    return {
      found: true,
      selected: categoryBoxes.filter((input) => input.checked).map((input) => input.getAttribute("data-mcatname"))
    };
  }, category);
}

async function resolveCategoryPopupSaveButton(page) {
  return await firstVisibleLocator(page, [
    "#savemcatpopbtn",
    "#catpopup a:has-text('Save')",
    "#catpopup button:has-text('Save')"
  ]);
}

async function handleReviewCategoryPopup(page, category, log, state) {
  const popupState = await readCategoryPopupState(page);
  if (!popupState.visible) {
    return false;
  }

  log("INFO", state, "Detected review category popup after submit", popupState);

  const normalizedTarget = normalizeText(category);
  const mappedAlready = popupState.mappedCategories.some((value) => normalizeText(value) === normalizedTarget);
  if (!mappedAlready) {
    const prepared = await ensureCategoryPopupContains(page, category);
    log("INFO", state, "Prepared review category popup selection", prepared);
    if (!prepared.found) {
      throw new Error(`Review category popup did not contain the expected category "${category}".`);
    }
  }

  const saveButton = await resolveCategoryPopupSaveButton(page);
  if (!saveButton) {
    throw new Error("Review category popup Save button was not found.");
  }

  await saveButton.click({ force: true }).catch(async () => {
    await saveButton.evaluate((element) => element.click());
  });

  const popup = page.locator("#catpopup").first();
  await popup.waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

  const finalPopupState = await readCategoryPopupState(page);
  if (finalPopupState.visible) {
    throw new Error(`Review category popup remained open after Save. State: ${JSON.stringify(finalPopupState)}`);
  }

  log("INFO", state, "Review category popup handled successfully", {
    category
  });
  return true;
}

async function dismissPostSubmitRecommendationPopup(page, log, state) {
  const popupVisible = await page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };

    return Array.from(document.querySelectorAll("strong, h1, h2, h3, div, span"))
      .filter((element) => isVisible(element))
      .some((element) => normalize(element.innerText).includes("additional products you can add to attract more buyers"));
  }).catch(() => false);

  if (!popupVisible) {
    return false;
  }

  const closeButton = await firstVisibleLocator(page, [
    ".AddPrPopup_wrp .BannrPS_clsbtn",
    "span.BannrPS_clsbtn",
    "xpath=//*[contains(@class, 'AddPrPopup_wrp')]//*[self::span or self::button][normalize-space(.)='×' or normalize-space(.)='x']"
  ]);

  if (!closeButton) {
    throw new Error("Post-submit recommendation popup was visible but the close button was not found.");
  }

  await closeButton.click({ force: true }).catch(async () => {
    await closeButton.evaluate((element) => element.click());
  });

  await page.waitForTimeout(500);
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  log("INFO", state, "Closed post-submit recommendation popup");
  return true;
}

async function waitForSpecificationLayout(page, rules, timeoutMs = 15000) {
  const sampleRules = (rules || [])
    .filter((rule) => rule && rule.questionText && rule.optionText)
    .slice(0, 2);

  if (sampleRules.length === 0) {
    return true;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let ready = true;

    for (const rule of sampleRules) {
      const locator = await resolveCategoryRuleLocator(page, rule);
      if (!locator || await locator.count() === 0) {
        ready = false;
        break;
      }
    }

    if (ready) {
      return true;
    }

    await page.waitForTimeout(1000);
  }

  return false;
}

async function ensureSpecificationCategory(page, category, rules, log, state) {
  if (!category) return;

  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const targetCategory = normalize(category);
  const currentCategories = await readSpecificationCategories(page);

  if (currentCategories.length > 0 && currentCategories.every((value) => normalize(value) === targetCategory)) {
    const layoutReady = await waitForSpecificationLayout(page, rules, 12000);
    if (layoutReady) {
      log("INFO", state, "Specification category already matches requested template", {
        categories: currentCategories
      });
      return;
    }

    log("INFO", state, "Specification labels match but expected rule layout is not ready yet", {
      categories: currentCategories
    });
  }

  log("INFO", state, "Correcting specification category", {
    desiredCategory: category,
    currentCategories
  });

  const editButton = await firstVisibleLocator(page, [
    "#editProductPopup .mappedCatEditScreen span[title='Edit Category']",
    "#editProductPopup .mappedCatEditScreen span.SLC_cp",
    "#editProductPopup .mappedCatEditScreen [title='Edit Category']"
  ]);

  if (!editButton) {
    throw new Error(`Specification category is not "${category}" and the edit control was not found.`);
  }

  await editButton.click({ force: true }).catch(async () => {
    await editButton.evaluate((element) => element.click());
  });

  const popup = page.locator("#catpopup.active, #catpopup").first();
  await popup.waitFor({ state: "visible", timeout: 10000 });

  const searchInput = page.locator("#catpopup input.CatPop_input, #catpopup input[placeholder='Search Category...']").first();
  await searchInput.waitFor({ state: "visible", timeout: 10000 });
  await searchInput.fill(category);

  const searchButton = await firstVisibleLocator(page, [
    "#catpopup .CatPop_srcC",
    "#catpopup .CatPop_srcIcn"
  ]);

  if (!searchButton) {
    throw new Error("Category search button was not found in the category popup.");
  }

  await searchButton.click({ force: true }).catch(async () => {
    await searchButton.evaluate((element) => element.click());
  });

  let foundDesiredCategory = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await page.evaluate((rawCategory) => {
      const normalizeValue = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
      const popupRoot = document.getElementById("catpopup");
      if (!popupRoot) return { found: false, selected: [] };

      const desiredValue = normalizeValue(rawCategory);
      const categoryBoxes = Array.from(popupRoot.querySelectorAll("input[type='checkbox'][data-mcatname]"));
      const desiredBox = categoryBoxes.find((input) => normalizeValue(input.getAttribute("data-mcatname")) === desiredValue);

      if (!desiredBox) {
        return {
          found: false,
          selected: categoryBoxes.filter((input) => input.checked).map((input) => input.getAttribute("data-mcatname"))
        };
      }

      const clickToggle = (input) => {
        const label = input.id ? popupRoot.querySelector(`label[for="${input.id}"]`) : null;
        if (label) {
          label.click();
        } else {
          input.click();
        }
      };

      for (const input of categoryBoxes) {
        const name = normalizeValue(input.getAttribute("data-mcatname"));
        if (input.checked && name !== desiredValue) {
          clickToggle(input);
        }
      }

      if (!desiredBox.checked) {
        clickToggle(desiredBox);
      }

      return {
        found: true,
        selected: categoryBoxes.filter((input) => input.checked).map((input) => input.getAttribute("data-mcatname"))
      };
    }, category);

    if (result.found) {
      foundDesiredCategory = true;
      log("INFO", state, "Prepared category popup selection", result);
      break;
    }

    await page.waitForTimeout(1000);
  }

  if (!foundDesiredCategory) {
    throw new Error(`Category popup did not return "${category}" as a selectable option.`);
  }

  const saveButton = await firstVisibleLocator(page, [
    "#savemcatpopbtn",
    "#catpopup a:has-text('Save')",
    "#catpopup button:has-text('Save')"
  ]);

  if (!saveButton) {
    throw new Error("Category popup Save button was not found.");
  }

  await saveButton.click({ force: true }).catch(async () => {
    await saveButton.evaluate((element) => element.click());
  });

  await popup.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

  let correctedCategories = currentCategories;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    correctedCategories = await readSpecificationCategories(page);
    if (correctedCategories.length > 0 && correctedCategories.every((value) => normalize(value) === targetCategory)) {
      const layoutReady = await waitForSpecificationLayout(page, rules, 15000);
      if (!layoutReady) {
        throw new Error(`Specification category switched to "${category}" but the expected specification options did not load.`);
      }

      log("INFO", state, "Specification category corrected", {
        categories: correctedCategories
      });
      await page.waitForTimeout(1000);
      return;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error(`Specification category remained ${JSON.stringify(correctedCategories)} after attempting to switch to "${category}".`);
}

async function fillUnit(page, unit) {
  if (!unit) return false;

  const locator = await firstVisibleLocator(page, selectors.unit);
  if (!locator) return false;

  await locator.click({ timeout: 3000 }).catch(() => {});
  const chip = page.locator(`li[title='${unit}'], #unitSugg li:has-text('${unit}')`).first();

  if (await locatorVisible(chip)) {
    await chip.click();
    return true;
  }

  await locator.fill(String(unit)).catch(async () => {
    await locator.evaluate((element, nextValue) => {
      element.value = nextValue;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, String(unit));
  });

  return true;
}

async function fillDescription(page, description) {
  if (!description) return false;

  const normalizedDescription = String(description).replace(/\r\n/g, "\n").trim();
  const htmlDescription = normalizedDescription
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${line.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
    .join("");

  const tinyResult = await page.evaluate(({ nextHtml, nextText }) => {
    const editorApi = window.tinyMCE || window.tinymce;
    const editor = editorApi?.get?.("item_desc") || editorApi?.activeEditor || null;

    if (!editor) {
      return null;
    }

    const dispatchFieldEvents = (target) => {
      if (!target) return;

      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
      target.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, key: "a" }));
      target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));
      target.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
      target.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    };

    editor.setContent(nextHtml);
    editor.save?.();
    editor.onChange?.dispatch?.(editor, { type: "change" });
    editor.onKeyUp?.dispatch?.(editor, { type: "keyup", keyCode: 65 });
    editor.fire?.("change");
    editor.fire?.("keyup");

    const textarea = document.getElementById("item_desc");
    if (textarea) {
      textarea.value = nextText;
      dispatchFieldEvents(textarea);
    }

    const hiddenDescription = document.getElementById("item_description");
    if (hiddenDescription) {
      hiddenDescription.value = nextText;
      dispatchFieldEvents(hiddenDescription);
    }

    const iframe = document.getElementById("item_desc_ifr");
    const iframeBody = iframe?.contentDocument?.body || null;
    if (iframeBody) {
      iframeBody.innerHTML = nextHtml;
      dispatchFieldEvents(iframeBody);
    }

    return {
      editorId: editor.id || null,
      textLength: String(editor.getContent({ format: "text" }) || "").trim().length,
      charCountText: document.getElementById("Charcount")?.innerText || ""
    };
  }, { nextHtml: htmlDescription, nextText: normalizedDescription }).catch(() => null);

  if (tinyResult) {
    await page.waitForTimeout(400);
    return true;
  }

  return await fillInput(page, selectors.descriptionTextarea, description);
}

async function fillSeoFields(page, product) {
  await fillInput(page, selectors.shortDescription, product.shortDescription || product.description);
  await fillInput(page, selectors.keywords, Array.isArray(product.keywords) ? product.keywords.join(", ") : "");
}

async function fillSpecificationRows(page, product) {
  const specifications = product.specifications || {};

  for (const [label, value] of Object.entries(specifications)) {
    if (!value) continue;

    const filledByLabel = await fillInputByLabel(page, label, value);
    if (filledByLabel) continue;

    const addButton = await firstVisibleLocator(page, [
      "button:has-text('Add Specification')",
      "button:has-text('Add Attribute')",
      "a:has-text('Add Specification')"
    ]);

    if (!addButton) continue;

    await addButton.click({ delay: 100 }).catch(() => {});
    await page.waitForTimeout(500);

    const keyInputs = page.locator("input[placeholder*='Spec' i], input[placeholder*='Attribute' i], input[id*='key'], input[name*='key']");
    const valueInputs = page.locator("input[placeholder*='Value' i], input[placeholder*='Val' i], input[id*='val'], input[name*='val']");

    const keyCount = await keyInputs.count();
    const valueCount = await valueInputs.count();

    if (keyCount > 0 && valueCount > 0) {
      await keyInputs.nth(keyCount - 1).fill(label);
      await valueInputs.nth(valueCount - 1).fill(String(value));
    }
  }
}

async function getDescriptionScore(page) {
  return await page.evaluate(() => {
    const popup = document.getElementById("editProductPopup");
    if (!popup) return 0;

    const text = Array.from(popup.querySelectorAll("li, p, span, div"))
      .map((element) => String(element.innerText || "").replace(/\s+/g, " ").trim())
      .find((value) => value.startsWith("Description (>100 chars)"));

    return parseInt((text || "").match(/(\d+)\/\d+/)?.[1] || "0", 10);
  });
}

async function waitForDescriptionScore(page, minimumScore = 1, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let latestScore = 0;

  while (Date.now() < deadline) {
    latestScore = await getDescriptionScore(page);
    if (latestScore >= minimumScore) {
      return latestScore;
    }
    await page.waitForTimeout(500);
  }

  return latestScore;
}

async function getSidebarScoreSummary(page) {
  return await page.evaluate(() => {
    const root = document.getElementById("editProductPopup") || document.body;
    const texts = Array.from(root.querySelectorAll("li, p, span, div"))
      .map((element) => String(element.innerText || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const readScore = (prefixes) => {
      const line = texts.find((text) => {
        return prefixes.some((prefix) => text.startsWith(prefix)) && /\d+\s*\/\s*\d+/.test(text);
      }) || "";
      const match = line.match(/(\d+)\s*\/\s*(\d+)/);

      return {
        text: line,
        value: match ? parseInt(match[1], 10) : 0,
        max: match ? parseInt(match[2], 10) : 0
      };
    };

    return {
      name: readScore(["Name (>=3 Words)", "Name"]),
      primaryPhoto: readScore(["Primary Photo"]),
      singlePhoto: readScore(["1 Photo"]),
      multiPhoto: readScore(["2 or More Photos"]),
      price: readScore(["Price (with unit)", "Price"]),
      description: readScore(["Description (>100 chars)", "Description"]),
      brochure: readScore(["Product Brochure (PDF)"]),
      configSpecs: readScore(["Config Specs."]),
      otherSpecs: readScore(["Other Specs."])
    };
  });
}

async function getWorkflowProgressSnapshot(page, product) {
  const requiredState = await readRequiredFieldState(page);
  const imageSummary = await getImageUploadSummary(page);
  const pdfSummary = await getPdfUploadSummary(page);
  const descriptionScore = await getDescriptionScore(page);
  const sidebar = await getSidebarScoreSummary(page);

  return {
    expectedImageCount: normalizeUniquePaths(product.images).length,
    requiredFieldLengths: {
      title: requiredState.title.length,
      price: requiredState.price.length,
      description: requiredState.description.length
    },
    descriptionScore,
    sidebar,
    imageSummary,
    pdfSummary
  };
}

async function logWorkflowProgressSnapshot(page, log, state, message, product) {
  const snapshot = await getWorkflowProgressSnapshot(page, product);
  log("INFO", state, message, snapshot);
  return snapshot;
}

function getImageReadiness(snapshot) {
  const hiddenImageReady = (
    snapshot.imageSummary.hiddenCount >= snapshot.expectedImageCount
    && (
      snapshot.imageSummary.primaryPhotoScore > 0
      || snapshot.sidebar.primaryPhoto.value > 0
      || snapshot.imageSummary.filledSlotCount > 0
    )
    && (
      snapshot.expectedImageCount <= 1
      || snapshot.imageSummary.multiPhotoScore > 0
      || snapshot.sidebar.multiPhoto.value > 0
      || snapshot.imageSummary.hiddenCount >= snapshot.expectedImageCount
    )
  );

  const scoreBasedImageReady = (
    (
      snapshot.imageSummary.primaryPhotoScore >= 10
      || snapshot.sidebar.primaryPhoto.value >= 10
    )
    && (
      snapshot.expectedImageCount <= 1
      || snapshot.imageSummary.multiPhotoScore >= 10
      || snapshot.sidebar.multiPhoto.value >= 10
    )
    && (
      snapshot.imageSummary.count > 0
      || snapshot.imageSummary.filledSlotCount > 0
      || snapshot.sidebar.primaryPhoto.value > 0
    )
  );

  return {
    hiddenImageReady,
    scoreBasedImageReady,
    ready: hiddenImageReady || scoreBasedImageReady
  };
}

function evaluatePersistedStepState(snapshot, product, options = {}) {
  const onPageTwo = Boolean(options.onPageTwo);
  const brochureVisible = Boolean(options.brochureVisible);
  const imageReadiness = getImageReadiness(snapshot);
  const pageTwoImageReady = onPageTwo && Number(snapshot.imageSummary.previewImageCount || 0) > 0;
  const imagesOk = imageReadiness.ready || pageTwoImageReady;
  const pageOneNameOk = snapshot.requiredFieldLengths.title > 0 || snapshot.sidebar.name.value > 0;
  const priceOk = !fixedPrice && !product.price
    ? true
    : (
      onPageTwo
        ? snapshot.sidebar.price.value > 0
        : snapshot.requiredFieldLengths.price > 0 || snapshot.sidebar.price.value > 0
    );
  const descriptionOk = onPageTwo
    ? snapshot.descriptionScore > 0 && snapshot.sidebar.description.value > 0
    : (
      snapshot.requiredFieldLengths.description > 0
      && snapshot.descriptionScore > 0
      && snapshot.sidebar.description.value > 0
    );
  const pdfOk = snapshot.pdfSummary.brochureScore > 0 || snapshot.sidebar.brochure.value > 0 || brochureVisible;

  // Once IndiaMART has actually moved to page 2, the name score in the sidebar is not reliable.
  // Treat the basic-details save as persisted when the other page-1 requirements remain credited.
  const nameOk = onPageTwo
    ? (
      snapshot.sidebar.name.value > 0
      || (priceOk && descriptionOk && imagesOk && pdfOk)
    )
    : pageOneNameOk;

  return {
    onPageTwo,
    nameOk,
    priceOk,
    descriptionOk,
    imagesOk,
    pdfOk,
    persistedOk: nameOk && priceOk && descriptionOk && imagesOk && pdfOk
  };
}

async function validatePersistedStepState(page, product) {
  const snapshot = await getWorkflowProgressSnapshot(page, product);
  const onPageTwo = await isPageTwoLoaded(page);
  const brochureVisible = snapshot.pdfSummary.tileLabels.some((label) => /view pdf|change pdf/i.test(label));
  const evaluation = evaluatePersistedStepState(snapshot, product, {
    onPageTwo,
    brochureVisible
  });

  return {
    snapshot,
    ...evaluation
  };
}

async function readRequiredFieldState(page) {
  return await page.evaluate(() => {
    const pickValue = (selectorsToTry) => {
      for (const selector of selectorsToTry) {
        const element = document.querySelector(selector);
        if (element && "value" in element) {
          return String(element.value || "").trim();
        }
      }
      return "";
    };

    const iframeBody = document.querySelector("#item_desc_ifr");
    let iframeText = "";
    try {
      iframeText = iframeBody && iframeBody.contentDocument && iframeBody.contentDocument.body
        ? iframeBody.contentDocument.body.innerText.trim()
        : "";
    } catch (error) {}

    return {
      title: pickValue(["#nameOfProduct", "input[name='product_name']", "input[name='name']", "input[name='product_add_name']"]),
      price: pickValue(["#priceOfProduct", "input[name='price']", "input[name='selling_price']"]),
      description: iframeText || pickValue(["#item_desc", "#item_description", "textarea[name='description']", "textarea[name='desc']", "textarea[id*='desc']"])
    };
  });
}

async function getImageUploadSummary(page) {
  return await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };

    const popup = document.getElementById("editProductPopup");
    const cropperRoot = document.querySelector("#im-crop-block, .popup-imcrp, [class*='crop' i]");
    const hiddenImages = (() => {
      const hidden = document.getElementById("changeImageHidden");
      if (!hidden || !hidden.value) return [];
      try {
        const parsed = JSON.parse(hidden.value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    })();
    const isInsideCropper = (element) => cropperRoot ? cropperRoot.contains(element) : false;
    const isPlaceholderImage = (value) => {
      const text = String(value || "").toLowerCase();
      return text.includes("addimage")
        || text.includes("camera")
        || text.includes("add photo")
        || text.includes("addimage-v1")
        || text.includes("gifs_new/addimage");
    };

    if (!popup) {
      return {
        count: 0,
        labels: [],
        filledSlotCount: 0,
        previewImageCount: 0,
        hiddenCount: hiddenImages.length,
        modalVisible: !!cropperRoot && isVisible(cropperRoot),
        modalThumbCount: cropperRoot ? cropperRoot.querySelectorAll("img").length : 0,
        primaryPhotoScore: 0,
        multiPhotoScore: 0
      };
    }

    const slotRoots = Array.from(
      popup.querySelectorAll(".MPSD_imgcont [data-index] .MPSD_PRImg")
    ).slice(0, 12);

    const thumbnails = slotRoots
      .map((slot) => slot.querySelector("img"))
      .filter((img) => isVisible(img) && !isInsideCropper(img))
      .map((img) => img.getAttribute("src") || img.getAttribute("alt") || "");

    const actualProductImages = thumbnails.filter((value) => value && !isPlaceholderImage(value));
    const previewImages = Array.from(popup.querySelectorAll(".primg_isq img, .MPSD_SPADpopwprimg img"))
      .filter((img) => isVisible(img) && !isInsideCropper(img))
      .map((img) => img.getAttribute("src") || img.getAttribute("alt") || "")
      .filter((value) => value && !isPlaceholderImage(value));
    const previewImageCount = new Set(previewImages).size;
    const filledSlotCount = slotRoots.filter((slot) => {
      const img = slot.querySelector("img");
      if (!img || !isVisible(img)) return false;
      const source = img.getAttribute("src") || "";
      const title = img.getAttribute("title") || "";
      const alt = img.getAttribute("alt") || "";
      return !isPlaceholderImage(source) && !isPlaceholderImage(title) && !isPlaceholderImage(alt);
    }).length;

    const uniqueThumbs = Array.from(new Set(actualProductImages.filter(Boolean)));
    const uniqueLabels = Array.from(new Set(slotRoots
      .map((slot) => {
        const img = slot.querySelector("img");
        return (img?.getAttribute("title") || img?.getAttribute("alt") || "").trim();
      })
      .filter((value) => value && !isPlaceholderImage(value))
    ));

    const primaryPhotoText = Array.from(popup.querySelectorAll("li, p, span, div"))
      .map((element) => (element.innerText || "").trim())
      .find((text) => text.startsWith("Primary Photo"));
    const secondaryPhotoText = Array.from(popup.querySelectorAll("li, p, span, div"))
      .map((element) => (element.innerText || "").trim())
      .find((text) => text.startsWith("2 or More Photos"));
    const modalThumbCount = cropperRoot ? cropperRoot.querySelectorAll("img").length : 0;

    return {
      count: Math.max(uniqueThumbs.length, uniqueLabels.length, filledSlotCount),
      labels: uniqueLabels,
      filledSlotCount,
      previewImageCount,
      hiddenCount: hiddenImages.length,
      modalVisible: !!cropperRoot && isVisible(cropperRoot),
      modalThumbCount,
      primaryPhotoScore: parseInt((primaryPhotoText || "").match(/(\d+)\/\d+/)?.[1] || "0", 10),
      multiPhotoScore: parseInt((secondaryPhotoText || "").match(/(\d+)\/\d+/)?.[1] || "0", 10)
    };
  });
}

async function syncUploadedImagesToAddScreen(page, log, state, expectedCount) {
  for (let nativeAttempt = 0; nativeAttempt < 8; nativeAttempt += 1) {
    const nativeSummary = await getImageUploadSummary(page);
    if (
      nativeSummary.count > 0
      || nativeSummary.filledSlotCount > 0
      || nativeSummary.primaryPhotoScore > 0
      || nativeSummary.multiPhotoScore > 0
    ) {
      log("INFO", state, "IndiaMART photo state updated without manual sync", nativeSummary);
      return {
        syncMethod: "native-page-callback",
        summary: nativeSummary
      };
    }
    await page.waitForTimeout(500);
  }

  const result = await page.evaluate(async (minimumCount) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const readHiddenImages = () => {
      const hidden = document.getElementById("changeImageHidden");
      if (!hidden || !hidden.value) return [];

      try {
        const parsed = JSON.parse(hidden.value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    };

    let hiddenImages = readHiddenImages();
    for (let attempt = 0; attempt < 20 && hiddenImages.length < minimumCount; attempt += 1) {
      await sleep(500);
      hiddenImages = readHiddenImages();
    }

    let syncMethod = "none";
    if (typeof window.callbackForEditor === "function" && hiddenImages.length > 0) {
      window.callbackForEditor({
        type: "add",
        imgs: hiddenImages,
        orderChange: false,
        bg_feedback: [],
        enhance_feedback: []
      });
      syncMethod = "callbackForEditor";
    } else if (typeof window.saveImagesToAddScreen === "function" && hiddenImages.length > 0) {
      window.saveImagesToAddScreen();
      syncMethod = "saveImagesToAddScreen";
    }

    return {
      hiddenCount: hiddenImages.length,
      callbackForEditorType: typeof window.callbackForEditor,
      saveImagesToAddScreenType: typeof window.saveImagesToAddScreen,
      syncMethod
    };
  }, expectedCount);

  log("INFO", state, "Synced uploaded images into the add-product screen", result);
  await page.waitForTimeout(1500);
  return result;
}

async function getPdfUploadSummary(page) {
  return await page.evaluate(() => {
    const popup = document.getElementById("editProductPopup");
    if (!popup) {
      return {
        count: 0,
        labels: [],
        brochureScore: 0,
        tileLabels: []
      };
    }

    const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const pdfTexts = Array.from(
      popup.querySelectorAll(".pdfBlog, .actionPDF, [id*='pdf' i], [class*='pdf' i], a, button, span, div, p")
    )
      .map((element) => normalizeText(element.innerText))
      .filter((text) => text && (/^(add|view|change)\s+pdf$/i.test(text) || /\.pdf$/i.test(text)));
    const brochureScoreText = Array.from(popup.querySelectorAll("li, p, span, div"))
      .map((element) => normalizeText(element.innerText))
      .find((text) => text.startsWith("Product Brochure (PDF)"));
    const pdfTileText = pdfTexts.filter((text) => /^(add|view|change)\s+pdf$/i.test(text));
    const pdfFileLabels = pdfTexts.filter((text) => /\.pdf$/i.test(text));

    return {
      count: pdfFileLabels.length + (pdfTileText.some((text) => /view pdf|change pdf/i.test(text)) ? 1 : 0),
      labels: Array.from(new Set(pdfFileLabels)),
      brochureScore: parseInt((brochureScoreText || "").match(/(\d+)\/\d+/)?.[1] || "0", 10),
      tileLabels: Array.from(new Set(pdfTileText))
    };
  });
}

async function getCropperSummary(page) {
  return await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };

    const modal = document.querySelector("#im-crop-block, .popup-imcrp, [class*='crop' i]");
    const loading = modal ? modal.querySelector("#iamgeloading") : null;
    const uploadButton = modal
      ? Array.from(modal.querySelectorAll("button")).find((button) => /upload photos/i.test(button.innerText || ""))
      : null;
    const thumbCards = modal
      ? Array.from(modal.querySelectorAll(".Thumb_crop, [class*='thumb' i]")).filter((element) => isVisible(element))
      : [];
    const queuedCards = thumbCards.filter((element) => {
      const text = (element.innerText || "").trim().toLowerCase();
      return !text.includes("more") && !element.classList.contains("Thumb_Noimage");
    });
    const loadingText = loading ? (loading.innerText || "").trim() : "";
    const uploadedImages = Array.isArray(window.allUploadedImagesIMCropper) ? window.allUploadedImagesIMCropper : [];
    const successImages = Array.isArray(window.multipleImageIMCropperSuccessArr) ? window.multipleImageIMCropperSuccessArr : [];
    const failedImages = Array.isArray(window.multipleImageIMCropperFailureArr) ? window.multipleImageIMCropperFailureArr : [];
    const summarizeAsset = (asset) => {
      if (!asset) return "";
      if (typeof asset === "string") {
        return asset.replace(/\s+/g, " ").trim();
      }

      if (typeof asset === "object") {
        const value = asset.name
          || asset.fileName
          || asset.filename
          || asset.originalName
          || asset.originalname
          || asset.imageName
          || asset.imgName
          || asset.path
          || asset.src
          || asset.url
          || asset.id
          || asset.imageId
          || "";
        return String(value).replace(/\s+/g, " ").trim();
      }

      return String(asset).replace(/\s+/g, " ").trim();
    };
    const reliableTotalQueuedCount = Math.max(queuedCards.length, uploadedImages.length, successImages.length);
    const moreCount = Math.max(0, reliableTotalQueuedCount - queuedCards.length);

    return {
      modalVisible: !!modal && isVisible(modal),
      loadingVisible: !!uploadButton && uploadButton.disabled || loadingText.length > 0,
      loadingText,
      uploadButtonVisible: !!uploadButton && isVisible(uploadButton),
      uploadButtonDisabled: !!uploadButton && uploadButton.disabled,
      uploadButtonText: uploadButton ? (uploadButton.innerText || "").trim() : "",
      queuedThumbCount: queuedCards.length,
      moreCount,
      totalQueuedCount: reliableTotalQueuedCount,
      selectedImageCount: uploadedImages.length,
      successImageCount: successImages.length,
      failedImageCount: failedImages.length,
      successImageLabels: Array.from(new Set(successImages.map(summarizeAsset).filter(Boolean))).slice(0, 10),
      failedImageLabels: Array.from(new Set(failedImages.map(summarizeAsset).filter(Boolean))).slice(0, 10)
    };
  });
}

function getCropperSelectionMagnitude(summary) {
  if (!summary) return 0;

  return Math.max(
    Number(summary.queuedThumbCount || 0),
    Number(summary.totalQueuedCount || 0),
    Number(summary.selectedImageCount || 0),
    Number(summary.successImageCount || 0)
  );
}

function isCropperSummaryCompatibleWithSelection(summary, expectedImageCount) {
  if (!summary || !summary.modalVisible) {
    return false;
  }

  if (expectedImageCount <= 0) {
    return true;
  }

  const queuedThumbCount = Number(summary.queuedThumbCount || 0);
  const totalQueuedCount = Number(summary.totalQueuedCount || 0);
  const selectedImageCount = Number(summary.selectedImageCount || 0);
  const successImageCount = Number(summary.successImageCount || 0);

  const oversized =
    queuedThumbCount > expectedImageCount
    || totalQueuedCount > expectedImageCount
    || selectedImageCount > expectedImageCount
    || successImageCount > expectedImageCount;

  if (oversized) {
    return false;
  }

  return (
    queuedThumbCount === expectedImageCount
    || selectedImageCount === expectedImageCount
    || successImageCount === expectedImageCount
  );
}

function evaluateCropperProcessingState(summary, expectedImageCount) {
  const expected = Math.max(0, Number(expectedImageCount || 0));
  const successCount = Math.max(0, Number(summary?.successImageCount || 0));
  const failedCount = Math.max(0, Number(summary?.failedImageCount || 0));
  const processedCount = successCount + failedCount;

  if (expected === 0) return { status: "ready", processedCount };
  if (processedCount < expected) return { status: "processing", processedCount };
  if (failedCount > 0) return { status: "failed", processedCount };
  if (successCount >= expected) return { status: "ready", processedCount };
  return { status: "processing", processedCount };
}

async function findCategoryOptionHandle(page, questionText, optionText) {
  const handle = await page.evaluateHandle(([rawQuestionText, rawOptionText]) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const compact = (value) => normalize(value).replace(/[^a-z0-9]+/g, "");
    const questionText = normalize(rawQuestionText);
    const optionText = normalize(rawOptionText);
    const compactQuestionText = compact(rawQuestionText);
    const compactOptionText = compact(rawOptionText);

    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };

    const matchesText = (fullText, compactText, targetText, compactTargetText) => {
      if (!targetText && !compactTargetText) return true;
      if (targetText && fullText.includes(targetText)) return true;
      if (compactTargetText && compactText.includes(compactTargetText)) return true;
      return false;
    };

    const resolveLinkedInput = (element) => {
      if (!element) return null;
      if (element.matches?.("input[type='radio'], input[type='checkbox']")) {
        return element;
      }

      const label = element.closest?.("label");
      if (label) {
        const forAttr = label.getAttribute("for");
        if (forAttr) {
          const linked = document.getElementById(forAttr);
          if (linked) return linked;
        }
        const nestedInput = label.querySelector("input[type='radio'], input[type='checkbox']");
        if (nestedInput) return nestedInput;
      }

      const nestedInput = element.querySelector?.("input[type='radio'], input[type='checkbox']");
      if (nestedInput) return nestedInput;

      return null;
    };

    const candidates = Array.from(document.querySelectorAll("label, span, div, button, li"))
      .filter((element) => isVisible(element))
      .map((element) => ({
        element,
        text: normalize(element.innerText),
        compactText: compact(element.innerText)
      }))
      .filter(({ text, compactText }) => text && matchesText(text, compactText, optionText, compactOptionText))
      .map(({ element, text, compactText }) => {
        let container = element;
        let depth = 0;

        while (container && depth < 8) {
          const containerText = normalize(container.innerText);
          const compactContainerText = compact(container.innerText);
          const questionMatches = matchesText(containerText, compactContainerText, questionText, compactQuestionText);
          const optionMatches = matchesText(containerText, compactContainerText, optionText, compactOptionText);
          if (questionMatches && optionMatches) {
            break;
          }
          container = container.parentElement;
          depth += 1;
        }

        if (!container || depth >= 8) {
          return null;
        }

        const linkedInput = resolveLinkedInput(element) || resolveLinkedInput(container);
        return {
          element,
          linkedInput,
          containerTextLength: normalize(container.innerText).length,
          exactMatchRank: text === optionText ? 2 : compactText === compactOptionText ? 1 : 0,
          textLength: text.length,
          isLabel: element.tagName === "LABEL",
          depth
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (left.exactMatchRank !== right.exactMatchRank) return right.exactMatchRank - left.exactMatchRank;
        if (left.isLabel !== right.isLabel) return left.isLabel ? -1 : 1;
        if (!!left.linkedInput !== !!right.linkedInput) return left.linkedInput ? -1 : 1;
        if (left.depth !== right.depth) return left.depth - right.depth;
        if (left.containerTextLength !== right.containerTextLength) return left.containerTextLength - right.containerTextLength;
        return left.textLength - right.textLength;
      });

    if (candidates.length === 0) {
      return null;
    }

    return candidates[0].element;
  }, [questionText, optionText]);

  const element = handle.asElement();
  return element ? element : null;
}

async function findFileInput(page, type, options = {}) {
  const selectorList = type === "image" ? selectors.imageFileInputs : selectors.pdfFileInputs;
  const { preferLast = false } = options;

  for (const selector of selectorList) {
    const locator = page.locator(selector);
    const count = await locator.count();
    if (count > 0) {
      return preferLast ? locator.nth(count - 1) : locator.first();
    }
  }

  return null;
}

async function getFileInputCandidates(page, type) {
  const selectorList = type === "image" ? selectors.imageFileInputs : selectors.pdfFileInputs;
  const candidates = [];

  for (const selector of selectorList) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let index = count - 1; index >= 0; index -= 1) {
      candidates.push({
        selector,
        index,
        locator: locator.nth(index)
      });
    }
  }

  return candidates;
}

async function dispatchFileInputEvents(locator) {
  await locator.evaluate((element) => {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }).catch(() => {});
}

async function waitForInputFilesCount(page, locator, expectedCount, timeoutMs = FILE_INPUT_VERIFY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastCount = 0;

  while (Date.now() < deadline) {
    try {
      lastCount = await locator.evaluate((element) => element.files?.length || 0);
      if (lastCount >= expectedCount) {
        return lastCount;
      }
    } catch (error) {}

    await page.waitForTimeout(250);
  }

  return lastCount;
}

async function setFilesOnActiveInput(page, type, filePaths, log, state) {
  const normalizedFilePaths = Array.isArray(filePaths) ? filePaths : [filePaths];
  const candidates = await getFileInputCandidates(page, type);
  if (candidates.length === 0) {
    throw new Error(`${type === "image" ? "Image" : "PDF"} file input was not found.`);
  }

  let lastError = null;
  for (let candidateNumber = 0; candidateNumber < candidates.length; candidateNumber += 1) {
    const candidate = candidates[candidateNumber];
    await candidate.locator.waitFor({ state: "attached", timeout: 3000 }).catch(() => {});

    const meta = await candidate.locator.evaluate((element) => ({
      tagName: element.tagName.toLowerCase(),
      id: element.id || null,
      name: element.getAttribute("name"),
      className: element.className || null,
      accept: element.getAttribute("accept"),
      multiple: !!element.multiple,
      disabled: !!element.disabled,
      connected: element.isConnected
    })).catch(() => ({
      tagName: "unknown",
      id: null,
      className: null,
      accept: null,
      multiple: false,
      disabled: false,
      connected: false
    }));

    if (!meta.connected || meta.disabled) {
      log("INFO", state, "Skipping unavailable upload input candidate", {
        type,
        selector: candidate.selector,
        candidateIndex: candidateNumber + 1,
        candidateOffset: candidate.index,
        totalCandidates: candidates.length,
        ...meta
      });
      continue;
    }

    try {
      const handle = await candidate.locator.elementHandle();
      if (!handle) {
        throw new Error("Upload input detached before files could be assigned.");
      }

      await handle.setInputFiles(normalizedFilePaths, { timeout: FILE_INPUT_BIND_TIMEOUT_MS });
      const observedFileCount = await waitForInputFilesCount(page, candidate.locator, normalizedFilePaths.length);
      if (observedFileCount < normalizedFilePaths.length) {
        throw new Error(`Upload input only retained ${observedFileCount} of ${normalizedFilePaths.length} selected file(s).`);
      }

      log("INFO", state, "Bound files to active upload input", {
        type,
        selector: candidate.selector,
        candidateIndex: candidateNumber + 1,
        candidateOffset: candidate.index,
        totalCandidates: candidates.length,
        observedFileCount,
        ...meta
      });
      return;
    } catch (error) {
      lastError = error;
      log("INFO", state, "Upload input candidate rejected file binding", {
        type,
        selector: candidate.selector,
        candidateIndex: candidateNumber + 1,
        candidateOffset: candidate.index,
        totalCandidates: candidates.length,
        error: error.message,
        ...meta
      });
    }
  }

  throw lastError || new Error(`Failed to bind ${type} files to any available upload input.`);
}

async function waitForImageUploadUiAfterSelection(page, log, state, expectedImageCount) {
  const deadline = Date.now() + CROPPER_APPEAR_TIMEOUT_MS;
  let lastStatusKey = null;
  let lastStatus = null;

  while (Date.now() < deadline) {
    const summary = await getImageUploadSummary(page).catch(() => null);
    const cropperSummary = summary?.modalVisible
      ? await getCropperSummary(page).catch(() => null)
      : null;

    const status = cropperSummary
      ? { phase: "cropper", ...cropperSummary }
      : summary
        ? { phase: "editor", ...summary }
        : null;

    const statusKey = JSON.stringify(status);
    if (statusKey !== lastStatusKey) {
      log("INFO", state, "Waiting for image upload UI after file selection", status);
      lastStatusKey = statusKey;
      lastStatus = status;
    }

    if (cropperSummary?.modalVisible) {
      return {
        cropperVisible: true,
        summary: cropperSummary
      };
    }

    if (
      summary
      && (
        summary.hiddenCount >= expectedImageCount
        || summary.count >= expectedImageCount
        || summary.filledSlotCount >= expectedImageCount
      )
    ) {
      return {
        cropperVisible: false,
        summary
      };
    }

    await page.waitForTimeout(500);
  }

  return {
    cropperVisible: false,
    summary: lastStatus
  };
}

async function initializeImageUploadContext(page, log, state) {
  const before = await readImageUploadContext(page);
  if (before.callbackForEditorType === "function") {
    log("INFO", state, "Image upload context already initialized", before);
    return before;
  }

  const trigger = await firstVisibleLocator(page, selectors.imageEntryPoints);
  if (!trigger) {
    log("INFO", state, "No image entry point was found before file selection", before);
    return before;
  }

  log("INFO", state, "Clicking image entry point to initialize IndiaMART photo callback flow", before);
  await trigger.click({ force: true, timeout: 5000 }).catch(async () => {
    await trigger.evaluate((element) => {
      const clickable = element.closest?.("a, button, label, div, span") || element;
      clickable.click?.();
    });
  });

  let after = before;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.waitForTimeout(250);
    after = await readImageUploadContext(page);
    if (after.callbackForEditorType === "function" || after.cropperVisible) {
      break;
    }
  }

  log("INFO", state, "Image upload context after entry-point click", after);
  return after;
}

async function dismissCropSavePrompt(page, log, state) {
  const prompt = page.locator("text=/save the cropped image/i").first();
  if (!(await locatorVisible(prompt))) return false;

  log("INFO", state, "Crop confirmation prompt detected");
  const noButton = await firstVisibleLocator(page, [
    "button:has-text('No')",
    "button:has-text('Cancel')",
    "span:has-text('No')"
  ]);

  if (!noButton) {
    throw new Error("Crop confirmation prompt appeared but the No/Cancel button was not found.");
  }

  await noButton.click({ force: true }).catch(async () => {
    await noButton.evaluate((element) => element.click());
  });
  await page.waitForTimeout(500);
  return true;
}

async function resetCropperModal(page, log, state) {
  const modal = page.locator("#im-crop-block, .popup-imcrp, [class*='crop' i]").first();
  if (!(await locatorVisible(modal))) {
    return false;
  }

  const summaryBeforeReset = await getCropperSummary(page).catch(() => null);
  log("INFO", state, "Resetting image cropper modal before reselecting files", summaryBeforeReset);

  const closeButton = await firstVisibleLocator(page, [
    "#im-crop-block .close-btn",
    "#im-crop-block .close-button",
    "#im-crop-block .close",
    "#im-crop-block [aria-label='Close']",
    "#im-crop-block [title='Close']",
    "#im-crop-block [class*='close' i]",
    ".popup-imcrp .close-btn",
    ".popup-imcrp .close-button",
    ".popup-imcrp .close",
    ".popup-imcrp [aria-label='Close']",
    ".popup-imcrp [title='Close']",
    ".popup-imcrp [class*='close' i]",
    "xpath=//*[@id='im-crop-block' or contains(@class,'popup-imcrp') or contains(@class,'crop')]//*[self::button or self::span or self::div or self::a][normalize-space(.)='×' or normalize-space(.)='x' or normalize-space(.)='Close']"
  ]);

  if (closeButton) {
    await closeButton.click({ force: true }).catch(async () => {
      await closeButton.evaluate((element) => {
        const clickable = element.closest?.("button, a, span, div") || element;
        clickable.click?.();
      });
    }).catch(() => {});
  } else {
    await page.keyboard.press("Escape").catch(() => {});
  }

  await page.evaluate(() => {
    const resetArray = (name) => {
      if (Array.isArray(window[name])) {
        window[name].length = 0;
      }
    };

    resetArray("allUploadedImagesIMCropper");
    resetArray("multipleImageIMCropperSuccessArr");
    resetArray("multipleImageIMCropperFailureArr");
  }).catch(() => {});

  await page.waitForTimeout(800);
  await modal.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

  if (await locatorVisible(modal)) {
    const stuckSummary = await getCropperSummary(page).catch(() => null);
    throw new Error(`Image cropper modal could not be reset. Current state: ${JSON.stringify(stuckSummary)}`);
  }

  return true;
}

async function waitForCropperReady(page, log, state, expectedImageCount) {
  const deadline = Date.now() + IMAGE_READY_TIMEOUT_MS;
  let lastSummary = null;

  while (Date.now() < deadline) {
    await dismissCropSavePrompt(page, log, state).catch(() => {});

    const summary = await getCropperSummary(page);
    const summaryKey = JSON.stringify(summary);
    if (summaryKey !== JSON.stringify(lastSummary)) {
      log("INFO", state, "Cropper readiness check", summary);
      lastSummary = summary;
    }

    if (!summary.modalVisible) {
      throw new Error("Image cropper modal disappeared before the upload button became ready.");
    }

    if (!isCropperSummaryCompatibleWithSelection(summary, expectedImageCount)) {
      const observedCount = getCropperSelectionMagnitude(summary);
      if (observedCount > expectedImageCount) {
        throw new Error(
          `Image cropper queued ${observedCount} image(s) for a ${expectedImageCount}-image upload.`
        );
      }
    }

    const queuedEnough = isCropperSummaryCompatibleWithSelection(summary, expectedImageCount);
    const processingState = evaluateCropperProcessingState(summary, expectedImageCount);
    if (processingState.status === "failed") {
      const failedLabels = summary.failedImageLabels?.length
        ? ` Failed files: ${summary.failedImageLabels.join(", ")}.`
        : "";
      throw new Error(
        `Image cropper finished with ${summary.failedImageCount} failed upload(s).${failedLabels}`
      );
    }
    if (
      queuedEnough
      && processingState.status === "ready"
      && !summary.loadingVisible
      && summary.uploadButtonVisible
      && !summary.uploadButtonDisabled
    ) {
      await page.waitForTimeout(READY_STATE_SETTLE_MS);
      return summary;
    }

    await page.waitForTimeout(ASSET_POLL_INTERVAL_MS);
  }

  throw new Error(`Image cropper never became ready. Last status: ${JSON.stringify(lastSummary)}`);
}

async function findCropperUploadButton(page) {
  const handle = await page.evaluateHandle(() => {
    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };

    const modal = document.querySelector("#im-crop-block, .popup-imcrp, [class*='crop' i]");
    if (!modal || !isVisible(modal)) {
      return null;
    }

    const candidates = Array.from(modal.querySelectorAll("button, a, div, span"))
      .filter((element) => isVisible(element))
      .map((element) => ({
        element,
        text: String(element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase()
      }))
      .filter(({ text }) => text === "upload photos" || text.includes("upload photos"));

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((left, right) => left.text.length - right.text.length);
    return candidates[0].element;
  });

  const element = handle.asElement();
  if (!element) {
    return null;
  }

  return await elementHandleToLocator(page, element);
}

async function handleCropperIfPresent(page, log, state, expectedImageCount = 1) {
  const modal = page.locator("#im-crop-block, .popup-imcrp, [class*='crop' i]").first();
  if (!(await locatorVisible(modal))) return;

  const readySummary = await waitForCropperReady(page, log, state, expectedImageCount);
  log("INFO", state, "Cropper is ready to finalize image batch", readySummary);

  for (let clickAttempt = 1; clickAttempt <= 2; clickAttempt += 1) {
    const button = await findCropperUploadButton(page);

    if (!button) {
      const currentSummary = await getCropperSummary(page).catch(() => null);
      throw new Error(`Upload Photos button was not found inside the cropper modal. Summary: ${JSON.stringify(currentSummary)}`);
    }

    const enabled = await button.isEnabled().catch(() => false);
    if (!enabled) {
      throw new Error("Upload Photos button is still disabled even after readiness checks.");
    }

    const buttonMeta = await button.evaluate((element) => ({
      tagName: element.tagName.toLowerCase(),
      text: String(element.innerText || element.textContent || "").replace(/\s+/g, " ").trim()
    })).catch(() => ({ tagName: "unknown", text: "" }));

    log("INFO", state, "Clicking Upload Photos in cropper modal", { clickAttempt, ...buttonMeta });
    await button.click({ timeout: 5000 }).catch(async () => {
      await button.evaluate((element) => {
        element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        const clickable = element.closest?.("button, a, div, span") || element;
        clickable.click?.();
      });
    });

    await page.waitForTimeout(1000);
    const promptHandled = await dismissCropSavePrompt(page, log, state);
    if (promptHandled) {
      log("INFO", state, "Crop prompt dismissed; retrying Upload Photos");
      await page.waitForTimeout(500);
      continue;
    }

    break;
  }

  await modal.waitFor({ state: "hidden", timeout: IMAGE_MODAL_CLOSE_TIMEOUT_MS }).catch(() => {});
  if (await locatorVisible(modal)) {
    const stuckSummary = await getCropperSummary(page);
    throw new Error(`Cropper modal remained open after clicking Upload Photos. Current state: ${JSON.stringify(stuckSummary)}`);
  }
}

async function waitForImageCount(page, expectedCount) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const summary = await getImageUploadSummary(page);
    if (summary.count >= expectedCount) {
      return summary;
    }
    await page.waitForTimeout(1000);
  }

  return await getImageUploadSummary(page);
}

async function uploadImages(page, product, runDir, log) {
  const state = "Upload Images";
  const normalizedImages = normalizeUniquePaths(product.images).filter(fs.existsSync);

  if (normalizedImages.length === 0) {
    throw new Error("No valid image files were available for upload.");
  }

  const bridgeState = await clearCodexEditorBridge(page);
  log("INFO", state, "Image sync state before upload", bridgeState);

  const baseline = await getImageUploadSummary(page);
  log("INFO", state, "Baseline image summary", baseline);

  await runWithRetries({
    page,
    runDir,
    state,
    log,
    task: async () => {
      const currentSummary = await getImageUploadSummary(page);
      log("INFO", state, "Current image summary before upload", currentSummary);

      let reusedExistingBatch = false;
      const currentCropperSummary = currentSummary.modalVisible
        ? await getCropperSummary(page).catch(() => null)
        : null;

      if (currentCropperSummary?.modalVisible) {
        const canReuseBatch = currentCropperSummary.failedImageCount === 0
          && !currentCropperSummary.loadingVisible
          && isCropperSummaryCompatibleWithSelection(currentCropperSummary, normalizedImages.length);

        if (canReuseBatch) {
          log("INFO", state, "Existing cropper modal detected, finalizing current batch without reselecting files", currentCropperSummary);
          await handleCropperIfPresent(page, log, state, normalizedImages.length);
          reusedExistingBatch = true;
        } else {
          await resetCropperModal(page, log, state);
        }
      }

      if (!reusedExistingBatch) {
        await clearImageUploadRuntimeState(page, log, state, {
          clearHiddenImages: baseline.count === 0 && currentSummary.count === 0 && currentSummary.hiddenCount === 0
        });
        await initializeImageUploadContext(page, log, state);

        log("INFO", state, "Selecting images for upload", {
          fileCount: normalizedImages.length,
          files: normalizedImages.map((filePath) => path.basename(filePath))
        });
        await setFilesOnActiveInput(page, "image", normalizedImages, log, state);
        const postSelectionUi = await waitForImageUploadUiAfterSelection(page, log, state, normalizedImages.length);
        if (postSelectionUi.cropperVisible) {
          await handleCropperIfPresent(page, log, state, normalizedImages.length);
        } else {
          log("INFO", state, "Image upload continued without a visible cropper modal", postSelectionUi.summary);
        }
      }

      await dismissBlockingOverlays(page, log, state, { useEscape: false });

      await syncUploadedImagesToAddScreen(page, log, state, normalizedImages.length);

      let summary = await getImageUploadSummary(page);
      for (let attempt = 0; attempt < Math.ceil(IMAGE_VERIFICATION_TIMEOUT_MS / ASSET_POLL_INTERVAL_MS); attempt += 1) {
        await dismissBlockingOverlays(page, log, state, { useEscape: false });
        summary = await getImageUploadSummary(page);
        const hiddenReady = summary.hiddenCount >= normalizedImages.length;
        const visibleProgress = summary.count > baseline.count || summary.filledSlotCount > baseline.filledSlotCount;
        const primaryReady = summary.primaryPhotoScore > baseline.primaryPhotoScore || (hiddenReady && visibleProgress);
        const secondaryReady = normalizedImages.length <= 1 || summary.multiPhotoScore > baseline.multiPhotoScore || hiddenReady;
        const scoreReady =
          summary.primaryPhotoScore >= 10
          && (normalizedImages.length <= 1 || summary.multiPhotoScore >= 10)
          && (summary.count > 0 || summary.filledSlotCount > 0);
        if (
          !summary.modalVisible &&
          (
            (hiddenReady && primaryReady && secondaryReady)
            || scoreReady
          )
        ) {
          break;
        }
        if (attempt % 5 === 4) {
          log("INFO", state, "Waiting for image upload verification", summary);
        }
        await page.waitForTimeout(ASSET_POLL_INTERVAL_MS);
      }
      log("INFO", state, "Image summary after upload", summary);

      if (summary.modalVisible) {
        throw new Error("Image cropper modal is still open after upload.");
      }
      if (
        summary.count > baseline.count + normalizedImages.length
        && summary.filledSlotCount > baseline.filledSlotCount + normalizedImages.length
      ) {
        throw new Error(`Duplicate image upload detected. Expected at most ${baseline.count + normalizedImages.length} visible images, found ${summary.count}.`);
      }
      if (
        !(
          (
            summary.hiddenCount >= normalizedImages.length
            && (summary.primaryPhotoScore > baseline.primaryPhotoScore || summary.count > baseline.count || summary.filledSlotCount > baseline.filledSlotCount)
            && (normalizedImages.length <= 1 || summary.multiPhotoScore > baseline.multiPhotoScore || summary.hiddenCount >= normalizedImages.length)
          )
          || (
            summary.primaryPhotoScore >= 10
            && (normalizedImages.length <= 1 || summary.multiPhotoScore >= 10)
            && (summary.count > 0 || summary.filledSlotCount > 0)
          )
        )
      ) {
        throw new Error(`Image upload could not be verified. Final summary: ${JSON.stringify(summary)}`);
      }

      await logWorkflowProgressSnapshot(page, log, state, "Verified image upload progress", product);
    }
  });

  return normalizedImages;
}

async function dismissPdfAsImagePopup(page, log = null, state = "Upload PDF") {
  const inlinePrompt = page.locator("text=/use pdf as image/i").first();
  if (await locatorVisible(inlinePrompt)) {
    const cancelButton = await firstVisibleLocator(page, [
      "button:has-text('Cancel')",
      "button:has-text('No')",
      "button:has-text('Close')",
      "a:has-text('Cancel')",
      "span:has-text('Cancel')"
    ]);

    if (!cancelButton) {
      throw new Error("PDF image-conversion popup appeared but Cancel/No button was not found.");
    }

    await cancelButton.click({ force: true });
    await page.waitForTimeout(500);
    await inlinePrompt.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    log?.("INFO", state, "Dismissed inline PDF image-conversion prompt");
  }

  const documentModal = page.locator("#savephotoModal_g02.show-modal, #savephotoModal_g02").first();
  if (await locatorVisible(documentModal)) {
    const closeButton = await firstVisibleLocator(page, [
      "#savephotoModal_g02 .close-btn",
      "#savephotoModal_g02 .close-button",
      "#savephotoModal_g02 button:has-text('Close')",
      "#savephotoModal_g02 button:has-text('Cancel')"
    ]);

    if (!closeButton) {
      throw new Error("PDF document-to-image modal appeared but no close button was found.");
    }

    await closeButton.click({ force: true }).catch(async () => {
      await closeButton.evaluate((element) => element.click());
    });
    await page.waitForTimeout(500);
    await documentModal.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    log?.("INFO", state, "Closed Add Photos from document modal to preserve brochure as PDF");
  }
}

async function choosePdfFromFilePicker(page, triggerLocator, pdfPath, log = null, state = "Upload PDF") {
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 6000 }).catch(() => null);
  await triggerLocator.click({ force: true }).catch(async () => {
    await triggerLocator.evaluate((element) => element.click());
  });
  const chooser = await chooserPromise;
  if (chooser) {
    await chooser.setFiles(pdfPath);
    return "filechooser";
  }

  await setFilesOnActiveInput(page, "pdf", [pdfPath], log || (() => {}), state);
  return "direct-input-after-click";
}

async function uploadPdf(page, product, runDir, log) {
  const state = "Upload PDF";
  const pdfPath = product.pdfFile ? path.join(__dirname, "../brochures", product.pdfFile) : "";

  if (!pdfPath || !fs.existsSync(pdfPath)) {
    throw new Error("Selected brochure PDF was not found for upload.");
  }

  const baselinePdf = await getPdfUploadSummary(page);
  const baselineImages = await getImageUploadSummary(page);
  log("INFO", state, "Baseline PDF summary", baselinePdf);

  await runWithRetries({
    page,
    runDir,
    state,
    log,
    task: async () => {
      const pdfButton = await firstVisibleLocator(page, selectors.pdfButtons);
      if (!pdfButton) {
        throw new Error("Add PDF button was not found in the active product editor.");
      }

      log("INFO", state, "Selecting brochure PDF", {
        pdfFile: path.basename(pdfPath),
        baselinePdf,
        baselineImages
      });
      const uploadMethod = await choosePdfFromFilePicker(page, pdfButton, pdfPath, log, state);
      log("INFO", state, "Triggered brochure PDF selection", {
        method: uploadMethod,
        pdfFile: path.basename(pdfPath)
      });
      await page.waitForTimeout(1000);
      await dismissPdfAsImagePopup(page, log, state).catch(() => {});

      let uploaded = false;
      let pdfSummary = baselinePdf;
      for (let attempt = 0; attempt < Math.ceil(PDF_VERIFICATION_TIMEOUT_MS / ASSET_POLL_INTERVAL_MS); attempt += 1) {
        pdfSummary = await getPdfUploadSummary(page);
        if (
          pdfSummary.count > baselinePdf.count
          || pdfSummary.brochureScore > baselinePdf.brochureScore
          || pdfSummary.labels.some((label) => label.includes(path.basename(pdfPath)))
          || pdfSummary.tileLabels.some((label) => /view pdf|change pdf/i.test(label))
        ) {
          uploaded = true;
          break;
        }
        if (attempt % 5 === 4) {
          log("INFO", state, "Waiting for PDF upload verification", pdfSummary);
        }
        await page.waitForTimeout(ASSET_POLL_INTERVAL_MS);
        await dismissPdfAsImagePopup(page, log, state).catch(() => {});
      }
      log("INFO", state, "PDF summary after upload", pdfSummary);

      if (!uploaded) {
        throw new Error(`PDF upload could not be verified in the PDF section. Final summary: ${JSON.stringify(pdfSummary)}`);
      }

      const postImageSummary = await getImageUploadSummary(page);
      if (
        postImageSummary.count !== baselineImages.count
        || postImageSummary.filledSlotCount !== baselineImages.filledSlotCount
      ) {
        throw new Error("PDF upload changed the image count, which indicates the PDF was treated as an image.");
      }

      await logWorkflowProgressSnapshot(page, log, state, "Verified PDF upload progress", product);
    }
  });
}

async function validateRequiredFields(page, product) {
  const snapshot = await getWorkflowProgressSnapshot(page, product);
  const imageReadiness = getImageReadiness(snapshot);

  return {
    snapshot,
    titleOk: snapshot.requiredFieldLengths.title > 0,
    descriptionOk: snapshot.requiredFieldLengths.description > 0 && snapshot.descriptionScore > 0 && snapshot.sidebar.description.value > 0,
    priceOk: !fixedPrice && !product.price ? true : snapshot.requiredFieldLengths.price > 0,
    imagesOk: imageReadiness.ready,
    pdfOk: (
      snapshot.pdfSummary.brochureScore > 0
      || snapshot.sidebar.brochure.value > 0
      || snapshot.pdfSummary.tileLabels.some((label) => /view pdf|change pdf/i.test(label))
    )
  };
}

async function isPageTwoLoaded(page) {
  const finishButton = await firstVisibleLocator(page, selectors.finish);
  if (finishButton) return true;

  return await page.evaluate(() => {
    return document.querySelectorAll("input[type='radio'], input[type='checkbox']").length > 0;
  });
}

async function saveAndContinue(page, product, runDir, log) {
  const state = "Save And Continue";

  await runWithRetries({
    page,
    runDir,
    state,
    log,
    task: async () => {
      const alreadyOnPageTwo = await isPageTwoLoaded(page);
      if (alreadyOnPageTwo) {
        const persistedState = await validatePersistedStepState(page, product);
        log("INFO", state, "Detected page 2 before retry; validating persisted state", persistedState.snapshot);
        if (!persistedState.persistedOk) {
          throw new Error(`Reached page 2 but saved state is incomplete: ${JSON.stringify(persistedState)}`);
        }
        return;
      }

      const validation = await validateRequiredFields(page, product);
      log("INFO", state, "Pre-save validation snapshot", validation.snapshot);
      if (!validation.titleOk || !validation.descriptionOk || !validation.priceOk || !validation.imagesOk || !validation.pdfOk) {
        throw new Error(`Required field validation failed: ${JSON.stringify(validation)}`);
      }

      const previousUrl = page.url();
      const button = await firstVisibleLocator(page, selectors.saveAndContinue);
      if (!button) {
        throw new Error("Save and Continue button was not found.");
      }

      await button.click({ timeout: 5000 }).catch(async () => {
        await button.evaluate((element) => element.click());
      });

      await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});

      let transitioned = false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (page.url() !== previousUrl || await isPageTwoLoaded(page)) {
          transitioned = true;
          break;
        }
        await page.waitForTimeout(1000);
      }

      if (!transitioned) {
        throw new Error("Save and Continue did not reach the next page.");
      }

      const persistedState = await validatePersistedStepState(page, product);
      log("INFO", state, "Persisted state after transition to page 2", persistedState.snapshot);
      if (!persistedState.persistedOk) {
        throw new Error(`Page 2 persistence verification failed: ${JSON.stringify(persistedState)}`);
      }
    }
  });
}

function loadCategoryConfig() {
  return loadJson(CATEGORY_CONFIG_PATH, {});
}

function resolveIndiaMartCategory(category) {
  const normalizedCategory = String(category || "").trim();
  return CATEGORY_TARGET_ALIASES[normalizedCategory] || normalizedCategory;
}

function resolveCategoryRules(categoryConfig, productCategory, configuredCategory) {
  if (configuredCategory && Array.isArray(categoryConfig[configuredCategory])) {
    return categoryConfig[configuredCategory];
  }

  return Array.isArray(categoryConfig[productCategory]) ? categoryConfig[productCategory] : [];
}

async function resolveCategoryRuleLocator(page, rule) {
  if (rule.selector) {
    return page.locator(rule.selector).first();
  }

  if (rule.xpath) {
    return page.locator(`xpath=${rule.xpath}`).first();
  }

  if (rule.labelText) {
    const locator = page.locator(`label:has-text("${rule.labelText}")`).first();
    if (await locator.count() > 0) return locator;
  }

  if (rule.questionText && rule.optionText) {
    const handle = await findCategoryOptionHandle(page, rule.questionText, rule.optionText);
    const locator = await elementHandleToLocator(page, handle);
    if (locator && await locator.count() > 0) return locator;
  }

  return null;
}

async function verifyRuleSelection(page, rule) {
  if (rule.selector) {
    return await page.locator(rule.selector).first().evaluate((element) => {
      if (element.matches("input")) return !!element.checked;
      const input = element.querySelector("input");
      return input ? !!input.checked : false;
    }).catch(() => false);
  }

  if (rule.xpath) {
    return await page.locator(`xpath=${rule.xpath}`).first().evaluate((element) => {
      if (element.matches("input")) return !!element.checked;
      const input = element.querySelector("input");
      return input ? !!input.checked : false;
    }).catch(() => false);
  }

  if (rule.questionText && rule.optionText) {
    const handle = await findCategoryOptionHandle(page, rule.questionText, rule.optionText);
    const locator = await elementHandleToLocator(page, handle);
    if (!locator) return false;

    return await locator.evaluate((element, optionText) => {
      const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      const targetOption = normalize(optionText);
      const label = element.closest?.("label") || element;
      const linkedInput =
        label.querySelector?.("input[type='radio'], input[type='checkbox']")
        || document.getElementById(label.getAttribute?.("for") || "")
        || element.querySelector?.("input[type='radio'], input[type='checkbox']");

      if (linkedInput) {
        return !!linkedInput.checked;
      }

      const text = normalize(label.innerText);
      const ariaChecked = (label.getAttribute?.("aria-checked") || "").toLowerCase() === "true";
      const className = String(label.className || "").toLowerCase();
      const hasSelectedClass = /selected|active|checked/.test(className);

      return text === targetOption && (ariaChecked || hasSelectedClass);
    }, rule.optionText).catch(() => false);
  }

  return true;
}

async function activateCategoryRuleLocator(locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});

  await locator.evaluate((element) => {
    const clickable = element.closest?.("label") || element;
    const nestedInput =
      clickable.querySelector?.("input[type='radio'], input[type='checkbox']")
      || document.getElementById(clickable.getAttribute?.("for") || "")
      || element.querySelector?.("input[type='radio'], input[type='checkbox']");

    const fireEvents = (candidate) => {
      candidate.dispatchEvent(new Event("input", { bubbles: true }));
      candidate.dispatchEvent(new Event("change", { bubbles: true }));
    };

    if (nestedInput) {
      if (!nestedInput.checked) {
        nestedInput.click?.();
      }

      if (!nestedInput.checked) {
        clickable.click?.();
      }

      if (!nestedInput.checked) {
        nestedInput.checked = true;
        fireEvents(nestedInput);
      } else {
        fireEvents(nestedInput);
      }

      return;
    }

    clickable.click?.();
  }).catch(async () => {
    await locator.click({ force: true }).catch(async () => {
      await locator.evaluate((element) => {
        const clickable = element.closest?.("label") || element;
        clickable.click?.();
      });
    });
  });
}

async function fillCategoryAttributes(page, product, runDir, log) {
  const state = "Fill Category Attributes";
  const categoryConfig = loadCategoryConfig();
  const rules = resolveCategoryRules(categoryConfig, product.category, selectedCategory);
  const targetCategory = resolveIndiaMartCategory(selectedCategory || product.category);

  await runWithRetries({
    page,
    runDir,
    state,
    log,
    task: async () => {
      await dismissBlockingOverlays(page, log, state, { useEscape: false });
      await ensureSpecificationCategory(page, targetCategory, rules, log, state);
    }
  });

  for (const rule of rules) {
    await runWithRetries({
      page,
      runDir,
      state,
      log,
      task: async () => {
        await dismissBlockingOverlays(page, log, state, { useEscape: false });
        const locator = await resolveCategoryRuleLocator(page, rule);
        if (!locator) {
          throw new Error(`Category rule "${rule.name || rule.labelText || rule.optionText}" could not be resolved.`);
        }

        await activateCategoryRuleLocator(locator);
        await page.waitForTimeout(200);
        await dismissBlockingOverlays(page, log, state, { useEscape: false });

        const selected = await verifyRuleSelection(page, rule);
        if (!selected) {
          throw new Error(`Category rule "${rule.name || rule.labelText || rule.optionText}" was not selected.`);
        }

        if (rule.inputValue) {
          await page.waitForTimeout(400);
          const inputHandle = await locator.evaluateHandle((element, questionText) => {
            const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
            const isVisible = (candidate) => {
              if (!candidate) return false;
              const rect = candidate.getBoundingClientRect();
              const style = window.getComputedStyle(candidate);
              return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
            };
            const isEditable = (candidate) => {
              if (!candidate || !isVisible(candidate) || candidate.disabled || candidate.readOnly) return false;
              if (candidate.tagName === "TEXTAREA") return true;
              if (candidate.tagName !== "INPUT") return false;

              const type = String(candidate.getAttribute("type") || "text").toLowerCase();
              return !["radio", "checkbox", "hidden", "file", "button", "submit", "reset"].includes(type);
            };
            const findEditable = (root) => {
              if (!root) return null;
              return Array.from(root.querySelectorAll("input, textarea")).find((candidate) => isEditable(candidate)) || null;
            };

            let current = element.closest?.("label, li, div, td, tr") || element;
            for (let depth = 0; current && depth < 6; depth += 1) {
              const localInput = findEditable(current);
              if (localInput) return localInput;

              const siblingInput = findEditable(current.nextElementSibling);
              if (siblingInput) return siblingInput;

              current = current.parentElement;
            }

            const questionValue = normalize(questionText || "");
            if (questionValue) {
              const questionNodes = Array.from(document.querySelectorAll("label, span, div, p, td, th"))
                .filter((candidate) => isVisible(candidate) && normalize(candidate.innerText).includes(questionValue));

              for (const questionNode of questionNodes) {
                let container = questionNode.parentElement;
                for (let depth = 0; container && depth < 4; depth += 1) {
                  const containerInput = findEditable(container);
                  if (containerInput) return containerInput;
                  container = container.parentElement;
                }
              }
            }

            return null;
          }, rule.questionText || rule.name || "");

          const inputLocator = await elementHandleToLocator(page, inputHandle.asElement());
          if (!inputLocator) {
            throw new Error(`Category rule "${rule.name || rule.labelText || rule.optionText}" requires an input value but no matching text input was found.`);
          }

          await inputLocator.fill(String(rule.inputValue));
          const finalValue = await inputLocator.inputValue().catch(() => "");
          if (finalValue.trim() !== String(rule.inputValue)) {
            throw new Error(`Category rule "${rule.name || rule.labelText || rule.optionText}" input did not retain "${rule.inputValue}".`);
          }
        }

        log("INFO", state, "Verified category rule selection", {
          rule: rule.name || rule.labelText || rule.optionText,
          questionText: rule.questionText || null,
          optionText: rule.optionText || rule.labelText || null,
          inputValue: rule.inputValue || null
        });
      }
    });
  }

  await logWorkflowProgressSnapshot(page, log, state, "Specification page progress after category mapping", product);
}

async function finalSubmit(page, product, runDir, log) {
  const state = "Final Submit";
  const expectedCategory = resolveIndiaMartCategory(selectedCategory || product.category);

  if (DRY_RUN) {
    const dryRunPath = path.join(runDir, "dry-run-final-page.png");
    await page.screenshot({ path: dryRunPath, fullPage: true, timeout: 10000 }).catch(() => {});
    return;
  }

  await runWithRetries({
    page,
    runDir,
    state,
    log,
    task: async () => {
      const button = await firstVisibleLocator(page, selectors.finish);
      if (!button) {
        throw new Error("Finish button was not found.");
      }

      await button.scrollIntoViewIfNeeded().catch(() => {});
      await button.click({ timeout: 5000 }).catch(async () => {
        await button.evaluate((element) => element.click());
      });

      await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});

      let popupClosed = false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const reviewPopupHandled = await handleReviewCategoryPopup(page, expectedCategory, log, state).catch((error) => {
          throw error;
        });
        if (reviewPopupHandled) {
          await page.waitForTimeout(1000);
        }

        const popupVisible = await page.locator("#editProductPopup").first().isVisible().catch(() => false);
        const finishStillVisible = await firstVisibleLocator(page, selectors.finish);

        if (!popupVisible || !finishStillVisible) {
          popupClosed = true;
          break;
        }

        await page.waitForTimeout(1000);
      }

      if (!popupClosed) {
        throw new Error("Finish was clicked but the add-product editor did not close.");
      }
    }
  });
}

async function verifySuccess(page, product, runDir, log) {
  const state = "Success Verification";
  const expectedCategory = resolveIndiaMartCategory(selectedCategory || product.category);

  await runWithRetries({
    page,
    runDir,
    state,
    log,
    attempts: 1,
    task: async () => {
      if (DRY_RUN) return true;

      let success = false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const reviewPopupHandled = await handleReviewCategoryPopup(page, expectedCategory, log, state).catch((error) => {
          throw error;
        });
        if (reviewPopupHandled) {
          await page.waitForTimeout(1000);
        }

        const recommendationPopupHandled = await dismissPostSubmitRecommendationPopup(page, log, state).catch((error) => {
          throw error;
        });
        if (recommendationPopupHandled) {
          await page.waitForTimeout(1000);
        }

        const popupVisible = await page.locator("#editProductPopup").first().isVisible().catch(() => false);
        const finishVisible = await firstVisibleLocator(page, selectors.finish);
        const addProductButton = await firstVisibleLocator(page, selectors.addProduct);
        const titleField = await waitForTitleField(page);
        const successText = await page.evaluate(() => {
          const text = (document.body.innerText || "").toLowerCase();
          return (
            text.includes("successfully") ||
            text.includes("product added") ||
            text.includes("product updated")
          );
        });

        if (!popupVisible && (successText || (addProductButton && !titleField && !finishVisible))) {
          success = true;
          break;
        }

        await page.waitForTimeout(1000);
      }

      if (!success) {
        throw new Error("Final success state could not be verified.");
      }
    }
  });
}

async function fillProductForm(page, product, runDir, log) {
  const state = "Fill Product Form";

  await runWithRetries({
    page,
    runDir,
    state,
    log,
    task: async () => {
      const titleField = await waitForTitleField(page);
      if (!titleField) {
        stats.skipped_no_form += 1;
        throw new Error("Product title input was not found on the Add Product page.");
      }

      const safeProductName = sanitizeIndiaMartTitle(product.productName);
      const safeDescription = sanitizeIndiaMartDescription(product.description);
      const safeShortDescription = sanitizeIndiaMartDescription(product.shortDescription);
      const safeProduct = {
        ...product,
        productName: safeProductName,
        description: safeDescription,
        shortDescription: safeShortDescription
      };

      await titleField.fill(safeProductName);
      await fillCategoryField(page, resolveIndiaMartCategory(selectedCategory || product.category));

      const targetPrice = fixedPrice !== null && !Number.isNaN(fixedPrice) ? fixedPrice : product.price;
      await fillInput(page, selectors.price, targetPrice);
      await fillUnit(page, product.unit);
      await fillDescription(page, safeDescription);
      await fillSeoFields(page, safeProduct);
      await waitForDescriptionScore(page, 1, 15000);
      await logWorkflowProgressSnapshot(page, log, state, "Verified form fields after basic details fill", safeProduct);

      const requiredState = await readRequiredFieldState(page);
      if (!requiredState.title || !requiredState.description) {
        throw new Error("Required fields did not retain their values after filling the form.");
      }
    }
  });
}

async function prepareAssets(product, runDir, log) {
  const state = "Upload Assets";
  const pdfPath = product.pdfFile ? path.join(__dirname, "../brochures", product.pdfFile) : "";
  const imagePaths = normalizeUniquePaths(product.images).filter(fs.existsSync);

  log("INFO", state, "Preparing local assets", {
    imageCount: imagePaths.length,
    pdfFile: pdfPath
  });

  if (!pdfPath || !fs.existsSync(pdfPath)) {
    throw new Error("Configured brochure PDF is missing before browser automation starts.");
  }

  if (imagePaths.length === 0) {
    throw new Error("Configured image list is empty before browser automation starts.");
  }

  return {
    pdfPath,
    imagePaths
  };
}

async function listProductOnIndiaMart(page, product, sessionRunDir) {
  const runDir = path.join(sessionRunDir, toSafeFileFragment(product.id).slice(0, 40));
  const log = createLogger(product.id);

  fs.mkdirSync(runDir, { recursive: true });
  log("INFO", "Workflow", "Starting listing workflow", {
    category: product.category,
    dryRun: DRY_RUN
  });

  await prepareAssets(product, runDir, log);

  for (const state of workflowStates) {
    log("INFO", state, "Entering state");

    switch (state) {
      case "Upload Assets":
        break;
      case "Open Add Product":
        await openAddProduct(page, runDir, log);
        break;
      case "Fill Product Form":
        await fillProductForm(page, product, runDir, log);
        break;
      case "Upload Images":
        await uploadImages(page, product, runDir, log);
        break;
      case "Upload PDF":
        await uploadPdf(page, product, runDir, log);
        break;
      case "Save And Continue":
        await saveAndContinue(page, product, runDir, log);
        break;
      case "Fill Category Attributes":
        await fillCategoryAttributes(page, product, runDir, log);
        break;
      case "Final Submit":
        await finalSubmit(page, product, runDir, log);
        break;
      case "Success Verification":
        await verifySuccess(page, product, runDir, log);
        break;
      default:
        break;
    }

    log("INFO", state, "State verified");
  }

  return true;
}

async function connectToSellerPage() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find((entry) => entry.url().includes("indiamart.com")) || pages[0];

  await injectIndiaMartGlobals(page);

  page.on("dialog", async (dialog) => {
    await dialog.accept().catch(() => {});
  });

  page.on("pageerror", (error) => {
    console.error(`[PAGE ERROR] ${error.message}`);
  });

  return { browser, context, page };
}

async function main() {
  if (!fs.existsSync(FILTERED_QUEUE_PATH)) {
    console.error("product-queue-filtered.json not found. Run product-filter.js first.");
    process.exit(1);
  }

  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  const sessionRunDir = path.join(SCRATCH_ROOT, `run-${Date.now()}`);
  fs.mkdirSync(sessionRunDir, { recursive: true });

  console.log(`Connecting to Electron browser instance on port ${CDP_PORT}...`);

  let page;
  try {
    ({ page } = await connectToSellerPage());
    console.log("Connected to IndiaMART browser session.");
  } catch (error) {
    console.error(`Failed to connect to Electron browser session: ${error.message}`);
    process.exit(1);
  }

  const products = loadJson(FILTERED_QUEUE_PATH, []);
  const skipReasons = loadJson(SKIP_REASONS_PATH, {});

  console.log(`Queue contains ${products.length} product(s).`);

  let postedThisRun = 0;
  let fatalError = null;

  for (const product of products) {
    if (dailyTarget !== null && postedThisRun >= dailyTarget) {
      console.log(`Reached daily target limit (${dailyTarget}). Stopping runner.`);
      break;
    }

    try {
      const success = await listProductOnIndiaMart(page, product, sessionRunDir);
      if (success) {
        delete skipReasons[product.id];
        if (!DRY_RUN) {
          stats.posted += 1;
          postedThisRun += 1;
        }
      } else {
        skipReasons[product.id] = "workflow returned false";
      }

      await page.waitForTimeout(3000).catch(() => {});
    } catch (error) {
      console.error(`Listing error for ${product.id}: ${error.message}`);
      stats.errors += 1;
      skipReasons[product.id] = error.message;

      if (isFatalListingError(error)) {
        fatalError = error;
        console.error("Stopping remaining listings because the IndiaMART browser session is no longer usable.");
        break;
      }
    }
  }

  saveJson(SKIP_REASONS_PATH, skipReasons);

  console.log("LISTING RUN SUMMARY");
  console.log(`posted | ${stats.posted}`);
  console.log(`skipped | ${stats.skipped_no_form}`);
  console.log(`errors | ${stats.errors}`);

  if (fatalError) {
    throw fatalError;
  }

  if (stats.errors > 0) {
    throw new Error(`Auto-list finished with ${stats.errors} error(s).`);
  }
}

if (require.main === module) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = {
  evaluateCropperProcessingState,
  evaluatePersistedStepState,
  loadCategoryConfig,
  main,
  normalizeUniquePaths,
  resolveCategoryRules,
  resolveIndiaMartCategory,
  resolveScratchRoot,
  toSafeFileFragment
};
