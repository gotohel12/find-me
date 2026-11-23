import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaintTexture, PAINT_SIZE, UNDO_LIMIT, shadePixel, hexToRgb, rgbToHex, hsvToRgb, pushRecent } from '../src/paint.ts';

test('brush paints the centre and stays inside its body part', () => {
  const p = new PaintTexture();
  // body rect u 0.5..1, v 0.5..1. Paint right at its left edge.
  p.stamp(0.505, 0.75, 20, [255, 0, 0], 1, 0);
  const [x, y] = PaintTexture.texel(0.505, 0.75);
  assert.deepEqual(p.get(x, y), [255, 0, 0]);
  // the head (left of u=0.5) must stay white
  assert.deepEqual(p.get(x - 5, y), [235, 235, 235]);
});

test('soft brush fades toward the edge', () => {
  const p = new PaintTexture();
  p.stamp(0.25, 0.75, 20, [0, 0, 0], 1, 1);
  const [x, y] = PaintTexture.texel(0.25, 0.75);
  assert.ok(p.get(x, y)[0] < 20);
  assert.ok(p.get(x + 15, y)[0] > p.get(x + 5, y)[0]);
});

test('bucket fills exactly one part (both arms)', () => {
  const p = new PaintTexture();
  p.fillPart(3, [0, 200, 0]);
  const [la] = [PaintTexture.texel(0.1, 0.4)];
  const ra = PaintTexture.texel(0.4, 0.4);
  const head = PaintTexture.texel(0.25, 0.75);
  assert.deepEqual(p.get(...la), [0, 200, 0]);
  assert.deepEqual(p.get(...ra), [0, 200, 0]);
  assert.deepEqual(p.get(...head), [235, 235, 235]);
});

test('undo/redo, capped at 30 steps', () => {
  const p = new PaintTexture();
  const t = PaintTexture.texel(0.75, 0.75);
  p.checkpoint();
  p.fillPart(2, [10, 20, 30]);
  assert.ok(p.undo());
  assert.deepEqual(p.get(...t), [235, 235, 235]);
  assert.ok(p.redo());
  assert.deepEqual(p.get(...t), [10, 20, 30]);
  for (let i = 0; i < 40; i++) { p.checkpoint(); p.fillPart(2, [i, i, i]); }
  let n = 0;
  while (p.undo()) n++;
  assert.equal(n, UNDO_LIMIT);
});

test('eraser restores the base white', () => {
  const p = new PaintTexture();
  p.fillPart(1, [0, 0, 0]);
  p.stamp(0.25, 0.75, 6, [0, 0, 0], 1, 0, true);
  assert.deepEqual(p.get(...PaintTexture.texel(0.25, 0.75)), [235, 235, 235]);
});

test('pattern stamp tints only dark pattern pixels', () => {
  const p = new PaintTexture();
  const pat = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) };
  p.stampPattern(5, pat, [255, 0, 0]);
  const y = PAINT_SIZE - 10;
  const xs = [p.get(0, y), p.get(1, y)];
  assert.deepEqual(xs.map((c) => c[1]).sort((a, b) => a - b), [0, 235]);
});

test('lighting: facing the light is brighter than facing away; AO darkens', () => {
  const light = { dirCam: [0, 0, 1] as [number, number, number], color: [1, 1, 1] as [number, number, number], strength: 3, ambient: [0.6, 0.6, 0.6] as [number, number, number] };
  const lit = shadePixel([200, 200, 200], [0, 0, 1], 1, light);
  const away = shadePixel([200, 200, 200], [0, 0, -1], 1, light);
  const occl = shadePixel([200, 200, 200], [0, 0, 1], 0, light);
  assert.ok(lit[0] > away[0] && lit[0] > occl[0]);
});

test('colour helpers', () => {
  assert.deepEqual(hexToRgb('#ff8000'), [255, 128, 0]);
  assert.equal(rgbToHex([255, 128, 0]), '#ff8000');
  assert.deepEqual(hsvToRgb(0, 1, 1), [255, 0, 0]);
  assert.deepEqual(pushRecent(['#aaaaaa', '#BBBBBB'.toLowerCase()], '#AAAAAA'), ['#aaaaaa', '#bbbbbb']);
});
