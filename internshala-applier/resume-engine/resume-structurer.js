const fs = require("fs");
const path = require("path");

const rawPath = path.join(__dirname, "parsed-resume.json");
const structuredPath = path.join(__dirname, "structured-resume.json");

const raw = JSON.parse(fs.readFileSync(rawPath, "utf-8"));
const text = raw.rawText;

// simple helpers
const clean = t => t.replace(/\s+/g, " ").trim();
const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

// very safe section detection
const findSection = (keywords) =>
  lines.filter(l =>
    keywords.some(k => l.toLowerCase().includes(k))
  );

const structured = JSON.parse(fs.readFileSync(structuredPath, "utf-8"));

// SUMMARY (first 3–4 meaningful lines)
structured.summary = clean(lines.slice(0, 4).join(" "));

// SKILLS (keyword-based, conservative)
const skillKeywords = [
  "social media",
  "marketing",
  "content",
  "seo",
  "ads",
  "analytics",
  "community",
  "branding",
  "campaign"
];

structured.skills = Array.from(
  new Set(
    lines
      .filter(l =>
        skillKeywords.some(k => l.toLowerCase().includes(k))
      )
      .slice(0, 12)
  )
);

// EXPERIENCE (role/company blocks)
structured.experience = findSection([
  "manager",
  "executive",
  "intern",
  "specialist",
  "associate"
]).slice(0, 6);

// EDUCATION
structured.education = findSection([
  "degree",
  "bachelor",
  "master",
  "college",
  "university"
]).slice(0, 4);

// CERTIFICATIONS / TOOLS
structured.certifications = findSection([
  "certified",
  "certificate",
  "course"
]).slice(0, 5);

structured.tools = findSection([
  "canva",
  "meta",
  "google",
  "wordpress",
  "analytics",
  "figma"
]).slice(0, 6);

// Save
fs.writeFileSync(
  structuredPath,
  JSON.stringify(structured, null, 2)
);

console.log("✅ Resume structured successfully");
console.log("📁 Updated structured-resume.json");
