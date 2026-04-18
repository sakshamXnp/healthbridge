// ...existing code with secrets removed and using environment variables...
// src/services/openrouter.ts
// Dual-model architecture:
//   OpenRouter/Claude → fast tasks (intent detection, vision OCR)
//   K2 Think V2 → deep reasoning (chat, medication analysis, document explanation)

import axios from 'axios';
import { SYSTEM_PROMPTS, DEFAULT_SYSTEM_PROMPT, INTENT_PROMPT, VISION_PROMPT, PILL_ID_PROMPT, DISCHARGE_EXPLAIN_PROMPT } from '../prompts.js';
import { k2ThinkService } from './k2-think.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export class OpenRouterService {
  private apiKey: string;
  private textModel = 'anthropic/claude-3-haiku';

  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY || '';
  }

  /**
   * Main chat — routes to K2 Think V2 for deep reasoning, falls back to OpenRouter
   */
  async chat(
    message: string,
    language: string = 'en',
    history?: { role: 'user' | 'assistant'; content: string }[]
  ): Promise<string> {
    // Try K2 Think V2 first — it has the mega "5-year-old doctor" prompt
    if (k2ThinkService.isConfigured()) {
      console.log('   🧠 Routing to K2 Think V2 for deep reasoning...');
      const k2Response = await k2ThinkService.chat(message, language, history);
      if (k2Response) return k2Response;
      console.log('   ⚠️ K2 returned empty — falling back to OpenRouter');
    }

    // Fallback to OpenRouter
    return this.openRouterChat(message, language, history);
  }

  /**
   * Medication-specific chat — K2 with FDA context for thorough drug analysis
   */
  async medicationChat(
    message: string,
    fdaContext: string,
    language: string = 'en',
    history?: { role: 'user' | 'assistant'; content: string }[]
  ): Promise<string> {
    if (k2ThinkService.isConfigured()) {
      console.log('   🧠 K2 Think V2: medication deep analysis...');
      const k2Response = await k2ThinkService.analyzeMedication(message, fdaContext, language, history);
      if (k2Response) return k2Response;
    }
    // Fallback: inject FDA context into OpenRouter chat
    const enhancedMsg = fdaContext
      ? `${message}\n\nFDA DATA:\n${fdaContext}`
      : message;
    return this.openRouterChat(enhancedMsg, language, history);
  }

  /**
   * Symptom assessment — K2 for warm, thorough triage analysis
   */
  async assessSymptoms(
    triageContext: string,
    language: string = 'en',
    history?: { role: 'user' | 'assistant'; content: string }[]
  ): Promise<string> {
    if (k2ThinkService.isConfigured()) {
      console.log('   🧠 K2 Think V2: symptom assessment...');
      const k2Response = await k2ThinkService.assessSymptoms(triageContext, language, history);
      if (k2Response) return k2Response;
    }
    return this.openRouterChat(triageContext, language, history);
  }

  /**
   * Document explanation — K2 for thorough, warm medical document explanations
   */
  async explainDocument(
    documentText: string,
    documentType: string,
    language: string
  ): Promise<string> {
    if (k2ThinkService.isConfigured()) {
      console.log('   🧠 K2 Think V2: document explanation...');
      const k2Response = await k2ThinkService.explainDocument(documentText, documentType, language);
      if (k2Response) return k2Response;
    }
    // Fallback to OpenRouter
    const prompt = DISCHARGE_EXPLAIN_PROMPT + `\n\nDocument type: ${documentType}\nPatient language: ${this.getLanguageName(language)}\n\nDocument content:\n${documentText.substring(0, 3000)}`;
    return this.openRouterChat(prompt, language);
  }

  /**
   * Insurance explanation — K2 for making confusing paperwork understandable
   */
  async explainInsurance(
    message: string,
    language: string = 'en',
    history?: { role: 'user' | 'assistant'; content: string }[]
  ): Promise<string> {
    if (k2ThinkService.isConfigured()) {
      console.log('   🧠 K2 Think V2: insurance explanation...');
      const k2Response = await k2ThinkService.explainInsurance(message, language, history);
      if (k2Response) return k2Response;
    }
    return this.openRouterChat(message, language, history);
  }

  /**
   * Pill analysis — K2 for deep pill identification reasoning
   */
  async analyzePillDeep(
    visionData: string,
    fdaData: string,
    language: string = 'en'
  ): Promise<string> {
    if (k2ThinkService.isConfigured()) {
      console.log('   🧠 K2 Think V2: pill identification reasoning...');
      const k2Response = await k2ThinkService.analyzePill(visionData, fdaData, language);
      if (k2Response) return k2Response;
    }
    return '';
  }

  /**
   * Vision/Image analysis — Uses Hugging Face Inference Endpoint for Pill Identification
   */
  async analyzeImage(
    imageBase64: string,
    prompt: string
  ): Promise<string> {
    try {
      // 1. Upload base64 to FreeImage.host to get a public URL for HF endpoint
      const params = new URLSearchParams();
      params.append('source', imageBase64);
      params.append('key', process.env.FREEIMAGE_API_KEY || '');
      params.append('action', 'upload');
      params.append('format', 'json');
      
      const uploadRes = await axios.post('https://freeimage.host/api/1/upload', params);
      const imageUrl = uploadRes.data?.image?.url;
      
      if (!imageUrl) {
        throw new Error('Image proxy upload failed');
      }

      // 2. Pass public URL to HF Endpoint with clean one-line prompt
      const hfInput = `![](${imageUrl}) ${prompt.replace(/\n/g, ' ')}`;
      
      const response = await axios.post(
        'https://rz4jkue1a8x8i8nh.eu-west-1.aws.endpoints.huggingface.cloud',
        {
          inputs: hfInput,
          parameters: {
            top_k: -2,
            max_new_tokens: 198
          }
        },
        {
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${process.env.HF_TOKEN || ''}`,
            'Content-Type': 'application/json'
          },
          timeout: 45000
        }
      );
      
      const data = response.data;
      const content = Array.isArray(data) ? data[0]?.generated_text : data?.generated_text || '{}';
      return content;
    } catch (error: any) {
      console.error('[OpenRouter/HF Vision] error:', error.response?.status || error.message);
      return '{}';
    }
  }

  /**
   * Intent detection — stays on OpenRouter/Gemma (fast, cheap, reliable)
   */
  async detectIntent(message: string, language: string = 'en'): Promise<{
    intent: string;
    detectedLanguage: string;
    confidence: number;
  }> {
    // Rule-based first for instant critical stuff
    const ruleBased = this.ruleBasedIntent(message);
    if (ruleBased.confidence >= 0.8) return { ...ruleBased, detectedLanguage: this.detectLang(message) };

    if (!this.apiKey) return { ...ruleBased, detectedLanguage: this.detectLang(message) };

    const prompt = INTENT_PROMPT.replace('{message}', message.substring(0, 300));

    try {
      const response = await axios.post(
        `${OPENROUTER_BASE}/chat/completions`,
        {
          model: this.textModel,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 100
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'HealthBridge'
          },
          timeout: 15000
        }
      );

      const content = response.data?.choices?.[0]?.message?.content || '{}';
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          intent: parsed.intent || 'unclear',
          detectedLanguage: parsed.detectedLanguage || language,
          confidence: parsed.confidence || 0.5
        };
      }
    } catch (error: any) {
      console.error('[OpenRouter] Intent error:', error.response?.status || error.message);
    }

    return { ...ruleBased, detectedLanguage: this.detectLang(message) };
  }

  // ─── OpenRouter direct chat (fallback when K2 is unavailable) ──────────────
  private async openRouterChat(
    message: string,
    language: string = 'en',
    history?: { role: 'user' | 'assistant'; content: string }[]
  ): Promise<string> {
    if (!this.apiKey) return this.fallbackChat(message, language);

    const systemPrompt = SYSTEM_PROMPTS[language] || DEFAULT_SYSTEM_PROMPT;
    const langInstruction = language !== 'en'
      ? `\n\nIMPORTANT: Respond ENTIRELY in ${this.getLanguageName(language)}. Do not mix languages.`
      : '';

    const messages: any[] = [
      { role: 'system', content: systemPrompt + langInstruction },
      ...(history || []).slice(-12),
      { role: 'user', content: message }
    ];

    try {
      const response = await axios.post(
        `${OPENROUTER_BASE}/chat/completions`,
        { model: this.textModel, messages, max_tokens: 800 },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'HealthBridge'
          },
          timeout: 30000
        }
      );
      return response.data?.choices?.[0]?.message?.content || this.fallbackChat(message, language);
    } catch (error: any) {
      console.error('[OpenRouter] Chat error:', error.response?.status || error.message);
      return this.fallbackChat(message, language);
    }
  }

  // ─── Language detection (instant, free) ─────────────────────────────────────
  detectLang(text: string): string {
    const lower = text.toLowerCase();
    if (/[áéíóúñ¿¡]/.test(text) || ['hola', 'dolor', 'ayuda', 'medicamento', 'tengo'].some(w => lower.includes(w))) return 'es';
    if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
    if (/[\u0900-\u097F]/.test(text)) return 'hi';
    if (/[\u0600-\u06FF]/.test(text)) return 'ar';
    if (/[\u1100-\u11FF\uAC00-\uD7AF]/.test(text)) return 'ko';
    if (/[\u00C0-\u00FF]/.test(text) && lower.includes('não')) return 'pt';
    if (/[\u0980-\u09FF]/.test(text)) return 'bn';
    if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
    if (/[\u0C00-\u0C7F]/.test(text)) return 'te';
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'ja';
    if (/[\u0E00-\u0E7F]/.test(text)) return 'th';
    if (/[\u0400-\u04FF]/.test(text)) return 'ru';
    if (['xin', 'chào', 'đau', 'thuốc'].some(w => lower.includes(w))) return 'vi';
    if (['kumusta', 'sakit', 'tulong'].some(w => lower.includes(w))) return 'tl';
    return 'en';
  }

  private getLanguageName(code: string): string {
    const names: Record<string, string> = {
      en: 'English', es: 'Spanish', zh: 'Chinese (Mandarin)',
      hi: 'Hindi', ar: 'Arabic', vi: 'Vietnamese',
      ko: 'Korean', tl: 'Tagalog', pt: 'Portuguese',
      fr: 'French', bn: 'Bengali', ta: 'Tamil',
      te: 'Telugu', gu: 'Gujarati', ja: 'Japanese',
      ru: 'Russian', ne: 'Nepali', th: 'Thai',
    };
    return names[code] || 'English';
  }

  private ruleBasedIntent(message: string): { intent: string; confidence: number } {
    const lower = message.toLowerCase();

    // Emergency — highest priority
    const emergencyWords = ['chest pain', 'heart attack', "can't breathe", 'not breathing', 'unconscious', 'stroke', 'seizure', 'overdose', 'suicid',
                           'dolor de pecho', 'no puedo respirar', 'ataque al corazón', '胸痛', 'सीने में दर्द'];
    if (emergencyWords.some(w => lower.includes(w))) return { intent: 'emergency', confidence: 0.95 };

    // TAKEN acknowledgment
    if (['taken', 'tomado', '已服', 'लिया', 'تم', 'đã uống', '복용완료', 'ininom'].includes(lower.trim())) return { intent: 'taken', confidence: 0.95 };

    // ZIP code
    if (/^\d{5}$/.test(lower.trim())) return { intent: 'find_provider', confidence: 0.9 };

    // Symptom/triage keywords
    const triageWords = ['hurt', 'pain', 'ache', 'sick', 'fever', 'headache', 'nausea', 'cough', 'dizzy', 'rash', 'sore throat',
                        'stomach', 'vomit', 'diarrhea', 'anxiety', 'depressed', 'tired', 'weak',
                        'dolor', 'fiebre', 'tos', 'náusea', 'mareo', 'enfermo'];
    if (triageWords.some(w => lower.includes(w))) return { intent: 'triage', confidence: 0.8 };

    // Medication
    const medWords = ['medication', 'medicine', 'drug', 'prescription', 'pill', 'side effect', 'interaction', 'dose', 'refill',
                     'medicamento', 'medicina', 'pastilla', 'interacción', 'dosis', '药', 'दवा'];
    if (medWords.some(w => lower.includes(w))) return { intent: 'medication', confidence: 0.8 };

    // Provider
    const provWords = ['clinic', 'doctor', 'hospital', 'near me', 'find', 'nearby', 'free clinic',
                      'clínica', 'médico', 'hospital', 'cerca'];
    if (provWords.some(w => lower.includes(w))) return { intent: 'find_provider', confidence: 0.8 };

    // Safe access
    const safeWords = ['immigration', 'undocumented', 'deport', 'rights', 'afraid', 'scared', 'ice',
                      'migratorio', 'indocumentado', 'derechos', 'miedo'];
    if (safeWords.some(w => lower.includes(w))) return { intent: 'safe_access', confidence: 0.8 };

    // Insurance
    const insWords = ['insurance', 'deductible', 'copay', 'bill', 'cost', 'afford', 'eob',
                     'seguro', 'costo', 'factura'];
    if (insWords.some(w => lower.includes(w))) return { intent: 'insurance', confidence: 0.8 };

    // Greeting
    if (['hello', 'hi', 'hey', 'hola', '你好', 'नमस्ते', 'مرحبا', 'xin chào', '안녕', 'kumusta', 'olá', 'good morning', 'good afternoon', 'start'].some(g => lower.startsWith(g) || lower === g))
      return { intent: 'greeting', confidence: 0.85 };

    return { intent: 'unclear', confidence: 0 };
  }

  private fallbackChat(message: string, language: string): string {
    const fallbacks: Record<string, string> = {
      es: '🤖 Recibí tu mensaje. Soy HealthBridge — puedo ayudarte con preguntas de salud, medicamentos, encontrar clínicas gratuitas y más. ¿En qué puedo ayudarte?',
      zh: '🤖 我收到了你的消息。我是HealthBridge — 我可以帮助你解答健康问题、药物信息、寻找免费诊所等。有什么可以帮你的？',
      hi: '🤖 मैंने आपका संदेश प्राप्त किया। मैं HealthBridge हूं — मैं स्वास्थ्य प्रश्नों, दवाओं, मुफ्त क्लीनिक खोजने में मदद कर सकता हूं। मैं कैसे मदद कर सकता हूं?',
      ar: '🤖 تلقيت رسالتك. أنا HealthBridge — يمكنني مساعدتك في أسئلة الصحة والأدوية والعيادات المجانية. كيف يمكنني مساعدتك؟',
    };
    return fallbacks[language] || '🤖 I received your message. I\'m HealthBridge — I can help with health questions, medications, finding free clinics, and more. How can I help you?';
  }
}

export const openrouterService = new OpenRouterService();
