const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const INPUT_DIR = path.join(__dirname, "output");
const PDF_DIR = path.join(__dirname, "pdf");
const PHOTO_PATH = path.join(__dirname, "base", "profile.jpg"); // optional

if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR);

const files = fs.readdirSync(INPUT_DIR).filter(f =>
  f.startsWith("optimized-") && f.endsWith(".json")
);

if (files.length === 0) {
  console.log("⚠️ No optimized resumes found");
  process.exit(0);
}

for (const file of files) {
  const resume = JSON.parse(
    fs.readFileSync(path.join(INPUT_DIR, file), "utf-8")
  );

  const doc = new PDFDocument({ margin: 50 });
  const pdfName = file.replace(".json", ".pdf");
  const pdfPath = path.join(PDF_DIR, pdfName);

  doc.pipe(fs.createWriteStream(pdfPath));

  // ===== HEADER =====
  doc.fontSize(20).text(resume.meta.owner);
  doc.fontSize(10).fillColor("gray").text(resume.meta.location);
  doc.fillColor("black").moveDown();

  // Optional photo
  if (resume.meta.photoEnabled && fs.existsSync(PHOTO_PATH)) {
    doc.image(PHOTO_PATH, 450, 40, { width: 80 });
  }

  // ===== SUMMARY =====
  doc.fontSize(13).text("SUMMARY");
  doc.fontSize(10).moveDown(0.3).text(resume.summary);

  // ===== SKILLS =====
  doc.moveDown().fontSize(13).text("SKILLS");
  doc.fontSize(10).moveDown(0.3).text(resume.skills.join(" • "));

  // ===== EXPERIENCE =====
  doc.moveDown().fontSize(13).text("EXPERIENCE");
  resume.experience.forEach(e => {
    doc.fontSize(10).text(`• ${e}`);
  });

  // ===== EDUCATION =====
  if (resume.education?.length) {
    doc.moveDown().fontSize(13).text("EDUCATION");
    resume.education.forEach(e => {
      doc.fontSize(10).text(`• ${e}`);
    });
  }

  // ===== CERTIFICATIONS =====
  if (resume.certifications?.length) {
    doc.moveDown().fontSize(13).text("CERTIFICATIONS");
    resume.certifications.forEach(c => {
      doc.fontSize(10).text(`• ${c}`);
    });
  }

  doc.end();
  console.log(`✅ PDF created: ${pdfName}`);
}

console.log("📁 PDFs saved in resume-engine/pdf/");
