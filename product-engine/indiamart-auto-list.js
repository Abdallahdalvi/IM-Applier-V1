/**
 * product-engine/indiamart-auto-list.js
 *
 * Phase 3: Auto-Listing automation bot.
 * Reads from product-queue-filtered.json, connects to the running browser
 * via CDP on port 9222, navigates to IndiaMART seller dashboard,
 * fills product forms dynamically, uploads photos, and saves progress.
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

const FILTERED_QUEUE_PATH = path.join(__dirname, "../product-queue-filtered.json");
const POSTED_PRODUCTS_PATH = path.join(__dirname, "posted-products.json");
const SKIP_REASONS_PATH = path.join(__dirname, "skip-reasons.json");

const DRY_RUN = process.env.DRY_RUN === "true";
const CDP_PORT = process.env.PORT || "9222";

let fixedPrice = null;
const configPath = path.join(__dirname, "config.json");
if (fs.existsSync(configPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (config && config.fixedPrice) {
      fixedPrice = parseInt(config.fixedPrice);
      console.log(`ℹ️  Using fixed listing price from config: ₹${fixedPrice}`);
    }
  } catch (e) {}
}

const stats = {
  posted: 0,
  skipped_disk: 0,
  skipped_no_form: 0,
  errors: 0
};

function loadPostedProducts() {
  if (!fs.existsSync(POSTED_PRODUCTS_PATH)) return new Set();
  try {
    return new Set(JSON.parse(fs.readFileSync(POSTED_PRODUCTS_PATH, "utf-8")));
  } catch (err) {
    return new Set();
  }
}

function savePostedProducts(set) {
  fs.writeFileSync(POSTED_PRODUCTS_PATH, JSON.stringify([...set], null, 2));
}

function loadSkipReasons() {
  if (!fs.existsSync(SKIP_REASONS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(SKIP_REASONS_PATH, "utf-8"));
  } catch (err) {
    return {};
  }
}

function saveSkipReasons(obj) {
  fs.writeFileSync(SKIP_REASONS_PATH, JSON.stringify(obj, null, 2));
}

/**
 * Robustly find an input element near its label or descriptive text.
 * Runs inside browser evaluate.
 */
async function findInputByLabelText(page, labelText, inputType = "input, textarea, select") {
  return await page.evaluateHandle(([text, tagSelectors]) => {
    const labels = Array.from(document.querySelectorAll("label, span, div, p"));
    const matchingLabel = labels.find(el => {
      const txt = el.innerText?.trim().toLowerCase() || "";
      return txt === text.toLowerCase() || txt.includes(text.toLowerCase());
    });

    if (!matchingLabel) return null;

    // 1. Check if the label has a 'for' attribute linking to an input
    const forAttr = matchingLabel.getAttribute("for");
    if (forAttr) {
      const el = document.getElementById(forAttr);
      if (el) return el;
    }

    // 2. Check if the input is nested inside the label
    const nested = matchingLabel.querySelector(tagSelectors);
    if (nested) return nested;

    // 3. Search siblings or adjacent elements
    let parent = matchingLabel.parentElement;
    let depth = 0;
    while (parent && depth < 3) {
      const siblingInputs = Array.from(parent.querySelectorAll(tagSelectors));
      const targetInput = siblingInputs.find(input => input !== matchingLabel);
      if (targetInput) return targetInput;
      parent = parent.parentElement;
      depth++;
    }

    return null;
  }, [labelText, inputType]);
}

/**
 * Uses OpenAI at runtime to fill dynamic technical specification inputs on the page.
 */
async function fillTechnicalSpecsWithAI(page, product) {
  console.log("   🤖 Using AI to help fill technical specifications on the page...");
  
  const formElements = await page.evaluate(() => {
    // Find all labels, span labels, or table headers that describe specification names
    const labels = Array.from(document.querySelectorAll("label, span.spec-label, td.spec-name, div.label, .spec-key, [class*='label' i]"));
    
    return labels.map((el, index) => {
      // Check if the label element itself is visible
      const rect = el.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) return null;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return null;

      const text = el.innerText?.trim() || "";
      if (!text || text.length > 50 || text.length < 2) return null;
      
      // Try to find the associated input/select/textarea
      let inputEl = el.querySelector("input, select, textarea");
      
      // Look at sibling element if not nested
      if (!inputEl && el.nextElementSibling) {
        inputEl = el.nextElementSibling.querySelector("input, select, textarea") || 
                  (el.nextElementSibling.tagName.toLowerCase() === "input" || 
                   el.nextElementSibling.tagName.toLowerCase() === "select" || 
                   el.nextElementSibling.tagName.toLowerCase() === "textarea" ? el.nextElementSibling : null);
      }
      
      // Look at parent level sibling
      if (!inputEl && el.parentElement) {
        const sibs = Array.from(el.parentElement.querySelectorAll("input, select, textarea"));
        if (sibs.length === 1) inputEl = sibs[0];
      }
      
      if (!inputEl) return null;
      
      // Check if the input element itself is visible in the viewport/DOM
      const inputRect = inputEl.getBoundingClientRect();
      if (!(inputRect.width > 0 && inputRect.height > 0)) return null;
      const inputStyle = window.getComputedStyle(inputEl);
      if (inputStyle.display === "none" || inputStyle.visibility === "hidden" || inputStyle.opacity === "0") return null;

      // Skip hidden inputs
      if (inputEl.type === "hidden") return null;

      const isSelect = inputEl.tagName.toLowerCase() === "select";
      let options = [];
      if (isSelect) {
        options = Array.from(inputEl.options).map(opt => opt.text.trim()).filter(Boolean);
      }
      
      return {
        id: index,
        label: text,
        type: inputEl.tagName.toLowerCase(),
        options: options
      };
    }).filter(Boolean);
  });
  
  // Filter duplicates by label name
  const seen = new Set();
  const uniqueFormElements = formElements.filter(item => {
    const key = item.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (uniqueFormElements.length === 0) {
    console.log("      No dynamic spec fields detected on page.");
    return;
  }
  
  console.log(`      Detected ${uniqueFormElements.length} fields on page. Consulting AI...`);
  
  let matchedValues = {};
  try {
    const envPath = path.join(__dirname, "../.env");
    if (fs.existsSync(envPath)) {
      require("dotenv").config({ path: envPath });
    }
    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (apiKey && !apiKey.startsWith("sk-xx")) {
      const OpenAI = require("openai");
      const client = new OpenAI({ apiKey: apiKey });
      const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
      
      const prompt = `
You are an expert product catalog filler helping an industrial hardware seller on IndiaMART.
Based on the product details, determine the most accurate and relevant value to fill/select for each form field detected on the page.

Product: ${product.productName}
Description: ${product.description}
Extracted Specs: ${JSON.stringify(product.specifications)}

Fields to fill:
${JSON.stringify(uniqueFormElements, null, 2)}

Instructions:
1. For each detected field, provide the most relevant value based on the product description and specifications.
2. If it is a select dropdown (type="select"), you MUST choose one of the options in its "options" list. If none fit perfectly, select the closest one.
3. If you cannot determine a value, leave it null.
4. Return a JSON object mapping the field ID (number as string) to the selected value (string).
   Example: { "0": "4G", "1": "Remote Monitoring Unit" }
5. Respond with raw JSON only.
`.trim();

      const tokenParam = model.startsWith("gpt-5") || model.startsWith("o")
        ? { max_completion_tokens: 1500 }
        : { max_tokens: 1500 };

      const response = await client.chat.completions.create({
        model: model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        response_format: { type: "json_object" },
        ...tokenParam
      });
      
      matchedValues = JSON.parse(response.choices[0].message.content.trim());
      console.log("      AI suggestions received:", matchedValues);
    }
  } catch (err) {
    console.warn("      ⚠️ Runtime AI spec matching failed:", err.message);
  }
  
  // Fill the fields
  for (const item of uniqueFormElements) {
    const aiVal = matchedValues[String(item.id)];
    if (!aiVal) continue;
    
    try {
      const handle = await findInputByLabelText(page, item.label, item.type);
      if (handle) {
        const element = handle.asElement();
        if (element) {
          if (item.type === "select") {
            await element.selectOption({ label: aiVal }, { timeout: 3000 });
            console.log(`      ✅ AI filled dropdown: "${item.label}" -> "${aiVal}"`);
          } else {
            await element.fill(aiVal, { timeout: 3000 });
            console.log(`      ✅ AI filled text field: "${item.label}" -> "${aiVal}"`);
          }
          await page.waitForTimeout(1000);
        }
      }
    } catch (e) {
      console.warn(`      ⚠️ Failed to fill field "${item.label}":`, e.message);
    }
  }
}

/**
 * Uses OpenAI to determine and fill appropriate options for Page 2 specifications.
 */
async function fillPage2SpecsWithAI(page, product) {
  console.log("   🤖 Analyzing Page 2 specifications layout...");
  
  // Extract all questions and options from the DOM
  const specsStructure = await page.evaluate(() => {
    const specsList = [];
    const inputs = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
    
    inputs.forEach(input => {
      const nameAttr = input.getAttribute('name') || '';
      let question = '';
      const match = nameAttr.match(/\[(.*?)\]/);
      if (match) {
        question = match[1];
      } else {
        question = input.getAttribute('data-master-desc') || '';
      }
      
      if (!question) return;
      
      let optionText = '';
      const id = input.id;
      if (id) {
        const label = document.querySelector(`label[for="${id}"]`);
        if (label) optionText = label.innerText.trim();
      }
      
      if (!optionText) {
        const parent = input.parentElement;
        if (parent) optionText = parent.innerText.trim();
      }
      
      let entry = specsList.find(s => s.question.toLowerCase() === question.toLowerCase());
      if (!entry) {
        entry = { question: question, type: input.type, options: [] };
        specsList.push(entry);
      }
      
      if (optionText && !entry.options.find(o => o.text === optionText)) {
        entry.options.push({ text: optionText, id: id });
      }
    });
    return specsList;
  });

  if (specsStructure.length === 0) {
    console.log("      No radio or checkbox specifications detected on Page 2.");
    return;
  }

  console.log(`      Detected ${specsStructure.length} specification questions. Consulting OpenAI...`);
  
  let selectedAnswers = {};
  try {
    const envPath = path.join(__dirname, "../.env");
    if (fs.existsSync(envPath)) {
      require("dotenv").config({ path: envPath });
    }
    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (apiKey && !apiKey.startsWith("sk-xx")) {
      const OpenAI = require("openai");
      const client = new OpenAI({ apiKey: apiKey });
      const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
      
      const cleanStructure = specsStructure.map(s => ({
        question: s.question,
        type: s.type,
        options: s.options.map(o => o.text)
      }));
      
      const prompt = `
You are an expert product catalog compiler helping an industrial hardware seller on IndiaMART.
Determine the most appropriate option value to select for each specification question based on the product description and details.

Product: ${product.productName}
Description: ${product.description}
Specifications: ${JSON.stringify(product.specifications)}

Questions to answer:
${JSON.stringify(cleanStructure, null, 2)}

Instructions:
1. For each question, choose the most appropriate option text from its "options" list.
2. If it is a radio (single-select), you must return exactly one option text (or null if none fit).
3. If it is a checkbox (multi-select), you can return an array of one or more option texts that apply.
4. Output a raw JSON object mapping each question name to its selected option text(s).
   Example: { "Form Factor": "DIN Rail", "WAN Type": ["4G LTE", "Ethernet"] }
5. Respond with raw JSON only.
`.trim();

      const tokenParam = model.startsWith("gpt-5") || model.startsWith("o")
        ? { max_completion_tokens: 1500 }
        : { max_tokens: 1500 };

      const response = await client.chat.completions.create({
        model: model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        response_format: { type: "json_object" },
        ...tokenParam
      });
      
      selectedAnswers = JSON.parse(response.choices[0].message.content.trim());
      console.log("      OpenAI specifications recommendations received:", selectedAnswers);
    }
  } catch (err) {
    console.log(`      ⚠️ OpenAI spec classification failed: ${err.message}`);
  }

  // Click the matching inputs in the DOM
  for (const qEntry of specsStructure) {
    const ans = selectedAnswers[qEntry.question];
    if (!ans) continue;
    
    const targets = Array.isArray(ans) ? ans : [ans];
    for (const optText of targets) {
      const option = qEntry.options.find(o => o.text.toLowerCase() === optText.toLowerCase() || o.text.toLowerCase().includes(optText.toLowerCase()));
      if (option && option.id) {
        try {
          const inputLocator = page.locator(`[id="${option.id}"]`).first();
          if (await inputLocator.count() > 0) {
            await inputLocator.click({ force: true });
            console.log(`      ✅ Checked: "${qEntry.question}" -> "${option.text}"`);
            await page.waitForTimeout(500);
          }
        } catch (clickErr) {
          console.log(`      ⚠️ Failed to click option "${option.text}" for question "${qEntry.question}": ${clickErr.message}`);
        }
      }
    }
  }
}

/**
 * Automates the product listing page.
 */
async function listProductOnIndiaMart(page, product) {
  console.log(`\n➡️  Listing: "${product.productName}"`);

  // Reset page state by going to the products list page directly
  try {
    console.log("   Navigating to manage products page to clear state...");
    await page.goto("https://seller.indiamart.com/product/manageproducts/", { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(3000);
  } catch (err) {
    console.log(`   ⚠️ Reset navigation warning: ${err.message}`);
  }

  // Dismiss any blocking modals/popups
  try {
    console.log("   Dismissing any blocking modals or popups...");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    const closeBtn = page.locator(".close, [class*='close' i], .modal-close, button:has-text('Close'), span:has-text('×')").first();
    if (await closeBtn.count() > 0 && await closeBtn.isVisible()) {
      await closeBtn.click();
      await page.waitForTimeout(1000);
    }
  } catch (err) {}

  // Click '+ Add Product' button
  try {
    console.log("   Clicking '+ Add Product' button...");
    await page.locator('#addProduct').click();
    console.log("   Waiting 5 seconds for Add Product form to load...");
    await page.waitForTimeout(5000);
  } catch (err) {
    throw new Error(`Failed to click '+ Add Product' button: ${err.message}`);
  }

  // Double check that we are actually on the Add Product page
  const currentUrl = page.url();
  const isOnAddProductPage = currentUrl.includes("manageproducts") || currentUrl.includes("product/add") || currentUrl.includes("addproduct");
  if (!isOnAddProductPage) {
    throw new Error(`Failed to land on IndiaMART Add Product page. Current URL: ${currentUrl}`);
  }

  // Detect if logged in. IndiaMART seller portal contains text or links for login if unauthenticated
  const isLoginPage = await page.evaluate(() => {
    const text = document.body.innerText.toLowerCase();
    return text.includes("sign in") || text.includes("login") || text.includes("enter mobile number");
  });

  if (isLoginPage) {
    console.error("❌  CRITICAL: You are NOT logged in to IndiaMART Seller Dashboard!");
    console.error("   Please open Electron, log in manually to seller.indiamart.com, and then re-run.");
    process.exit(1);
  }

  // Look for Product Name field specifically in the form
  const nameSelectors = [
    "#nameOfProduct",
    "form input[name='product_name']",
    "form input[name='name']",
    "input[name='product_name']",
    "input[name='product_add_name']",
    "input[placeholder*='Product Name' i]",
    "input[placeholder*='Product/Service Name' i]",
    "input[placeholder*='Name of Product' i]"
  ];

  let nameInput = null;
  for (const sel of nameSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() && await el.isVisible()) {
      nameInput = el;
      break;
    }
  }

  if (!nameInput) {
    const handle = await findInputByLabelText(page, "Product Name", "input");
    if (handle && await handle.asElement()) {
      nameInput = page.locator(handle);
    }
  }

  if (!nameInput) {
    stats.skipped_no_form++;
    console.log("   🚫 Could not find Product Name input. Skipping this listing.");
    return false;
  }

  // 1. Fill Product Name
  await nameInput.fill(product.productName);
  console.log(`   ✅ Filled Product Name: "${product.productName}"`);
  await page.waitForTimeout(1000);

  // 2. Select Category (usually triggers suggestions)
  const categorySelectors = [
    "input[name='category']",
    "input[placeholder*='category' i]",
    "input[id*='category']"
  ];

  let categoryInput = null;
  for (const sel of categorySelectors) {
    const el = page.locator(sel).first();
    if (await el.count() && await el.isVisible()) {
      categoryInput = el;
      break;
    }
  }

  if (!categoryInput) {
    const handle = await findInputByLabelText(page, "Category", "input");
    if (handle && await handle.asElement()) {
      categoryInput = page.locator(handle);
    }
  }

  if (categoryInput && product.category) {
    await categoryInput.fill(product.category);
    await page.waitForTimeout(2000); // Wait for suggestions to load
    
    const suggestionSelectors = [
      ".ui-menu-item",
      ".ui-autocomplete li",
      "[role='option']",
      ".suggestion-list li",
      ".category-suggestion"
    ];

    let suggestionClicked = false;
    for (const sel of suggestionSelectors) {
      try {
        const suggestion = page.locator(sel).first();
        if (await suggestion.count() && await suggestion.isVisible()) {
          await suggestion.click({ delay: 100 });
          console.log(`   ✅ Selected Category Suggestion using selector: ${sel}`);
          suggestionClicked = true;
          break;
        }
      } catch {}
    }

    if (!suggestionClicked) {
      await categoryInput.press("Enter");
      console.log("   ✅ Pressed Enter to settle category autocomplete selection");
    }
    await page.waitForTimeout(1000);
  }

  // 3. Fill Price & Unit
  const targetPrice = fixedPrice !== null && !isNaN(fixedPrice) ? fixedPrice : product.price;
  if (targetPrice) {
    const priceSelectors = [
      "#priceOfProduct",
      "input[name='price']",
      "input[name='selling_price']",
      "input[id*='price']",
      "input[placeholder*='Price' i]"
    ];

    let priceInput = null;
    for (const sel of priceSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() && await el.isVisible()) {
        priceInput = el;
        break;
      }
    }

    if (!priceInput) {
      const handle = await findInputByLabelText(page, "Price", "input");
      if (handle && await handle.asElement()) {
        priceInput = page.locator(handle);
      }
    }

    if (priceInput) {
      await priceInput.fill(String(targetPrice));
      console.log(`   ✅ Filled Price: ${targetPrice}`);
      await page.waitForTimeout(1000);
    }

    // Unit Suggestion Chips
    if (product.unit) {
      try {
        console.log("   Triggering unit suggestions...");
        await nameInput.focus();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(2000);
        
        const targetUnit = product.unit;
        const unitChip = page.locator(`li[title='${targetUnit}'], #unitSugg li:has-text('${targetUnit}')`).first();
        if (await unitChip.count() > 0 && await unitChip.isVisible()) {
          await unitChip.click();
          console.log(`   ✅ Clicked unit chip: "${targetUnit}"`);
        } else {
          console.log("   Unit chip not found, clicking Other...");
          const otherChip = page.locator("li[title='Other'], #unitSugg li:has-text('Other')").first();
          if (await otherChip.count() > 0 && await otherChip.isVisible()) {
            await otherChip.click();
            await page.waitForTimeout(1000);
          }
          await page.evaluate((u) => {
            const el = document.getElementById('unitOfProduct');
            if (el) {
              el.value = u;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, targetUnit);
          console.log(`   ✅ Set custom unit: "${targetUnit}"`);
        }
        await page.waitForTimeout(1000);
      } catch (unitErr) {
        console.log(`   ⚠️ Failed to set unit: ${unitErr.message}`);
      }
    }
  }

  // 4. Fill Description (Rich text editor)
  if (product.description) {
    try {
      console.log("   Filling Description Rich-Text Editor Iframe...");
      const iframeLocator = page.frameLocator('#item_desc_ifr');
      const bodyLocator = iframeLocator.locator('body');
      await bodyLocator.waitFor({ state: 'visible', timeout: 5000 });
      await bodyLocator.fill(product.description);
      console.log("   ✅ Filled Description inside rich-text iframe");
      await page.waitForTimeout(1000);
    } catch (e) {
      console.log("   ⚠️ Rich-text description iframe failed, falling back to simple textarea...");
      const descSelectors = [
        "textarea[name='description']",
        "textarea[name='desc']",
        "textarea[id*='desc']",
        "textarea[placeholder*='description' i]"
      ];
      let descTextarea = null;
      for (const sel of descSelectors) {
        const el = page.locator(sel).first();
        if (await el.count() && await el.isVisible()) {
          descTextarea = el;
          break;
        }
      }
      if (descTextarea) {
        await descTextarea.fill(product.description);
        console.log("   ✅ Filled Description via fallback");
        await page.waitForTimeout(1000);
      }
    }
  }

  // 5. Fill Specifications (Attributes table)
  if (product.specifications && Object.keys(product.specifications).length > 0) {
    console.log(`   ⚙️  Filling specifications (${Object.keys(product.specifications).length} items)...`);
    
    for (const [key, val] of Object.entries(product.specifications)) {
      if (!val) continue;

      try {
        // Find "Add Specification" button to create a new key-value row
        const addSpecBtnSelectors = [
          "button:has-text('Add Specification')",
          "button:has-text('Add Attribute')",
          "a:has-text('Add Specification')",
          ".add-spec-btn",
          ".add-attribute-btn"
        ];

        let addBtn = null;
        for (const sel of addSpecBtnSelectors) {
          const el = page.locator(sel).first();
          if (await el.count() && await el.isVisible()) {
            addBtn = el;
            break;
          }
        }

        if (addBtn) {
          await addBtn.click({ delay: 100 });
          await page.waitForTimeout(1000); // let row render

          // Get the last specification row fields
          // Usually name/value pair inputs inside the table or repeating container
          const keyInputs = page.locator("input[placeholder*='Spec' i], input[placeholder*='Attribute' i], input[id*='key'], input[name*='key']");
          const valInputs = page.locator("input[placeholder*='Value' i], input[placeholder*='Val' i], input[id*='val'], input[name*='val']");

          if (await keyInputs.count() && await valInputs.count()) {
            const lastIdx = await keyInputs.count() - 1;
            await keyInputs.nth(lastIdx).fill(key);
            await valInputs.nth(lastIdx).fill(val);
            console.log(`      ✅ Added spec: "${key}" -> "${val}"`);
            await page.waitForTimeout(1000);
          }
        }
      } catch (specErr) {
        console.log(`      ⚠️ Failed to add specification "${key}": ${specErr.message}`);
      }
    }
  }

  // 5b. Dynamically fill technical specs with runtime AI help
  try {
    await fillTechnicalSpecsWithAI(page, product);
  } catch (aiSpecErr) {
    console.log(`   ⚠️ Runtime AI specifications assistant skipped: ${aiSpecErr.message}`);
  }

  // 6. Upload Product Images
  if (product.images && product.images.length > 0) {
    console.log(`   📸 Uploading ${product.images.length} product images...`);
    const fileInputs = page.locator("input[type='file']");
    const fileInputsCount = await fileInputs.count();
    let uploadedImages = false;

    for (let j = 0; j < fileInputsCount; j++) {
      const input = fileInputs.nth(j);
      try {
        const accept = await input.getAttribute("accept") || "";
        const name = await input.getAttribute("name") || "";
        const id = await input.getAttribute("id") || "";
        
        // Skip if it specifically targets PDF or document
        if (accept.includes("pdf") || name.toLowerCase().includes("pdf") || name.toLowerCase().includes("brochure") || id.toLowerCase().includes("pdf")) {
          continue;
        }

        // Upload images to this input
        await input.setInputFiles(product.images);
        console.log(`      ✅ Selected ${product.images.length} image files for upload`);
        uploadedImages = true;
        
        // Wait for crop popup and click 'Upload Photos' inside it
        try {
          console.log("      Waiting for crop popup button to become visible...");
          const cropUploadBtn = page.locator("button:has-text('Upload Photos'), button.Crop_bg1").first();
          await cropUploadBtn.waitFor({ state: 'visible', timeout: 10000 });
          console.log("      Clicking 'Upload Photos' button inside crop popup...");
          await cropUploadBtn.click();
          console.log("      Clicked! Waiting 4 seconds for processing...");
          await page.waitForTimeout(4000);
        } catch (e) {
          console.log("      No crop popup detected or timed out waiting.");
        }
        break;
      } catch (uploadErr) {}
    }

    if (!uploadedImages && fileInputsCount > 0) {
      try {
        await fileInputs.first().setInputFiles(product.images);
        console.log("      ✅ Selected image files for upload (fallback to first input)");
        await page.waitForTimeout(3000);
      } catch (uploadErr) {
        console.log(`      ⚠️ Image upload error: ${uploadErr.message}`);
      }
    }
  }

  // 6b. Upload Product PDF Brochure/Datasheet
  if (product.pdfFile) {
    const pdfFilePath = path.join(__dirname, "../brochures", product.pdfFile);
    if (fs.existsSync(pdfFilePath)) {
      console.log(`   📄 Uploading product PDF brochure: "${product.pdfFile}"...`);
      const fileInputs = page.locator("input[type='file']");
      const fileInputsCount = await fileInputs.count();
      let uploadedPdf = false;

      for (let j = 0; j < fileInputsCount; j++) {
        const input = fileInputs.nth(j);
        try {
          const accept = await input.getAttribute("accept") || "";
          const name = await input.getAttribute("name") || "";
          const id = await input.getAttribute("id") || "";

          // Check if it specifically accepts pdf or has pdf/brochure in name/id
          if (accept.includes("pdf") || name.toLowerCase().includes("pdf") || name.toLowerCase().includes("brochure") || id.toLowerCase().includes("pdf") || id.toLowerCase().includes("brochure")) {
            await input.setInputFiles(pdfFilePath);
            console.log("      ✅ Selected PDF file for upload. Waiting for upload to complete...");
            uploadedPdf = true;
            
            // Wait for upload completion using the count method
            const viewPdfElements = page.locator("text=View PDF");
            const prevCount = await viewPdfElements.count();
            
            let uploadComplete = false;
            for (let k = 0; k < 30; k++) {
              await page.waitForTimeout(1000);
              const newCount = await viewPdfElements.count();
              if (newCount > prevCount) {
                console.log(`      ✅ PDF upload complete! Count increased from ${prevCount} to ${newCount}`);
                uploadComplete = true;
                break;
              }
            }
            if (!uploadComplete) {
              console.log("      ⚠️ PDF upload wait timed out, proceeding anyway");
            }
            break;
          }
        } catch (pdfErr) {}
      }

      if (!uploadedPdf) {
        try {
          const pdfInput = page.locator("input[type='file'][accept*='pdf']").first();
          if (await pdfInput.count()) {
            await pdfInput.setInputFiles(pdfFilePath);
            console.log("      ✅ Selected PDF file for upload (fallback accept filter). Waiting for upload...");
            uploadedPdf = true;
            
            const viewPdfElements = page.locator("text=View PDF");
            const prevCount = await viewPdfElements.count();
            
            let uploadComplete = false;
            for (let k = 0; k < 30; k++) {
              await page.waitForTimeout(1000);
              const newCount = await viewPdfElements.count();
              if (newCount > prevCount) {
                console.log(`      ✅ PDF upload complete! Count increased from ${prevCount} to ${newCount}`);
                uploadComplete = true;
                break;
              }
            }
            if (!uploadComplete) {
              console.log("      ⚠️ PDF upload wait timed out, proceeding anyway");
            }
          }
        } catch (pdfErr) {}
      }
    }
  }

  // 7. Click Save and Continue to go to Page 2 (Specifications)
  console.log("   Clicking 'Save and Continue'...");
  const saveBasicBtn = page.locator('#saveBasic').first();
  let page2Loaded = false;
  
  if (await saveBasicBtn.count() > 0 && await saveBasicBtn.isVisible()) {
    await saveBasicBtn.click();
    console.log("   Clicked 'Save and Continue'! Waiting 6 seconds for Specifications page to load...");
    await page.waitForTimeout(6000);
    
    const finishBtn = page.locator('#save_isq').first();
    if (await finishBtn.count() > 0 && await finishBtn.isVisible()) {
      page2Loaded = true;
      console.log("   ✅ Specifications page (Page 2) loaded successfully.");
    } else {
      console.log("   ℹ️ No Specifications page detected (remained on Page 1 or finished).");
    }
  } else {
    console.log("   ⚠️ 'Save and Continue' button not found. Assuming single-page form.");
  }

  // 8. If Page 2 is loaded, fill specifications with AI
  if (page2Loaded) {
    try {
      await fillPage2SpecsWithAI(page, product);
    } catch (specErr) {
      console.log(`   ⚠️ Failed to fill page 2 specifications: ${specErr.message}`);
    }
    
    const screenshotDir = path.join(__dirname, "../scratch");
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, `${DRY_RUN ? 'dry_run' : 'live'}_list_page2_${product.id}.png`);
    try {
      await page.screenshot({ path: screenshotPath, timeout: 5000 });
      console.log(`   📸 Page 2 screenshot saved to: ${screenshotPath}`);
    } catch (err) {
      console.log(`   ⚠️ Page 2 screenshot failed: ${err.message}`);
    }

    if (DRY_RUN) {
      console.log("   🧪 [DRY RUN] Page 2 specifications filled. Skipping final submit.");
      return true;
    }

    // Live Submit on Page 2
    const finishBtn = page.locator('#save_isq').first();
    if (await finishBtn.count() > 0 && await finishBtn.isVisible()) {
      await finishBtn.click();
      console.log("   🚀 Clicked Finish button on Page 2.");
      await page.waitForTimeout(5000);
      return true;
    } else {
      throw new Error("Finish button not found on Page 2");
    }
  } else {
    // Single page form or failed transition
    const screenshotDir = path.join(__dirname, "../scratch");
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, `${DRY_RUN ? 'dry_run' : 'live'}_list_page1_${product.id}.png`);
    try {
      await page.screenshot({ path: screenshotPath, timeout: 5000 });
      console.log(`   📸 Page 1 screenshot saved to: ${screenshotPath}`);
    } catch (err) {}

    if (DRY_RUN) {
      console.log("   🧪 [DRY RUN] Form filled. Skipping submit.");
      return true;
    }

    // Live Submit on Page 1 (fallback)
    const submitSelectors = [
      "button[type='submit']",
      "button:has-text('Save')",
      "button:has-text('Submit')",
      "input[type='submit']",
      ".submit-btn",
      ".save-product-btn"
    ];
    let submitBtn = null;
    for (const sel of submitSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() && await el.isVisible()) {
        submitBtn = el;
        break;
      }
    }
    if (submitBtn) {
      await submitBtn.click();
      console.log("   🚀 Clicked Submit/Save button on Page 1.");
      await page.waitForTimeout(5000);
      return true;
    } else {
      console.log("   ⚠️ No Submit button found, assuming autosaved or finished.");
      return true;
    }
  }
}

/* ── MAIN RUNNER ────────────────────────────────────────── */
(async () => {
  if (!fs.existsSync(FILTERED_QUEUE_PATH)) {
    console.error("❌  product-queue-filtered.json not found.");
    console.error("   Run: node product-engine/product-filter.js first.");
    process.exit(1);
  }

  console.log("🌐  Connecting to Electron browser instance...");
  let browser, context, page;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
    context = browser.contexts()[0];
    const allPages = context.pages();
    // Select seller panel window (not webpack UI)
    page = allPages.find(p => p.url().includes('indiamart.com')) || allPages[0];
    console.log("✅  Connected to browser");
  } catch (err) {
    console.error("❌  Failed to connect to Electron browser.");
    console.error(`   Ensure Electron is running with remote debugging active on port ${CDP_PORT}.`);
    console.error("   Error details:", err.message);
    process.exit(1);
  }

  const products = JSON.parse(fs.readFileSync(FILTERED_QUEUE_PATH, "utf-8"));
  const posted = loadPostedProducts();
  const skipReasons = loadSkipReasons();

  console.log(`📋  ${products.length} products in filtered queue.`);

  for (const product of products) {
    if (posted.has(product.id)) {
      stats.skipped_disk++;
      continue;
    }

    try {
      const success = await listProductOnIndiaMart(page, product);
      if (success) {
        posted.add(product.id);
        stats.posted++;
      } else {
        skipReasons[product.id] = "form_fill_failure";
      }
    } catch (e) {
      console.log("❌  Listing Error:", e.message);
      stats.errors++;
      skipReasons[product.id] = e.message;
    }

    // Wait a brief period between products
    await page.waitForTimeout(4000);
  }

  savePostedProducts(posted);
  saveSkipReasons(skipReasons);

  console.log("\n📊  LISTING RUN SUMMARY");
  console.table(stats);
})();
