/** Scene schedule + scene catalogue, loaded from content/ and the packed asset manifest. */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Schedule, sceneForDay } from '@findme/shared';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function loadSchedule(): Promise<Schedule> {
  return JSON.parse(await readFile(join(ROOT, 'content', 'schedule.json'), 'utf8')) as Schedule;
}

export interface SceneInfo {
  id: string;
  title: { en: string; ar: string };
}

export async function loadSceneCatalogue(): Promise<Record<string, SceneInfo>> {
  const raw = JSON.parse(await readFile(join(ROOT, 'content', 'scenes.json'), 'utf8')) as Record<
    string,
    { en: string; ar: string; theme: string }
  >;
  const out: Record<string, SceneInfo> = {};
  for (const [id, v] of Object.entries(raw)) out[id] = { id, title: { en: v.en, ar: v.ar } };
  return out;
}

export { sceneForDay };
