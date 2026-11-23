/**
 * Minimal migration runner: applies api/migrations/*.sql in filename order,
 * each once, each in its own transaction. Safe to run on every deploy.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadConfig } from './config.ts';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate(client: pg.ClientBase, log: (m: string) => void = console.log): Promise<string[]> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  // One migrator at a time across instances.
  await client.query('SELECT pg_advisory_lock(727001)');
  try {
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(join(DIR, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${f} failed: ${(e as Error).message}`);
      }
      applied.push(f);
      log(`applied ${f}`);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const client = new pg.Client({ connectionString: loadConfig().databaseUrl });
  await client.connect();
  try {
    const applied = await migrate(client);
    console.log(applied.length ? `${applied.length} migration(s) applied` : 'database up to date');
  } finally {
    await client.end();
  }
}
