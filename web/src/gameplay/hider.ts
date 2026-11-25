/** The player's hider: model, animation blending, poses, lock-in. */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/** How big the hider is in the world (the model is ~0.49 m; the game plays at ~1 m). */
export const HIDER_SCALE = 2.0;

export const POSES = [
  'stand', 't_pose', 'arms_up', 'sit', 'ball', 'lie_face_down', 'lie_back', 'wall_flat', 'hug_knees', 'kneel',
  'crouch_tiny', 'plank_stiff', 'lean', 'stretched', 'upside_down', 'be_a_lamp', 'be_a_vase',
] as const;
export type PoseName = (typeof POSES)[number];

type Loco = 'idle' | 'walk' | 'run' | 'jump' | 'paint_idle';

export class Hider {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly mesh: THREE.SkinnedMesh;
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  pose: PoseName | null = null;
  locked = false;
  facing = 0; // yaw radians
  height = 1;

  constructor(gltf: GLTF) {
    this.model = cloneSkinned(gltf.scene);
    this.model.scale.setScalar(HIDER_SCALE);
    let mesh: THREE.SkinnedMesh | null = null;
    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        mesh = m;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
      }
    });
    if (!mesh) throw new Error('hider.glb has no skinned mesh');
    this.mesh = mesh;
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      if (clip.name === 'jump' || clip.name === 'found' || clip.name.startsWith('pose_')) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions.set(clip.name, a);
    }
    const box = new THREE.Box3().setFromObject(this.model);
    this.height = box.max.y - box.min.y || 0.98;
    this.play('idle', 0);
  }

  has(name: string) {
    return this.actions.has(name);
  }

  private play(name: string, fade = 0.25) {
    const next = this.actions.get(name);
    if (!next || next === this.current) return;
    next.reset();
    next.setEffectiveWeight(1);
    next.enabled = true;
    if (this.current) next.crossFadeFrom(this.current, fade, false);
    next.play();
    this.current = next;
  }

  /** Locomotion animation from horizontal speed (m/s), unless a pose is held. */
  locomotion(speed: number, grounded: boolean, painting: boolean) {
    if (this.pose) return;
    let want: Loco = 'idle';
    if (painting) want = 'paint_idle';
    else if (!grounded) want = 'jump';
    else if (speed > 3.0) want = 'run';
    else if (speed > 0.2) want = 'walk';
    if (want === 'walk' || want === 'run') {
      const a = this.actions.get(want);
      if (a) a.timeScale = want === 'walk' ? speed / 1.6 : speed / 3.8;
    }
    this.play(want, want === 'jump' ? 0.1 : 0.2);
  }

  setPose(p: PoseName | null) {
    this.pose = p;
    if (p) this.play(`pose_${p}`, 0.25);
    else {
      this.locked = false;
      this.play('idle', 0.25);
    }
  }

  update(dt: number) {
    this.mixer.update(dt);
    // smooth turn toward facing
    const cur = this.root.rotation.y;
    let d = this.facing - cur;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y = cur + d * Math.min(1, dt * 12);
  }
}
