const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

const user = process.env.DALVI_USER || "default";
const userDir = path.join(__dirname, "users", user);

const pdfPath = path.join(userDir, "resume.pdf");
const txtPath = path.join(userDir, "resume.txt");
const configPath = path.join(userDir, "config.json");

console.log(`\n👤 Preparing environment for user: ${user}`);

if (!fs.existsSync(configPath)) {
  console.error(`❌ User config not found at: ${configPath}`);
  console.error("Please create it (you can copy from users/default/config.json).");
  process.exit(1);
}

(async () => {
  if (fs.existsSync(pdfPath)) {
    console.log(`📄 Found resume.pdf for ${user}, parsing...`);
    try {
      const buffer = fs.readFileSync(pdfPath);
      const data = await pdfParse(buffer);
      let text = data.text.trim();

      // Scan PDF binary buffer for hyperlinks (like LinkedIn and Canva/Google Drive portfolio)
      try {
        const binaryStr = buffer.toString('binary');
        const matches = binaryStr.match(/https?:\/\/[^\s\)\(<>]+/g);
        if (matches) {
          const uniqueLinks = Array.from(new Set(matches));
          const linkedin = uniqueLinks.find(l => l.includes('linkedin.com/in/'));
          const portfolio = uniqueLinks.find(l => l.includes('canva.com/') || l.includes('drive.google.com/'));
          
          if (linkedin) {
            text = text.replace(/LinkedIn\b/gi, `LinkedIn: ${linkedin}`);
          }
          if (portfolio) {
            text = text.replace(/Portfolio\b/gi, `Portfolio: ${portfolio}`);
          }
        }
      } catch (err) {
        console.warn("Could not scan binary links:", err.message);
      }

      fs.writeFileSync(txtPath, text);
      console.log(`✅ Extracted resume text to ${txtPath}`);
    } catch (err) {
      console.error(`❌ Failed to parse resume.pdf:`, err.message);
      process.exit(1);
    }
  } else {
    console.log(`⚠️ resume.pdf not found in ${userDir}.`);
    if (fs.existsSync(txtPath)) {
      console.log(`✅ Using existing resume.txt instead.`);
    } else {
      // Fallback to root resume.txt if running "default" and local missing
      const rootResume = path.join(__dirname, "resume.txt");
      if (fs.existsSync(rootResume)) {
        fs.copyFileSync(rootResume, txtPath);
        console.log(`✅ Copied root resume.txt to ${userDir}/resume.txt`);
      } else {
        console.error(`❌ No resume found. Please provide a resume.pdf or resume.txt in ${userDir}`);
        process.exit(1);
      }
    }
  }
})();
