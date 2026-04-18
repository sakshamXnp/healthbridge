export interface OCRResult {
  text: string;
  drugs: string[];
  confidence: number;
}

export interface IntentResult {
  intent: string;
  confidence: number;
  entities?: Record<string, string>;
}

export interface DrugInteraction {
  severity: 'none' | 'mild' | 'moderate' | 'severe' | 'critical';
  description: string;
  recommendation?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface UserSession {
  language: 'en' | 'es';
  history: ConversationMessage[];
  lastActive: number;
}
