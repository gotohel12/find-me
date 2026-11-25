import { useEffect, useRef, useState } from 'preact/hooks';
import { hsvToRgb, rgbToHex, hexToRgb } from '@findme/shared';
import { useI18n } from '../app.tsx';

const RECENT_KEY = 'findme.recentColors';

function rgbToHsv([r, g, b]: [number, number, number]): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max ? d / max : 0, max];
}

export function ColorPanel({
  color,
  onPick,
  onEyedrop,
  onClose,
}: {
  color: [number, number, number];
  onPick: (c: [number, number, number]) => void;
  onEyedrop: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [hsv, setHsv] = useState(() => rgbToHsv(color));
  const [hex, setHex] = useState(() => rgbToHex(color));
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    } catch {
      return [];
    }
  });
  const sv = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = sv.current!;
    const g = c.getContext('2d')!;
    const [r, gg, b] = hsvToRgb(hsv[0], 1, 1);
    g.fillStyle = `rgb(${r},${gg},${b})`;
    g.fillRect(0, 0, c.width, c.height);
    const w = g.createLinearGradient(0, 0, c.width, 0);
    w.addColorStop(0, '#fff');
    w.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = w;
    g.fillRect(0, 0, c.width, c.height);
    const k = g.createLinearGradient(0, 0, 0, c.height);
    k.addColorStop(0, 'rgba(0,0,0,0)');
    k.addColorStop(1, '#000');
    g.fillStyle = k;
    g.fillRect(0, 0, c.width, c.height);
  }, [hsv[0]]);

  const commit = (h: number, s: number, v: number) => {
    setHsv([h, s, v]);
    const rgb = hsvToRgb(h, s, v);
    setHex(rgbToHex(rgb));
    onPick(rgb);
  };
  const remember = (x: string) => {
    const next = [x, ...recent.filter((c) => c !== x)].slice(0, 16);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const onSV = (e: PointerEvent) => {
    if (e.type === 'pointermove' && e.buttons === 0) return;
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    commit(hsv[0], Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  };

  return (
    <div class="sheet" onClick={() => (remember(hex), onClose())}>
      <div class="color-panel" onClick={(e) => e.stopPropagation()}>
        <canvas ref={sv} width={260} height={160} class="sv" onPointerDown={onSV} onPointerMove={onSV} />
        <input type="range" class="hue" min={0} max={1} step={0.002} value={hsv[0]} onInput={(e) => commit(+(e.target as HTMLInputElement).value, hsv[1], hsv[2])} />
        <div class="hex-row">
          <span class="swatch big" style={{ background: hex }} />
          <input
            class="hex"
            dir="ltr"
            value={hex}
            onChange={(e) => {
              const x = (e.target as HTMLInputElement).value.trim();
              if (/^#?[0-9a-f]{6}$/i.test(x)) {
                const rgb = hexToRgb(x);
                setHsv(rgbToHsv(rgb));
                setHex(rgbToHex(rgb));
                onPick(rgb);
              }
            }}
          />
          <button class="icon-btn" onClick={onEyedrop} aria-label={t('tool3.eyedrop')}>💧</button>
        </div>
        {recent.length > 0 && (
          <div class="recent">
            {recent.map((c) => (
              <button key={c} class="swatch" style={{ background: c }} onClick={() => { const rgb = hexToRgb(c); setHsv(rgbToHsv(rgb)); setHex(c); onPick(rgb); }} />
            ))}
          </div>
        )}
        <button class="btn" onClick={() => (remember(hex), onClose())}>{t('tool3.done')}</button>
      </div>
    </div>
  );
}
