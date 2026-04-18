// src/data/emergency_keywords.ts
// 9-language emergency detection — runs BEFORE any LLM, <50ms
import { Language } from '../types/index.js';

export const EMERGENCY_KEYWORDS: Record<Language, string[]> = {
  en: ['chest pain', 'cant breathe', "can't breathe", 'not breathing',
       'unconscious', 'stroke', 'seizure', 'severe bleeding', 'overdose',
       'heart attack', 'choking', 'not responsive', 'suicid', 'self harm',
       'anaphyla', 'allergic reaction'],
  es: ['dolor de pecho', 'no puedo respirar', 'no respira', 'inconsciente',
       'derrame cerebral', 'convulsión', 'sangrado severo', 'sobredosis',
       'ataque al corazón', 'se está ahogando', 'suicid'],
  zh: ['胸痛', '无法呼吸', '失去意识', '中风', '癫痫', '大出血', '心脏病发作',
       '不能呼吸', '昏迷'],
  hi: ['सीने में दर्द', 'सांस नहीं ले सकता', 'बेहोश', 'दौरा', 'हार्ट अटैक',
       'खून बह रहा', 'सांस नहीं आ रही'],
  ar: ['ألم في الصدر', 'لا أستطيع التنفس', 'فقدان الوعي', 'سكتة دماغية',
       'نزيف حاد', 'نوبة قلبية', 'تشنج'],
  vi: ['đau ngực', 'không thở được', 'bất tỉnh', 'đột quỵ', 'co giật',
       'chảy máu nhiều', 'đau tim'],
  ko: ['가슴 통증', '숨을 쉴 수 없다', '의식 없음', '뇌졸중', '발작',
       '심한 출혈', '심장 마비'],
  tl: ['sakit sa dibdib', 'hindi makahinga', 'nawalan ng malay',
       'atake sa puso', 'matinding pagdurugo', 'kombulsyon'],
  pt: ['dor no peito', 'não consigo respirar', 'inconsciente', 'derrame',
       'convulsão', 'sangramento grave', 'ataque cardíaco', 'overdose'],
};

export const EMERGENCY_RESPONSES: Record<Language, string> = {
  en: `🚨 *EMERGENCY: Call 911 NOW.* Tell them your location.

You have the *RIGHT* to emergency care regardless of immigration status.
Hospitals *CANNOT* deny emergency treatment — this is federal law (EMTALA).

While waiting for help:
• Stay as calm as possible
• Do not move unless in immediate danger
• If someone is not breathing, begin CPR if trained
• Stay on the line with 911`,

  es: `🚨 *EMERGENCIA: Llame al 911 AHORA.* Diga su ubicación.

Tiene *DERECHO* a atención de emergencia sin importar su estado migratorio.
Los hospitales *NO pueden* negar tratamiento — es ley federal (EMTALA).

Mientras espera ayuda:
• Mantenga la calma
• No se mueva a menos que esté en peligro inmediato
• Si alguien no respira, comience RCP si está capacitado
• Permanezca en la línea con el 911`,

  zh: `🚨 *紧急情况：立即拨打911。* 告知您的位置。

无论移民身份，您都有*权利*获得急救护理。
医院*不能*拒绝急救治疗——这是联邦法律（EMTALA）。

等待帮助时：
• 尽量保持冷静
• 除非有直接危险，否则不要移动
• 如果有人没有呼吸，如果受过训练请开始心肺复苏`,

  hi: `🚨 *आपातकाल: अभी 911 पर कॉल करें।* अपना स्थान बताएं।

आव्रजन स्थिति की परवाह किए बिना आपको आपातकालीन देखभाल का *अधिकार* है।
अस्पताल आपातकालीन उपचार से इनकार *नहीं कर सकते* — यह संघीय कानून है (EMTALA)।`,

  ar: `🚨 *طوارئ: اتصل بـ 911 الآن.* أخبرهم بموقعك.

لديك *الحق* في الرعاية الطارئة بغض النظر عن وضعك كمهاجر.
المستشفيات *لا يمكنها* رفض العلاج الطارئ — هذا قانون فدرالي (EMTALA).`,

  vi: `🚨 *KHẨN CẤP: Gọi 911 NGAY.* Cho họ biết vị trí của bạn.

Bạn có *QUYỀN* được chăm sóc khẩn cấp bất kể tình trạng nhập cư.
Bệnh viện *KHÔNG THỂ* từ chối điều trị khẩn cấp — đây là luật liên bang (EMTALA).`,

  ko: `🚨 *긴급상황: 지금 즉시 911에 전화하세요.* 위치를 알려주세요.

이민 신분에 관계없이 응급 치료를 받을 *권리*가 있습니다.
병원은 응급 치료를 *거부할 수 없습니다* — 이것은 연방법(EMTALA)입니다.`,

  tl: `🚨 *EMERGENCY: Tumawag sa 911 NGAYON.* Sabihin ang iyong lokasyon.

May *KARAPATAN* ka sa emergency care kahit ano pa ang iyong immigration status.
Ang mga ospital ay *HINDI MAAARING* tanggihan ang emergency treatment — ito ay pederal na batas (EMTALA).`,

  pt: `🚨 *EMERGÊNCIA: Ligue para o 911 AGORA.* Diga sua localização.

Você tem o *DIREITO* a atendimento de emergência independentemente do status de imigração.
Hospitais *NÃO PODEM* negar tratamento de emergência — isso é lei federal (EMTALA).`,
};

export function checkEmergency(message: string): Language | null {
  const lower = message.toLowerCase();
  for (const [lang, keywords] of Object.entries(EMERGENCY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return lang as Language;
  }
  return null;
}
