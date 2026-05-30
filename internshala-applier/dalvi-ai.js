const { chromium } = require("playwright");
require("dotenv").config();
const OpenAI = require("openai");

if (!process.env.OPENAI_API_KEY) {
  throw new Error("❌  OPENAI_API_KEY is not set. Create a .env file with OPENAI_API_KEY=sk-xxxxx");
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

(async () => {
  // Connect to Dalvi
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const context = browser.contexts()[0];
  const page = context.pages()[0];

  // 1️⃣ Force navigation (do NOT assume state)
  await page.goto("https://www.google.com", {
    waitUntil: "networkidle",
  });

  // 2️⃣ Small buffer so Electron finishes rendering
  await page.waitForTimeout(2000);

  // 3️⃣ Find search box safely (no selector wait)
  const searchBox = await page.$(
    'textarea[name="q"], input[name="q"]'
  );

  if (!searchBox) {
    throw new Error("Google search box not found");
  }

  // 4️⃣ Ask AI what to search
  const ai = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-5.4",
    messages: [
      {
        role: "system",
        content: "Respond ONLY in JSON: {\"text\":\"search query\"}",
      },
      {
        role: "user",
        content: "Search for social media manager jobs in Mumbai",
      },
    ],
  });

  const { text } = JSON.parse(ai.choices[0].message.content);

  // 5️⃣ Execute like a human
  await searchBox.click();
  await page.keyboard.type(text, { delay: 120 });
  await page.keyboard.press("Enter");

})();
