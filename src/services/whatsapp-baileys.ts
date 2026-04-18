import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, downloadMediaMessage } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import P from 'pino';

let sock: any;
let qrCode: string | null = null;
let connectionStatus: 'connecting' | 'connected' | 'disconnected' = 'disconnected';

export async function startWhatsAppBot(handleMessage: (from: string, text: string, media?: { type: string; buffer: Buffer; mimeType: string } | null) => Promise<void>) {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: P({ level: 'silent' }),
    auth: state,
    browser: ['HealthBridge', 'Desktop', '1.0.0']
  });

  sock.ev.on('connection.update', (update: any) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCode = qr;
      console.log('\n📱 QR Code generated! Scan with WhatsApp → Linked Devices → Link a Device');
      console.log('   Or visit http://localhost:3000/qr to scan from browser\n');
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed, reconnecting:', shouldReconnect);
      connectionStatus = 'disconnected';
      qrCode = null;
      if (shouldReconnect) {
        setTimeout(() => startWhatsAppBot(handleMessage), 5000);
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp connected! Bot is active on:', sock.user?.id);
      connectionStatus = 'connected';
      qrCode = null;
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (m: any) => {
    const msg = m.messages[0];
    console.log(`[DEBUG] Received message event. Type: ${m.type}, fromMe: ${msg.key.fromMe}`);
    if (msg.message) {
      console.log(`[DEBUG] Keys in msg.message:`, Object.keys(msg.message));
    }
    
    if (!msg.key.fromMe && (m.type === 'notify' || m.type === 'append')) {
      const from = msg.key.remoteJid!;
      if (from.endsWith('@g.us') || from.endsWith('@newsletter') || from.endsWith('status@broadcast')) return;

      let text = '';
      let media: { type: string; buffer: Buffer; mimeType: string } | null = null;

      if (msg.message?.conversation) {
        text = msg.message.conversation;
      } else if (msg.message?.extendedTextMessage?.text) {
        text = msg.message.extendedTextMessage.text;
      } else if (msg.message?.imageMessage) {
        text = msg.message.imageMessage.caption || '';
        try {
          const buffer = await downloadMediaMessage(msg, 'buffer', {});
          media = { type: 'image', buffer: buffer as Buffer, mimeType: msg.message.imageMessage.mimetype || 'image/jpeg' };
        } catch (err) {
          console.error('[Media] Failed to download image:', err);
        }
      } else if (msg.message?.documentMessage) {
        text = msg.message.documentMessage.caption || '';
        try {
          const buffer = await downloadMediaMessage(msg, 'buffer', {});
          media = { type: 'document', buffer: buffer as Buffer, mimeType: msg.message.documentMessage.mimetype || 'application/pdf' };
        } catch (err) {
          console.error('[Media] Failed to download document:', err);
        }
      }

      console.log(`📩 Message from ${from}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}${media ? ` [${media.type}]` : ''}`);
      await handleMessage(from, text, media);
    }
  });

  return sock;
}

export async function sendMessage(to: string, text: string) {
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp not connected');
  }
  const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text });
}

export function getQRCode(): string | null {
  return qrCode;
}

export function getConnectionStatus() {
  return { status: connectionStatus, user: sock?.user };
}
