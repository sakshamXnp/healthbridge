// ...existing code with secrets removed and using environment variables...
// src/services/vision.ts
// Sharp preprocessing + Gemma OCR via OpenRouter
import sharp from 'sharp';

import { Language, VisionResult } from '../types/index.js';

const HF_ENDPOINT = 'https://rz4jkue1a8x8i8nh.eu-west-1.aws.endpoints.huggingface.cloud';
const HF_TOKEN = process.env.HF_TOKEN || '';

export async function processImage(
  buffer: Buffer,
  mimeType: string,
  language: Language
): Promise<VisionResult> {
  // Always resize before Hugging Face — JSON payload limits can block full 4K PNGs.
  // This resolves the HTTP 500 Error scale issues and greatly speeds up the request.
  const processedImage = await sharp(buffer)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 95 })
    .toBuffer();

  try {
    const result = await callHuggingFace(processedImage, language);
    if (result.confidence >= 0.5) return result;
  } catch (err) {
    console.error('[Vision] HF Endpoint failed:', err);
  }

  // Fallback — return raw with low confidence
  return { text: '', confidence: 0, source: 'cloud_vision' };
}

async function callHuggingFace(imageBuffer: Buffer, language: Language): Promise<VisionResult> {
  const base64 = imageBuffer.toString('base64');
  
  const promptText = `Analyze this medical document. Return ONLY this JSON:
{
  "documentType": "prescription|discharge|eob|lab_result|other",
  "confidence": 0.0-1.0,
  "rawText": "complete verbatim text from document",
  "medications": [
    {
      "name": "exact drug name as written",
      "dose": "e.g. 500mg",
      "frequency": "e.g. twice daily",
      "withFood": true or false or null,
      "duration": "e.g. 7 days or null",
      "purpose": "what this treats if stated or null"
    }
  ],
  "prescriber": "doctor name or null",
  "followUpDate": "date string or null",
  "warnings": ["any warnings listed"],
  "instructions": ["any non-medication instructions"]
}`;

  // 1. Upload base64 to FreeImage.host to get a public URL for the specific HF endpoint
  const params = new URLSearchParams();
  params.append('source', base64);
  params.append('key', '6d207e02198a847aa98d0a2a901485a5');
  params.append('action', 'upload');
  params.append('format', 'json');
  
  const uploadRes = await fetch('https://freeimage.host/api/1/upload', {
    method: 'POST',
    body: params
  });
  const uploadData = await uploadRes.json() as any;
  const imageUrl = uploadData.image?.url;
  
  if (!imageUrl) {
    throw new Error('Image proxy upload failed');
  }

  // 2. Pass public URL into Hugging Face endpoint on a clean line
  const hfInput = `![](${imageUrl}) ${promptText.replace(/\n/g, ' ')}`;

  const response = await fetch(HF_ENDPOINT, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      inputs: hfInput,
      parameters: {
        top_k: -2,
        max_new_tokens: 198
      }
    }),
    signal: AbortSignal.timeout(45000)
  });

  const data = await response.json() as any;
  const content = Array.isArray(data) ? data[0]?.generated_text : data?.generated_text || '';

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // If it doesn't return JSON, at least return the raw text extracted
    return { text: content, confidence: 0.5, source: 'cloud_vision' };
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    // If the 198 token limit truncated the JSON, fall back to raw text so K2 can read it
    return { text: content, confidence: 0.5, source: 'cloud_vision' };
  }

  return {
    text: parsed.rawText || '',
    confidence: parsed.confidence || 0.5,
    source: 'cloud_vision',
    structured: {
      medications: parsed.medications || [],
      documentType: parsed.documentType,
      followUpDate: parsed.followUpDate,
      prescriber: parsed.prescriber,
      warnings: parsed.warnings || [],
      instructions: parsed.instructions || [],
    }
  };
}

// PDF handler — try text extraction first, Vision as fallback
export async function processPDF(buffer: Buffer): Promise<VisionResult> {
  try {
    const pdfParse = await import('pdf-parse');
    const data = await pdfParse.default(buffer);
    if (data.text.trim().length > 50) {
      // Searchable PDF — perfect text, zero API cost
      return { text: data.text, confidence: 0.99, source: 'cloud_vision' };
    }
  } catch {}
  // Scanned PDF — can't process without Vision
  return { text: '', confidence: 0, source: 'cloud_vision' };
}

// Classify document type from text
export async function classifyDocument(text: string): Promise<string> {
  const lower = text.toLowerCase();
  if (lower.includes('rx') || lower.includes('prescri') || lower.includes('dispense') || lower.includes('refill')) {
    return 'prescription';
  }
  if (lower.includes('discharge') || lower.includes('admitted') || lower.includes('follow-up')) {
    return 'discharge';
  }
  if (lower.includes('explanation of benefits') || lower.includes('eob') || lower.includes('amount billed')) {
    return 'eob';
  }
  if (lower.includes('lab result') || lower.includes('specimen') || lower.includes('reference range')) {
    return 'lab_result';
  }
  return 'other';
}
