/**
 * product-engine/run-indiamart.js
 *
 * Pipeline runner - executes all three stages in correct sequence:
 *  1. Product Discovery -> reads PDFs in brochures/, calls OpenAI -> product-queue.json
 *  2. Product Filter -> validates extracted products -> product-queue-filtered.json
 *  3. Auto-Listing -> lists products on IndiaMART seller panel via Playwright
 */

const { execSync } = require("child_process");
const path = require("path");

function run(script) {
  console.log(`\n▶  Running: ${path.basename(script)}`);
  try {
    execSync(`node "${script}"`, { stdio: "inherit" });
  } catch (err) {
    console.error(`❌ Execution failed for script: ${path.basename(script)}`);
    throw err;
  }
}

(async () => {
  try {
    console.log("🚀 STARTING INDIAMART SELLER PIPELINE");

    /* ── Stage 1: Discover products ──────────────────────── */
    run(path.join(__dirname, "..", "indiamart-product-discovery.js"));

    /* ── Stage 2: Filter products ────────────────────────── */
    run(path.join(__dirname, "product-filter.js"));

    console.log("\n⏳ Waiting 3 seconds before auto-listing phase...");
    await new Promise(r => setTimeout(r, 3000));

    /* ── Stage 3: Auto-listing ───────────────────────────── */
    run(path.join(__dirname, "indiamart-auto-list.js"));

    console.log("\n✅ INDIAMART PIPELINE COMPLETED SUCCESSFULLY");
  } catch (err) {
    console.error("\n❌ INDIAMART PIPELINE FAILED");
    console.error(err.message);
    process.exit(1);
  }
})();
