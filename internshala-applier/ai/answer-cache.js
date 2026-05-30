/**
 * AI Answer Cache
 *
 * Saves expensive AI-generated answers (cover letters, "why hire me", etc.)
 * so identical or very-similar questions for the same company+role are
 * answered from disk instead of calling the OpenAI API again.
 *
 * Cache key = question_type + "::" + company (lowercased) + "::" + role (lowercased)
 *             + "::" + normalised question text
 *
 * This means:
 *  ✅ Same question for the same job → reused (credits saved)
 *  ✅ Same question for a DIFFERENT company → new API call (no contamination)
 *  ✅ Structural answers (salary, notice period) → always from rule engine, never cached here
 */

const fs   = require("fs");
const path = require("path");

const CACHE_PATH = path.join(__dirname, "answer-cache.json");

/* ── helpers ──────────────────────────────────────────────── */

function normaliseQuestion(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120); // cap length so key stays reasonable
}

function makeCacheKey(type, company, role, question) {
  const c = (company || "unknown").toLowerCase().trim();
  const r = (role    || "unknown").toLowerCase().trim();
  const q = normaliseQuestion(question || "");
  return `${type}::${c}::${r}::${q}`;
}

/* ── load / save ──────────────────────────────────────────── */

function loadCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
    }
  } catch { /* corrupted – start fresh */ }
  return {};
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.warn("⚠️  Could not write answer cache:", err.message);
  }
}

/* ── public API ───────────────────────────────────────────── */

/**
 * Try to get a previously generated answer from the disk cache.
 *
 * @param {string} type     – question type (explanation, experience, rating…)
 * @param {string} company  – hiring company name
 * @param {string} role     – job title / role
 * @param {string} question – raw question text
 * @returns {string|null}   – cached answer or null if not found
 */
function getCached(type, company, role, question) {
  const cache = loadCache();
  const key   = makeCacheKey(type, company, role, question);
  const entry = cache[key];
  if (entry) {
    console.log(`💾  Cache HIT  [${type}] "${question.slice(0, 60)}…"`);
    return entry.answer;
  }
  return null;
}

/**
 * Store a newly generated AI answer in the disk cache.
 *
 * @param {string} type
 * @param {string} company
 * @param {string} role
 * @param {string} question
 * @param {string} answer
 */
function setCached(type, company, role, question, answer) {
  const cache = loadCache();
  const key   = makeCacheKey(type, company, role, question);
  cache[key]  = {
    answer,
    company,
    role,
    type,
    question: question.slice(0, 200),
    cachedAt: new Date().toISOString()
  };
  saveCache(cache);
  console.log(`💾  Cache MISS – stored  [${type}] for ${company}`);
}

/**
 * Clear all cached answers (useful before a fresh run).
 */
function clearCache() {
  saveCache({});
  console.log("🗑️  Answer cache cleared.");
}

module.exports = { getCached, setCached, clearCache };
