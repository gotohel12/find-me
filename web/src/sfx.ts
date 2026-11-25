/** Synthesized sound effects (WebAudio, original, no audio files) + haptics. */
let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean) {
  muted = m;
}

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.15, slide = 0, delay = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol = 0.12, hp = 800) {
  const a = ac();
  if (!a) return;
  const n = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = a.createBufferSource();
  s.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = a.createGain();
  g.gain.value = vol;
  s.connect(f).connect(g).connect(a.destination);
  s.start();
}

function buzz(ms: number | number[]) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}

export const sfx = {
  tap: () => tone(660, 0.05, 'triangle', 0.08),
  blip: () => tone(1200, 0.07, 'sine', 0.1, 400),
  splash: () => noise(0.18, 0.1, 1500),
  thunk: () => tone(140, 0.12, 'square', 0.08, -60),
  whoosh: () => noise(0.22, 0.08, 400),
  brush: () => noise(0.05, 0.03, 3000),
  submit: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.12, 0, i * 0.09)),
  tick: () => tone(1800, 0.03, 'square', 0.04),
  miss: () => {
    tone(300, 0.25, 'sine', 0.15, -180);
    buzz(80);
  },
  found: () => {
    tone(880, 0.12, 'triangle', 0.15, 600);
    tone(1320, 0.3, 'sine', 0.1, 0, 0.08);
    noise(0.15, 0.05, 5000);
    buzz([30, 40, 60]);
  },
  notFound: () => [392, 370, 311].forEach((f, i) => tone(f, 0.35, 'sawtooth', 0.06, 0, i * 0.28)),
};
