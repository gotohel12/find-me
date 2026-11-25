import { useEffect, useRef, useState } from 'preact/hooks';
import { useI18n } from '../app.tsx';
import { Game, type GameView } from '../core/game.ts';
import { isTouchDevice } from '../input/input.ts';
import { settings } from '../core/settings.ts';
import { POSES, type PoseName } from '../gameplay/hider.ts';
import { PATTERNS, type Tool } from '../gameplay/paint.ts';
import { Icon } from './icons.tsx';
import { ColorWheel } from './ColorWheel.tsx';
import { SettingsModal } from './Settings.tsx';

const TOOLS: { id: Tool; icon: keyof typeof Icon }[] = [
  { id: 'brush', icon: 'brush' },
  { id: 'spray', icon: 'spray' },
  { id: 'bucket', icon: 'bucket' },
  { id: 'pattern', icon: 'pattern' },
  { id: 'line', icon: 'line' },
  { id: 'blur', icon: 'blur' },
  { id: 'eraser', icon: 'eraser' },
  { id: 'eyedrop', icon: 'drop' },
];

/** Key chip: keys stay LTR, the label follows the page direction. */
function Kbd({ k, label }: { k: string[]; label: string }) {
  return (
    <span class="kbd">
      {k.map((x) => (
        <b key={x}>{x}</b>
      ))}
      <span>{label}</span>
    </span>
  );
}

function Range({ label, value, min, max, step, fmt, on }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; on: (v: number) => void }) {
  return (
    <label class="field">
      <span class="field-row">
        {label}
        <output>{fmt(value)}</output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onInput={(e) => on(+(e.target as HTMLInputElement).value)} />
    </label>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const INNER = POSES.slice(0, 7);
const OUTER = POSES.slice(7);
const ring = (list: readonly string[], r: number, off: number, base: number) =>
  list.map((p, i) => {
    const a = (i / list.length) * Math.PI * 2 + off;
    return { p, x: 50 + Math.sin(a) * r, y: 50 - Math.cos(a) * r, i: base + i };
  });
const WHEEL = [...ring(INNER, 25, 0, 0), ...ring(OUTER, 41.5, Math.PI / OUTER.length, INNER.length)];

export function GameScreen({ mapId, onExit }: { mapId: string; onExit: () => void }) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<Game | null>(null);
  const [v, setV] = useState<GameView | null>(null);
  const [poses, setPoses] = useState(false);
  const [hoverPose, setHoverPose] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [joy, setJoy] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);
  const [finish, setFinish] = useState({ rough: 0.6, metal: 0 });
  const [fpsOn, setFpsOn] = useState(settings.get().showFps);
  const touch = isTouchDevice();

  useEffect(() => {
    const g = new Game(canvas.current!);
    game.current = g;
    (window as unknown as { __findme?: Game }).__findme = g; // test/tutorial hook
    const off = g.on(setV);
    void g.start(mapId);
    let raf = 0;
    const tick = () => {
      setJoy(g.input.joystick);
      raf = requestAnimationFrame(tick);
    };
    if (touch) tick();
    const pose = g.input.onAction((a) => a === 'pose' && setPoses((p) => !p));
    const unsub = settings.subscribe((s) => setFpsOn(s.showFps));
    return () => {
      cancelAnimationFrame(raf);
      off();
      pose();
      unsub();
      g.dispose();
    };
  }, [mapId]);

  // menus free the mouse
  useEffect(() => {
    if ((poses || showSettings) && document.pointerLockElement) document.exitPointerLock();
  }, [poses, showSettings]);

  const g = game.current;
  const painting = v?.mode === 'paint';
  const joySize = settings.get().joystickSize;

  return (
    <div class="game">
      <canvas ref={canvas} class="game-canvas" />

      {v && v.loading < 1 && !v.error && (
        <div class="loading">
          <div class="blob" />
          <p>{t('game.loading')}</p>
          <div class="bar">
            <div style={{ width: `${Math.round(v.loading * 100)}%` }} />
          </div>
          <small>{t('game.tip')}</small>
        </div>
      )}
      {v?.error && (
        <div class="loading">
          <p>{t('game.error')}</p>
          <small dir="ltr">{v.error}</small>
          <button class="btn" onClick={onExit}>{t('back')}</button>
        </div>
      )}

      {v && v.loading >= 1 && (
        <>
          <header class="hud-top">
            <button class="icon-btn" onClick={onExit} aria-label={t('back')} title={t('back')}>
              <Icon.back class="flip" />
            </button>
            <span class={`pill glass ${painting ? 'paint' : v.locked ? 'locked' : ''}`}>
              <span class="dot" />
              {painting ? t('hud.paint') : v.locked ? t('hud.locked') : t('hud.practice')}
            </span>
            {fpsOn && <span class="fps glass">{v.fps} FPS</span>}
            <span class="spacer" />
            <button class="camo-btn" onClick={() => g?.camoScore()} title={t('hud.camo_hint')}>
              <Icon.target size={20} />
              {t('hud.camo')}
              <span class="score">{v.camo !== null ? v.camo : '–'}</span>
            </button>
            <button class="icon-btn" onClick={() => setShowSettings(true)} aria-label={t('menu.settings')} title={t('menu.settings')}>
              <Icon.gear />
            </button>
          </header>

          {!painting && !touch && (
            <div class="key-hints">
              <Kbd k={['W', 'A', 'S', 'D']} label={t('keys.move')} />
              <Kbd k={['Space']} label={t('keys.jump')} />
              <Kbd k={['Shift']} label={t('keys.run')} />
              <Kbd k={['Tab']} label={t('keys.paint')} />
              <Kbd k={['Q']} label={t('keys.pose')} />
              <Kbd k={['F']} label={t('keys.lock')} />
            </div>
          )}
          {painting && !touch && (
            <div class="key-hints" style={{ insetInlineStart: 'auto', insetInlineEnd: '14px', justifyContent: 'flex-end' }}>
              <Kbd k={['LMB']} label={t('keys.paintStroke')} />
              <Kbd k={['RMB']} label={t('keys.orbit')} />
              <Kbd k={['E']} label={t('keys.eyedrop')} />
              <Kbd k={['Ctrl', 'Z']} label={t('hide.undo')} />
              <Kbd k={['Tab']} label={t('tool3.done')} />
            </div>
          )}

          {!painting && (
            <div class="action-bar">
              {touch && (
                <>
                  <div class="slot">
                    <button class="icon-btn" onClick={() => g?.input.emit('crouch')} aria-label={t('keys.crouch')}><Icon.crouch /></button>
                  </div>
                  <div class="slot">
                    <button class="icon-btn" style={{ width: '64px', height: '64px' }} onClick={() => g?.input.emit('jump')} aria-label={t('keys.jump')}><Icon.jump size={28} /></button>
                  </div>
                </>
              )}
              <div class="slot">
                <button class={`icon-btn ${v.locked ? 'on' : ''}`} onClick={() => g?.toggleLock()} aria-label={t('hud.lock')} title={t('hud.lock')}>
                  {v.locked ? <Icon.lock /> : <Icon.unlock />}
                </button>
                <span>{t('hud.lock')}</span>
              </div>
              <div class="slot">
                <button class="icon-btn" onClick={() => setPoses(true)} aria-label={t('hud.pose')} title={t('hud.pose')}><Icon.pose /></button>
                <span>{t('hud.pose')}</span>
              </div>
              <div class="slot">
                <button class="icon-btn big" onClick={() => g?.setMode('paint')} aria-label={t('hud.paint')} title={t('hud.paint')}><Icon.brush size={32} /></button>
                <span>{t('hud.paint')}</span>
              </div>
            </div>
          )}

          {touch && !painting && joy && (
            <div class="joy" style={{ left: `${joy.x0 - joySize / 2}px`, top: `${joy.y0 - joySize / 2}px`, width: `${joySize}px`, height: `${joySize}px` }}>
              <div
                class="knob"
                style={{ transform: `translate(${Math.max(-joySize * 0.4, Math.min(joySize * 0.4, joy.x - joy.x0))}px, ${Math.max(-joySize * 0.4, Math.min(joySize * 0.4, joy.y - joy.y0))}px)` }}
              />
            </div>
          )}

          {painting && (
            <aside class={`paint-dock glass ${collapsed ? 'collapsed' : ''}`} aria-label={t('hud.paint')}>
              <div class="dock-head">
                <h3>{t(`tool3.${v.tool}`)}</h3>
                <button class="icon-btn" onClick={() => setCollapsed((c) => !c)} aria-label={t(collapsed ? 'dock.expand' : 'dock.collapse')} title={t(collapsed ? 'dock.expand' : 'dock.collapse')}>
                  <Icon.chevron style={{ transform: `rotate(${collapsed ? 90 : -90}deg)` }} />
                </button>
              </div>
              {!collapsed && (
                <>
                  <div class="dock-body">
                    <div class="tool-grid">
                      {TOOLS.map((x) => {
                        const I = Icon[x.icon];
                        return (
                          <button key={x.id} class={`tool-btn ${v.tool === x.id ? 'on' : ''}`} onClick={() => g?.setTool(x.id)} aria-label={t(`tool3.${x.id}`)} title={t(`tool3.${x.id}`)}>
                            <I />
                          </button>
                        );
                      })}
                      <button class="tool-btn" disabled={v.snapshotsLeft <= 0} onClick={() => g?.snapshot()} aria-label={t('tool3.snapshot')} title={t('tool3.snapshot')}>
                        <Icon.camera />
                        <span class="badge">{v.snapshotsLeft}</span>
                      </button>
                      <button class={`tool-btn ${v.brush.mirror ? 'on' : ''}`} onClick={() => g?.setBrush({ mirror: !v.brush.mirror })} aria-label={t('tool3.mirror')} title={t('tool3.mirror')}>
                        <Icon.mirror />
                      </button>
                    </div>

                    <ColorWheel color={v.brush.color} onChange={(c) => g?.setColor(c)} onEyedrop={() => g?.setTool('eyedrop')} eyedropLabel={t('tool3.eyedrop')} />

                    <Range label={t('tool.size')} value={v.brush.size} min={0.004} max={0.12} step={0.002} fmt={(x) => `${Math.round(x * 100)} cm`} on={(x) => g?.setBrush({ size: x })} />
                    <Range label={t('tool3.hardness')} value={v.brush.hardness} min={0} max={1} step={0.05} fmt={pct} on={(x) => g?.setBrush({ hardness: x })} />
                    <Range label={t('tool.opacity')} value={v.brush.opacity} min={0.05} max={1} step={0.05} fmt={pct} on={(x) => g?.setBrush({ opacity: x })} />

                    {v.tool === 'pattern' && (
                      <>
                        <p class="section-title">{t('tool3.pattern')}</p>
                        <div class="pattern-row">
                          {PATTERNS.map((p) => (
                            <button key={p} class={v.brush.pattern === p ? 'on' : ''} onClick={() => g?.setBrush({ pattern: p })}>{t(`pat.${p}`)}</button>
                          ))}
                        </div>
                        <Range label={t('tool3.scale')} value={v.brush.patternScale} min={0.008} max={0.12} step={0.002} fmt={(x) => `${Math.round(x * 100)} cm`} on={(x) => g?.setBrush({ patternScale: x })} />
                        <Range label={t('tool3.angle')} value={v.brush.patternAngle} min={0} max={3.14} step={0.05} fmt={(x) => `${Math.round((x * 180) / Math.PI)}°`} on={(x) => g?.setBrush({ patternAngle: x })} />
                      </>
                    )}

                    <p class="section-title">{t('tool3.finish')}</p>
                    <Range label={t('tool3.gloss')} value={1 - finish.rough} min={0} max={1} step={0.05} fmt={pct} on={(x) => { setFinish((f) => ({ ...f, rough: 1 - x })); g?.paint.setFinish(1 - x, finish.metal); }} />
                    <Range label={t('tool3.metal')} value={finish.metal} min={0} max={1} step={0.05} fmt={pct} on={(x) => { setFinish((f) => ({ ...f, metal: x })); g?.paint.setFinish(finish.rough, x); }} />

                    <p class="paint-hint">{v.tool === 'eyedrop' ? t('tool3.eyedrop_hint') : v.tool === 'bucket' ? t('tool3.bucket_hint') : t('tool3.paint_hint')}</p>
                  </div>
                  <div class="dock-foot">
                    <button class="icon-btn" disabled={!v.canUndo} onClick={() => g?.action('undo')} aria-label={t('hide.undo')} title={t('hide.undo')}><Icon.undo class="flip" /></button>
                    <button class="icon-btn" disabled={!v.canRedo} onClick={() => g?.action('redo')} aria-label={t('hide.redo')} title={t('hide.redo')}><Icon.redo class="flip" /></button>
                    <button class="icon-btn" onClick={() => g?.clearPaint()} aria-label={t('hide.reset')} title={t('hide.reset')}><Icon.clear /></button>
                    <button class="btn mint" onClick={() => g?.setMode('play')}><Icon.check size={20} />{t('tool3.done')}</button>
                  </div>
                </>
              )}
            </aside>
          )}

          {poses && (
            <div class="pose-scrim" onClick={() => setPoses(false)}>
              <div class="pose-wheel" onClick={(e) => e.stopPropagation()} role="menu" aria-label={t('hud.pose')}>
                <div class="hub glass">
                  <div>
                    {t(`pose.${hoverPose ?? v.pose ?? 'stand'}`)}
                    <small>{t('pose.pick')}</small>
                  </div>
                </div>
                {WHEEL.map(({ p, x, y, i }) => (
                  <button
                    key={p}
                    role="menuitem"
                    class={`pose-item glass ${v.pose === p ? 'on' : ''}`}
                    style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 18}ms` }}
                    aria-label={t(`pose.${p}`)}
                    title={t(`pose.${p}`)}
                    onPointerEnter={() => setHoverPose(p)}
                    onPointerLeave={() => setHoverPose(null)}
                    onFocus={() => setHoverPose(p)}
                    onClick={() => {
                      g?.setPose(p as PoseName);
                      setPoses(false);
                      setHoverPose(null);
                    }}
                  >
                    <img src={`/assets/3d/poses/${p}.webp`} alt="" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
        </>
      )}
    </div>
  );
}
