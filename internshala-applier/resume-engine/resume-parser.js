const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

// 👇 FORCE absolute path
const inputPath = path.resolve(
  __dirname,
  "base",
  "user-resume.pdf"
);

const outputPath = path.resolve(
  __dirname,
  "parsed-resume.json"
);

console.log("📄 Looking for resume at:");
console.log(inputPath);

(async () => {
  try {
    // ✅ Check file exists first
    if (!fs.existsSync(inputPath)) {
      throw new Error("Resume PDF not found at the given path");
    }

    const buffer = fs.readFileSync(inputPath);
    const data = await pdfParse(buffer);

    const result = {
      extractedAt: new Date().toISOString(),
      rawText: data.text
    };

    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

    console.log("✅ Resume text extracted successfully");
    console.log("📁 Saved as resume-engine/parsed-resume.json");
  } catch (err) {
    console.error("❌ Failed to parse resume PDF");
    console.error(err.message);
  }
})();
