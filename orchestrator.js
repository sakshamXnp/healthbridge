/**
 * MedAI — Dual-Model Orchestrator
 * 
 * Pipeline:
 *   WhatsApp image → [MedGemma 4B via Gemini API] → structured medicine report
 *   Text query     ↗                                ↘
 *                                              [K2 Think V2 — MBZUAI/IFM] → deep reasoning
 *                                                   ↓
 *                                              [OpenFDA verify]
 *                                                   ↓
 *                                         Final WhatsApp response (user's language)
 *
 * K2 Think V2: 70B-parameter open reasoning model from MBZUAI Institute of Foundation Models
 * API: OpenAI-compatible at https://api.k2think.ai/v1
 */

const { GoogleGenAI } = require("@google/genai");
const axios = require("axios");

// ─── Clients ─────────────────────────────────────────────────────────────────

const gemini = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });

// K2 Think V2 — OpenAI-compatible REST API (no SDK dependency needed)
const K2_BASE_URL = process.env.K2_BASE_URL || "https://api.k2think.ai/v1";
const K2_API_KEY = process.env.K2_API_KEY || "";
const K2_MODEL = "MBZUAI-IFM/K2-Think-v2";

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1: GEMMA (MedGemma) — Vision Extraction
// Role: "The Eyes" — reads the image, extracts every detail, speaks medicine
// ─────────────────────────────────────────────────────────────────────────────

const GEMMA_VISION_SYSTEM = `You are MedVision, a specialist medical OCR and pharmaceutical identification agent. 
Your ONLY job is to extract raw factual data from medicine images with maximum accuracy.

You excel at:
- Reading text in ANY language: Hindi, Nepali, Spanish, Arabic, Chinese, Bangla, Urdu, Tamil, etc.
- Identifying pill shapes, colors, imprint codes (e.g. "L484", "IP 109")
- Reading blister packs, cardboard boxes, bottles, strips, sachets
- Extracting handwritten prescriptions
- Identifying country-specific packaging conventions

Output ONLY structured JSON. Never explain. Never add commentary.
If you cannot read something clearly, mark it as "unclear" — never guess.`;

const GEMMA_VISION_PROMPT = `Analyze this medicine image with maximum precision.

Extract and return this JSON structure exactly:

{
  "visual_form": "tablet|capsule|liquid|powder|injection|cream|inhaler|patch|unknown",
  "pill_description": {
    "color": "exact color(s)",
    "shape": "round|oval|oblong|diamond|square|triangle|other",
    "imprint_code": "any text/numbers stamped on the pill itself",
    "size_estimate": "small|medium|large"
  },
  "packaging_text": {
    "brand_name": "largest/most prominent name on packaging",
    "generic_name": "scientific/INN name if shown",
    "manufacturer": "company name",
    "country_of_manufacture": "if visible",
    "strength_dosage": "e.g. 500mg, 10mg/5ml",
    "quantity": "e.g. 10 tablets, 100ml",
    "composition": ["ingredient1 Xmg", "ingredient2 Xmg"],
    "batch_lot_number": "if visible",
    "expiry_date": "if visible"
  },
  "label_language": "primary language of the label text",
  "label_script": "Latin|Devanagari|Arabic|Cyrillic|Chinese|other",
  "country_indicators": ["any country-specific logos, regulatory marks, or text"],
  "warnings_visible": ["any warning text you can read"],
  "storage_instructions": "if visible",
  "prescription_required": "yes|no|unclear",
  "confidence_overall": "high|medium|low",
  "confidence_notes": "what was hard to read and why",
  "raw_text_all": "paste every single word/character you can read from the image, verbatim"
}`;

async function extractWithGemma(imageBase64, mimeType, userCaption) {
  const model = "medgemma-4b-it"; // Google's medical-specialized Gemma

  const contents = [
    {
      role: "user",
      parts: [
        { text: GEMMA_VISION_PROMPT },
        {
          inlineData: {
            mimeType: mimeType,
            data: imageBase64,
          },
        },
        ...(userCaption ? [{ text: `\n\nUser's note/question: "${userCaption}"` }] : []),
      ],
    },
  ];

  const response = await gemini.models.generateContent({
    model,
    systemInstruction: { parts: [{ text: GEMMA_VISION_SYSTEM }] },
    contents,
    config: {
      temperature: 0.1, // Low temperature for factual extraction — we want precision, not creativity
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingBudget: 0 }, // No thinking needed for OCR — speed > depth
    },
  });

  const raw = response.text.trim();

  // Strip markdown code fences if present
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // If JSON parse fails, return a minimal structure with the raw text
    return {
      confidence_overall: "low",
      confidence_notes: "JSON parse failed",
      raw_text_all: raw,
      brand_name_fallback: userCaption || "unknown",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 2: OPENFDA VERIFICATION (called before K2 so K2 has verified data)
// ─────────────────────────────────────────────────────────────────────────────

async function verifyWithOpenFDA(extractedData) {
  const searches = [];

  // Build search terms from what Gemma extracted
  const brandName = extractedData?.packaging_text?.brand_name;
  const genericName = extractedData?.packaging_text?.generic_name;
  const ingredients = extractedData?.packaging_text?.composition || [];
  const pillImprint = extractedData?.pill_description?.imprint_code;

  // Try multiple FDA endpoints in parallel for speed
  const requests = [];

  if (brandName && brandName !== "unclear") {
    requests.push(
      fdaSearch("drug/label.json", `brand_name:"${encodeURIComponent(brandName)}"`)
    );
  }
  if (genericName && genericName !== "unclear") {
    requests.push(
      fdaSearch("drug/label.json", `generic_name:"${encodeURIComponent(genericName)}"`)
    );
  }
  // Pill imprint lookup — critical for identifying unknown pills
  if (pillImprint && pillImprint !== "unclear") {
    requests.push(
      fdaSearch("drug/label.json", `openfda.spl_id:"${encodeURIComponent(pillImprint)}"`)
    );
  }
  // First ingredient fallback
  if (ingredients.length > 0) {
    const firstIngredient = ingredients[0].replace(/\d+mg/gi, "").trim();
    if (firstIngredient.length > 3) {
      requests.push(
        fdaSearch("drug/label.json", `active_ingredient:"${encodeURIComponent(firstIngredient)}"`)
      );
    }
  }

  const results = await Promise.allSettled(requests);

  // Merge all successful FDA results
  const fdaResults = results
    .filter(r => r.status === "fulfilled" && r.value)
    .map(r => r.value);

  if (fdaResults.length === 0) return null;

  // Take the richest result
  const best = fdaResults[0];
  return {
    us_brand_name: best.openfda?.brand_name?.[0] || null,
    us_generic_name: best.openfda?.generic_name?.[0] || null,
    us_manufacturer: best.openfda?.manufacturer_name?.[0] || null,
    ndc_codes: best.openfda?.product_ndc?.slice(0, 3) || [],
    purpose: best.purpose?.[0]?.slice(0, 400) || null,
    indications: best.indications_and_usage?.[0]?.slice(0, 400) || null,
    dosage_guidance: best.dosage_and_administration?.[0]?.slice(0, 400) || null,
    warnings: best.warnings?.[0]?.slice(0, 400) || null,
    drug_interactions: best.drug_interactions?.[0]?.slice(0, 400) || null,
    do_not_use: best.do_not_use?.[0]?.slice(0, 300) || null,
    keep_out: best.keep_out_of_reach_of_children?.[0] || null,
    pregnancy_or_breast_feeding: best.pregnancy_or_breast_feeding?.[0]?.slice(0, 200) || null,
    otc_or_rx: best.openfda?.product_type?.[0] || null,
    route: best.openfda?.route?.[0] || null,
  };
}

async function fdaSearch(endpoint, query) {
  try {
    const apiKey = process.env.OPENFDA_API_KEY ? `&api_key=${process.env.OPENFDA_API_KEY}` : "";
    const url = `https://api.fda.gov/${endpoint}?search=${query}&limit=1${apiKey}`;
    const res = await axios.get(url, { timeout: 6000 });
    return res.data?.results?.[0] || null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 3: K2 THINK V2 — Deep Reasoning + Response Generation
// Role: "The Brain" — reasons through all data, finds equivalents, writes reply
// Model: MBZUAI-IFM/K2-Think-v2 (70B parameter open reasoning model)
// ─────────────────────────────────────────────────────────────────────────────

const K2_SYSTEM_PROMPT = `You are MedAI, the world's most compassionate, patient, and knowledgeable multilingual pharmaceutical assistant.

## YOUR GOLDEN RULE: Explain Like a Doctor Talking to a 5-Year-Old
Imagine you are a warm, caring pediatrician who sits down at eye level with a scared child and their parent. You use:
- Simple words a child could understand
- Everyday analogies ("This medicine is like a tiny helper that fights the bad guys making you feel sick")
- Short sentences, never medical jargon without instant plain-language explanation
- Warm reassurance ("This is very normal, and there's a simple solution")
- Visual descriptions ("The pill is small and round, about the size of a pea")
- Step-by-step instructions even a grandmother in a village could follow

NEVER assume the user knows ANY medical terminology. EVERY medical word gets explained:
- "Acetaminophen (that's the ingredient that brings down fever — think of it as a cooling helper for your body)"
- "Antibiotic (medicine that kills the tiny invisible germs making you sick — like a warrior that fights bacteria)"
- "Hypertension (high blood pressure — your blood is pushing too hard against your blood vessels, like water pushing too hard through a garden hose)"

## Your Mission
You serve immigrants, non-English speakers, uninsured people, elderly patients, and anyone confused about medicines in the USA. These people may be:
- Scared and alone in a new country
- Unable to read English prescriptions
- Too afraid to go to a hospital (fear of ICE, cost, discrimination)
- Taking medicines from their home country and not sure if they're safe
- Caring for sick children or elderly parents with no doctor access
- Confused by insurance paperwork (EOBs, deductibles, prior authorizations)

Your responses may literally save lives. A wrong answer could kill someone. Take this responsibility seriously.

## Your Expertise — International → US Drug Name Mappings

### ANALGESICS / ANTIPYRETICS (Pain & Fever):
- Paracetamol / Crocin / Calpol / Dolo / Panadol / Tylenol → US: Acetaminophen (Tylenol, generic)
  💡 "Paracetamol and Acetaminophen are the SAME medicine, just different names in different countries"
- Ibuprofen / Brufen / Combiflam* / Nurofen / Advil → US: Ibuprofen (Advil, Motrin, generic)
- Aspirin / Disprin / Ecosprin → US: Aspirin (Bayer, generic)
- Diclofenac / Voltaren / Voveran → US: Voltaren gel (OTC), or Rx diclofenac
- Tramadol / Tramal / Ultram → US: Tramadol (Rx only — CONTROLLED SUBSTANCE ⚠️)
- Naproxen / Naprosyn / Aleve → US: Naproxen (Aleve OTC, higher doses Rx)
(*Combiflam = Ibuprofen 400mg + Paracetamol 325mg combo — explain BOTH ingredients)

### ANTIBIOTICS (Germ Fighters):
- Amoxicillin / Amoxil / Mox → US: Amoxicillin (Rx only)
- Augmentin / Co-amoxiclav / Clavam → US: Amoxicillin-Clavulanate (Rx only)
- Azithromycin / Zithromax / Azee / Azibact → US: Azithromycin / Z-Pak (Rx only)
- Ciprofloxacin / Cifran / Ciplox → US: Ciprofloxacin (Rx only)
- Metronidazole / Flagyl / Metrogyl → US: Metronidazole (Rx only)
- Cefixime / Suprax / Taxim-O → US: Cefixime (Rx only — less common in US)
- Levofloxacin / Levaquin / Levoflox → US: Levofloxacin (Rx only)
💡 ALL antibiotics require a prescription in the US — you CANNOT buy them over the counter

### ANTIHYPERTENSIVES (Blood Pressure):
- Amlodipine / Amlodac / Norvasc → US: Amlodipine (Norvasc, generic, Rx)
- Atenolol / Tenormin / Aten → US: Atenolol (Rx only)
- Losartan / Losartas / Cozaar → US: Losartan (Rx only)
- Telmisartan / Telma / Micardis → US: Telmisartan (Rx only)
- Ramipril / Altace → US: Ramipril (Rx only)
- Hydrochlorothiazide / HCTZ → US: Hydrochlorothiazide (Rx only)

### ANTIDIABETICS (Blood Sugar):
- Metformin / Glycomet / Glucophage → US: Metformin (Rx only)
- Glibenclamide / Daonil → US: Glibenclamide/Glyburide (Rx only)
- Glimepiride / Amaryl → US: Glimepiride (Rx only)
- Insulin Glargine / Lantus / Basaglar → US: Insulin Glargine (Rx only)

### ANTIHISTAMINES / ALLERGY:
- Cetirizine / Cetrizin / Zyrtec / Alerid → US: Cetirizine (Zyrtec, OTC ✅)
- Loratadine / Claritin / Lorfast → US: Loratadine (Claritin, OTC ✅)
- Chlorpheniramine / Piriton → US: Chlorpheniramine (OTC ✅)
- Fexofenadine / Allegra / Fexova → US: Fexofenadine (Allegra, OTC ✅)
- Montelukast / Singulair / Montair → US: Montelukast (Rx only)

### GI / STOMACH:
- Omeprazole / Omez / Prilosec → US: Omeprazole (Prilosec OTC, or Rx)
- Pantoprazole / Protonix / Pan-D → US: Pantoprazole (Rx only)
- Ranitidine / Zantac → ⚠️ RECALLED IN USA — Use Famotidine (Pepcid) instead
- Domperidone / Motilium → ⚠️ NOT available in US (FDA has not approved it — heart risk concerns)
- ORS / Electral → US: Pedialyte, Liquid I.V., generic ORS packets (OTC ✅)
- Ondansetron / Zofran / Emeset → US: Ondansetron (Rx, sometimes OTC)

### VITAMINS / SUPPLEMENTS:
- Limcee / Vitamin C → US: Vitamin C (any pharmacy, OTC ✅)
- Becadexamin / Berocca → US: B-complex multivitamin (any brand, OTC ✅)
- CalciTol / Calcitriol → US: Calcitriol (Rx) or Vitamin D3 supplements (OTC ✅)
- Shelcal / Calcium + D3 → US: Calcium + Vitamin D3 (OTC ✅, Citracal, Caltrate)

### MENTAL HEALTH:
- Alprazolam / Alprax / Xanax → US: Alprazolam (Rx only — CONTROLLED SUBSTANCE ⚠️)
- Escitalopram / Cipralex / Lexapro → US: Escitalopram (Rx only)
- Sertraline / Zoloft / Daxid → US: Sertraline (Rx only)
💡 Mental health medicines need special care — NEVER stop suddenly without doctor guidance

### RESPIRATORY:
- Salbutamol / Asthalin → US: Albuterol (same medicine, different name — OTC inhaler available)
- Budesonide / Pulmicort → US: Budesonide (Rx only)
- Montelukast / Singulair → US: Montelukast (Rx only)

## Critical Reasoning Rules
1. NEVER guess if you are not confident — say "I'm not 100% sure about this one. Let me tell you what I DO know, and please show this to a pharmacist to confirm."
2. ALWAYS flag Rx-only medicines — explain clearly: "You need a doctor's prescription to buy this in the US. You cannot just walk into a pharmacy and buy it."
3. ALWAYS warn about dangerous combinations with REAL-WORLD examples:
   - "Paracetamol + alcohol = liver damage (your liver has to work extra hard to process both, and it can get overwhelmed)"
   - "Ibuprofen + Aspirin = stomach bleeding (both irritate your stomach lining)"
   - "Blood pressure medicine + grapefruit = medicine becomes TOO strong"
4. For recalled drugs (Zantac/ranitidine) — immediately flag with clear explanation: "This medicine was removed from stores in the US because scientists found a chemical (NDMA) that could cause cancer over time. The safe replacement is Famotidine (Pepcid)."
5. For controlled substances — explain clearly without scaring: "This is a controlled medicine — it means the government tracks it closely because it can be habit-forming. You need a special prescription and cannot get refills as easily."
6. ALWAYS end with a pharmacist/doctor reminder — but make it EMPOWERING, not dismissive:
   "A pharmacist can check this for free — just walk in with your medicine and ask. They won't ask about insurance or immigration status. It's free to ask."

## Language Rules — THIS IS CRITICAL
- Detect the user's language from their message/caption/label
- Respond ENTIRELY in that language — every word, every section header, every emoji caption
- If the label is in Hindi but the user asks in Spanish → respond in Spanish (user's language wins)
- If unsure of language, default to English but add: "Responda en su idioma / अपनी भाषा में जवाब दें / 用你的语言回复"
- Use vocabulary a 10-year-old in that language would understand — not formal/literary language
- WhatsApp formatting: *bold*, _italic_, line breaks between sections
- Use culturally appropriate analogies (don't reference baseball in a Hindi response)

## Response Structure (ALWAYS follow this — adapt section headers to user's language)

### For Medicine Identification:
1. 💊 *What is this medicine?*
   - Name it clearly. "This is [brand name] — it contains [generic name]"
   - Explain what the generic name means in simple terms

2. 🇺🇸 *What's it called in the USA?*
   - Brand name + generic name
   - "If you go to a pharmacy and ask for [US name], they'll know exactly what you mean"

3. 🧒 *What does it do? (explained simply)*
   - Use analogy: "Think of it like..."
   - Be specific: not just "for pain" but "for headaches, body aches, toothaches, and to bring down fever"

4. 📋 *How to take it (general guidance)*
   - "Usually, adults take..." (always say usually/generally, never prescribe)
   - Time of day, with/without food, with water
   - What to do if you miss a dose
   - How long it typically takes to work

5. ⚠️ *Important warnings — PLEASE READ*
   - Who should NOT take this (allergies, pregnancy, children under X, kidney problems)
   - What NOT to mix it with (other medicines, alcohol, certain foods)
   - Side effects to watch for ("If you feel [X], stop taking it and call a doctor")
   - Maximum daily dose ("NEVER take more than [X] in 24 hours — too much can damage your [organ]")

6. 💵 *How to get it in the USA (saving money)*
   - OTC: "You can walk into any CVS, Walgreens, or Walmart pharmacy and buy this without a prescription"
   - Rx: "You need a doctor's prescription. Here's how to get one affordably..."
   - Cost tips: GoodRx (free app, shows cheapest prices), Mark Cuban Cost Plus Drugs, $4 generics at Walmart
   - For uninsured: Community health centers charge based on income (sliding scale)

7. 🏥 *When to see a doctor RIGHT NOW*
   - Red flag symptoms specific to what they're taking
   - "If you feel [X], go to the emergency room. They MUST treat you even without insurance (it's the law — EMTALA)"

8. 📞 *You're not alone*
   - "A pharmacist can check this for free — no appointment needed"
   - "If you need a doctor but can't afford one: call 211 or text your ZIP code to 898-211"
   - "Poison control (if you took too much): 1-800-222-1222 (free, 24/7, speaks [language])"

### For Symptom Questions:
- Ask 1 follow-up at a time, like a caring doctor
- Use analogies: "On a scale of 1-10, where 1 is like a small pinch and 10 is the worst pain you've ever felt"
- Always rule out emergencies FIRST before general advice
- Suggest what they can do RIGHT NOW at home while waiting to see a doctor

### For Insurance/Cost Questions:
- Explain like they've never seen an insurance document before
- "A deductible is like a 'starting fee' — you pay this amount first before insurance starts helping"
- "A copay is the small amount you pay each time you visit the doctor — like a cover charge"
- Always mention free/low-cost alternatives

## KEY COST-SAVING RESOURCES (always mention when relevant):
- 💊 GoodRx.com — free coupons, can save 80% on prescriptions
- 💊 CostPlusDrugs.com (Mark Cuban's pharmacy) — many generics under $5
- 🏥 FindAHealthCenter.hrsa.gov — federally funded clinics, charge based on what you can pay
- 📞 211 — free helpline for health and social services in any language
- 🆘 EMTALA law — emergency rooms MUST treat you regardless of ability to pay or immigration status`;

/**
 * Call K2 Think V2 via OpenAI-compatible REST API
 * No SDK needed — just axios POST to the chat completions endpoint
 */
async function callK2ThinkV2(messages, options = {}) {
  const {
    maxTokens = 4096,
    temperature = 0.7,
    stream = false,
  } = options;

  const response = await axios.post(
    `${K2_BASE_URL}/chat/completions`,
    {
      model: K2_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream,
    },
    {
      headers: {
        "Authorization": `Bearer ${K2_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      timeout: 120000, // 2 min — reasoning models can take longer
    }
  );

  return response.data;
}

async function reasonWithK2(gemmaExtraction, fdaData, userQuery, userLanguage, conversationHistory) {
  // Build the reasoning input — give K2 ALL the data Gemma and FDA found
  const reasoningInput = `
## Raw Data from Medical Vision System (MedGemma):
${JSON.stringify(gemmaExtraction, null, 2)}

## Verified FDA Database Results:
${fdaData ? JSON.stringify(fdaData, null, 2) : "No FDA match found — this is normal for foreign medicines. Rely on your training knowledge for this medicine."}

## User's Original Message / Question:
"${userQuery || "No text message — user only sent an image"}"

## Detected User Language: ${userLanguage || "unknown — auto-detect from their message"}

## Your Task — THINK DEEPLY, THEN RESPOND:

Step through this reasoning chain carefully:

1. IDENTIFY: What is this medicine? Is there enough data to be confident? If Gemma confidence is "low", ask the user for a clearer photo — tell them what angle/lighting would help.

2. MAP: What is the US equivalent? Cross-reference the drug mapping tables in your knowledge. Account for:
   - Different brand names across countries (Crocin → Tylenol)
   - Combination drugs (Combiflam = Ibuprofen + Paracetamol)
   - Medicines NOT available in the US (Domperidone)
   - Recalled medicines (Ranitidine/Zantac)

3. VERIFY: Does the FDA data confirm your identification? Are there discrepancies? If so, flag them clearly.

4. REASON ABOUT SAFETY:
   - Is this OTC or Rx-only in the USA?
   - Key dangerous interactions?
   - Who should NEVER take this? (pregnancy, children, elderly, kidney/liver disease)
   - Maximum safe dose?
   - What happens if someone takes too much? (be specific and scary enough to prevent it)

5. RESPOND: Write the complete WhatsApp response in the user's language following the response structure.
   - EXPLAIN LIKE A DOCTOR TALKING TO A 5-YEAR-OLD
   - Use analogies, simple words, warm tone
   - Every medical term must be followed by a plain-language explanation in parentheses
   - Include cost-saving resources (GoodRx, CostPlusDrugs, community health centers)
   - End with empowerment, not fear

Think carefully. A wrong answer could harm someone.
If the FDA data contradicts what you know, flag it clearly.
If the medicine is dangerous or a controlled substance, be unmistakably clear about that.
`;

  // Build conversation messages including history for multi-turn support
  const messages = [
    { role: "system", content: K2_SYSTEM_PROMPT },
    ...conversationHistory,
    { role: "user", content: reasoningInput },
  ];

  try {
    const response = await callK2ThinkV2(messages, {
      maxTokens: 4096,
      temperature: 0.7,
    });

    const choice = response.choices[0].message;

    // K2 Think V2 may include reasoning in the response itself (chain-of-thought)
    // or may have a separate reasoning_content field (like some reasoning models)
    const reasoning = choice.reasoning_content || "";
    const finalAnswer = choice.content || "";

    return {
      reasoning,      // K2's internal thought process (useful for debugging, not sent to user)
      finalAnswer,    // The actual response to send to the user
      usage: response.usage,
    };
  } catch (error) {
    console.error("[MedAI] K2 Think V2 error:", error.response?.data || error.message);
    
    // Provide a helpful fallback instead of crashing
    return {
      reasoning: "",
      finalAnswer: "⚠️ I'm having trouble processing right now. Please try again in a moment.\n\n" +
        "In the meantime:\n" +
        "📞 Poison Control: 1-800-222-1222 (free, 24/7)\n" +
        "🆘 Emergency: Call 911\n" +
        "💊 Pharmacist: Walk into any pharmacy and ask — it's free to ask questions",
      usage: null,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 4: TEXT QUERY (no image) — K2 Think V2 handles directly
// ─────────────────────────────────────────────────────────────────────────────

async function handleTextWithK2(userText, userLanguage, conversationHistory) {
  // For text queries, also do an OpenFDA check first
  const fdaData = await fdaSearch(
    "drug/label.json",
    `brand_name:"${encodeURIComponent(userText.slice(0, 50))}"` +
    `+OR+generic_name:"${encodeURIComponent(userText.slice(0, 50))}"`
  );

  const messages = [
    { role: "system", content: K2_SYSTEM_PROMPT },
    ...conversationHistory,
    {
      role: "user",
      content: `User query (language: ${userLanguage || "auto-detect"}): "${userText}"

FDA reference data found: ${fdaData ? JSON.stringify(fdaData, null, 2).slice(0, 800) : "none — use your training knowledge"}

REMEMBER:
- Respond COMPLETELY in the user's language
- Explain like a doctor talking to a 5-year-old
- Every medical term → plain explanation in parentheses
- Use analogies and warm tone
- Include cost-saving resources when relevant
- End with empowerment and actionable next steps`,
    },
  ];

  try {
    const response = await callK2ThinkV2(messages, {
      maxTokens: 4096,
      temperature: 0.7,
    });

    const choice = response.choices[0].message;
    return {
      reasoning: choice.reasoning_content || "",
      finalAnswer: choice.content || "",
    };
  } catch (error) {
    console.error("[MedAI] K2 Think V2 text error:", error.response?.data || error.message);
    return {
      reasoning: "",
      finalAnswer: "⚠️ I'm having trouble right now. Please try again.\n\n📞 For urgent help: 1-800-222-1222 (Poison Control) or 911",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LANGUAGE DETECTION (fast, before K2 call)
// ─────────────────────────────────────────────────────────────────────────────

async function detectLanguage(text) {
  if (!text || text.trim().length < 3) return "en";

  // Script detection — fast, no API call needed for obvious cases
  if (/[\u0900-\u097F]/.test(text)) return "hi"; // Devanagari → Hindi/Nepali
  if (/[\u0600-\u06FF]/.test(text)) return "ar"; // Arabic/Urdu
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh"; // Chinese
  if (/[\u0980-\u09FF]/.test(text)) return "bn"; // Bengali
  if (/[\uAC00-\uD7AF]/.test(text)) return "ko"; // Korean
  if (/[\u0400-\u04FF]/.test(text)) return "ru"; // Cyrillic
  if (/[\u0E00-\u0E7F]/.test(text)) return "th"; // Thai
  if (/[\u0B80-\u0BFF]/.test(text)) return "ta"; // Tamil
  if (/[\u0C00-\u0C7F]/.test(text)) return "te"; // Telugu
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return "ja"; // Japanese
  if (/[\u0A80-\u0AFF]/.test(text)) return "gu"; // Gujarati
  if (/[\u0A00-\u0A7F]/.test(text)) return "pa"; // Punjabi (Gurmukhi)

  // Latin script — use simple word detection for common languages
  const lower = text.toLowerCase();
  const spanishWords = ["que", "como", "donde", "gracias", "por", "para", "medicina", "quiero", "dolor", "ayuda"];
  const portugueseWords = ["como", "onde", "obrigado", "para", "medicina", "quero", "dor", "ajuda", "não"];
  const frenchWords = ["comment", "où", "merci", "pour", "médicament", "aide", "douleur", "pourquoi"];
  const tagalogWords = ["kumusta", "sakit", "tulong", "gamot", "paano", "saan"];
  const vietnameseWords = ["xin", "chào", "đau", "thuốc", "giúp", "làm", "sao"];

  const spanishScore = spanishWords.filter(w => lower.includes(w)).length;
  const portugueseScore = portugueseWords.filter(w => lower.includes(w)).length;
  const frenchScore = frenchWords.filter(w => lower.includes(w)).length;
  const tagalogScore = tagalogWords.filter(w => lower.includes(w)).length;
  const vietnameseScore = vietnameseWords.filter(w => lower.includes(w)).length;

  if (spanishScore > 1) return "es";
  if (portugueseScore > 1) return "pt";
  if (frenchScore > 1) return "fr";
  if (tagalogScore > 1) return "tl";
  if (vietnameseScore > 1) return "vi";

  // Check for accented characters common in specific languages
  if (/[áéíóúñ¿¡]/.test(text)) return "es";
  if (/[ãõç]/.test(text)) return "pt";
  if (/[àâêèëîïôùûüÿç]/.test(text)) return "fr";

  return "en"; // Default
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PIPELINE EXPORT
// ─────────────────────────────────────────────────────────────────────────────

async function runMedAIPipeline({ imageBase64, mimeType, userText, conversationHistory = [] }) {
  const userLanguage = await detectLanguage(userText);

  let gemmaResult = null;
  let fdaResult = null;

  // If image provided, run Gemma vision first
  if (imageBase64) {
    console.log("[MedAI] Stage 1: Gemma vision extraction...");
    gemmaResult = await extractWithGemma(imageBase64, mimeType || "image/jpeg", userText);
    console.log("[MedAI] Gemma confidence:", gemmaResult?.confidence_overall);

    console.log("[MedAI] Stage 2: OpenFDA verification...");
    fdaResult = await verifyWithOpenFDA(gemmaResult);
    console.log("[MedAI] FDA match:", fdaResult?.us_brand_name || "no match");

    console.log("[MedAI] Stage 3: K2 Think V2 deep reasoning...");
    const k2Result = await reasonWithK2(
      gemmaResult, fdaResult, userText, userLanguage, conversationHistory
    );

    // Log reasoning for debugging (never sent to user)
    if (k2Result.reasoning) {
      console.log("[MedAI] K2 Think V2 reasoning length:", k2Result.reasoning.length, "chars");
    }
    if (k2Result.usage) {
      console.log("[MedAI] K2 token usage:", JSON.stringify(k2Result.usage));
    }

    return {
      response: k2Result.finalAnswer,
      debug: {
        gemmaExtraction: gemmaResult,
        fdaMatch: fdaResult,
        k2Reasoning: k2Result.reasoning?.slice(0, 500) + "...", // truncated for logs
        language: userLanguage,
        model: K2_MODEL,
      },
    };
  }

  // Text-only query
  console.log("[MedAI] Text query — K2 Think V2 direct reasoning...");
  const k2Result = await handleTextWithK2(userText, userLanguage, conversationHistory);

  return {
    response: k2Result.finalAnswer,
    debug: {
      language: userLanguage,
      k2Reasoning: k2Result.reasoning?.slice(0, 500) + "...",
      model: K2_MODEL,
    },
  };
}

module.exports = { runMedAIPipeline, detectLanguage };
