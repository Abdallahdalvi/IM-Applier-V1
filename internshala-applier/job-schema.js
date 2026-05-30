function createJob({
  title,
  company,
  location,
  jobLink,
  platform
}) {
  return {
    id: Buffer.from(
      `${company}-${title}-${platform}`
    ).toString("base64"),
    title,
    company,
    location,
    jobLink,
    platform,
    status: "discovered", // discovered | applied | skipped
    discoveredAt: new Date().toISOString()
  };
}

module.exports = { createJob };
