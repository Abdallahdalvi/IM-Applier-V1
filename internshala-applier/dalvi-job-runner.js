const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const queuePath = path.join(__dirname, "job-queue.json");

(async () => {
  if (!fs.existsSync(queuePath)) {
    console.error("❌ job-queue.json not found");
    return;
  }

  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const context = browser.contexts()[0];
  const page = context.pages()[0];

  const queue = JSON.parse(fs.readFileSync(queuePath, "utf-8"));

  for (const job of queue) {
    if (job.status !== "pending") {
      continue; // 🔥 KEY LINE
    }

    console.log(`▶ Processing: ${job.company}`);

    try {
      await page.goto(job.jobLink, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);

      const currentUrl = page.url();

      // 🔍 Detect redirect
      if (!currentUrl.includes("internshala.com")) {
        console.log("⚠️ External redirect detected, skipping");

        job.status = "skipped_external";
        job.skippedAt = new Date().toISOString();
        job.redirectUrl = currentUrl;

        continue; // 👉 MOVE TO NEXT JOB
      }

      // ✅ Internshala native job
      console.log("✅ Internshala job detected");

      job.status = "ready_for_apply";
      job.checkedAt = new Date().toISOString();

      // (Apply logic comes later)

    } catch (err) {
      console.log("❌ Error, skipping job");

      job.status = "skipped_error";
      job.error = err.message;
    }
  }

  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  console.log("✅ Job runner finished");
})();
