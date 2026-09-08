const assert = require("assert");
const {
  evaluateCropperProcessingState,
  evaluatePersistedStepState,
  loadCategoryConfig,
  normalizeUniquePaths,
  resolveCategoryRules,
  resolveIndiaMartCategory,
  resolveScratchRoot,
  toSafeFileFragment
} = require("./indiamart-auto-list");

function run() {
  const normalized = normalizeUniquePaths([
    "C:\\demo\\a.jpg",
    "C:\\demo\\a.jpg",
    "C:\\demo\\b.jpg"
  ]);

  assert.deepStrictEqual(normalized, [
    "C:\\demo\\a.jpg",
    "C:\\demo\\b.jpg"
  ]);

  assert.strictEqual(
    resolveScratchRoot({ LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" }),
    "C:\\Users\\demo\\AppData\\Local\\DalviBot\\logs",
    "Failure artifacts must be stored outside the versioned installation directory"
  );

  const config = loadCategoryConfig();
  assert.ok(Array.isArray(config["Solar Monitoring System"]), "Missing Solar Monitoring System mapping");
  assert.ok(Array.isArray(config["Air Quality Monitors"]), "Missing Air Quality Monitors mapping");
  assert.ok(Array.isArray(config["IoT Gateway"]), "Missing IoT Gateway mapping");
  assert.ok(Array.isArray(config["Mobile Phones"]), "Missing Mobile Phones mapping");
  assert.ok(Array.isArray(config["Nokia Mobile Phones"]), "Missing Nokia Mobile Phones mapping");
  assert.ok(Array.isArray(config["Nokia E5"]), "Missing Nokia E5 mapping");
  assert.ok(Array.isArray(config["Nokia C5"]), "Missing Nokia C5 mapping");
  assert.ok(Array.isArray(config["BlackBerry KeyOne"]), "Missing BlackBerry KeyOne mapping");

  const mobileRules = config["Mobile Phones"];
  assert.strictEqual(mobileRules.length, 10, "Mobile Phones must have all 10 preset rules");
  assert.deepStrictEqual(
    mobileRules.map((rule) => [rule.questionText, rule.optionText, rule.inputValue || null]),
    [
      ["RAM", "2 GB", null],
      ["Internal Storage", "Other", "8"],
      ["Brand", "Other", "Blackberry"],
      ["Network Type", "4G", null],
      ["Condition", "New", null],
      ["Phone Type", "Smartphone", null],
      ["Screen Size", "2.8 inch", null],
      ["Primary Camera", "< 8 MP", null],
      ["Battery Capacity", "< 3000 mAh", null],
      ["SIM Type", "Single SIM", null]
    ],
    "Mobile Phones preset does not match the requested Blackberry Q5 specifications"
  );

  const nokiaRules = config["Nokia Mobile Phones"];
  assert.strictEqual(nokiaRules.length, 9, "Nokia Mobile Phones must have all 9 preset rules");
  assert.deepStrictEqual(
    nokiaRules.map((rule) => [rule.questionText, rule.optionText, rule.inputValue || null]),
    [
      ["Body Type", "Smart Feature", null],
      ["Network Type", "4G VoLTE", null],
      ["Battery Capacity", "1500 mAh", null],
      ["RAM", "512 MB", null],
      ["Screen Size", "2.4 inch", null],
      ["Internal Storage", "64 GB", null],
      ["SIM Type", "Dual SIM", null],
      ["Primary Camera", "2 MP", null],
      ["Operating System", "Nokia OS", null]
    ],
    "Nokia Mobile Phones preset does not match the requested Nokia 2720 Flip specifications"
  );

  assert.strictEqual(
    resolveIndiaMartCategory("Nokia E5"),
    "Nokia Mobile Phones",
    "Nokia E5 must map to the Nokia Mobile Phones IndiaMART category"
  );
  assert.strictEqual(
    resolveIndiaMartCategory("Nokia C5"),
    "Nokia Mobile Phones",
    "Nokia C5 must map to the Nokia Mobile Phones IndiaMART category"
  );
  assert.strictEqual(
    resolveIndiaMartCategory("Nokia Mobile Phones"),
    "Nokia Mobile Phones",
    "Direct IndiaMART category names must remain unchanged"
  );
  assert.strictEqual(
    resolveCategoryRules(config, "Nokia Mobile Phones", "Nokia E5"),
    config["Nokia E5"],
    "The selected dashboard preset must override a stale queued product category"
  );

  const nokiaE5Rules = config["Nokia E5"];
  assert.strictEqual(nokiaE5Rules.length, 9, "Nokia E5 must have all 9 preset rules");
  assert.deepStrictEqual(
    nokiaE5Rules.map((rule) => [rule.questionText, rule.optionText, rule.inputValue || null]),
    [
      ["Body Type", "Smart Feature", null],
      ["Network Type", "2G", null],
      ["Battery Capacity", "1500 mAh", null],
      ["RAM", "2 GB", null],
      ["Screen Size", "2.4 inch", null],
      ["Internal Storage", "8 GB", null],
      ["SIM Type", "Dual SIM", null],
      ["Primary Camera", "5 MP", null],
      ["Operating System", "Nokia OS", null]
    ],
    "Nokia E5 preset does not match the requested specifications"
  );

  const nokiaC5Rules = config["Nokia C5"];
  assert.strictEqual(nokiaC5Rules.length, 9, "Nokia C5 must have all 9 preset rules");
  assert.deepStrictEqual(
    nokiaC5Rules,
    nokiaE5Rules,
    "Nokia C5 must use the same technical specifications as Nokia E5"
  );
  assert.strictEqual(
    resolveCategoryRules(config, "Nokia Mobile Phones", "Nokia C5"),
    config["Nokia C5"],
    "The selected Nokia C5 dashboard preset must override a stale queued product category"
  );

  const blackBerryKeyOneRules = config["BlackBerry KeyOne"];
  assert.strictEqual(blackBerryKeyOneRules.length, 8, "BlackBerry KeyOne must have all 8 preset rules");
  assert.deepStrictEqual(
    blackBerryKeyOneRules.map((rule) => [rule.questionText, rule.optionText, rule.inputValue || null]),
    [
      ["Keyboard Type", "QWERTY", null],
      ["Internal Storage", "32 GB", null],
      ["RAM", "3 GB", null],
      ["Screen Size", "4.5 inch", null],
      ["Battery Capacity", "Other", "3505"],
      ["Operating System", "Android", null],
      ["Primary Camera", "12 MP", null],
      ["Network Type", "4G", null]
    ],
    "BlackBerry KeyOne preset does not match the requested specifications"
  );
  assert.strictEqual(
    resolveIndiaMartCategory("BlackBerry KeyOne"),
    "BlackBerry Mobile Phones",
    "BlackBerry KeyOne must map to the BlackBerry Mobile Phones IndiaMART category"
  );
  assert.strictEqual(
    resolveCategoryRules(config, "BlackBerry Mobile Phones", "BlackBerry KeyOne"),
    config["BlackBerry KeyOne"],
    "The selected BlackBerry KeyOne preset must override a stale queued product category"
  );

  const lowResolutionPageTwo = evaluatePersistedStepState({
    requiredFieldLengths: { title: 0, price: 0, description: 0 },
    descriptionScore: 5,
    sidebar: {
      name: { value: 10 },
      primaryPhoto: { value: 0 },
      multiPhoto: { value: 0 },
      price: { value: 20 },
      description: { value: 5 },
      brochure: { value: 5 }
    },
    imageSummary: {
      count: 0,
      filledSlotCount: 0,
      hiddenCount: 0,
      primaryPhotoScore: 0,
      multiPhotoScore: 0,
      previewImageCount: 1
    },
    pdfSummary: { brochureScore: 5 }
  }, { price: 5499 }, { onPageTwo: true, brochureVisible: true });

  assert.strictEqual(
    lowResolutionPageTwo.persistedOk,
    true,
    "A persisted page-2 product preview must not be rejected only because IndiaMART gave low-resolution photos a 0/10 score"
  );

  const pageTwoPersistence = evaluatePersistedStepState({
    expectedImageCount: 3,
    requiredFieldLengths: {
      title: 0,
      price: 0,
      description: 0
    },
    descriptionScore: 5,
    sidebar: {
      name: { text: "Name (>=3 Words) 0/10", value: 0, max: 10 },
      primaryPhoto: { text: "Primary Photo 10/10", value: 10, max: 10 },
      singlePhoto: { text: "1 Photo 10/10", value: 10, max: 10 },
      multiPhoto: { text: "2 or More Photos 10/10", value: 10, max: 10 },
      price: { text: "Price (with unit) 20/20", value: 20, max: 20 },
      description: { text: "Description (>100 chars) 5/5", value: 5, max: 5 },
      brochure: { text: "Product Brochure (PDF) 5/5", value: 5, max: 5 },
      configSpecs: { text: "Config Specs. 0/10", value: 0, max: 10 },
      otherSpecs: { text: "Other Specs. 0/10", value: 0, max: 10 }
    },
    imageSummary: {
      count: 0,
      labels: [],
      filledSlotCount: 0,
      hiddenCount: 3,
      modalVisible: false,
      modalThumbCount: 0,
      primaryPhotoScore: 10,
      multiPhotoScore: 10
    },
    pdfSummary: {
      count: 0,
      labels: [],
      brochureScore: 5,
      tileLabels: []
    }
  }, { price: 42999 }, {
    onPageTwo: true,
    brochureVisible: false
  });

  assert.strictEqual(pageTwoPersistence.persistedOk, true, "Page 2 persistence should remain valid when sidebar name score is unavailable.");

  assert.deepStrictEqual(
    evaluateCropperProcessingState({ successImageCount: 0, failedImageCount: 1 }, 10),
    { status: "processing", processedCount: 1 },
    "A partial cropper failure must not abort while the remaining files are still processing"
  );
  assert.deepStrictEqual(
    evaluateCropperProcessingState({ successImageCount: 9, failedImageCount: 1 }, 10),
    { status: "failed", processedCount: 10 },
    "The cropper must reject a terminal partial failure"
  );
  assert.deepStrictEqual(
    evaluateCropperProcessingState({ successImageCount: 10, failedImageCount: 0 }, 10),
    { status: "ready", processedCount: 10 },
    "The cropper must proceed only after every selected image succeeds"
  );

  const safeName = toSafeFileFragment("Test Product / 01");
  assert.strictEqual(safeName, "Test_Product_01");

  console.log("automation smoke test passed");
}

run();
