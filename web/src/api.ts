/** API client. Guest token lives in localStorage; created on first launch. */
const TOKEN_KEY = 'findme.token';
// In production Render injects the API host; in dev Vite proxies /v1 to the local API.
const HOST = import.meta.env.VITE_API_HOST as string | undefined;
const BASE = HOST ? `https://${HOST}` : '';

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

export const api = {
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
