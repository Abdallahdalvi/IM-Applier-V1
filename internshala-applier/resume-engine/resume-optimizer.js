const fs = require("fs");
const path = require("path");

const resume = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "structured-resume.json"),
    "utf-8"
  )
);

const matchResults = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "match-results.json"),
    "utf-8"
  )
);

const jdDump = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "jd-dump.json"),
    "utf-8"
  )
);

const normalize = t =>
  t.toLowerCase().replace(/[^a-z0-9 ]/g, "");

const MAX_EXPANSION_PER_BULLET = 15; // words

const optimizedResumes = [];

for (const result of matchResults) {
  if (result.decision !== "auto_apply") continue;

  const jd = jdDump.find(
    j => j.company === result.company && j.status === "jd_extracted"
  );
  if (!jd) continue;

  const jdText = normalize(jd.jdText);

  // Reorder skills (allowed)
  const reorderedSkills = [...resume.skills].sort((a, b) =>
    jdText.includes(normalize(b)) ? 1 : -1
  );

  // Enhance experience carefully
  const enhancedExperience = resume.experience.map(line => {
    let enhanced = line;

    // find relevant skills already in resume
    const relatedSkills = reorderedSkills.filter(skill =>
      jdText.includes(normalize(skill))
    ).slice(0, 2);

    if (
      relatedSkills.length > 0 &&
      !line.toLowerCase().includes(relatedSkills[0].toLowerCase())
    ) {
      const addition = ` using ${relatedSkills.join(" and ")}`;
      const wordCount =
        addition.split(" ").length + line.split(" ").length;

      if (wordCount <= line.split(" ").length + MAX_EXPANSION_PER_BULLET) {
        enhanced = line + addition;
      }
    }

    return enhanced;
  });

  const optimized = {
    meta: {
      ...resume.meta,
      optimizedFor: `${result.title} @ ${result.company}`,
      optimizedAt: new Date().toISOString(),
      optimizationLevel: "controlled-enhancement"
    },
    summary: resume.summary,
    skills: reorderedSkills,
    experience: enhancedExperience,
    education: resume.education,
    certifications: resume.certifications,
    tools: resume.tools,
    integrityScore: 0.8
  };

  const fileName = `optimized-${result.company
    .toLowerCase()
    .replace(/\s+/g, "-")}.json`;

  fs.writeFileSync(
    path.join(__dirname, "output", fileName),
    JSON.stringify(optimized, null, 2)
  );

  optimizedResumes.push(optimized);
}

console.log("✅ Resume optimization completed (controlled enhancement)");
console.log("📁 Files saved in resume-engine/output/");
