const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const MIN_DIMENSION = 1000;
const TARGET_DIMENSION = 1200;

async function main() {
  const imagePaths = process.argv.slice(2).filter(filePath => fs.existsSync(filePath));
  if (imagePaths.length === 0) {
    throw new Error('Pass at least one existing image path to verify.');
  }

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalvi-image-preflight-'));
  const results = [];
  for (const [index, imagePath] of imagePaths.entries()) {
    const metadata = await sharp(imagePath, { failOn: 'error' }).metadata();
    const scale = Math.max(metadata.width, metadata.height) < MIN_DIMENSION
      ? TARGET_DIMENSION / Math.max(metadata.width, metadata.height)
      : 1;
    const outputSize = {
      width: Math.max(1, Math.round(metadata.width * scale)),
      height: Math.max(1, Math.round(metadata.height * scale))
    };
    const outputPath = path.join(outputDir, `${index + 1}.png`);
    let pipeline = sharp(imagePath, { failOn: 'error' });
    if (scale !== 1) {
      pipeline = pipeline.resize(outputSize.width, outputSize.height, { fit: 'fill', kernel: 'lanczos3' });
    }
    await pipeline.png({ compressionLevel: 9 }).toFile(outputPath);

    const verified = await sharp(outputPath, { failOn: 'error' }).metadata();
    if (Math.max(verified.width, verified.height) < MIN_DIMENSION) {
      throw new Error(`Normalized output failed verification for ${path.basename(imagePath)}`);
    }
    results.push(`${path.basename(imagePath)}: ${metadata.width}x${metadata.height} -> ${verified.width}x${verified.height}`);
  }

  console.log(results.join('\n'));
  console.log(`Verified ${results.length} normalized image(s).`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
