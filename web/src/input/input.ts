/**
 * Unified input: keyboard + mouse (pointer lock) on PC, virtual joystick + look-drag
 * + on-screen buttons on phones, and gamepads. Gameplay reads `state` every frame.
 */
export interface InputState {
  moveX: number; // -1..1 (right +)
  moveY: number; // -1..1 (forward +)
  lookDX: number; // accumulated since last frame (radians-ish units)
  lookDY: number;
  sprint: boolean;
  crouch: boolean;
  jump: boolean; // edge-triggered, cleared after read
  zoom: number; // accumulated wheel/pinch
}

export type Action = 'paint' | 'pose' | 'lock' | 'jump' | 'crouch' | 'undo' | 'redo' | 'eyedrop';

import { settings, MOUSE_BASE, TOUCH_BASE } from '../core/settings.ts';

export const isTouchDevice = () =>
  typeof window !== 'undefined' && (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1);

export class Input {
  readonly state: InputState = { moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, sprint: false, crouch: false, jump: false, zoom: 0 };
  /** When false (paint mode / menus), mouse moves a cursor instead of the camera. */
  lookEnabled = true;
  private keys = new Set<string>();
  private listeners: ((a: Action) => void)[] = [];
  private joy = { id: -1, x0: 0, y0: 0, x: 0, y: 0 };
  private lookTouch = { id: -1, x: 0, y: 0 };
  private disposers: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void, o?: AddEventListenerOptions) => {
      window.addEventListener(t, f as EventListener, o);
      this.disposers.push(() => window.removeEventListener(t, f as EventListener));
    };
    on('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.state.jump = true;
      const map: Record<string, Action> = { Tab: 'paint', KeyQ: 'pose', KeyF: 'lock', KeyE: 'eyedrop' };
      if (map[e.code]) {
        e.preventDefault();
        if (!e.repeat) this.emit(map[e.code]);
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        this.emit(e.shiftKey ? 'redo' : 'undo');
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
        e.preventDefault();
        this.emit('redo');
      }
    });
    on('keyup', (e) => this.keys.delete(e.code));
    on('blur', () => this.keys.clear());
    on('mousemove', (e) => {
      if (document.pointerLockElement === this.canvas && this.lookEnabled) {
        const st = settings.get();
        // raw counts, no acceleration (unadjustedMovement is requested with the lock)
        this.state.lookDX += e.movementX * MOUSE_BASE * st.mouseSens * st.mouseX;
        this.state.lookDY += e.movementY * MOUSE_BASE * st.mouseSens * st.mouseY * (st.invertY ? -1 : 1);
      }
    });
    on('wheel', (e) => {
      this.state.zoom += Math.sign(e.deltaY);
    }, { passive: true });
    const c = this.canvas;
    const td = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < innerWidth * 0.42 && this.joy.id < 0 && this.lookEnabled) {
          this.joy = { id: t.identifier, x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY };
        } else if (this.lookTouch.id < 0) {
          this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
        }
      }
    };
    const tm = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joy.id) {
          this.joy.x = t.clientX;
          this.joy.y = t.clientY;
        } else if (t.identifier === this.lookTouch.id && this.lookEnabled) {
          const st = settings.get();
          this.state.lookDX += (t.clientX - this.lookTouch.x) * TOUCH_BASE * st.touchSens * st.touchX;
          this.state.lookDY += (t.clientY - this.lookTouch.y) * TOUCH_BASE * st.touchSens * st.touchY * (st.invertY ? -1 : 1);
          this.lookTouch.x = t.clientX;
          this.lookTouch.y = t.clientY;
        }
      }
    };
    const te = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joy.id) this.joy.id = -1;
        if (t.identifier === this.lookTouch.id) this.lookTouch.id = -1;
      }
    };
    c.addEventListener('touchstart', td, { passive: true });
    c.addEventListener('touchmove', tm, { passive: true });
    c.addEventListener('touchend', te);
    c.addEventListener('touchcancel', te);
    this.disposers.push(() => {
      c.removeEventListener('touchstart', td);
      c.removeEventListener('touchmove', tm);
      c.removeEventListener('touchend', te);
      c.removeEventListener('touchcancel', te);
    });
  }

  requestLock() {
    if (!isTouchDevice() && document.pointerLockElement !== this.canvas) {
      const req = this.canvas.requestPointerLock as unknown as (o?: { unadjustedMovement?: boolean }) => Promise<void> | void;
      try {
        const p = req.call(this.canvas, { unadjustedMovement: true });
        if (p && typeof (p as Promise<void>).catch === 'function') {
          (p as Promise<void>).catch(() => req.call(this.canvas));
        }
      } catch {
        req.call(this.canvas);
      }
    }
  }
  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  onAction(f: (a: Action) => void) {
    this.listeners.push(f);
    return () => (this.listeners = this.listeners.filter((x) => x !== f));
  }
  emit(a: Action) {
    if (a === 'jump') this.state.jump = true;
    if (a === 'crouch') this.touchCrouch = !this.touchCrouch;
    for (const f of this.listeners) f(a);
  }
  touchCrouch = false;

  /** Joystick knob offset for drawing the on-screen stick. */
  get joystick() {
    return this.joy.id < 0 ? null : { x0: this.joy.x0, y0: this.joy.y0, x: this.joy.x, y: this.joy.y };
  }

  /** Call once per frame before gameplay reads the state. */
  update() {
    const k = this.keys;
    let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let my = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const st = settings.get();
    if (this.joy.id >= 0) {
      const R = st.joystickSize / 2;
      let jx = (this.joy.x - this.joy.x0) / R;
      let jy = -(this.joy.y - this.joy.y0) / R;
      const m = Math.hypot(jx, jy);
      if (m < st.deadZone) jx = jy = 0;
      else {
        const k = Math.min(1, (m - st.deadZone) / (1 - st.deadZone)) / m;
        jx *= k;
        jy *= k;
      }
      mx = jx;
      my = jy;
    }
    let sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    let crouch = k.has('ControlLeft') || k.has('KeyC') || this.touchCrouch;
    // gamepad
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p) continue;
      const dz = (v: number) => (Math.abs(v) < st.deadZone ? 0 : (v - Math.sign(v) * st.deadZone) / (1 - st.deadZone));
      const curve = (v: number) => (st.padCurve === 'exponential' ? Math.sign(v) * v * v : v);
      if (dz(p.axes[0]) || dz(p.axes[1])) {
        mx = dz(p.axes[0]);
        my = -dz(p.axes[1]);
      }
      this.state.lookDX += curve(dz(p.axes[2] ?? 0)) * 0.045 * st.padSens;
      this.state.lookDY += curve(dz(p.axes[3] ?? 0)) * 0.035 * st.padSens * (st.invertY ? -1 : 1);
      if (p.buttons[0]?.pressed) this.state.jump = true;
      if (p.buttons[10]?.pressed) sprint = true;
      if (p.buttons[1]?.pressed) crouch = true;
    }
    if (Math.hypot(mx, my) > 0.92 && this.joy.id >= 0) sprint = true; // full stick = run on phones
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.state.moveX = mx;
    this.state.moveY = my;
    this.state.sprint = sprint;
    this.state.crouch = crouch;
  }

  /** Read and clear the per-frame accumulators. */
  consume() {
    const s = { ...this.state };
    this.state.lookDX = 0;
    this.state.lookDY = 0;
    this.state.jump = false;
    this.state.zoom = 0;
    return s;
  }

  dispose() {
    this.disposers.forEach((d) => d());
  }
}
