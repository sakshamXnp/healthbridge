/**
 * MedAI v2 — WhatsApp Server
 * Integrates: MedGemma 4B (vision) + K2 Think V2 (reasoning)
 *
 * npm install express axios @google/genai dotenv
 */

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { runMedAIPipeline, detectLanguage } = require("./orchestrator");

const app = express();
app.use(express.json());

// ─── In-memory conversation store (use Redis in production) ──────────────────
// Stores last N turns per user phone number for multi-turn context
const conversationStore = new Map();
const MAX_HISTORY_TURNS = 6; // Keep last 3 exchanges (user + assistant each)

function getHistory(phoneNumber) {
  return conversationStore.get(phoneNumber) || [];
}

function addToHistory(phoneNumber, role, content) {
  const history = getHistory(phoneNumber);
  history.push({ role, content });
  // Keep only recent turns — K2 Think V2 context is valuable but manage size
  if (history.length > MAX_HISTORY_TURNS) {
    history.splice(0, history.length - MAX_HISTORY_TURNS);
  }
  conversationStore.set(phoneNumber, history);
}

// ─── Webhook Verification ────────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === process.env.VERIFY_TOKEN
  ) {
    res.status(200).send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

// ─── Main Message Handler ────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Fast ACK — Meta retries if >15s

  const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return;

  const from = msg.from;
  const msgType = msg.type;

  // Get conversation history for this user
  const history = getHistory(from);

  try {
    if (msgType === "text") {
      const text = msg.text.body.trim();

      // Handle reset command
      if (text.toLowerCase() === "reset" || text.toLowerCase() === "clear") {
        conversationStore.delete(from);
        await sendWhatsApp(from, "✅ Conversation reset. How can I help you?\n\n🔄 Conversación reiniciada. ¿Cómo puedo ayudarte?");
        return;
      }

      // Send thinking indicator
      await sendWhatsApp(from, "🧠 Thinking deeply about your question...");

      const result = await runMedAIPipeline({
        userText: text,
        conversationHistory: history,
      });

      // Save to history for multi-turn
      addToHistory(from, "user", text);
      addToHistory(from, "assistant", result.response);

      await sendWhatsApp(from, result.response);

    } else if (msgType === "image") {
      const mediaId = msg.image.id;
      const caption = msg.image.caption || "";

      // Estimate language early from caption
      const lang = await detectLanguage(caption);

      // Send appropriate acknowledgement in user's language
      const ackMessages = {
        es: "🔍 Analizando tu medicina con nuestro sistema de inteligencia artificial médica... Dame 15-20 segundos para darte una respuesta completa.",
        hi: "🔍 हमारी मेडिकल AI प्रणाली से आपकी दवाई की गहन जांच हो रही है... पूरी जानकारी के लिए 15-20 सेकेंड रुकें।",
        ne: "🔍 तपाईंको औषधि हाम्रो मेडिकल AI ले जाँच गर्दैछ... 15-20 सेकेन्ड पर्खनुहोस्।",
        ar: "🔍 يقوم نظام الذكاء الاصطناعي الطبي بتحليل دوائك... انتظر 15-20 ثانية للحصول على إجابة شاملة.",
        zh: "🔍 我们的医疗AI系统正在深度分析您的药物... 请等待15-20秒以获取完整回复。",
        bn: "🔍 আমাদের মেডিকেল AI সিস্টেম আপনার ওষুধ বিশ্লেষণ করছে... সম্পূর্ণ উত্তরের জন্য 15-20 সেকেন্ড অপেক্ষা করুন।",
        ko: "🔍 의료 AI 시스템이 약을 분석하고 있습니다... 완전한 답변을 위해 15-20초 기다려 주세요.",
        vi: "🔍 Hệ thống AI y tế đang phân tích thuốc của bạn... Vui lòng đợi 15-20 giây.",
        tl: "🔍 Sinusuri ng aming medical AI ang iyong gamot... Maghintay ng 15-20 segundo.",
        pt: "🔍 Nosso sistema de IA médica está analisando seu medicamento... Aguarde 15-20 segundos.",
        fr: "🔍 Notre système d'IA médicale analyse votre médicament... Veuillez patienter 15-20 secondes.",
        ta: "🔍 எங்கள் மருத்துவ AI அமைப்பு உங்கள் மருந்தை பகுப்பாய்வு செய்கிறது... 15-20 வினாடிகள் காத்திருக்கவும்.",
        te: "🔍 మా వైద్య AI వ్యవస్థ మీ మందును విశ్లేషిస్తోంది... 15-20 సెకన్లు వేచి ఉండండి.",
        gu: "🔍 અમારી મેડિકલ AI સિસ્ટમ તમારી દવાનું વિશ્લેષણ કરી રહી છે... 15-20 સેકન્ડ રાહ જુઓ.",
        ja: "🔍 医療AIシステムがお薬を分析しています... 15-20秒お待ちください。",
        ru: "🔍 Наша медицинская ИИ-система анализирует ваше лекарство... Подождите 15-20 секунд.",
        en: "🔍 Our medical AI is analyzing your medicine image in detail... This takes 15-20 seconds for a thorough response.",
      };
      await sendWhatsApp(from, ackMessages[lang] || ackMessages.en);

      // Fetch full-quality image (bypasses WhatsApp compression)
      const { base64, mimeType } = await fetchFullQualityImage(mediaId);

      const result = await runMedAIPipeline({
        imageBase64: base64,
        mimeType,
        userText: caption,
        conversationHistory: history,
      });

      // Store image context in history as text summary for follow-up questions
      const imageSummary = `[User sent a medicine image${caption ? ` with caption: "${caption}"` : ""}]`;
      addToHistory(from, "user", imageSummary);
      addToHistory(from, "assistant", result.response);

      await sendWhatsApp(from, result.response);

    } else if (msgType === "voice" || msgType === "audio") {
      // Voice note — transcription not yet implemented, guide user
      await sendWhatsApp(from,
        "🎤 I received a voice message! Currently I work best with:\n\n" +
        "📸 *Photo* of any medicine label or pill\n" +
        "💬 *Text message* with your medicine question\n\n" +
        "_Voice support coming soon!_\n\n" +
        "🎤 ¡Recibí un mensaje de voz! Actualmente funciono mejor con fotos o texto."
      );

    } else {
      await sendWhatsApp(from,
        "👋 Hi! I'm MedAI — your FREE medicine assistant.\n\n" +
        "📸 Send me a *photo* of any medicine label or pill\n" +
        "💬 Or *type* your medicine question\n\n" +
        "I explain everything in simple language, like a doctor talking to a friend.\n\n" +
        "🌍 I speak 50+ languages:\n" +
        "🇪🇸 Spanish 🇮🇳 Hindi 🇳🇵 Nepali 🇸🇦 Arabic 🇨🇳 Chinese 🇻🇳 Vietnamese 🇰🇷 Korean 🇵🇭 Tagalog 🇧🇷 Portuguese 🇫🇷 French and more!\n\n" +
        "_Just write in YOUR language — I'll answer in the same language._\n\n" +
        "_Example: '¿Qué es el Paracetamol en EE.UU.?'_"
      );
    }
  } catch (err) {
    console.error("[MedAI] Error:", err.message);
    await sendWhatsApp(from,
      "⚠️ Sorry, I had trouble processing that. Please try again in a moment.\n\n" +
      "If this keeps happening, try:\n" +
      "📸 Sending a clearer photo\n" +
      "💬 Rephrasing your question\n\n" +
      "🆘 For urgent help NOW:\n" +
      "📞 Poison Control: 1-800-222-1222 (free, 24/7)\n" +
      "🚨 Emergency: Call 911"
    );
  }
});

// ─── Fetch Full-Quality Image (bypasses WhatsApp compression) ────────────────
async function fetchFullQualityImage(mediaId) {
  // Step 1: Get the direct download URL using media_id
  const urlRes = await axios.get(
    `https://graph.facebook.com/v19.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
  );

  const downloadUrl = urlRes.data.url;
  const mimeType = urlRes.data.mime_type;

  // Step 2: Download original binary
  const imgRes = await axios.get(downloadUrl, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
  });

  return {
    base64: Buffer.from(imgRes.data).toString("base64"),
    mimeType: mimeType || "image/jpeg",
  };
}

// ─── Send WhatsApp Message ────────────────────────────────────────────────────
async function sendWhatsApp(to, text) {
  // WhatsApp has a 4096 character limit per message
  // Split long responses automatically
  const chunks = splitMessage(text, 4000);

  for (const chunk of chunks) {
    await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: chunk },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    // Small delay between chunks to maintain order
    if (chunks.length > 1) await new Promise(r => setTimeout(r, 500));
  }
}

function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];

  const chunks = [];
  // Split on double newlines to keep paragraphs together
  const paragraphs = text.split("\n\n");
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > maxLen) {
      if (current) chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current) chunks.push(current.trim());

  return chunks;
}

// ─── Health Check ────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "2.0-k2",
    models: ["medgemma-4b-it", "MBZUAI-IFM/K2-Think-v2"],
    reasoning_engine: "K2 Think V2 — 70B parameter open reasoning model by MBZUAI-IFM",
    k2_configured: !!process.env.K2_API_KEY,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║   🏥 MedAI v2 — Dual-Model Medical Assistant                  ║
║   👁️  Vision: MedGemma 4B (Google)                             ║
║   🧠 Reasoning: K2 Think V2 (MBZUAI-IFM, 70B)                ║
║   Running on :${PORT}                                            ║
╚════════════════════════════════════════════════════════════════╝
  `);
  console.log(`K2 Think V2 API: ${process.env.K2_API_KEY ? "✅ configured" : "❌ missing K2_API_KEY"}`);
  console.log(`Google AI API: ${process.env.GOOGLE_AI_API_KEY ? "✅ configured" : "❌ missing GOOGLE_AI_API_KEY"}`);
});
