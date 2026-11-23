/**
 * Hide placement geometry and the server-side hit test.
 *
 * Coordinates: scene pixels of the beauty render for the chosen
 * orientation. A pose sprite is a mask W×H whose anchor (feet / contact
 * point) sits at `anchor`. The placed sprite is scaled, rotated about the
 * anchor and optionally flipped horizontally.
 */

export interface Mask {
  width: number;
  height: number;
  /** 0 = empty, >0 = covered. Row-major. */
  data: Uint8Array;
}

export interface Placement {
  x: number;
  y: number;
  /** Final scale (depth scale × user adjust). */
  scale: number;
  /** Radians, clockwise. */
  rotation: number;
  flip: boolean;
}

export interface Sprite {
  mask: Mask;
  anchorX: number;
  anchorY: number;
}

export function maskAt(m: Mask, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= m.width || yi >= m.height) return 0;
  return m.data[yi * m.width + xi];
}

/** Scene point → sprite-local point (inverse of the placement transform). */
export function sceneToSprite(p: Placement, s: Sprite, sx: number, sy: number): [number, number] {
  const dx = sx - p.x;
  const dy = sy - p.y;
  const c = Math.cos(-p.rotation);
  const n = Math.sin(-p.rotation);
  let lx = (dx * c - dy * n) / p.scale;
  const ly = (dx * n + dy * c) / p.scale;
  if (p.flip) lx = -lx;
  return [lx + s.anchorX, ly + s.anchorY];
}

/** Sprite-local point → scene point. */
export function spriteToScene(p: Placement, s: Sprite, lx: number, ly: number): [number, number] {
  let dx = (lx - s.anchorX) * p.scale;
  const dy = (ly - s.anchorY) * p.scale;
  if (p.flip) dx = -dx;
  const c = Math.cos(p.rotation);
  const n = Math.sin(p.rotation);
  return [p.x + dx * c - dy * n, p.y + dx * n + dy * c];
}

/** Axis-aligned scene-space bounds of the placed sprite. */
export function placedBounds(p: Placement, s: Sprite): { x0: number; y0: number; x1: number; y1: number } {
  const w = s.mask.width;
  const h = s.mask.height;
  const pts = [
    spriteToScene(p, s, 0, 0),
    spriteToScene(p, s, w, 0),
    spriteToScene(p, s, 0, h),
    spriteToScene(p, s, w, h),
  ];
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Rasterize which scene pixels the placed character covers (before occlusion). */
export function rasterizeCoverage(
  p: Placement,
  s: Sprite,
  sceneW: number,
  sceneH: number,
  cb: (x: number, y: number) => void,
): void {
  const b = placedBounds(p, s);
  const x0 = Math.max(0, Math.floor(b.x0));
  const y0 = Math.max(0, Math.floor(b.y0));
  const x1 = Math.min(sceneW - 1, Math.ceil(b.x1));
  const y1 = Math.min(sceneH - 1, Math.ceil(b.y1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const [lx, ly] = sceneToSprite(p, s, x + 0.5, y + 0.5);
      if (maskAt(s.mask, lx, ly) > 0) cb(x, y);
    }
  }
}

export interface HitOptions {
  /** Extra forgiveness, in scene pixels, around the visible silhouette. */
  tolerancePx: number;
  /** Optional occluder test: true when the scene pixel hides the character. */
  occluded?: (x: number, y: number) => boolean;
}

/**
 * Did a tap at (tx, ty) find the character? A tap counts when a *visible*
 * silhouette pixel lies within the tolerance radius.
 */
export function isHit(p: Placement, s: Sprite, tx: number, ty: number, o: HitOptions): boolean {
  const r = Math.max(0, o.tolerancePx);
  const step = Math.max(1, r / 6);
  for (let dy = -r; dy <= r; dy += step) {
    for (let dx = -r; dx <= r; dx += step) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = tx + dx;
      const y = ty + dy;
      const [lx, ly] = sceneToSprite(p, s, x, y);
      if (maskAt(s.mask, lx, ly) === 0) continue;
      if (o.occluded && o.occluded(Math.floor(x), Math.floor(y))) continue;
      return true;
    }
  }
  return false;
}

/** Tap tolerance scales with on-screen character size, clamped. */
export function tapTolerance(characterHeightPx: number): number {
  return Math.min(Math.max(characterHeightPx * 0.12, 6), 28);
}
