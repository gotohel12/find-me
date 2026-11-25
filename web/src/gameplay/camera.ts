/** Third-person orbit camera that never clips through walls. */
import * as THREE from 'three';
import { type Physics, cameraClearance } from '../core/physics.ts';
import type RAPIER from '@dimforge/rapier3d-compat';

export class OrbitFollow {
  yaw = 0; // camera on the +Z side (the entrance), looking into the room
  pitch = 0.25;
  distance = 2.6;
  smoothing = false;
  minDist = 0.8;
  maxDist = 5;
  private target = new THREE.Vector3();
  private smooth = new THREE.Vector3();

  constructor(private cam: THREE.PerspectiveCamera, private phys: Physics, private exclude?: RAPIER.Collider) {}

  look(dx: number, dy: number) {
    this.yaw -= dx;
    this.pitch = Math.max(-0.6, Math.min(1.2, this.pitch + dy));
  }

  zoom(steps: number) {
    this.distance = Math.max(this.minDist, Math.min(this.maxDist, this.distance * (1 + steps * 0.12)));
  }

  /** Forward/right unit vectors on the ground plane, for movement relative to the view. */
  basis() {
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    return { forward: f, right: r };
  }

  /**
   * Turn toward the most open direction around the focus (nearest to the current yaw that
   * has at least `want` metres free): entering paint mode never jams the lens into furniture.
   */
  findOpenView(focus: THREE.Vector3, want: number) {
    let best = this.yaw;
    let bestScore = -Infinity;
    for (let k = 0; k < 24; k++) {
      const yaw = this.yaw + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI) / 12;
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(yaw) * Math.cos(this.pitch));
      const free = cameraClearance(this.phys, focus, dir, want + 0.5, this.exclude);
      const score = Math.min(free, want) * 10 - Math.abs(Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw)));
      if (score > bestScore) {
        bestScore = score;
        best = yaw;
      }
    }
    this.yaw = best;
  }

  update(focus: THREE.Vector3, dt: number, shoulder = 0.35) {
    this.target.copy(focus);
    if (this.smooth.lengthSq() === 0) this.smooth.copy(focus);
    // follow tightly (no lag/jitter); optional extra smoothing from settings
    this.smooth.lerp(this.target, this.smoothing ? 1 - Math.exp(-10 * dt) : 1 - Math.exp(-30 * dt));
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(shoulder);
    const pivot = this.smooth.clone().add(side);
    const d = cameraClearance(this.phys, pivot, dir, this.distance, this.exclude);
    this.cam.position.copy(pivot).addScaledVector(dir, d);
    this.cam.lookAt(pivot);
  }
}
