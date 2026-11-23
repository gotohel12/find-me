import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { Redis } from 'ioredis';
import { type Config } from './config.ts';
import { healthRoutes } from './routes/health.ts';
import { authRoutes } from './routes/auth.ts';
import { todayRoutes } from './routes/today.ts';

export interface Deps {
  config: Config;
  /** null when running without a database */
  db: pg.Pool | null;
  redis: Redis | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: Deps;
  }
}

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function buildApp(config: Config, deps?: Partial<Deps>): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.env === 'test' ? false : { level: config.env === 'production' ? 'info' : 'debug' },
    trustProxy: true,
    bodyLimit: 512 * 1024,
  });
  const db =
    deps?.db !== undefined ? deps.db : config.databaseUrl
      ? new pg.Pool({ connectionString: config.databaseUrl, max: 5, ssl: /sslmode=require|neon\.tech/.test(config.databaseUrl) ? { rejectUnauthorized: true } : undefined })
      : null;
  const redis = deps?.redis !== undefined ? deps.redis : config.redisUrl ? new Redis(config.redisUrl, { maxRetriesPerRequest: 2 }) : null;
  app.decorate('deps', { config, db, redis });

  await app.register(cors, { origin: [config.webOrigin], credentials: false });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute', ...(redis ? { redis } : {}) });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/v1' });
  await app.register(todayRoutes, { prefix: '/v1' });

  // Serve the built web app from the same service (one free Render instance).
  const dist = config.webDist ? resolve(REPO, config.webDist) : null;
  if (dist && existsSync(join(dist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: dist,
      setHeaders(res, path) {
        if (path.includes(`${'/'}assets${'/'}`) && !path.endsWith('.json')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else if (path.endsWith('sw.js') || path.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/v1/') && req.headers.accept?.includes('text/html')) {
        return reply.type('text/html').sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found' });
    });
  }

  app.addHook('onClose', async () => {
    if (deps?.db === undefined && db) await db.end();
    if (deps?.redis === undefined && redis) redis.disconnect();
  });
  return app;
}
