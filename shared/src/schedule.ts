/**
 * Daily scene schedule. A "game day" starts at 00:00 Asia/Riyadh.
 * Riyadh is UTC+3 all year (no daylight saving), so a fixed offset is exact.
 */
export const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Game-day key, e.g. "2026-11-24", for the given instant. */
export function dayKey(at: Date | number = Date.now()): string {
  const t = typeof at === 'number' ? at : at.getTime();
  return new Date(t + RIYADH_OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC instant (ms) when the given game day starts. */
export function dayStartUtc(key: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error(`bad day key: ${key}`);
  const ms = Date.parse(`${key}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== key) {
    throw new Error(`bad day key: ${key}`);
  }
  return ms - RIYADH_OFFSET_MS;
}

/** Milliseconds until the next scene release. */
export function msUntilNextRelease(at: number = Date.now()): number {
  const next = dayStartUtc(dayKey(at)) + DAY_MS;
  return next - at;
}

export function addDays(key: string, n: number): string {
  return dayKey(dayStartUtc(key) + n * DAY_MS);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((dayStartUtc(b) - dayStartUtc(a)) / DAY_MS);
}

export interface Schedule {
  /** First game day of the rotation. */
  epoch: string;
  /** Scene ids in rotation order. */
  rotation: string[];
  /** Explicit overrides: day key → scene id (events, swaps). */
  overrides?: Record<string, string>;
}

/** Scene id for a game day: an override if present, else the rotation. */
export function sceneForDay(schedule: Schedule, key: string): string {
  const o = schedule.overrides?.[key];
  if (o) return o;
  if (schedule.rotation.length === 0) throw new Error('empty rotation');
  const n = daysBetween(schedule.epoch, key);
  const len = schedule.rotation.length;
  return schedule.rotation[((n % len) + len) % len];
}

/** Format a countdown as HH:MM:SS. */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
