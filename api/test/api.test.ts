/**
 * API integration tests against a real Postgres + Redis (CI services, or `scripts/dev.sh` locally).
 * Uses a throwaway database named findme_test_<pid>.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { dayKey } from '@findme/shared';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { migrate } from '../src/migrate.ts';
import { runDaily } from '../src/jobs/daily.ts';
import type { FastifyInstance } from 'fastify';

const base = loadConfig({ ...process.env, NODE_ENV: 'test' });
const dbName = `findme_test_${process.pid}`;
let app: FastifyInstance;
let admin: pg.Client;

before(async () => {
  admin = new pg.Client({ connectionString: base.databaseUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(base.databaseUrl);
  url.pathname = `/${dbName}`;
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  await migrate(c, () => {});
  assert.deepEqual(await migrate(c, () => {}), [], 'second run applies nothing');
  await runDaily(c);
  await c.end();
  app = await buildApp({ ...base, databaseUrl: url.toString() });
});

after(async () => {
  await app?.close();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

test('health reports postgres and redis', async () => {
  const r = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().ok, true);
});

test('guest signup then /me', async () => {
  const r = await app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { locale: 'ar' } });
  assert.equal(r.statusCode, 200);
  const { token, player } = r.json();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(player.friendCode, /^[A-Z2-9]{6}$/);
  const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${token}` } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().player.id, player.id);
  const bad = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer nope' } });
  assert.equal(bad.statusCode, 401);
});

test('today returns the published scene and a countdown', async () => {
  const r = await app.inject({ method: 'GET', url: '/v1/today' });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.day, dayKey());
  assert.equal(body.scene.id, 's001_toy_shop');
  assert.ok(body.nextReleaseInMs > 0 && body.nextReleaseInMs <= 86_400_000);
  const future = await app.inject({ method: 'GET', url: '/v1/today?day=2999-01-01' });
  assert.equal(future.statusCode, 400, 'no peeking at future scenes');
});
