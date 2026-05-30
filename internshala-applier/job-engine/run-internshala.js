/**
 * run-internshala.js
 *
 * Pipeline runner – executes all three stages in the correct order:
 *  1. Discovery  → job-queue.json
 *  2. Filter     → job-queue-filtered.json   ← was previously skipped
 *  3. Auto-Apply ← reads from job-queue-filtered.json
 */

const { execSync } = require("child_process");
const path = require("path");

function run(script) {
  console.log(`\n▶  Running: ${path.basename(script)}`);
  execSync(`node "${script}"`, { stdio: "inherit" });
}

(async () => {
  try {
    console.log("🚀  STARTING INTERNSHALA PIPELINE");

    /* ── Stage 1: Discover jobs ──────────────────────────── */
    run(path.join(__dirname, "..", "dalvi-internshala-discovery.js"));

    /* ── Stage 2: Filter jobs ────────────────────────────── */
    // ✅ FIX: this step was missing — applier now works on filtered queue only
    run(path.join(__dirname, "job-filter.js"));

    console.log("\n⏳  Waiting 3 seconds before apply phase...");
    await new Promise(r => setTimeout(r, 3000));

    /* ── Stage 3: Auto-apply ─────────────────────────────── */
    run(path.join(__dirname, "internshala-auto-apply.js"));

    console.log("\n✅  PIPELINE COMPLETED SUCCESSFULLY");
  } catch (err) {
    console.error("\n❌  PIPELINE FAILED");
    console.error(err.message);
    process.exit(1);
  }
})();
