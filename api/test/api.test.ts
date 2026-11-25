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
  admin = new pg.Client({ connectionString: base.databaseUrl! });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(base.databaseUrl!);
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
  assert.match(body.scene.id, /^s\d{3}_/);
  assert.ok(body.nextReleaseInMs > 0 && body.nextReleaseInMs <= 86_400_000);
  const future = await app.inject({ method: 'GET', url: '/v1/today?day=2999-01-01' });
  assert.equal(future.statusCode, 400, 'no peeking at future scenes');
});

// ---------------------------------------------------------------- online play (real packed assets + sharp)
import { autoHide, loadScene } from '../src/game.ts';
import { PNG_PAINT } from './paint-fixture.ts';

async function guest() {
  const r = await app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { locale: 'en' } });
  return { authorization: `Bearer ${r.json().token}` };
}

test('seek: seed hides appear, image is composited, taps are judged by the server', async () => {
  const h = await guest();
  const start = await app.inject({ method: 'POST', url: '/v1/seek/start', headers: h, payload: {} });
  assert.equal(start.statusCode, 200, start.body);
  const { session, hides } = start.json();
  assert.ok(hides.length >= 1 && hides.length <= 5);
  const img = await app.inject({ method: 'GET', url: hides[0].image, headers: h });
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers['content-type'], 'image/webp');
  assert.ok(img.rawPayload.length > 10_000);
  // a tap far outside the picture is a miss and reveals nothing
  const miss = await app.inject({ method: 'POST', url: `/v1/seek/${session}/${hides[0].id}/tap`, headers: h, payload: { x: -500, y: -500 } });
  assert.equal(miss.json().done, false);
  assert.equal(miss.json().reveal, undefined, 'no position leaks before the end');
  const give = await app.inject({ method: 'POST', url: `/v1/seek/${session}/${hides[0].id}/giveup`, headers: h, payload: {} });
  assert.equal(give.json().done, true);
  assert.ok(give.json().reveal.x > 0);
  // tapping the revealed spot on the next hide's twin is not possible: the attempt is closed
  const again = await app.inject({ method: 'POST', url: `/v1/seek/${session}/${hides[0].id}/tap`, headers: h, payload: { x: 1, y: 1 } });
  assert.equal(again.statusCode, 409);
});

test('hide: a fair hide is accepted, an unfair one is rejected', async () => {
  const h = await guest();
  const today = (await app.inject({ method: 'GET', url: '/v1/today' })).json();
  const scene = await loadScene(today.scene.id, 'landscape');
  const made = await autoHide(scene, 4242);
  assert.ok(made, 'auto-hider found a fair spot');
  const body = {
    sceneId: today.scene.id,
    orientation: 'landscape',
    pose: made!.sprite.pose,
    angle: made!.sprite.angle,
    placement: made!.placement,
    paint: PNG_PAINT,
  };
  const ok = await app.inject({ method: 'POST', url: '/v1/hides', headers: h, payload: body });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.match(ok.json().code, /^[A-Z2-9]{6}$/);
  const bad = await app.inject({
    method: 'POST',
    url: '/v1/hides',
    headers: h,
    payload: { ...body, placement: { ...made!.placement, scale: made!.placement.scale * 5 } },
  });
  assert.equal(bad.statusCode, 422);
  // the leaderboard answers
  const lb = await app.inject({ method: 'GET', url: '/v1/leaderboard?board=seekers' });
  assert.equal(lb.statusCode, 200);
});
