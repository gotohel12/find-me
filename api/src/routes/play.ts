/**
 * Online play: submit hides, seek sessions with server-side hit checks, results.
 * Seekers only ever receive a composited image; the hide position is revealed
 * by the server after the attempt ends.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  MAX_WRONG_TAPS,
  SEEK_TIME_LIMIT_MS,
  WRONG_TAP_PENALTY_MS,
  type Placement,
  dayKey,
  hiderScore,
  makeCode,
  seekPoints,
} from '@findme/shared';
import { playerOf } from '../auth.ts';
import { autoHide, composite, decodePaint, encodePaint, fairness, loadScene, loadSprite, revealPoint, tapHits } from '../game.ts';
import { loadSchedule, sceneForDay } from '../content.ts';

const SEED_TARGET = 12; // seed hides kept available per day (more are made as players use them up)
const BOT_NAMES = ['Ghost', 'Gecko', 'Moth', 'Pebble', 'Lantern', 'شبح', 'وزغ', 'فانوس', 'حصاة', 'ظل', 'Fox', 'ثعلب'];

interface HideRow {
  id: string;
  scene_id: string;
  orientation: string;
  pose: string;
  angle: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flip: boolean;
  paint: Buffer;
  player_id: string;
}

const placementOf = (h: HideRow): Placement => ({ x: h.x, y: h.y, scale: h.scale, rotation: h.rotation, flip: h.flip });

export async function playRoutes(app: FastifyInstance): Promise<void> {
  const schedule = await loadSchedule();
  const imageCache = new Map<string, Buffer>(); // hideId -> webp (small LRU)

  const needDb = (reply: FastifyReply) => reply.code(503).send({ error: 'db_unavailable' });

  async function auth(req: Parameters<typeof playerOf>[1], reply: FastifyReply) {
    const id = await playerOf(app.deps.db, req);
    if (!id) {
      reply.code(401).send({ error: 'no_player' });
      return null;
    }
    return id;
  }

  async function ensureDay(day: string): Promise<string> {
    const db = app.deps.db!;
    const sceneId = sceneForDay(schedule, day);
    await db.query(
      `INSERT INTO scenes(id, title_en, title_ar, theme, asset_version, meta) VALUES ($1, $1, $1, '', 'v1', '{}') ON CONFLICT (id) DO NOTHING`,
      [sceneId],
    );
    const r = await db.query(
      `INSERT INTO daily_scenes(day, scene_id) VALUES ($1, $2) ON CONFLICT (day) DO UPDATE SET day = EXCLUDED.day RETURNING scene_id`,
      [day, sceneId],
    );
    return r.rows[0].scene_id;
  }

  async function botPlayer(i: number): Promise<string> {
    const db = app.deps.db!;
    const name = `${BOT_NAMES[i % BOT_NAMES.length]} ${100 + ((i * 37) % 900)}`;
    const r = await db.query(
      `INSERT INTO players(display_name, friend_code, locale, is_bot) VALUES ($1, $2, 'en', true) RETURNING id`,
      [name, makeCode()],
    );
    return r.rows[0].id;
  }

  /** Make sure there are enough fresh seed hides for today (never an empty game). */
  async function topUpSeeds(day: string, sceneId: string, forPlayer: string) {
    const db = app.deps.db!;
    const r = await db.query(
      `SELECT count(*)::int AS n FROM hides h WHERE h.day = $1 AND h.status = 'live' AND h.player_id <> $2
         AND NOT EXISTS (SELECT 1 FROM seek_attempts a WHERE a.hide_id = h.id AND a.player_id = $2)`,
      [day, forPlayer],
    );
    let missing = SEED_TARGET - r.rows[0].n;
    let seed = Date.now() & 0xffffff;
    while (missing > 0) {
      const orient = seed % 3 === 0 ? 'portrait' : 'landscape';
      const scene = await loadScene(sceneId, orient);
      const made = await autoHide(scene, seed++);
      if (!made) continue;
      const bot = await botPlayer(seed);
      await db.query(
        `INSERT INTO hides(day, scene_id, orientation, player_id, pose, angle, x, y, scale, rotation, flip, depth, paint, challenge_code, is_seed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,$13,true)`,
        [day, sceneId, orient, bot, made.sprite.pose, made.sprite.angle, made.placement.x, made.placement.y,
          made.placement.scale, made.placement.rotation, made.placement.flip, await encodePaint(made.paint.data), makeCode()],
      );
      missing--;
    }
  }

  // ---------------------------------------------------------------- submit a hide
  app.post<{
    Body: { sceneId: string; orientation: string; pose: string; angle: string; placement: Placement; paint: string };
  }>('/hides', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const db = app.deps.db;
    if (!db) return needDb(reply);
    const me = await auth(req, reply);
    if (!me) return;
    const b = req.body;
    const day = dayKey();
    const sceneId = await ensureDay(day);
    if (b.sceneId !== sceneId) return reply.code(400).send({ error: 'not_todays_scene' });
    const p = b.placement;
    if (![p?.x, p?.y, p?.scale, p?.rotation].every((v) => Number.isFinite(v))) return reply.code(400).send({ error: 'bad_placement' });
    const scene = await loadScene(sceneId, b.orientation);
    const sprite = await loadSprite(b.pose, b.angle);
    const f = fairness(scene, sprite, { ...p, flip: !!p.flip });
    if (!f.ok) return reply.code(422).send({ error: 'unfair', issues: f.issues });
    const paintRgba = await decodePaint(Buffer.from(b.paint, 'base64'));
    const paint = await encodePaint(paintRgba);
    const code = makeCode();
    const r = await db.query(
      `INSERT INTO hides(day, scene_id, orientation, player_id, pose, angle, x, y, scale, rotation, flip, depth, paint, challenge_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,$13)
       ON CONFLICT (player_id, day) WHERE status <> 'removed' AND NOT is_seed
       DO UPDATE SET orientation = EXCLUDED.orientation, pose = EXCLUDED.pose, angle = EXCLUDED.angle, x = EXCLUDED.x,
         y = EXCLUDED.y, scale = EXCLUDED.scale, rotation = EXCLUDED.rotation, flip = EXCLUDED.flip, paint = EXCLUDED.paint,
         attempts = 0, finds = 0, find_ms_total = 0
       RETURNING id, challenge_code`,
      [day, sceneId, b.orientation, me, b.pose, b.angle, p.x, p.y, p.scale, p.rotation, !!p.flip, paint, code],
    );
    imageCache.delete(r.rows[0].id);
    return { id: r.rows[0].id, code: r.rows[0].challenge_code };
  });

  // ---------------------------------------------------------------- start seeking
  app.post<{ Body: { challenge?: string } }>('/seek/start', async (req, reply) => {
    const db = app.deps.db;
    if (!db) return needDb(reply);
    const me = await auth(req, reply);
    if (!me) return;
    const day = dayKey();
    const sceneId = await ensureDay(day);
    await topUpSeeds(day, sceneId, me);
    const picked: string[] = [];
    if (req.body?.challenge) {
      const c = await db.query(
        `SELECT id FROM hides WHERE challenge_code = $1 AND status = 'live' AND player_id <> $2
           AND NOT EXISTS (SELECT 1 FROM seek_attempts a WHERE a.hide_id = hides.id AND a.player_id = $2)`,
        [req.body.challenge.toUpperCase(), me],
      );
      if (c.rows[0]) picked.push(c.rows[0].id);
    }
    const r = await db.query(
      `SELECT id FROM hides h WHERE h.day = $1 AND h.status = 'live' AND h.player_id <> $2 AND NOT (h.id = ANY($3::uuid[]))
         AND NOT EXISTS (SELECT 1 FROM seek_attempts a WHERE a.hide_id = h.id AND a.player_id = $2)
       ORDER BY h.is_seed ASC, h.attempts ASC, random() LIMIT $4`,
      [day, me, picked, 5 - picked.length],
    );
    picked.push(...r.rows.map((x) => x.id));
    if (!picked.length) return reply.code(404).send({ error: 'nothing_to_seek' });
    const s = await db.query(`INSERT INTO seek_sessions(player_id, day, challenge_hide) VALUES ($1,$2,$3) RETURNING id`, [
      me,
      day,
      req.body?.challenge ? picked[0] : null,
    ]);
    const session = s.rows[0].id;
    for (let i = 0; i < picked.length; i++) {
      await db.query(`INSERT INTO seek_attempts(session_id, hide_id, player_id, ord) VALUES ($1,$2,$3,$4)`, [session, picked[i], me, i]);
    }
    return { session, hides: picked.map((id, i) => ({ id, ord: i, image: `/v1/seek/${session}/${id}/image` })) };
  });

  async function attempt(session: string, hideId: string, me: string) {
    const r = await app.deps.db!.query(
      `SELECT a.*, h.scene_id, h.orientation, h.pose, h.angle, h.x, h.y, h.scale, h.rotation, h.flip, h.paint, h.player_id AS hider
         FROM seek_attempts a JOIN hides h ON h.id = a.hide_id WHERE a.session_id = $1 AND a.hide_id = $2 AND a.player_id = $3`,
      [session, hideId, me],
    );
    return r.rows[0] as (HideRow & { started_at: Date | null; ended_at: Date | null; wrong_taps: number; hint_used: boolean; penalty_ms: number; found: boolean | null }) | undefined;
  }

  // The composited image. Its first fetch starts the attempt's server clock.
  app.get<{ Params: { session: string; hide: string } }>('/seek/:session/:hide/image', async (req, reply) => {
    const db = app.deps.db;
    if (!db) return needDb(reply);
    const me = await auth(req, reply);
    if (!me) return;
    const a = await attempt(req.params.session, req.params.hide, me);
    if (!a) return reply.code(404).send({ error: 'not_found' });
    let img = imageCache.get(req.params.hide);
    if (!img) {
      const scene = await loadScene(a.scene_id, a.orientation);
      const sprite = await loadSprite(a.pose, a.angle);
      img = await composite(scene, sprite, placementOf(a), await decodePaint(a.paint));
      imageCache.set(req.params.hide, img);
      if (imageCache.size > 40) imageCache.delete(imageCache.keys().next().value!);
    }
    await db.query(`UPDATE seek_attempts SET started_at = coalesce(started_at, now()) WHERE session_id = $1 AND hide_id = $2`, [
      req.params.session,
      req.params.hide,
    ]);
    reply.header('Cache-Control', 'private, no-store');
    return reply.type('image/webp').send(img);
  });

  async function finish(session: string, hideId: string, me: string, found: boolean, elapsedMs: number, a: NonNullable<Awaited<ReturnType<typeof attempt>>>) {
    const db = app.deps.db!;
    const points = seekPoints({ found, elapsedMs, wrongTaps: a.wrong_taps, hintUsed: a.hint_used });
    const suspicious = found && elapsedMs < 300;
    await db.query(
      `UPDATE seek_attempts SET ended_at = now(), found = $3, elapsed_ms = $4, points = $5, suspicious = $6
         WHERE session_id = $1 AND hide_id = $2 AND ended_at IS NULL`,
      [session, hideId, found, Math.round(elapsedMs), suspicious ? 0 : points, suspicious],
    );
    const h = await db.query(
      `UPDATE hides SET attempts = attempts + 1, finds = finds + $2::int, find_ms_total = find_ms_total + $3
         WHERE id = $1 RETURNING attempts, finds, find_ms_total`,
      [hideId, found ? 1 : 0, found ? Math.round(elapsedMs) : 0],
    );
    const st = h.rows[0];
    const score = hiderScore({ attempts: st.attempts, finds: st.finds, avgFindMs: st.finds ? st.find_ms_total / st.finds : 0 });
    await db.query(`UPDATE hides SET hider_score = $2 WHERE id = $1`, [hideId, score]);
    if (!suspicious) await db.query(`UPDATE players SET xp = xp + $2 WHERE id = $1`, [me, Math.round(points / 10)]);
    const faster = await db.query(
      `SELECT count(*) FILTER (WHERE found AND elapsed_ms < $2)::int AS faster, count(*) FILTER (WHERE found)::int AS total
         FROM seek_attempts WHERE hide_id = $1`,
      [hideId, Math.round(elapsedMs)],
    );
    const sprite = await loadSprite(a.pose, a.angle);
    return {
      done: true,
      found,
      elapsedMs: Math.round(elapsedMs),
      points: suspicious ? 0 : points,
      reveal: revealPoint(sprite, placementOf(a)),
      fasterPct: faster.rows[0].total ? Math.round((100 * faster.rows[0].faster) / faster.rows[0].total) : 0,
      hide: { attempts: st.attempts, finds: st.finds },
    };
  }

  app.post<{ Params: { session: string; hide: string }; Body: { x: number; y: number } }>(
    '/seek/:session/:hide/tap',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const db = app.deps.db;
      if (!db) return needDb(reply);
      const me = await auth(req, reply);
      if (!me) return;
      const { session, hide } = req.params;
      const a = await attempt(session, hide, me);
      if (!a || !a.started_at) return reply.code(404).send({ error: 'not_started' });
      if (a.ended_at) return reply.code(409).send({ error: 'already_done' });
      const elapsed = Date.now() - new Date(a.started_at).getTime() + a.penalty_ms;
      if (elapsed > SEEK_TIME_LIMIT_MS + 1500) return finish(session, hide, me, false, SEEK_TIME_LIMIT_MS, a);
      const { x, y } = req.body ?? {};
      if (!Number.isFinite(x) || !Number.isFinite(y)) return reply.code(400).send({ error: 'bad_tap' });
      const scene = await loadScene(a.scene_id, a.orientation);
      const sprite = await loadSprite(a.pose, a.angle);
      if (tapHits(scene, sprite, placementOf(a), x, y)) return finish(session, hide, me, true, elapsed, a);
      const misses = a.wrong_taps + 1;
      await db.query(
        `UPDATE seek_attempts SET wrong_taps = $3, penalty_ms = penalty_ms + $4 WHERE session_id = $1 AND hide_id = $2`,
        [session, hide, misses, WRONG_TAP_PENALTY_MS],
      );
      if (misses >= MAX_WRONG_TAPS) return finish(session, hide, me, false, elapsed + WRONG_TAP_PENALTY_MS, { ...a, wrong_taps: misses });
      return { done: false, found: false, misses, penaltyMs: a.penalty_ms + WRONG_TAP_PENALTY_MS };
    },
  );

  app.post<{ Params: { session: string; hide: string } }>('/seek/:session/:hide/hint', async (req, reply) => {
    const db = app.deps.db;
    if (!db) return needDb(reply);
    const me = await auth(req, reply);
    if (!me) return;
    const a = await attempt(req.params.session, req.params.hide, me);
    if (!a || a.ended_at) return reply.code(404).send({ error: 'not_found' });
    await db.query(`UPDATE seek_attempts SET hint_used = true WHERE session_id = $1 AND hide_id = $2`, [req.params.session, req.params.hide]);
    const scene = await loadScene(a.scene_id, a.orientation);
    return { quadrant: { x: a.x < scene.w / 2 ? 0 : 1, y: a.y < scene.h / 2 ? 0 : 1 }, w: scene.w, h: scene.h };
  });

  app.post<{ Params: { session: string; hide: string } }>('/seek/:session/:hide/giveup', async (req, reply) => {
    const db = app.deps.db;
    if (!db) return needDb(reply);
    const me = await auth(req, reply);
    if (!me) return;
    const a = await attempt(req.params.session, req.params.hide, me);
    if (!a || !a.started_at || a.ended_at) return reply.code(404).send({ error: 'not_found' });
    return finish(req.params.session, req.params.hide, me, false, SEEK_TIME_LIMIT_MS, a);
  });

  // ---------------------------------------------------------------- results + leaderboards
  app.get('/me/today', async (req, reply) => {
    const db = app.deps.db;
    if (!db) return needDb(reply);
    const me = await auth(req, reply);
    if (!me) return;
    const day = dayKey();
    const h = await db.query(
      `SELECT id, challenge_code AS code, attempts, finds, hider_score AS score FROM hides WHERE player_id = $1 AND day = $2 AND NOT is_seed`,
      [me, day],
    );
    const s = await db.query(
      `SELECT found, elapsed_ms AS "elapsedMs", wrong_taps AS "wrongTaps", hint_used AS "hintUsed", points
         FROM seek_attempts WHERE player_id = $1 AND ended_at IS NOT NULL AND started_at::date >= ($2::date - 1)
         ORDER BY ended_at`,
      [me, day],
    );
    return { day, hide: h.rows[0] ?? null, seeks: s.rows };
  });

  app.get<{ Querystring: { board?: string } }>('/leaderboard', async (req, reply) => {
    const db = app.deps.db;
    if (!db) return needDb(reply);
    const day = dayKey();
    const board = req.query.board === 'hiders' ? 'hiders' : 'seekers';
    const rows =
      board === 'seekers'
        ? await db.query(
            `SELECT p.display_name AS name, sum(a.points)::int AS score FROM seek_attempts a
               JOIN seek_sessions s ON s.id = a.session_id JOIN players p ON p.id = a.player_id
              WHERE s.day = $1 AND a.points > 0 AND NOT p.shadow_banned AND NOT p.is_bot
              GROUP BY p.id ORDER BY score DESC LIMIT 50`,
            [day],
          )
        : await db.query(
            `SELECT p.display_name AS name, h.hider_score AS score, h.attempts, h.finds FROM hides h JOIN players p ON p.id = h.player_id
              WHERE h.day = $1 AND NOT h.is_seed AND h.attempts >= 1 AND NOT p.shadow_banned
              ORDER BY h.hider_score DESC, h.attempts DESC LIMIT 50`,
            [day],
          );
    reply.header('Cache-Control', 'public, max-age=20');
    return { day, board, rows: rows.rows };
  });
}
