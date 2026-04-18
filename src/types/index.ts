// src/types/index.ts — Full HealthBridge type system

export type Language = 'en' | 'es' | 'zh' | 'hi' | 'ar' | 'vi' | 'ko' | 'tl' | 'pt';

export type CareLevel = 'er' | 'urgent_care' | 'primary_care' | 'telehealth' | 'self_care';

export type FlowType =
  | 'idle' | 'triage' | 'medication' | 'reminder_setup'
  | 'provider' | 'safe_access' | 'insurance' | 'discharge';

export interface Medication {
  rxcui: string;
  displayName: string;
  dose?: string;
  frequency?: string;
  withFood?: boolean;
  reminderTimes?: string[];
  addedAt: number;
}

export interface Session {
  hashedPhone: string;
  rawPhone: string;
  language: Language;
  currentFlow: FlowType;
  triageStep: number;
  triageData: Partial<TriageData>;
  medications: Medication[];
  hasSeenUploadTip: boolean;
  messageCount: number;
  lastActivity: number;
  conversationHistory: ConversationMessage[];
  caregiverPhone?: string;
}

export interface TriageData {
  symptoms: string[];
  durationDays: number;
  severity: 'mild' | 'moderate' | 'severe';
  hasFever: boolean;
  feverTemp?: number;
  recommendedCare: CareLevel;
}

export interface FQHCProvider {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  lat: number;
  lng: number;
  slidingFeeScale: boolean;
  distanceMiles?: number;
}

export interface DrugInteraction {
  drug1: string;
  drug2: string;
  severity: 'mild' | 'moderate' | 'severe';
  description: string;
  deathCount?: number;
}

export interface VisionResult {
  text: string;
  confidence: number;
  source: 'claude' | 'cloud_vision';
  structured?: {
    medications?: Array<{
      name: string;
      dose: string;
      frequency: string;
      withFood?: boolean;
      duration?: string;
      purpose?: string;
    }>;
    documentType?: 'prescription' | 'discharge' | 'eob' | 'lab_result' | 'other';
    followUpDate?: string;
    prescriber?: string;
    warnings?: string[];
    instructions?: string[];
  };
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface OCRResult {
  text: string;
  drugs: string[];
  confidence: number;
}

export interface IntentResult {
  intent: string;
  detectedLanguage: string;
  confidence: number;
}
