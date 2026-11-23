/**
 * Paint engine core (CPU reference). The web editor runs the same maths in
 * WebGL shaders; the server uses this file to composite seek images, so what
 * the hider paints is exactly what seekers see.
 *
 * The paint texture is 256×256 RGBA. Each body part owns fixed rectangles of
 * it (must match ATLAS in blender/character/hider.py).
 */
export const PAINT_SIZE = 256;
export const UNDO_LIMIT = 30;

export type PartId = 1 | 2 | 3 | 4 | 5; // head, body, arms, legs, antenna
export const PART_NAMES: Record<PartId, string> = { 1: 'head', 2: 'body', 3: 'arms', 4: 'legs', 5: 'antenna' };

/** UV rects [u0, v0, u1, v1] per part (v up, like Blender). */
export const ATLAS: Record<PartId, [number, number, number, number][]> = {
  1: [[0.0, 0.5, 0.5, 1.0]],
  2: [[0.5, 0.5, 1.0, 1.0]],
  3: [[0.0, 0.25, 0.25, 0.5], [0.25, 0.25, 0.5, 0.5]],
  4: [[0.5, 0.25, 0.75, 0.5], [0.75, 0.25, 1.0, 0.5]],
  5: [[0.0, 0.0, 0.25, 0.25]],
};

export type RGB = [number, number, number];

export class PaintTexture {
  readonly data: Uint8ClampedArray;
  private undoStack: Uint8ClampedArray[] = [];
  private redoStack: Uint8ClampedArray[] = [];

  constructor(data?: Uint8ClampedArray) {
    this.data = data ?? new Uint8ClampedArray(PAINT_SIZE * PAINT_SIZE * 4).fill(235);
    if (!data) for (let i = 3; i < this.data.length; i += 4) this.data[i] = 255;
  }

  /** Call once at the start of every user action (stroke, fill, stamp). */
  checkpoint(): void {
    this.undoStack.push(this.data.slice());
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }
  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.data.slice());
    this.data.set(prev);
    return true;
  }
  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.data.slice());
    this.data.set(next);
    return true;
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  reset(): void {
    this.checkpoint();
    this.data.set(new PaintTexture().data);
  }

  /** Texel index for UV (v up). */
  static texel(u: number, v: number): [number, number] {
    const x = Math.min(PAINT_SIZE - 1, Math.max(0, Math.floor(u * PAINT_SIZE)));
    const y = Math.min(PAINT_SIZE - 1, Math.max(0, Math.floor((1 - v) * PAINT_SIZE)));
    return [x, y];
  }

  get(x: number, y: number): RGB {
    const i = (y * PAINT_SIZE + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }

  /**
   * Soft round brush in texture space, clipped to the part rect under the
   * centre so paint never bleeds onto a neighbouring body part.
   * softness 0 = hard edge, 1 = fully feathered. erase paints the base white.
   */
  stamp(u: number, v: number, radiusPx: number, color: RGB, opacity = 1, softness = 0.5, erase = false): void {
    const [cx, cy] = PaintTexture.texel(u, v);
    const clip = rectAt(u, v);
    if (!clip) return;
    const [x0c, y0c, x1c, y1c] = clip;
    const r = Math.max(0.5, radiusPx);
    const c = erase ? ([235, 235, 235] as RGB) : color;
    for (let y = Math.max(y0c, Math.floor(cy - r)); y <= Math.min(y1c, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(x0c, Math.floor(cx - r)); x <= Math.min(x1c, Math.ceil(cx + r)); x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d > 1) continue;
        const hard = 1 - softness;
        const fall = d <= hard ? 1 : 1 - (d - hard) / Math.max(1e-6, softness);
        const a = opacity * fall;
        const i = (y * PAINT_SIZE + x) * 4;
        for (let k = 0; k < 3; k++) this.data[i + k] = this.data[i + k] + (c[k] - this.data[i + k]) * a;
      }
    }
  }

  /** Bucket fill a whole body part. */
  fillPart(part: PartId, color: RGB): void {
    for (const [x0, y0, x1, y1] of partRectsPx(part)) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = (y * PAINT_SIZE + x) * 4;
          this.data[i] = color[0];
          this.data[i + 1] = color[1];
          this.data[i + 2] = color[2];
        }
      }
    }
  }

  /** Tile a pattern (w×h RGBA, white = keep, black = full tint) over a part, tinted. */
  stampPattern(part: PartId, pattern: { width: number; height: number; data: Uint8ClampedArray }, tint: RGB, opacity = 1): void {
    for (const [x0, y0, x1, y1] of partRectsPx(part)) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const pi = ((y % pattern.height) * pattern.width + (x % pattern.width)) * 4;
          const a = (1 - pattern.data[pi] / 255) * opacity;
          const i = (y * PAINT_SIZE + x) * 4;
          for (let k = 0; k < 3; k++) this.data[i + k] = this.data[i + k] + (tint[k] - this.data[i + k]) * a;
        }
      }
    }
  }

  /** Smudge: drag colour from (u0,v0) toward (u1,v1). */
  smudge(u0: number, v0: number, u1: number, v1: number, radiusPx: number, strength = 0.5): void {
    const [x0, y0] = PaintTexture.texel(u0, v0);
    this.stamp(u1, v1, radiusPx, this.get(x0, y0), strength, 0.8);
  }
}

function partRectsPx(part: PartId): [number, number, number, number][] {
  return ATLAS[part].map(([u0, v0, u1, v1]) => [
    Math.round(u0 * PAINT_SIZE),
    Math.round((1 - v1) * PAINT_SIZE),
    Math.round(u1 * PAINT_SIZE) - 1,
    Math.round((1 - v0) * PAINT_SIZE) - 1,
  ]);
}

/** The pixel rect (inclusive) of the atlas cell containing (u, v). */
function rectAt(u: number, v: number): [number, number, number, number] | null {
  for (const p of [1, 2, 3, 4, 5] as PartId[]) {
    const rects = ATLAS[p];
    for (let k = 0; k < rects.length; k++) {
      const [u0, v0, u1, v1] = rects[k];
      if (u >= u0 && u < u1 && v >= v0 && v < v1) return partRectsPx(p)[k];
    }
  }
  return null;
}

// ---------------------------------------------------------------- lighting
export interface Light {
  /** Unit vector toward the key light, camera space (x right, y up, z to viewer). */
  dirCam: [number, number, number];
  color: RGB; // 0..1
  strength: number;
  ambient: RGB; // 0..1
}

/**
 * Shade one sprite pixel: albedo from the paint texture × (ambient + key·N) × AO.
 * Normalised so a white figure facing the light ≈ its painted colour.
 */
export function shadePixel(albedo: RGB, normal: [number, number, number], ao: number, light: Light): RGB {
  const ndl = Math.max(0, normal[0] * light.dirCam[0] + normal[1] * light.dirCam[1] + normal[2] * light.dirCam[2]);
  const k = Math.min(light.strength / 3, 1.2);
  const out: RGB = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const lit = (light.ambient[c] * 0.75 + light.color[c] * ndl * 0.55 * k) * (0.55 + 0.45 * ao);
    out[c] = Math.max(0, Math.min(255, Math.round(albedo[c] * Math.min(lit, 1.15))));
  }
  return out;
}

// ---------------------------------------------------------------- colour helpers
export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`bad hex ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}
export function hsvToRgb(h: number, s: number, v: number): RGB {
  const i = Math.floor(((h % 1) + 1) % 1 * 6);
  const f = ((h % 1) + 1) % 1 * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** Recent colours list: newest first, unique, max 12. */
export function pushRecent(list: string[], hex: string, max = 12): string[] {
  const h = hex.toLowerCase();
  return [h, ...list.filter((x) => x !== h)].slice(0, max);
}
