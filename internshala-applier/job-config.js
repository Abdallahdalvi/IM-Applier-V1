const fs = require("fs");
const path = require("path");

function loadJobIntent() {
  const filePath = path.join(__dirname, "job-intent.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

module.exports = { loadJobIntent };
