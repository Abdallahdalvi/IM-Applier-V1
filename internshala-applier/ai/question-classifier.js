/**
 * Question Classifier
 *
 * Determines the semantic type of a job-application form question so that
 * the Answer Engine can route it to either the Rule Engine or the AI.
 *
 * Types:
 *   salary, notice_period, joining_days, location, availability,
 *   yes_no, rating, experience, months_experience, cover_letter, explanation (default -> AI)
 */

function classifyQuestion(question) {
  // Normalize: lowercase, replace hyphens/underscores/punctuation with spaces, collapse spaces
  const q = question.toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[?,.!:;()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  /* ── Portfolio / Links (always handle via AI to extract URL from resume) ── */
  if (
    q.includes("portfolio") ||
    q.includes("link") ||
    q.includes("website") ||
    q.includes("github") ||
    q.includes("linkedin") ||
    q.includes("behance") ||
    q.includes("dribbble") ||
    q.includes("work sample") ||
    q.includes("drive") ||
    q.includes("url")
  ) {
    return "explanation";
  }

  /* ── Yes / No ───────────────────────────────────────────── */
  if (
    q.startsWith("are you") ||
    q.startsWith("do you") ||
    q.startsWith("have you") ||
    q.startsWith("can you") ||
    q.startsWith("will you") ||
    q.startsWith("would you") ||
    q.startsWith("is ") ||
    q.startsWith("are ") ||
    q.startsWith("do ") ||
    q.startsWith("does ") ||
    q.startsWith("did ") ||
    q.startsWith("can ") ||
    q.startsWith("could ") ||
    q.startsWith("will ") ||
    q.startsWith("would ") ||
    q.startsWith("have ") ||
    q.startsWith("has ") ||
    q.startsWith("should ") ||
    q.startsWith("agree ") ||
    q.includes("willing to") ||
    q.includes("comfortable with") ||
    q.includes("comfortable working") ||
    q.includes("ok with") ||
    q.includes("okay with") ||
    q.includes("agree to") ||
    q.includes("ready to") ||
    q.includes("open to") ||
    q.includes("okay for you") ||
    q.includes("ok for you") ||
    q.includes("fine for you") ||
    q.includes("comfortable for you") ||
    q.includes("location okay") ||
    q.includes("location ok") ||
    q.includes("is the location okay") ||
    q.includes("is the location ok") ||
    q.includes("is location okay") ||
    q.includes("is location ok") ||
    // Internshala specifics
    q.includes("working from the office") ||
    q.includes("working from office") ||
    q.includes("work from office") ||
    q.includes("relocate") ||
    q.includes("shift") ||
    q.includes("night shift") ||
    q.includes("weekend") ||
    q.includes("laptop") ||
    q.includes("own device")
  ) {
    return "yes_no";
  }

  /* ── Structural / factual ───────────────────────────────── */
  if (q.includes("salary") || q.includes("ctc") || q.includes("compensation") || q.includes("stipend expectation")) {
    return "salary";
  }

  if (q.includes("notice period")) {
    return "notice_period";
  }

  if (
    (q.includes("join") && q.includes("day")) ||
    q.includes("joining time") ||
    q.includes("joining date") ||
    q.includes("how soon") ||
    q.includes("start date")
  ) {
    return "joining_days";
  }

  if (q.includes("where do you stay") || q.includes("current location") || q.includes("current city") || q.includes("residing") || q.includes("city") || q.includes("location") || q.includes("reside")) {
    return "location";
  }

  if (q.includes("available") || q.includes("availability") || q.includes("immediate")) {
    return "availability";
  }

  /* ── Ratings / Skills ───────────────────────────────────── */
  if (
    q.includes("rate yourself") ||
    q.includes("rate your") ||
    q.includes("on a scale") ||
    q.includes("proficiency") ||
    q.includes("out of 10") ||
    q.includes("out of 5") ||
    (q.includes("rate") && q.includes("skill"))
  ) {
    return "rating";
  }

  /* ── Experience (factual short) ─────────────────────────── */
  if (
    q.includes("years of experience") ||
    q.includes("how many years") ||
    q.includes("total experience") ||
    q.includes("work experience in years") ||
    (q.includes("experience") && (q.includes("specify") || q.includes("mention")) && !q.includes("describe") && !q.includes("explain"))
  ) {
    return "experience";
  }

  /* ── Experience in months ───────────────────────────────── */
  if (
    q.includes("months of experience") ||
    q.includes("how many months") ||
    q.includes("month of experience") ||
    (q.includes("months") && q.includes("experience"))
  ) {
    return "months_experience";
  }

  /* ── Numeric-only fields ────────────────────────────────── */
  if (
    q.includes("enter numeric") ||
    q.includes("numeric value")
  ) {
    return "months_experience";  // treat generic numeric as months-style numeric
  }

  /* ── Cover letter (long-form) ───────────────────────────── */
  if (
    q.includes("cover letter") ||
    q.includes("write a letter") ||
    q.includes("introduce yourself") ||
    q.includes("tell us about yourself")
  ) {
    return "cover_letter";
  }

  /* ── Default: open-ended explanation → goes to AI ───────── */
  return "explanation";
}

module.exports = { classifyQuestion };
