import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  FAIRNESS,
  type FairnessReport,
  type PartId,
  type Placement,
  PaintTexture,
  checkFairness,
  clampPlacement,
  formatCountdown,
  hexToRgb,
  hsvToRgb,
  pushRecent,
  rgbToHex,
} from '@findme/shared';
import { useI18n } from '../app.tsx';
import { type SceneData, type SpriteData, depthScale, forbiddenAt, loadSprite, manifest, samplePixel } from '../game/load.ts';
import { characterDepth, composeCharacter, drawContactShadow, isOccluded, pickOnCharacter } from '../game/compose.ts';
import { PATTERNS, type Pattern, type PatternId, makePattern, patchFrom } from '../game/patterns.ts';
import { View } from '../game/view.ts';
import { sfx } from '../game/sfx.ts';

export interface HideResult {
  scene: SceneData;
  sprite: SpriteData;
  placement: Placement;
  paint: PaintTexture;
}

type Tool = 'move' | 'brush' | 'eyedrop' | 'bucket' | 'pattern' | 'patch' | 'smudge' | 'eraser';
const TOOLS: { id: Tool; icon: string }[] = [
  { id: 'move', icon: '✥' },
  { id: 'eyedrop', icon: '💧' },
  { id: 'brush', icon: '🖌' },
  { id: 'bucket', icon: '🪣' },
  { id: 'pattern', icon: '▦' },
  { id: 'patch', icon: '✂' },
  { id: 'smudge', icon: '☁' },
  { id: 'eraser', icon: '⌫' },
];

export function Hide({ scene, onSubmit, onBack }: { scene: SceneData; onSubmit: (r: HideResult) => void; onBack: () => void }) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View | null>(null);
  const paint = useMemo(() => new PaintTexture(), []);
  const layerCanvas = useMemo(() => document.createElement('canvas'), []);
  const [poses, setPoses] = useState<string[]>([]);
  const [angles, setAngles] = useState<string[]>(['front']);
  const [pose, setPose] = useState('stand');
  const [angle, setAngle] = useState('front');
  const [sprite, setSprite] = useState<SpriteData | null>(null);
  const [pl, setPl] = useState<Placement>({ x: scene.meta.width / 2, y: scene.meta.height * 0.8, scale: 1, rotation: 0, flip: false });
  const [adjust, setAdjust] = useState(1);
  const [tool, setTool] = useState<Tool>('move');
  const [color, setColor] = useState('#8a6a4f');
  const [recent, setRecent] = useState<string[]>([]);
  const [size, setSize] = useState(8);
  const [soft, setSoft] = useState(0.5);
  const [opacity, setOpacity] = useState(1);
  const [pattern, setPattern] = useState<PatternId>('stripes');
  const [patScale, setPatScale] = useState(1);
  const [patch, setPatch] = useState<Pattern | null>(null);
  const [patchLeft, setPatchLeft] = useState(3);
  const [showPoses, setShowPoses] = useState(false);
  const [showColor, setShowColor] = useState(false);
  const [left, setLeft] = useState<number>(FAIRNESS.hideTimeLimitMs);
  const [, bump] = useState(0);
  const [loupe, setLoupe] = useState<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const stroke = useRef<{ last: { u: number; v: number } | null; sx: number; sy: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const state = useRef({ sprite, pl, adjust, tool, color, size, soft, opacity, pattern, patScale, patch, patchLeft, loupe, cursor });
  state.current = { sprite, pl, adjust, tool, color, size, soft, opacity, pattern, patScale, patch, patchLeft, loupe, cursor };

  // ---------- assets
  useEffect(() => {
    manifest().then((m) => {
      if (!m.character) return;
      setPoses(m.character.poses);
      setAngles(m.character.angles);
    });
  }, []);
  useEffect(() => {
    let live = true;
    loadSprite(pose, angle).then((s) => live && setSprite(s));
    return () => {
      live = false;
    };
  }, [pose, angle]);

  // ---------- placement follows depth
  const placeAt = (x: number, y: number, sp: SpriteData, adj = state.current.adjust, base = state.current.pl): Placement => {
    const tmp = { ...base, x, y };
    const ds = depthScale(scene, sp, characterDepth(scene, tmp));
    return clampPlacement({ ...tmp, scale: ds * adj }, ds);
  };
  useEffect(() => {
    if (sprite) setPl((p) => placeAt(p.x, p.y, sprite, adjust, p));
  }, [sprite, adjust]);

  // ---------- timer
  useEffect(() => {
    const end = Date.now() + FAIRNESS.hideTimeLimitMs;
    const id = setInterval(() => {
      const ms = end - Date.now();
      setLeft(ms);
      if (ms <= 10_000 && ms > 0) sfx.tick();
      if (ms <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // ---------- fairness (live)
  const fair: FairnessReport | null = useMemo(() => {
    if (!sprite) return null;
    const d = characterDepth(scene, pl);
    return checkFairness(
      {
        placement: pl,
        depthScale: depthScale(scene, sprite, d),
        depth: d,
        sprite: { mask: sprite.mask, anchorX: sprite.anchor[0], anchorY: sprite.anchor[1] },
      },
      {
        width: scene.meta.width,
        height: scene.meta.height,
        occludes: (x, y, cd) => isOccluded(scene, x, y, cd),
        forbidden: (x, y) => forbiddenAt(scene, x, y),
      },
    );
  }, [sprite, pl]);

  // ---------- drawing
  const redraw = () => {
    const v = viewRef.current;
    const c = canvasRef.current;
    const s = state.current;
    if (!v || !c) return;
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#120d2c';
    g.fillRect(0, 0, c.width, c.height);
    v.apply(g);
    g.imageSmoothingQuality = 'high';
    g.drawImage(scene.image, 0, 0, scene.meta.width, scene.meta.height);
    if (s.sprite) {
      drawContactShadow(g, s.sprite, s.pl);
      const layer = composeCharacter(scene, s.sprite, s.pl, paint, {}, layerCanvas);
      g.drawImage(layer.canvas, layer.x, layer.y);
    }
    if (s.cursor && (s.tool === 'brush' || s.tool === 'eraser' || s.tool === 'smudge')) {
      g.strokeStyle = 'rgba(255,255,255,.85)';
      g.lineWidth = 1.5 / v.scale;
      g.beginPath();
      g.arc(s.cursor.x, s.cursor.y, (s.size * (s.sprite?.size ?? 256) * s.pl.scale) / 512, 0, Math.PI * 2);
      g.stroke();
    }
    if (s.loupe) drawLoupe(g, v, s.loupe.x, s.loupe.y);
  };

  const drawLoupe = (g: CanvasRenderingContext2D, v: View, x: number, y: number) => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    const R = 70 * v.dpr;
    const cx = Math.min(Math.max(x * v.scale + v.ox, R + 8), g.canvas.width - R - 8);
    const cy = Math.max(y * v.scale + v.oy - R * 1.6, R + 8);
    const zoom = 8;
    g.save();
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.clip();
    g.imageSmoothingEnabled = false;
    const src = R / zoom;
    g.drawImage(scene.image, x - src, y - src, src * 2, src * 2, cx - R, cy - R, R * 2, R * 2);
    g.restore();
    const [r, gg, b] = samplePixel(scene, x, y);
    g.lineWidth = 6 * v.dpr;
    g.strokeStyle = `rgb(${r},${gg},${b})`;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 2 * v.dpr;
    g.strokeStyle = '#fff';
    g.strokeRect(cx - zoom / 2, cy - zoom / 2, zoom, zoom);
  };

  useEffect(() => {
    redraw();
  });

  // ---------- input
  useEffect(() => {
    const c = canvasRef.current!;
    const pickColor = (x: number, y: number) => {
      const hex = rgbToHex(samplePixel(scene, x, y));
      setColor(hex);
      setRecent((r) => pushRecent(r, hex));
      sfx.blip();
    };
    const paintAt = (x: number, y: number) => {
      const s = state.current;
      if (!s.sprite || !stroke.current) return;
      const steps = Math.max(1, Math.ceil(Math.hypot(x - stroke.current.sx, y - stroke.current.sy) / 1.5));
      for (let i = 1; i <= steps; i++) {
        const px = stroke.current.sx + ((x - stroke.current.sx) * i) / steps;
        const py = stroke.current.sy + ((y - stroke.current.sy) * i) / steps;
        const hit = pickOnCharacter(s.sprite, s.pl, px, py);
        if (!hit) continue;
        if (s.tool === 'smudge') {
          if (stroke.current.last) paint.smudge(stroke.current.last.u, stroke.current.last.v, hit.u, hit.v, s.size, 0.5);
        } else {
          paint.stamp(hit.u, hit.v, s.size, hexToRgb(s.color), s.opacity, s.soft, s.tool === 'eraser');
        }
        stroke.current.last = { u: hit.u, v: hit.v };
      }
      stroke.current.sx = x;
      stroke.current.sy = y;
    };
    const v = new View(
      c,
      scene.meta.width,
      scene.meta.height,
      {
        onDown: (x, y) => {
          const s = state.current;
          if (!s.sprite) return false;
          const on = pickOnCharacter(s.sprite, s.pl, x, y);
          if (s.tool === 'move') {
            if (!on) return false;
            drag.current = { dx: s.pl.x - x, dy: s.pl.y - y };
            return true;
          }
          if (s.tool === 'eyedrop') {
            setLoupe({ x, y });
            return true;
          }
          if ((s.tool === 'brush' || s.tool === 'eraser' || s.tool === 'smudge') && on) {
            paint.checkpoint();
            stroke.current = { last: null, sx: x, sy: y };
            paintAt(x, y);
            sfx.brush();
            bump((n) => n + 1);
            return true;
          }
          return false;
        },
        onMove: (x, y) => {
          const s = state.current;
          if (drag.current && s.sprite) {
            setPl(placeAt(x + drag.current.dx, y + drag.current.dy, s.sprite, s.adjust, s.pl));
            return;
          }
          if (s.loupe) {
            setLoupe({ x, y });
            return;
          }
          if (stroke.current) {
            paintAt(x, y);
            bump((n) => n + 1);
          }
          setCursor({ x, y });
        },
        onUp: (x, y) => {
          const s = state.current;
          if (s.loupe) {
            pickColor(x, y);
            setLoupe(null);
          }
          drag.current = null;
          stroke.current = null;
        },
        onTap: (x, y) => {
          const s = state.current;
          if (!s.sprite) return;
          const on = pickOnCharacter(s.sprite, s.pl, x, y);
          if (s.tool === 'move' && !on) {
            setPl(placeAt(x, y, s.sprite, s.adjust, s.pl));
            sfx.tap();
          } else if (s.tool === 'bucket' && on) {
            paint.checkpoint();
            paint.fillPart(on.part as PartId, hexToRgb(s.color));
            sfx.splash();
          } else if (s.tool === 'pattern' && on) {
            paint.checkpoint();
            paint.stampPattern(on.part as PartId, makePattern(s.pattern, s.patScale), hexToRgb(s.color), s.opacity);
            sfx.thunk();
          } else if (s.tool === 'patch') {
            if (on && s.patch) {
              paint.checkpoint();
              paint.tilePart(on.part as PartId, s.patch);
              setPatch(null);
              sfx.thunk();
            } else if (!on && s.patchLeft > 0) {
              setPatch(patchFrom(scene.pixels, scene.meta.width, x, y));
              setPatchLeft((n) => n - 1);
              sfx.blip();
            }
          }
          bump((n) => n + 1);
        },
        onLongPress: (x, y) => {
          if (state.current.tool === 'eyedrop') setLoupe({ x, y });
        },
      },
      () => redraw(),
    );
    viewRef.current = v;
    const ro = new ResizeObserver(() => v.resize());
    ro.observe(c);
    return () => {
      ro.disconnect();
      v.destroy();
    };
  }, [scene]);

  const submit = () => {
    if (!sprite || !fair?.ok) return;
    sfx.submit();
    onSubmit({ scene, sprite, placement: pl, paint });
  };
  useEffect(() => {
    if (left <= 0) {
      if (fair?.ok) submit();
    }
  }, [left <= 0]);

  const setColorHex = (hex: string) => {
    setColor(hex);
    setRecent((r) => pushRecent(r, hex));
  };

  const hint =
    tool === 'eyedrop' ? t('tool.eyedrop_hint') : tool === 'bucket' || tool === 'pattern' ? t('tool.fill_hint') : tool === 'patch' ? t('tool.patch_hint') : '';

  return (
    <div class="editor">
      <header class="ed-top">
        <button class="icon-btn" onClick={onBack} aria-label={t('back')}>
          ←
        </button>
        <span class={`timer ${left < 30_000 ? 'warn' : ''}`}>{left > 0 ? t('hide.time', { time: formatCountdown(left).slice(3) }) : t('hide.timeup')}</span>
        <button class="btn submit" disabled={!fair?.ok} onClick={submit}>
          {t('hide.submit')}
        </button>
      </header>

      <div class="ed-canvas-wrap">
        <canvas ref={canvasRef} class="ed-canvas" />
        {fair && <div class={`fair ${fair.ok ? 'ok' : 'bad'}`}>{fair.ok ? t('fair.ok') : t(`fair.${fair.issues[0]}`)}</div>}
        {hint && <div class="tool-hint">{tool === 'patch' ? `${hint} · ${t('tool.patch_left', { n: patchLeft })}` : hint}</div>}
        <div class="zoom-btns">
          <button class="icon-btn" onClick={() => viewRef.current?.zoomBy(1.4)}>＋</button>
          <button class="icon-btn" onClick={() => viewRef.current?.zoomBy(1 / 1.4)}>－</button>
        </div>
      </div>

      <div class="ed-opts">
        {tool === 'move' && (
          <>
            <button class="chip" onClick={() => setShowPoses(true)}>🧍 {t('hide.pose')}</button>
            <button class="chip" onClick={() => setAngle(angles[(angles.indexOf(angle) + 1) % angles.length])}>↻ {t('hide.angle')}</button>
            <button class="chip" onClick={() => setPl((p) => ({ ...p, flip: !p.flip }))}>⇋ {t('hide.flip')}</button>
            <label class="slider">
              {t('hide.size')}
              <input type="range" min={FAIRNESS.userScaleMin} max={FAIRNESS.userScaleMax} step={0.01} value={adjust} onInput={(e) => setAdjust(+(e.target as HTMLInputElement).value)} />
            </label>
            <label class="slider">
              {t('hide.rotate')}
              <input type="range" min={-45} max={45} step={1} value={(pl.rotation * 180) / Math.PI} onInput={(e) => setPl((p) => ({ ...p, rotation: (+(e.target as HTMLInputElement).value * Math.PI) / 180 }))} />
            </label>
          </>
        )}
        {(tool === 'brush' || tool === 'eraser' || tool === 'smudge') && (
          <>
            <label class="slider">
              {t('tool.size')}
              <input type="range" min={1} max={28} value={size} onInput={(e) => setSize(+(e.target as HTMLInputElement).value)} />
            </label>
            {tool === 'brush' && (
              <>
                <label class="slider">
                  {t('tool.soft')}
                  <input type="range" min={0} max={1} step={0.05} value={soft} onInput={(e) => setSoft(+(e.target as HTMLInputElement).value)} />
                </label>
                <label class="slider">
                  {t('tool.opacity')}
                  <input type="range" min={0.05} max={1} step={0.05} value={opacity} onInput={(e) => setOpacity(+(e.target as HTMLInputElement).value)} />
                </label>
              </>
            )}
          </>
        )}
        {tool === 'pattern' && (
          <>
            <div class="patterns">
              {PATTERNS.map((p) => (
                <button key={p} class={`pat ${p === pattern ? 'on' : ''}`} onClick={() => setPattern(p)} title={p}>
                  <PatternSwatch id={p} color={color} />
                </button>
              ))}
            </div>
            <label class="slider">
              {t('tool.size')}
              <input type="range" min={0.5} max={3} step={0.25} value={patScale} onInput={(e) => setPatScale(+(e.target as HTMLInputElement).value)} />
            </label>
          </>
        )}
        <button class="swatch" style={{ background: color }} onClick={() => setShowColor((v) => !v)} aria-label={t('color')} />
        <button class="icon-btn" disabled={!paint.canUndo} onClick={() => { paint.undo(); sfx.whoosh(); bump((n) => n + 1); }} aria-label={t('hide.undo')}>↶</button>
        <button class="icon-btn" disabled={!paint.canRedo} onClick={() => { paint.redo(); sfx.whoosh(); bump((n) => n + 1); }} aria-label={t('hide.redo')}>↷</button>
        <button class="icon-btn" onClick={() => { paint.reset(); sfx.whoosh(); bump((n) => n + 1); }} aria-label={t('hide.reset')}>⟲</button>
      </div>

      <nav class="ed-tools">
        {TOOLS.map((x) => (
          <button key={x.id} class={`tool ${tool === x.id ? 'on' : ''}`} onClick={() => { setTool(x.id); sfx.tap(); }} aria-pressed={tool === x.id}>
            <span class="ti">{x.icon}</span>
            <span class="tl">{t(`tool.${x.id}`)}</span>
          </button>
        ))}
      </nav>

      {showColor && <ColorPanel color={color} recent={recent} onPick={setColorHex} onClose={() => setShowColor(false)} />}
      {showPoses && (
        <div class="sheet" onClick={() => setShowPoses(false)}>
          <div class="pose-grid" onClick={(e) => e.stopPropagation()}>
            {poses.map((p) => (
              <button key={p} class={`pose ${p === pose ? 'on' : ''}`} onClick={() => { setPose(p); setShowPoses(false); sfx.tap(); }}>
                <img src={`/assets/character/${p}/front/shade.webp`} alt={p} loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PatternSwatch({ id, color }: { id: PatternId; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const p = makePattern(id, 1);
    const c = ref.current!;
    c.width = p.width;
    c.height = p.height;
    const g = c.getContext('2d')!;
    const img = g.createImageData(p.width, p.height);
    const [r, gg, b] = hexToRgb(color);
    for (let i = 0; i < p.data.length; i += 4) {
      const dark = p.data[i] < 128;
      img.data[i] = dark ? r : 240;
      img.data[i + 1] = dark ? gg : 240;
      img.data[i + 2] = dark ? b : 240;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, [id, color]);
  return <canvas ref={ref} class="pat-canvas" />;
}

function ColorPanel({ color, recent, onPick, onClose }: { color: string; recent: string[]; onPick: (hex: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [h, setH] = useState(0);
  const [s, setS] = useState(0.5);
  const [v, setV] = useState(0.6);
  const [hex, setHex] = useState(color);
  const sv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = sv.current!;
    const g = c.getContext('2d')!;
    const [r, gg, b] = hsvToRgb(h, 1, 1);
    g.fillStyle = `rgb(${r},${gg},${b})`;
    g.fillRect(0, 0, c.width, c.height);
    const wg = g.createLinearGradient(0, 0, c.width, 0);
    wg.addColorStop(0, '#fff');
    wg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = wg;
    g.fillRect(0, 0, c.width, c.height);
    const bg = g.createLinearGradient(0, 0, 0, c.height);
    bg.addColorStop(0, 'rgba(0,0,0,0)');
    bg.addColorStop(1, '#000');
    g.fillStyle = bg;
    g.fillRect(0, 0, c.width, c.height);
  }, [h]);
  const commit = (nh = h, ns = s, nv = v) => {
    const x = rgbToHex(hsvToRgb(nh, ns, nv));
    setHex(x);
    onPick(x);
  };
  const onSV = (e: PointerEvent) => {
    if (e.buttons === 0 && e.type === 'pointermove') return;
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const ns = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const nv = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setS(ns);
    setV(nv);
    commit(h, ns, nv);
  };
  return (
    <div class="sheet" onClick={onClose}>
      <div class="color-panel" onClick={(e) => e.stopPropagation()}>
        <canvas ref={sv} width={240} height={150} class="sv" onPointerDown={onSV} onPointerMove={onSV} />
        <input type="range" class="hue" min={0} max={1} step={0.002} value={h} onInput={(e) => { const nh = +(e.target as HTMLInputElement).value; setH(nh); commit(nh); }} />
        <div class="hex-row">
          <span class="swatch big" style={{ background: hex }} />
          <input
            class="hex"
            value={hex}
            dir="ltr"
            onChange={(e) => {
              const val = (e.target as HTMLInputElement).value.trim();
              if (/^#?[0-9a-f]{6}$/i.test(val)) {
                const x = val.startsWith('#') ? val : `#${val}`;
                setHex(x);
                onPick(x.toLowerCase());
              }
            }}
          />
        </div>
        {recent.length > 0 && (
          <>
            <small>{t('recent')}</small>
            <div class="recent">
              {recent.map((c) => (
                <button key={c} class="swatch" style={{ background: c }} onClick={() => { setHex(c); onPick(c); }} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
