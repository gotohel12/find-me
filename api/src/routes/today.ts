import type { FastifyInstance } from 'fastify';
import { addDays, dayKey, msUntilNextRelease } from '@findme/shared';
import { loadSceneCatalogue, loadSchedule, sceneForDay } from '../content.ts';

export async function todayRoutes(app: FastifyInstance): Promise<void> {
  const schedule = await loadSchedule();
  const catalogue = await loadSceneCatalogue();

  /**
   * Today's scene. The cron job writes daily_scenes ahead of time; if it has
   * not run, we fall back to the schedule so the game never shows an empty day.
   */
  app.get<{ Querystring: { day?: string } }>('/today', async (req, reply) => {
    const today = dayKey();
    const day = req.query.day ?? today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today) return reply.code(400).send({ error: 'bad_day' });
    const { db } = app.deps;
    const row = db
      ? await db.query('SELECT scene_id FROM daily_scenes WHERE day = $1', [day]).then((r) => r.rows[0], () => undefined)
      : undefined;
    const sceneId: string = row?.scene_id ?? sceneForDay(schedule, day);
    const scene = catalogue[sceneId];
    if (!scene) return reply.code(500).send({ error: 'scene_missing', sceneId });
    reply.header('Cache-Control', day < today ? 'public, max-age=86400' : 'public, max-age=30');
    const base = `${app.deps.config.assetBase}/scenes/${sceneId}`;
    return {
      day,
      isToday: day === today,
      nextReleaseInMs: msUntilNextRelease(),
      previousDay: addDays(day, -1),
      scene: {
        id: sceneId,
        title: scene.title,
        assets: { landscape: `${base}/landscape/`, portrait: `${base}/portrait/` },
      },
    };
  });
}
