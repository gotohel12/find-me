/** Procedural pattern stamps (16×16 or 32×32 greyscale masks: dark = tinted). */
export type PatternId = 'stripes' | 'dots' | 'checker' | 'grain' | 'bricks' | 'tiles' | 'noise' | 'leaves';
export const PATTERNS: PatternId[] = ['stripes', 'dots', 'checker', 'grain', 'bricks', 'tiles', 'noise', 'leaves'];

export interface Pattern {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function makePattern(id: PatternId, scale = 1, rotate90 = false): Pattern {
  const n = Math.max(4, Math.round(16 * scale));
  const data = new Uint8ClampedArray(n * n * 4);
  const r = rand(n * 31 + id.length);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const [px, py] = rotate90 ? [y, x] : [x, y];
      const fx = px / n;
      const fy = py / n;
      let dark = false;
      switch (id) {
        case 'stripes':
          dark = fx < 0.5;
          break;
        case 'dots':
          dark = Math.hypot(fx - 0.5, fy - 0.5) < 0.22;
          break;
        case 'checker':
          dark = fx < 0.5 !== fy < 0.5;
          break;
        case 'grain':
          dark = Math.sin((fx + Math.sin(fy * 6.28) * 0.08) * 6.28 * 3) > 0.35;
          break;
        case 'bricks': {
          const row = Math.floor(fy * 2);
          const bx = (fx + (row % 2) * 0.5) % 1;
          dark = !(fy % 0.5 < 0.06 || bx < 0.06);
          break;
        }
        case 'tiles':
          dark = !(fx < 0.07 || fy < 0.07);
          break;
        case 'noise':
          dark = r() < 0.45;
          break;
        case 'leaves': {
          const a = Math.hypot(fx - 0.3, fy - 0.35) < 0.25;
          const b = Math.hypot(fx - 0.75, fy - 0.75) < 0.2;
          dark = a || b;
          break;
        }
      }
      const i = (y * n + x) * 4;
      const v = dark ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: n, height: n, data };
}

/** A pattern from a scene patch (for the "sample patch" tool): full colour, used as-is. */
export function patchFrom(pixels: Uint8ClampedArray, sceneW: number, cx: number, cy: number, size = 24): Pattern {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.max(0, Math.floor(cx - size / 2 + x));
      const sy = Math.max(0, Math.floor(cy - size / 2 + y));
      const si = (sy * sceneW + sx) * 4;
      const i = (y * size + x) * 4;
      data[i] = pixels[si];
      data[i + 1] = pixels[si + 1];
      data[i + 2] = pixels[si + 2];
      data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}
