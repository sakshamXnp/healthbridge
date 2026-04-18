// src/services/security.ts
// HMAC hashing, rate limiting, input sanitization
import { createHmac } from 'crypto';

const HMAC_SECRET = process.env.HMAC_SECRET || 'healthbridge-default-secret-change-in-production';

// 1. HMAC phone hashing — never store raw phone numbers
export function hashPhone(phone: string): string {
  return createHmac('sha256', HMAC_SECRET).update(phone).digest('hex');
}

// 2. Rate limiting — 30 messages per 10 minutes per hashed phone
const rateLimits = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(phone: string): boolean {
  const hashed = hashPhone(phone);
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes
  const maxMessages = 30;

  let entry = rateLimits.get(hashed);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    rateLimits.set(hashed, entry);
  }

  entry.count++;
  return entry.count <= maxMessages;
}

// 3. Input sanitization — strip HTML, limit length
export function sanitize(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')    // Strip HTML tags
    .substring(0, 2000)          // Max 2000 chars
    .trim();
}

// Cleanup expired rate limit entries every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits.entries()) {
    if (now > entry.resetAt) {
      rateLimits.delete(key);
    }
  }
}, 15 * 60 * 1000);
