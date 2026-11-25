/** Rapier physics: static map colliders and a kinematic character controller. */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export type Rapier = typeof RAPIER;

let ready: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

export class Physics {
  readonly world: RAPIER.World;
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -14, z: 0 });
  }

  /** Static triangle-mesh colliders for every visible mesh of the map. */
  addStaticMeshes(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let n = 0;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry?.attributes.position) return;
      const g = m.geometry;
      const pos = g.attributes.position;
      const verts = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        verts[i * 3] = v.x;
        verts[i * 3 + 1] = v.y;
        verts[i * 3 + 2] = v.z;
      }
      let idx: Uint32Array;
      if (g.index) idx = new Uint32Array(g.index.array);
      else {
        idx = new Uint32Array(pos.count);
        for (let i = 0; i < pos.count; i++) idx[i] = i;
      }
      const desc = RAPIER.ColliderDesc.trimesh(verts, idx);
      this.world.createCollider(desc);
      n++;
    });
    return n;
  }

  step(dt: number) {
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step();
  }
}

export interface CharacterShape {
  radius: number;
  halfHeight: number;
}

/** Kinematic capsule driven by the player's input (walk, sprint, crouch, jump, gravity). */
export class CharacterBody {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
  velY = 0;
  grounded = false;

  constructor(private phys: Physics, readonly shape: CharacterShape, start: THREE.Vector3) {
    const w = phys.world;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y + shape.halfHeight + shape.radius, start.z),
    );
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius), this.body);
    this.controller = w.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(0.18, 0.12, true);
    this.controller.enableSnapToGround(0.15);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(false);
  }

  /** Move by a horizontal velocity (m/s) for dt seconds, with gravity and jumping. */
  move(vx: number, vz: number, jump: boolean, dt: number) {
    if (jump) this.velY = 4.8;
    this.velY -= 14 * dt;
    if (this.velY < -20) this.velY = -20;
    this.controller.computeColliderMovement(this.collider, { x: vx * dt, y: this.velY * dt, z: vz * dt });
    const m = this.controller.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.velY < 0) this.velY = 0;
  }

  /** Feet position (bottom of the capsule). */
  feet(out: THREE.Vector3) {
    const t = this.body.translation();
    return out.set(t.x, t.y - this.shape.halfHeight - this.shape.radius, t.z);
  }

  teleport(p: THREE.Vector3) {
    this.body.setTranslation({ x: p.x, y: p.y + this.shape.halfHeight + this.shape.radius, z: p.z }, true);
    this.velY = 0;
  }

  /** Make the body solid like a prop (lock-in) or a normal walker. */
  setSolid(solid: boolean) {
    this.collider.setSensor(false);
    void solid;
  }
}

const CAM_BALL = new RAPIER.Ball(0.14);
const ROT0 = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Sphere cast from the camera target backwards (radius 14 cm, like the near plane's corners):
 * the camera never sees through a wall, a shelf or a table edge.
 */
export function cameraClearance(phys: Physics, from: THREE.Vector3, dir: THREE.Vector3, maxDist: number, exclude?: RAPIER.Collider) {
  const hit = phys.world.castShape(
    { x: from.x, y: from.y, z: from.z }, ROT0, { x: dir.x, y: dir.y, z: dir.z }, CAM_BALL, 0, maxDist, true, undefined, undefined, exclude,
  ) as unknown as { time_of_impact?: number; timeOfImpact?: number } | null;
  if (!hit) return maxDist;
  const toi = hit.time_of_impact ?? hit.timeOfImpact ?? maxDist;
  return Math.max(0.2, toi - 0.02);
}

const AXES = [
  { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
];

/**
 * Is a point inside solid map geometry? Six rays: when most first-hits are back faces
 * (normal facing along the ray), the point is enclosed. Works on open photoscans too.
 */
export function pointInside(phys: Physics, p: THREE.Vector3, exclude?: RAPIER.Collider): boolean {
  let hits = 0;
  let back = 0;
  for (const d of AXES) {
    const h = phys.world.castRayAndGetNormal(new RAPIER.Ray({ x: p.x, y: p.y, z: p.z }, d), 3, false, undefined, undefined, exclude);
    if (!h) continue;
    hits++;
    if (h.normal.x * d.x + h.normal.y * d.y + h.normal.z * d.z > 0) back++;
  }
  return hits >= 4 && back * 2 > hits;
}

/**
 * Penetration of a set of body points into the map: the deepest one and a push vector
 * (depth-weighted average of "to the nearest surface" vectors) that would free them.
 */
export function penetration(phys: Physics, pts: THREE.Vector3[], exclude?: RAPIER.Collider) {
  let max = 0;
  let inside = 0;
  const push = new THREE.Vector3();
  let wsum = 0;
  for (const p of pts) {
    if (!pointInside(phys, p, exclude)) continue;
    const pr = phys.world.projectPoint({ x: p.x, y: p.y, z: p.z }, false, undefined, undefined, exclude);
    if (!pr) continue;
    const v = new THREE.Vector3(pr.point.x - p.x, pr.point.y - p.y, pr.point.z - p.z);
    const d = v.length();
    inside++;
    if (d > max) max = d;
    push.addScaledVector(v, d);
    wsum += d;
  }
  if (wsum > 0) push.multiplyScalar(1 / wsum).setLength(max);
  return { max, inside, push };
}
