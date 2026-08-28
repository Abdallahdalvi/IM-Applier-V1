const assert = require("assert");
const {
  buildBrochureVariantPool,
  buildVariantFingerprint,
  resolveDistinctVariantCount
} = require("../indiamart-product-discovery");

(async () => {
  assert.strictEqual(resolveDistinctVariantCount(20), 20, "Distinct target should match requested post count.");

  const rawText = `
KLEON V3 Industrial IoT Gateway
High-performance industrial IoT gateway for edge connectivity and device integration.
Supports Ethernet, WiFi, 4G LTE, and NB-IoT communication.
Protocol support includes Modbus TCP, Modbus RTU, and MQTT.
The platform uses a quad-core ARM Cortex-A72 processor.
The unit supports DIN Rail mounting with an IP65 enclosure.
It provides 32 I/O points for industrial field integration.
Multiple SIM options are supported for deployment flexibility.
Up to 8 GB LPDDR4 RAM and up to 32 GB eMMC flash storage are available.
The brochure highlights device-to-cloud connectivity with brochure-listed protocols only.
Industrial enclosure supports field deployment in demanding environments.
The product is designed for industrial automation and remote equipment integration.
  `.trim();

  const canonicalListing = {
    productName: "KLEON V3 - Industrial IoT Gateway",
    price: 42999,
    unit: "Piece",
    categorySuggestion: "IoT Gateway",
    shortDescription: "Industrial IoT gateway with Ethernet, WiFi, 4G LTE, NB-IoT, and Modbus support.",
    keywords: [
      "Industrial IoT Gateway",
      "Ethernet",
      "WiFi",
      "4G LTE",
      "NB-IoT",
      "Modbus TCP",
      "Modbus RTU",
      "MQTT",
      "DIN Rail",
      "IP65"
    ],
    description: [
      "KLEON V3 is a high-performance industrial IoT gateway built for edge connectivity and equipment integration.",
      "It supports Ethernet, WiFi, 4G LTE, and NB-IoT communication for flexible deployment.",
      "Protocol support includes Modbus TCP, Modbus RTU, and MQTT for industrial data exchange.",
      "The platform uses a quad-core ARM Cortex-A72 processor with up to 8 GB LPDDR4 RAM and up to 32 GB eMMC flash storage.",
      "The unit provides 32 I/O points and supports multiple SIM options.",
      "DIN Rail mounting and an IP65 enclosure help it fit industrial field deployments."
    ].join(" "),
    specifications: {
      Brand: "KLEON",
      Model: "V3",
      Connectivity: "Ethernet, WiFi, 4G LTE, NB-IoT",
      Ports: "32 I/O Points",
      Mounting: "DIN Rail",
      Compliance: "IP65",
      "Operating Temperature": "-20 to 70 C"
    }
  };

  const { distinctTarget, uniqueVariants, expandedVariants } = await buildBrochureVariantPool(
    rawText,
    canonicalListing,
    12,
    "IoT Gateway"
  );

  assert.strictEqual(distinctTarget, 12, "Distinct target should remain equal to the requested count.");
  assert(expandedVariants.length === 12, "Expected 12 expanded variants.");
  assert(uniqueVariants.length >= 12, `Expected at least 12 unique seed variants, received ${uniqueVariants.length}.`);

  const uniqueFingerprints = new Set(expandedVariants.map((variant) => buildVariantFingerprint(variant)));
  assert(
    uniqueFingerprints.size === 12,
    `Expected 12 unique title/description fingerprints, received ${uniqueFingerprints.size}.`
  );

  console.log("discovery smoke test passed");
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
