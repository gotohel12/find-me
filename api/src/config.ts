/** Runtime configuration. Every secret comes from environment variables (Render env vars in production). */
export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  redisUrl: string;
  /** Public URL of the web app, used in challenge links and CORS. */
  webOrigin: string;
  /** Base URL where packed assets are served (CDN in production). */
  assetBase: string;
  adminToken: string | null;
  env: 'development' | 'test' | 'production';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = (env.NODE_ENV ?? 'development') as Config['env'];
  const need = (k: string, dev: string): string => {
    const v = env[k];
    if (v) return v;
    if (mode === 'production') throw new Error(`missing env var ${k}`);
    return dev;
  };
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: need('DATABASE_URL', 'postgres://postgres@localhost:5432/findme'),
    redisUrl: need('REDIS_URL', 'redis://localhost:6379'),
    webOrigin: need('WEB_ORIGIN', 'http://localhost:5173'),
    assetBase: need('ASSET_BASE', 'http://localhost:5173/assets'),
    adminToken: env.ADMIN_TOKEN || null,
    env: mode,
  };
}
