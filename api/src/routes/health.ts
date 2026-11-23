import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    const { db, redis } = app.deps;
    const [pgOk, redisOk] = await Promise.all([
      db.query('SELECT 1').then(() => true, () => false),
      redis.ping().then((r) => r === 'PONG', () => false),
    ]);
    const ok = pgOk && redisOk;
    return reply.code(ok ? 200 : 503).send({ ok, postgres: pgOk, redis: redisOk, credit: 'Mohsen ~ Danial' });
  });
}
