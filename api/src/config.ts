/** Runtime configuration. Every secret comes from environment variables (Render env vars in production). */
export interface Config {
  port: number;
  host: string;
  /** Empty = run without a database (today's scene still works). */
  databaseUrl: string | null;
  /** Empty = in-memory rate limits. */
  redisUrl: string | null;
  /** Built web app to serve (same origin as the API). */
  webDist: string | null;
  /** Public URL of the web app, used in challenge links and CORS. */
  webOrigin: string;
  /** Base URL where packed assets are served (CDN in production). */
  assetBase: string;
  adminToken: string | null;
  env: 'development' | 'test' | 'production';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = (env.NODE_ENV ?? 'development') as Config['env'];
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL || (mode === 'production' ? null : 'postgres://postgres@localhost:5432/findme'),
    redisUrl: env.REDIS_URL || null,
    webDist: env.WEB_DIST ?? (mode === 'production' ? 'web/dist' : null),
    webOrigin: env.WEB_ORIGIN ?? env.RENDER_EXTERNAL_URL ?? 'http://localhost:5173',
    assetBase: env.ASSET_BASE ?? '/assets',
    adminToken: env.ADMIN_TOKEN || null,
    env: mode,
  };
}
