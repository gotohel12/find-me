/** API client. Guest token lives in localStorage; created on first launch. */
const TOKEN_KEY = 'findme.token';
// Same origin in production (one service serves game + API); Vite proxies /v1 in dev.
const BASE = '';

export interface Today {
  day: string;
  isToday: boolean;
  nextReleaseInMs: number;
  previousDay: string;
  scene: { id: string; title: { en: string; ar: string }; assets: { landscape: string; portrait: string } };
}

export interface Player {
  id: string;
  name: string;
  friendCode: string;
  xp?: number;
  streakDays?: number;
}

function token(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const t = token();
  if (t) headers.set('Authorization', `Bearer ${t}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return (await res.json()) as T;
}

export interface TapResult {
  done: boolean;
  found: boolean;
  misses?: number;
  penaltyMs?: number;
  elapsedMs?: number;
  points?: number;
  fasterPct?: number;
  reveal?: { x: number; y: number; r: number };
  hide?: { attempts: number; finds: number };
}

export const api = {
  submitHide: (b: { sceneId: string; orientation: string; pose: string; angle: string; placement: unknown; paint: string }) =>
    call<{ id: string; code: string }>('/v1/hides', { method: 'POST', body: JSON.stringify(b) }),
  seekStart: (challenge?: string) =>
    call<{ session: string; hides: { id: string; ord: number; image: string }[] }>('/v1/seek/start', {
      method: 'POST',
      body: JSON.stringify(challenge ? { challenge } : {}),
    }),
  async seekImage(path: string): Promise<Blob> {
    const t = token();
    const r = await fetch(`${BASE}${path}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.blob();
  },
  tap: (session: string, hide: string, x: number, y: number) =>
    call<TapResult>(`/v1/seek/${session}/${hide}/tap`, { method: 'POST', body: JSON.stringify({ x, y }) }),
  hint: (session: string, hide: string) =>
    call<{ quadrant: { x: number; y: number }; w: number; h: number }>(`/v1/seek/${session}/${hide}/hint`, { method: 'POST', body: '{}' }),
  giveUp: (session: string, hide: string) => call<TapResult>(`/v1/seek/${session}/${hide}/giveup`, { method: 'POST', body: '{}' }),
  leaderboard: (board: 'seekers' | 'hiders') =>
    call<{ rows: { name: string; score: number; attempts?: number; finds?: number }[] }>(`/v1/leaderboard?board=${board}`),

  /** Whether the server has a database (accounts and online hides need one). */
  async hasAccounts(): Promise<boolean> {
    try {
      const r = await fetch(`${BASE}/health`);
      return r.ok && (await r.json()).postgres === true;
    } catch {
      return false;
    }
  },

  me: () => call<{ player: Player }>('/v1/me').then((r) => r.player),
  today: (day?: string) => call<Today>(`/v1/today${day ? `?day=${day}` : ''}`),

  /** Make sure this device has a guest player; returns it. */
  async ensurePlayer(locale: string): Promise<Player> {
    if (token()) {
      try {
        return (await call<{ player: Player }>('/v1/me')).player;
      } catch (e) {
        if ((e as { status?: number }).status !== 401) throw e;
      }
    }
    const r = await call<{ token: string; player: Player }>('/v1/auth/guest', {
      method: 'POST',
      body: JSON.stringify({ locale }),
    });
    try {
      localStorage.setItem(TOKEN_KEY, r.token);
    } catch {
      /* private mode: session-only guest */
    }
    return r.player;
  },
};
