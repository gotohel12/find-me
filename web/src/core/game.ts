/**
 * FIND ME 3D — practice game: walk around the map, paint your own body, pose,
 * lock in, and get a Camouflage Score from three seeker viewpoints.
 */
import * as THREE from 'three';
import { Engine, QUALITY, type Quality } from '../render/engine.ts';
import { Input, type Action } from '../input/input.ts';
import { penetration, initPhysics, Physics, CharacterBody } from './physics.ts';
import { Hider, HIDER_SCALE, POSES, type PoseName } from '../gameplay/hider.ts';
import { OrbitFollow } from '../gameplay/camera.ts';
import { PaintSystem, hitToBind, type BrushSettings, type Tool } from '../gameplay/paint.ts';
import { sfx } from '../sfx.ts';
import { settings } from './settings.ts';
import { mergeStatic } from '../render/merge.ts';
import RAPIER from '@dimforge/rapier3d-compat';

export interface MapMeta {
  id: string;
  title: { en: string; ar: string };
  size: [number, number, number];
  spawn: { hiders: number[][]; seekers: number[][] };
  sun?: { dirWorld: [number, number, number] };
  lights?: { pos: number[]; color: number[]; intensity: number; distance: number }[];
}

export interface GameView {
  mode: 'play' | 'paint';
  tool: Tool;
  brush: BrushSettings;
  pose: PoseName | null;
  locked: boolean;
  canUndo: boolean;
  canRedo: boolean;
  snapshotsLeft: number;
  fps: number;
  camo: number | null;
  loading: number; // 0..1, 1 = ready
  error: string | null;
  quality: Quality;
  hint: string | null; // short message key, e.g. 'hint.noSpace'
  clipCm: number; // deepest body penetration after the last pose (automated test)
}

const blenderToThree = (p: number[]) => new THREE.Vector3(p[0], p[2], -p[1]);

export class Game {
  readonly engine: Engine;
  readonly input: Input;
  private phys!: Physics;
  private body!: CharacterBody;
  hider!: Hider;
  paint!: PaintSystem;
  private orbit!: OrbitFollow;
  private raf = 0;
  private listeners: ((v: GameView) => void)[] = [];
  private raycaster = new THREE.Raycaster();
  private stroke: { last: THREE.Vector3 | null; lineStart: THREE.Vector3 | null; pointer: number } | null = null;
  private fpsAcc = { t: 0, n: 0 };
  private paintDrag: { x: number; y: number; id: number } | null = null;
  private acc = 0;
  private vel = new THREE.Vector3();
  private coyote = 0;
  private jumpBuffer = 0;
  private prevFeet = new THREE.Vector3();
  private curFeet = new THREE.Vector3();
  private poseHome: THREE.Vector3 | null = null;
  private unsubSettings: (() => void) | null = null;
  view: GameView;
  meta: MapMeta | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas);
    this.input = new Input(canvas);
    this.view = {
      mode: 'play',
      tool: 'brush',
      brush: { color: [200, 170, 120], size: 0.02, hardness: 0.6, opacity: 1, mirror: false, pattern: 'stripes', patternScale: 0.03, patternAngle: 0 },
      pose: null,
      locked: false,
      canUndo: false,
      canRedo: false,
      snapshotsLeft: 2,
      fps: 0,
      camo: null,
      loading: 0,
      error: null,
      quality: this.engine.quality,
      hint: null,
      clipCm: 0,
    };
  }

  on(f: (v: GameView) => void) {
    this.listeners.push(f);
    f(this.view);
    return () => (this.listeners = this.listeners.filter((x) => x !== f));
  }
  private emit(patch: Partial<GameView> = {}) {
    this.view = {
      ...this.view,
      ...patch,
      canUndo: this.paint?.canUndo ?? false,
      canRedo: this.paint?.canRedo ?? false,
      snapshotsLeft: this.paint?.snapshotsLeft ?? 0,
    };
    for (const f of this.listeners) f(this.view);
  }

  async start(mapId: string) {
    try {
      const prog = { phys: 0, map: 0, hider: 0 };
      const report = () => this.emit({ loading: Math.min(0.99, prog.phys * 0.1 + prog.map * 0.75 + prog.hider * 0.15) });
      const base = `/assets/3d/maps/${mapId}/`;
      const [, mapGltf, hiderGltf, meta] = await Promise.all([
        initPhysics().then(() => ((prog.phys = 1), report())),
        this.engine.load(`${base}map.glb`, (f) => ((prog.map = f), report())),
        this.engine.load('/assets/3d/hider.glb', (f) => ((prog.hider = f), report())),
        fetch(`${base}map.json`).then((r) => r.json() as Promise<MapMeta>),
      ]);
      this.meta = meta;
      const map = mapGltf.scene;
      map.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      this.phys = new Physics();
      this.phys.addStaticMeshes(map);
      // render the level as one mesh per material (far fewer draw calls)
      const { before, after, merged } = mergeStatic(map);
      console.info(`[findme] level draw calls: ${before} -> ${after}`);
      this.engine.scene.add(merged);
      this.engine.setupLights(meta.sun?.dirWorld ?? null, meta.size, meta.lights ?? []);
      this.hider = new Hider(hiderGltf);
      this.engine.scene.add(this.hider.root);
      const spawn = blenderToThree(meta.spawn.hiders[0] ?? [0, meta.size[1] / 2, 0.05]);
      const r = 0.16 * HIDER_SCALE;
      this.body = new CharacterBody(this.phys, { radius: r, halfHeight: Math.max(0.05, this.hider.height / 2 - r) }, spawn);
      this.paint = new PaintSystem(this.engine.renderer, this.hider.mesh, QUALITY[this.engine.quality].paintSize, QUALITY[this.engine.quality].undo);
      this.orbit = new OrbitFollow(this.engine.camera, this.phys, this.body.collider);
      this.input.onAction((a) => this.action(a));
      this.applySettings();
      this.unsubSettings = settings.subscribe(() => this.applySettings());
      this.body.feet(this.curFeet);
      this.prevFeet.copy(this.curFeet);
      this.bindPaintPointer();
      this.emit({ loading: 1 });
      this.loop();
    } catch (e) {
      console.warn('FIND ME failed to start', e);
      this.emit({ error: (e as Error).message || 'load failed' });
    }
  }

  // ---------------------------------------------------------------- actions
  action(a: Action) {
    if (this.view.loading < 1) return;
    if (a === 'paint') this.setMode(this.view.mode === 'paint' ? 'play' : 'paint');
    else if (a === 'lock') this.toggleLock();
    else if (a === 'undo' && this.paint.undo()) {
      sfx.whoosh();
      this.emit();
    } else if (a === 'redo' && this.paint.redo()) {
      sfx.whoosh();
      this.emit();
    } else if (a === 'eyedrop') this.emit({ tool: 'eyedrop' });
  }

  setMode(mode: 'play' | 'paint') {
    this.input.lookEnabled = mode === 'play';
    if (mode === 'paint') {
      this.input.releaseLock();
      this.orbit.pitch = 0.22;
      this.orbit.distance = Math.max(1.7, settings.get().cameraDistance * 0.75);
      const focus = this.hider.root.position.clone().add(new THREE.Vector3(0, this.hider.height * 0.55, 0));
      this.orbit.findOpenView(focus, this.orbit.distance);
    } else {
      this.orbit.distance = settings.get().cameraDistance;
    }
    this.frameForPanel(mode === 'paint');
    this.emit({ mode });
    sfx.tap();
  }

  /** Shift the view so the body sits in the half of the screen the paint panel doesn't cover. */
  private frameForPanel(on: boolean) {
    const cam = this.engine.camera;
    if (!on) {
      cam.clearViewOffset();
      return;
    }
    const w = this.engine.canvas.clientWidth;
    const h = this.engine.canvas.clientHeight;
    const rtl = document.documentElement.dir === 'rtl';
    const panel = Math.min(340, w * 0.46) + 16;
    cam.setViewOffset(w, h, (rtl ? 1 : -1) * panel * 0.5, 0, w, h);
  }

  /** CSS pixel position of a point on the body (fraction of height), e.g. for tests and tutorials. */
  screenPoint(heightFrac = 0.5): { x: number; y: number } {
    const p = this.hider.root.position.clone().add(new THREE.Vector3(0, this.hider.height * heightFrac, 0));
    p.project(this.engine.camera);
    const r = this.engine.canvas.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  setTool(tool: Tool) {
    this.emit({ tool });
    sfx.tap();
  }
  setBrush(b: Partial<BrushSettings>) {
    this.emit({ brush: { ...this.view.brush, ...b } });
  }
  setColor(rgb: [number, number, number]) {
    this.setBrush({ color: rgb });
  }

  private applySettings() {
    const st = settings.get();
    this.engine.camera.fov = st.fov;
    this.engine.camera.updateProjectionMatrix();
    if (this.orbit) {
      this.orbit.distance = st.cameraDistance;
      this.orbit.smoothing = st.cameraSmoothing;
    }
  }

  setPose(p: PoseName | null) {
    if (this.poseHome && (!p || this.hider.pose)) {
      // leaving a seat: step back to where we were standing
      this.body.teleport(this.poseHome);
      this.poseHome = null;
    }
    this.hider.setPose(p);
    let clip = 0;
    if (p) {
      this.placePose(p);
      clip = this.depenetrate();
      if (clip > 0.01) {
        // no room for this pose here: don't clip, say so instead
        this.hider.setPose(null);
        if (this.poseHome) {
          this.body.teleport(this.poseHome);
          this.poseHome = null;
        }
        sfx.tap();
        this.flashHint('hint.noSpace');
        this.emit({ pose: null, locked: false, clipCm: clip * 100 });
        return;
      }
    }
    sfx.thunk();
    this.emit({ pose: p, locked: false, clipCm: clip * 100 });
  }

  private hintTimer = 0;
  private flashHint(key: string) {
    clearTimeout(this.hintTimer);
    this.emit({ hint: key });
    this.hintTimer = window.setTimeout(() => this.emit({ hint: null }), 2200);
  }

  /**
   * Push the posed body out of anything it overlaps (furniture, walls), a few small steps.
   * Returns the deepest remaining penetration in metres (0 = clean).
   */
  private depenetrate(step = 4): number {
    const ex = this.body.collider;
    const up = new THREE.Vector3(0, 1, 0);
    let r = penetration(this.phys, this.hider.posedPoints(step), ex);
    for (let it = 0; it < 6 && r.max > 0.004; it++) {
      const local = r.push.clone().multiplyScalar(1.15).applyAxisAngle(up, -this.hider.root.rotation.y);
      local.addScaledVector(local.clone().normalize(), 0.003);
      this.hider.model.position.add(local);
      r = penetration(this.phys, this.hider.posedPoints(step), ex);
    }
    return r.max;
  }

  /**
   * Automated clipping test: every pose at every test spot, all vertices checked.
   * Returns the worst penetration per pose (cm) and whether the game refused the pose.
   */
  clipReport(spots: [number, number, number][]) {
    const rows: { pose: string; spot: number; clipCm: number; refused: boolean }[] = [];
    for (const [i, s] of spots.entries()) {
      for (const p of POSES) {
        this.setPose(null);
        this.body.teleport(new THREE.Vector3(s[0], s[1], s[2]));
        this.hider.facing = 0;
        this.hider.root.rotation.y = 0;
        this.body.feet(this.hider.root.position);
        this.setPose(p as PoseName);
        const refused = this.hider.pose === null;
        let clip = 0;
        if (!refused) {
          this.hider.measurePose();
          clip = penetration(this.phys, this.hider.posedPoints(1), this.body.collider).max;
        }
        rows.push({ pose: p, spot: i, clipCm: Math.round(clip * 1000) / 10, refused });
      }
    }
    this.setPose(null);
    return rows;
  }

  /**
   * Put the posed body ON the world, never inside it. Sitting looks for a seat in front
   * (chair, stool, sofa, bench, bed edge) and rests the torso on its top; every other pose
   * rests its lowest point on whatever surface is under the body.
   */
  private placePose(p: PoseName) {
    const world = this.phys.world;
    this.hider.root.rotation.y = this.hider.facing; // measure the final orientation, not mid-turn
    this.body.feet(this.hider.root.position);
    const down = { x: 0, y: -1, z: 0 };
    const castDown = (x: number, y: number, z: number, max: number) => {
      const hit = world.castRay(new RAPIER.Ray({ x, y, z }, down), max, true, undefined, undefined, this.body.collider);
      return hit ? y - hit.timeOfImpact : null;
    };
    const feet = this.body.feet(new THREE.Vector3());
    if (p === 'sit') {
      const f = this.hider.facing;
      let best: { y: number; x: number; z: number } | null = null;
      for (let d = 0; d <= 0.9; d += 0.1) {
        for (const side of [0, -0.12, 0.12]) {
          const x = feet.x + Math.sin(f) * d + Math.cos(f) * side;
          const z = feet.z + Math.cos(f) * d - Math.sin(f) * side;
          const y = castDown(x, feet.y + 1.4, z, 1.4);
          if (y !== null && y - feet.y > 0.18 && y - feet.y < 0.85) {
            best = { y, x, z };
            break;
          }
        }
        if (best) break;
      }
      if (best) {
        this.poseHome = feet.clone();
        // face away from the seat's back (turn around) and sit on it
        this.hider.facing = this.hider.facing + Math.PI;
        this.hider.root.rotation.y = this.hider.facing;
        this.body.teleport(new THREE.Vector3(best.x, feet.y, best.z));
        this.body.feet(this.hider.root.position);
        const m = this.hider.measurePose();
        this.hider.model.position.y += best.y + 0.006 - m.seatY;
        return;
      }
    }
    const m = this.hider.measurePose();
    let support = feet.y;
    for (const v of m.samples) {
      const y = castDown(v.x, v.y + 0.6, v.z, 1.2);
      if (y !== null && y > support && y < v.y + 0.6) support = y;
    }
    this.hider.model.position.y += support + 0.006 - m.minY;
  }

  toggleLock() {
    if (!this.hider.pose) this.hider.setPose('stand');
    this.hider.locked = !this.hider.locked;
    if (this.hider.locked) sfx.submit();
    else sfx.tap();
    this.emit({ locked: this.hider.locked, pose: this.hider.pose });
  }

  setQuality(q: Quality) {
    this.engine.setQuality(q);
    this.emit({ quality: q });
  }

  snapshot() {
    if (this.paint.snapshot(this.engine.scene, this.engine.camera)) {
      sfx.blip();
      this.emit();
    }
  }

  clearPaint() {
    this.paint.clearAll();
    sfx.whoosh();
    this.emit();
  }

  // ---------------------------------------------------------------- painting with the pointer
  private bindPaintPointer() {
    const c = this.engine.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (this.view.mode !== 'paint') {
        this.input.requestLock();
        return;
      }
      if (e.button === 2 || e.pointerType === 'touch' && this.paintDrag) {
        this.paintDrag = { x: e.clientX, y: e.clientY, id: e.pointerId };
        return;
      }
      const t = this.view.tool;
      if (t === 'eyedrop') {
        this.setColor(this.engine.pickScreenColor(e.clientX, e.clientY));
        sfx.blip();
        this.emit({ tool: 'brush' });
        return;
      }
      const hit = this.hit(e.clientX, e.clientY);
      if (!hit) {
        // dragging off the body orbits the camera
        this.paintDrag = { x: e.clientX, y: e.clientY, id: e.pointerId };
        return;
      }
      if (t === 'bucket') {
        this.paint.checkpoint();
        this.paint.fillPart(this.paint.partAt(hit.face!), this.view.brush, false);
        sfx.splash();
        this.emit();
        return;
      }
      const p = hitToBind(this.hider.mesh, hit, new THREE.Vector3());
      if (!p) return;
      this.paint.checkpoint();
      c.setPointerCapture(e.pointerId);
      this.stroke = { last: p, lineStart: t === 'line' ? p.clone() : null, pointer: e.pointerId };
      if (t !== 'line') this.paint.stroke(t, p, p, this.view.brush);
      sfx.brush();
    });
    c.addEventListener('pointermove', (e) => {
      if (this.paintDrag && e.pointerId === this.paintDrag.id) {
        const k = 0.006 * settings.get().paintOrbitSens;
        this.orbit.look((e.clientX - this.paintDrag.x) * k, (e.clientY - this.paintDrag.y) * k);
        this.paintDrag.x = e.clientX;
        this.paintDrag.y = e.clientY;
        return;
      }
      if (!this.stroke || e.pointerId !== this.stroke.pointer || this.view.tool === 'line') return;
      const hit = this.hit(e.clientX, e.clientY);
      if (!hit) return;
      const p = hitToBind(this.hider.mesh, hit, new THREE.Vector3());
      if (!p || !this.stroke.last) return;
      if (p.distanceTo(this.stroke.last) > this.view.brush.size * 0.25) {
        this.paint.stroke(this.view.tool, this.stroke.last, p, this.view.brush);
        this.stroke.last = p;
      }
    });
    const end = (e: PointerEvent) => {
      if (this.paintDrag && e.pointerId === this.paintDrag.id) this.paintDrag = null;
      if (!this.stroke || e.pointerId !== this.stroke.pointer) return;
      if (this.stroke.lineStart) {
        const hit = this.hit(e.clientX, e.clientY);
        const p = hit && hitToBind(this.hider.mesh, hit, new THREE.Vector3());
        if (p) this.paint.stroke('brush', this.stroke.lineStart, p, this.view.brush);
      }
      this.paint.endStroke();
      this.stroke = null;
      this.emit();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private hit(cssX: number, cssY: number): THREE.Intersection | null {
    const r = this.engine.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cssX - r.left) / r.width) * 2 - 1, -((cssY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.engine.camera);
    const hits = this.raycaster.intersectObject(this.hider.mesh, false);
    return hits[0] ?? null;
  }

  // ---------------------------------------------------------------- camouflage score
  /** 0..100: how well the body blends in, seen by seekers from three directions. */
  camoScore(): number {
    const W = 160;
    const H = 120;
    const rt = new THREE.WebGLRenderTarget(W, H);
    const cam = new THREE.PerspectiveCamera(60, W / H, 0.05, 60);
    const centre = this.hider.root.position.clone().add(new THREE.Vector3(0, this.hider.height * 0.5, 0));
    const a = new Uint8Array(W * H * 4);
    const b = new Uint8Array(W * H * 4);
    const r = this.engine.renderer;
    const scores: number[] = [];
    for (const k of [0, 2.1, 4.2]) {
      const yaw = this.orbit.yaw + k;
      cam.position.copy(centre).add(new THREE.Vector3(Math.sin(yaw) * 3.2, 0.8, Math.cos(yaw) * 3.2));
      cam.lookAt(centre);
      r.setRenderTarget(rt);
      r.render(this.engine.scene, cam);
      r.readRenderTargetPixels(rt, 0, 0, W, H, a);
      this.hider.root.visible = false;
      r.render(this.engine.scene, cam);
      r.readRenderTargetPixels(rt, 0, 0, W, H, b);
      this.hider.root.visible = true;
      r.setRenderTarget(null);
      let changed = 0;
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        if (d > 18) {
          changed++;
          diff += d;
        }
      }
      if (changed === 0) scores.push(100);
      else {
        const mean = diff / changed / 3; // 0..255 per channel
        const visible = Math.min(1, changed / (W * H * 0.04));
        scores.push(Math.round(100 * (1 - Math.min(1, mean / 70) * (0.4 + 0.6 * visible))));
      }
    }
    rt.dispose();
    const s = Math.max(0, Math.min(100, Math.round(scores.reduce((x, y) => x + y, 0) / scores.length)));
    this.emit({ camo: s });
    return s;
  }

  // ---------------------------------------------------------------- loop
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.engine.clock.getDelta(), 0.05);
    this.input.update();
    const s = this.input.consume();
    const painting = this.view.mode === 'paint';
    if (!painting) this.orbit.look(s.lookDX, s.lookDY);
    this.orbit.zoom(s.zoom * (painting ? settings.get().paintZoomSpeed : 1));

    // intent (camera-relative), with smooth acceleration so starts/stops never feel instant or icy
    const frozen = this.hider.locked || painting;
    const { forward, right } = this.orbit.basis();
    const wish = forward.multiplyScalar(s.moveY).add(right.multiplyScalar(s.moveX));
    const top = s.crouch ? 1.2 : s.sprint ? 4.2 : 2.4;
    const target = frozen ? new THREE.Vector3() : wish.multiplyScalar(top);
    const rate = target.lengthSq() > this.vel.lengthSq() ? 12 : 16; // accelerate / brake
    this.vel.lerp(target, 1 - Math.exp(-rate * dt));
    if (!frozen && wish.lengthSq() > 0.0004) {
      this.hider.facing = Math.atan2(wish.x, wish.z);
      if (this.hider.pose) this.setPose(null); // moving cancels an unlocked pose
    }
    if (s.jump && !frozen) this.jumpBuffer = 0.14;

    // fixed 60 Hz physics, rendered with interpolation (no jitter at any frame rate)
    const STEP = 1 / 60;
    this.acc += dt;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.coyote = this.body.grounded ? 0.12 : Math.max(0, this.coyote - STEP);
      this.jumpBuffer = Math.max(0, this.jumpBuffer - STEP);
      const jump = this.jumpBuffer > 0 && this.coyote > 0;
      if (jump) {
        this.jumpBuffer = 0;
        this.coyote = 0;
        this.body.grounded = true; // allow the jump from coyote time
        sfx.tap();
      }
      this.prevFeet.copy(this.curFeet);
      this.body.move(this.vel.x, this.vel.z, jump, STEP);
      this.phys.step(STEP);
      this.body.feet(this.curFeet);
    }
    this.hider.root.position.lerpVectors(this.prevFeet, this.curFeet, this.acc / STEP);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.hider.locomotion(speed, this.body.grounded, painting);
    this.hider.update(dt);

    const focus = this.hider.root.position.clone().add(new THREE.Vector3(0, this.hider.height * (painting ? 0.55 : 0.8), 0));
    if (painting) {
      this.orbit.minDist = 0.6;
      this.orbit.update(focus, dt, 0);
    } else {
      this.orbit.minDist = 0.8;
      this.orbit.update(focus, dt, 0.32);
    }
    this.engine.render();

    this.fpsAcc.t += dt;
    this.fpsAcc.n++;
    if (this.fpsAcc.t > 1) {
      this.emit({ fps: Math.round(this.fpsAcc.n / this.fpsAcc.t) });
      this.fpsAcc = { t: 0, n: 0 };
    }
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.unsubSettings?.();
    this.input.dispose();
    this.paint?.dispose();
    this.engine.dispose();
  }
}
