/** Hue ring + saturation/value square, hex input, recent colours. Inline in the paint dock. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { hsvToRgb, rgbToHex, hexToRgb } from '@findme/shared';
import { Icon } from './icons.tsx';

const RECENT_KEY = 'findme.recentColors';
type RGB = [number, number, number];

export function rgbToHsv([r, g, b]: RGB): [number, number, number] {
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

export function useRecentColors() {
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    } catch {
      return [];
    }
  });
  const remember = (hex: string) => {
    setRecent((r) => {
      const next = [hex, ...r.filter((c) => c !== hex)].slice(0, 16);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  return { recent, remember };
}

export function ColorWheel({ color, onChange, onEyedrop, eyedropLabel }: { color: RGB; onChange: (c: RGB) => void; onEyedrop: () => void; eyedropLabel: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hsv, setHsv] = useState(() => rgbToHsv(color));
  const [hex, setHex] = useState(() => rgbToHex(color));
  const { recent, remember } = useRecentColors();
  const drag = useRef<'ring' | 'sv' | null>(null);
  const S = 210;
  const R1 = S / 2 - 2;
  const R0 = R1 - 22;
  const Q = (R0 - 6) * Math.SQRT1_2; // half size of the inner square

  // follow external changes (eyedropper)
  useEffect(() => {
    const h = rgbToHex(color);
    if (h !== hex) {
      setHex(h);
      setHsv((old) => {
        const n = rgbToHsv(color);
        return n[1] < 0.01 ? [old[0], n[1], n[2]] : n;
      });
      remember(h);
    }
  }, [color[0], color[1], color[2]]);

  useEffect(() => {
    const c = ref.current!;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    c.width = S * dpr;
    c.height = S * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    const cx = S / 2;
    for (let a = 0; a < 360; a += 1) {
      g.beginPath();
      g.strokeStyle = `hsl(${a}, 100%, 50%)`;
      g.lineWidth = R1 - R0;
      g.arc(cx, cx, (R0 + R1) / 2, ((a - 90.6) * Math.PI) / 180, ((a - 89) * Math.PI) / 180);
      g.stroke();
    }
    const [r, gg, b] = hsvToRgb(hsv[0], 1, 1);
    g.fillStyle = `rgb(${r},${gg},${b})`;
    g.fillRect(cx - Q, cx - Q, Q * 2, Q * 2);
    const w = g.createLinearGradient(cx - Q, 0, cx + Q, 0);
    w.addColorStop(0, '#fff');
    w.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = w;
    g.fillRect(cx - Q, cx - Q, Q * 2, Q * 2);
    const k = g.createLinearGradient(0, cx - Q, 0, cx + Q);
    k.addColorStop(0, 'rgba(0,0,0,0)');
    k.addColorStop(1, '#000');
    g.fillStyle = k;
    g.fillRect(cx - Q, cx - Q, Q * 2, Q * 2);
  }, [hsv[0]]);

  const commit = (h: number, s: number, v: number) => {
    setHsv([h, s, v]);
    const rgb = hsvToRgb(h, s, v);
    setHex(rgbToHex(rgb));
    onChange(rgb);
  };

  const at = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * S - S / 2;
    const y = ((e.clientY - r.top) / r.height) * S - S / 2;
    return { x, y };
  };
  const onDown = (e: PointerEvent) => {
    const { x, y } = at(e);
    const d = Math.hypot(x, y);
    drag.current = d >= R0 - 4 ? 'ring' : Math.abs(x) <= Q + 4 && Math.abs(y) <= Q + 4 ? 'sv' : null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onMove(e);
  };
  const onMove = (e: PointerEvent) => {
    if (!drag.current) return;
    const { x, y } = at(e);
    if (drag.current === 'ring') {
      let h = Math.atan2(x, -y) / (Math.PI * 2);
      if (h < 0) h += 1;
      commit(h, hsv[1], hsv[2]);
    } else {
      commit(hsv[0], Math.min(1, Math.max(0, (x + Q) / (2 * Q))), 1 - Math.min(1, Math.max(0, (y + Q) / (2 * Q))));
    }
  };
  const onUp = () => {
    if (drag.current) remember(hex);
    drag.current = null;
  };

  const ringA = hsv[0] * Math.PI * 2;
  const rk = (R0 + R1) / 2;
  return (
    <div class="color-block">
      <div class="wheel-wrap" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <canvas ref={ref} />
        <span class="knob" style={{ left: `${((S / 2 + Math.sin(ringA) * rk) / S) * 100}%`, top: `${((S / 2 - Math.cos(ringA) * rk) / S) * 100}%` }} />
        <span class="knob" style={{ left: `${((S / 2 - Q + hsv[1] * 2 * Q) / S) * 100}%`, top: `${((S / 2 - Q + (1 - hsv[2]) * 2 * Q) / S) * 100}%`, background: hex }} />
      </div>
      <div class="hex-row">
        <span class="sw" style={{ background: hex }} />
        <input
          value={hex}
          aria-label="hex"
          onChange={(e) => {
            const x = (e.target as HTMLInputElement).value.trim();
            if (/^#?[0-9a-f]{6}$/i.test(x)) {
              const rgb = hexToRgb(x);
              setHsv(rgbToHsv(rgb));
              setHex(rgbToHex(rgb));
              onChange(rgb);
              remember(rgbToHex(rgb));
            }
          }}
        />
        <button class="icon-btn" onClick={onEyedrop} aria-label={eyedropLabel} title={eyedropLabel}>
          <Icon.drop />
        </button>
      </div>
      {recent.length > 0 && (
        <div class="recent-row">
          {recent.map((c) => (
            <button key={c} style={{ background: c }} aria-label={c} onClick={() => { const rgb = hexToRgb(c); setHsv(rgbToHsv(rgb)); setHex(c); onChange(rgb); }} />
          ))}
        </div>
      )}
    </div>
  );
}
