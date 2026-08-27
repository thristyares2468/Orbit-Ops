-- =====================================================================
-- Orbit Ops Subdivision - complete database schema
--
-- Generated from db.js, the authoritative source: the DDL constant plus
-- every schema statement initDb() runs after it. Regenerate rather than
-- hand-edit, or this drifts from what the game actually expects.
--
-- 33 tables, 59 follow-up schema statements.
--
-- WHERE TO RUN IT
--   Neon console -> your project -> SQL Editor, with the target database
--   selected in the dropdown. Create the database first under Databases;
--   CREATE DATABASE cannot run from the editor.
--
-- SAFE TO RE-RUN
--   Every statement is IF NOT EXISTS or guarded, so running it twice
--   changes nothing the second time.
--
-- YOU DO NOT NORMALLY NEED THIS
--   The game builds its own schema on boot. This is for when you want the
--   database ready before pointing anything at it, or to read the shape.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Tables and their indexes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  email_domain  TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT true,
  password_hash TEXT NOT NULL,
  recovery_code_ciphertext TEXT,
  username      TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'owner')),
  healthshot_used BOOLEAN NOT NULL DEFAULT false,
  trade_up_tutorial_seen BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login    TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'active',
  strikes       INT  NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_email ON accounts (lower(email));
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_accounts_username') AND
     NOT EXISTS (
       SELECT 1 FROM (
         SELECT lower(username) AS u FROM accounts GROUP BY lower(username) HAVING count(*) > 1
       ) dupes
     ) THEN
    EXECUTE 'CREATE UNIQUE INDEX uq_accounts_username ON accounts (lower(username))';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_accounts_domain ON accounts (email_domain);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts (status);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  account_id   BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_id    TEXT,
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_account ON sessions (account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions (last_seen);

CREATE TABLE IF NOT EXISTS account_email_codes (
  id            BIGSERIAL PRIMARY KEY,
  purpose       TEXT NOT NULL CHECK (purpose IN ('register', 'password_reset', 'email_change')),
  account_id    BIGINT REFERENCES accounts(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  email_domain  TEXT,
  username      TEXT,
  password_hash TEXT,
  code_hash     TEXT NOT NULL,
  attempts      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_account_email_codes_email ON account_email_codes (purpose, lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_email_codes_account ON account_email_codes (account_id, purpose, created_at DESC)
  WHERE account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS devices (
  device_id     TEXT PRIMARY KEY,
  fingerprint   TEXT,
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  accounts_seen BIGINT[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_devices_fingerprint ON devices (fingerprint);
CREATE INDEX IF NOT EXISTS idx_devices_accounts ON devices USING GIN (accounts_seen);

CREATE TABLE IF NOT EXISTS bans (
  id          BIGSERIAL PRIMARY KEY,
  scope       TEXT NOT NULL,                 -- 'account' | 'device'
  account_id  BIGINT REFERENCES accounts(id) ON DELETE CASCADE,
  device_id   TEXT,
  reason      TEXT NOT NULL,
  by_admin    TEXT NOT NULL DEFAULT 'admin',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bans_account ON bans (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bans_device  ON bans (device_id)  WHERE device_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bans_expires ON bans (expires_at);

CREATE TABLE IF NOT EXISTS stats (
  account_id       BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  kills            BIGINT NOT NULL DEFAULT 0,
  deaths           BIGINT NOT NULL DEFAULT 0,
  assists          BIGINT NOT NULL DEFAULT 0,
  wins             BIGINT NOT NULL DEFAULT 0,
  games_played     BIGINT NOT NULL DEFAULT 0,
  playtime_secs    BIGINT NOT NULL DEFAULT 0,
  best_streak      INT    NOT NULL DEFAULT 0,
  gungame_kills    BIGINT NOT NULL DEFAULT 0,
  gungame_wins     BIGINT NOT NULL DEFAULT 0,
  deathmatch_kills BIGINT NOT NULL DEFAULT 0,
  deathmatch_wins  BIGINT NOT NULL DEFAULT 0,
  mvps             BIGINT NOT NULL DEFAULT 0,
  shots_fired      BIGINT NOT NULL DEFAULT 0,
  shots_hit        BIGINT NOT NULL DEFAULT 0,
  xp               BIGINT NOT NULL DEFAULT 0,
  mowbucks         BIGINT NOT NULL DEFAULT 0,
  weapon_kills     JSONB  NOT NULL DEFAULT '{}'::jsonb,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_stats (
  date_key        TEXT NOT NULL,
  player_key      TEXT NOT NULL,
  account_id      BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  username        TEXT NOT NULL,
  wins            BIGINT NOT NULL DEFAULT 0,
  kills           BIGINT NOT NULL DEFAULT 0,
  deaths          BIGINT NOT NULL DEFAULT 0,
  shots_fired     BIGINT NOT NULL DEFAULT 0,
  shots_hit       BIGINT NOT NULL DEFAULT 0,
  best_streak     INT    NOT NULL DEFAULT 0,
  weapon_kills    JSONB  NOT NULL DEFAULT '{}'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (date_key, player_key)
);
CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats (date_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS daily_challenge_claims (
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('easy', 'medium', 'hard')),
  xp_awarded INT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, date_key, tier)
);

CREATE TABLE IF NOT EXISTS daily_weapon_kills (
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  weapon TEXT NOT NULL,
  kills BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, date_key, weapon)
);

CREATE TABLE IF NOT EXISTS daily_challenge_progress (
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  counters JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (account_id, date_key)
);

CREATE TABLE IF NOT EXISTS daily_challenge_templates (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL DEFAULT 'daily' CHECK (period IN ('daily', 'weekly')),
  tier TEXT NOT NULL CHECK (tier IN ('easy', 'medium', 'hard')),
  metric TEXT NOT NULL CHECK (metric IN ('kills', 'headshots', 'damage', 'utilityKills', 'wins', 'mapWins', 'weaponKills')),
  label TEXT NOT NULL,
  target INT NOT NULL CHECK (target > 0 AND target <= 1000000),
  xp INT NOT NULL CHECK (xp >= 0 AND xp <= 10000),
  weapon TEXT,
  map_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_by BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_daily_challenge_templates_tier ON daily_challenge_templates (tier, enabled, sort_order, id);

CREATE TABLE IF NOT EXISTS weekly_challenge_rotations (
  period_key TEXT PRIMARY KEY,
  challenges JSONB NOT NULL CHECK (jsonb_typeof(challenges) = 'array' AND jsonb_array_length(challenges) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skin_inventory (
  id          BIGSERIAL PRIMARY KEY,
  account_id  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'grant',
  collection_id TEXT,
  pattern_seed INT NOT NULL DEFAULT 0,
  rarity_tier TEXT,
  wear_value  DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (wear_value >= 0 AND wear_value <= 1),
  wear_seed   INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skin_inventory_account ON skin_inventory (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skin_inventory_item ON skin_inventory (item_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_skin_inventory_starter
  ON skin_inventory (account_id, item_id)
  WHERE source = 'starter';

CREATE TABLE IF NOT EXISTS skin_loadouts (
  account_id   BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  weapon       TEXT NOT NULL,
  inventory_id BIGINT REFERENCES skin_inventory(id) ON DELETE SET NULL,
  item_id      TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, weapon)
);
CREATE INDEX IF NOT EXISTS idx_skin_loadouts_inventory ON skin_loadouts (inventory_id);

CREATE TABLE IF NOT EXISTS case_inventory (
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  case_id    TEXT NOT NULL,
  quantity   INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, case_id)
);

CREATE TABLE IF NOT EXISTS case_openings (
  id           BIGSERIAL PRIMARY KEY,
  account_id   BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  case_id      TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  rarity_tier  TEXT NOT NULL,
  gold         BOOLEAN NOT NULL DEFAULT false,
  pattern_seed INT NOT NULL DEFAULT 0,
  wear_value   DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (wear_value >= 0 AND wear_value <= 1),
  wear_seed    INT NOT NULL DEFAULT 0,
  reel_json    JSONB NOT NULL,
  inventory_id BIGINT REFERENCES skin_inventory(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_openings_account ON case_openings (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS custom_cases (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  collection_name TEXT NOT NULL DEFAULT '',
  design_id    TEXT NOT NULL DEFAULT 'auto',
  price        BIGINT NOT NULL DEFAULT 0,
  visible_in_market BOOLEAN NOT NULL DEFAULT true,
  available_from TIMESTAMPTZ,
  available_until TIMESTAMPTZ,
  show_time_remaining BOOLEAN NOT NULL DEFAULT false,
  discount_price BIGINT,
  discount_mode TEXT NOT NULL DEFAULT 'none' CHECK (discount_mode IN ('none', 'window', 'final')),
  discount_starts_at TIMESTAMPTZ,
  discount_ends_at TIMESTAMPTZ,
  final_discount_minutes INT NOT NULL DEFAULT 0,
  rarity_mode TEXT NOT NULL DEFAULT 'skin' CHECK (rarity_mode IN ('skin', 'class')),
  rarity_weights_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  items_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by   BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_custom_cases_updated ON custom_cases (updated_at DESC);

CREATE TABLE IF NOT EXISTS skin_market_listings (
  id           BIGSERIAL PRIMARY KEY,
  seller_id    BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  buyer_id     BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  inventory_id BIGINT REFERENCES skin_inventory(id) ON DELETE SET NULL,
  item_id      TEXT NOT NULL,
  pattern_seed INT NOT NULL DEFAULT 0,
  rarity_tier  TEXT,
  wear_value   DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (wear_value >= 0 AND wear_value <= 1),
  wear_seed    INT NOT NULL DEFAULT 0,
  price        BIGINT NOT NULL CHECK (price >= 0),
  listing_type TEXT NOT NULL DEFAULT 'fixed' CHECK (listing_type IN ('fixed', 'auction')),
  ends_at      TIMESTAMPTZ,
  highest_bidder_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  bid_count    INT NOT NULL DEFAULT 0 CHECK (bid_count >= 0),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skin_market_active ON skin_market_listings (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skin_market_sold_item
  ON skin_market_listings (item_id, updated_at DESC)
  WHERE status = 'sold';
CREATE UNIQUE INDEX IF NOT EXISTS uq_skin_market_one_active_listing
  ON skin_market_listings (inventory_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS skin_market_bids (
  id         BIGSERIAL PRIMARY KEY,
  listing_id BIGINT NOT NULL REFERENCES skin_market_listings(id) ON DELETE CASCADE,
  bidder_id  BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  amount     BIGINT NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skin_market_bids_listing ON skin_market_bids (listing_id, created_at DESC);

CREATE TABLE IF NOT EXISTS case_market_listings (
  id         BIGSERIAL PRIMARY KEY,
  seller_id  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  case_id    TEXT NOT NULL REFERENCES custom_cases(id) ON DELETE RESTRICT,
  price      BIGINT NOT NULL CHECK (price >= 0),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_market_active ON case_market_listings (status, created_at DESC);

CREATE TABLE IF NOT EXISTS skin_collection_unlocks (
  account_id    BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL,
  case_id       TEXT NOT NULL,
  item_id       TEXT NOT NULL,
  xp_awarded    INT NOT NULL DEFAULT 0,
  unlocked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, collection_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_skin_collection_account
  ON skin_collection_unlocks (account_id, unlocked_at DESC);

CREATE TABLE IF NOT EXISTS skin_trade_requests (
  id            BIGSERIAL PRIMARY KEY,
  from_account  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  to_account    BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  offer_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skin_trade_to_account ON skin_trade_requests (to_account, status, created_at DESC);

CREATE TABLE IF NOT EXISTS trade_up_transactions (
  id                         BIGSERIAL PRIMARY KEY,
  -- Deliberately not an account FK: moderation may delete an account, but its
  -- economy audit must remain available for support and duplication reviews.
  account_id                 BIGINT NOT NULL,
  idempotency_key            TEXT NOT NULL,
  input_inventory_item_ids   BIGINT[] NOT NULL,
  input_item_snapshot        JSONB NOT NULL,
  input_rarity               TEXT NOT NULL CHECK (input_rarity IN ('common', 'rare', 'epic', 'legendary')),
  output_rarity              TEXT NOT NULL CHECK (output_rarity IN ('rare', 'epic', 'legendary', 'mythic')),
  average_normalized_float   DOUBLE PRECISION NOT NULL CHECK (average_normalized_float >= 0 AND average_normalized_float <= 1),
  selected_collection_id     TEXT NOT NULL,
  selected_output_definition_id TEXT NOT NULL,
  output_inventory_item_id   BIGINT REFERENCES skin_inventory(id) ON DELETE SET NULL,
  output_float               DOUBLE PRECISION NOT NULL CHECK (output_float >= 0 AND output_float <= 1),
  output_wear_condition      TEXT NOT NULL,
  output_pattern_seed        INT NOT NULL CHECK (output_pattern_seed >= 1 AND output_pattern_seed <= 1000),
  output_wear_seed           INT NOT NULL,
  output_item_snapshot       JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json                JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_trade_up_transactions_account ON trade_up_transactions (account_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS friendships (
  account_low  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_high BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  requested_by BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_low, account_high),
  CHECK (account_low < account_high),
  CHECK (requested_by = account_low OR requested_by = account_high)
);
CREATE INDEX IF NOT EXISTS idx_friendships_requested ON friendships (requested_by, status);
CREATE INDEX IF NOT EXISTS idx_friendships_high ON friendships (account_high, status);

CREATE TABLE IF NOT EXISTS cross_server_auth_handoffs (
  token_hash           TEXT PRIMARY KEY,
  account_id           BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  destination_instance TEXT NOT NULL,
  room_code            TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ NOT NULL,
  consumed_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cross_handoffs_expiry
  ON cross_server_auth_handoffs (expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS active_game_rooms (
  room_code       TEXT PRIMARY KEY,
  instance_id     TEXT NOT NULL,
  -- Nullable during the lease rollout so an older server can keep publishing
  -- its legacy row shape while instances are replaced one at a time.
  lease_id        TEXT,
  public_url      TEXT NOT NULL,
  -- Where a client should point its WebSocket to play in this room without
  -- leaving the page it is already on. Nullable: a row published by an older
  -- instance has no value, and the caller falls back to redirecting.
  socket_url      TEXT,
  player_count    INT NOT NULL DEFAULT 0,
  private         BOOLEAN NOT NULL DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_active_game_rooms_expiry ON active_game_rooms (expires_at);

-- Stores "people I played with" suggestions for the friends search button.
-- It is intentionally separate from friendships so accepted friends can be
-- filtered out without deleting the encounter history.
CREATE TABLE IF NOT EXISTS recent_player_encounters (
  account_id       BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  other_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, other_account_id),
  CHECK (account_id <> other_account_id)
);
CREATE INDEX IF NOT EXISTS idx_recent_player_encounters_seen ON recent_player_encounters (account_id, last_seen DESC);

CREATE TABLE IF NOT EXISTS news_messages (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  author_id   BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_news_messages_created ON news_messages (created_at DESC);

CREATE TABLE IF NOT EXISTS chat_logs (
  id         BIGSERIAL PRIMARY KEY,
  account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  name       TEXT,
  room_code  TEXT,
  message    TEXT NOT NULL,
  ip         TEXT,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_logs_ts ON chat_logs (ts DESC);
CREATE INDEX IF NOT EXISTS idx_chat_logs_room ON chat_logs (room_code, ts DESC);
CREATE INDEX IF NOT EXISTS idx_chat_logs_account ON chat_logs (account_id, ts DESC);

CREATE TABLE IF NOT EXISTS violations (
  id         BIGSERIAL PRIMARY KEY,
  account_id BIGINT REFERENCES accounts(id) ON DELETE CASCADE,
  device_id  TEXT,
  type       TEXT NOT NULL,
  detail     TEXT,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE violations ADD COLUMN IF NOT EXISTS device_id TEXT;
CREATE INDEX IF NOT EXISTS idx_violations_account ON violations (account_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_violations_ts ON violations (ts DESC);

CREATE TABLE IF NOT EXISTS app_migrations (
  key        TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ip_events (
  id         BIGSERIAL PRIMARY KEY,
  ip         TEXT NOT NULL,
  subnet     TEXT,
  event      TEXT NOT NULL,
  account_id BIGINT,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ip_events_ip ON ip_events (ip, ts DESC);
CREATE INDEX IF NOT EXISTS idx_ip_events_ts ON ip_events (ts DESC);

-- ---------------------------------------------------------------------
-- Columns, indexes and constraints added after the original tables.
-- These exist because the schema grew: each is written to be harmless on a
-- database that already has it, which is what makes the whole file re-runnable.
-- ---------------------------------------------------------------------
ALTER TABLE stats ADD COLUMN IF NOT EXISTS mvps BIGINT NOT NULL DEFAULT 0;

ALTER TABLE stats ADD COLUMN IF NOT EXISTS shots_fired BIGINT NOT NULL DEFAULT 0;

ALTER TABLE stats ADD COLUMN IF NOT EXISTS shots_hit BIGINT NOT NULL DEFAULT 0;

ALTER TABLE stats ADD COLUMN IF NOT EXISTS xp BIGINT NOT NULL DEFAULT 0;

ALTER TABLE stats ADD COLUMN IF NOT EXISTS mowbucks BIGINT NOT NULL DEFAULT 0;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS recovery_code_ciphertext TEXT;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS healthshot_used BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS trade_up_tutorial_seen BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE active_game_rooms ADD COLUMN IF NOT EXISTS lease_id TEXT;

ALTER TABLE active_game_rooms ADD COLUMN IF NOT EXISTS socket_url TEXT;

ALTER TABLE active_game_rooms ALTER COLUMN lease_id DROP NOT NULL;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_role_check') THEN
        ALTER TABLE accounts ADD CONSTRAINT accounts_role_check CHECK (role IN ('user', 'admin', 'owner'));
      END IF;
    END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_single_owner ON accounts (role) WHERE role = 'owner';

ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS price BIGINT NOT NULL DEFAULT 0;

ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS collection_name TEXT NOT NULL DEFAULT '';
ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS design_id TEXT NOT NULL DEFAULT 'auto';

ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS visible_in_market BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS available_from TIMESTAMPTZ;

ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS available_until TIMESTAMPTZ;

ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS show_time_remaining BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS discount_price BIGINT;

ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS discount_mode TEXT NOT NULL DEFAULT 'none';

ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS discount_starts_at TIMESTAMPTZ;

ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS discount_ends_at TIMESTAMPTZ;

ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS final_discount_minutes INT NOT NULL DEFAULT 0;

DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_cases_discount_mode_check') THEN
        ALTER TABLE custom_cases ADD CONSTRAINT custom_cases_discount_mode_check CHECK (discount_mode IN ('none', 'window', 'final'));
      END IF;
    END $$;

ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS rarity_mode TEXT NOT NULL DEFAULT 'skin';

ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS rarity_weights_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE daily_challenge_templates ADD COLUMN IF NOT EXISTS period TEXT NOT NULL DEFAULT 'daily';

ALTER TABLE daily_challenge_templates ADD COLUMN IF NOT EXISTS map_id TEXT;

ALTER TABLE daily_challenge_templates DROP CONSTRAINT IF EXISTS daily_challenge_templates_metric_check;

ALTER TABLE daily_challenge_templates ADD CONSTRAINT daily_challenge_templates_metric_check CHECK (metric IN ('kills', 'headshots', 'damage', 'utilityKills', 'wins', 'mapWins', 'weaponKills'));

CREATE INDEX IF NOT EXISTS idx_challenge_templates_period_tier ON daily_challenge_templates (period, tier, enabled, sort_order, id);

ALTER TABLE skin_inventory ADD COLUMN IF NOT EXISTS pattern_seed INT NOT NULL DEFAULT 0;

ALTER TABLE skin_inventory ADD COLUMN IF NOT EXISTS rarity_tier TEXT;

ALTER TABLE skin_inventory ADD COLUMN IF NOT EXISTS wear_value DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE skin_inventory ADD COLUMN IF NOT EXISTS wear_seed INT NOT NULL DEFAULT 0;

ALTER TABLE skin_inventory ADD COLUMN IF NOT EXISTS collection_id TEXT;

CREATE INDEX IF NOT EXISTS idx_skin_inventory_collection ON skin_inventory (collection_id, rarity_tier) WHERE collection_id IS NOT NULL;

ALTER TABLE case_openings ADD COLUMN IF NOT EXISTS pattern_seed INT NOT NULL DEFAULT 0;

ALTER TABLE case_openings ADD COLUMN IF NOT EXISTS wear_value DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE case_openings ADD COLUMN IF NOT EXISTS wear_seed INT NOT NULL DEFAULT 0;

ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS pattern_seed INT NOT NULL DEFAULT 0;

ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS rarity_tier TEXT;

ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS wear_value DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS wear_seed INT NOT NULL DEFAULT 0;

ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS buyer_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS listing_type TEXT NOT NULL DEFAULT 'fixed';

ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS highest_bidder_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS bid_count INT NOT NULL DEFAULT 0;

DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'skin_market_listings_listing_type_check') THEN
        ALTER TABLE skin_market_listings
          ADD CONSTRAINT skin_market_listings_listing_type_check CHECK (listing_type IN ('fixed', 'auction'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'skin_market_listings_bid_count_check') THEN
        ALTER TABLE skin_market_listings
          ADD CONSTRAINT skin_market_listings_bid_count_check CHECK (bid_count >= 0);
      END IF;
    END $$;

CREATE INDEX IF NOT EXISTS idx_skin_market_auction_end ON skin_market_listings (ends_at) WHERE status = 'active' AND listing_type = 'auction';

CREATE INDEX IF NOT EXISTS idx_skin_market_buyer ON skin_market_listings (buyer_id, updated_at DESC);

ALTER TABLE skin_market_listings ALTER COLUMN inventory_id DROP NOT NULL;

DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM information_schema.referential_constraints
         WHERE constraint_name = 'skin_market_listings_inventory_id_fkey'
           AND delete_rule <> 'SET NULL'
      ) THEN
        ALTER TABLE skin_market_listings DROP CONSTRAINT skin_market_listings_inventory_id_fkey;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'skin_market_listings_inventory_id_fkey'
      ) THEN
        ALTER TABLE skin_market_listings
          ADD CONSTRAINT skin_market_listings_inventory_id_fkey
          FOREIGN KEY (inventory_id) REFERENCES skin_inventory(id) ON DELETE SET NULL;
      END IF;
    END $$;

ALTER TABLE stats ADD COLUMN IF NOT EXISTS weapon_kills JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE daily_stats ADD COLUMN IF NOT EXISTS weapon_kills JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;

-- ---------------------------------------------------------------------
-- Check it landed. Expect 33.
-- ---------------------------------------------------------------------
SELECT count(*) AS tables_created
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

-- Anything missing will be listed here. Expect no rows.
SELECT expected.name AS missing_table
  FROM (VALUES
          ('account_email_codes'),
          ('accounts'),
          ('active_game_rooms'),
          ('app_migrations'),
          ('bans'),
          ('case_inventory'),
          ('case_market_listings'),
          ('case_openings'),
          ('chat_logs'),
          ('cross_server_auth_handoffs'),
          ('custom_cases'),
          ('daily_challenge_claims'),
          ('daily_challenge_progress'),
          ('daily_challenge_templates'),
          ('daily_stats'),
          ('daily_weapon_kills'),
          ('devices'),
          ('friendships'),
          ('ip_events'),
          ('news_messages'),
          ('recent_player_encounters'),
          ('sessions'),
          ('skin_collection_unlocks'),
          ('skin_inventory'),
          ('skin_loadouts'),
          ('skin_market_bids'),
          ('skin_market_listings'),
          ('skin_trade_requests'),
          ('stats'),
          ('trade_up_transactions'),
          ('violations'),
          ('weekly_challenge_rotations')
       ) AS expected(name)
 WHERE NOT EXISTS (
   SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = expected.name
 );
