import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import { migrate } from './migrate.ts';
import pg from 'pg';

const config = loadConfig();
// Apply DB migrations on boot (no separate pre-deploy step on the free plan).
if (config.databaseUrl) {
  const c = new pg.Client({ connectionString: config.databaseUrl });
  try {
    await c.connect();
    await migrate(c);
  } catch (e) {
    console.error('migration failed, starting without them:', (e as Error).message);
  } finally {
    await c.end().catch(() => {});
  }
}
const app = await buildApp(config);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.port, host: config.host });
app.log.info('FIND ME / لقني — Developed by Mohsen ~ Danial. © 2026 MD Studio. All rights reserved.');
