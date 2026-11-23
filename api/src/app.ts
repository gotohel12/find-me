import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import pg from 'pg';
import { Redis } from 'ioredis';
import { type Config } from './config.ts';
import { healthRoutes } from './routes/health.ts';
import { authRoutes } from './routes/auth.ts';
import { todayRoutes } from './routes/today.ts';

export interface Deps {
  config: Config;
  db: pg.Pool;
  redis: Redis;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: Deps;
  }
}

export async function buildApp(config: Config, deps?: Partial<Deps>): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.env === 'test' ? false : { level: config.env === 'production' ? 'info' : 'debug' },
    trustProxy: true,
    bodyLimit: 512 * 1024, // a 256² paint texture as PNG fits comfortably
  });
  const db = deps?.db ?? new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  const redis = deps?.redis ?? new Redis(config.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
  app.decorate('deps', { config, db, redis });

  await app.register(cors, { origin: [config.webOrigin], credentials: false });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute', redis });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/v1' });
  await app.register(todayRoutes, { prefix: '/v1' });

  app.addHook('onClose', async () => {
    if (!deps?.db) await db.end();
    if (!deps?.redis) redis.disconnect();
  });
  return app;
}
