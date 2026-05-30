/**
 * indiamart-product-discovery.js
 *
 * Phase 1: Product Discovery.
 * Scans the 'brochures/' folder for PDF product datasheets, parses them with pdf-parse,
 * extracts structured product catalog details via OpenAI, and matches them with sibling image files.
 * Outputs to product-queue.json.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parsePdf, extractProductVariants, AI_AVAILABLE } = require("./src/ai-helper");

const BROCHURES_DIR = path.join(__dirname, "brochures");
const QUEUE_PATH = path.join(__dirname, "product-queue.json");
const POSTED_PATH = path.join(__dirname, "product-engine/posted-products.json");

// Ensure directories exist
if (!fs.existsSync(BROCHURES_DIR)) {
  fs.mkdirSync(BROCHURES_DIR, { recursive: true });
  console.log(`📁 Created directory: ${BROCHURES_DIR}`);
  console.log("ℹ️ Please drop your product PDF brochures and matching image files there.");
}

function loadQueue() {
  if (!fs.existsSync(QUEUE_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8"));
  } catch (err) {
    return [];
  }
}

function saveQueue(queue) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
}

function loadPostedProducts() {
  if (!fs.existsSync(POSTED_PATH)) return new Set();
  try {
    const list = JSON.parse(fs.readFileSync(POSTED_PATH, "utf-8"));
    return new Set(list);
  } catch (err) {
    return new Set();
  }
}

(async () => {
  console.log("🚀 STARTING PHASE 1: PRODUCT DISCOVERY & VARIANT GENERATION");
  
  // Load config to check for fixed listing price override
  let fixedPrice = null;
  let dailyTarget = 30;
  let config = null;
  const configPath = path.join(__dirname, "product-engine/config.json");
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (config) {
        if (config.fixedPrice) {
          fixedPrice = parseInt(config.fixedPrice);
          console.log(`ℹ️  Using fixed listing price from config: ₹${fixedPrice}`);
        }
        if (config.dailyTarget) {
          dailyTarget = parseInt(config.dailyTarget);
          console.log(`ℹ️  Using daily target (variant count) from config: ${dailyTarget}`);
        }
      }
    } catch (e) {}
  }

  if (!AI_AVAILABLE) {
    console.error("❌ OpenAI API Key not configured. Please set OPENAI_API_KEY in .env");
    process.exit(1);
  }

  const files = fs.readdirSync(BROCHURES_DIR);
  const pdfFiles = files.filter(f => f.toLowerCase().endsWith(".pdf"));
  const imageFiles = files.filter(f => {
    const ext = path.extname(f).toLowerCase();
    return [".png", ".jpg", ".jpeg", ".webp"].includes(ext);
  });

  if (pdfFiles.length === 0) {
    console.warn("ℹ️ No PDF brochures found in the 'brochures/' directory.");
    console.log("   To run discovery, please place PDF datasheets in: " + BROCHURES_DIR);
    process.exit(0);
  }

  const queue = loadQueue();
  const posted = loadPostedProducts();
  const existingIds = new Set(queue.map(item => item.id));

  console.log(`🔍 Found ${pdfFiles.length} PDF files and ${imageFiles.length} image files in 'brochures/'.`);

  let newlyDiscovered = 0;

  for (const pdfFile of pdfFiles) {
    const pdfPath = path.join(BROCHURES_DIR, pdfFile);
    const pdfBaseName = path.basename(pdfFile, ".pdf");

    // Generate base unique ID based on file path
    const baseId = crypto.createHash("md5").update(pdfPath).digest("hex");

    if (posted.has(`${baseId}_0`)) {
      console.log(`⏭️  Skipping "${pdfFile}" — variants already posted successfully`);
      continue;
    }

    const existingVariantsCount = queue.filter(item => item.id.startsWith(baseId + "_")).length;
    if (existingVariantsCount > 0) {
      if (existingVariantsCount === dailyTarget) {
        console.log(`⏭️  Skipping "${pdfFile}" — variants (${existingVariantsCount}) already match target count`);
        continue;
      } else {
        console.log(`🔄 Target count changed from ${existingVariantsCount} to ${dailyTarget}. Regenerating variants for "${pdfFile}"...`);
        // Remove existing variants for this PDF from the queue
        for (let idx = queue.length - 1; idx >= 0; idx--) {
          if (queue[idx].id.startsWith(baseId + "_")) {
            queue.splice(idx, 1);
          }
        }
      }
    }

    console.log(`\n📄 Processing: "${pdfFile}"...`);

    try {
      // 1. Parse text from PDF
      const rawText = await parsePdf(pdfPath);
      console.log(`   Text parsed (${rawText.length} characters). Generating ${dailyTarget} SEO variations via OpenAI...`);

      // 2. Call OpenAI to structure catalog details variations
      const variants = await extractProductVariants(rawText, dailyTarget);
      console.log(`   ✨ Generated ${variants.length} variations successfully.`);

      // 3. Find matching image files (Use manual selected photos if available, otherwise fallback to name matching)
      let matchingImages = [];
      if (config && config.selectedPhotos && config.selectedPhotos.length > 0) {
        matchingImages = config.selectedPhotos;
        console.log(`      Using ${matchingImages.length} manually uploaded photos from config.`);
      } else {
        matchingImages = imageFiles
          .filter(img => {
            const imgBase = path.basename(img, path.extname(img));
            // Matches if the image name starts with the PDF name or contains it
            return imgBase.toLowerCase().startsWith(pdfBaseName.toLowerCase()) || 
                   pdfBaseName.toLowerCase().startsWith(imgBase.toLowerCase());
          })
          .map(img => path.join(BROCHURES_DIR, img));

        if (matchingImages.length > 0) {
          console.log(`      Found ${matchingImages.length} matching product images to attach to all variants.`);
        } else {
          console.warn(`      ⚠️ No matching images found in 'brochures/' starting with name "${pdfBaseName}"`);
        }
      }

      // 4. Append all variants to the queue
      variants.forEach((variant, index) => {
        const variantId = `${baseId}_${index}`;
        queue.push({
          id: variantId,
          pdfFile,
          discoveredAt: new Date().toISOString(),
          productName: variant.productName,
          price: fixedPrice !== null && !isNaN(fixedPrice) ? fixedPrice : variant.price,
          unit: variant.unit,
          category: variant.categorySuggestion,
          description: variant.description,
          specifications: variant.specifications || {},
          images: matchingImages
        });
      });

      console.log(`      Added ${variants.length} variants for "${pdfFile}" to the queue.`);
      newlyDiscovered += variants.length;

    } catch (err) {
      console.error(`❌ Error processing "${pdfFile}":`, err.message);
    }
  }

  if (newlyDiscovered > 0) {
    saveQueue(queue);
    console.log(`\n✅ Phase 1 Complete! Added ${newlyDiscovered} variant products to 'product-queue.json'`);
  } else {
    console.log("\n✅ Phase 1 Complete! No new variant products to add.");
  }
})();
