-- Online hides: paint stored inline (256² PNG, a few KB), seed-hide names, seek timing.
ALTER TABLE hides ALTER COLUMN paint_key DROP NOT NULL;
ALTER TABLE hides ADD COLUMN paint bytea;
ALTER TABLE hides ADD COLUMN is_seed boolean NOT NULL DEFAULT false;
ALTER TABLE seek_attempts ADD COLUMN penalty_ms int NOT NULL DEFAULT 0;
DROP INDEX IF EXISTS hides_one_per_day;
CREATE UNIQUE INDEX hides_one_per_day ON hides(player_id, day) WHERE status <> 'removed' AND NOT is_seed;
CREATE INDEX hides_day_scene ON hides(day, scene_id, status);
