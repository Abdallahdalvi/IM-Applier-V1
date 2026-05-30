/**
 * Step 3.4 – JD vs Resume Matcher
 * Testing Mode: 0% cutoff (ALL jobs pass)
 */

const fs = require("fs");
const path = require("path");

// Paths
const STRUCTURED_RESUME_PATH = path.join(__dirname, "structured-resume.json");
const JD_DUMP_PATH = path.join(__dirname, "../jd-dump.json");
const OUTPUT_PATH = path.join(__dirname, "match-results.json");

// Safety check
if (!fs.existsSync(STRUCTURED_RESUME_PATH)) {
  console.error("❌ structured-resume.json not found");
  process.exit(1);
}

if (!fs.existsSync(JD_DUMP_PATH)) {
  console.error("❌ jd-dump.json not found");
  process.exit(1);
}

// Load files
const resume = JSON.parse(fs.readFileSync(STRUCTURED_RESUME_PATH, "utf8"));
const jobs = JSON.parse(fs.readFileSync(JD_DUMP_PATH, "utf8"));

// Keyword base (simple + safe)
const resumeText = JSON.stringify(resume).toLowerCase();

function calculateMatchScore(jdText) {
  if (!jdText || typeof jdText !== "string") return 0;

  const words = jdText
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(" ")
    .filter(w => w.length > 3);

  if (words.length === 0) return 0;

  let matched = 0;

  for (const word of words) {
    if (resumeText.includes(word)) {
      matched++;
    }
  }

  return Math.round((matched / words.length) * 100);
}

// 🔥 TESTING MODE: NO CUTOFF
const AUTO_APPLY_THRESHOLD = 0;

const results = [];

for (const job of jobs) {
  const jdText =
    job.jdText ||
    job.description ||
    job.summary ||
    "";

  const score = calculateMatchScore(jdText);

  results.push({
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    platform: job.platform,
    jobLink: job.jobLink,
    matchScore: score,
    decision: "auto_apply", // forced for testing
    testedAt: new Date().toISOString()
  });
}

// Save output
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

console.log("✅ Match scoring completed");
console.log(`📦 Total jobs processed: ${results.length}`);
console.log(`📁 Saved to ${OUTPUT_PATH}`);
