/**
 * Daily cron (Render Cron Job, 21:00 UTC = 00:00 Asia/Riyadh):
 *  - make sure scenes from content/ exist in the DB
 *  - publish the scene for today and the next 7 days (idempotent; admin edits win)
 * Later phases add: final daily ranks, hider score settlement, cleanup.
 */
import pg from 'pg';
import { addDays, dayKey } from '@findme/shared';
import { loadConfig } from '../config.ts';
import { loadSceneCatalogue, loadSchedule, sceneForDay } from '../content.ts';
import { migrate } from '../migrate.ts';

export async function runDaily(client: pg.ClientBase, now = Date.now()): Promise<string[]> {
  const schedule = await loadSchedule();
  const catalogue = await loadSceneCatalogue();
  for (const s of Object.values(catalogue)) {
    await client.query(
      `INSERT INTO scenes(id, title_en, title_ar, theme, asset_version, meta)
       VALUES ($1, $2, $3, '', 'v1', '{}') ON CONFLICT (id) DO UPDATE SET title_en = $2, title_ar = $3`,
      [s.id, s.title.en, s.title.ar],
    );
  }
  const published: string[] = [];
  const today = dayKey(now);
  for (let i = 0; i < 8; i++) {
    const day = addDays(today, i);
    const scene = sceneForDay(schedule, day);
    const r = await client.query(
      `INSERT INTO daily_scenes(day, scene_id, is_event) VALUES ($1, $2, $3) ON CONFLICT (day) DO NOTHING`,
      [day, scene, Boolean(schedule.overrides?.[day])],
    );
    if (r.rowCount) published.push(`${day}=${scene}`);
  }
  return published;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = loadConfig().databaseUrl;
  if (!url) throw new Error('DATABASE_URL is not set');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await migrate(client);
    const p = await runDaily(client);
    console.log(p.length ? `published ${p.join(', ')}` : 'schedule already published');
  } finally {
    await client.end();
  }
}
