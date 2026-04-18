# MedAI Prompt Engineering Guide
# The most important document in this project — READ THIS BEFORE TOUCHING ANY PROMPT

---

## The Core Problem with Medical AI Prompts

Most AI medical bots fail because their prompts are either:
- Too cautious → "Please see a doctor" for every question → **useless** to people who CAN'T afford doctors
- Too confident → give wrong dosages or claim drugs are OTC when they're not → **dangerous**

The goal is to be like a **warm pediatrician** who:
  - Sits down at eye level and explains everything in simple words
  - Uses analogies a 5-year-old could understand
  - Is honest about what they don't know
  - Empowers the patient with actionable resources
  - Still insists on professional confirmation for anything serious

---

## Architecture: Why Two Models?

### MedGemma 4B — "The Eyes"
- Google's model specifically trained on medical images (X-rays, pathology, medicine packaging)
- Outperforms general vision models on pharmaceutical OCR
- Handles multilingual labels natively (35+ languages trained in)
- Low temperature (0.1) = precise factual extraction, no hallucination
- Thinking disabled = fast, deterministic OCR

### K2 Think V2 — "The Brain" (MBZUAI Institute of Foundation Models)
- 70B-parameter open reasoning model designed for complex, multi-step problem solving
- Built for long-context reasoning with transparency and reproducibility
- OpenAI-compatible API at `https://api.k2think.ai/v1`
- Model ID: `MBZUAI-IFM/K2-Think-v2`
- Supports streaming for real-time responses
- Part of the K2 series following IFM's 360° open approach (weights, datasets, training recipes all shared)

**Why this split works:**
Gemma is optimized for visual perception accuracy — reading tiny text on blister packs, identifying pill shapes and imprint codes.
K2 Think V2 is optimized for reasoning depth and knowledge synthesis — mapping foreign drugs to US equivalents, checking safety interactions, explaining in the user's language like a caring doctor.
Neither alone is as good as both together.

---

## Prompt 1: Gemma Vision Extraction

### Design Principles
1. **Give it a persona** ("MedVision specialist agent") — models perform better with specific roles
2. **Tell it what to output, not what NOT to output** — negative constraints confuse models
3. **Low temperature + "never guess"** — OCR is factual, not creative
4. **Thinking disabled** — for pure extraction tasks, chain-of-thought adds latency with no benefit
5. **Ask for `raw_text_all`** — even if JSON parsing fails, we have the raw OCR as fallback

### Key Prompt Decisions
- "Output ONLY structured JSON. Never explain." → prevents preamble that breaks JSON parsing
- `confidence_notes` field → forces the model to flag uncertainty rather than hallucinate
- `pill_description.imprint_code` → critical for identifying unmarked pills in FDA database
- Separate `label_language` and `label_script` → Nepali and Hindi share Devanagari script

### What We DON'T ask Gemma to do
- Don't ask it to identify the US equivalent (that's K2's job)
- Don't ask it to assess safety (no medical training context)
- Don't ask it to speak to the user (wrong model for that)

### Gemma Prompt Template
```
SYSTEM: You are MedVision, a specialist medical OCR and pharmaceutical identification agent.
Your ONLY job is to extract raw factual data from medicine images with maximum accuracy.
Output ONLY structured JSON. Never explain. Never add commentary.
If you cannot read something clearly, mark it as "unclear" — never guess.

USER: [VISION_EXTRACTION_JSON_SCHEMA]
      [IMAGE]
      User's note: "[caption]"
```

---

## Prompt 2: K2 Think V2 Reasoning

### Design Principles
1. **"Explain like a doctor talking to a 5-year-old"** — this single instruction transforms every response from clinical jargon to warm, understandable guidance
2. **Front-load the drug mapping table** — K2 has this in training but explicitly listing it dramatically reduces hallucination. It becomes a reference, not a memory retrieval task
3. **"A wrong answer could harm someone"** — activates K2's safety-reasoning pathways
4. **Numbered reasoning rules** — K2 follows structured instructions better than prose
5. **Language detection before K2** — detect script/language with zero-cost regex, only pass "language: Hindi" to K2
6. **Give K2 the FDA data before asking it to reason** — don't make it reason about whether FDA matched; give it the result first
7. **Include cost-saving resources in the system prompt** — GoodRx, CostPlusDrugs, 211, EMTALA right
8. **Every medical term → plain explanation** — "Hypertension (high blood pressure — your blood pushes too hard, like water pushing too hard through a garden hose)"

### The "5-Year-Old Doctor" Standard
Every response should pass this test: **Could a grandmother in a village who's never seen a hospital understand this?**

Examples of good vs bad:
| ❌ Bad (too clinical) | ✅ Good (5-year-old level) |
|---|---|
| "Acetaminophen is an analgesic and antipyretic" | "Acetaminophen is a medicine that helps with two things: it makes pain go away (like headaches and body aches) and it brings down fever (when your body gets too hot from fighting germs)" |
| "Contraindicated in hepatic insufficiency" | "Don't take this if your liver is sick or damaged — your liver is like a filter that cleans your blood, and this medicine makes it work extra hard" |
| "Take 500mg PO q6h PRN" | "Take one 500mg pill every 6 hours when you need it (that means 4 times a day maximum: morning, noon, evening, bedtime)" |

### The Reasoning Chain We're Engineering
When K2 Think V2 receives an image query, it should internally reason:
1. "Gemma says brand name is 'Crocin' with confidence HIGH"
2. "FDA returned no result for 'Crocin' — this is expected, it's an Indian brand"
3. "From my training knowledge + the paracetamol entry in the mapping table, Crocin = Paracetamol 500mg = Tylenol"
4. "FDA shows Tylenol contains Acetaminophen 325-500mg — confirms this"
5. "This is OTC in the USA. GoodRx shows generic acetaminophen at ~$3-8 for 100 tablets"
6. "User message was in Hindi (Devanagari script) — respond entirely in Hindi"
7. "Key warning: Paracetamol + alcohol = liver damage. Must mention this."
8. "Analogy for liver damage: 'Your liver is like a washing machine — Paracetamol and alcohol together is like running two heavy loads at once. The machine breaks.'"
→ Final response in Hindi with analogies

We engineer this chain by structuring the input as:
```
## Raw Data from Medical Vision System (MedGemma):
[Gemma's JSON output]

## Verified FDA Database Results:  
[FDA API response or "No FDA match found — rely on your training knowledge"]

## User's Question: "[text]"
## Detected Language: [language]

## Your Task — THINK DEEPLY, THEN RESPOND:
1. IDENTIFY: What is this medicine? Be confident or state uncertainty.
2. MAP: What is its US equivalent?
3. VERIFY: Does FDA data confirm this?
4. REASON: OTC or Rx? Key safety considerations?
5. RESPOND: Complete response in user's language, explained like to a 5-year-old.
```

### K2 Think V2 API Configuration
```javascript
// API endpoint
const K2_BASE_URL = "https://api.k2think.ai/v1";
const K2_MODEL = "MBZUAI-IFM/K2-Think-v2";
const K2_API_KEY = process.env.K2_API_KEY; // "IFM-xxxxx"

// Call via standard OpenAI-compatible REST API
const response = await axios.post(`${K2_BASE_URL}/chat/completions`, {
  model: K2_MODEL,
  messages: [...],
  max_tokens: 4096,
  temperature: 0.7,
  stream: false  // Set true for streaming WhatsApp responses
}, {
  headers: {
    "Authorization": `Bearer ${K2_API_KEY}`,
    "Content-Type": "application/json"
  }
});
```

### Key Differences from Kimi K2:
- No `reasoning_content` separate field — K2 Think V2 includes reasoning inline
- Temperature: 0.7 works well (Kimi required 1.0)
- No SDK needed — standard REST API with axios
- `max_tokens`: 4096 is sufficient (Kimi needed 16000 for internal reasoning tokens)
- Streaming supported for faster perceived response times

### Preserving Context in Multi-Turn Conversations
K2 Think V2 uses standard OpenAI message format. Multi-turn is straightforward:

```javascript
// Good multi-turn:
history.push({
  role: "assistant",
  content: finalAnswer
});
// Just pass the full history array back to the next call
```

---

## Prompt 3: OpenFDA as Ground Truth

OpenFDA is free and official. Use it as a verification layer, not primary lookup.
The strategy:
1. Search brand_name AND generic_name AND pill imprint in PARALLEL (Promise.allSettled)
2. If any hits, pass to K2 as "verified FDA data"
3. If no hits, pass "No FDA match — rely on training" — this is normal for foreign drugs
4. K2 knows to reconcile FDA data with its own knowledge

The key insight: **OpenFDA having no result for "Crocin" is not a failure** — it means the drug is foreign and we fall back to K2's training knowledge. Never treat FDA miss as an error.

---

## Language Handling Strategy

### Three-Layer Approach (most to least expensive)

**Layer 1: Unicode script detection (free, instant)**
```javascript
/[\u0900-\u097F]/ → Hindi/Nepali (Devanagari)
/[\u0600-\u06FF]/ → Arabic/Urdu/Farsi
/[\u4E00-\u9FFF]/ → Chinese
/[\u0980-\u09FF]/ → Bengali
/[\uAC00-\uD7AF]/ → Korean
/[\u0400-\u04FF]/ → Cyrillic (Russian)
/[\u0E00-\u0E7F]/ → Thai
/[\u0B80-\u0BFF]/ → Tamil
/[\u0C00-\u0C7F]/ → Telugu
/[\u3040-\u30FF]/ → Japanese
/[\u0A80-\u0AFF]/ → Gujarati
/[\u0A00-\u0A7F]/ → Punjabi
```
This catches most immigrant users instantly — 13 script families covered.

**Layer 2: Keyword detection (free, instant)**
Common function words in Spanish, Portuguese, French, Vietnamese, Tagalog detected by word list.

**Layer 3: Let K2 detect from context**
For ambiguous Latin-script text, we say "Detected language: unknown — auto-detect from message"
and K2 will identify from linguistic patterns.

**Do NOT use external language detection APIs** — unnecessary cost for this task.

### Prompting for Language Output
Wrong: "Respond in the user's language"
Right: "Respond ENTIRELY in [language]. Every word. Every section header. Every emoji caption. Everything."

The word "entirely" and specifying headers matters. Models often fall back to English for section headers even when told to respond in another language.

### Cultural Sensitivity in Analogies
- Don't reference baseball in a Hindi response → use cricket
- Don't reference dollars in a Chinese response without also mentioning the concept simply
- Use food analogies relevant to the user's culture when possible

---

## Prompt Engineering for Safety (Critical)

### The Safe-but-Useful Balance

We want K2 to be like a warm pediatrician, not a liability-shield bot.

**Too cautious (bad):**
> "I cannot provide medical advice. Please consult a healthcare professional."

**Too confident (dangerous):**
> "Take 2 tablets every 6 hours. This is completely safe for everyone."

**Right tone (doctor explaining to a 5-year-old):**
> "Paracetamol (called Tylenol or Acetaminophen here in the US) is like a helper that does two things: it fights fever and makes pain go away. 💊
> 
> Most adults take one or two 500mg pills when they need it — but never more than 8 pills in one day. That's really important because too many can hurt your liver (the organ that cleans your blood). 
> 
> ⚠️ Really important: don't take this with alcohol. Both make your liver work hard, and together they can overwhelm it — imagine running a washing machine with two heavy loads at once.
> 
> 💵 Good news — this is very cheap in the US! You can buy a bottle of 100 pills at Walmart for about $3, no prescription needed. Just ask for 'generic Acetaminophen.'
> 
> You can also walk into any pharmacy and ask the pharmacist to check this against your other medicines — they do this for free, no appointment needed!"

### Specific Prompt Instructions That Achieve This
1. "ALWAYS use analogies — explain every medical concept like talking to a 5-year-old"
2. "Every medical term MUST be followed by a simple explanation in parentheses"
3. "ALWAYS remind user about free pharmacist consultations — emphasize 'free, no appointment'"
4. "For Rx-only medicines — note they require a US prescription but provide HOW to get one affordably"
5. "Never imply someone can buy OTC if they cannot" — but don't scare them
6. "Cost tips: GoodRx, Mark Cuban Cost Plus, Walmart $4 generics, community health centers"
7. "When to see a doctor (red flags)" section — teach them symptoms that need urgent care
8. "EMTALA — emergency rooms MUST treat you regardless of ability to pay or immigration status"
9. "Poison Control: 1-800-222-1222 — free, 24/7, speaks multiple languages"
10. "211 — free helpline for health and social services"

---

## Special Cases Prompt Engineering

### Case 1: Completely Unreadable Image
Gemma returns `confidence: "low"` and `raw_text_all` is mostly unclear.
K2 receives this and should respond:
"I can see you sent a medicine photo, but I'm having trouble reading it clearly. Could you try again with:
📸 Good lighting (natural light works best)
📐 Hold the camera steady and close to the text
🔄 Make sure the medicine name is facing the camera
Even a different angle might help — the text I need to read is usually on the front of the box or the label on the bottle."

### Case 2: Controlled Substance (Tramadol, Oxycodone, etc.)
These are critical — wrong info could lead to illegal purchase or overdose.
K2 should respond:
"⚠️ *IMPORTANT: This is a CONTROLLED substance*
This means the government closely monitors this medicine because:
1. It can be habit-forming (your body can start needing it even when the pain is gone)
2. It can be dangerous if taken incorrectly

You NEED a valid US prescription from a licensed doctor to get this.
Buying it without a prescription is illegal AND dangerous.

If you need pain relief that you CAN buy without a prescription, safer options include..."

### Case 3: Recalled Drug (Ranitidine/Zantac)
FDA recalled all ranitidine in 2020 due to NDMA contamination.
K2 should respond:
"🚨 *IMPORTANT WARNING: This medicine was RECALLED*
Ranitidine (Zantac) was pulled from ALL stores in the US in 2020 because scientists found a harmful chemical called NDMA in it. NDMA can increase cancer risk over time.

✅ *The safe replacement is:* Famotidine (Pepcid)
- It does the same thing (reduces stomach acid)
- It's safe and available at any pharmacy
- It costs about $4-8 for generic at Walmart
- No prescription needed

⚠️ Please throw away any old ranitidine/Zantac you have. Don't take it."

### Case 4: Dangerous Combination (User mentions taking multiple drugs)
K2's reasoning naturally catches this, but we reinforce with examples:
"🚨 *INTERACTION WARNING*
Taking [Drug A] and [Drug B] together can be dangerous because:
[Simple explanation with analogy]

Think of it like this: [analogy relevant to the user's culture]

What you should do:
1. Don't stop either medicine suddenly
2. Call your doctor or pharmacist TODAY
3. If you feel [specific symptoms], go to the ER immediately"

### Case 5: No Text on Image (Pills only, no packaging)
Pill description fields (color, shape, imprint code) become critical.
K2 should respond:
"I can see the pills in your photo. Let me describe what I see and try to identify them:
- Color: [X]
- Shape: [X]
- Text/numbers on the pill: [X]

Based on this, it looks like it could be [identification], but I want to be honest — identifying pills just from how they look is NOT 100% reliable. Different medicines can look similar.

🔒 The safest way to confirm:
1. Take the pill to any pharmacy and ask the pharmacist to identify it (free!)
2. Or use the FDA's pill identification database: pillbox.nlm.nih.gov"

### Case 6: Child Medicine Questions
When parents ask about children's dosing:
"For children, dosing depends on their WEIGHT, not just age. 
I can tell you what this medicine is and what it generally does, but for the exact amount for your child, please:
1. Check the child dosing chart on the medicine box
2. Ask a pharmacist (free!)
3. Call your pediatrician's nurse line (usually free)

⚠️ NEVER give adult medicine to a child without checking the dose first — children's bodies process medicine differently."

---

## Testing Your Prompts

### Test Cases to Run
1. ✅ Crocin 500mg (Indian paracetamol) → should map to Tylenol, explain simply
2. ✅ Augmentin 625 (Indian Amoxicillin-Clavulanate) → should say Rx only, explain what antibiotic means
3. ✅ Combiflam (India) → should explain BOTH ingredients simply
4. ✅ Tramadol (any country) → should flag as controlled substance, explain what that means
5. ✅ Ranitidine/Zantac → should flag recall, explain the danger, suggest Pepcid
6. ✅ Spanish image query → entire response in Spanish with analogies
7. ✅ Hindi text query → entire response in Hindi with culturally relevant analogies
8. ✅ Arabic query → entire response in Arabic
9. ✅ Unclear/blurry image → should ask for clearer photo with specific tips
10. ✅ "What medicines can I take for fever?" → list OTC options with cost info
11. ✅ Drug interaction query → clear warning with analogy
12. ✅ Insurance question → deductible/copay explained like to a child
13. ✅ "No insurance, how do I afford medicine?" → GoodRx, CostPlus, community health centers

### Evaluation Criteria
- ✅ Medicine correctly identified
- ✅ US equivalent correctly named (generic + common brand)
- ✅ OTC vs Rx correctly stated
- ✅ Key warning included (interactions, dosage caution)
- ✅ Response in correct language
- ✅ Warm, not clinical tone — "5-year-old doctor" standard
- ✅ No hallucinated dosage numbers
- ✅ Every medical term has a plain-language explanation
- ✅ At least one analogy used for complex concepts
- ✅ Cost-saving resources mentioned
- ✅ Pharmacist reminder present (emphasized as "free")
- ✅ Emergency resources when relevant (911, Poison Control, EMTALA)
- ✅ Culturally appropriate (analogies match user's language/culture)
