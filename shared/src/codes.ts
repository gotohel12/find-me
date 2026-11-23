/** Short, unambiguous codes for challenge links and friend codes. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1

export function makeCode(length = 6, rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < length; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}

export function isCode(s: string, length = 6): boolean {
  if (s.length !== length) return false;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/** Normalize user-typed codes: upper-case, drop spaces, dashes and other noise. */
export function normalizeCode(s: string): string {
  return s.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
