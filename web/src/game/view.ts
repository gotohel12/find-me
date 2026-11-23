/**
 * Scene viewport: fits the scene in a canvas, pinch/wheel zoom, pan, and
 * screen <-> scene coordinate mapping. Pointer gestures are reported in scene
 * coordinates; two-finger gestures always zoom/pan.
 */
export interface Gesture {
  onDown?(x: number, y: number, e: PointerEvent): boolean | void; // return true to capture (no panning)
  onMove?(x: number, y: number, e: PointerEvent): void;
  onUp?(x: number, y: number, e: PointerEvent): void;
  onTap?(x: number, y: number, e: PointerEvent): void;
  onLongPress?(x: number, y: number): void;
}

export class View {
  scale = 1;
  ox = 0;
  oy = 0;
  minScale = 1;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; cx: number; cy: number; scale: number; ox: number; oy: number } | null = null;
  private captured = false;
  private down: { x: number; y: number; t: number; moved: boolean } | null = null;
  private longTimer: number | null = null;
  private panStart: { x: number; y: number; ox: number; oy: number } | null = null;
  readonly dpr = Math.min(window.devicePixelRatio || 1, 2.5);

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly sceneW: number,
    readonly sceneH: number,
    private g: Gesture,
    private redraw: () => void,
  ) {
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.pd);
    canvas.addEventListener('pointermove', this.pm);
    canvas.addEventListener('pointerup', this.pu);
    canvas.addEventListener('pointercancel', this.pu);
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    this.resize();
  }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this.pd);
    this.canvas.removeEventListener('pointermove', this.pm);
    this.canvas.removeEventListener('pointerup', this.pu);
    this.canvas.removeEventListener('pointercancel', this.pu);
    this.canvas.removeEventListener('wheel', this.wheel);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    const fit = Math.min(this.canvas.width / this.sceneW, this.canvas.height / this.sceneH);
    this.minScale = fit;
    this.scale = fit;
    this.ox = (this.canvas.width - this.sceneW * fit) / 2;
    this.oy = (this.canvas.height - this.sceneH * fit) / 2;
    this.redraw();
  }

  /** Apply the scene transform to a 2D context. */
  apply(g: CanvasRenderingContext2D) {
    g.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy);
  }

  toScene(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const px = (clientX - r.left) * this.dpr;
    const py = (clientY - r.top) * this.dpr;
    return [(px - this.ox) / this.scale, (py - this.oy) / this.scale];
  }

  /** Screen CSS pixels per scene pixel. */
  get cssPerScene() {
    return this.scale / this.dpr;
  }

  zoomAt(px: number, py: number, factor: number) {
    const ns = Math.min(Math.max(this.scale * factor, this.minScale), this.minScale * 6);
    const k = ns / this.scale;
    this.ox = px - (px - this.ox) * k;
    this.oy = py - (py - this.oy) * k;
    this.scale = ns;
    this.clamp();
    this.redraw();
  }

  zoomBy(factor: number) {
    this.zoomAt(this.canvas.width / 2, this.canvas.height / 2, factor);
  }

  /** Centre the view on a scene point at a given zoom (for reveals). */
  focus(x: number, y: number, zoom: number) {
    this.scale = Math.min(Math.max(this.minScale * zoom, this.minScale), this.minScale * 6);
    this.ox = this.canvas.width / 2 - x * this.scale;
    this.oy = this.canvas.height / 2 - y * this.scale;
    this.clamp();
    this.redraw();
  }

  private clamp() {
    const w = this.sceneW * this.scale;
    const h = this.sceneH * this.scale;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    this.ox = w <= cw ? (cw - w) / 2 : Math.min(0, Math.max(cw - w, this.ox));
    this.oy = h <= ch ? (ch - h) / 2 : Math.min(0, Math.max(ch - h, this.oy));
  }

  private local(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * this.dpr, y: (e.clientY - r.top) * this.dpr };
  }

  private pd = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.local(e));
    if (this.pointers.size === 2) {
      this.cancelLong();
      if (this.captured && this.down) this.g.onUp?.(...this.toScene(e.clientX, e.clientY), e);
      this.captured = false;
      this.down = null;
      this.panStart = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y),
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        scale: this.scale,
        ox: this.ox,
        oy: this.oy,
      };
      return;
    }
    const [sx, sy] = this.toScene(e.clientX, e.clientY);
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    this.captured = this.g.onDown?.(sx, sy, e) === true;
    if (!this.captured) {
      const l = this.local(e);
      this.panStart = { x: l.x, y: l.y, ox: this.ox, oy: this.oy };
    }
    this.cancelLong();
    this.longTimer = window.setTimeout(() => {
      if (this.down && !this.down.moved) this.g.onLongPress?.(sx, sy);
    }, 420);
  };

  private pm = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) {
      // hover (desktop): forward for brush cursor
      if (e.pointerType === 'mouse') this.g.onMove?.(...this.toScene(e.clientX, e.clientY), e);
      return;
    }
    this.pointers.set(e.pointerId, this.local(e));
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const ns = Math.min(Math.max(this.pinch.scale * (d / this.pinch.d), this.minScale), this.minScale * 6);
      const k = ns / this.pinch.scale;
      this.scale = ns;
      this.ox = cx - (this.pinch.cx - this.pinch.ox) * k;
      this.oy = cy - (this.pinch.cy - this.pinch.oy) * k;
      this.clamp();
      this.redraw();
      return;
    }
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 6) {
      this.down.moved = true;
      this.cancelLong();
    }
    if (this.captured) {
      this.g.onMove?.(...this.toScene(e.clientX, e.clientY), e);
    } else if (this.panStart && this.down?.moved) {
      const l = this.local(e);
      this.ox = this.panStart.ox + (l.x - this.panStart.x);
      this.oy = this.panStart.oy + (l.y - this.panStart.y);
      this.clamp();
      this.redraw();
    } else {
      this.g.onMove?.(...this.toScene(e.clientX, e.clientY), e);
    }
  };

  private pu = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.cancelLong();
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    const [sx, sy] = this.toScene(e.clientX, e.clientY);
    if (this.captured) this.g.onUp?.(sx, sy, e);
    else if (this.down && !this.down.moved && performance.now() - this.down.t < 400) this.g.onTap?.(sx, sy, e);
    this.captured = false;
    this.down = null;
    this.panStart = null;
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    const l = this.local(e as unknown as PointerEvent);
    this.zoomAt(l.x, l.y, Math.exp(-e.deltaY * 0.0015));
  };

  private cancelLong() {
    if (this.longTimer !== null) clearTimeout(this.longTimer);
    this.longTimer = null;
  }
}
