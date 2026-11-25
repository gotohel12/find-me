import { useEffect, useRef, useState } from 'preact/hooks';
import { useI18n } from '../app.tsx';
import { Game, type GameView } from '../core/game.ts';
import { isTouchDevice } from '../input/input.ts';
import { POSES, type PoseName } from '../gameplay/hider.ts';
import { PATTERNS, type Tool } from '../gameplay/paint.ts';
import { ColorPanel } from './ColorPanel.tsx';

const TOOLS: { id: Tool; icon: string }[] = [
  { id: 'brush', icon: '🖌' },
  { id: 'eyedrop', icon: '💧' },
  { id: 'bucket', icon: '🪣' },
  { id: 'spray', icon: '🌫' },
  { id: 'pattern', icon: '▦' },
  { id: 'line', icon: '╱' },
  { id: 'blur', icon: '☁' },
  { id: 'eraser', icon: '⌫' },
];

export function GameScreen({ mapId, onExit }: { mapId: string; onExit: () => void }) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<Game | null>(null);
  const [v, setV] = useState<GameView | null>(null);
  const [poses, setPoses] = useState(false);
  const [color, setColor] = useState(false);
  const [joy, setJoy] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);
  const [finish, setFinish] = useState({ rough: 0.6, metal: 0 });
  const touch = isTouchDevice();

  useEffect(() => {
    const g = new Game(canvas.current!);
    game.current = g;
    const off = g.on(setV);
    void g.start(mapId);
    let raf = 0;
    const tick = () => {
      setJoy(g.input.joystick);
      raf = requestAnimationFrame(tick);
    };
    if (touch) tick();
    const pose = g.input.onAction((a) => a === 'pose' && setPoses((p) => !p));
    return () => {
      cancelAnimationFrame(raf);
      off();
      pose();
      g.dispose();
    };
  }, [mapId]);

  const g = game.current;
  const painting = v?.mode === 'paint';
  const rgb = v ? `rgb(${v.brush.color.join(',')})` : '#fff';

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
            <button class="icon-btn" onClick={onExit} aria-label={t('back')}>←</button>
            <span class="chip">{painting ? t('hud.paint') : v.locked ? t('hud.locked') : t('hud.practice')}</span>
            <span class="chip dim" dir="ltr">{v.fps} FPS</span>
            <button
              class="btn camo"
              onClick={() => g?.camoScore()}
              title={t('hud.camo_hint')}
            >
              🎯 {t('hud.camo')}{v.camo !== null ? `: ${v.camo}` : ''}
            </button>
          </header>

          {!painting && !touch && <div class="keys" dir="ltr">{t('hud.keys')}</div>}

          {!painting && (
            <div class={`actions ${touch ? 'touch' : ''}`}>
              {touch && (
                <>
                  <button class="round" onClick={() => g?.input.emit('jump')}>⤒</button>
                  <button class="round" onClick={() => g?.input.emit('crouch')}>⤓</button>
                </>
              )}
              <button class="round big" onClick={() => g?.setMode('paint')} aria-label={t('hud.paint')}>🎨</button>
              <button class="round" onClick={() => setPoses(true)} aria-label={t('hud.pose')}>🧍</button>
              <button class={`round ${v.locked ? 'on' : ''}`} onClick={() => g?.toggleLock()} aria-label={t('hud.lock')}>🔒</button>
            </div>
          )}

          {touch && !painting && joy && (
            <div class="joy" style={{ left: `${joy.x0 - 60}px`, top: `${joy.y0 - 60}px` }}>
              <div class="knob" style={{ transform: `translate(${Math.max(-50, Math.min(50, joy.x - joy.x0))}px, ${Math.max(-50, Math.min(50, joy.y - joy.y0))}px)` }} />
            </div>
          )}

          {painting && (
            <aside class="paint-panel">
              <div class="tools">
                {TOOLS.map((x) => (
                  <button key={x.id} class={`tool ${v.tool === x.id ? 'on' : ''}`} onClick={() => g?.setTool(x.id)} title={t(`tool3.${x.id}`)}>
                    <span class="ti">{x.icon}</span>
                    <span class="tl">{t(`tool3.${x.id}`)}</span>
                  </button>
                ))}
                <button class="tool" disabled={v.snapshotsLeft <= 0} onClick={() => g?.snapshot()} title={t('tool3.snapshot')}>
                  <span class="ti">📸</span>
                  <span class="tl">{t('tool3.snapshot')} ×{v.snapshotsLeft}</span>
                </button>
              </div>
              <div class="opts">
                <button class="swatch" style={{ background: rgb }} onClick={() => setColor(true)} aria-label={t('color')} />
                <label class="slider">
                  {t('tool.size')}
                  <input type="range" min={0.004} max={0.12} step={0.002} value={v.brush.size} onInput={(e) => g?.setBrush({ size: +(e.target as HTMLInputElement).value })} />
                </label>
                <label class="slider">
                  {t('tool3.hardness')}
                  <input type="range" min={0} max={1} step={0.05} value={v.brush.hardness} onInput={(e) => g?.setBrush({ hardness: +(e.target as HTMLInputElement).value })} />
                </label>
                <label class="slider">
                  {t('tool.opacity')}
                  <input type="range" min={0.05} max={1} step={0.05} value={v.brush.opacity} onInput={(e) => g?.setBrush({ opacity: +(e.target as HTMLInputElement).value })} />
                </label>
                <label class="toggle">
                  <input type="checkbox" checked={v.brush.mirror} onChange={(e) => g?.setBrush({ mirror: (e.target as HTMLInputElement).checked })} />
                  {t('tool3.mirror')}
                </label>
                {v.tool === 'pattern' && (
                  <>
                    <select value={v.brush.pattern} onChange={(e) => g?.setBrush({ pattern: (e.target as HTMLSelectElement).value as typeof v.brush.pattern })}>
                      {PATTERNS.map((p) => (
                        <option key={p} value={p}>{t(`pat.${p}`)}</option>
                      ))}
                    </select>
                    <label class="slider">
                      {t('tool3.scale')}
                      <input type="range" min={0.008} max={0.12} step={0.002} value={v.brush.patternScale} onInput={(e) => g?.setBrush({ patternScale: +(e.target as HTMLInputElement).value })} />
                    </label>
                    <label class="slider">
                      {t('tool3.angle')}
                      <input type="range" min={0} max={3.14} step={0.05} value={v.brush.patternAngle} onInput={(e) => g?.setBrush({ patternAngle: +(e.target as HTMLInputElement).value })} />
                    </label>
                  </>
                )}
                <label class="slider">
                  {t('tool3.gloss')}
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={1 - finish.rough}
                    onInput={(e) => {
                      const rough = 1 - +(e.target as HTMLInputElement).value;
                      setFinish((f) => ({ ...f, rough }));
                      g?.paint.setFinish(rough, finish.metal);
                    }}
                  />
                </label>
                <label class="slider">
                  {t('tool3.metal')}
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={finish.metal}
                    onInput={(e) => {
                      const metal = +(e.target as HTMLInputElement).value;
                      setFinish((f) => ({ ...f, metal }));
                      g?.paint.setFinish(finish.rough, metal);
                    }}
                  />
                </label>
                <button class="icon-btn" disabled={!v.canUndo} onClick={() => g?.action('undo')} aria-label={t('hide.undo')}>↶</button>
                <button class="icon-btn" disabled={!v.canRedo} onClick={() => g?.action('redo')} aria-label={t('hide.redo')}>↷</button>
                <button class="icon-btn" onClick={() => g?.clearPaint()} aria-label={t('hide.reset')}>⟲</button>
                <button class="btn done" onClick={() => g?.setMode('play')}>{t('tool3.done')}</button>
              </div>
              <p class="paint-hint">{v.tool === 'eyedrop' ? t('tool3.eyedrop_hint') : v.tool === 'bucket' ? t('tool3.bucket_hint') : t('tool3.paint_hint')}</p>
            </aside>
          )}

          {poses && (
            <div class="sheet" onClick={() => setPoses(false)}>
              <div class="pose-grid" onClick={(e) => e.stopPropagation()}>
                {POSES.map((p) => (
                  <button
                    key={p}
                    class={`pose ${v.pose === p ? 'on' : ''}`}
                    onClick={() => {
                      g?.setPose(p as PoseName);
                      setPoses(false);
                    }}
                  >
                    <img src={`/assets/3d/poses/${p}.webp`} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                    <span>{t(`pose.${p}`)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {color && (
            <ColorPanel
              color={v.brush.color}
              onPick={(c) => g?.setColor(c)}
              onEyedrop={() => {
                g?.setTool('eyedrop');
                setColor(false);
              }}
              onClose={() => setColor(false)}
            />
          )}
        </>
      )}
    </div>
  );
}
