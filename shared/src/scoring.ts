/** Scoring rules shared by client (display) and server (authority). */

export const SEEK_TIME_LIMIT_MS = 60_000;
export const WRONG_TAP_PENALTY_MS = 5_000;
export const MAX_WRONG_TAPS = 3;
export const HINT_COST = 150;
export const HIDER_MIN_ATTEMPTS = 10;
export const TOO_HARD_ATTEMPTS = 30;

export interface SeekResult {
  found: boolean;
  /** Time from start to the finding tap, wrong-tap penalties included. */
  elapsedMs: number;
  wrongTaps: number;
  hintUsed: boolean;
}

/**
 * Points for one hide. Faster = more: 1000 at 0 s falling linearly to 200
 * at the time limit. +200 for a clean find, minus the hint cost.
 */
export function seekPoints(r: SeekResult): number {
  if (!r.found) return 0;
  const t = Math.min(Math.max(r.elapsedMs, 0), SEEK_TIME_LIMIT_MS) / SEEK_TIME_LIMIT_MS;
  let pts = Math.round(1000 - 800 * t);
  if (r.wrongTaps === 0) pts += 200;
  if (r.hintUsed) pts -= HINT_COST;
  return Math.max(pts, 50);
}

/** Streak multiplier: +5% per consecutive day, capped at +50%. */
export function streakMultiplier(streakDays: number): number {
  return 1 + Math.min(Math.max(streakDays, 0), 10) * 0.05;
}

export function seekSessionScore(results: SeekResult[], streakDays: number): number {
  const base = results.reduce((s, r) => s + seekPoints(r), 0);
  return Math.round(base * streakMultiplier(streakDays));
}

/** Wordle-style row: 🟩 found < 20 s, 🟨 found later, 🟥 not found. */
export function emojiRow(results: SeekResult[]): string {
  return results.map((r) => (!r.found ? '🟥' : r.elapsedMs < 20_000 ? '🟩' : '🟨')).join('');
}

export interface HideStats {
  attempts: number;
  finds: number;
  /** Mean time-to-find over successful finds, ms. */
  avgFindMs: number;
}

/**
 * How well a find rate matches "hard but findable". 1.0 across 15–50 %,
 * tapering to 0.35 at 0 % and to 0.1 at 100 %.
 */
export function findRateFactor(rate: number): number {
  const r = Math.min(Math.max(rate, 0), 1);
  if (r >= 0.15 && r <= 0.5) return 1;
  if (r < 0.15) return 0.35 + (0.65 * r) / 0.15;
  return 1 - (0.9 * (r - 0.5)) / 0.5;
}

export type HideStatus = 'pending' | 'scored' | 'too_hard';

export function hideStatus(s: HideStats): HideStatus {
  if (s.attempts < HIDER_MIN_ATTEMPTS) return 'pending';
  if (s.finds === 0 && s.attempts >= TOO_HARD_ATTEMPTS) return 'too_hard';
  return 'scored';
}

/**
 * Hider score: up to 1000 from the find rate, plus up to 300 for slow
 * finds. A hide nobody finds scores below one a few people find.
 */
export function hiderScore(s: HideStats): number {
  const status = hideStatus(s);
  if (status === 'pending') return 0;
  const rate = s.finds / s.attempts;
  if (status === 'too_hard') return Math.round(1000 * findRateFactor(0) * 0.6);
  const slowness = s.finds > 0 ? Math.min(s.avgFindMs / SEEK_TIME_LIMIT_MS, 1) : 0;
  return Math.round(1000 * findRateFactor(rate) + 300 * slowness * findRateFactor(rate));
}

/** XP needed to go from level n to n+1 (levels 1–100). */
export function xpForLevel(n: number): number {
  return Math.round(100 + 40 * Math.pow(Math.max(n, 1) - 1, 1.35));
}

export function levelFromXp(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp));
  while (level < 100 && rest >= xpForLevel(level)) {
    rest -= xpForLevel(level);
    level++;
  }
  return { level, into: rest, need: level < 100 ? xpForLevel(level) : 0 };
}
