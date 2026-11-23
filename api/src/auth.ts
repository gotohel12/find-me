/** Guest device tokens: random 32 bytes, stored only as a SHA-256 hash. */
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { makeCode } from '@findme/shared';

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  const t = h.slice(7).trim();
  return /^[A-Za-z0-9_-]{43}$/.test(t) ? t : null;
}

/** Friendly random guest names, Arabic and English. */
const ADJ_EN = ['Quiet', 'Sneaky', 'Tiny', 'Clever', 'Swift', 'Silent', 'Painted', 'Hidden', 'Lucky', 'Calm'];
const NOUN_EN = ['Ghost', 'Fox', 'Owl', 'Gecko', 'Cat', 'Moth', 'Shadow', 'Pebble', 'Lantern', 'Brush'];
const NOUN_AR = ['شبح', 'ثعلب', 'بومة', 'وزغ', 'قطو', 'فراشة', 'ظل', 'حصاة', 'فانوس', 'فرشاة'];
const ADJ_AR = ['هادئ', 'خفي', 'صغير', 'ذكي', 'سريع', 'صامت', 'ملون', 'مختبئ', 'محظوظ', 'رايق'];

export function guestName(locale: string, rand: () => number = Math.random): string {
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const n = Math.floor(rand() * 900 + 100);
  return locale.startsWith('ar') ? `${pick(NOUN_AR)} ${pick(ADJ_AR)} ${n}` : `${pick(ADJ_EN)}${pick(NOUN_EN)}${n}`;
}

export { makeCode };
