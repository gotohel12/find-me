/** Loads packed scene + character assets (see tools/scene_pack.py for the formats). */
import type { Mask } from '@findme/shared';

export interface SceneMeta {
  sceneId: string;
  title: { en: string; ar: string };
  width: number;
  height: number;
  focalPx: number;
  characterHeightM: number;
  keyLight: { dirCam: [number, number, number]; color: [number, number, number]; strength: number };
  ambient: [number, number, number];
  images: { webp: { file: string }; avif?: { file: string } };
  data: { file: string; scale: number; near: number; far: number };
}

export interface SceneData {
  meta: SceneMeta;
  base: string;
  image: HTMLImageElement;
  /** Full-res RGBA of the beauty render, for the eyedropper and patch sampling. */
  pixels: Uint8ClampedArray;
  /** Half-res depth in metres and forbidden mask. */
  dw: number;
  dh: number;
  depth: Float32Array;
  forbidden: Uint8Array;
}

export interface SpriteData {
  pose: string;
  angle: string;
  size: number;
  /** R,G = paint UV (v up), B = part id × 40, A = coverage. */
  uvp: Uint8ClampedArray;
  /** RGB = camera-space normal, A = ambient occlusion. */
  nao: Uint8ClampedArray;
  anchor: [number, number];
  ppm: number;
  mask: Mask;
  thumb: string;
}

export interface Manifest {
  scenes: Record<string, Record<string, { title: { en: string; ar: string } }>>;
  character: { poses: string[]; angles: string[]; sprites: Record<string, { anchor: [number, number]; ppm: number }> } | null;
}

const ASSETS = '/assets';
let manifestP: Promise<Manifest> | null = null;

export function manifest(): Promise<Manifest> {
  manifestP ??= fetch(`${ASSETS}/manifest.json`).then((r) => {
    if (!r.ok) throw new Error('assets missing');
    return r.json() as Promise<Manifest>;
  });
  return manifestP;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error(`image failed: ${src}`));
    im.src = src;
  });
}

function pixelsOf(im: HTMLImageElement, w = im.naturalWidth, h = im.naturalHeight): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = w !== im.naturalWidth;
  g.drawImage(im, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

export async function loadScene(sceneId: string, orient: 'landscape' | 'portrait'): Promise<SceneData> {
  const base = `${ASSETS}/scenes/${sceneId}/${orient}/`;
  const meta = (await (await fetch(`${base}meta.json`)).json()) as SceneMeta;
  const [image, data] = await Promise.all([loadImage(base + meta.images.webp.file), loadImage(base + meta.data.file)]);
  const pixels = pixelsOf(image, meta.width, meta.height);
  const d = pixelsOf(data);
  const dw = data.naturalWidth;
  const dh = data.naturalHeight;
  const depth = new Float32Array(dw * dh);
  const forbidden = new Uint8Array(dw * dh);
  const { near, far } = meta.data;
  for (let i = 0; i < dw * dh; i++) {
    const q = (d[i * 4] << 8) | d[i * 4 + 1];
    depth[i] = near + (q / 65535) * (far - near);
    forbidden[i] = d[i * 4 + 2] > 127 ? 1 : 0;
  }
  return { meta, base, image, pixels, dw, dh, depth, forbidden };
}

const spriteCache = new Map<string, Promise<SpriteData>>();

export function loadSprite(pose: string, angle: string): Promise<SpriteData> {
  const key = `${pose}/${angle}`;
  let p = spriteCache.get(key);
  if (!p) {
    p = (async () => {
      const base = `${ASSETS}/character/${key}/`;
      const meta = (await (await fetch(`${base}meta.json`)).json()) as {
        size: number;
        anchor: [number, number];
        pixelsPerMetre: number;
      };
      const [a, b] = await Promise.all([loadImage(base + 'uvp.png'), loadImage(base + 'nao.png')]);
      const uvp = pixelsOf(a);
      const nao = pixelsOf(b);
      const n = meta.size * meta.size;
      const m = new Uint8Array(n);
      for (let i = 0; i < n; i++) m[i] = uvp[i * 4 + 3] > 127 ? 255 : 0;
      return {
        pose,
        angle,
        size: meta.size,
        uvp,
        nao,
        anchor: meta.anchor,
        ppm: meta.pixelsPerMetre,
        mask: { width: meta.size, height: meta.size, data: m },
        thumb: base + 'shade.webp',
      };
    })();
    spriteCache.set(key, p);
  }
  return p;
}

/** Scene depth (m) at a scene pixel. */
export function depthAt(s: SceneData, x: number, y: number): number {
  const k = s.meta.data.scale;
  const xi = Math.min(s.dw - 1, Math.max(0, Math.floor(x * k)));
  const yi = Math.min(s.dh - 1, Math.max(0, Math.floor(y * k)));
  return s.depth[yi * s.dw + xi];
}

export function forbiddenAt(s: SceneData, x: number, y: number): boolean {
  const k = s.meta.data.scale;
  const xi = Math.floor(x * k);
  const yi = Math.floor(y * k);
  if (xi < 0 || yi < 0 || xi >= s.dw || yi >= s.dh) return true;
  return s.forbidden[yi * s.dw + xi] === 1;
}

/** Scale that makes the sprite real-size at depth d. */
export function depthScale(s: SceneData, sp: SpriteData, d: number): number {
  return s.meta.focalPx / Math.max(d, 0.05) / sp.ppm;
}

export function samplePixel(s: SceneData, x: number, y: number): [number, number, number] {
  const xi = Math.min(s.meta.width - 1, Math.max(0, Math.floor(x)));
  const yi = Math.min(s.meta.height - 1, Math.max(0, Math.floor(y)));
  const i = (yi * s.meta.width + xi) * 4;
  return [s.pixels[i], s.pixels[i + 1], s.pixels[i + 2]];
}
