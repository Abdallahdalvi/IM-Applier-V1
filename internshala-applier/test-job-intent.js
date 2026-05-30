const { loadJobIntent } = require("./job-config");
const { validateIntent } = require("./job-config-validator");

const intent = loadJobIntent();
validateIntent(intent);

console.log("✅ Job intent loaded and validated");
console.log(intent);
