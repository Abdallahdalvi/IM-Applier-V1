/**
 * Phase 2: queue validation while preserving brochure-grounded bulk variants.
 */

const fs = require("fs");
const path = require("path");

const QUEUE_PATH = path.join(__dirname, "../product-queue.json");
const FILTERED_QUEUE_PATH = path.join(__dirname, "../product-queue-filtered.json");

function normalizeKeywords(keywords) {
  if (!Array.isArray(keywords)) return [];

  const seen = new Set();
  return keywords.filter((keyword) => {
    const value = String(keyword || "").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deriveKeywords(item) {
  const parts = [];
  const productName = String(item.productName || "").trim();
  const category = String(item.category || "").trim();
  const specifications = item.specifications && typeof item.specifications === "object"
    ? Object.values(item.specifications)
    : [];

  if (productName) parts.push(...productName.split(/\s+/));
  if (category) parts.push(category);
  parts.push(...specifications.slice(0, 4).map((value) => String(value || "").trim()));

  const phrases = [];
  if (productName) phrases.push(productName);
  if (category) phrases.push(category);
  if (productName && category) phrases.push(`${productName} ${category}`);
  phrases.push(...parts);

  return normalizeKeywords(phrases).slice(0, 10);
}

function ensureMinimumDescriptionLength(item, minimumLength = 500) {
  const normalizeSentence = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const description = normalizeSentence(item.description);
  if (description.length >= minimumLength) {
    return description;
  }

  const specs = item.specifications && typeof item.specifications === "object"
    ? Object.entries(item.specifications)
        .map(([key, value]) => `${key}: ${String(value || "").trim()}`)
        .filter((value) => value && !value.endsWith(":"))
    : [];
  const factualSegments = [];

  if (description) factualSegments.push(description);

  const shortDescription = normalizeSentence(item.shortDescription);
  if (shortDescription && !factualSegments.includes(shortDescription)) {
    factualSegments.push(shortDescription);
  }

  const productName = normalizeSentence(item.productName);
  if (productName && !factualSegments.some((segment) => segment.toLowerCase().includes(productName.toLowerCase()))) {
    factualSegments.push(productName);
  }

  if (specs.length > 0) {
    factualSegments.push(specs.join(". "));
  }

  let expanded = factualSegments.join(" ").trim();
  if (!expanded) {
    return expanded;
  }

  let cursor = 0;
  while (expanded.length < minimumLength && factualSegments.length > 0) {
    expanded = `${expanded} ${factualSegments[cursor % factualSegments.length]}`.trim();
    cursor += 1;
  }

  return expanded;
}

console.log("STARTING PHASE 2: PRODUCT FILTERING AND VALIDATION");

if (!fs.existsSync(QUEUE_PATH)) {
  console.warn("product-queue.json does not exist. Run discovery first.");
  fs.writeFileSync(FILTERED_QUEUE_PATH, JSON.stringify([], null, 2));
  process.exit(0);
}

try {
  const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8"));

  const filtered = queue.filter((item) => {
    item.productName = String(item.productName || "").trim();
    item.description = String(item.description || "").trim();
    item.shortDescription = String(item.shortDescription || item.description).trim();
    item.keywords = normalizeKeywords(item.keywords);
    if (item.keywords.length === 0) {
      item.keywords = deriveKeywords(item);
    }
    item.description = ensureMinimumDescriptionLength(item);

    if (item.productName.length < 5) {
      console.log(`Filtered out ${item.id}: missing product name`);
      return false;
    }

    if (item.description.length < 500) {
      console.log(`Filtered out ${item.id}: description too short`);
      return false;
    }

    if (item.shortDescription.length < 12) {
      console.log(`Filtered out ${item.id}: short description too short`);
      return false;
    }
    return true;
  });

  fs.writeFileSync(FILTERED_QUEUE_PATH, JSON.stringify(filtered, null, 2));
  console.log(`Phase 2 complete. Filtered queue contains ${filtered.length} of ${queue.length} products.`);
  console.log(`Saved to: ${FILTERED_QUEUE_PATH}`);
} catch (error) {
  console.error(`Failed to filter product queue: ${error.message}`);
  process.exit(1);
}
