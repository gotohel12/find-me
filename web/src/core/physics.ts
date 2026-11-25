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
    if (this.grounded && jump) this.velY = 4.8;
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

/** Ray from the camera target backwards: shortest free distance (keeps the camera out of walls). */
export function cameraClearance(phys: Physics, from: THREE.Vector3, dir: THREE.Vector3, maxDist: number, exclude?: RAPIER.Collider) {
  const ray = new RAPIER.Ray({ x: from.x, y: from.y, z: from.z }, { x: dir.x, y: dir.y, z: dir.z });
  const hit = phys.world.castRay(ray, maxDist, true, undefined, undefined, exclude);
  return hit ? Math.max(0.25, hit.timeOfImpact - 0.12) : maxDist;
}
