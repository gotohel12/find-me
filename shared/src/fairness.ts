/**
 * Fairness rules (spec §5.4). Checked live in the editor and re-checked
 * on the server before a hide is accepted.
 */
import { type Placement, type Sprite, rasterizeCoverage } from './geometry.ts';

export const FAIRNESS = {
  /** Visible character height must be ≥ this fraction of the scene's short side. */
  minHeightFrac: 0.045,
  /** At least this fraction of the silhouette must stay visible. */
  minVisibleFrac: 0.4,
  /** User size adjust around the depth-derived scale. */
  userScaleMin: 0.8,
  userScaleMax: 1.2,
  /** Rotation limit, radians (±45°). */
  maxRotation: Math.PI / 4,
  /** Silhouette pixels allowed outside the frame or in forbidden zones. */
  maxForbiddenFrac: 0.02,
  hideTimeLimitMs: 180_000,
} as const;

export interface SceneMasks {
  width: number;
  height: number;
  /** 1 where a foreground occluder sits in front of the given depth. */
  occludes: (x: number, y: number, characterDepth: number) => boolean;
  /** 1 where hiding is not allowed (sky, UI-safe areas). */
  forbidden: (x: number, y: number) => boolean;
}

export interface HideCandidate {
  placement: Placement;
  /** Scale the depth map gives at the anchor point. */
  depthScale: number;
  /** Scene depth at the anchor (0 near … 1 far). */
  depth: number;
  sprite: Sprite;
}

export type FairnessIssue =
  | 'too_small'
  | 'too_occluded'
  | 'scale_out_of_range'
  | 'rotation_out_of_range'
  | 'forbidden_zone'
  | 'off_screen';

export interface FairnessReport {
  ok: boolean;
  issues: FairnessIssue[];
  totalPx: number;
  visiblePx: number;
  visibleFrac: number;
  heightPx: number;
}

export function checkFairness(c: HideCandidate, scene: SceneMasks): FairnessReport {
  const issues: FairnessIssue[] = [];
  const p = c.placement;
  const adjust = p.scale / c.depthScale;
  if (adjust < FAIRNESS.userScaleMin - 1e-6 || adjust > FAIRNESS.userScaleMax + 1e-6) {
    issues.push('scale_out_of_range');
  }
  if (Math.abs(p.rotation) > FAIRNESS.maxRotation + 1e-6) issues.push('rotation_out_of_range');

  let total = 0;
  let visible = 0;
  let forbidden = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  let inFrame = 0;
  rasterizeCoverage(p, c.sprite, scene.width, scene.height, (x, y) => {
    inFrame++;
    if (scene.forbidden(x, y)) {
      forbidden++;
      return;
    }
    total++;
    if (!scene.occludes(x, y, c.depth)) {
      visible++;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  });
  const expected = countSilhouette(c);
  if (expected > 0 && inFrame < expected * (1 - FAIRNESS.maxForbiddenFrac)) issues.push('off_screen');
  if (inFrame > 0 && forbidden / inFrame > FAIRNESS.maxForbiddenFrac) issues.push('forbidden_zone');

  const visibleFrac = total > 0 ? visible / total : 0;
  if (visibleFrac < FAIRNESS.minVisibleFrac) issues.push('too_occluded');
  const heightPx = visible > 0 ? maxY - minY + 1 : 0;
  const unoccludedHeight = silhouetteHeight(c.sprite) * p.scale;
  if (unoccludedHeight < FAIRNESS.minHeightFrac * Math.min(scene.width, scene.height)) {
    issues.push('too_small');
  }
  return { ok: issues.length === 0, issues, totalPx: total, visiblePx: visible, visibleFrac, heightPx };
}

/** Height in sprite pixels of the covered rows. */
function silhouetteHeight(s: Sprite): number {
  const { width: w, height: h, data } = s.mask;
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < h && top < 0; y++) for (let x = 0; x < w; x++) if (data[y * w + x] > 0) { top = y; break; }
  for (let y = h - 1; y >= 0 && bottom < 0; y--) for (let x = 0; x < w; x++) if (data[y * w + x] > 0) { bottom = y; break; }
  return top < 0 ? 0 : bottom - top + 1;
}

/** Expected scene-pixel area of the silhouette (unclipped). */
function countSilhouette(c: HideCandidate): number {
  let n = 0;
  const d = c.sprite.mask.data;
  for (let i = 0; i < d.length; i++) if (d[i] > 0) n++;
  return n * c.placement.scale * c.placement.scale;
}

/** Clamp an editor placement into the legal ranges (used while dragging). */
export function clampPlacement(p: Placement, depthScale: number): Placement {
  const s = Math.min(Math.max(p.scale, depthScale * FAIRNESS.userScaleMin), depthScale * FAIRNESS.userScaleMax);
  const r = Math.min(Math.max(p.rotation, -FAIRNESS.maxRotation), FAIRNESS.maxRotation);
  return { ...p, scale: s, rotation: r };
}
