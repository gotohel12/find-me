/**
 * Server-side game logic: loads packed assets from disk, composites the seek
 * image (scene + painted, lit, occluded character) so the hide position is
 * never sent to seekers, validates taps and fairness, and builds seed hides.
 * Mirrors web/src/game/compose.ts exactly.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  PAINT_SIZE,
  type Placement,
  PaintTexture,
  type PartId,
  checkFairness,
  depthScaleFor,
  isHit,
  placedBounds,
  sceneToSprite,
  shadePixel,
  tapTolerance,
  type FairnessReport,
  type Mask,
} from '@findme/shared';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ASSETS = resolve(REPO, process.env.ASSETS_DIR ?? 'web/public/assets');
export const OCCLUSION_MARGIN = 0.08;

export interface Scene {
  id: string;
  orient: string;
  w: number;
  h: number;
  focalPx: number;
  light: { dirCam: [number, number, number]; color: [number, number, number]; strength: number; ambient: [number, number, number] };
  rgb: Buffer; // w*h*3
  dw: number;
  dh: number;
  dscale: number;
  depth: Float32Array;
  forbidden: Uint8Array;
}

export interface Sprite {
  pose: string;
  angle: string;
  size: number;
  uvp: Buffer; // RGBA
  nao: Buffer; // RGBA
  anchor: [number, number];
  ppm: number;
  mask: Mask;
  heightPx: number;
}

const sceneCache = new Map<string, Promise<Scene>>();
const spriteCache = new Map<string, Promise<Sprite>>();

async function rawRGBA(path: string): Promise<{ data: Buffer; w: number; h: number }> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

export function loadScene(id: string, orient: string): Promise<Scene> {
  if (!/^s\d{3}_[a-z0-9_]+$/.test(id) || !['landscape', 'portrait'].includes(orient)) {
    return Promise.reject(new Error('bad scene'));
  }
  const key = `${id}/${orient}`;
  let p = sceneCache.get(key);
  if (!p) {
    p = (async () => {
      const base = join(ASSETS, 'scenes', id, orient);
      const meta = JSON.parse(await readFile(join(base, 'meta.json'), 'utf8'));
      const { data: rgb } = await sharp(join(base, meta.images.webp.file))
        .resize(meta.width, meta.height)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const d = await rawRGBA(join(base, meta.data.file));
      const n = d.w * d.h;
      const depth = new Float32Array(n);
      const forbidden = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const q = (d.data[i * 4] << 8) | d.data[i * 4 + 1];
        depth[i] = meta.data.near + (q / 65535) * (meta.data.far - meta.data.near);
        forbidden[i] = d.data[i * 4 + 2] > 127 ? 1 : 0;
      }
      return {
        id,
        orient,
        w: meta.width,
        h: meta.height,
        focalPx: meta.focalPx,
        light: { ...meta.keyLight, ambient: meta.ambient },
        rgb,
        dw: d.w,
        dh: d.h,
        dscale: meta.data.scale,
        depth,
        forbidden,
      };
    })();
    sceneCache.set(key, p);
    p.catch(() => sceneCache.delete(key));
  }
  return p;
}

export function loadSprite(pose: string, angle: string): Promise<Sprite> {
  if (!/^[a-z_]+$/.test(pose) || !/^[a-z_]+$/.test(angle)) return Promise.reject(new Error('bad sprite'));
  const key = `${pose}/${angle}`;
  let p = spriteCache.get(key);
  if (!p) {
    p = (async () => {
      const base = join(ASSETS, 'character', pose, angle);
      const meta = JSON.parse(await readFile(join(base, 'meta.json'), 'utf8'));
      const uvp = await rawRGBA(join(base, 'uvp.png'));
      const nao = await rawRGBA(join(base, 'nao.png'));
      const size = uvp.w;
      const m = new Uint8Array(size * size);
      let top = size;
      let bottom = 0;
      for (let i = 0; i < size * size; i++) {
        if (uvp.data[i * 4 + 3] > 127) {
          m[i] = 255;
          const y = Math.floor(i / size);
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
      return {
        pose,
        angle,
        size,
        uvp: uvp.data,
        nao: nao.data,
        anchor: meta.anchor,
        ppm: meta.pixelsPerMetre,
        mask: { width: size, height: size, data: m },
        heightPx: Math.max(1, bottom - top),
      };
    })();
    spriteCache.set(key, p);
    p.catch(() => spriteCache.delete(key));
  }
  return p;
}

export function depthAt(s: Scene, x: number, y: number): number {
  const xi = Math.min(s.dw - 1, Math.max(0, Math.floor(x * s.dscale)));
  const yi = Math.min(s.dh - 1, Math.max(0, Math.floor(y * s.dscale)));
  return s.depth[yi * s.dw + xi];
}
export function forbiddenAt(s: Scene, x: number, y: number): boolean {
  const xi = Math.floor(x * s.dscale);
  const yi = Math.floor(y * s.dscale);
  if (xi < 0 || yi < 0 || xi >= s.dw || yi >= s.dh) return true;
  return s.forbidden[yi * s.dw + xi] === 1;
}
export const characterDepth = (s: Scene, p: Placement) => depthAt(s, p.x, p.y - 2);
export const isOccluded = (s: Scene, x: number, y: number, cd: number) => depthAt(s, x, y) < cd - OCCLUSION_MARGIN;
const spriteRef = (sp: Sprite) => ({ mask: sp.mask, anchorX: sp.anchor[0], anchorY: sp.anchor[1] });

export function depthScale(s: Scene, sp: Sprite, p: Placement): number {
  return depthScaleFor(s.focalPx, characterDepth(s, p), sp.ppm);
}

export function fairness(s: Scene, sp: Sprite, p: Placement): FairnessReport {
  const d = characterDepth(s, p);
  return checkFairness(
    { placement: p, depthScale: depthScaleFor(s.focalPx, d, sp.ppm), depth: d, sprite: spriteRef(sp) },
    { width: s.w, height: s.h, occludes: (x, y, cd) => isOccluded(s, x, y, cd), forbidden: (x, y) => forbiddenAt(s, x, y) },
  );
}

export function tapHits(s: Scene, sp: Sprite, p: Placement, x: number, y: number): boolean {
  const cd = characterDepth(s, p);
  return isHit(p, spriteRef(sp), x, y, {
    tolerancePx: tapTolerance(sp.heightPx * p.scale),
    occluded: (px, py) => isOccluded(s, px, py, cd),
  });
}

/** Centre of the visible character (for reveals and hints). */
export function revealPoint(sp: Sprite, p: Placement): { x: number; y: number; r: number } {
  const h = sp.heightPx * p.scale;
  return { x: p.x, y: p.y - h / 2, r: h * 0.75 };
}

/** Composite scene + character into a WebP. Paint is a 256² RGBA texture. */
export async function composite(s: Scene, sp: Sprite, p: Placement, paint: Uint8ClampedArray | Buffer): Promise<Buffer> {
  const out = Buffer.from(s.rgb);
  const b = placedBounds(p, spriteRef(sp));
  const x0 = Math.max(0, Math.floor(b.x0));
  const y0 = Math.max(0, Math.floor(b.y0));
  const x1 = Math.min(s.w - 1, Math.ceil(b.x1));
  const y1 = Math.min(s.h - 1, Math.ceil(b.y1));
  // faint contact shadow (fair clue, physically plausible)
  const r = sp.size * 0.16 * p.scale;
  for (let y = Math.floor(p.y - r * 0.35); y <= Math.ceil(p.y + r * 0.35); y++) {
    for (let x = Math.floor(p.x - r); x <= Math.ceil(p.x + r); x++) {
      if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
      const d = Math.hypot((x - p.x) / r, (y - p.y) / (r * 0.32));
      if (d >= 1) continue;
      const k = 1 - 0.22 * (1 - d);
      const i = (y * s.w + x) * 3;
      out[i] *= k;
      out[i + 1] *= k;
      out[i + 2] *= k;
    }
  }
  const cd = characterDepth(s, p);
  const N = sp.size;
  const light = { dirCam: s.light.dirCam, color: s.light.color, strength: s.light.strength, ambient: s.light.ambient };
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const [lx, ly] = sceneToSprite(p, spriteRef(sp), x + 0.5, y + 0.5);
      const ix = Math.floor(lx);
      const iy = Math.floor(ly);
      if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
      const si = (iy * N + ix) * 4;
      const cov = sp.uvp[si + 3];
      if (cov === 0 || isOccluded(s, x + 0.5, y + 0.5, cd)) continue;
      const tx = Math.min(PAINT_SIZE - 1, Math.floor((sp.uvp[si] / 255) * PAINT_SIZE));
      const ty = Math.min(PAINT_SIZE - 1, Math.floor((1 - sp.uvp[si + 1] / 255) * PAINT_SIZE));
      const ti = (ty * PAINT_SIZE + tx) * 4;
      let nx = sp.nao[si] / 127.5 - 1;
      if (p.flip) nx = -nx;
      const rgb = shadePixel([paint[ti], paint[ti + 1], paint[ti + 2]], [nx, sp.nao[si + 1] / 127.5 - 1, sp.nao[si + 2] / 127.5 - 1], sp.nao[si + 3] / 255, light);
      const a = cov / 255;
      const oi = (y * s.w + x) * 3;
      out[oi] = out[oi] * (1 - a) + rgb[0] * a;
      out[oi + 1] = out[oi + 1] * (1 - a) + rgb[1] * a;
      out[oi + 2] = out[oi + 2] * (1 - a) + rgb[2] * a;
    }
  }
  return sharp(out, { raw: { width: s.w, height: s.h, channels: 3 } }).webp({ quality: 84 }).toBuffer();
}

/** Decode a client-submitted paint texture (PNG, 256×256) to RGBA. */
export async function decodePaint(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== PAINT_SIZE || info.height !== PAINT_SIZE) throw new Error('paint must be 256x256');
  return data;
}

export async function encodePaint(rgba: Uint8ClampedArray | Buffer): Promise<Buffer> {
  return sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
    raw: { width: PAINT_SIZE, height: PAINT_SIZE, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ------------------------------------------------------------------ Auto-Hider
const SEED_POSES = ['stand', 'sit', 'ball', 'lying', 'wall', 'peek', 'hug_knees', 'kneel', 'vase', 'arms_up', 'stretch', 'upside_down'];
const SEED_ANGLES = ['front', 'q_left', 'side', 'q_right', 'back'];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Auto-Hider: finds a fair spot, picks a pose, and paints each body part with the
 * scene colours behind it (plus light mottling), like a careful human would with the
 * eyedropper and bucket. Returns null if no fair spot is found.
 */
export async function autoHide(s: Scene, seed: number): Promise<{ sprite: Sprite; placement: Placement; paint: PaintTexture } | null> {
  const r = rng(seed);
  for (let attempt = 0; attempt < 60; attempt++) {
    const sp = await loadSprite(SEED_POSES[Math.floor(r() * SEED_POSES.length)], SEED_ANGLES[Math.floor(r() * SEED_ANGLES.length)]);
    const x = s.w * (0.08 + r() * 0.84);
    const y = s.h * (0.35 + r() * 0.6);
    if (forbiddenAt(s, x, y)) continue;
    const base: Placement = { x, y, scale: 1, rotation: (r() - 0.5) * 0.3, flip: r() < 0.5 };
    const ds = depthScale(s, sp, base);
    const p = { ...base, scale: ds * (0.85 + r() * 0.3) };
    const f = fairness(s, sp, p);
    if (!f.ok) continue;
    const paint = new PaintTexture();
    // average scene colour behind each part
    const sums = new Map<number, [number, number, number, number]>();
    const b = placedBounds(p, spriteRef(sp));
    for (let yy = Math.max(0, Math.floor(b.y0)); yy <= Math.min(s.h - 1, Math.ceil(b.y1)); yy += 2) {
      for (let xx = Math.max(0, Math.floor(b.x0)); xx <= Math.min(s.w - 1, Math.ceil(b.x1)); xx += 2) {
        const [lx, ly] = sceneToSprite(p, spriteRef(sp), xx, yy);
        const ix = Math.floor(lx);
        const iy = Math.floor(ly);
        if (ix < 0 || iy < 0 || ix >= sp.size || iy >= sp.size) continue;
        const si = (iy * sp.size + ix) * 4;
        if (sp.uvp[si + 3] < 128) continue;
        const part = Math.round(sp.uvp[si + 2] / 40);
        const ci = (yy * s.w + xx) * 3;
        const acc = sums.get(part) ?? [0, 0, 0, 0];
        acc[0] += s.rgb[ci];
        acc[1] += s.rgb[ci + 1];
        acc[2] += s.rgb[ci + 2];
        acc[3]++;
        sums.set(part, acc);
      }
    }
    for (const [part, [cr, cg, cb, n]] of sums) {
      if (part < 1 || part > 5 || !n) continue;
      // counter the shading the renderer will add (lit pixels come out darker than albedo)
      const lift = 1.25;
      paint.fillPart(part as PartId, [Math.min(255, (cr / n) * lift), Math.min(255, (cg / n) * lift), Math.min(255, (cb / n) * lift)]);
    }
    // mottling so it doesn't look flat
    for (let k = 0; k < 160; k++) {
      const u = r();
      const v = r();
      const t = PaintTexture.texel(u, v);
      const c = paint.get(t[0], t[1]);
      const j = 0.85 + r() * 0.3;
      paint.stamp(u, v, 3 + r() * 6, [c[0] * j, c[1] * j, c[2] * j], 0.5, 0.8);
    }
    return { sprite: sp, placement: p, paint };
  }
  return null;
}
