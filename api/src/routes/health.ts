import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    const { db, redis } = app.deps;
    const [pgOk, redisOk] = await Promise.all([
      db ? db.query('SELECT 1').then(() => true, () => false) : Promise.resolve(null),
      redis ? redis.ping().then((r) => r === 'PONG', () => false) : Promise.resolve(null),
    ]);
    // The service is up even without a database; the flags say what is connected.
    return { ok: true, postgres: pgOk, redis: redisOk, game: 'FIND ME / لقني', credit: 'Developed by Mohsen ~ Danial', copyright: '© 2026 MD Studio. All rights reserved.' };
  });
}
