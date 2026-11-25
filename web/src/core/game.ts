/**
 * FIND ME 3D — practice game: walk around the map, paint your own body, pose,
 * lock in, and get a Camouflage Score from three seeker viewpoints.
 */
import * as THREE from 'three';
import { Engine, QUALITY, type Quality } from '../render/engine.ts';
import { Input, type Action } from '../input/input.ts';
import { initPhysics, Physics, CharacterBody } from './physics.ts';
import { Hider, HIDER_SCALE, type PoseName } from '../gameplay/hider.ts';
import { OrbitFollow } from '../gameplay/camera.ts';
import { PaintSystem, hitToBind, type BrushSettings, type Tool } from '../gameplay/paint.ts';
import { sfx } from '../sfx.ts';

export interface MapMeta {
  id: string;
  title: { en: string; ar: string };
  size: [number, number, number];
  spawn: { hiders: number[][]; seekers: number[][] };
  sun?: { dirWorld: [number, number, number] };
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
      this.engine.scene.add(map);
      this.engine.setupLights(meta.sun?.dirWorld ?? null, meta.size);

      this.phys = new Physics();
      this.phys.addStaticMeshes(map);
      this.hider = new Hider(hiderGltf);
      this.engine.scene.add(this.hider.root);
      const spawn = blenderToThree(meta.spawn.hiders[0] ?? [0, meta.size[1] / 2, 0.05]);
      const r = 0.16 * HIDER_SCALE;
      this.body = new CharacterBody(this.phys, { radius: r, halfHeight: Math.max(0.05, this.hider.height / 2 - r) }, spawn);
      this.paint = new PaintSystem(this.engine.renderer, this.hider.mesh, QUALITY[this.engine.quality].paintSize, QUALITY[this.engine.quality].undo);
      this.orbit = new OrbitFollow(this.engine.camera, this.phys, this.body.collider);
      this.input.onAction((a) => this.action(a));
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
    if (mode === 'paint') this.input.releaseLock();
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

  setPose(p: PoseName | null) {
    this.hider.setPose(p);
    sfx.thunk();
    this.emit({ pose: p, locked: false });
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
        this.orbit.look((e.clientX - this.paintDrag.x) * 0.006, (e.clientY - this.paintDrag.y) * 0.006);
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
    this.orbit.zoom(s.zoom);

    // movement (frozen while locked in or painting)
    let speed = 0;
    if (!this.hider.locked && !painting) {
      const { forward, right } = this.orbit.basis();
      const dir = forward.multiplyScalar(s.moveY).add(right.multiplyScalar(s.moveX));
      const base = s.crouch ? 1.2 : s.sprint ? 4.2 : 2.3;
      speed = dir.length() * base;
      if (dir.lengthSq() > 0.001) {
        dir.normalize();
        this.hider.facing = Math.atan2(dir.x, dir.z);
        if (this.hider.pose) this.setPose(null); // moving cancels an unlocked pose
      }
      this.body.move(dir.x * base, dir.z * base, s.jump, dt);
      if (s.jump && this.body.grounded) sfx.tap();
    } else {
      this.body.move(0, 0, false, dt);
    }
    this.phys.step(dt);
    this.body.feet(this.hider.root.position);
    this.hider.locomotion(speed, this.body.grounded, painting);
    this.hider.update(dt);

    const focus = this.hider.root.position.clone().add(new THREE.Vector3(0, this.hider.height * (painting ? 0.55 : 0.8), 0));
    if (painting) {
      this.orbit.minDist = 0.6;
      this.orbit.update(focus, dt, 0);
    } else {
      this.orbit.minDist = 0.8;
      this.orbit.update(focus, dt, 0.35);
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
    this.input.dispose();
    this.paint?.dispose();
    this.engine.dispose();
  }
}
