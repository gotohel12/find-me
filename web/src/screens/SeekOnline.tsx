import { useEffect, useRef, useState } from 'preact/hooks';
import { MAX_WRONG_TAPS, SEEK_TIME_LIMIT_MS, emojiRow, type SeekResult } from '@findme/shared';
import { useI18n } from '../app.tsx';
import { api, type TapResult } from '../api.ts';
import { View } from '../game/view.ts';
import { sfx } from '../game/sfx.ts';

/**
 * Online seek: 5 hides from other players (or seed hides). The server sends only a
 * composited image and decides hit/miss, so nothing in the page reveals the position.
 */
export function SeekOnline({ challenge, onHome, onHide }: { challenge?: string; onHome: () => void; onHide: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View | null>(null);
  const [session, setSession] = useState<{ id: string; hides: { id: string; image: string }[] } | null>(null);
  const [idx, setIdx] = useState(0);
  const [img, setImg] = useState<ImageBitmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [misses, setMisses] = useState(0);
  const [penalty, setPenalty] = useState(0);
  const [startAt, setStartAt] = useState(0);
  const [now, setNow] = useState(0);
  const [result, setResult] = useState<TapResult | null>(null);
  const [hint, setHint] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SeekResult[]>([]);
  const [shake, setShake] = useState(false);
  const st = useRef({ img, result, hint, busy, session, idx });
  st.current = { img, result, hint, busy, session, idx };

  useEffect(() => {
    api.seekStart(challenge).then(
      (s) => setSession({ id: s.session, hides: s.hides }),
      () => setError(t('seek.none')),
    );
  }, []);

  // Load each hide's image (this starts the server clock for that hide).
  useEffect(() => {
    if (!session || idx >= session.hides.length) return;
    setImg(null);
    setResult(null);
    setHint(null);
    setMisses(0);
    setPenalty(0);
    api
      .seekImage(session.hides[idx].image)
      .then((b) => createImageBitmap(b))
      .then((bm) => {
        const t0 = performance.now();
        setStartAt(t0);
        setNow(t0);
        setImg(bm);
      })
      .catch(() => setError(t('home.error')));
  }, [session, idx]);

  const redraw = () => {
    const v = viewRef.current;
    const c = ref.current;
    const s = st.current;
    if (!v || !c || !s.img) return;
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#120d2c';
    g.fillRect(0, 0, c.width, c.height);
    v.apply(g);
    g.drawImage(s.img, 0, 0);
    if (s.hint && !s.result) {
      g.fillStyle = 'rgba(10,6,30,.45)';
      const hw = s.hint.w / 2;
      const hh = s.hint.h / 2;
      g.fillRect(0, 0, s.hint.w, s.hint.h);
      g.drawImage(s.img, s.hint.x * hw, s.hint.y * hh, hw, hh, s.hint.x * hw, s.hint.y * hh, hw, hh);
    }
    if (s.result?.reveal) {
      const r = s.result.reveal;
      g.strokeStyle = s.result.found ? '#19c3b1' : '#ff4f8b';
      g.lineWidth = 6 / v.scale;
      g.beginPath();
      g.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      g.stroke();
    }
  };

  // (Re)build the viewport for each image.
  useEffect(() => {
    if (!img || !ref.current) return;
    const v = new View(
      ref.current,
      img.width,
      img.height,
      {
        onTap: async (x, y) => {
          const s = st.current;
          if (!s.session || s.result || s.busy) return;
          setBusy(true);
          try {
            const r = await api.tap(s.session.id, s.session.hides[s.idx].id, x, y);
            if (r.done) end(r, v);
            else {
              sfx.miss();
              setShake(true);
              setTimeout(() => setShake(false), 350);
              setMisses(r.misses ?? 0);
              setPenalty(r.penaltyMs ?? 0);
            }
          } finally {
            setBusy(false);
          }
        },
      },
      () => redraw(),
    );
    viewRef.current = v;
    const ro = new ResizeObserver(() => v.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      v.destroy();
    };
  }, [img]);

  const end = (r: TapResult, v: View | null) => {
    setResult(r);
    if (r.found) sfx.found();
    else sfx.notFound();
    if (r.reveal) v?.focus(r.reveal.x, r.reveal.y, 2.5);
    setResults((xs) => [...xs, { found: r.found, elapsedMs: r.elapsedMs ?? SEEK_TIME_LIMIT_MS, wrongTaps: misses, hintUsed: !!hint }]);
  };

  // Clock (display only; the server keeps the real time).
  useEffect(() => {
    if (!img || result) return;
    const id = setInterval(() => {
      setNow(performance.now());
      const e = performance.now() - startAt + penalty;
      const left = SEEK_TIME_LIMIT_MS - e;
      if (left <= 10_000 && left > 0) sfx.tick();
      if (left <= 0 && session && !st.current.busy) {
        clearInterval(id);
        api.giveUp(session.id, session.hides[idx].id).then((r) => end(r, viewRef.current), () => {});
      }
    }, 250);
    return () => clearInterval(id);
  }, [img, result, startAt, penalty]);

  useEffect(() => {
    redraw();
  });

  if (error) {
    return (
      <div class="pass">
        <p>{error}</p>
        <div class="row">
          <button class="btn" onClick={onHide}>{t('home.hide')}</button>
          <button class="btn ghost" onClick={onHome}>{t('seek.home')}</button>
        </div>
      </div>
    );
  }
  if (session && idx >= session.hides.length) {
    const total = results.reduce((s, r) => s + (r.found ? 1 : 0), 0);
    const row = emojiRow(results);
    return (
      <div class="pass">
        <h1>{t('results.title')}</h1>
        <p class="emoji-row" dir="ltr">{row}</p>
        <p>{t('results.found', { n: total, of: results.length })}</p>
        <button class="btn" onClick={() => navigator.clipboard?.writeText(`FIND ME — لقني ${row}\n${location.origin}`)}>
          {t('results.copy')}
        </button>
        <div class="row">
          <button class="btn" onClick={onHide}>{t('home.hide')}</button>
          <button class="btn ghost" onClick={onHome}>{t('seek.home')}</button>
        </div>
      </div>
    );
  }

  const elapsed = img ? now - startAt + penalty : 0;
  const leftS = Math.max(0, Math.ceil((SEEK_TIME_LIMIT_MS - elapsed) / 1000));
  return (
    <div class={`seek-screen ${shake ? 'shake' : ''}`}>
      <header class="ed-top">
        <button class="icon-btn" onClick={onHome} aria-label={t('back')}>←</button>
        <div class="timebar">
          <div class="timebar-fill" style={{ width: `${(leftS / 60) * 100}%` }} />
          <span>
            {session ? `${idx + 1}/${session.hides.length} · ` : ''}
            {t('seek.left', { s: leftS })}
          </span>
        </div>
        <div class="misses" aria-label={t('seek.misses')}>
          {Array.from({ length: MAX_WRONG_TAPS }, (_, i) => (
            <span key={i} class={`dot ${i < misses ? 'x' : ''}`} />
          ))}
        </div>
      </header>
      <div class="ed-canvas-wrap">
        {!img && (
          <div class="pass" aria-busy="true">
            <div class="spinner" />
          </div>
        )}
        <canvas ref={ref} class="ed-canvas" />
        {img && !result && (
          <div class="zoom-btns">
            <button class="icon-btn" onClick={() => viewRef.current?.zoomBy(1.4)}>＋</button>
            <button class="icon-btn" onClick={() => viewRef.current?.zoomBy(1 / 1.4)}>－</button>
            <button
              class="icon-btn"
              disabled={!!hint}
              aria-label={t('seek.hint')}
              onClick={async () => {
                if (!session) return;
                const h = await api.hint(session.id, session.hides[idx].id);
                setHint({ ...h.quadrant, w: h.w, h: h.h });
                sfx.tap();
              }}
            >
              💡
            </button>
          </div>
        )}
        {result && (
          <div class={`reveal ${result.found ? 'found' : 'missed'}`}>
            <h2>{result.found ? t('seek.found') : t('seek.notfound')}</h2>
            {result.found && (
              <p>
                {t('seek.time', { s: ((result.elapsedMs ?? 0) / 1000).toFixed(1) })} · {result.points} pts
                {result.fasterPct !== undefined && ` · ${t('seek.faster', { p: 100 - (result.fasterPct ?? 0) })}`}
              </p>
            )}
            <div class="row">
              <button class="btn" onClick={() => setIdx((i) => i + 1)}>{t('seek.next')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
