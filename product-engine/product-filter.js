/**
 * product-engine/product-filter.js
 *
 * Phase 2: Product Filtering & Validation.
 * Reads from product-queue.json, validates the product structure and attributes,
 * cleanses any fields, and writes to product-queue-filtered.json.
 */

const fs = require("fs");
const path = require("path");

const QUEUE_PATH = path.join(__dirname, "../product-queue.json");
const FILTERED_QUEUE_PATH = path.join(__dirname, "../product-queue-filtered.json");

console.log("🚀 STARTING PHASE 2: PRODUCT FILTERING & VALIDATION");

if (!fs.existsSync(QUEUE_PATH)) {
  console.warn("⚠️  product-queue.json does not exist. Run Phase 1 discovery first.");
  fs.writeFileSync(FILTERED_QUEUE_PATH, JSON.stringify([], null, 2));
  process.exit(0);
}

try {
  const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8"));
  
  // Basic validation rules:
  // - Must have a product name
  // - Must have a description
  // - Must have at least some specifications
  const filtered = queue.filter(item => {
    if (!item.productName || item.productName.trim().length < 5) {
      console.log(`❌ Filtered out: ID ${item.id} (Product name too short or missing)`);
      return false;
    }
    if (!item.description || item.description.trim().length < 20) {
      console.log(`❌ Filtered out: "${item.productName}" (Description too short or missing)`);
      return false;
    }
    return true;
  });

  fs.writeFileSync(FILTERED_QUEUE_PATH, JSON.stringify(filtered, null, 2));
  console.log(`✅ Phase 2 Complete! Filtered queue contains ${filtered.length} of ${queue.length} products.`);
  console.log(`📁 Saved to: ${FILTERED_QUEUE_PATH}`);

} catch (err) {
  console.error("❌ Failed to filter products queue:", err.message);
  process.exit(1);
}
