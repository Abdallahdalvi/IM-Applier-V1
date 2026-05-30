const fs = require("fs");
const path = require("path");

const user = process.env.DALVI_USER || "default";
const configPath = path.join(__dirname, "../users", user, "config.json");

if (!fs.existsSync(configPath)) {
  console.error(`❌ User config not found at: ${configPath}`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const INPUT = path.join(__dirname, "../job-queue.json");
const OUTPUT = path.join(__dirname, "../job-queue-filtered.json");

// Discovery already searches by keyword via URL, so we DON'T filter by
// allowedKeywords here — that was killing 99% of results.
// We only keep:  block keywords (safety net)  +  salary floor.
const BLOCK_KEYWORDS = (config.blockKeywords || []).map(k => k.toLowerCase());
const MIN_SALARY = config.minSalary || 0;

if (!fs.existsSync(INPUT)) {
  console.error(`❌ job-queue.json not found.`);
  process.exit(1);
}

const jobs = JSON.parse(fs.readFileSync(INPUT, "utf-8"));
console.log(`📋 Input: ${jobs.length} discovered jobs`);

let blocked = 0, lowSalary = 0;

const filtered = jobs.filter(job => {
  const text = `${job.title} ${job.company}`.toLowerCase();

  // Block keyword check — reject unwanted roles
  if (BLOCK_KEYWORDS.some(k => text.includes(k))) { blocked++; return false; }

  // Salary check — keep if unknown (0), reject if below minimum
  if (job.salary > 0 && job.salary < MIN_SALARY) { lowSalary++; return false; }

  return true;
});

fs.writeFileSync(OUTPUT, JSON.stringify(filtered, null, 2));

console.log(`✅ Filtered: ${filtered.length} jobs passed`);
if (blocked)   console.log(`   🚫 Blocked by keywords: ${blocked}`);
if (lowSalary) console.log(`   💰 Below min salary (₹${MIN_SALARY}): ${lowSalary}`);
console.log(`   📝 Ready to apply: ${filtered.length}`);
