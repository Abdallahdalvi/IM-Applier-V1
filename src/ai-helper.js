/**
 * src/ai-helper.js
 *
 * AI Helper for extracting product details from brochures/datasheets (PDFs)
 * using OpenAI.
 */

const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const pdfParse = require("pdf-parse");

// We parse .env manually to avoid 'dotenv' package dependency issues in the Squirrel-packaged exe
const envPath = path.join(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      value = value.replace(/(^['"]|['"]$)/g, '').trim();
      process.env[key] = value;
    }
  });
}

const rawApiKey = (process.env.OPENAI_API_KEY || "").trim();
const AI_AVAILABLE = Boolean(rawApiKey && rawApiKey !== "" && !rawApiKey.startsWith("sk-xxx"));
const MODEL = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();

let client = null;
if (AI_AVAILABLE) {
  const isOR = rawApiKey.startsWith('sk-or-');
  const clientOptions = { apiKey: rawApiKey };
  if (isOR) {
    clientOptions.baseURL = 'https://openrouter.ai/api/v1';
    clientOptions.defaultHeaders = {
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'IndiaMART Listing Bot',
    };
  }
  client = new OpenAI(clientOptions);
} else {
  console.warn("⚠️  OPENAI_API_KEY is not set. AI extraction will be disabled.");
}

/**
 * Parses a PDF file and returns its raw text contents.
 * @param {string} filePath - Absolute path to PDF file
 * @returns {Promise<string>} - Parsed text
 */
async function parsePdf(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

/**
 * Uses OpenAI to extract structured product listing details from raw brochure/datasheet text.
 * @param {string} text - Brochure or datasheet text contents
 * @returns {Promise<Object>} - Extracted product details matching the schema
 */
async function extractProductDetails(text) {
  if (!AI_AVAILABLE || !client) {
    throw new Error("AI extraction is unavailable. Please configure OPENAI_API_KEY in .env.");
  }

  const prompt = `
You are an expert product catalog compiler helping an industrial hardware seller list products on IndiaMART (a B2B marketplace).
Analyze the following raw text extracted from a product brochure/datasheet. Extract the details into a clean, structured JSON format.

════════════════════════════════════════════════
RAW BROCHURE/DATASHEET TEXT:
════════════════════════════════════════════════
${text}

════════════════════════════════════════════════
OUTPUT JSON FORMAT (STRICTLY RESPOND WITH JSON ONLY):
{
  "productName": "Short, search-friendly product name (e.g. 'KLEON 4G LTE SIM Industrial Dongle')",
  "price": 4500, // Estimate price if not present, or set null. Provide a realistic number based on the device type.
  "unit": "Piece", // piece, unit, set, pack, box, etc.
  "categorySuggestion": "Recommended IndiaMART category name (e.g., 'Industrial Modems', 'IoT Gateway', 'Wireless Routers')",
  "description": "A compelling, professional B2B product description (3-5 sentences) highlighting key features and applications.",
  "specifications": {
    "Brand": "Ubiqedge", // Default brand is Ubiqedge / KLEON unless stated otherwise
    "Model": "...", // Extracted model name/number
    "Connectivity": "...", // e.g. '4G LTE / SIM Slot / Wi-Fi'
    "Ports": "...", // e.g. 'RS485, RS232, USB, RJ45'
    "Power Supply": "...", // e.g. '9-24V DC'
    "Mounting": "...", // e.g. 'DIN Rail / Wall Mount'
    "Operating Temperature": "...",
    "Compliance": "..." // e.g. 'CPCB Compliant / CE'
  }
}

════════════════════════════════════════════════
INSTRUCTIONS:
- Focus on extracting specifications relevant to IoT, AIoT, gateways, dongles, and hardware.
- Keep the productName concise and searchable (include brand Ubiqedge or KLEON, model, and core function).
- Ensure specifications keys are clean and values are concise (1-3 words where possible).
- Respond ONLY with the raw JSON object. Do not wrap in markdown blocks like \`\`\`json.
`.trim();

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    response_format: { type: "json_object" }
  });

  const rawText = response.choices[0].message.content.trim();
  const parsed = JSON.parse(rawText);

  // Sanitization
  if (parsed.productName) parsed.productName = sanitizeText(parsed.productName);
  if (parsed.description) parsed.description = sanitizeText(parsed.description);
  if (parsed.specifications) {
    for (const key in parsed.specifications) {
      parsed.specifications[key] = sanitizeText(parsed.specifications[key]);
    }
  }

  return parsed;
}

/**
 * Uses OpenAI to generate multiple search-optimized variants of a product.
 * @param {string} text - Brochure or datasheet text contents
 * @param {number} count - Target number of variants to generate
 * @returns {Promise<Array>} - Array of extracted variants
 */
async function extractProductVariants(text, count = 30) {
  if (!AI_AVAILABLE || !client) {
    throw new Error("AI extraction is unavailable. Please configure OPENAI_API_KEY in .env.");
  }

  const prompt = `
You are an expert product catalog compiler helping an industrial hardware seller list products on IndiaMART (a B2B marketplace).
Analyze the following raw text extracted from a product brochure/datasheet. Generate exactly ${count} distinct, search-friendly SEO variations of this product to capture different search intents.

════════════════════════════════════════════════
RAW BROCHURE/DATASHEET TEXT:
════════════════════════════════════════════════
${text}

════════════════════════════════════════════════
OUTPUT JSON FORMAT (STRICTLY RESPOND WITH JSON ONLY):
{
  "variants": [
    {
      "productName": "Unique search-friendly variant name (e.g. 'Ubiqedge KLEON 4G LTE SIM Industrial Dongle')",
      "price": 4500, // Estimate price or set null. Vary slightly (within +/- 15%) across variants to attract different buyers.
      "unit": "Piece",
      "categorySuggestion": "Recommended IndiaMART category name",
      "description": "Unique paraphrased description (2-3 sentences) emphasizing a specific feature or use case.",
      "specifications": {
        "Brand": "Ubiqedge",
        "Model": "...",
        "Connectivity": "...",
        "Ports": "...",
        "Power Supply": "...",
        "Mounting": "...",
        "Operating Temperature": "...",
        "Compliance": "..."
      }
    }
    // ... exactly ${count} items in the array
  ]
}

════════════════════════════════════════════════
INSTRUCTIONS:
1. Generate EXACTLY ${count} variations. Each variation must have a distinct, search-friendly productName targeting different search keywords (e.g., 'SIM Modems', '4G Cellular Gateways', 'Serial to 4G Dongle', 'KLEON Industrial Modem', 'Ubiqedge 4G SIM Adapter', 'IoT Device Gateway', etc.).
2. The descriptions must be unique and paraphrased, each highlighting a different set of features or application areas.
3. Slightly vary the pricing (e.g. within +/- 15% range) based on the device type to capture different buyer filters.
4. Keep the specifications mostly consistent with the datasheet, but formulate them cleanly.
5. Respond ONLY with the raw JSON object. Do not wrap in markdown blocks.
`.trim();

  // Set high tokens limit for 30 variants
  const maxTok = 8000;
  const tokenParam = MODEL.startsWith("gpt-5") || MODEL.startsWith("o")
    ? { max_completion_tokens: maxTok }
    : { max_tokens: maxTok };

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    response_format: { type: "json_object" },
    ...tokenParam
  });

  const rawText = response.choices[0].message.content.trim();
  const parsed = JSON.parse(rawText);

  if (!parsed.variants || !Array.isArray(parsed.variants)) {
    throw new Error("Invalid response format: 'variants' array not found");
  }

  // Sanitization
  parsed.variants.forEach(variant => {
    if (variant.productName) variant.productName = sanitizeText(variant.productName);
    if (variant.description) variant.description = sanitizeText(variant.description);
    if (variant.specifications) {
      for (const key in variant.specifications) {
        variant.specifications[key] = sanitizeText(variant.specifications[key]);
      }
    }
  });

  return parsed.variants;
}

/**
 * Replaces non-ASCII special characters with standard ASCII equivalents.
 */
function sanitizeText(text) {
  if (!text) return text;
  return String(text)
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")   // curly single quotes -> '
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')   // curly double quotes -> "
    .replace(/[\u2013]/g, '-')                       // en-dash -> hyphen
    .replace(/[\u2014\u2015]/g, ' - ')               // em-dash -> " - "
    .replace(/[\u2026]/g, '...')                     // ellipsis -> ...
    .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, '-') // bullet points -> -
    .replace(/[\u00A0]/g, ' ')                       // non-breaking space -> space
    .replace(/[^\x00-\x7F]/g, '');                   // strip any remaining non-ASCII
}

module.exports = {
  parsePdf,
  extractProductDetails,
  extractProductVariants,
  AI_AVAILABLE,
  MODEL
};
