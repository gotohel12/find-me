import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { MAX_WRONG_TAPS, SEEK_TIME_LIMIT_MS, WRONG_TAP_PENALTY_MS, isHit, seekPoints, tapTolerance } from '@findme/shared';
import { useI18n } from '../app.tsx';
import type { HideResult } from './Hide.tsx';
import { characterDepth, composeCharacter, drawContactShadow, isOccluded } from '../game/compose.ts';
import { View } from '../game/view.ts';
import { sfx } from '../game/sfx.ts';

type Phase = 'seeking' | 'found' | 'missed';

/**
 * Local seek (pass-and-play). The image is composited once (scene + painted
 * character), like the server does, so nothing in the page reveals the position.
 */
export function Seek({ hide, onAgain, onHome }: { hide: HideResult; onAgain: () => void; onHome: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View | null>(null);
  const [phase, setPhase] = useState<Phase>('seeking');
  const [misses, setMisses] = useState(0);
  const [penalty, setPenalty] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [hint, setHint] = useState(false);
  const [shake, setShake] = useState(false);
  const [ripples, setRipples] = useState<{ x: number; y: number; id: number }[]>([]);
  const start = useRef(performance.now());
  const st = useRef({ phase, misses, penalty, hint, ripples });
  st.current = { phase, misses, penalty, hint, ripples };
  const { scene, sprite, placement, paint } = hide;

  // Bake the seek image once.
  const baked = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = scene.meta.width;
    c.height = scene.meta.height;
    const g = c.getContext('2d')!;
    g.drawImage(scene.image, 0, 0, c.width, c.height);
    drawContactShadow(g, sprite, placement);
    const layer = composeCharacter(scene, sprite, placement, paint);
    g.drawImage(layer.canvas, layer.x, layer.y);
    return c;
  }, []);
  const heightPx = useMemo(() => {
    let top = sprite.size;
    let bottom = 0;
    for (let i = 0; i < sprite.mask.data.length; i++) {
      if (sprite.mask.data[i]) {
        const y = Math.floor(i / sprite.size);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    return (bottom - top) * placement.scale;
  }, []);

  const redraw = () => {
    const v = viewRef.current;
    const c = ref.current;
    if (!v || !c) return;
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#120d2c';
    g.fillRect(0, 0, c.width, c.height);
    v.apply(g);
    g.drawImage(baked, 0, 0);
    const s = st.current;
    if (s.hint && s.phase === 'seeking') {
      const qx = placement.x < scene.meta.width / 2 ? 0 : scene.meta.width / 2;
      const qy = placement.y < scene.meta.height / 2 ? 0 : scene.meta.height / 2;
      g.fillStyle = 'rgba(10,6,30,.45)';
      g.fillRect(0, 0, scene.meta.width, scene.meta.height);
      g.drawImage(baked, qx, qy, scene.meta.width / 2, scene.meta.height / 2, qx, qy, scene.meta.width / 2, scene.meta.height / 2);
    }
    if (s.phase !== 'seeking') {
      const cy = placement.y - heightPx / 2;
      g.strokeStyle = s.phase === 'found' ? '#19c3b1' : '#ff4f8b';
      g.lineWidth = 6 / v.scale;
      g.beginPath();
      g.arc(placement.x, cy, heightPx * 0.75, 0, Math.PI * 2);
      g.stroke();
    }
    for (const r of s.ripples) {
      g.strokeStyle = 'rgba(255,255,255,.8)';
      g.lineWidth = 3 / v.scale;
      g.beginPath();
      g.arc(r.x, r.y, 18 / v.cssPerScene, 0, Math.PI * 2);
      g.stroke();
    }
  };

  useEffect(() => {
    const v = new View(
      ref.current!,
      scene.meta.width,
      scene.meta.height,
      {
        onTap: (x, y) => {
          const s = st.current;
          if (s.phase !== 'seeking') return;
          const cd = characterDepth(scene, placement);
          const hit = isHit(placement, { mask: sprite.mask, anchorX: sprite.anchor[0], anchorY: sprite.anchor[1] }, x, y, {
            tolerancePx: tapTolerance(heightPx),
            occluded: (px, py) => isOccluded(scene, px, py, cd),
          });
          const id = Date.now();
          setRipples((r) => [...r, { x, y, id }]);
          setTimeout(() => setRipples((r) => r.filter((q) => q.id !== id)), 450);
          if (hit) {
            setElapsed(performance.now() - start.current + s.penalty);
            setPhase('found');
            sfx.found();
            v.focus(placement.x, placement.y - heightPx / 2, 2.5);
          } else {
            sfx.miss();
            setShake(true);
            setTimeout(() => setShake(false), 350);
            const m = s.misses + 1;
            setMisses(m);
            setPenalty((p) => p + WRONG_TAP_PENALTY_MS);
            if (m >= MAX_WRONG_TAPS) reveal(v);
          }
        },
      },
      () => redraw(),
    );
    viewRef.current = v;
    const ro = new ResizeObserver(() => v.resize());
    ro.observe(ref.current!);
    return () => {
      ro.disconnect();
      v.destroy();
    };
  }, []);

  const reveal = (v: View | null) => {
    setPhase('missed');
    sfx.notFound();
    v?.focus(placement.x, placement.y - heightPx / 2, 2.5);
  };

  // Timer
  useEffect(() => {
    if (phase !== 'seeking') return;
    const id = setInterval(() => {
      const e = performance.now() - start.current + st.current.penalty;
      setElapsed(e);
      const leftMs = SEEK_TIME_LIMIT_MS - e;
      if (leftMs <= 10_000 && leftMs > 0) sfx.tick();
      if (leftMs <= 0) reveal(viewRef.current);
    }, 250);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    redraw();
  });

  const leftS = Math.max(0, Math.ceil((SEEK_TIME_LIMIT_MS - elapsed) / 1000));
  const points =
    phase === 'found' ? seekPoints({ found: true, elapsedMs: elapsed, wrongTaps: misses, hintUsed: hint }) : 0;

  return (
    <div class={`seek-screen ${shake ? 'shake' : ''}`}>
      <header class="ed-top">
        <button class="icon-btn" onClick={onHome} aria-label={t('back')}>←</button>
        <div class="timebar" aria-label={t('seek.left', { s: leftS })}>
          <div class="timebar-fill" style={{ width: `${(leftS / 60) * 100}%` }} />
          <span>{t('seek.left', { s: leftS })}</span>
        </div>
        <div class="misses" aria-label={t('seek.misses')}>
          {[0, 1, 2].map((i) => (
            <span key={i} class={`dot ${i < misses ? 'x' : ''}`} />
          ))}
        </div>
      </header>
      <div class="ed-canvas-wrap">
        <canvas ref={ref} class="ed-canvas" />
        {phase === 'seeking' && (
          <div class="zoom-btns">
            <button class="icon-btn" onClick={() => viewRef.current?.zoomBy(1.4)}>＋</button>
            <button class="icon-btn" onClick={() => viewRef.current?.zoomBy(1 / 1.4)}>－</button>
            <button class="icon-btn" disabled={hint} onClick={() => { setHint(true); sfx.tap(); }} aria-label={t('seek.hint')}>💡</button>
          </div>
        )}
        {phase !== 'seeking' && (
          <div class={`reveal ${phase}`}>
            <h2>{phase === 'found' ? t('seek.found') : t('seek.notfound')}</h2>
            {phase === 'found' && (
              <p>
                {t('seek.time', { s: (elapsed / 1000).toFixed(1) })} · {points} pts
              </p>
            )}
            <div class="row">
              <button class="btn" onClick={onAgain}>{t('seek.again')}</button>
              <button class="btn ghost" onClick={onHome}>{t('seek.home')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
