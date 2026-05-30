const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  console.log("📄 Starting JD extraction...");

  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const context = browser.contexts()[0];
  const page = context.pages()[0];

  const jobQueue = [
    {
      title: "Social Media Manager",
      company: "Amar Enterprises",
      jobLink:
        "https://internshala.com/job/detail/social-media-manager-job-in-mumbai-at-amar-enterprises1764007462",
    },
    {
      title: "Social Media Manager",
      company: "Clvr Media Agency",
      jobLink:
        "https://click.appcast.io/t/CjTp1JilJ6IcG1w0E9Xg7MO8xCMioLLwu5xj4E2oX_0wkqNihawmidWgnOO89l323wh_U2ygHJZ_8v0tEm0eGg==",
    },
  ];

  const extractedJobs = [];

  for (const job of jobQueue) {
    console.log(`🔍 Extracting JD: ${job.title} @ ${job.company}`);

    try {
      await page.goto(job.jobLink, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);

      const pageText = await page.innerText("body");

      // 🚨 Detect crash / 404 pages
      if (
        pageText.includes("Uh oh!") ||
        pageText.includes("could not be found") ||
        pageText.includes("ERROR 404")
      ) {
        throw new Error("JD not available (404 or external)");
      }

      const jdText = await page.$eval(
        ".internship_details",
        el => el.innerText.trim()
      );

      extractedJobs.push({
        ...job,
        jdText,
        status: "jd_extracted",
        extractedAt: new Date().toISOString(),
      });

      console.log("✅ JD extracted");
    } catch (err) {
      extractedJobs.push({
        ...job,
        status: "jd_failed",
        reason: err.message,
        extractedAt: new Date().toISOString(),
      });

      console.log("⚠️ JD unavailable, skipped safely");
    }
  }

  fs.writeFileSync(
    "jd-dump.json",
    JSON.stringify(extractedJobs, null, 2)
  );

  console.log("\n📦 JD extraction complete");
  console.log("📁 Saved to jd-dump.json");
})();
