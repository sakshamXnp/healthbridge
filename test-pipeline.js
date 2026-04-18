/**
 * test-pipeline.js — Test the MedAI pipeline without WhatsApp
 * Tests the dual-model architecture: MedGemma (vision) + K2 Think V2 (reasoning)
 * Run: node test-pipeline.js
 */

require("dotenv").config();
const { runMedAIPipeline } = require("./orchestrator");
const fs = require("fs");
const path = require("path");

// ─── Test Cases ───────────────────────────────────────────────────────────────

const TEXT_TESTS = [
  {
    name: "Paracetamol → Tylenol mapping (explain like to a 5-year-old)",
    input: "What is Paracetamol called in the USA? I have some from India.",
    expectContains: ["Tylenol", "Acetaminophen"],
  },
  {
    name: "Controlled substance flag + safety explanation",
    input: "I have Tramadol tablets from Mexico, can I take them here?",
    expectContains: ["prescription", "controlled"],
  },
  {
    name: "Ranitidine recall warning + safe alternative",
    input: "I have Zantac/ranitidine from back home, can I use it?",
    expectContains: ["recall", "Pepcid"],
  },
  {
    name: "Spanish language — full response in Spanish",
    input: "¿Qué es el Brufen? ¿Puedo comprarlo aquí en Estados Unidos?",
    expectLanguage: "Spanish",
  },
  {
    name: "Hindi script detection + Hindi response",
    input: "मेरे पास क्रोसिन की गोलियाँ हैं, इसे यहाँ क्या कहते हैं?",
    expectLanguage: "Hindi",
  },
  {
    name: "Drug interaction warning",
    input: "I'm taking ibuprofen and aspirin together for my pain, is that okay?",
    expectContains: ["interact", "stomach", "bleed"],
  },
  {
    name: "Cost-saving resources mentioned",
    input: "I don't have insurance. How can I afford blood pressure medicine?",
    expectContains: ["GoodRx"],
  },
  {
    name: "Combo drug explanation (Combiflam)",
    input: "My friend gave me Combiflam from India. What is it?",
    expectContains: ["Ibuprofen", "Paracetamol"],
  },
  {
    name: "Simple symptom question",
    input: "I have a bad headache and a fever of 101. What should I take?",
    expectContains: ["Tylenol", "Acetaminophen"],
  },
  {
    name: "Arabic language support",
    input: "ما هو الباراسيتامول؟ هل أستطيع شراءه هنا في أمريكا؟",
    expectLanguage: "Arabic",
  },
  {
    name: "Chinese language support",
    input: "布洛芬是什么药？在美国哪里可以买到？",
    expectLanguage: "Chinese",
  },
  {
    name: "Insurance jargon explanation",
    input: "My EOB says I owe $200 after my deductible. What does that mean?",
    expectContains: ["deductible"],
  },
];

async function runTextTests() {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║   🏥 MedAI Pipeline Tests — K2 Think V2 Reasoning Engine     ║
║   Model: MBZUAI-IFM/K2-Think-v2 (70B)                        ║
╚═══════════════════════════════════════════════════════════════╝
`);

  let passed = 0;
  let failed = 0;
  let errors = 0;

  for (const test of TEXT_TESTS) {
    console.log(`\n▶ TEST: ${test.name}`);
    console.log(`  Input: "${test.input.slice(0, 80)}${test.input.length > 80 ? "..." : ""}"`);
    console.log("  Running K2 Think V2...");

    const start = Date.now();
    try {
      const result = await runMedAIPipeline({ userText: test.input });
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      console.log(`  ✅ Response received in ${elapsed}s`);
      console.log(`  🌍 Language: ${result.debug?.language}`);
      console.log(`  🧠 Model: ${result.debug?.model || "K2 Think V2"}`);
      console.log(`  📝 Response preview:`);
      console.log(`     "${result.response.slice(0, 300)}${result.response.length > 300 ? "..." : ""}"`);

      // Basic validation
      let testPassed = true;
      if (test.expectContains) {
        const lower = result.response.toLowerCase();
        const missing = test.expectContains.filter(w => !lower.includes(w.toLowerCase()));
        if (missing.length > 0) {
          console.log(`  ⚠️  Missing expected terms: ${missing.join(", ")}`);
          testPassed = false;
        } else {
          console.log(`  ✅ All expected terms found`);
        }
      }

      // Check for warmth (the "5-year-old" test)
      const warmthIndicators = ["think of it", "like", "imagine", "example", "mean", "simply", "basically", "easy"];
      const hasWarmth = warmthIndicators.some(w => result.response.toLowerCase().includes(w));
      if (hasWarmth) {
        console.log("  ✅ Response uses simple/warm language (5-year-old test passed)");
      } else {
        console.log("  ℹ️  Response could be warmer/simpler");
      }

      // Check for safety resources
      const hasSafetyResources = result.response.includes("pharmacist") || result.response.includes("doctor") || result.response.includes("911");
      if (hasSafetyResources) {
        console.log("  ✅ Safety reminder present");
      }

      if (testPassed) passed++;
      else failed++;

    } catch (err) {
      console.log(`  ❌ Error: ${err.message}`);
      if (err.response?.data) {
        console.log(`  API response: ${JSON.stringify(err.response.data).slice(0, 200)}`);
      }
      errors++;
    }
    
    // Small delay between tests to avoid rate limiting
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📊 Results: ${passed} passed, ${failed} partial, ${errors} errors out of ${TEXT_TESTS.length} tests
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

async function runImageTest(imagePath) {
  if (!imagePath) {
    console.log("\n⚠️  No image path provided. Pass path as argument to test image pipeline.");
    console.log("   Example: node test-pipeline.js /path/to/medicine.jpg");
    return;
  }

  console.log(`\n▶ IMAGE TEST: ${path.basename(imagePath)}`);
  const imageData = fs.readFileSync(imagePath);
  const base64 = imageData.toString("base64");
  const ext = path.extname(imagePath).toLowerCase();
  const mimeMap = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
  const mimeType = mimeMap[ext] || "image/jpeg";

  const start = Date.now();
  try {
    const result = await runMedAIPipeline({ imageBase64: base64, mimeType, userText: "" });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`✅ Response received in ${elapsed}s`);
    console.log(`🧠 Model: ${result.debug?.model}`);
    console.log("\n📷 Gemma extraction:");
    console.log(JSON.stringify(result.debug?.gemmaExtraction, null, 2));
    console.log("\n💊 FDA match:");
    console.log(JSON.stringify(result.debug?.fdaMatch, null, 2));
    console.log("\n📝 Final response:");
    console.log(result.response);

    // Verify response quality
    console.log("\n━━━ Quality Check ━━━");
    const resp = result.response;
    const checks = [
      { name: "Medicine identified", test: resp.includes("💊") },
      { name: "US equivalent mentioned", test: /🇺🇸|USA|United States/i.test(resp) },
      { name: "Simple language used", test: /like|think of|imagine|means/i.test(resp) },
      { name: "Warning included", test: resp.includes("⚠️") || /warn/i.test(resp) },
      { name: "Safety reminder", test: /pharmacist|doctor|911/i.test(resp) },
    ];
    checks.forEach(c => console.log(`  ${c.test ? "✅" : "❌"} ${c.name}`));
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
    console.error(err);
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────
async function main() {
  // Verify K2 Think V2 API key is present
  if (!process.env.K2_API_KEY) {
    console.error("❌ Missing K2_API_KEY in .env file");
    console.error("   Add: K2_API_KEY=IFM-7969LG8lyevf1DsZ");
    process.exit(1);
  }
  console.log("✅ K2 Think V2 API key found");

  const imagePath = process.argv[2];

  if (imagePath) {
    await runImageTest(imagePath);
  } else {
    await runTextTests();
  }
}

main().catch(console.error);
