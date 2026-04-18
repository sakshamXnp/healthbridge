import 'dotenv/config';
import Fastify from 'fastify';
import { startWhatsAppBot, sendMessage, getQRCode, getConnectionStatus } from './services/whatsapp-baileys.js';
import { handleWhatsApp } from './webhook.js';
import { getActiveSessionCount } from './services/session.js';

const fastify = Fastify({ logger: false });

// QR Code page
fastify.get('/qr', async (request, reply) => {
  const qr = getQRCode();
  if (!qr) {
    const status = getConnectionStatus();
    if (status.status === 'connected') {
      return reply.type('text/html').send(`
        <!DOCTYPE html><html><head><title>HealthBridge — Connected</title></head>
        <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;font-family:'Segoe UI',sans-serif;background:#0a0a0a;color:#fff;">
          <div style="text-align:center;padding:48px;border-radius:20px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);">
            <div style="font-size:56px;margin-bottom:16px;">✅</div>
            <h1 style="color:#22c55e;margin:0 0 8px;">Connected & Active</h1>
            <p style="color:#aaa;margin:4px 0;">WhatsApp: <strong style="color:#fff;">${status.user?.id || 'unknown'}</strong></p>
            <p style="color:#666;font-size:14px;margin-top:16px;">Active sessions: ${getActiveSessionCount()} | Uptime: ${Math.floor(process.uptime() / 60)}m</p>
          </div>
        </body></html>`);
    }
    return reply.type('text/html').send(`
      <!DOCTYPE html><html><head><title>HealthBridge — Connecting</title><meta http-equiv="refresh" content="5"></head>
      <body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;background:#0a0a0a;color:#fff;">
        <div style="text-align:center;"><div style="width:48px;height:48px;border:3px solid rgba(255,255,255,0.1);border-top-color:#3b82f6;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 24px;"></div><h2>Connecting...</h2><p style="color:#888;">Auto-refreshes in 5s</p></div>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
      </body></html>`);
  }
  return reply.type('text/html').send(`
    <!DOCTYPE html><html><head><title>HealthBridge QR</title><meta http-equiv="refresh" content="20"></head>
    <body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;background:#0a0a0a;color:#fff;">
      <div style="text-align:center;padding:40px;border-radius:16px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);">
        <h2 style="margin-bottom:4px;">📱 Scan with WhatsApp</h2>
        <p style="color:#888;margin-bottom:24px;">Settings → Linked Devices → Link a Device</p>
        <div style="background:#fff;padding:16px;border-radius:12px;display:inline-block;">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}" style="display:block;" />
        </div>
      </div></body></html>`);
});

// Health check
fastify.get('/health', async () => ({
  status: 'ok',
  whatsapp: getConnectionStatus().status,
  user: getConnectionStatus().user?.id || null,
  sessions: getActiveSessionCount(),
  uptime: `${Math.floor(process.uptime() / 60)}m ${Math.floor(process.uptime() % 60)}s`,
  models: {
    vision: 'Hugging Face Inference Endpoint (OCR, image analysis)',
    reasoning: 'K2 Think V2 — MBZUAI-IFM/K2-Think-v2 (70B, deep reasoning)',
    k2_configured: !!process.env.K2_API_KEY,
  },
  features: {
    emergency_override: '9 languages, <50ms, no LLM',
    vision_ocr: 'HF Endpoint → prescriptions, pills, reports',
    deep_reasoning: 'K2 Think V2 → medication analysis, document explanation',
    drug_interactions: 'RxNorm + openFDA FAERS — real death counts',
    symptom_triage: 'Conversational 6-step + K2 assessment + MedlinePlus',
    clinic_finder: 'ZIP → nearest FQHCs with sliding fee scale',
    pill_identification: 'HF Endpoint → K2 reasoning → FDA verified',
    discharge_explainer: 'K2 Think V2 → medical jargon → 5-year-old language',
    medication_reminders: '3-tier escalation (initial → missed → caregiver)',
    medication_safety_score: 'Green/Yellow/Red based on interactions',
    cost_saving: 'GoodRx, CostPlusDrugs, Walmart $4, EMTALA rights',
    languages: 'EN, ES, ZH, HI, AR, VI, KO, TL, PT + auto-detect 16+ scripts',
    security: 'HMAC hashing, rate limiting, zero PHI storage'
  }
}));

// Manual send endpoint
fastify.post('/send', async (request, reply) => {
  const { to, message } = request.body as { to: string; message: string };
  if (!to || !message) return reply.code(400).send({ error: 'Missing "to" or "message"' });
  try {
    await sendMessage(to, message);
    return { sent: true, to, length: message.length };
  } catch (err: any) {
    return reply.code(400).send({ error: err.message });
  }
});

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║   🏥 HealthBridge — AI Health Companion v3.0                   ║
║   Dual-Model: HF Endpoint (Vision) + K2 Think V2 (Reasoning)   ║
║   Production Mode · All Features Active                        ║
╚════════════════════════════════════════════════════════════════╝

🧠 AI Models:
   👁️  Vision:    Hugging Face Inference Endpoint (OCR, image analysis)
   🧠 Reasoning: K2 Think V2 — MBZUAI/IFM (70B deep reasoning)
   K2 API Key:  ${process.env.K2_API_KEY ? '✅ configured' : '❌ missing — add K2_API_KEY to .env'}

🚀 Active Features:
   🚨 Emergency Override ......... 9 languages, <50ms, no AI needed
   📸 Pill Identification ........ HF Endpoint → K2 reasoning → FDA verify
   📄 Document Reader ............ Prescriptions, discharge, labs, EOBs
   💊 Drug Interactions .......... RxNorm + FDA FAERS (real death data)
   🩺 Symptom Assessment ......... 6-step conversational + K2 analysis
   🏥 Clinic Finder .............. ZIP → free/low-cost FQHCs
   📋 Discharge Explainer ........ K2 Think V2 → 5-year-old language
   ⏰ Medication Reminders ....... 3-tier escalation system
   🛡️ Safety Score ............... Green/Yellow/Red interaction rating
   💵 Cost Saving ................ GoodRx, CostPlusDrugs, Walmart $4
   🌍 Languages .................. 16+ scripts auto-detected
   🔒 Security ................... HMAC, rate limiting, zero PHI
`);

  // Start WhatsApp bot
  await startWhatsAppBot(async (from, text, media) => {
    try {
      const mockReq = {
        body: {
          From: from,
          Body: text,
          MediaBuffer: media?.buffer || null,
          MediaType: media?.mimeType || '',
        }
      };
      const mockReply = {
        code: (code: number) => ({
          send: (body: any) => {
            if (code >= 400) console.log(`   ⚠️ [${code}]:`, JSON.stringify(body));
          }
        })
      };
      await handleWhatsApp(mockReq as any, mockReply as any);
    } catch (err) {
      console.error('❌ Error:', err);
      try { await sendMessage(from, '⚠️ Something went wrong. Please try again in a moment.'); } catch {}
    }
  });

  await fastify.listen({ port: 3000, host: '0.0.0.0' });

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Server: http://localhost:3000
   QR:     http://localhost:3000/qr
   Health: http://localhost:3000/health
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch(console.error);
