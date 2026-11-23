-- FIND ME / لقني — initial schema (Mohsen ~ Danial)
-- Applied by api/src/migrate.ts in filename order; each file runs once, in a transaction.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE players (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  text NOT NULL,
  name_changed_at timestamptz,
  friend_code   char(6) NOT NULL UNIQUE,
  country       char(2),
  locale        text NOT NULL DEFAULT 'ar',
  xp            bigint NOT NULL DEFAULT 0,
  streak_days   int NOT NULL DEFAULT 0,
  last_play_day date,
  is_bot        boolean NOT NULL DEFAULT false,      -- seed-hide authors (🤖 tag)
  shadow_banned boolean NOT NULL DEFAULT false,
  banned_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

-- Guest auth: a device holds a random token; we store only its hash.
CREATE TABLE device_tokens (
  token_hash    bytea PRIMARY KEY,
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_tokens_player ON device_tokens(player_id);

CREATE TABLE oauth_links (
  provider      text NOT NULL CHECK (provider IN ('google','discord','apple')),
  subject       text NOT NULL,
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);

CREATE TABLE scenes (
  id            text PRIMARY KEY,                    -- e.g. s001_toy_shop
  title_en      text NOT NULL,
  title_ar      text NOT NULL,
  theme         text NOT NULL,
  asset_version text NOT NULL,                       -- cache-busting for CDN URLs
  meta          jsonb NOT NULL,                      -- packed meta.json per orientation
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per game day (00:00 Asia/Riyadh). Written by the daily cron.
CREATE TABLE daily_scenes (
  day           date PRIMARY KEY,
  scene_id      text NOT NULL REFERENCES scenes(id),
  is_event      boolean NOT NULL DEFAULT false,
  published_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE hide_status AS ENUM ('live', 'pending_review', 'removed');

CREATE TABLE hides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day           date NOT NULL REFERENCES daily_scenes(day),
  scene_id      text NOT NULL REFERENCES scenes(id),
  orientation   text NOT NULL CHECK (orientation IN ('landscape','portrait')),
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  pose          text NOT NULL,
  angle         text NOT NULL,
  x             real NOT NULL,
  y             real NOT NULL,
  scale         real NOT NULL,
  rotation      real NOT NULL,
  flip          boolean NOT NULL DEFAULT false,
  depth         real NOT NULL,
  paint_key     text NOT NULL,                       -- object-storage key of the 256² paint texture
  composite_key text,                                -- server-composited seek image
  challenge_code char(6) NOT NULL UNIQUE,
  difficulty    real,                                -- auto-hider camouflage score or learned rating
  status        hide_status NOT NULL DEFAULT 'live',
  attempts      int NOT NULL DEFAULT 0,
  finds         int NOT NULL DEFAULT 0,
  find_ms_total bigint NOT NULL DEFAULT 0,
  hider_score   int NOT NULL DEFAULT 0,
  report_count  int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hides_day_serve ON hides(day, status, attempts);
CREATE INDEX hides_player ON hides(player_id, day);
CREATE UNIQUE INDEX hides_one_per_day ON hides(player_id, day) WHERE status <> 'removed';

-- A seek session = up to 5 hides served together.
CREATE TABLE seek_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  day           date NOT NULL,
  challenge_hide uuid REFERENCES hides(id),
  score         int,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX seek_sessions_player ON seek_sessions(player_id, day);

CREATE TABLE seek_attempts (
  session_id    uuid NOT NULL REFERENCES seek_sessions(id) ON DELETE CASCADE,
  hide_id       uuid NOT NULL REFERENCES hides(id) ON DELETE CASCADE,
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  ord           smallint NOT NULL,
  started_at    timestamptz,                         -- server clock when the image was first served
  ended_at      timestamptz,
  found         boolean,
  elapsed_ms    int,
  wrong_taps    smallint NOT NULL DEFAULT 0,
  hint_used     boolean NOT NULL DEFAULT false,
  points        int,
  suspicious    boolean NOT NULL DEFAULT false,      -- e.g. found in < 300 ms
  PRIMARY KEY (session_id, hide_id)
);
CREATE UNIQUE INDEX seek_attempts_once ON seek_attempts(player_id, hide_id);
CREATE INDEX seek_attempts_hide ON seek_attempts(hide_id);

CREATE TABLE friendships (
  a             uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  b             uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (a, b),
  CHECK (a < b)
);

CREATE TABLE groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  code          char(6) NOT NULL UNIQUE,
  owner_id      uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE group_members (
  group_id      uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, player_id)
);

CREATE TABLE reports (
  id            bigserial PRIMARY KEY,
  hide_id       uuid NOT NULL REFERENCES hides(id) ON DELETE CASCADE,
  reporter_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  reason        text NOT NULL CHECK (reason IN ('offensive','cheating','other')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolution    text,
  UNIQUE (hide_id, reporter_id)
);

