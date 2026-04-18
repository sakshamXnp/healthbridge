// src/webhook.ts — Production HealthBridge Webhook
// Dual-model: Gemma (vision/OCR) + K2 Think V2 (deep reasoning)
import { sendMessage } from './services/whatsapp-baileys.js';
import { openrouterService } from './services/openrouter.js';
import { k2ThinkService } from './services/k2-think.js';
import { getOrCreateSession, addToConversationHistory, resetFlow } from './services/session.js';
import { checkRateLimit, sanitize } from './services/security.js';
import { checkEmergency, getEmergencyResponse } from './flows/emergency.js';
import { handlePrescription, handleDischarge, handleGenericDocument } from './flows/medication.js';
import { startTriage, continueTriage } from './flows/triage.js';
import { startProvider, continueProvider, handleSafeAccess, handleInsurance } from './flows/provider.js';
import { handleReminderSetup, handleTaken } from './flows/reminder.js';
import { processImage, processPDF, classifyDocument } from './services/vision.js';
import { normalizeDrugName } from './services/rxnorm.js';
import { checkInteractions, getDrugInfo } from './services/openfda.js';
import { WELCOME, UPLOAD_TIP, PROCESSING_MSG, RATE_LIMIT_MSG } from './data/messages.js';
import { PILL_ID_PROMPT } from './prompts.js';
import { Language, VisionResult } from './types/index.js';
import sharp from 'sharp';
import axios from 'axios';

// ─── Fetch Full-Quality Image (bypasses WhatsApp compression) ────────────────
async function fetchFullQualityImage(mediaId: string): Promise<{ base64: string, mimeType: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error("Missing WHATSAPP_TOKEN in environment");

  // Step 1: Get the direct download URL using media_id
  const urlRes = await axios.get(
    `https://graph.facebook.com/v19.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  const downloadUrl = urlRes.data.url;
  const mimeType = urlRes.data.mime_type;

  // Step 2: Download original binary
  const imgRes = await axios.get(downloadUrl, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${token}` },
  });

  return {
    base64: Buffer.from(imgRes.data).toString("base64"),
    mimeType: mimeType || "image/jpeg",
  };
}

export async function handleWhatsApp(request: any, reply: any) {
  try {
    const body = request.body;
    const from: string = body.From || '';
    const rawText: string = body.Body || '';
    let mediaBuffer: Buffer | null = body.MediaBuffer || null;
    let mediaType: string = body.MediaType || '';
    const mediaId: string = body.MediaId || '';

    // Meta Production Webhook — fetch full resolution image using media_id
    if (mediaId && !mediaBuffer) {
      console.log(`   📸 Fetching full-quality original image from Meta for media_id: ${mediaId}`);
      try {
        const fullQuality = await fetchFullQualityImage(mediaId);
        mediaBuffer = Buffer.from(fullQuality.base64, 'base64');
        mediaType = fullQuality.mimeType;
      } catch (err: any) {
        console.error("   ❌ Failed to fetch full-quality image:", err.message);
      }
    }

    if (!from) return reply.code(400).send({ error: 'Missing sender ID' });

    const text = sanitize(rawText);

    // Rate limit
    if (!checkRateLimit(from)) {
      await sendMessage(from, RATE_LIMIT_MSG.en || '⏳ Too many messages. Please wait.');
      return reply.code(200).send({ status: 'rate_limited' });
    }

    const session = getOrCreateSession(from);

    // ===== 1. EMERGENCY OVERRIDE — instant, no LLM =====
    const emergencyLang = checkEmergency(text);
    if (emergencyLang) {
      session.language = emergencyLang;
      await sendMessage(from, getEmergencyResponse(emergencyLang));
      console.log(`   🚨 EMERGENCY [${emergencyLang}]`);
      return reply.code(200).send({ status: 'emergency' });
    }

    // ===== 2. TAKEN acknowledgment =====
    const lowerTrim = text.toLowerCase().trim();
    if (['taken', 'tomado', '已服', 'लिया', 'تم', 'đã uống', '복용완료', 'ininom'].includes(lowerTrim)) {
      const response = handleTaken(from, session);
      await sendMessage(from, response);
      return reply.code(200).send({ status: 'taken' });
    }

    // ===== 3. MEDIA — Images, PDFs, Documents =====
    if (mediaBuffer) {
      return await handleMedia(from, text, mediaBuffer, mediaType, session, reply);
    }

    // Empty text, no media — skip
    if (!text.trim()) return reply.code(200).send({ status: 'empty' });

    // ===== 4. CONTINUE ACTIVE FLOW =====
    if (session.currentFlow !== 'idle') {
      console.log(`   🔄 Flow: ${session.currentFlow} step ${session.triageStep}`);
      switch (session.currentFlow) {
        case 'triage':
          await continueTriage(from, text, session, sendMessage);
          break;
        case 'provider':
        case 'safe_access':
          await continueProvider(from, text, session, sendMessage);
          break;
        case 'reminder_setup':
          await handleReminderSetup(from, text, session, sendMessage);
          break;
        default:
          resetFlow(session);
          break;
      }
      return reply.code(200).send({ status: 'flow', flow: session.currentFlow });
    }

    // ===== 5. DETECT INTENT =====
    const intent = await openrouterService.detectIntent(text, session.language);
    console.log(`   🧠 Intent: ${intent.intent} [${intent.detectedLanguage}] (${intent.confidence})`);

    // Update language from detection
    const validLangs: Language[] = ['en', 'es', 'zh', 'hi', 'ar', 'vi', 'ko', 'tl', 'pt'];
    if (validLangs.includes(intent.detectedLanguage as Language)) {
      session.language = intent.detectedLanguage as Language;
    }

    // ===== 6. ROUTE BY INTENT =====
    switch (intent.intent) {
      case 'emergency':
        const eLang = checkEmergency(text) || session.language;
        await sendMessage(from, getEmergencyResponse(eLang as Language));
        break;

      case 'triage':
        await startTriage(from, text, session, sendMessage);
        break;

      case 'medication':
        await handleMedicationQuery(from, text, session);
        break;

      case 'find_provider':
        await startProvider(from, text, session, sendMessage);
        break;

      case 'safe_access':
        await handleSafeAccess(from, text, session, sendMessage);
        break;

      case 'insurance':
        // Route insurance through K2 for deep, warm explanation
        addToConversationHistory(session, 'user', text);
        const insuranceResp = await openrouterService.explainInsurance(text, session.language, session.conversationHistory);
        addToConversationHistory(session, 'assistant', insuranceResp);
        await sendMessage(from, insuranceResp);
        break;

      case 'greeting':
        const welcome = WELCOME[session.language] || WELCOME.en;
        await sendMessage(from, welcome);
        addToConversationHistory(session, 'assistant', '[welcome]');
        break;

      case 'taken':
        const takenResp = handleTaken(from, session);
        await sendMessage(from, takenResp);
        break;

      default:
        // General AI conversation — K2 Think V2 handles with deep reasoning
        addToConversationHistory(session, 'user', text);
        const aiResp = await openrouterService.chat(text, session.language, session.conversationHistory);
        addToConversationHistory(session, 'assistant', aiResp);
        await sendMessage(from, aiResp);
        break;
    }

    return reply.code(200).send({ status: 'processed', intent: intent.intent });
  } catch (err: any) {
    console.error('❌ Webhook error:', err.message || err);
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

// --- MEDIA HANDLING ---
async function handleMedia(
  from: string,
  caption: string,
  buffer: Buffer,
  mimeType: string,
  session: any,
  reply: any
): Promise<any> {
  // Process based on type
  let vision: VisionResult;

  if (mimeType === 'application/pdf') {
    vision = await processPDF(buffer);
    if (vision.text && vision.confidence > 0.5) {
      const docType = await classifyDocument(vision.text);
      if (docType === 'discharge' || docType === 'lab_result') {
        // Route document explanation through K2 Think V2 for deep, warm explanation
        const explanation = await openrouterService.explainDocument(vision.text, docType, session.language);
        await sendMessage(from, explanation);
        return reply.code(200).send({ status: 'document_explained', type: docType });
      }
    }
  }

  // Image — could be prescription, pill, report, etc.
  try {
    const resized = await sharp(buffer)
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    const base64 = resized.toString('base64');

    // Try pill identification first (unique feature)
    const pillResult = await openrouterService.analyzeImage(base64, PILL_ID_PROMPT);
    const pillJson = tryParseJSON(pillResult);

    if (pillJson?.identified && pillJson.confidence > 0.6) {
      // It's a pill/medication photo — use K2 for deep pill analysis
      await handlePillIdentification(from, pillJson, base64, session);
      return reply.code(200).send({ status: 'pill_identified' });
    }

    // Try medical document analysis
    vision = await processImage(buffer, mimeType, session.language);
    const docType = vision.structured?.documentType || await classifyDocument(vision.text);
    console.log(`   📄 Doc: ${docType} (confidence: ${vision.confidence})`);

    if (vision.structured?.medications?.length) {
      await handlePrescription(from, vision, session, sendMessage);
    } else if (docType === 'discharge') {
      await handleDischarge(from, vision, session, sendMessage);
    } else if (vision.text) {
      // Route through K2 Think V2 for warm, thorough document explanation
      const explanation = await openrouterService.explainDocument(vision.text, docType, session.language);
      await sendMessage(from, explanation);
    } else {
      // Fallback message if vision completely failed
      await sendMessage(from, "⚠️ I'm sorry, my vision system couldn't process this image clearly. Could you describe what it is, or take another photo?");
    }
  } catch (err) {
    console.error('   ❌ Media processing error:', err);
    const errorMsg = session.language === 'es'
      ? '❌ No pude procesar esa imagen. ¿Podrías enviarla de nuevo, preferiblemente como archivo (📎 → Documento)?'
      : '❌ I couldn\'t process that image. Could you send it again, preferably as a file (📎 → Document)?';
    await sendMessage(from, errorMsg);
  }

  return reply.code(200).send({ status: 'media_processed' });
}

// --- PILL IDENTIFICATION (K2 Think V2 Enhanced) ---
async function handlePillIdentification(from: string, pill: any, imageBase64: string, session: any): Promise<void> {
  const lang = session.language;

  // Prepare vision data summary for K2
  const visionSummary = JSON.stringify({
    medicationName: pill.medicationName,
    genericName: pill.genericName,
    dosage: pill.dosage,
    manufacturer: pill.manufacturer,
    purpose: pill.purpose,
    usEquivalent: pill.usEquivalent,
    instructions: pill.instructions,
    warnings: pill.warnings,
    confidence: pill.confidence,
  }, null, 2);

  // Get FDA data for verification
  let fdaContext = '';
  if (pill.medicationName || pill.genericName) {
    const drugName = pill.genericName || pill.medicationName;
    const rxcui = await normalizeDrugName(drugName);
    if (rxcui) {
      const info = await getDrugInfo(rxcui);
      fdaContext = JSON.stringify(info, null, 2);

      // Check interactions with session medications
      if (session.medications?.length > 0) {
        const existing = session.medications.map((m: any) => m.rxcui);
        const interactions = await checkInteractions([...existing, rxcui]);
        if (interactions.length > 0) {
          fdaContext += `\n\nINTERACTION WARNINGS:\n${JSON.stringify(interactions, null, 2)}`;
        }
      }
    }
  }

  // Try K2 Think V2 for deep, warm pill analysis
  const k2Response = await openrouterService.analyzePillDeep(visionSummary, fdaContext, lang);

  if (k2Response) {
    // K2 gave a thorough analysis — send it
    await sendMessage(from, k2Response);
  } else {
    // Fallback to the structured pill ID response
    await sendStructuredPillResponse(from, pill, fdaContext, session);
  }
}

// Fallback structured pill response (when K2 is unavailable)
async function sendStructuredPillResponse(from: string, pill: any, fdaContext: string, session: any): Promise<void> {
  const lang = session.language;
  let msg = '';

  if (lang === 'es') {
    msg = `💊 *Medicamento Identificado*\n\n`;
    msg += `*Nombre:* ${pill.medicationName || 'No identificado'}\n`;
    if (pill.genericName) msg += `*Genérico:* ${pill.genericName}\n`;
    if (pill.dosage) msg += `*Dosis:* ${pill.dosage}\n`;
    if (pill.manufacturer) msg += `*Fabricante:* ${pill.manufacturer}\n`;
    msg += `\n*¿Para qué sirve?*\n${pill.purpose || 'No disponible'}\n`;
    if (pill.usEquivalent) msg += `\n🇺🇸 *Equivalente en EE.UU.:* ${pill.usEquivalent}\n`;
    msg += `\n*Instrucciones:*\n${pill.instructions || 'Consulte a su médico'}\n`;
    if (pill.warnings?.length) {
      msg += `\n⚠️ *Advertencias:*\n`;
      pill.warnings.forEach((w: string) => { msg += `• ${w}\n`; });
    }
    msg += `\n💵 *Ahorra dinero:* Busca en GoodRx.com o CostPlusDrugs.com para comparar precios`;
    msg += `\n📞 Un farmacéutico puede verificar esto GRATIS — solo entra y pregunta`;
  } else {
    msg = `💊 *Medication Identified*\n\n`;
    msg += `*Name:* ${pill.medicationName || 'Unknown'}\n`;
    if (pill.genericName) msg += `*Generic:* ${pill.genericName}\n`;
    if (pill.dosage) msg += `*Dosage:* ${pill.dosage}\n`;
    if (pill.manufacturer) msg += `*Manufacturer:* ${pill.manufacturer}\n`;
    msg += `\n*What it's for:*\n${pill.purpose || 'Not available'}\n`;
    if (pill.usEquivalent) msg += `\n🇺🇸 *US Equivalent:* ${pill.usEquivalent}\n`;
    msg += `\n*How to take:*\n${pill.instructions || 'Consult your doctor'}\n`;
    if (pill.warnings?.length) {
      msg += `\n⚠️ *Warnings:*\n`;
      pill.warnings.forEach((w: string) => { msg += `• ${w}\n`; });
    }
    msg += `\n💵 *Save money:* Check GoodRx.com or CostPlusDrugs.com to compare prices`;
    msg += `\n📞 A pharmacist can verify this for FREE — just walk in and ask`;
  }

  msg += `\n\n_Confidence: ${Math.round((pill.confidence || 0) * 100)}%_`;
  msg += `\n\n💬 Want to know more about this medication? Just ask!`;

  await sendMessage(from, msg);
}

// --- MEDICATION QUERY (Text-based, K2 Think V2 + openFDA) ---
async function handleMedicationQuery(from: string, text: string, session: any): Promise<void> {
  addToConversationHistory(session, 'user', text);

  // Try to extract drug names from the message
  const drugMatches = text.match(/\b([A-Z][a-z]+(?:in|ol|pine|ide|ate|one|fen|pam|lam|tin|ril|tan|mab)\b)/gi) || [];

  let fdaContext = '';

  for (const drugName of drugMatches.slice(0, 3)) {
    const rxcui = await normalizeDrugName(drugName);
    if (rxcui) {
      const info = await getDrugInfo(rxcui);
      fdaContext += `\n[FDA DATA for ${drugName}]: Purpose: ${info.purpose}. Generic: ${info.genericName}. Warnings: ${info.warnings.join('; ')}`;
    }
  }

  // If user has existing medications, check interactions
  if (drugMatches.length > 0 && session.medications?.length > 0) {
    const existingRxcuis = session.medications.map((m: any) => m.rxcui);
    for (const drugName of drugMatches) {
      const rxcui = await normalizeDrugName(drugName);
      if (rxcui) {
        const interactions = await checkInteractions([...existingRxcuis, rxcui]);
        if (interactions.length > 0) {
          for (const ix of interactions) {
            fdaContext += `\n[FDA INTERACTION WARNING]: ${ix.drug1} + ${ix.drug2}: ${ix.description}. Deaths: ${ix.deathCount}`;
          }
        }
      }
    }
  }

  // Route through K2 Think V2 for deep medication reasoning
  const response = await openrouterService.medicationChat(text, fdaContext, session.language, session.conversationHistory);
  addToConversationHistory(session, 'assistant', response);
  await sendMessage(from, response);
}

function tryParseJSON(str: string): any {
  try {
    const match = str.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return null;
  } catch { return null; }
}
