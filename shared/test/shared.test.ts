import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayKey,
  dayStartUtc,
  msUntilNextRelease,
  sceneForDay,
  addDays,
  formatCountdown,
  seekPoints,
  hiderScore,
  findRateFactor,
  hideStatus,
  emojiRow,
  levelFromXp,
  isHit,
  sceneToSprite,
  spriteToScene,
  checkFairness,
  clampPlacement,
  makeCode,
  isCode,
  normalizeCode,
  type Sprite,
  type Mask,
  type SceneMasks,
} from '../src/index.ts';

// ---------- schedule ----------
test('day rolls over at 00:00 Riyadh (21:00 UTC)', () => {
  assert.equal(dayKey(Date.parse('2026-11-23T20:59:59Z')), '2026-11-23');
  assert.equal(dayKey(Date.parse('2026-11-23T21:00:00Z')), '2026-11-24');
  assert.equal(dayStartUtc('2026-11-24'), Date.parse('2026-11-23T21:00:00Z'));
});

test('countdown to next release', () => {
  const at = Date.parse('2026-11-23T20:00:00Z');
  assert.equal(msUntilNextRelease(at), 60 * 60 * 1000);
  assert.equal(formatCountdown(msUntilNextRelease(at)), '01:00:00');
  assert.equal(formatCountdown(-5), '00:00:00');
});

test('year and leap boundaries', () => {
  assert.equal(addDays('2027-12-31', 1), '2028-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.throws(() => dayStartUtc('2027-02-30'));
});

test('rotation and overrides', () => {
  const s = { epoch: '2026-12-01', rotation: ['a', 'b', 'c'], overrides: { '2026-12-05': 'eid' } };
  assert.equal(sceneForDay(s, '2026-12-01'), 'a');
  assert.equal(sceneForDay(s, '2026-12-03'), 'c');
  assert.equal(sceneForDay(s, '2026-12-04'), 'a');
  assert.equal(sceneForDay(s, '2026-12-05'), 'eid');
  assert.equal(sceneForDay(s, '2026-11-30'), 'c'); // before epoch wraps safely
});

// ---------- scoring ----------
test('seek points: faster is more, clean bonus, hint cost', () => {
  const fast = seekPoints({ found: true, elapsedMs: 3000, wrongTaps: 0, hintUsed: false });
  const slow = seekPoints({ found: true, elapsedMs: 50000, wrongTaps: 0, hintUsed: false });
  const messy = seekPoints({ found: true, elapsedMs: 3000, wrongTaps: 2, hintUsed: false });
  const hinted = seekPoints({ found: true, elapsedMs: 3000, wrongTaps: 0, hintUsed: true });
  assert.ok(fast > slow && fast > messy && fast > hinted);
  assert.equal(seekPoints({ found: false, elapsedMs: 1000, wrongTaps: 0, hintUsed: false }), 0);
});

test('hider score peaks in the hard-but-findable band', () => {
  const score = (finds: number) => hiderScore({ attempts: 40, finds, avgFindMs: 30000 });
  const never = hiderScore({ attempts: 40, finds: 0, avgFindMs: 0 });
  const few = score(10); // 25 %
  const most = score(36); // 90 %
  assert.ok(few > never, 'found-by-a-few beats never-found');
  assert.ok(few > most, 'found-by-a-few beats found-by-everyone');
  assert.equal(findRateFactor(0.3), 1);
  assert.equal(hideStatus({ attempts: 9, finds: 3, avgFindMs: 1 }), 'pending');
  assert.equal(hideStatus({ attempts: 30, finds: 0, avgFindMs: 0 }), 'too_hard');
  assert.equal(hiderScore({ attempts: 5, finds: 1, avgFindMs: 1 }), 0);
});

test('emoji row', () => {
  assert.equal(
    emojiRow([
      { found: true, elapsedMs: 5000, wrongTaps: 0, hintUsed: false },
      { found: true, elapsedMs: 40000, wrongTaps: 0, hintUsed: false },
      { found: false, elapsedMs: 60000, wrongTaps: 3, hintUsed: false },
    ]),
    '🟩🟨🟥',
  );
});

test('levels are monotonic and capped at 100', () => {
  assert.equal(levelFromXp(0).level, 1);
  assert.equal(levelFromXp(100).level, 2);
  assert.equal(levelFromXp(1e12).level, 100);
});

// ---------- geometry / hit test ----------
function boxSprite(w: number, h: number): Sprite {
  const data = new Uint8Array(w * h).fill(255);
  return { mask: { width: w, height: h, data }, anchorX: w / 2, anchorY: h };
}

test('transform round-trips', () => {
  const s = boxSprite(20, 40);
  const p = { x: 300, y: 200, scale: 1.7, rotation: 0.4, flip: true };
  const [sx, sy] = spriteToScene(p, s, 3, 7);
  const [lx, ly] = sceneToSprite(p, s, sx, sy);
  assert.ok(Math.abs(lx - 3) < 1e-9 && Math.abs(ly - 7) < 1e-9);
});

test('hit test: inside hits, far misses, tolerance and occlusion', () => {
  const s = boxSprite(20, 40); // anchor at bottom centre
  const p = { x: 100, y: 100, scale: 1, rotation: 0, flip: false };
  const opt = { tolerancePx: 0 };
  assert.equal(isHit(p, s, 100, 80, opt), true);
  assert.equal(isHit(p, s, 140, 80, opt), false);
  assert.equal(isHit(p, s, 113, 80, opt), false);
  assert.equal(isHit(p, s, 113, 80, { tolerancePx: 5 }), true);
  // Top half hidden behind an occluder: tapping it is a miss.
  const occluded = (_x: number, y: number) => y < 80;
  assert.equal(isHit(p, s, 100, 70, { tolerancePx: 0, occluded }), false);
  assert.equal(isHit(p, s, 100, 90, { tolerancePx: 0, occluded }), true);
});

// ---------- fairness ----------
function scene(w: number, h: number, occluderAboveY = -Infinity, forbiddenAboveY = -1): SceneMasks {
  return {
    width: w,
    height: h,
    occludes: (_x, y) => y < occluderAboveY,
    forbidden: (_x, y) => y < forbiddenAboveY,
  };
}

test('fairness: a normal hide passes', () => {
  const s = boxSprite(30, 60);
  const r = checkFairness(
    { placement: { x: 500, y: 500, scale: 1, rotation: 0, flip: false }, depthScale: 1, depth: 0.5, sprite: s },
    scene(1000, 1000),
  );
  assert.deepEqual(r.issues, []);
  assert.equal(r.visibleFrac, 1);
});

test('fairness: rejects too occluded, too small, off-screen, forbidden, out-of-range', () => {
  const s = boxSprite(30, 60);
  const base = { x: 500, y: 500, scale: 1, rotation: 0, flip: false };
  const occl = checkFairness({ placement: base, depthScale: 1, depth: 0.5, sprite: s }, scene(1000, 1000, 480));
  assert.ok(occl.issues.includes('too_occluded'), 'half-plus hidden');
  const tiny = checkFairness(
    { placement: { ...base, scale: 0.5 }, depthScale: 0.5, depth: 0.9, sprite: s },
    scene(1000, 1000),
  );
  assert.ok(tiny.issues.includes('too_small'));
  const off = checkFairness(
    { placement: { ...base, x: 5 }, depthScale: 1, depth: 0.5, sprite: s },
    scene(1000, 1000),
  );
  assert.ok(off.issues.includes('off_screen'));
  const sky = checkFairness({ placement: base, depthScale: 1, depth: 0.5, sprite: s }, scene(1000, 1000, -Infinity, 460));
  assert.ok(sky.issues.includes('forbidden_zone'));
  const big = checkFairness(
    { placement: { ...base, scale: 1.5, rotation: 1 }, depthScale: 1, depth: 0.5, sprite: s },
    scene(1000, 1000),
  );
  assert.ok(big.issues.includes('scale_out_of_range') && big.issues.includes('rotation_out_of_range'));
});

test('clampPlacement keeps edits legal', () => {
  const c = clampPlacement({ x: 0, y: 0, scale: 5, rotation: -3, flip: false }, 1);
  assert.equal(c.scale, 1.2);
  assert.equal(c.rotation, -Math.PI / 4);
});

// ---------- codes ----------
test('codes', () => {
  const c = makeCode();
  assert.ok(isCode(c));
  assert.equal(isCode('AB1CDE'), false);
  assert.equal(normalizeCode(' ab-12 cd '), 'AB12CD');
});

// unused type import guard
const _m: Mask | undefined = undefined;
void _m;
