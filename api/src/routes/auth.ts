import type { FastifyInstance } from 'fastify';
import { bearer, guestName, hashToken, makeCode, newToken } from '../auth.ts';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** Create a guest player for this device. No signup, no personal data. */
  app.post<{ Body: { locale?: string } }>(
    '/auth/guest',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (req) => {
      const locale = req.body?.locale === 'en' ? 'en' : 'ar';
      const token = newToken();
      const { db } = app.deps;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const r = await db.query(
            `WITH p AS (
               INSERT INTO players(display_name, friend_code, locale) VALUES ($1, $2, $3)
               RETURNING id, display_name, friend_code)
             INSERT INTO device_tokens(token_hash, player_id) SELECT $4, id FROM p
             RETURNING (SELECT row_to_json(p) FROM p) AS player`,
            [guestName(locale), makeCode(), locale, hashToken(token)],
          );
          const p = r.rows[0].player;
          return { token, player: { id: p.id, name: p.display_name, friendCode: p.friend_code } };
        } catch (e) {
          if ((e as { code?: string }).code !== '23505') throw e; // retry only on friend-code collision
        }
      }
      throw new Error('could not allocate a friend code');
    },
  );

  app.get('/me', async (req, reply) => {
    const t = bearer(req);
    if (!t) return reply.code(401).send({ error: 'no_token' });
    const r = await app.deps.db.query(
      `UPDATE device_tokens SET last_seen_at = now() WHERE token_hash = $1
       RETURNING (SELECT row_to_json(x) FROM (
         SELECT id, display_name AS name, friend_code AS "friendCode", xp, streak_days AS "streakDays", locale
         FROM players WHERE id = device_tokens.player_id AND deleted_at IS NULL) x) AS player`,
      [hashToken(t)],
    );
    if (!r.rowCount || !r.rows[0].player) return reply.code(401).send({ error: 'bad_token' });
    return { player: r.rows[0].player };
  });
}
