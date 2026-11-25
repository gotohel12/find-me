/** Player settings: saved per device, applied live. */
import { isTouchDevice } from '../input/input.ts';

export interface Settings {
  mouseSens: number; // 0.05..5 (1 = a 30 cm swipe at 800 DPI ≈ one full turn)
  mouseX: number; // multiplier
  mouseY: number;
  invertY: boolean;
  touchSens: number; // 0.05..5
  touchX: number;
  touchY: number;
  paintOrbitSens: number;
  paintZoomSpeed: number;
  padSens: number;
  padCurve: 'linear' | 'exponential';
  deadZone: number; // 0..0.4
  joystick: 'dynamic' | 'fixed';
  joystickSize: number; // px
  fov: number;
  cameraDistance: number;
  cameraSmoothing: boolean;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  reduceMotion: boolean;
  showFps: boolean;
}

export const DEFAULTS: Settings = {
  mouseSens: 1,
  mouseX: 1,
  mouseY: 1,
  invertY: false,
  touchSens: 1,
  touchX: 1,
  touchY: 0.8,
  paintOrbitSens: 1,
  paintZoomSpeed: 1,
  padSens: 1,
  padCurve: 'exponential',
  deadZone: 0.1,
  joystick: 'dynamic',
  joystickSize: 120,
  fov: isTouchDevice() ? 75 : 70,
  cameraDistance: 2.6,
  cameraSmoothing: false,
  masterVolume: 0.8,
  sfxVolume: 1,
  musicVolume: 0.5,
  reduceMotion: false,
  showFps: false,
};

const KEY = 'findme.settings.v1';
let current: Settings = load();
const subs = new Set<(s: Settings) => void>();

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = {
  get: () => current,
  set(patch: Partial<Settings>) {
    current = { ...current, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      /* private mode */
    }
    subs.forEach((f) => f(current));
  },
  reset() {
    this.set({ ...DEFAULTS });
  },
  subscribe(f: (s: Settings) => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
};

/** Radians per mouse count at sensitivity 1: 2π over ~9450 counts (30 cm at 800 DPI). */
export const MOUSE_BASE = (Math.PI * 2) / 9450;
/** Radians per CSS pixel of finger drag at sensitivity 1 (a full-width swipe ≈ 180°). */
export const TOUCH_BASE = Math.PI / 900;
