function validateIntent(intent) {
  if (!intent.role) throw new Error("Role is required");
  if (!intent.location) throw new Error("Location is required");

  if (
    !intent.dailyApplicationLimit ||
    intent.dailyApplicationLimit > 20
  ) {
    throw new Error("Daily application limit must be <= 20");
  }

  if (
    intent.resumePolicy.minimumSimilarity < 0.75
  ) {
    throw new Error("Resume similarity must be >= 75%");
  }

  return true;
}

module.exports = { validateIntent };
