// src/flows/emergency.ts
// Emergency check — runs BEFORE everything, no LLM, <50ms
import { checkEmergency, EMERGENCY_RESPONSES } from '../data/emergency_keywords.js';
import { Language } from '../types/index.js';

export { checkEmergency };

export function getEmergencyResponse(lang: Language): string {
  return EMERGENCY_RESPONSES[lang] || EMERGENCY_RESPONSES.en;
}
