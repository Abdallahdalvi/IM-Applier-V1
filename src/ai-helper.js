/**
 * src/ai-helper.js
 *
 * AI Helper for extracting brochure-grounded product details from PDFs.
 * The prompts in this file intentionally forbid invented claims so listings
 * stay tied to the uploaded brochure text.
 */

require("dotenv").config();
const fs = require("fs");
const OpenAI = require("openai");
const pdfParse = require("pdf-parse");

const rawApiKey = (process.env.OPENAI_API_KEY || "").trim();
const AI_AVAILABLE = Boolean(rawApiKey && rawApiKey !== "" && !rawApiKey.startsWith("sk-xxx"));
const MODEL = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();

let client = null;
if (AI_AVAILABLE) {
  client = new OpenAI({ apiKey: rawApiKey });
} else {
  console.warn("OPENAI_API_KEY is not set. AI extraction will be disabled.");
}

const BROCHURE_ONLY_RULES = [
  "The brochure text is the only allowed source of truth.",
  "Use only details explicitly present in the brochure text.",
  "Do not guess, infer, embellish, or add outside knowledge.",
  "Do not introduce any technical term, feature, protocol, application, compliance, or use case unless it is clearly present in the brochure text.",
  "If a detail is not explicitly supported by the brochure text, use null, an empty array, or an empty object instead of guessing.",
  "If the brochure contains a clear product heading or exact product name, use that exact wording or a very close brochure-faithful wording for the product title.",
  "Do not create synthetic product names by merging multiple brochure headings, components, or solution names unless the brochure itself presents them together as one named product.",
  "If the brochure mentions multiple products or components, keep each extracted listing tied to one explicit brochure-named product or one explicit brochure-named solution.",
  "Avoid invented terms such as SCADA, MQTT, LoRa, Wi-Fi, LAN, cloud portal names, or similar unless they are present in the brochure text.",
  "Keep the wording factual and brochure-grounded."
].join("\n");

function getTokenParam(maxTokens) {
  return MODEL.startsWith("gpt-5") || MODEL.startsWith("o")
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };
}

function buildDetailsPrompt(text) {
  return `
You are extracting product listing data from a brochure or datasheet for IndiaMART.
${BROCHURE_ONLY_RULES}

BROCHURE TEXT:
${text}

RESPOND WITH JSON ONLY IN THIS SHAPE:
{
  "productName": "Brochure-grounded product name using only brochure terms",
  "price": 4500,
  "unit": "Piece",
  "categorySuggestion": "Closest brochure-grounded category or null",
  "shortDescription": "One short factual summary using only brochure-supported details",
  "keywords": ["short brochure-grounded phrases only"],
  "description": "500-900 character factual description using only brochure-supported details",
  "specifications": {
    "Brand": "...",
    "Model": "...",
    "Connectivity": "...",
    "Ports": "...",
    "Power Supply": "...",
    "Mounting": "...",
    "Operating Temperature": "...",
    "Compliance": "..."
  }
}

RULES:
1. productName must use only brochure-supported words and details, and should prefer the exact brochure product heading when one is clearly present.
2. If the brochure shows multiple named products or components, choose one explicit brochure-named product or one explicit brochure-named solution. Do not blend unrelated names together.
3. shortDescription, keywords, and description must stay factual and must not contain invented marketing or technical claims.
4. If the brochure does not explicitly state a value, do not create one.
5. Keep specifications concise and brochure-supported.
6. Description should target roughly 500-900 characters using only brochure-backed facts.
7. Respond only with raw JSON.
  `.trim();
}

function buildVariantsPrompt(text, count) {
  return `
You are generating bulk IndiaMART listing variants from a brochure or datasheet.
${BROCHURE_ONLY_RULES}
Accuracy is more important than variety.
Create as much safe variation as the brochure supports before you repeat exact wording.
It is acceptable if multiple variants reuse the same title, the same description, or very similar wording, but avoid returning ${count} fully identical entries unless the brochure truly leaves no safer alternative.
Safe variation means changing emphasis, ordering, and phrasing using brochure words only. Do not add new facts.

BROCHURE TEXT:
${text}

RESPOND WITH JSON ONLY IN THIS SHAPE:
{
  "variants": [
    {
      "productName": "Brochure-grounded listing title using only brochure terms",
      "price": 4500,
      "unit": "Piece",
      "categorySuggestion": "Closest brochure-grounded category or null",
      "shortDescription": "Short factual summary using only brochure-supported facts",
      "keywords": ["short brochure-grounded phrases only"],
      "description": "500-900 character factual description using only brochure-supported facts",
      "specifications": {
        "Brand": "...",
        "Model": "...",
        "Connectivity": "...",
        "Ports": "...",
        "Power Supply": "...",
        "Mounting": "...",
        "Operating Temperature": "...",
        "Compliance": "..."
      }
    }
  ]
}

RULES:
1. Generate exactly ${count} variants.
2. Every title, shortDescription, description, keyword, and specification must stay inside brochure-supported wording and facts.
3. Prefer exact brochure product headings for titles whenever a clear heading is present.
4. If the brochure contains multiple named products or components, each variant must stay tied to one explicit brochure-named product or one explicit brochure-named solution. Do not merge names or claims from unrelated brochure sections.
5. Do not invent missing use cases, protocols, compliances, software, industries, integrations, or marketing claims.
6. If a field is not explicitly supported by the brochure, keep it null, empty, or omitted instead of guessing.
7. Prefer that each variant differ from the others in at least one of: title wording, shortDescription wording, description sentence order, or keyword mix, as long as every word remains brochure-grounded.
8. It is acceptable for 2 or more variants to share the same title or same description if that is safer and more accurate.
9. Descriptions should target roughly 500-900 characters using only brochure-backed facts.
10. Keywords should be short brochure-grounded phrases, not invented SEO jargon.
11. Price and unit must come from the brochure. If absent, return null.
12. Respond only with raw JSON.
  `.trim();
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
 * Uses OpenAI to extract structured product listing details from raw brochure text.
 * @param {string} text - Brochure or datasheet text contents
 * @returns {Promise<Object>} - Extracted product details matching the schema
 */
async function extractProductDetails(text) {
  if (!AI_AVAILABLE || !client) {
    throw new Error("AI extraction is unavailable. Please configure OPENAI_API_KEY in .env.");
  }

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: buildDetailsPrompt(text) }],
    temperature: 0,
    response_format: { type: "json_object" },
    ...getTokenParam(2500)
  });

  const rawText = response.choices[0].message.content.trim();
  const parsed = JSON.parse(rawText);

  if (parsed.productName) parsed.productName = sanitizeText(parsed.productName);
  if (parsed.shortDescription) parsed.shortDescription = sanitizeText(parsed.shortDescription);
  if (parsed.keywords) parsed.keywords = sanitizeKeywords(parsed.keywords);
  if (parsed.description) parsed.description = sanitizeText(parsed.description);
  if (parsed.categorySuggestion) parsed.categorySuggestion = sanitizeText(parsed.categorySuggestion);
  if (parsed.specifications && typeof parsed.specifications === "object") {
    for (const key of Object.keys(parsed.specifications)) {
      parsed.specifications[key] = sanitizeText(parsed.specifications[key]);
    }
  }

  return parsed;
}

/**
 * Uses OpenAI to generate multiple brochure-grounded variants of a product.
 * @param {string} text - Brochure or datasheet text contents
 * @param {number} count - Target number of variants to generate
 * @returns {Promise<Array>} - Array of extracted variants
 */
async function extractProductVariants(text, count = 30) {
  if (!AI_AVAILABLE || !client) {
    throw new Error("AI extraction is unavailable. Please configure OPENAI_API_KEY in .env.");
  }

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: buildVariantsPrompt(text, count) }],
    temperature: 0,
    response_format: { type: "json_object" },
    ...getTokenParam(8000)
  });

  const rawText = response.choices[0].message.content.trim();
  const parsed = JSON.parse(rawText);

  if (!parsed.variants || !Array.isArray(parsed.variants)) {
    throw new Error("Invalid response format: 'variants' array not found");
  }

  return parsed.variants.map((variant, index) => normalizeVariant(variant, index));
}

/**
 * Replaces non-ASCII special characters with standard ASCII equivalents.
 */
function sanitizeText(text) {
  if (!text) return text;
  return String(text)
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013]/g, '-')
    .replace(/[\u2014\u2015]/g, ' - ')
    .replace(/[\u2026]/g, '...')
    .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, '-')
    .replace(/[\u00A0]/g, ' ')
    .replace(/[^\x00-\x7F]/g, '');
}

function sanitizeKeywords(keywords) {
  if (!keywords) return [];

  const list = Array.isArray(keywords)
    ? keywords
    : String(keywords).split(/[,|]/);

  const seen = new Set();
  const normalized = [];

  for (const item of list) {
    const cleaned = sanitizeText(item).trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    normalized.push(cleaned);
  }

  return normalized.slice(0, 10);
}

function normalizeVariant(variant, index) {
  const normalized = { ...variant };

  normalized.productName = sanitizeText(normalized.productName || `Product Variant ${index + 1}`);
  normalized.description = sanitizeText(normalized.description || normalized.productName);
  normalized.shortDescription = sanitizeText(
    normalized.shortDescription
    || normalized.description.split(/[.!?]/)[0]
    || normalized.productName
  );
  normalized.keywords = sanitizeKeywords(normalized.keywords || normalized.productName);
  normalized.categorySuggestion = sanitizeText(normalized.categorySuggestion || "");

  if (!normalized.specifications || typeof normalized.specifications !== "object") {
    normalized.specifications = {};
  }

  for (const key of Object.keys(normalized.specifications)) {
    normalized.specifications[key] = sanitizeText(normalized.specifications[key]);
  }

  return normalized;
}

module.exports = {
  parsePdf,
  extractProductDetails,
  extractProductVariants,
  AI_AVAILABLE,
  MODEL
};
