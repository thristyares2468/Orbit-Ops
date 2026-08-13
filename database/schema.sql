CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  display_name varchar(22) NOT NULL,
  account_status varchar(20) NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'banned', 'deleted')),
  role varchar(20) NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'moderator', 'admin', 'owner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_lower_uidx ON accounts (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS accounts_display_name_lower_uidx ON accounts (lower(display_name));

CREATE TABLE IF NOT EXISTS player_stats (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  games_played integer NOT NULL DEFAULT 0 CHECK (games_played >= 0),
  crew_games integer NOT NULL DEFAULT 0 CHECK (crew_games >= 0),
  operative_games integer NOT NULL DEFAULT 0 CHECK (operative_games >= 0),
  crew_wins integer NOT NULL DEFAULT 0 CHECK (crew_wins >= 0),
  operative_wins integer NOT NULL DEFAULT 0 CHECK (operative_wins >= 0),
  total_wins integer NOT NULL DEFAULT 0 CHECK (total_wins >= 0),
  total_losses integer NOT NULL DEFAULT 0 CHECK (total_losses >= 0),
  tasks_completed integer NOT NULL DEFAULT 0 CHECK (tasks_completed >= 0),
  sabotages_started integer NOT NULL DEFAULT 0 CHECK (sabotages_started >= 0),
  sabotages_repaired integer NOT NULL DEFAULT 0 CHECK (sabotages_repaired >= 0),
  eliminations integer NOT NULL DEFAULT 0 CHECK (eliminations >= 0),
  times_eliminated integer NOT NULL DEFAULT 0 CHECK (times_eliminated >= 0),
  incidents_reported integer NOT NULL DEFAULT 0 CHECK (incidents_reported >= 0),
  correct_votes integer NOT NULL DEFAULT 0 CHECK (correct_votes >= 0),
  incorrect_votes integer NOT NULL DEFAULT 0 CHECK (incorrect_votes >= 0),
  total_survival_seconds bigint NOT NULL DEFAULT 0 CHECK (total_survival_seconds >= 0),
  longest_survival_seconds integer NOT NULL DEFAULT 0 CHECK (longest_survival_seconds >= 0),
  score integer NOT NULL DEFAULT 0,
  experience integer NOT NULL DEFAULT 0 CHECK (experience >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_settings (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  master_volume numeric(4,3) NOT NULL DEFAULT 0.8 CHECK (master_volume BETWEEN 0 AND 1),
  music_volume numeric(4,3) NOT NULL DEFAULT 0.45 CHECK (music_volume BETWEEN 0 AND 1),
  sfx_volume numeric(4,3) NOT NULL DEFAULT 0.75 CHECK (sfx_volume BETWEEN 0 AND 1),
  mouse_sensitivity numeric(5,3) NOT NULL DEFAULT 1 CHECK (mouse_sensitivity BETWEEN 0.1 AND 4),
  camera_distance numeric(5,2) NOT NULL DEFAULT 8 CHECK (camera_distance BETWEEN 4 AND 14),
  invert_y boolean NOT NULL DEFAULT false,
  graphics_quality varchar(10) NOT NULL DEFAULT 'medium' CHECK (graphics_quality IN ('low', 'medium', 'high')),
  show_fps boolean NOT NULL DEFAULT false,
  show_ping boolean NOT NULL DEFAULT true,
  colour_blind_mode varchar(20) NOT NULL DEFAULT 'off',
  reduced_motion boolean NOT NULL DEFAULT false,
  screen_shake boolean NOT NULL DEFAULT true,
  subtitles boolean NOT NULL DEFAULT true,
  text_size numeric(4,2) NOT NULL DEFAULT 1 CHECK (text_size BETWEEN 0.8 AND 1.5),
  keybinds_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code varchar(6) NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  winning_faction varchar(20) NOT NULL CHECK (winning_faction IN ('crew', 'operative', 'neutral', 'abandoned')),
  player_count smallint NOT NULL CHECK (player_count BETWEEN 1 AND 16),
  map_id varchar(40) NOT NULL DEFAULT 'osv-meridian',
  duration_seconds integer NOT NULL CHECK (duration_seconds >= 0),
  match_data_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS matches_started_at_idx ON matches (started_at DESC);
CREATE INDEX IF NOT EXISTS matches_room_code_idx ON matches (room_code);

CREATE TABLE IF NOT EXISTS match_players (
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  display_name_snapshot varchar(22) NOT NULL,
  assigned_role varchar(40) NOT NULL,
  faction varchar(20) NOT NULL,
  won boolean NOT NULL,
  score integer NOT NULL DEFAULT 0,
  tasks_completed smallint NOT NULL DEFAULT 0,
  sabotages_started smallint NOT NULL DEFAULT 0,
  sabotages_repaired smallint NOT NULL DEFAULT 0,
  eliminations smallint NOT NULL DEFAULT 0,
  incidents_reported smallint NOT NULL DEFAULT 0,
  correct_votes smallint NOT NULL DEFAULT 0,
  incorrect_votes smallint NOT NULL DEFAULT 0,
  survival_seconds integer NOT NULL DEFAULT 0,
  disconnected boolean NOT NULL DEFAULT false,
  PRIMARY KEY (match_id, display_name_snapshot)
);
CREATE INDEX IF NOT EXISTS match_players_account_id_idx ON match_players (account_id);

CREATE TABLE IF NOT EXISTS cosmetics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cosmetic_type varchar(30) NOT NULL,
  cosmetic_key varchar(60) NOT NULL UNIQUE,
  display_name varchar(80) NOT NULL,
  description text NOT NULL DEFAULT '',
  unlock_requirement text NOT NULL DEFAULT 'starter',
  enabled boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS account_cosmetics (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  cosmetic_id uuid NOT NULL REFERENCES cosmetics(id) ON DELETE CASCADE,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  equipped boolean NOT NULL DEFAULT false,
  PRIMARY KEY (account_id, cosmetic_id)
);
CREATE INDEX IF NOT EXISTS account_cosmetics_cosmetic_id_idx ON account_cosmetics (cosmetic_id);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS sessions_account_id_idx ON sessions (account_id);
CREATE INDEX IF NOT EXISTS sessions_expires_active_idx ON sessions (expires_at) WHERE revoked = false;

CREATE TABLE IF NOT EXISTS bans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reason text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  issued_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS bans_account_active_idx ON bans (account_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS bans_issued_by_idx ON bans (issued_by);

CREATE TABLE IF NOT EXISTS mutes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reason text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  issued_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS mutes_account_active_idx ON mutes (account_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS mutes_issued_by_idx ON mutes (issued_by);
