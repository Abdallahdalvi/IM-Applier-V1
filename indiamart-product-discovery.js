/**
 * Phase 1: product discovery and variant generation.
 *
 * This runner now treats the UI-selected brochure and image set as the
 * authoritative job definition, which keeps uploads deterministic across runs.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  parsePdf,
  extractProductDetails,
  AI_AVAILABLE
} = require("./src/ai-helper");

const BROCHURES_DIR = path.join(__dirname, "brochures");
const QUEUE_PATH = path.join(__dirname, "product-queue.json");
const CONFIG_PATH = path.join(__dirname, "product-engine/config.json");
const GENERATOR_VERSION = "brochure-only-v10-expanded-unique-variants";

if (!fs.existsSync(BROCHURES_DIR)) {
  fs.mkdirSync(BROCHURES_DIR, { recursive: true });
  console.log(`Created directory: ${BROCHURES_DIR}`);
  console.log("Place brochure PDFs and images in the brochures directory.");
}

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    return fallback;
  }
}

function saveJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function normalizeUniquePaths(paths) {
  const seen = new Set();
  const normalized = [];

  for (const item of paths || []) {
    if (!item) continue;
    const resolved = path.resolve(item);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    normalized.push(resolved);
  }

  return normalized;
}

function hashFile(filePath) {
  return crypto.createHash("md5").update(fs.readFileSync(filePath)).digest("hex");
}

function normalizeKeywords(keywords) {
  const list = Array.isArray(keywords)
    ? keywords
    : String(keywords || "").split(/[,|]/);

  const seen = new Set();
  const normalized = [];

  for (const item of list) {
    const cleaned = String(item || "").trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    normalized.push(cleaned);
  }

  return normalized.slice(0, 10);
}

function deriveKeywordsFromListing(listing) {
  const phrases = [];
  const productName = String(listing.productName || "").trim();
  const shortDescription = String(listing.shortDescription || "").trim();
  const categorySuggestion = String(listing.categorySuggestion || "").trim();
  const specValues = listing.specifications && typeof listing.specifications === "object"
    ? Object.values(listing.specifications).map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  if (productName) phrases.push(productName);
  if (shortDescription) phrases.push(shortDescription);
  if (categorySuggestion) phrases.push(categorySuggestion);
  phrases.push(...productName.split(/\s+/).filter(Boolean));
  phrases.push(...specValues.slice(0, 5));

  return normalizeKeywords(phrases);
}

function sanitizeIndiaMartTitle(value) {
  return String(value || "")
    .replace(/[|:;<>[\]{}!?@#$^*+=~`\\]+/g, " ")
    .replace(/\s*&\s*/g, " & ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 80);
}

function sanitizeDescriptionText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.)])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .trim();
}

function normalizeCanonicalListing(listing) {
  const normalized = {
    ...listing,
    productName: sanitizeIndiaMartTitle(String(listing?.productName || "Brochure Product").trim()),
    description: String(
      listing?.description
      || listing?.shortDescription
      || listing?.productName
      || "Brochure Product"
    ).trim(),
    shortDescription: String(
      listing?.shortDescription
      || listing?.description
      || listing?.productName
      || "Brochure Product"
    ).trim(),
    keywords: normalizeKeywords(listing?.keywords),
    categorySuggestion: String(listing?.categorySuggestion || "").trim(),
    specifications: listing?.specifications && typeof listing.specifications === "object"
      ? { ...listing.specifications }
      : {}
  };

  normalized.description = sanitizeDescriptionText(normalized.description);
  normalized.shortDescription = sanitizeDescriptionText(normalized.shortDescription);

  if (normalized.keywords.length === 0) {
    normalized.keywords = deriveKeywordsFromListing(normalized);
  }

  return normalized;
}

function normalizeFingerprintPart(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildVariantFingerprint(listing) {
  return [
    normalizeFingerprintPart(listing.productName),
    normalizeFingerprintPart(listing.shortDescription),
    normalizeFingerprintPart(listing.description)
  ].join("||");
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function uniqueStrings(values) {
  const seen = new Set();
  const normalized = [];

  for (const value of values || []) {
    const cleaned = String(value || "").trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    normalized.push(cleaned);
  }

  return normalized;
}

function rotateList(values, offset) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const normalizedOffset = ((offset % values.length) + values.length) % values.length;
  return values.slice(normalizedOffset).concat(values.slice(0, normalizedOffset));
}

function ensureDescriptionLength(baseListing, description, minimumLength = 500) {
  const factualSegments = uniqueStrings([
    sanitizeDescriptionText(description),
    sanitizeDescriptionText(baseListing.shortDescription),
    sanitizeDescriptionText(baseListing.description),
    ...Object.entries(baseListing.specifications || {})
      .map(([key, value]) => `${key}: ${String(value || "").trim()}`)
      .filter((value) => !value.endsWith(":"))
  ]);

  let expanded = factualSegments.join(" ").trim();
  let cursor = 0;

  while (expanded.length < minimumLength && factualSegments.length > 0) {
    expanded = `${expanded} ${factualSegments[cursor % factualSegments.length]}`.trim();
    cursor += 1;
  }

  if (expanded.length <= 950) {
    return sanitizeDescriptionText(expanded);
  }

  const clipped = expanded.slice(0, 950);
  const cutPoint = Math.max(
    clipped.lastIndexOf(". "),
    clipped.lastIndexOf("! "),
    clipped.lastIndexOf("? ")
  );

  return sanitizeDescriptionText(cutPoint > 320 ? clipped.slice(0, cutPoint + 1) : clipped);
}

function splitTitleParts(productName) {
  const normalizedName = sanitizeIndiaMartTitle(productName);
  const parts = normalizedName.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      prefix: parts[0],
      core: parts.slice(1).join(" - ")
    };
  }

  return {
    prefix: normalizedName,
    core: normalizedName
  };
}

function extractTitleModifiers(baseListing, rawText, category) {
  const normalizedText = String(rawText || "");
  const modifiers = [];
  const preferredPatterns = String(category || "").toLowerCase() === "air quality monitors"
    ? [
        /ambient air quality/ig,
        /real[- ]time pm monitoring/ig,
        /industrial grade/ig,
        /plug[- ]and[- ]play/ig,
        /ip65 weatherproof/ig,
        /construction sites?/ig
      ]
    : [];

  for (const pattern of preferredPatterns) {
    const match = normalizedText.match(pattern);
    if (!match) continue;
    modifiers.push(...match);
  }

  modifiers.push(...(baseListing.keywords || []));

  return uniqueStrings(modifiers
    .map((value) => sanitizeIndiaMartTitle(String(value || "")
      .replace(/\bsetup\b/ig, "")
      .replace(/\bincluded\b/ig, "")
      .replace(/\boptions\b/ig, "")
      .replace(/\s{2,}/g, " ")
      .trim()))
    .filter((value) => {
      const tokenCount = value.split(/\s+/).filter(Boolean).length;
      return value.length >= 8
        && value.length <= 42
        && (tokenCount >= 2 || /\d/.test(value) || /[-/]/.test(value));
    })
  );
}

function buildTitleVariants(baseListing, rawText, category) {
  const baseTitle = sanitizeIndiaMartTitle(baseListing.productName);
  if (!baseTitle) return ["Brochure Product"];

  const { prefix, core } = splitTitleParts(baseTitle);
  const modifiers = extractTitleModifiers(baseListing, rawText, category);
  const titles = [baseTitle];

  for (const modifier of modifiers) {
    const compactModifier = normalizeFingerprintPart(modifier);
    const compactPrefix = normalizeFingerprintPart(prefix);
    const compactCore = normalizeFingerprintPart(core);

    if (
      !compactModifier
      || compactModifier === compactCore
      || compactModifier === compactPrefix
      || compactPrefix.includes(compactModifier)
      || compactModifier.includes(compactPrefix)
    ) {
      continue;
    }

    if (compactCore.includes("air quality monitoring system")) {
      if (compactModifier === "ambient air quality") {
        titles.push(`${prefix} - Ambient Air Quality Monitoring System`);
        continue;
      }
      if (compactModifier === "real time pm monitoring") {
        titles.push(`${prefix} - Real Time PM Monitoring System`);
        continue;
      }
      if (compactModifier === "industrial grade") {
        titles.push(`${prefix} - Industrial Grade Air Quality Monitoring System`);
        continue;
      }
      if (compactModifier === "plug and play") {
        titles.push(`${prefix} - Plug and Play Air Quality Monitoring System`);
        continue;
      }
      if (compactModifier === "ip65 weatherproof") {
        titles.push(`${prefix} - Weatherproof Air Quality Monitoring System`);
        continue;
      }
      if (compactModifier === "construction site" || compactModifier === "construction sites") {
        titles.push(`${prefix} - Construction Site Air Quality Monitoring System`);
        continue;
      }
    }

    if (/monitoring system/i.test(modifier)) {
      titles.push(`${prefix} - ${modifier}`);
      continue;
    }

    titles.push(`${prefix} - ${modifier} ${core}`);
  }

  return uniqueStrings(titles.map((title) => sanitizeIndiaMartTitle(title)).filter(Boolean));
}

function extractBrochureLines(rawText) {
  const noisePatterns = [
    /www\./i,
    /@/i,
    /^\+?\d[\d\s-]{7,}$/i,
    /powai|mumbai|maharashtra/i,
    /^key features$/i,
    /^technical specifications$/i,
    /^industries we serve$/i,
    /^compliance & certifications$/i,
    /^pm sensor$/i,
    /^iot software$/i,
    /^samasth$/i,
    /^why choose us$/i,
    /^our mission$/i,
    /^air quality monitoring$/i,
    /^real-time insights/i,
    /^simplify sustainability/i
  ];

  return uniqueStrings(String(rawText || "")
    .replace(/\r/g, "")
    .replace(/([A-Za-z])-\s*\n\s*([A-Za-z])/g, "$1$2")
    .split(/\n+/)
    .map((line) => sanitizeDescriptionText(line))
    .filter((line) => line.length >= 28 && line.length <= 220)
    .filter((line) => /^[A-Z0-9]/.test(line))
    .filter((line) => !noisePatterns.some((pattern) => pattern.test(line)))
  );
}

function toSentence(value) {
  const normalized = sanitizeDescriptionText(value);
  if (!normalized) return "";
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function buildSpecificationSentences(baseListing) {
  const specs = baseListing.specifications || {};
  const sentences = [];

  if (specs.Connectivity) {
    sentences.push(`Connectivity options include ${sanitizeDescriptionText(specs.Connectivity)}.`);
  }
  if (specs.Mounting) {
    sentences.push(`The unit supports ${sanitizeDescriptionText(specs.Mounting)} installation.`);
  }
  if (specs["Operating Temperature"]) {
    sentences.push(`Operating temperature is ${sanitizeDescriptionText(specs["Operating Temperature"])}.`);
  }
  if (specs.Compliance) {
    const complianceText = sanitizeDescriptionText(String(specs.Compliance).split(";").slice(0, 2).join("; "));
    if (complianceText) {
      sentences.push(`Compliance highlights include ${complianceText}.`);
    }
  }

  return uniqueStrings(sentences);
}

function buildBrochureSentences(rawText) {
  return uniqueStrings(
    extractBrochureLines(rawText)
      .map((line) => toSentence(line))
      .filter((sentence) => sentence.length >= 40 && sentence.length <= 240)
      .filter((sentence) => /^[A-Z0-9]/.test(sentence))
  );
}

function interleaveSentenceBlocks(values) {
  const even = values.filter((_, index) => index % 2 === 0);
  const odd = values.filter((_, index) => index % 2 === 1);
  return [...even, ...odd];
}

function reorderSupportPool(values, variantIndex) {
  const rotated = rotateList(values, variantIndex);
  switch (variantIndex % 4) {
    case 1:
      return interleaveSentenceBlocks(rotated);
    case 2:
      return [...rotated].reverse();
    case 3:
      return interleaveSentenceBlocks([...rotated].reverse());
    default:
      return rotated;
  }
}

function buildDescriptionOptions(baseListing, rawText, category, desiredCount) {
  const canonicalSentences = uniqueStrings(
    splitSentences(baseListing.description)
      .map((sentence) => toSentence(sentence))
      .filter((sentence) => sentence.length >= 45 && sentence.length <= 260)
      .filter((sentence) => /^[A-Z0-9]/.test(sentence))
  );
  const brochureSentences = buildBrochureSentences(rawText);
  const specificationSentences = buildSpecificationSentences(baseListing);

  const leadCandidates = uniqueStrings([
    toSentence(baseListing.shortDescription),
    canonicalSentences[0],
    canonicalSentences[1],
    canonicalSentences[2],
    brochureSentences[0],
    brochureSentences[1],
    specificationSentences[0]
  ]
    .filter(Boolean)
    .filter((sentence) => sentence.length >= 45)
    .filter((sentence) => /^[A-Z0-9]/.test(sentence))
  );

  const supportPool = uniqueStrings([
    ...canonicalSentences,
    ...brochureSentences,
    ...specificationSentences
  ]);

  const options = [];
  for (let variantIndex = 0; variantIndex < Math.max(desiredCount * 8, 24) && options.length < desiredCount; variantIndex += 1) {
    const lead = leadCandidates[variantIndex % leadCandidates.length] || supportPool[0] || toSentence(baseListing.shortDescription);
    const rotatedSupport = reorderSupportPool(
      supportPool.filter((sentence) => sentence && sentence !== lead),
      variantIndex
    );
    const pieces = [lead];
    const minimumPieces = 4 + (variantIndex % 3);

    for (const sentence of rotatedSupport) {
      const nextCandidate = sanitizeDescriptionText([...pieces, sentence].join(" "));
      if (nextCandidate.length > 880) break;
      pieces.push(sentence);
      if (pieces.length >= minimumPieces && nextCandidate.length >= 520) break;
    }

    let description = ensureDescriptionLength(baseListing, pieces.join(" "), 500);
    description = sanitizeDescriptionText(description);
    options.push(description);
  }

  return uniqueStrings(options);
}

function buildLocalVariantFromBase(baseListing, rawText, category, distinctTarget, variantIndex) {
  const titleOptions = buildTitleVariants(baseListing, rawText, category);
  const descriptionOptions = buildDescriptionOptions(baseListing, rawText, category, Math.max(distinctTarget, 5));
  const rotatedDescriptions = rotateList(descriptionOptions, variantIndex);
  const activeDescription = rotatedDescriptions[0] || baseListing.description;
  const keywordOptions = uniqueStrings([
    ...baseListing.keywords,
    ...splitSentences(activeDescription).flatMap((sentence) => sentence.split(/[,:]/).map((part) => part.trim()))
  ]);

  const shortDescriptionCandidates = uniqueStrings([
    toSentence(baseListing.shortDescription).replace(/[.]$/, ""),
    splitSentences(activeDescription)[0],
    splitSentences(activeDescription).slice(0, 2).join(" ")
  ]);

  const keywordRotation = rotateList(keywordOptions, variantIndex).slice(0, 10);

  return normalizeCanonicalListing({
    ...baseListing,
    productName: titleOptions[variantIndex % titleOptions.length] || baseListing.productName,
    shortDescription: shortDescriptionCandidates[variantIndex % shortDescriptionCandidates.length] || baseListing.shortDescription,
    description: activeDescription,
    keywords: keywordRotation.length > 0 ? keywordRotation : baseListing.keywords
  });
}

function resolveDistinctVariantCount(targetCount) {
  return Math.max(1, parseInt(targetCount, 10) || 1);
}

function cloneVariant(variant) {
  return {
    ...variant,
    keywords: [...(variant.keywords || [])],
    specifications: { ...(variant.specifications || {}) }
  };
}

function materializeExpandedVariants(uniqueVariants, canonicalListing, rawText, category, count) {
  const seededVariants = [];
  const seenFingerprints = new Set();
  const targetCount = Math.max(1, parseInt(count, 10) || 1);
  const maxAttempts = Math.max(targetCount * 20, 40);

  for (const variant of uniqueVariants) {
    const fingerprint = buildVariantFingerprint(variant);
    if (!fingerprint || seenFingerprints.has(fingerprint)) continue;
    seededVariants.push(cloneVariant(variant));
    seenFingerprints.add(fingerprint);
    if (seededVariants.length >= targetCount) {
      return seededVariants.slice(0, targetCount);
    }
  }

  for (let index = 0; index < maxAttempts && seededVariants.length < targetCount; index += 1) {
    const candidate = buildLocalVariantFromBase(
      canonicalListing,
      rawText,
      category,
      targetCount,
      index + uniqueVariants.length
    );
    const fingerprint = buildVariantFingerprint(candidate);
    if (!fingerprint || seenFingerprints.has(fingerprint)) continue;
    seededVariants.push(cloneVariant(candidate));
    seenFingerprints.add(fingerprint);
  }

  while (seededVariants.length < targetCount && uniqueVariants.length > 0) {
    const fallbackIndex = seededVariants.length;
    const source = uniqueVariants[fallbackIndex % uniqueVariants.length];
    const remixed = buildLocalVariantFromBase(
      normalizeCanonicalListing(source),
      rawText,
      category,
      targetCount,
      fallbackIndex + maxAttempts
    );
    const fingerprint = buildVariantFingerprint(remixed);
    if (fingerprint && !seenFingerprints.has(fingerprint)) {
      seededVariants.push(cloneVariant(remixed));
      seenFingerprints.add(fingerprint);
      continue;
    }
    seededVariants.push(cloneVariant(remixed));
  }

  return seededVariants.slice(0, targetCount);
}

async function buildBrochureVariantPool(rawText, canonicalListing, count, category) {
  const distinctTarget = resolveDistinctVariantCount(count);
  const candidateVariants = [];
  for (let index = 0; index < Math.max(distinctTarget * 10, 30); index += 1) {
    candidateVariants.push(buildLocalVariantFromBase(canonicalListing, rawText, category, distinctTarget, index));
  }

  const uniqueVariants = [];
  const seenFingerprints = new Set();

  for (const candidate of candidateVariants) {
    const fingerprint = buildVariantFingerprint(candidate);
    if (!fingerprint || seenFingerprints.has(fingerprint)) continue;
    seenFingerprints.add(fingerprint);
    uniqueVariants.push(candidate);
    if (uniqueVariants.length >= distinctTarget) break;
  }

  if (uniqueVariants.length === 0) {
    uniqueVariants.push(canonicalListing);
  }

  return {
    distinctTarget,
    uniqueVariants,
    expandedVariants: materializeExpandedVariants(uniqueVariants, canonicalListing, rawText, category, count)
  };
}

function getSelectedPdfFiles(config, allPdfFiles) {
  if (!config.selectedPdf) return allPdfFiles;

  const selectedPdfName = path.basename(config.selectedPdf);
  const filtered = allPdfFiles.filter((fileName) => path.basename(fileName) === selectedPdfName);

  if (filtered.length === 0) {
    throw new Error(`Selected brochure "${selectedPdfName}" is missing from brochures/.`);
  }

  return filtered;
}

function getMatchingImages(config, pdfBaseName, imageFiles) {
  if (Array.isArray(config.selectedPhotos) && config.selectedPhotos.length > 0) {
    return normalizeUniquePaths(config.selectedPhotos).filter(fs.existsSync);
  }

  return imageFiles
    .filter((img) => {
      const imgBase = path.basename(img, path.extname(img)).toLowerCase();
      const pdfBase = pdfBaseName.toLowerCase();
      return imgBase.startsWith(pdfBase) || pdfBase.startsWith(imgBase);
    })
    .map((img) => path.join(BROCHURES_DIR, img));
}

async function runDiscovery() {
  console.log("STARTING PHASE 1: PRODUCT DISCOVERY AND VARIANT GENERATION");

  if (!AI_AVAILABLE) {
    console.error("OpenAI API key not configured. Set OPENAI_API_KEY in .env.");
    process.exit(1);
  }

  const config = loadJson(CONFIG_PATH, {});
  const queue = loadJson(QUEUE_PATH, []);
  const selectedPdfName = config.selectedPdf ? path.basename(config.selectedPdf) : "";

  const fixedPrice = config.fixedPrice ? parseInt(config.fixedPrice, 10) : null;
  const dailyTarget = config.dailyTarget ? parseInt(config.dailyTarget, 10) : 30;

  const files = fs.readdirSync(BROCHURES_DIR);
  const imageFiles = files.filter((fileName) => [".png", ".jpg", ".jpeg", ".webp"].includes(path.extname(fileName).toLowerCase()));
  const pdfFiles = getSelectedPdfFiles(
    config,
    files.filter((fileName) => fileName.toLowerCase().endsWith(".pdf"))
  );

  if (selectedPdfName) {
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index].pdfFile !== selectedPdfName) {
        queue.splice(index, 1);
      }
    }
  }

  if (pdfFiles.length === 0) {
    console.warn("No brochure PDFs found for discovery.");
    process.exit(0);
  }

  const selectedImageCount = Array.isArray(config.selectedPhotos) && config.selectedPhotos.length > 0
    ? normalizeUniquePaths(config.selectedPhotos).filter(fs.existsSync).length
    : 0;
  if (selectedImageCount > 0) {
    const ignoredImageCount = Math.max(0, imageFiles.length - selectedImageCount);
    console.log(
      `Found ${pdfFiles.length} PDF file(s) in brochures/. Using ${selectedImageCount} selected image file(s)`
      + (ignoredImageCount > 0 ? ` and ignoring ${ignoredImageCount} other brochure image(s).` : ".")
    );
  } else {
    console.log(`Found ${pdfFiles.length} PDF file(s) and ${imageFiles.length} image file(s) in brochures/.`);
  }

  let newItems = 0;

  for (const pdfFile of pdfFiles) {
    const pdfPath = path.join(BROCHURES_DIR, pdfFile);
    const pdfHash = hashFile(pdfPath);
    const pdfBaseName = path.basename(pdfFile, ".pdf");
    const matchingImages = getMatchingImages(config, pdfBaseName, imageFiles);
    const baseId = crypto.createHash("md5").update(pdfPath).digest("hex");

    const existingVariants = queue.filter((item) => item.id.startsWith(`${baseId}_`));
    const needsRegen =
      existingVariants.length !== dailyTarget
      || existingVariants.some((item) => item.pdfHash !== pdfHash)
      || existingVariants.some((item) => JSON.stringify(item.images || []) !== JSON.stringify(matchingImages))
      || existingVariants.some((item) => item.category !== (config.selectedCategory || item.category))
      || existingVariants.some((item) => item.generatorVersion !== GENERATOR_VERSION);

    if (!needsRegen && existingVariants.length > 0) {
      console.log(`Skipping "${pdfFile}" because the queue is already up to date.`);
      continue;
    }

    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index].id.startsWith(`${baseId}_`)) {
        queue.splice(index, 1);
      }
    }

    console.log(`Processing "${pdfFile}"...`);

    try {
      const rawText = await parsePdf(pdfPath);
      const canonicalListing = normalizeCanonicalListing(await extractProductDetails(rawText));
      const resolvedCategory = config.selectedCategory || canonicalListing.categorySuggestion;
      const {
        distinctTarget,
        uniqueVariants,
        expandedVariants
      } = await buildBrochureVariantPool(rawText, canonicalListing, dailyTarget, resolvedCategory);

      expandedVariants.forEach((variant, index) => {
        queue.push({
          id: `${baseId}_${index}`,
          pdfFile,
          pdfHash,
          discoveredAt: new Date().toISOString(),
          generatorVersion: GENERATOR_VERSION,
          productName: variant.productName,
          price: fixedPrice !== null && !Number.isNaN(fixedPrice) ? fixedPrice : variant.price,
          unit: variant.unit,
          category: config.selectedCategory || variant.categorySuggestion,
          shortDescription: variant.shortDescription,
          keywords: variant.keywords || [],
          description: variant.description,
          specifications: variant.specifications || {},
          images: matchingImages
        });
      });

      console.log(
        `Generated ${expandedVariants.length} deterministic listing(s) for "${pdfFile}" using ${uniqueVariants.length} brochure-grounded variant seed(s) (target seed count: ${distinctTarget}).`
      );
      newItems += expandedVariants.length;
    } catch (error) {
      console.error(`Error processing "${pdfFile}": ${error.message}`);
    }
  }

  saveJson(QUEUE_PATH, queue);
  console.log(`Phase 1 complete. Added ${newItems} product variant(s) to product-queue.json.`);
}

if (require.main === module) {
  runDiscovery().catch((error) => {
    console.error(`Phase 1 failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildBrochureVariantPool,
  buildDescriptionOptions,
  buildLocalVariantFromBase,
  buildVariantFingerprint,
  normalizeCanonicalListing,
  resolveDistinctVariantCount,
  runDiscovery
};
