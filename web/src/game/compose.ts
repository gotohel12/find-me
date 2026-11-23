/**
 * Draws the painted, scene-lit character into a small canvas, with automatic
 * occlusion behind nearer scene objects. Same maths the server uses for seek images.
 */
import { type Placement, PaintTexture, PAINT_SIZE, placedBounds, sceneToSprite, shadePixel, type Light } from '@findme/shared';
import { type SceneData, type SpriteData, depthAt } from './load.ts';

/** Metres a scene surface must be in front of the character to hide it. */
export const OCCLUSION_MARGIN = 0.08;

export interface Layer {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
}

export function sceneLight(s: SceneData): Light {
  return {
    dirCam: s.meta.keyLight.dirCam,
    color: s.meta.keyLight.color,
    strength: s.meta.keyLight.strength,
    ambient: s.meta.ambient,
  };
}

/** Character depth (m): the scene depth under its feet. */
export function characterDepth(s: SceneData, p: Placement): number {
  return depthAt(s, p.x, p.y - 2);
}

export function isOccluded(s: SceneData, x: number, y: number, charDepth: number): boolean {
  return depthAt(s, x, y) < charDepth - OCCLUSION_MARGIN;
}

export function composeCharacter(
  s: SceneData,
  sp: SpriteData,
  p: Placement,
  paint: PaintTexture,
  opts: { occlusion?: boolean; highlightPart?: number } = {},
  reuse?: HTMLCanvasElement,
): Layer {
  const b = placedBounds(p, { mask: sp.mask, anchorX: sp.anchor[0], anchorY: sp.anchor[1] });
  const x0 = Math.floor(b.x0);
  const y0 = Math.floor(b.y0);
  const w = Math.max(1, Math.ceil(b.x1) - x0);
  const h = Math.max(1, Math.ceil(b.y1) - y0);
  const c = reuse ?? document.createElement('canvas');
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const out = img.data;
  const light = sceneLight(s);
  const cd = characterDepth(s, p);
  const sprite = { mask: sp.mask, anchorX: sp.anchor[0], anchorY: sp.anchor[1] };
  const N = sp.size;
  const pd = paint.data;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const sx = x0 + xx + 0.5;
      const sy = y0 + yy + 0.5;
      const [lx, ly] = sceneToSprite(p, sprite, sx, sy);
      const ix = Math.floor(lx);
      const iy = Math.floor(ly);
      if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
      const si = (iy * N + ix) * 4;
      const cov = sp.uvp[si + 3];
      if (cov === 0) continue;
      if (opts.occlusion !== false && isOccluded(s, sx, sy, cd)) continue;
      const u = sp.uvp[si] / 255;
      const v = sp.uvp[si + 1] / 255;
      const tx = Math.min(PAINT_SIZE - 1, Math.floor(u * PAINT_SIZE));
      const ty = Math.min(PAINT_SIZE - 1, Math.floor((1 - v) * PAINT_SIZE));
      const ti = (ty * PAINT_SIZE + tx) * 4;
      let nx = sp.nao[si] / 127.5 - 1;
      const ny = sp.nao[si + 1] / 127.5 - 1;
      const nz = sp.nao[si + 2] / 127.5 - 1;
      if (p.flip) nx = -nx;
      const ao = sp.nao[si + 3] / 255;
      const rgb = shadePixel([pd[ti], pd[ti + 1], pd[ti + 2]], [nx, ny, nz], ao, light);
      const oi = (yy * w + xx) * 4;
      out[oi] = rgb[0];
      out[oi + 1] = rgb[1];
      out[oi + 2] = rgb[2];
      out[oi + 3] = cov;
      if (opts.highlightPart && Math.round(sp.uvp[si + 2] / 40) === opts.highlightPart) {
        out[oi] = Math.min(255, out[oi] + 40);
        out[oi + 2] = Math.min(255, out[oi + 2] + 60);
      }
    }
  }
  g.putImageData(img, 0, 0);
  return { canvas: c, x: x0, y: y0 };
}

/** Very faint contact shadow (always on: fair clue, physically plausible). */
export function drawContactShadow(g: CanvasRenderingContext2D, sp: SpriteData, p: Placement): void {
  const r = sp.size * 0.16 * p.scale;
  const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
  grad.addColorStop(0, 'rgba(0,0,0,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.save();
  g.translate(p.x, p.y);
  g.scale(1, 0.32);
  g.translate(-p.x, -p.y);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(p.x, p.y, r, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Which sprite pixel (part id, uv) is under a scene point, or null. */
export function pickOnCharacter(
  sp: SpriteData,
  p: Placement,
  x: number,
  y: number,
): { part: number; u: number; v: number } | null {
  const [lx, ly] = sceneToSprite(p, { mask: sp.mask, anchorX: sp.anchor[0], anchorY: sp.anchor[1] }, x, y);
  const ix = Math.floor(lx);
  const iy = Math.floor(ly);
  if (ix < 0 || iy < 0 || ix >= sp.size || iy >= sp.size) return null;
  const i = (iy * sp.size + ix) * 4;
  if (sp.uvp[i + 3] < 128) return null;
  return { part: Math.round(sp.uvp[i + 2] / 40), u: (sp.uvp[i] + 0.5) / 256, v: (sp.uvp[i + 1] + 0.5) / 256 };
}
