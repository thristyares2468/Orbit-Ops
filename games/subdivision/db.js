// Last updated: 16 July 2026
// db.js — Postgres data layer for Orbit Ops Subdivision.
//
// One pg Pool, idempotent schema init on boot, and all data-access (DAO)
// functions. The hot game loop never calls into here — only auth/login,
// periodic stat flush, ban-cache refresh, chat-log batch flush, and admin reads.
//
// Email is stored lowercased in a plain TEXT column with a UNIQUE index (no
// citext dependency, fully portable). pg_trgm is attempted for fast chat search
// but is optional — ILIKE works without it.

const crypto = require('crypto');
const { Pool } = require('pg');
const skins = require('./skins');
const tradeups = require('./tradeups');

const DATABASE_URL = process.env.DATABASE_URL || '';
const enabled = Boolean(DATABASE_URL);

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

const DB_POOL_MAX = boundedInteger(process.env.DATABASE_POOL_MAX, 6, 1, 20);
const DB_CONNECT_TIMEOUT_MS = boundedInteger(process.env.DATABASE_CONNECT_TIMEOUT_MS, 15000, 2000, 60000);
const DB_IDLE_TIMEOUT_MS = boundedInteger(process.env.DATABASE_IDLE_TIMEOUT_MS, 60000, 5000, 300000);
const DB_QUERY_TIMEOUT_MS = boundedInteger(process.env.DATABASE_QUERY_TIMEOUT_MS, 12000, 1000, 60000);
const DB_MAX_LIFETIME_SECONDS = boundedInteger(process.env.DATABASE_MAX_LIFETIME_SECONDS, 900, 60, 3600);
const TRANSIENT_DATABASE_CODES = new Set([
  '08000', '08001', '08003', '08004', '08006',
  '53300', '53400', '57P01', '57P02', '57P03'
]);
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'ENETRESET', 'EAI_AGAIN'
]);

// Decide whether to use TLS for the DB connection.
//  - Railway's PRIVATE network (postgres.railway.internal) and localhost do NOT speak TLS.
//  - Railway's PUBLIC proxy (*.proxy.rlwy.net / *.railway.app) requires TLS.
// Override with DATABASE_SSL=disable|require if auto-detection is ever wrong.
function resolveSsl(url) {
  const mode = (process.env.DATABASE_SSL || '').toLowerCase();
  if (mode === 'disable' || mode === 'false' || mode === 'off') return false;
  if (mode === 'require' || mode === 'true' || mode === 'on') return { rejectUnauthorized: false };
  if (/localhost|127\.0\.0\.1|::1|\.railway\.internal/i.test(url)) return false;
  return { rejectUnauthorized: false };
}

let pool = null;
if (enabled) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: resolveSsl(DATABASE_URL),
    max: DB_POOL_MAX,
    min: 0,
    idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
    query_timeout: DB_QUERY_TIMEOUT_MS,
    statement_timeout: DB_QUERY_TIMEOUT_MS,
    idle_in_transaction_session_timeout: Math.max(DB_QUERY_TIMEOUT_MS, 15000),
    keepAlive: true,
    keepAliveInitialDelayMillis: 5000,
    maxLifetimeSeconds: DB_MAX_LIFETIME_SECONDS,
    application_name: process.env.DATABASE_APPLICATION_NAME || 'orbit-ops-subdivision'
  });
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));
}

function isEnabled() {
  return enabled;
}

function isTransientDatabaseError(error) {
  const code = String(error?.code || '');
  return TRANSIENT_DATABASE_CODES.has(code) || TRANSIENT_NETWORK_CODES.has(code);
}

function isRetryableRead(text) {
  const sql = String(text || '').trim();
  return /^(SELECT|SHOW)\b/i.test(sql) && !/\bFOR\s+(UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b/i.test(sql);
}

function retryDelay(attempt) {
  return new Promise(resolve => setTimeout(resolve, 125 * attempt));
}

async function query(text, params) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  try {
    return await pool.query(text, params);
  } catch (error) {
    if (!isRetryableRead(text) || !isTransientDatabaseError(error)) throw error;
    await retryDelay(1);
    return pool.query(text, params);
  }
}

async function withUsernameLock(username, fn) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext(lower($1))::bigint)', [username]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const DDL = `
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
`;

// Client settings, kept with the account so they follow a player between
// devices and between the embedded and standalone deployments. Stored as one
// blob because that is exactly how the client already keeps them - the server
// never reads a field, it only hands the object back.
async function getAccountSettings(accountId) {
  if (!accountId) return null;
  const { rows } = await query('SELECT settings_json FROM accounts WHERE id = $1', [accountId]);
  const stored = rows[0]?.settings_json;
  return stored && typeof stored === 'object' ? stored : null;
}

async function saveAccountSettings(accountId, settings) {
  if (!accountId || !settings || typeof settings !== 'object') return false;
  const encoded = JSON.stringify(settings);
  // A settings blob is a few hundred bytes; anything approaching this is either
  // a bug or someone stuffing the column, and neither should be stored.
  if (encoded.length > 16384) return false;
  const { rowCount } = await query(
    'UPDATE accounts SET settings_json = $2::jsonb WHERE id = $1',
    [accountId, encoded]
  );
  return rowCount > 0;
}

// --- owner tools -------------------------------------------------------
// Reading and adjusting other players' balances, and putting a skin into an
// account directly. Both are owner/admin surfaces, so both are written to be
// auditable: nothing here adjusts silently, and every write returns the value
// it produced so the caller can show what actually happened.

async function listAccountBalances({ search = '', limit = 100 } = {}) {
  const term = String(search || '').trim().toLowerCase();
  const rows = await query(
    `SELECT a.id, a.username, a.role, COALESCE(s.mowbucks, 0) AS mowbucks,
            COALESCE(s.xp, 0) AS xp
       FROM accounts a
       LEFT JOIN stats s ON s.account_id = a.id
      WHERE ($1 = '' OR lower(a.username) LIKE '%' || $1 || '%')
      ORDER BY COALESCE(s.mowbucks, 0) DESC, a.username ASC
      LIMIT $2`,
    [term, Math.max(1, Math.min(500, Number(limit) || 100))]
  );
  return rows.rows.map((row) => ({
    accountId: Number(row.id),
    username: row.username,
    role: row.role,
    mowbucks: Number(row.mowbucks || 0),
    xp: Number(row.xp || 0)
  }));
}

// Set to an exact figure rather than adjusting by a delta: an owner correcting a
// balance is thinking of the number it should be, and a delta applied twice is a
// mistake that is hard to notice.
async function setMowbucks(accountId, amount) {
  const safe = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(amount) || 0)));
  const { rows } = await query(
    `INSERT INTO stats (account_id, mowbucks) VALUES ($1, $2)
     ON CONFLICT (account_id) DO UPDATE SET mowbucks = EXCLUDED.mowbucks, updated_at = now()
     RETURNING mowbucks`,
    [accountId, safe]
  );
  return Number(rows[0]?.mowbucks ?? 0);
}

async function listAccountRoles({ search = '', limit = 100 } = {}) {
  const term = String(search || '').trim().toLowerCase();
  const { rows } = await query(
    `SELECT id, username, role
       FROM accounts
      WHERE ($1 = '' OR lower(username) LIKE '%' || $1 || '%')
      ORDER BY (role = 'owner') DESC, (role = 'admin') DESC, username ASC
      LIMIT $2`,
    [term, Math.max(1, Math.min(500, Number(limit) || 100))]
  );
  return rows.map((row) => ({ accountId: Number(row.id), username: row.username, role: row.role }));
}

// Roles are user/admin/owner, and owner is a singleton - a partial unique
// index (uq_accounts_single_owner) forbids two accounts holding it at once.
// Promoting a new owner is therefore an ownership *transfer*, not just a
// grant: the current holder is stepped down to admin in the same transaction
// so the index is never violated and there is never a moment with two owners.
//
// There is no path here that can reach zero owners. The only way to lose
// owner status is to be replaced by this same transfer, which always leaves
// exactly one. The caller in server.js additionally refuses to let an owner
// target themselves, which is what stops an owner demoting themselves into
// that gap by hand.
async function setAccountRole({ accountId, role }) {
  const nextRole = String(role || '').trim().toLowerCase();
  if (!['user', 'admin', 'owner'].includes(nextRole)) return { ok: false, reason: 'invalid' };
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const id = Number(accountId);
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, reason: 'invalid' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query(`SELECT id FROM accounts WHERE id = $1 FOR UPDATE`, [id]);
    if (!target.rows[0]) { await client.query('ROLLBACK'); return { ok: false, reason: 'missing' }; }

    let previousOwnerId = null;
    if (nextRole === 'owner') {
      const demoted = await client.query(
        `UPDATE accounts SET role = 'admin' WHERE role = 'owner' AND id <> $1 RETURNING id`,
        [id]
      );
      previousOwnerId = demoted.rows[0] ? Number(demoted.rows[0].id) : null;
    }

    const updated = await client.query(
      `UPDATE accounts SET role = $2 WHERE id = $1 RETURNING id, username, role`,
      [id, nextRole]
    );
    await client.query('COMMIT');
    const row = updated.rows[0];
    return {
      ok: true,
      account: { id: Number(row.id), username: row.username, role: row.role },
      previousOwnerId
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function findAccountByUsername(username) {
  const { rows } = await query(
    'SELECT id, username, role FROM accounts WHERE lower(username) = lower($1) LIMIT 1',
    [String(username || '').trim()]
  );
  return rows[0] || null;
}

// Put a skin straight into an account. Wear and pattern are rolled the same way
// a case roll would, so a granted skin is indistinguishable from an earned one
// in every respect except its source, which is recorded as 'admin'.
// wearValue is optional: left out, it rolls like a case would. The admin
// inventory editor passes one so a grant can be given a chosen condition
// instead of a random one.
async function grantSkinToAccount({ accountId, itemId, rarityTier = null, wearValue: requestedWear } = {}) {
  if (!accountId || !itemId) return null;
  const patternSeed = Math.floor(Math.random() * 1000) + 1;
  const wearSeed = Math.floor(Math.random() * 1000000);
  const asked = Number(requestedWear);
  const wearValue = Number.isFinite(asked) ? Math.max(0, Math.min(1, asked)) : Math.random();
  const { rows } = await query(
    `INSERT INTO skin_inventory (account_id, item_id, source, pattern_seed, rarity_tier, wear_value, wear_seed)
     VALUES ($1, $2, 'admin', $3, $4, $5, $6)
     RETURNING id, item_id, wear_value, pattern_seed`,
    [accountId, String(itemId), patternSeed, rarityTier, wearValue, wearSeed]
  );
  return rows[0] || null;
}

async function initDb() {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  await pool.query(DDL);
  // Optional extension for fast free-text chat search; ignore if not permitted.
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_chat_logs_msg_trgm ON chat_logs USING gin (message gin_trgm_ops)'
    );
  } catch (e) {
    console.warn('[db] pg_trgm unavailable, chat search will use plain ILIKE:', e.message);
  }
  await pool.query(`ALTER TABLE stats ADD COLUMN IF NOT EXISTS mvps BIGINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE stats ADD COLUMN IF NOT EXISTS shots_fired BIGINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE stats ADD COLUMN IF NOT EXISTS shots_hit BIGINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE stats ADD COLUMN IF NOT EXISTS xp BIGINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE stats ADD COLUMN IF NOT EXISTS mowbucks BIGINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT true`);
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS recovery_code_ciphertext TEXT`);
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS healthshot_used BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS trade_up_tutorial_seen BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE active_game_rooms ADD COLUMN IF NOT EXISTS lease_id TEXT`);
  await pool.query(`ALTER TABLE active_game_rooms ADD COLUMN IF NOT EXISTS socket_url TEXT`);
  await pool.query(`ALTER TABLE active_game_rooms ALTER COLUMN lease_id DROP NOT NULL`);
  await pool.query(`UPDATE active_game_rooms SET lease_id = 'legacy:' || instance_id WHERE lease_id IS NULL`);
  // Keep this column nullable for expand/contract compatibility. A server from
  // before the lease rollout omits lease_id when it publishes; PostgreSQL can
  // therefore accept old and new writers throughout a rolling deployment.
  // New writers always supply a random lease and never match a NULL legacy
  // lease, so ownership-scoped renewal and cleanup remain fail-closed.
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'`);
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS settings_json JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_role_check') THEN
        ALTER TABLE accounts ADD CONSTRAINT accounts_role_check CHECK (role IN ('user', 'admin', 'owner'));
      END IF;
    END $$
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_single_owner ON accounts (role) WHERE role = 'owner'`);
  await pool.query(`ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS price BIGINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS collection_name TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS design_id TEXT NOT NULL DEFAULT 'auto'`);
  await pool.query(`ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS visible_in_market BOOLEAN NOT NULL DEFAULT true`);
  await pool.query(`ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS available_from TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS available_until TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS show_time_remaining BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS discount_price BIGINT`);
  await pool.query(`ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS discount_mode TEXT NOT NULL DEFAULT 'none'`);
  await pool.query(`ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS discount_starts_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS discount_ends_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS final_discount_minutes INT NOT NULL DEFAULT 0`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_cases_discount_mode_check') THEN
        ALTER TABLE custom_cases ADD CONSTRAINT custom_cases_discount_mode_check CHECK (discount_mode IN ('none', 'window', 'final'));
      END IF;
    END $$
  `);
  await pool.query(`ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS rarity_mode TEXT NOT NULL DEFAULT 'skin'`);
  await pool.query(`ALTER TABLE custom_cases ADD COLUMN IF NOT EXISTS rarity_weights_json JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE daily_challenge_templates ADD COLUMN IF NOT EXISTS period TEXT NOT NULL DEFAULT 'daily'`);
  await pool.query(`ALTER TABLE daily_challenge_templates ADD COLUMN IF NOT EXISTS map_id TEXT`);
  await pool.query(`ALTER TABLE daily_challenge_templates DROP CONSTRAINT IF EXISTS daily_challenge_templates_metric_check`);
  await pool.query(`ALTER TABLE daily_challenge_templates ADD CONSTRAINT daily_challenge_templates_metric_check CHECK (metric IN ('kills', 'headshots', 'damage', 'utilityKills', 'wins', 'mapWins', 'weaponKills'))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_challenge_templates_period_tier ON daily_challenge_templates (period, tier, enabled, sort_order, id)`);
  await pool.query(`ALTER TABLE skin_inventory ADD COLUMN IF NOT EXISTS pattern_seed INT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE skin_inventory ADD COLUMN IF NOT EXISTS rarity_tier TEXT`);
  await pool.query(`ALTER TABLE skin_inventory ADD COLUMN IF NOT EXISTS wear_value DOUBLE PRECISION NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE skin_inventory ADD COLUMN IF NOT EXISTS wear_seed INT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE skin_inventory ADD COLUMN IF NOT EXISTS collection_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_skin_inventory_collection ON skin_inventory (collection_id, rarity_tier) WHERE collection_id IS NOT NULL`);
  await pool.query(`ALTER TABLE case_openings ADD COLUMN IF NOT EXISTS pattern_seed INT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE case_openings ADD COLUMN IF NOT EXISTS wear_value DOUBLE PRECISION NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE case_openings ADD COLUMN IF NOT EXISTS wear_seed INT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS pattern_seed INT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS rarity_tier TEXT`);
  await pool.query(`ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS wear_value DOUBLE PRECISION NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS wear_seed INT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS buyer_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS listing_type TEXT NOT NULL DEFAULT 'fixed'`);
  await pool.query(`ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS highest_bidder_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS bid_count INT NOT NULL DEFAULT 0`);
  await pool.query(`
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
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_skin_market_auction_end ON skin_market_listings (ends_at) WHERE status = 'active' AND listing_type = 'auction'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_skin_market_buyer ON skin_market_listings (buyer_id, updated_at DESC)`);
  await pool.query(`ALTER TABLE skin_market_listings ALTER COLUMN inventory_id DROP NOT NULL`);
  await pool.query(`
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
  `);
  // Active listings are a view of an inventory instance. Repair legacy/stale
  // snapshots before they can label a worn skin as Factory New.
  await pool.query(`
    UPDATE skin_market_listings listing
       SET item_id = inventory.item_id,
           pattern_seed = inventory.pattern_seed,
           rarity_tier = inventory.rarity_tier,
           wear_value = inventory.wear_value,
           wear_seed = inventory.wear_seed,
           updated_at = now()
      FROM skin_inventory inventory
     WHERE listing.status = 'active'
       AND listing.inventory_id = inventory.id
       AND listing.seller_id = inventory.account_id
       AND (listing.item_id, listing.pattern_seed, listing.rarity_tier, listing.wear_value, listing.wear_seed)
           IS DISTINCT FROM
           (inventory.item_id, inventory.pattern_seed, inventory.rarity_tier, inventory.wear_value, inventory.wear_seed)
  `);
  await pool.query(`ALTER TABLE stats ADD COLUMN IF NOT EXISTS weapon_kills JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE daily_stats ADD COLUMN IF NOT EXISTS weapon_kills JSONB NOT NULL DEFAULT '{}'::jsonb`);
  // Non-destructive consolidation: daily_weapon_kills remains as an untouched
  // rollback/archive table. Values are copied additively into daily_stats, and
  // all new reads/writes use the main row's weapon_kills JSON.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const requestedOwner = await client.query(
      `SELECT id, username, role FROM accounts
        WHERE lower(email) = lower($1) AND username = $2
        LIMIT 1`,
      ['jackherbig09@gmail.com', 'C.ディディ氏']
    );
    if (requestedOwner.rowCount) {
      const ownerPromotion = await client.query(
        `INSERT INTO app_migrations (key) VALUES ('promote_c_didishi_to_owner_2026_08_11')
         ON CONFLICT (key) DO NOTHING RETURNING key`
      );
      if (ownerPromotion.rowCount) {
        const accountId = requestedOwner.rows[0].id;
        await client.query(`UPDATE accounts SET role = 'admin' WHERE role = 'owner' AND id <> $1`, [accountId]);
        await client.query(`UPDATE accounts SET role = 'owner' WHERE id = $1`, [accountId]);
        console.log(`[db] promoted account ${accountId} (${requestedOwner.rows[0].username}) to owner`);
      }
      const soleAdminMigration = await client.query(
        `INSERT INTO app_migrations (key) VALUES ('make_c_didishi_sole_admin_2026_08_11')
         ON CONFLICT (key) DO NOTHING RETURNING key`
      );
      if (soleAdminMigration.rowCount) {
        const accountId = requestedOwner.rows[0].id;
        await client.query(`UPDATE accounts SET role = 'user' WHERE role IN ('admin', 'owner') AND id <> $1`, [accountId]);
        await client.query(`UPDATE accounts SET role = 'owner' WHERE id = $1`, [accountId]);
        console.log(`[db] removed administrator access from all accounts except ${accountId} (${requestedOwner.rows[0].username})`);
      }
    } else {
      console.warn('[db] requested owner account was not found; promotion will retry on the next startup');
    }
    if (requestedOwner.rowCount) {
      const accountId = requestedOwner.rows[0].id;
      await client.query(`UPDATE accounts SET role = 'admin' WHERE role = 'owner' AND id <> $1`, [accountId]);
      await client.query(`UPDATE accounts SET role = 'owner' WHERE id = $1`, [accountId]);
      console.log(`[db] confirmed account ${accountId} (${requestedOwner.rows[0].username}) as owner`);
    }
    const dailyWeaponConsolidation = await client.query(
      `INSERT INTO app_migrations (key) VALUES ('copy_daily_weapon_kills_into_daily_stats_2026_08_13')
       ON CONFLICT (key) DO NOTHING RETURNING key`
    );
    if (dailyWeaponConsolidation.rowCount) {
      await client.query(`
        INSERT INTO daily_stats (date_key, player_key, account_id, username, weapon_kills)
        SELECT legacy.date_key,
               'account:' || legacy.account_id,
               legacy.account_id,
               COALESCE(account.username, 'Player'),
               jsonb_object_agg(legacy.weapon, legacy.kills)
          FROM daily_weapon_kills legacy
          LEFT JOIN accounts account ON account.id = legacy.account_id
         GROUP BY legacy.date_key, legacy.account_id, account.username
        ON CONFLICT (date_key, player_key) DO UPDATE SET
          account_id = COALESCE(daily_stats.account_id, EXCLUDED.account_id),
          weapon_kills = (
            SELECT COALESCE(jsonb_object_agg(key, to_jsonb(total)), '{}'::jsonb)
              FROM (
                SELECT key, SUM(value::bigint) AS total
                  FROM (
                    SELECT key, value FROM jsonb_each_text(daily_stats.weapon_kills)
                    UNION ALL
                    SELECT key, value FROM jsonb_each_text(EXCLUDED.weapon_kills)
                  ) combined
                 GROUP BY key
              ) summed
          ),
          updated_at = now()
      `);
      console.log('[db] copied legacy daily weapon kills into daily_stats; source rows retained');
    }
    const marker = await client.query(
      `INSERT INTO app_migrations (key) VALUES ('clear_false_console_violations_2026_06_21')
       ON CONFLICT (key) DO NOTHING RETURNING key`
    );
    if (marker.rowCount) {
      await client.query('DELETE FROM violations');
      await client.query('UPDATE accounts SET strikes = 0');
      console.log('[db] cleared legacy false-positive violations');
    }
    const inventoryReset = await client.query(
      `INSERT INTO app_migrations (key) VALUES ('clear_all_inventories_2026_07_10')
       ON CONFLICT (key) DO NOTHING RETURNING key`
    );
    if (inventoryReset.rowCount) {
      await client.query(`UPDATE skin_market_listings SET status = 'cancelled', updated_at = now() WHERE status = 'active'`);
      await client.query(`UPDATE case_market_listings SET status = 'cancelled', updated_at = now() WHERE status = 'active'`);
      await client.query(`UPDATE skin_trade_requests SET status = 'cancelled', updated_at = now() WHERE status = 'pending'`);
      await client.query('DELETE FROM skin_loadouts');
      await client.query('DELETE FROM case_inventory');
      const cleared = await client.query('DELETE FROM skin_inventory');
      console.log(`[db] cleared ${cleared.rowCount} inventory item${cleared.rowCount === 1 ? '' : 's'} for the economy reset`);
    }
    const collectionBackfill = await client.query(
      `INSERT INTO app_migrations (key) VALUES ('backfill_skin_inventory_collections_2026_07_14')
       ON CONFLICT (key) DO NOTHING RETURNING key`
    );
    if (collectionBackfill.rowCount) {
      const backfilled = await client.query(
        `UPDATE skin_inventory
            SET collection_id = substring(source FROM 6)
          WHERE collection_id IS NULL AND source LIKE 'case:%'`
      );
      console.log(`[db] backfilled ${backfilled.rowCount} legacy inventory collection${backfilled.rowCount === 1 ? '' : 's'}`);
    }
    const wearBackfill = await client.query(
      `INSERT INTO app_migrations (key) VALUES ('backfill_skin_wear_2026_07_11')
       ON CONFLICT (key) DO NOTHING RETURNING key`
    );
    if (wearBackfill.rowCount) {
      await client.query(
        `UPDATE skin_inventory
            SET wear_value = random(),
                wear_seed = 1 + floor(random() * 2147483646)::int
          WHERE item_id NOT IN ('knife_default_ct_vanilla', 'knife_default_t_vanilla')
            AND wear_seed = 0`
      );
      await client.query(
        `UPDATE skin_inventory i
            SET rarity_tier = o.rarity_tier
           FROM case_openings o
          WHERE o.inventory_id = i.id AND i.rarity_tier IS NULL`
      );
      await client.query(
        `UPDATE case_openings o
            SET wear_value = i.wear_value, wear_seed = i.wear_seed
           FROM skin_inventory i
          WHERE o.inventory_id = i.id AND o.wear_seed = 0`
      );
      await client.query(
        `UPDATE skin_market_listings l
            SET rarity_tier = COALESCE(l.rarity_tier, i.rarity_tier),
                wear_value = i.wear_value,
                wear_seed = i.wear_seed
           FROM skin_inventory i
          WHERE l.inventory_id = i.id AND l.wear_seed = 0`
      );
      console.log('[db] assigned persistent wear to existing non-default skins');
    }
    const patternRangeMigration = await client.query(
      `INSERT INTO app_migrations (key) VALUES ('normalize_pattern_seeds_1_1000_2026_07_11')
       ON CONFLICT (key) DO NOTHING RETURNING key`
    );
    if (patternRangeMigration.rowCount) {
      for (const table of ['skin_inventory', 'case_openings', 'skin_market_listings']) {
        await client.query(
          `UPDATE ${table}
              SET pattern_seed = 1 + MOD(pattern_seed - 1, 1000)
            WHERE pattern_seed > 1000`
        );
      }
      console.log('[db] normalized existing pattern indices to the 1-1000 range');
    }
    const challengeSeed = await client.query(
      `INSERT INTO app_migrations (key) VALUES ('seed_daily_challenge_templates_2026_07_11')
       ON CONFLICT (key) DO NOTHING RETURNING key`
    );
    if (challengeSeed.rowCount) {
      await client.query(
        `INSERT INTO daily_challenge_templates (id, tier, metric, label, target, xp, weapon, sort_order) VALUES
          ('easy_kills_10', 'easy', 'kills', 'Get {target} kills', 10, 100, NULL, 10),
          ('easy_headshots_5', 'easy', 'headshots', 'Get {target} headshot kills', 5, 100, NULL, 20),
          ('easy_damage_1000', 'easy', 'damage', 'Deal {target} damage', 1000, 100, NULL, 30),
          ('easy_utility_2', 'easy', 'utilityKills', 'Get {target} utility kills', 2, 100, NULL, 40),
          ('easy_wins_1', 'easy', 'wins', 'Win {target} game', 1, 100, NULL, 50),
          ('medium_kills_40', 'medium', 'kills', 'Get {target} kills', 40, 300, NULL, 10),
          ('medium_headshots_15', 'medium', 'headshots', 'Get {target} headshot kills', 15, 300, NULL, 20),
          ('medium_damage_4000', 'medium', 'damage', 'Deal {target} damage', 4000, 300, NULL, 30),
          ('medium_utility_6', 'medium', 'utilityKills', 'Get {target} utility kills', 6, 300, NULL, 40),
          ('medium_wins_3', 'medium', 'wins', 'Win {target} games', 3, 300, NULL, 50),
          ('hard_weapon_25', 'hard', 'weaponKills', 'Get {target} kills with {weapon}', 25, 450, 'AUTO', 10),
          ('hard_kills_100', 'hard', 'kills', 'Get {target} kills', 100, 450, NULL, 20),
          ('hard_headshots_40', 'hard', 'headshots', 'Get {target} headshot kills', 40, 450, NULL, 30),
          ('hard_damage_10000', 'hard', 'damage', 'Deal {target} damage', 10000, 450, NULL, 40),
          ('hard_wins_8', 'hard', 'wins', 'Win {target} games', 8, 450, NULL, 50)
         ON CONFLICT (id) DO NOTHING`
      );
      await client.query(
        `INSERT INTO daily_challenge_templates (id, tier, metric, label, target, xp, map_id, sort_order) VALUES
          ('easy_map_win_dust2', 'easy', 'mapWins', 'Win {target} game on {map}', 1, 100, 'dust2', 60),
          ('medium_map_wins_nuke', 'medium', 'mapWins', 'Win {target} games on {map}', 3, 300, 'nuke', 60)
         ON CONFLICT (id) DO NOTHING`
      );
      console.log('[db] seeded editable daily challenge templates');
    }
    const weeklyChallengeSeed = await client.query(
      `INSERT INTO app_migrations (key) VALUES ('seed_weekly_challenge_templates_2026_07_14')
       ON CONFLICT (key) DO NOTHING RETURNING key`
    );
    if (weeklyChallengeSeed.rowCount) {
      await client.query(
        `INSERT INTO daily_challenge_templates (id, period, tier, metric, label, target, xp, weapon, sort_order) VALUES
          ('weekly_easy_kills_50', 'weekly', 'easy', 'kills', 'Get {target} kills', 50, 500, NULL, 10),
          ('weekly_easy_damage_10000', 'weekly', 'easy', 'damage', 'Deal {target} damage', 10000, 500, NULL, 20),
          ('weekly_medium_kills_150', 'weekly', 'medium', 'kills', 'Get {target} kills', 150, 1200, NULL, 10),
          ('weekly_medium_wins_8', 'weekly', 'medium', 'wins', 'Win {target} games', 8, 1200, NULL, 20),
          ('weekly_hard_weapon_100', 'weekly', 'hard', 'weaponKills', 'Get {target} kills with {weapon}', 100, 2000, 'AUTO', 10),
          ('weekly_hard_damage_50000', 'weekly', 'hard', 'damage', 'Deal {target} damage', 50000, 2000, NULL, 20)
         ON CONFLICT (id) DO NOTHING`
      );
      await client.query(
        `INSERT INTO daily_challenge_templates (id, period, tier, metric, label, target, xp, map_id, sort_order) VALUES
          ('weekly_medium_map_wins_inferno', 'weekly', 'medium', 'mapWins', 'Win {target} games on {map}', 5, 1200, 'inferno', 30),
          ('weekly_hard_map_wins_mirage', 'weekly', 'hard', 'mapWins', 'Win {target} games on {map}', 10, 2000, 'mirage', 30)
         ON CONFLICT (id) DO NOTHING`
      );
      console.log('[db] seeded editable weekly challenge templates');
    }
    const mapWinChallengeSeed = await client.query(
      `INSERT INTO app_migrations (key) VALUES ('seed_map_win_challenges_2026_08_13')
       ON CONFLICT (key) DO NOTHING RETURNING key`
    );
    if (mapWinChallengeSeed.rowCount) {
      await client.query(
        `INSERT INTO daily_challenge_templates (id, period, tier, metric, label, target, xp, map_id, sort_order) VALUES
          ('easy_map_win_dust2', 'daily', 'easy', 'mapWins', 'Win {target} game on {map}', 1, 100, 'dust2', 60),
          ('medium_map_wins_nuke', 'daily', 'medium', 'mapWins', 'Win {target} games on {map}', 3, 300, 'nuke', 60),
          ('weekly_medium_map_wins_inferno', 'weekly', 'medium', 'mapWins', 'Win {target} games on {map}', 5, 1200, 'inferno', 30),
          ('weekly_hard_map_wins_mirage', 'weekly', 'hard', 'mapWins', 'Win {target} games on {map}', 10, 2000, 'mirage', 30)
         ON CONFLICT (id) DO NOTHING`
      );
      console.log('[db] seeded map-specific win challenges');
    }
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
  console.log('[db] schema ready');
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

async function createAccount({ email, emailDomain, passwordHash, username }) {
  return withUsernameLock(username, async (client) => {
    const existing = await client.query(
      `SELECT 1 FROM accounts WHERE lower(username) = lower($1) LIMIT 1`,
      [username]
    );
    if (existing.rows.length) throw new Error('username duplicate');

    const { rows } = await client.query(
      `INSERT INTO accounts (email, email_domain, password_hash, username)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, email_verified, username, role, healthshot_used, status, strikes, created_at`,
      [email.toLowerCase(), emailDomain.toLowerCase(), passwordHash, username]
    );
    // Lazily create the stats row.
    await client.query(`INSERT INTO stats (account_id) VALUES ($1) ON CONFLICT DO NOTHING`, [rows[0].id]);
    return rows[0];
  });
}

async function getAccountByEmail(email) {
  const { rows } = await query(
    `SELECT id, email, email_verified, username, password_hash, role, healthshot_used, status, strikes FROM accounts WHERE lower(email) = lower($1)`,
    [email]
  );
  return rows[0] || null;
}

async function getAccountById(id) {
  const { rows } = await query(
    `SELECT id, email, email_domain, email_verified, username, role, healthshot_used, status, strikes, created_at, last_login FROM accounts WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function getAccountForRecovery(email, username) {
  const { rows } = await query(
    `SELECT id, email, username, password_hash, recovery_code_ciphertext
       FROM accounts
      WHERE lower(email) = lower($1) AND lower(username) = lower($2)`,
    [email, username]
  );
  return rows[0] || null;
}

async function getRecoveryCodeCiphertext(accountId) {
  const { rows } = await query(`SELECT recovery_code_ciphertext FROM accounts WHERE id = $1`, [accountId]);
  return rows[0]?.recovery_code_ciphertext || null;
}

async function setRecoveryCodeCiphertext(accountId, ciphertext) {
  await query(`UPDATE accounts SET recovery_code_ciphertext = $2 WHERE id = $1`, [accountId, ciphertext]);
}

async function emailExists(email) {
  const { rows } = await query(`SELECT 1 FROM accounts WHERE lower(email) = lower($1) LIMIT 1`, [email]);
  return rows.length > 0;
}

async function usernameExists(username, exceptAccountId = null) {
  const { rows } = await query(
    `SELECT 1 FROM accounts
      WHERE lower(username) = lower($1)
        AND ($2::bigint IS NULL OR id <> $2)
      LIMIT 1`,
    [username, exceptAccountId || null]
  );
  return rows.length > 0;
}

async function setLastLogin(accountId) {
  await query(`UPDATE accounts SET last_login = now() WHERE id = $1`, [accountId]);
}

async function setAccountStatus(accountId, status) {
  await query(`UPDATE accounts SET status = $2 WHERE id = $1`, [accountId, status]);
}

async function updateUsername(accountId, username) {
  return withUsernameLock(username, async (client) => {
    const existing = await client.query(
      `SELECT 1 FROM accounts
        WHERE lower(username) = lower($1)
          AND id <> $2
        LIMIT 1`,
      [username, accountId]
    );
    if (existing.rows.length) throw new Error('username duplicate');

    const { rows } = await client.query(
      `UPDATE accounts SET username = $2 WHERE id = $1 RETURNING id, email, email_verified, username, status, strikes`,
      [accountId, username]
    );
    return rows[0] || null;
  });
}

async function updatePassword(accountId, passwordHash) {
  const { rows } = await query(
    `UPDATE accounts SET password_hash = $2 WHERE id = $1 RETURNING id, email, username, status`,
    [accountId, passwordHash]
  );
  return rows[0] || null;
}

async function updatePasswordAndRecoveryCode(accountId, passwordHash, recoveryCodeCiphertext) {
  const { rows } = await query(
    `UPDATE accounts
        SET password_hash = $2, recovery_code_ciphertext = $3
      WHERE id = $1
      RETURNING id, email, username, status`,
    [accountId, passwordHash, recoveryCodeCiphertext]
  );
  return rows[0] || null;
}

async function updateEmail(accountId, email, emailDomain) {
  const { rows } = await query(
    `UPDATE accounts
        SET email = $2, email_domain = $3, email_verified = true
      WHERE id = $1
      RETURNING id, email, email_verified, username, status`,
    [accountId, email.toLowerCase(), emailDomain.toLowerCase()]
  );
  return rows[0] || null;
}

async function updateEmailAndRecoveryCode(accountId, email, emailDomain, recoveryCodeCiphertext) {
  const { rows } = await query(
    `UPDATE accounts
        SET email = $2, email_domain = $3, email_verified = true, recovery_code_ciphertext = $4
      WHERE id = $1
      RETURNING id, email, email_verified, username, status`,
    [accountId, email.toLowerCase(), emailDomain.toLowerCase(), recoveryCodeCiphertext]
  );
  return rows[0] || null;
}

async function markHealthshotUsed(accountId) {
  await query(`UPDATE accounts SET healthshot_used = true WHERE id = $1 AND healthshot_used = false`, [accountId]);
}

async function getTradeUpTutorialSeen(accountId) {
  const { rows } = await query(`SELECT trade_up_tutorial_seen FROM accounts WHERE id = $1`, [accountId]);
  return !!rows[0]?.trade_up_tutorial_seen;
}

async function markTradeUpTutorialSeen(accountId) {
  await query(
    `UPDATE accounts SET trade_up_tutorial_seen = true WHERE id = $1 AND trade_up_tutorial_seen = false`,
    [accountId]
  );
}

async function createEmailCode({ purpose, accountId = null, email, emailDomain = null, username = null, passwordHash = null, codeHash, expiresAt }) {
  const safePurpose = String(purpose || '').trim();
  if (!['register', 'password_reset', 'email_change'].includes(safePurpose)) throw new Error('bad_email_code_purpose');
  const safeEmail = String(email || '').trim().toLowerCase();
  await query(
    `UPDATE account_email_codes
        SET consumed_at = now()
      WHERE purpose = $1
        AND consumed_at IS NULL
        AND (
          ($2::bigint IS NOT NULL AND account_id = $2)
          OR lower(email) = lower($3)
        )`,
    [safePurpose, accountId || null, safeEmail]
  );
  const { rows } = await query(
    `INSERT INTO account_email_codes
       (purpose, account_id, email, email_domain, username, password_hash, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, purpose, account_id, email, email_domain, username, password_hash, attempts, created_at, expires_at`,
    [safePurpose, accountId || null, safeEmail, emailDomain || null, username || null, passwordHash || null, codeHash, expiresAt]
  );
  return rows[0] || null;
}

async function getLatestEmailCode({ purpose, email, accountId = null }) {
  const { rows } = await query(
    `SELECT id, purpose, account_id, email, email_domain, username, password_hash, code_hash, attempts, created_at, expires_at
       FROM account_email_codes
      WHERE purpose = $1
        AND consumed_at IS NULL
        AND expires_at > now()
        AND lower(email) = lower($2)
        AND ($3::bigint IS NULL OR account_id = $3)
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [purpose, String(email || '').trim().toLowerCase(), accountId || null]
  );
  return rows[0] || null;
}

async function incrementEmailCodeAttempts(id) {
  const { rows } = await query(
    `UPDATE account_email_codes SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`,
    [id]
  );
  return Number(rows[0]?.attempts || 0);
}

async function consumeEmailCode(id) {
  await query(`UPDATE account_email_codes SET consumed_at = now() WHERE id = $1`, [id]);
}

async function incStrikes(accountId, by = 1) {
  const { rows } = await query(
    `UPDATE accounts SET strikes = strikes + $2 WHERE id = $1 RETURNING strikes`,
    [accountId, by]
  );
  return rows[0]?.strikes ?? 0;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

async function createSession({ tokenHash, accountId, deviceId, ip }) {
  // One session per account: replace any existing row.
  await query(`DELETE FROM sessions WHERE account_id = $1`, [accountId]);
  await query(
    `INSERT INTO sessions (token_hash, account_id, device_id, ip) VALUES ($1, $2, $3, $4)`,
    [tokenHash, accountId, deviceId || null, ip || null]
  );
}

async function getSession(tokenHash) {
  const { rows } = await query(
    `SELECT token_hash, account_id, device_id, ip, last_seen FROM sessions WHERE token_hash = $1`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function deleteSession(tokenHash) {
  await query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}

async function deleteSessionByAccount(accountId) {
  await query(`DELETE FROM sessions WHERE account_id = $1`, [accountId]);
}

async function touchSession(tokenHash) {
  await query(`UPDATE sessions SET last_seen = now() WHERE token_hash = $1`, [tokenHash]);
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

async function upsertDevice({ deviceId, fingerprint, accountId }) {
  await query(
    `INSERT INTO devices (device_id, fingerprint, accounts_seen)
       VALUES ($1, $2, ARRAY[$3::bigint])
     ON CONFLICT (device_id) DO UPDATE SET
       last_seen = now(),
       fingerprint = COALESCE(EXCLUDED.fingerprint, devices.fingerprint),
       accounts_seen = (
         SELECT ARRAY(SELECT DISTINCT unnest(devices.accounts_seen || ARRAY[$3::bigint]))
       )`,
    [deviceId, fingerprint || null, accountId]
  );
}

async function getDevice(deviceId) {
  const { rows } = await query(`SELECT * FROM devices WHERE device_id = $1`, [deviceId]);
  return rows[0] || null;
}

// Accounts that have ever appeared on this device OR share its fingerprint.
async function getAccountsForDeviceOrFingerprint(deviceId, fingerprint) {
  const { rows } = await query(
    `SELECT DISTINCT a.id, a.status
       FROM devices d
       CROSS JOIN LATERAL unnest(d.accounts_seen) AS acc(id)
       JOIN accounts a ON a.id = acc.id
      WHERE d.device_id = $1 OR ($2 <> '' AND d.fingerprint = $2)`,
    [deviceId || '', fingerprint || '']
  );
  return rows;
}

// Admin: clusters of accounts that share a device or fingerprint.
async function findAltClusters(limit = 200) {
  const { rows } = await query(
    `SELECT d.device_id, d.fingerprint, d.accounts_seen,
            COALESCE(array_agg(a.username ORDER BY a.username) FILTER (WHERE a.username IS NOT NULL), '{}') AS usernames
       FROM devices d
       LEFT JOIN LATERAL unnest(d.accounts_seen) AS seen(account_id) ON true
       LEFT JOIN accounts a ON a.id = seen.account_id
      WHERE array_length(d.accounts_seen, 1) > 1
      GROUP BY d.device_id, d.fingerprint, d.accounts_seen, d.last_seen
      ORDER BY d.last_seen DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Bans
// ---------------------------------------------------------------------------

async function createBan({ scope, accountId, deviceId, reason, byAdmin, expiresAt }) {
  const { rows } = await query(
    `INSERT INTO bans (scope, account_id, device_id, reason, by_admin, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [scope, accountId || null, deviceId || null, reason, byAdmin || 'admin', expiresAt || null]
  );
  if (scope === 'account' && accountId && !expiresAt) await setAccountStatus(accountId, 'banned');
  return rows[0];
}

async function liftBan({ banId, accountId, deviceId }) {
  if (banId) {
    await query(`DELETE FROM bans WHERE id = $1`, [banId]);
  } else if (accountId) {
    await query(`DELETE FROM bans WHERE account_id = $1`, [accountId]);
    await setAccountStatus(accountId, 'active');
  } else if (deviceId) {
    await query(`DELETE FROM bans WHERE device_id = $1`, [deviceId]);
  }
}

// All currently-active bans (expires_at NULL or in the future).
async function getActiveBans() {
  const { rows } = await query(
    `SELECT id, scope, account_id, device_id, reason, expires_at
       FROM bans
      WHERE expires_at IS NULL OR expires_at > now()`
  );
  return rows;
}

async function listAccounts() {
  const { rows } = await query(
    `SELECT id, username, role, status, last_login
       FROM accounts
      ORDER BY last_login DESC NULLS LAST, id DESC`
  );
  return rows;
}

async function getActiveAccountBansWithNames() {
  const { rows } = await query(
    `SELECT b.id, b.account_id, b.reason, b.expires_at, a.username
       FROM bans b LEFT JOIN accounts a ON a.id = b.account_id
      WHERE b.scope = 'account'
        AND b.account_id IS NOT NULL
        AND (b.expires_at IS NULL OR b.expires_at > now())
      ORDER BY b.created_at DESC`
  );
  return rows;
}

async function getBansForAccount(accountId) {
  const { rows } = await query(
    `SELECT * FROM bans WHERE account_id = $1 ORDER BY created_at DESC`,
    [accountId]
  );
  return rows;
}

async function logViolation(accountId, type, detail, deviceId = null) {
  await query(`INSERT INTO violations (account_id, device_id, type, detail) VALUES ($1, $2, $3, $4)`, [
    accountId || null,
    deviceId || null,
    type,
    detail || null
  ]);
}

async function getViolationsForAccount(accountId, limit = 100) {
  const { rows } = await query(
    `SELECT v.type, v.detail, v.device_id, v.ts, a.username
       FROM violations v
       LEFT JOIN accounts a ON a.id = v.account_id
      WHERE v.account_id = $1
      ORDER BY v.ts DESC LIMIT $2`,
    [accountId, limit]
  );
  return rows;
}

async function getViolationCounts() {
  const { rows } = await query(
    `SELECT a.id AS account_id, a.username, COUNT(v.id)::INT AS violation_count
       FROM accounts a
       LEFT JOIN violations v ON v.account_id = a.id
      GROUP BY a.id, a.username`
  );
  return rows;
}

async function listRecentViolations(limit = 250) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 250));
  const { rows } = await query(
    `SELECT v.id, v.account_id, a.username, v.device_id, v.type, v.detail, v.ts
       FROM violations v
       LEFT JOIN accounts a ON a.id = v.account_id
      ORDER BY v.ts DESC
      LIMIT $1`,
    [safeLimit]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

// delta: { kills, deaths, assists, wins, gamesPlayed, playtimeSecs, gungameKills,
//          gungameWins, deathmatchKills, deathmatchWins, bestStreak, mvps, shotsFired, shotsHit }
async function flushStat(accountId, delta) {
  // Stats are accumulated in memory during play and flushed in batches/on
  // disconnect. Keep match hot paths out of Postgres so gameplay never stalls on DB.
  await query(
    `INSERT INTO stats (account_id, kills, deaths, assists, wins, games_played, playtime_secs,
                        best_streak, gungame_kills, gungame_wins, deathmatch_kills, deathmatch_wins, mvps,
                        shots_fired, shots_hit, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
     ON CONFLICT (account_id) DO UPDATE SET
       kills            = stats.kills + EXCLUDED.kills,
       deaths           = stats.deaths + EXCLUDED.deaths,
       assists          = stats.assists + EXCLUDED.assists,
       wins             = stats.wins + EXCLUDED.wins,
       games_played     = stats.games_played + EXCLUDED.games_played,
       playtime_secs    = stats.playtime_secs + EXCLUDED.playtime_secs,
       best_streak      = GREATEST(stats.best_streak, EXCLUDED.best_streak),
       gungame_kills    = stats.gungame_kills + EXCLUDED.gungame_kills,
       gungame_wins     = stats.gungame_wins + EXCLUDED.gungame_wins,
       deathmatch_kills = stats.deathmatch_kills + EXCLUDED.deathmatch_kills,
       deathmatch_wins  = stats.deathmatch_wins + EXCLUDED.deathmatch_wins,
       mvps             = stats.mvps + EXCLUDED.mvps,
       shots_fired      = stats.shots_fired + EXCLUDED.shots_fired,
       shots_hit        = stats.shots_hit + EXCLUDED.shots_hit,
       updated_at       = now()`,
    [
      accountId,
      delta.kills || 0,
      delta.deaths || 0,
      delta.assists || 0,
      delta.wins || 0,
      delta.gamesPlayed || 0,
      delta.playtimeSecs || 0,
      delta.bestStreak || 0,
      delta.gungameKills || 0,
      delta.gungameWins || 0,
      delta.deathmatchKills || 0,
      delta.deathmatchWins || 0,
      delta.mvps || 0,
      delta.shotsFired || 0,
      delta.shotsHit || 0
    ]
  );
}

async function getStats(accountId) {
  const { rows } = await query(`SELECT * FROM stats WHERE account_id = $1`, [accountId]);
  return rows[0] || null;
}

async function addXp(accountId, amount) {
  const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
  const { rows } = await query(
    `INSERT INTO stats (account_id, xp) VALUES ($1, $2)
     ON CONFLICT (account_id) DO UPDATE SET xp = stats.xp + EXCLUDED.xp, updated_at = now()
     RETURNING xp`, [accountId, safeAmount]
  );
  return Number(rows[0]?.xp || 0);
}

async function addMowbucks(accountId, amount) {
  const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
  const { rows } = await query(
    `INSERT INTO stats (account_id, mowbucks) VALUES ($1, $2)
     ON CONFLICT (account_id) DO UPDATE SET mowbucks = stats.mowbucks + EXCLUDED.mowbucks, updated_at = now()
     RETURNING mowbucks`, [accountId, safeAmount]
  );
  return Number(rows[0]?.mowbucks || 0);
}

async function resetXp(accountId) {
  const { rows } = await query(`UPDATE stats SET xp = 0, updated_at = now() WHERE account_id = $1 RETURNING xp`, [accountId]);
  return Number(rows[0]?.xp || 0);
}

async function resetAllXp() {
  const result = await query(`UPDATE stats SET xp = 0, updated_at = now() WHERE xp <> 0`);
  return Number(result.rowCount || 0);
}

async function recordWeaponKill(accountId, dateKey, weapon) {
  // Used both for player progress and for global weapon-difficulty signals that
  // choose/adapt hard daily weapon challenges.
  const safeWeapon = String(weapon || '').slice(0, 32);
  if (!safeWeapon) return;
  await query(
    `INSERT INTO stats (account_id, weapon_kills) VALUES ($1, jsonb_build_object($2::text, 1))
     ON CONFLICT (account_id) DO UPDATE SET
       weapon_kills = jsonb_set(stats.weapon_kills, ARRAY[$2::text],
         to_jsonb(COALESCE((stats.weapon_kills ->> $2::text)::bigint, 0) + 1), true), updated_at = now()`,
    [accountId, safeWeapon]
  );
  const { rows } = await query(`SELECT username FROM accounts WHERE id = $1`, [accountId]);
  await query(
    `INSERT INTO daily_stats (date_key, player_key, account_id, username, weapon_kills)
     VALUES ($1, 'account:' || $2::text, $2, $3, jsonb_build_object($4::text, 1))
     ON CONFLICT (date_key, player_key) DO UPDATE SET
       weapon_kills = jsonb_set(daily_stats.weapon_kills, ARRAY[$4::text],
         to_jsonb(COALESCE((daily_stats.weapon_kills ->> $4::text)::bigint, 0) + 1), true), updated_at = now()`,
    [dateKey, accountId, rows[0]?.username || 'Player', safeWeapon]
  );
}

async function getGlobalWeaponKills() {
  const { rows } = await query(
    `SELECT key AS weapon, SUM(value::bigint)::bigint AS kills
       FROM stats, jsonb_each_text(stats.weapon_kills)
      GROUP BY key ORDER BY kills DESC, key ASC`
  );
  return rows;
}

async function getDailyWeaponKills(accountId, dateKey, weapon) {
  const { rows } = await query(`SELECT weapon_kills ->> $3::text AS kills FROM daily_stats WHERE account_id = $1 AND date_key = $2`, [accountId, dateKey, weapon]);
  return Number(rows[0]?.kills || 0);
}

function mapDailyChallengeTemplate(row) {
  return row ? {
    id: row.id,
    period: row.period || 'daily',
    tier: row.tier,
    metric: row.metric,
    label: row.label,
    target: Number(row.target || 0),
    xp: Number(row.xp || 0),
    weapon: row.weapon || '',
    map: row.map_id || '',
    enabled: row.enabled !== false,
    sortOrder: Number(row.sort_order || 0),
    updatedAt: row.updated_at
  } : null;
}

async function getDailyChallengeTemplates({ enabledOnly = false, period = null } = {}) {
  const clauses = [];
  const params = [];
  if (enabledOnly) clauses.push('enabled = true');
  if (period === 'daily' || period === 'weekly') {
    params.push(period);
    clauses.push(`period = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT id, period, tier, metric, label, target, xp, weapon, map_id, enabled, sort_order, updated_at
       FROM daily_challenge_templates
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY CASE period WHEN 'daily' THEN 0 ELSE 1 END,
               CASE tier WHEN 'easy' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
               sort_order ASC, id ASC`,
    params
  );
  return rows.map(mapDailyChallengeTemplate);
}

async function upsertDailyChallengeTemplate({ id, period = 'daily', tier, metric, label, target, xp, weapon = '', map = '', enabled = true, sortOrder = 0, accountId = null }) {
  const { rows } = await query(
    `INSERT INTO daily_challenge_templates (id, period, tier, metric, label, target, xp, weapon, map_id, enabled, sort_order, created_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''), NULLIF($9, ''), $10, $11, $12, now())
     ON CONFLICT (id) DO UPDATE SET
       period = EXCLUDED.period,
       tier = EXCLUDED.tier,
       metric = EXCLUDED.metric,
       label = EXCLUDED.label,
       target = EXCLUDED.target,
       xp = EXCLUDED.xp,
       weapon = EXCLUDED.weapon,
       map_id = EXCLUDED.map_id,
       enabled = EXCLUDED.enabled,
       sort_order = EXCLUDED.sort_order,
       created_by = COALESCE(daily_challenge_templates.created_by, EXCLUDED.created_by),
       updated_at = now()
     RETURNING id, period, tier, metric, label, target, xp, weapon, map_id, enabled, sort_order, updated_at`,
    [id, period, tier, metric, label, target, xp, weapon, map, !!enabled, sortOrder, accountId]
  );
  return mapDailyChallengeTemplate(rows[0]);
}

async function deleteDailyChallengeTemplate(id) {
  const { rows } = await query(`DELETE FROM daily_challenge_templates WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}

async function getWeeklyChallengeRotation(periodKey) {
  const { rows } = await query(
    `SELECT challenges FROM weekly_challenge_rotations WHERE period_key = $1`,
    [periodKey]
  );
  return Array.isArray(rows[0]?.challenges) ? rows[0].challenges : null;
}

async function saveWeeklyChallengeRotation(periodKey, challenges) {
  if (!Array.isArray(challenges) || !challenges.length) throw new Error('Weekly challenge rotation cannot be empty');
  // The harmless conflict update makes concurrent servers return the same
  // already-committed rotation instead of each process keeping its own choice.
  const { rows } = await query(
    `INSERT INTO weekly_challenge_rotations (period_key, challenges)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (period_key) DO UPDATE SET period_key = EXCLUDED.period_key
     RETURNING challenges`,
    [periodKey, JSON.stringify(challenges)]
  );
  return Array.isArray(rows[0]?.challenges) ? rows[0].challenges : challenges;
}

async function incrementDailyChallengeCounters(accountId, dateKey, delta = {}) {
  const clean = Object.fromEntries(Object.entries(delta)
    .map(([key, value]) => [String(key).slice(0, 32), Math.max(0, Math.floor(Number(value) || 0))])
    .filter(([, value]) => value > 0));
  if (!Object.keys(clean).length) return;
  await query(
    `INSERT INTO daily_challenge_progress (account_id, date_key, counters) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (account_id, date_key) DO UPDATE SET counters =
       (SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
          FROM (SELECT key, to_jsonb(SUM(value)) AS value
                  FROM (SELECT key, value::bigint FROM jsonb_each_text(daily_challenge_progress.counters)
                        UNION ALL SELECT key, value::bigint FROM jsonb_each_text(EXCLUDED.counters)) merged
                 GROUP BY key) totals)`,
    [accountId, dateKey, JSON.stringify(clean)]
  );
}

async function getDailyChallengeCounters(accountId, dateKey) {
  const { rows } = await query(`SELECT counters FROM daily_challenge_progress WHERE account_id = $1 AND date_key = $2`, [accountId, dateKey]);
  return rows[0]?.counters || {};
}

async function claimDailyChallenge(accountId, dateKey, tier, xpAwarded, { caseRewardId = '' } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claim = await client.query(
      `INSERT INTO daily_challenge_claims (account_id, date_key, tier, xp_awarded)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING tier`,
      [accountId, dateKey, tier, xpAwarded]
    );
    let xp = null;
    let previousXp = null;
    if (claim.rowCount) {
      const result = await client.query(
        `INSERT INTO stats (account_id, xp) VALUES ($1, $2)
         ON CONFLICT (account_id) DO UPDATE SET xp = stats.xp + EXCLUDED.xp, updated_at = now()
         RETURNING xp`, [accountId, xpAwarded]
      );
      xp = Number(result.rows[0]?.xp || 0);
      previousXp = Math.max(0, xp - Math.max(0, Number(xpAwarded) || 0));
      if (caseRewardId) {
        await client.query(
          `INSERT INTO case_inventory (account_id, case_id, quantity, updated_at)
           VALUES ($1, $2, 1, now())
           ON CONFLICT (account_id, case_id) DO UPDATE SET
             quantity = case_inventory.quantity + 1,
             updated_at = now()`,
          [accountId, caseRewardId]
        );
      }
    }
    await client.query('COMMIT');
    return { claimed: claim.rowCount > 0, xp, previousXp, caseRewardId: claim.rowCount ? caseRewardId : '' };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function getDailyChallengeClaims(accountId, dateKey) {
  const { rows } = await query(`SELECT tier FROM daily_challenge_claims WHERE account_id = $1 AND date_key = $2`, [accountId, dateKey]);
  return rows.map(row => row.tier);
}

async function recordDailyStats({ dateKey, playerKey, accountId, username, wins, kills, deaths, shotsFired, shotsHit, bestStreak }) {
  await query(
    `INSERT INTO daily_stats (date_key, player_key, account_id, username, wins, kills, deaths, shots_fired, shots_hit, best_streak, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (date_key, player_key) DO UPDATE SET
       account_id   = COALESCE(EXCLUDED.account_id, daily_stats.account_id),
       username     = EXCLUDED.username,
       wins         = daily_stats.wins + EXCLUDED.wins,
       kills        = daily_stats.kills + EXCLUDED.kills,
       deaths       = daily_stats.deaths + EXCLUDED.deaths,
       shots_fired  = daily_stats.shots_fired + EXCLUDED.shots_fired,
       shots_hit    = daily_stats.shots_hit + EXCLUDED.shots_hit,
       best_streak  = GREATEST(daily_stats.best_streak, EXCLUDED.best_streak),
       updated_at   = now()`,
    [
      dateKey,
      playerKey,
      accountId || null,
      username || 'Player',
      wins || 0,
      kills || 0,
      deaths || 0,
      shotsFired || 0,
      shotsHit || 0,
      bestStreak || 0
    ]
  );
}

async function getDailyStats(dateKey) {
  const { rows } = await query(
    `SELECT date_key, player_key, account_id, username, wins, kills, deaths, shots_fired, shots_hit, best_streak
       FROM daily_stats
      WHERE date_key = $1
        AND account_id IS NOT NULL`,
    [dateKey]
  );
  return rows;
}

async function getDailyStatsForPlayer(dateKey, playerKey, accountId = null) {
  const params = [dateKey, playerKey];
  let accountClause = '';
  if (accountId != null) {
    params.push(accountId);
    accountClause = ` OR account_id = $3`;
  }
  const { rows } = await query(
    `SELECT date_key, player_key, account_id, username, wins, kills, deaths, shots_fired, shots_hit, best_streak
       FROM daily_stats
      WHERE date_key = $1
        AND (player_key = $2${accountClause})
      LIMIT 1`,
    params
  );
  return rows[0] || null;
}

async function getDailyStatsRange(startDateKey, endDateKey) {
  const { rows } = await query(
    `SELECT player_key,
            MAX(account_id)::BIGINT AS account_id,
            (array_agg(username ORDER BY updated_at DESC))[1] AS username,
            SUM(wins)::BIGINT AS wins,
            SUM(kills)::BIGINT AS kills,
            SUM(deaths)::BIGINT AS deaths,
            SUM(shots_fired)::BIGINT AS shots_fired,
            SUM(shots_hit)::BIGINT AS shots_hit,
            MAX(best_streak)::INT AS best_streak
       FROM daily_stats
      WHERE date_key >= $1 AND date_key <= $2
        AND account_id IS NOT NULL
      GROUP BY player_key`,
    [startDateKey, endDateKey]
  );
  return rows;
}

async function getAllTimeLeaderboardStats() {
  const { rows } = await query(
    `SELECT ('account:' || s.account_id)::TEXT AS player_key,
            s.account_id,
            COALESCE(a.username, 'Player') AS username,
            s.wins,
            s.kills,
            s.deaths,
            s.shots_fired,
            s.shots_hit,
            s.best_streak,
            s.xp
       FROM stats s
       LEFT JOIN accounts a ON a.id = s.account_id`
  );
  return rows;
}

async function resetLeaderboardStats(scope) {
  if (scope === 'daily') {
    const today = new Date().toISOString().slice(0, 10);
    await query(`DELETE FROM daily_stats WHERE date_key = $1`, [today]);
    return { scope, deleted: 'today' };
  }
  if (scope === 'weekly') {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    await query(`DELETE FROM daily_stats WHERE date_key >= $1 AND date_key <= $2`, [
      start.toISOString().slice(0, 10),
      now.toISOString().slice(0, 10)
    ]);
    return { scope, deleted: 'current_week' };
  }
  if (scope === 'allTime') {
    await query(`UPDATE stats SET kills = 0, deaths = 0, assists = 0, wins = 0, games_played = 0,
      playtime_secs = 0, best_streak = 0, gungame_kills = 0, gungame_wins = 0,
      deathmatch_kills = 0, deathmatch_wins = 0, mvps = 0, shots_fired = 0, shots_hit = 0,
      updated_at = now()`);
    return { scope, reset: 'stats' };
  }
  throw new Error('Invalid leaderboard reset scope');
}

// ---------------------------------------------------------------------------
// Skins / inventory
// ---------------------------------------------------------------------------

function normalizePositiveIntSeed(value) {
  return Math.max(0, Math.min(2147483647, Math.floor(Number(value) || 0)));
}

function normalizePatternSeed(value) {
  const seed = normalizePositiveIntSeed(value);
  return seed > 0 ? ((seed - 1) % 1000) + 1 : 0;
}

const UNWORN_DEFAULT_ITEM_IDS = new Set(['knife_default_ct_vanilla', 'knife_default_t_vanilla']);
const INSTANCE_RARITIES = new Set(['common', 'rare', 'epic', 'legendary', 'mythic']);

function normalizeInstanceRarity(value) {
  const rarity = String(value || '').trim().toLowerCase();
  return INSTANCE_RARITIES.has(rarity) ? rarity : null;
}

function instanceAppearance(itemId, { rarityTier = null, wearValue, wearSeed } = {}) {
  if (UNWORN_DEFAULT_ITEM_IDS.has(String(itemId))) {
    return { rarityTier: normalizeInstanceRarity(rarityTier) || 'common', wearValue: 0, wearSeed: 0 };
  }
  const normalizedWear = Number.isFinite(Number(wearValue))
    ? Math.max(0, Math.min(1, Number(wearValue)))
    : crypto.randomInt(0, 1000001) / 1000000;
  const normalizedSeed = normalizePositiveIntSeed(wearSeed) || crypto.randomInt(1, 2147483647);
  return { rarityTier: normalizeInstanceRarity(rarityTier), wearValue: normalizedWear, wearSeed: normalizedSeed };
}

const LEVEL_BASE_XP = 350;
const LEVEL_XP_GROWTH = 1.15;

function progressionForXp(rawXp) {
  const xp = Math.max(0, Math.floor(Number(rawXp) || 0));
  let remaining = xp;
  let level = 1;
  let required = LEVEL_BASE_XP;
  while (remaining >= required && level < 1000) {
    remaining -= required;
    level += 1;
    required = level <= 20 ? Math.round(LEVEL_BASE_XP * Math.pow(LEVEL_XP_GROWTH, level - 1)) : Math.round(LEVEL_BASE_XP * Math.pow(LEVEL_XP_GROWTH, 19));
  }
  return { xp, level, levelXp: remaining, nextLevelXp: required };
}

function mowbucksForLevels(beforeLevel, afterLevel) {
  let total = 0;
  for (let level = Math.max(2, beforeLevel + 1); level <= afterLevel; level += 1) {
    total += Math.min(200, 100 + ((level - 1) * 5));
  }
  return total;
}

async function ensureStarterSkinInventory(accountId, itemIds = []) {
  // Admin/test inventory bootstrap only. Do not call this for normal public users
  // when inventory/cases are released.
  const clean = [...new Set((itemIds || []).map(id => String(id || '').trim()).filter(Boolean))];
  if (!clean.length) return [];
  const values = [];
  const params = [accountId];
  clean.forEach((itemId) => {
    const appearance = instanceAppearance(itemId);
    const itemParam = params.push(itemId);
    const wearParam = params.push(appearance.wearValue);
    const seedParam = params.push(appearance.wearSeed);
    const rarityParam = params.push(appearance.rarityTier);
    values.push(`($1, $${itemParam}, 'starter', $${wearParam}, $${seedParam}, $${rarityParam})`);
  });
  const { rows } = await query(
    `INSERT INTO skin_inventory (account_id, item_id, source, wear_value, wear_seed, rarity_tier)
       VALUES ${values.join(',')}
       ON CONFLICT DO NOTHING
     RETURNING id, account_id, item_id, source, collection_id, pattern_seed, rarity_tier, wear_value, wear_seed, created_at`,
    params
  );
  return rows;
}

async function getSkinInventory(accountId) {
  // HIGH WARNING: account_id is the isolation boundary for the future public
  // inventory/case rollout. Do not add an unscoped catalog/shared inventory read.
  const { rows } = await query(
    `SELECT id, account_id, item_id, source, collection_id, pattern_seed, rarity_tier, wear_value, wear_seed, created_at
       FROM skin_inventory
      WHERE account_id = $1
      ORDER BY created_at ASC, id ASC`,
    [accountId]
  );
  return rows;
}

async function getSkinInventoryItem(accountId, inventoryId) {
  // Ownership check is intentionally part of the SELECT; callers should never
  // trust a client-provided inventory id without the matching account id.
  const { rows } = await query(
    `SELECT id, account_id, item_id, source, collection_id, pattern_seed, rarity_tier, wear_value, wear_seed, created_at
       FROM skin_inventory
      WHERE account_id = $1 AND id = $2`,
    [accountId, inventoryId]
  );
  return rows[0] || null;
}

function tradeUpCollectionFromRow(row) {
  return {
    id: String(row?.id || ''),
    collectionName: String(row?.collection_name || row?.display_name || row?.id || 'Collection'),
    items: Array.isArray(row?.items_json) ? row.items_json : []
  };
}

function pendingTradeInventoryIds(rows = []) {
  const ids = new Set();
  for (const row of rows) {
    for (const payload of [row?.offer_json, row?.request_json]) {
      for (const rawId of Array.isArray(payload?.items) ? payload.items : []) {
        const id = Number(rawId);
        if (Number.isSafeInteger(id) && id > 0) ids.add(id);
      }
    }
  }
  return ids;
}

async function getTradeUpState(accountId) {
  const [tutorialResult, inventory, listingResult, tradeResult, collectionResult] = await Promise.all([
    query(`SELECT trade_up_tutorial_seen FROM accounts WHERE id = $1`, [accountId]),
    getSkinInventory(accountId),
    query(`SELECT inventory_id FROM skin_market_listings WHERE seller_id = $1 AND status = 'active' AND inventory_id IS NOT NULL`, [accountId]),
    query(`SELECT offer_json, request_json FROM skin_trade_requests WHERE status = 'pending' AND (from_account = $1 OR to_account = $1)`, [accountId]),
    query(`SELECT id, display_name, collection_name, items_json FROM custom_cases`, [])
  ]);
  const listedIds = new Set(listingResult.rows.map(row => Number(row.inventory_id)));
  const pendingIds = pendingTradeInventoryIds(tradeResult.rows);
  const collectionsById = new Map(collectionResult.rows.map(row => [String(row.id), tradeUpCollectionFromRow(row)]));
  const items = inventory.flatMap((row) => {
    const inventoryId = Number(row.id);
    const rarity = tradeups.normalizeTradeUpRarity(row.rarity_tier);
    const collectionId = String(row.collection_id || '').trim();
    const collection = collectionsById.get(collectionId);
    const definition = skins.getItem(row.item_id);
    const outputRarity = tradeups.nextRarity(rarity);
    if (!definition || definition.tradeUpEligible === false || !outputRarity || !collectionId || !collection) return [];
    if (listedIds.has(inventoryId) || pendingIds.has(inventoryId)) return [];
    if (!tradeups.collectionSupportsTradeUp(collection, rarity, skins.getItem)) return [];
    return [{
      inventoryId,
      itemId: row.item_id,
      rarityTier: rarity,
      collectionId,
      collectionName: collection.collectionName,
      wearValue: Number(row.wear_value || 0),
      patternSeed: Number(row.pattern_seed || 0),
      createdAt: row.created_at,
      outputRarity,
      requiredCount: tradeups.requiredInputCount(rarity)
    }];
  });
  return { tutorialSeen: !!tutorialResult.rows[0]?.trade_up_tutorial_seen, items };
}

function storedTradeUpResult(row, idempotent = false) {
  const result = row?.result_json && typeof row.result_json === 'object' ? row.result_json : {};
  return { ...result, tradeUpId: result.tradeUpId || String(row?.id || ''), idempotent };
}

async function completeTradeUp({ accountId, inventoryItemIds, idempotencyKey }) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const requestKey = String(idempotencyKey || '').trim();
  if (!/^[a-zA-Z0-9:_-]{12,128}$/.test(requestKey)) throw new Error('trade_up_bad_request_id');
  const ids = Array.isArray(inventoryItemIds) ? inventoryItemIds.map(Number) : [];
  if (![5, 10].includes(ids.length) || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('trade_up_wrong_count');
  if (new Set(ids).size !== ids.length) throw new Error('trade_up_duplicate_item');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Account serialization closes the gap between selecting, listing, and
    // creating friend trades while the inventory rows are being consumed.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [`skin-economy:${accountId}`]);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [`trade-up:${accountId}:${requestKey}`]);
    const previous = await client.query(
      `SELECT id, result_json FROM trade_up_transactions WHERE account_id = $1 AND idempotency_key = $2`,
      [accountId, requestKey]
    );
    if (previous.rows[0]) {
      await client.query('COMMIT');
      return storedTradeUpResult(previous.rows[0], true);
    }

    const locked = await client.query(
      `SELECT id, account_id, item_id, source, collection_id, pattern_seed, rarity_tier, wear_value, wear_seed, created_at
         FROM skin_inventory
        WHERE account_id = $1 AND id = ANY($2::bigint[])
        ORDER BY id ASC
        FOR UPDATE`,
      [accountId, ids]
    );
    if (locked.rows.length !== ids.length) throw new Error('trade_up_item_missing');
    const byId = new Map(locked.rows.map(row => [Number(row.id), row]));
    const inputs = ids.map(id => byId.get(id));

    const listed = await client.query(
      `SELECT inventory_id FROM skin_market_listings WHERE inventory_id = ANY($1::bigint[]) AND status = 'active'`,
      [ids]
    );
    if (listed.rows.length) throw new Error('trade_up_item_listed');
    const pendingTrades = await client.query(
      `SELECT offer_json, request_json FROM skin_trade_requests WHERE status = 'pending' AND (from_account = $1 OR to_account = $1)`,
      [accountId]
    );
    const pendingIds = pendingTradeInventoryIds(pendingTrades.rows);
    if (ids.some(id => pendingIds.has(id))) throw new Error('trade_up_item_in_trade');

    const inputRarity = tradeups.normalizeTradeUpRarity(inputs[0]?.rarity_tier);
    const requiredCount = tradeups.requiredInputCount(inputRarity);
    if (!requiredCount || ids.length !== requiredCount) throw new Error('trade_up_wrong_count');
    if (inputs.some(row => tradeups.normalizeTradeUpRarity(row.rarity_tier) !== inputRarity)) throw new Error('trade_up_mixed_rarity');
    const collectionIds = [...new Set(inputs.map(row => String(row.collection_id || '').trim()).filter(Boolean))];
    if (!collectionIds.length || inputs.some(row => !String(row.collection_id || '').trim())) throw new Error('trade_up_item_ineligible');
    const collectionRows = await client.query(
      `SELECT id, display_name, collection_name, items_json FROM custom_cases WHERE id = ANY($1::text[]) FOR SHARE`,
      [collectionIds]
    );
    const collectionsById = new Map(collectionRows.rows.map(row => [String(row.id), tradeUpCollectionFromRow(row)]));
    if (collectionsById.size !== collectionIds.length) throw new Error('trade_up_collection_ineligible');

    const outcome = tradeups.buildTradeUpOutcome({ inputs, collectionsById, getDefinition: skins.getItem });
    const selectedCollection = collectionsById.get(outcome.selectedCollectionId);
    const inputSnapshot = inputs.map((row) => {
      const definition = skins.getItem(row.item_id);
      const range = tradeups.floatRangeForDefinition(definition);
      return {
        inventoryItemId: Number(row.id),
        skinDefinitionId: row.item_id,
        skinName: definition?.displayName || row.item_id,
        weaponId: definition?.weapon || '',
        rarity: inputRarity,
        collectionId: row.collection_id,
        floatValue: Number(row.wear_value || 0),
        minimumFloat: range.minimumFloat,
        maximumFloat: range.maximumFloat,
        wearCondition: tradeups.wearConditionForFloat(row.wear_value),
        patternSeed: Number(row.pattern_seed || 0),
        source: row.source,
        createdAt: row.created_at
      };
    });
    const outputDefinition = outcome.outputDefinition;
    const outputSnapshot = {
      skinDefinitionId: outputDefinition.id,
      skinName: outputDefinition.displayName,
      weaponId: outputDefinition.weapon,
      collectionId: outcome.selectedCollectionId,
      rarity: outcome.outputRarity,
      minimumFloat: tradeups.floatRangeForDefinition(outputDefinition).minimumFloat,
      maximumFloat: tradeups.floatRangeForDefinition(outputDefinition).maximumFloat
    };
    const audit = await client.query(
      `INSERT INTO trade_up_transactions (
         account_id, idempotency_key, input_inventory_item_ids, input_item_snapshot,
         input_rarity, output_rarity, average_normalized_float, selected_collection_id,
         selected_output_definition_id, output_float, output_wear_condition,
         output_pattern_seed, output_wear_seed, output_item_snapshot
       ) VALUES ($1, $2, $3::bigint[], $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
       RETURNING id, completed_at`,
      [
        accountId, requestKey, ids, JSON.stringify(inputSnapshot), inputRarity, outcome.outputRarity,
        outcome.averageNormalizedFloat, outcome.selectedCollectionId, outputDefinition.id, outcome.outputFloat,
        outcome.outputWearCondition, outcome.outputPatternSeed, outcome.outputWearSeed, JSON.stringify(outputSnapshot)
      ]
    );
    const tradeUpId = audit.rows[0].id;
    await client.query(`DELETE FROM skin_loadouts WHERE inventory_id = ANY($1::bigint[])`, [ids]);
    const consumed = await client.query(
      `DELETE FROM skin_inventory WHERE account_id = $1 AND id = ANY($2::bigint[]) RETURNING id`,
      [accountId, ids]
    );
    if (consumed.rowCount !== ids.length) throw new Error('trade_up_consume_failed');
    const awarded = await client.query(
      `INSERT INTO skin_inventory (
         account_id, item_id, source, collection_id, pattern_seed, rarity_tier, wear_value, wear_seed
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, account_id, item_id, source, collection_id, pattern_seed, rarity_tier, wear_value, wear_seed, created_at`,
      [
        accountId, outputDefinition.id, `trade_up:${tradeUpId}`, outcome.selectedCollectionId,
        outcome.outputPatternSeed, outcome.outputRarity, outcome.outputFloat, outcome.outputWearSeed
      ]
    );
    const result = {
      tradeUpId: String(tradeUpId),
      idempotencyKey: requestKey,
      inputInventoryItemIds: ids,
      inputRarity,
      outputRarity: outcome.outputRarity,
      averageNormalizedFloat: outcome.averageNormalizedFloat,
      selectedCollectionId: outcome.selectedCollectionId,
      selectedCollectionName: selectedCollection?.collectionName || outcome.selectedCollectionId,
      itemId: outputDefinition.id,
      inventoryItem: awarded.rows[0],
      floatValue: outcome.outputFloat,
      wearCondition: outcome.outputWearCondition,
      patternSeed: outcome.outputPatternSeed,
      wearSeed: outcome.outputWearSeed,
      completedAt: audit.rows[0].completed_at
    };
    await client.query(
      `UPDATE trade_up_transactions SET output_inventory_item_id = $2, result_json = $3::jsonb WHERE id = $1`,
      [tradeUpId, awarded.rows[0].id, JSON.stringify(result)]
    );
    await client.query('COMMIT');
    return { ...result, idempotent: false };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function getSkinLoadouts(accountId) {
  // Loadouts are also per account so two players can equip the same catalog skin
  // independently without mutating each other's state.
  const { rows } = await query(
    `SELECT l.account_id, l.weapon, l.inventory_id, l.item_id, l.updated_at,
            COALESCE(i.pattern_seed, 0) AS pattern_seed,
            i.rarity_tier,
            COALESCE(i.wear_value, 0) AS wear_value,
            COALESCE(i.wear_seed, 0) AS wear_seed
       FROM skin_loadouts l
       LEFT JOIN skin_inventory i ON i.id = l.inventory_id AND i.account_id = l.account_id
      WHERE l.account_id = $1
      ORDER BY l.weapon ASC`,
    [accountId]
  );
  return rows;
}

async function setSkinLoadout({ accountId, weapon, inventoryId, itemId }) {
  const { rows } = await query(
    `INSERT INTO skin_loadouts (account_id, weapon, inventory_id, item_id, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (account_id, weapon) DO UPDATE SET
         inventory_id = EXCLUDED.inventory_id,
         item_id = EXCLUDED.item_id,
         updated_at = now()
     RETURNING account_id, weapon, inventory_id, item_id, updated_at`,
    [accountId, weapon, inventoryId, itemId]
  );
  return rows[0] || null;
}

async function clearSkinLoadout(accountId, weapon) {
  const { rows } = await query(
    `DELETE FROM skin_loadouts
      WHERE account_id = $1 AND weapon = $2
    RETURNING weapon`,
    [accountId, weapon]
  );
  return rows[0] || null;
}

async function clearPlayerInventory(accountId) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const auctionBids = await client.query(
      `SELECT highest_bidder_id, price
         FROM skin_market_listings
        WHERE seller_id = $1 AND status = 'active' AND listing_type = 'auction'
          AND highest_bidder_id IS NOT NULL
        FOR UPDATE`,
      [accountId]
    );
    const refunds = new Map();
    for (const row of auctionBids.rows) {
      const bidderId = String(row.highest_bidder_id);
      refunds.set(bidderId, (refunds.get(bidderId) || 0) + Number(row.price || 0));
    }
    for (const [bidderId, refund] of refunds) {
      await client.query(
        `INSERT INTO stats (account_id, mowbucks) VALUES ($1, $2)
         ON CONFLICT (account_id) DO UPDATE SET mowbucks = stats.mowbucks + EXCLUDED.mowbucks, updated_at = now()`,
        [bidderId, refund]
      );
    }
    const listings = await client.query(
      `UPDATE skin_market_listings SET status = 'cancelled', updated_at = now()
        WHERE seller_id = $1 AND status = 'active'`,
      [accountId]
    );
    const caseListings = await client.query(
      `UPDATE case_market_listings SET status = 'cancelled', updated_at = now()
        WHERE seller_id = $1 AND status = 'active'`,
      [accountId]
    );
    await client.query(
      `UPDATE skin_trade_requests SET status = 'cancelled', updated_at = now()
        WHERE status = 'pending' AND (from_account = $1 OR to_account = $1)`,
      [accountId]
    );
    await client.query(`DELETE FROM skin_loadouts WHERE account_id = $1`, [accountId]);
    const cases = await client.query(`DELETE FROM case_inventory WHERE account_id = $1`, [accountId]);
    const inventory = await client.query(`DELETE FROM skin_inventory WHERE account_id = $1`, [accountId]);
    await client.query('COMMIT');
    return { skins: inventory.rowCount, cases: cases.rowCount, listings: listings.rowCount + caseListings.rowCount };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Admin inventory editing
//
// The tools an admin uses to fix up an account by hand. Everything here is
// destructive or creative, so it all funnels through functions that know what
// else in the schema points at a skin instance.
//
// A skin_inventory row is not free-standing: an active market listing holds its
// id, a pending friend trade names it inside a JSON payload, and a loadout row
// references it. Deleting one behind their backs leaves a listing nobody can
// buy and a loadout pointing at nothing. Cases are simpler - listing one moves
// it out of case_inventory into escrow - so quantities here are always the
// uncommitted ones and can be edited freely.
// ---------------------------------------------------------------------------

// Everything an admin needs to see before touching an account, including WHY a
// given item may not be safe to edit. The flags are computed here rather than
// in the UI so the check and the display can never disagree.
async function adminInventorySnapshot(accountId) {
  const [skins, cases, listed, trades, loadouts] = await Promise.all([
    getSkinInventory(accountId),
    getCaseInventory(accountId),
    query(
      `SELECT inventory_id FROM skin_market_listings
        WHERE seller_id = $1 AND status = 'active' AND inventory_id IS NOT NULL`,
      [accountId]
    ),
    query(
      `SELECT offer_json, request_json FROM skin_trade_requests
        WHERE status = 'pending' AND (from_account = $1 OR to_account = $1)`,
      [accountId]
    ),
    query(`SELECT weapon, inventory_id FROM skin_loadouts WHERE account_id = $1`, [accountId])
  ]);

  const listedIds = new Set(listed.rows.map(row => Number(row.inventory_id)));
  const pendingIds = pendingTradeInventoryIds(trades.rows);
  const equipped = new Map(loadouts.rows
    .filter(row => row.inventory_id != null)
    .map(row => [Number(row.inventory_id), String(row.weapon)]));

  return {
    skins: skins.map(row => ({
      id: Number(row.id),
      itemId: row.item_id,
      source: row.source,
      collectionId: row.collection_id,
      rarityTier: row.rarity_tier,
      patternSeed: Number(row.pattern_seed || 0),
      wearValue: Number(row.wear_value || 0),
      wearSeed: Number(row.wear_seed || 0),
      createdAt: row.created_at,
      // Editing a listed or mid-trade item would change what the counterparty
      // agreed to, so the server refuses; the UI uses this to say why.
      listed: listedIds.has(Number(row.id)),
      pendingTrade: pendingIds.has(Number(row.id)),
      equippedOn: equipped.get(Number(row.id)) || null
    })),
    cases: cases.map(row => ({ caseId: row.case_id, quantity: Number(row.quantity || 0) }))
  };
}

function skinEditLockReason(row) {
  if (!row) return 'missing';
  if (row.listed) return 'listed';
  if (row.pendingTrade) return 'trading';
  return null;
}

// Wear is the only mutable field. Pattern seed is deliberately left alone: it
// is the item's identity as far as the renderer is concerned, and rerolling it
// would silently turn one player's skin into a different-looking one.
async function adminSetSkinWear({ accountId, inventoryId, wearValue }) {
  const wear = Math.max(0, Math.min(1, Number(wearValue)));
  if (!Number.isFinite(wear)) return { ok: false, reason: 'invalid' };
  const snapshot = await adminInventorySnapshot(accountId);
  const row = snapshot.skins.find(skin => skin.id === Number(inventoryId));
  const locked = skinEditLockReason(row);
  if (locked) return { ok: false, reason: locked };
  const { rows } = await query(
    `UPDATE skin_inventory SET wear_value = $3
      WHERE account_id = $1 AND id = $2
      RETURNING id, item_id, wear_value`,
    [accountId, Number(inventoryId), wear]
  );
  return rows[0] ? { ok: true, item: rows[0] } : { ok: false, reason: 'missing' };
}

// Unlike setting wear, removal does not refuse a listed or mid-trade item - an
// admin deleting something is usually cleaning up exactly that kind of mess.
// Instead it unwinds the commitments first, in one transaction, the same way
// clearPlayerInventory does for a whole account.
async function adminRemoveSkinInstance({ accountId, inventoryId }) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const id = Number(inventoryId);
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, reason: 'invalid' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owned = await client.query(
      `SELECT id, item_id FROM skin_inventory WHERE account_id = $1 AND id = $2 FOR UPDATE`,
      [accountId, id]
    );
    if (!owned.rows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'missing' };
    }

    // An auction with a live bid owes that bidder their money back.
    const auctions = await client.query(
      `SELECT highest_bidder_id, price FROM skin_market_listings
        WHERE seller_id = $1 AND inventory_id = $2 AND status = 'active'
          AND listing_type = 'auction' AND highest_bidder_id IS NOT NULL
        FOR UPDATE`,
      [accountId, id]
    );
    let refunded = 0;
    for (const row of auctions.rows) {
      refunded += Number(row.price || 0);
      await client.query(
        `INSERT INTO stats (account_id, mowbucks) VALUES ($1, $2)
         ON CONFLICT (account_id) DO UPDATE SET mowbucks = stats.mowbucks + EXCLUDED.mowbucks, updated_at = now()`,
        [String(row.highest_bidder_id), Number(row.price || 0)]
      );
    }
    const listings = await client.query(
      `UPDATE skin_market_listings SET status = 'cancelled', updated_at = now()
        WHERE seller_id = $1 AND inventory_id = $2 AND status = 'active'`,
      [accountId, id]
    );

    // Pending trades name inventory ids inside a JSON payload, so they have to
    // be read and matched rather than filtered in SQL.
    const trades = await client.query(
      `SELECT id, offer_json, request_json FROM skin_trade_requests
        WHERE status = 'pending' AND (from_account = $1 OR to_account = $1)
        FOR UPDATE`,
      [accountId]
    );
    const affected = trades.rows.filter(row => pendingTradeInventoryIds([row]).has(id)).map(row => row.id);
    if (affected.length) {
      await client.query(
        `UPDATE skin_trade_requests SET status = 'cancelled', updated_at = now() WHERE id = ANY($1::bigint[])`,
        [affected]
      );
    }

    await client.query(`DELETE FROM skin_loadouts WHERE account_id = $1 AND inventory_id = $2`, [accountId, id]);
    await client.query(`DELETE FROM skin_inventory WHERE account_id = $1 AND id = $2`, [accountId, id]);
    await client.query('COMMIT');
    return {
      ok: true,
      itemId: owned.rows[0].item_id,
      cancelledListings: listings.rowCount,
      cancelledTrades: affected.length,
      refunded
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

// Cases in case_inventory are the uncommitted ones - listing a case moves it
// out into escrow - so there is nothing to unwind here.
async function adminRemoveCases({ accountId, caseId, quantity }) {
  const id = String(caseId || '').trim().slice(0, 80);
  if (!id) return { ok: false, reason: 'invalid' };
  const wanted = Number(quantity);
  const { rows } = await query(
    `SELECT quantity FROM case_inventory WHERE account_id = $1 AND case_id = $2`,
    [accountId, id]
  );
  const held = Number(rows[0]?.quantity || 0);
  if (held <= 0) return { ok: false, reason: 'missing' };
  // A non-finite or non-positive amount means "all of them", which is what the
  // UI's Remove button asks for.
  const take = Number.isFinite(wanted) && wanted > 0 ? Math.min(held, Math.floor(wanted)) : held;
  await query(
    `UPDATE case_inventory SET quantity = quantity - $3, updated_at = now()
      WHERE account_id = $1 AND case_id = $2`,
    [accountId, id, take]
  );
  await query(`DELETE FROM case_inventory WHERE account_id = $1 AND case_id = $2 AND quantity <= 0`, [accountId, id]);
  return { ok: true, caseId: id, removed: take, remaining: held - take };
}

async function grantCases(accountId, caseId, quantity = 1) {
  const amount = Math.max(1, Math.min(1000, Number(quantity) || 1));
  const { rows } = await query(
    `INSERT INTO case_inventory (account_id, case_id, quantity, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (account_id, case_id) DO UPDATE SET
         quantity = case_inventory.quantity + EXCLUDED.quantity,
         updated_at = now()
     RETURNING account_id, case_id, quantity`,
    [accountId, caseId, amount]
  );
  return rows[0] || null;
}

async function buyCase({ accountId, caseId, price }) {
  // Atomic case purchase: lock the player's stats row, debit Mowbucks, then add
  // exactly one case_inventory row quantity in the same transaction.
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const safePrice = Math.max(0, Math.min(1000000000, Math.floor(Number(price) || 0)));
  const safeCaseId = String(caseId || '').slice(0, 80);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO stats (account_id, mowbucks) VALUES ($1, 0) ON CONFLICT (account_id) DO NOTHING`, [accountId]);
    const stats = await client.query(`SELECT mowbucks FROM stats WHERE account_id = $1 FOR UPDATE`, [accountId]);
    const balance = Number(stats.rows[0]?.mowbucks || 0);
    if (balance < safePrice) throw new Error('not_enough_coins');
    await client.query(`UPDATE stats SET mowbucks = mowbucks - $2, updated_at = now() WHERE account_id = $1`, [accountId, safePrice]);
    const granted = await client.query(
      `INSERT INTO case_inventory (account_id, case_id, quantity, updated_at)
         VALUES ($1, $2, 1, now())
       ON CONFLICT (account_id, case_id) DO UPDATE SET
         quantity = case_inventory.quantity + 1,
         updated_at = now()
       RETURNING account_id, case_id, quantity`,
      [accountId, safeCaseId]
    );
    const balanceAfter = await client.query(`SELECT mowbucks FROM stats WHERE account_id = $1`, [accountId]);
    await client.query('COMMIT');
    return {
      caseInventory: granted.rows[0] || null,
      mowbucks: Number(balanceAfter.rows[0]?.mowbucks || 0)
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function getCaseInventory(accountId) {
  const { rows } = await query(
    `SELECT account_id, case_id, quantity, updated_at
       FROM case_inventory
      WHERE account_id = $1 AND quantity > 0
      ORDER BY updated_at DESC`,
    [accountId]
  );
  return rows;
}

async function getCustomCases() {
  const { rows } = await query(
    `SELECT id, display_name, collection_name, design_id, price, visible_in_market, available_from, available_until, show_time_remaining,
            discount_price, discount_mode, discount_starts_at, discount_ends_at, final_discount_minutes,
            rarity_mode, rarity_weights_json, items_json, created_by, updated_at
       FROM custom_cases
      ORDER BY display_name ASC, id ASC`
  );
  return rows.map(row => ({
    id: row.id,
    displayName: row.display_name,
    collectionName: row.collection_name || '',
    designId: row.design_id || 'auto',
    price: Number(row.price || 0),
    marketVisible: row.visible_in_market !== false,
    availableFrom: row.available_from,
    availableUntil: row.available_until,
    showTimeRemaining: row.show_time_remaining === true,
    discountPrice: row.discount_price == null ? null : Number(row.discount_price),
    discountMode: row.discount_mode || 'none',
    discountStartsAt: row.discount_starts_at,
    discountEndsAt: row.discount_ends_at,
    finalDiscountMinutes: Number(row.final_discount_minutes || 0),
    rarityMode: row.rarity_mode === 'class' ? 'class' : 'skin',
    rarityWeights: row.rarity_weights_json && typeof row.rarity_weights_json === 'object' ? row.rarity_weights_json : {},
    items: Array.isArray(row.items_json) ? row.items_json : [],
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    custom: true
  }));
}

async function upsertCustomCase({ id, displayName, collectionName = '', designId = 'auto', price = 0, marketVisible = true,
  availableFrom = null, availableUntil = null, showTimeRemaining = false,
  discountPrice = null, discountMode = 'none', discountStartsAt = null, discountEndsAt = null, finalDiscountMinutes = 0,
  rarityMode = 'skin', rarityWeights = {}, items, accountId }) {
  // Admin case editor storage. The server-side skins sanitizer has already
  // normalized ids, prices, weights, and Mythic knife-only rules before this call.
  const { rows } = await query(
    `INSERT INTO custom_cases (id, display_name, collection_name, design_id, price, visible_in_market,
       available_from, available_until, show_time_remaining, discount_price, discount_mode, discount_starts_at, discount_ends_at, final_discount_minutes,
       rarity_mode, rarity_weights_json, items_json, created_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18, now())
     ON CONFLICT (id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       collection_name = EXCLUDED.collection_name,
       design_id = EXCLUDED.design_id,
       price = EXCLUDED.price,
       visible_in_market = EXCLUDED.visible_in_market,
       available_from = EXCLUDED.available_from,
       available_until = EXCLUDED.available_until,
       show_time_remaining = EXCLUDED.show_time_remaining,
       discount_price = EXCLUDED.discount_price,
       discount_mode = EXCLUDED.discount_mode,
       discount_starts_at = EXCLUDED.discount_starts_at,
       discount_ends_at = EXCLUDED.discount_ends_at,
       final_discount_minutes = EXCLUDED.final_discount_minutes,
       rarity_mode = EXCLUDED.rarity_mode,
       rarity_weights_json = EXCLUDED.rarity_weights_json,
       items_json = EXCLUDED.items_json,
       created_by = COALESCE(EXCLUDED.created_by, custom_cases.created_by),
       updated_at = now()
     RETURNING id, display_name, collection_name, design_id, price, visible_in_market, available_from, available_until, show_time_remaining,
       discount_price, discount_mode, discount_starts_at, discount_ends_at, final_discount_minutes,
       rarity_mode, rarity_weights_json, items_json, created_by, updated_at`,
    [id, displayName, collectionName, designId, Math.max(0, Math.floor(Number(price) || 0)), marketVisible !== false,
      availableFrom, availableUntil, showTimeRemaining === true, discountPrice, discountMode, discountStartsAt, discountEndsAt, finalDiscountMinutes,
      rarityMode === 'class' ? 'class' : 'skin', JSON.stringify(rarityWeights || {}), JSON.stringify(items || []), accountId || null]
  );
  const row = rows[0];
  return row ? {
    id: row.id,
    displayName: row.display_name,
    collectionName: row.collection_name || '',
    designId: row.design_id || 'auto',
    price: Number(row.price || 0),
    marketVisible: row.visible_in_market !== false,
    availableFrom: row.available_from,
    availableUntil: row.available_until,
    showTimeRemaining: row.show_time_remaining === true,
    discountPrice: row.discount_price == null ? null : Number(row.discount_price),
    discountMode: row.discount_mode || 'none',
    discountStartsAt: row.discount_starts_at,
    discountEndsAt: row.discount_ends_at,
    finalDiscountMinutes: Number(row.final_discount_minutes || 0),
    rarityMode: row.rarity_mode === 'class' ? 'class' : 'skin',
    rarityWeights: row.rarity_weights_json && typeof row.rarity_weights_json === 'object' ? row.rarity_weights_json : {},
    items: Array.isArray(row.items_json) ? row.items_json : [],
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    custom: true
  } : null;
}

async function deleteCustomCase(id) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const active = await client.query(
      `SELECT 1 FROM case_market_listings WHERE case_id = $1 AND status = 'active' LIMIT 1`,
      [id]
    );
    if (active.rows.length) throw new Error('active_case_listing');
    await client.query(`DELETE FROM case_market_listings WHERE case_id = $1`, [id]);
    const { rows } = await client.query(`DELETE FROM custom_cases WHERE id = $1 RETURNING id`, [id]);
    await client.query('COMMIT');
    return rows.length > 0;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function awardCaseRoll({
  accountId,
  caseId,
  itemId,
  rarityTier,
  gold,
  reel,
  patternSeed = 0,
  wearValue,
  wearSeed,
  collectionId = '',
  collectionEligible = false,
  consume = true
}) {
  // Atomic case open: consume one case, grant the won item, and record the reel in
  // one transaction so refresh/reconnect cannot duplicate rewards. Every touched
  // row is scoped by account_id; case opening must never use a shared inventory.
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const safePatternSeed = normalizePatternSeed(patternSeed);
    const appearance = instanceAppearance(itemId, { rarityTier, wearValue, wearSeed });
    if (consume) {
      const consumed = await client.query(
        `UPDATE case_inventory
            SET quantity = quantity - 1, updated_at = now()
          WHERE account_id = $1 AND case_id = $2 AND quantity > 0
        RETURNING quantity`,
        [accountId, caseId]
      );
      if (!consumed.rows[0]) throw new Error('case_not_owned');
    }
    const awarded = await client.query(
      `INSERT INTO skin_inventory (account_id, item_id, source, collection_id, pattern_seed, rarity_tier, wear_value, wear_seed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, account_id, item_id, source, collection_id, pattern_seed, rarity_tier, wear_value, wear_seed, created_at`,
      [accountId, itemId, `case:${caseId}`, String(collectionId || caseId || '').slice(0, 80) || null, safePatternSeed, appearance.rarityTier, appearance.wearValue, appearance.wearSeed]
    );
    const opening = await client.query(
      `INSERT INTO case_openings (account_id, case_id, item_id, rarity_tier, gold, pattern_seed, wear_value, wear_seed, reel_json, inventory_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       RETURNING id, case_id, item_id, rarity_tier, gold, pattern_seed, wear_value, wear_seed, inventory_id, created_at`,
      [accountId, caseId, itemId, appearance.rarityTier || rarityTier, !!gold, safePatternSeed, appearance.wearValue, appearance.wearSeed, JSON.stringify(reel || []), awarded.rows[0].id]
    );
    let collectionReward = null;
    if (consume && collectionEligible && collectionId) {
      const unlock = await client.query(
        `INSERT INTO skin_collection_unlocks (account_id, collection_id, case_id, item_id, xp_awarded)
           VALUES ($1, $2, $3, $4, 0)
         ON CONFLICT (account_id, collection_id, item_id) DO NOTHING
         RETURNING collection_id, item_id, unlocked_at`,
        [accountId, String(collectionId).slice(0, 80), caseId, itemId]
      );
      if (unlock.rowCount) {
        await client.query(`INSERT INTO stats (account_id) VALUES ($1) ON CONFLICT (account_id) DO NOTHING`, [accountId]);
        const stats = await client.query(`SELECT xp, mowbucks FROM stats WHERE account_id = $1 FOR UPDATE`, [accountId]);
        const before = progressionForXp(stats.rows[0]?.xp || 0);
        const xpAwarded = Math.max(1, Math.round(before.nextLevelXp * 0.1));
        const after = progressionForXp(before.xp + xpAwarded);
        const levelsGained = Math.max(0, after.level - before.level);
        const mowbucksAwarded = mowbucksForLevels(before.level, after.level);
        await client.query(
          `UPDATE stats
              SET xp = xp + $2, mowbucks = mowbucks + $3, updated_at = now()
            WHERE account_id = $1`,
          [accountId, xpAwarded, mowbucksAwarded]
        );
        await client.query(
          `UPDATE skin_collection_unlocks
              SET xp_awarded = $4
            WHERE account_id = $1 AND collection_id = $2 AND item_id = $3`,
          [accountId, String(collectionId).slice(0, 80), itemId, xpAwarded]
        );
        collectionReward = {
          collectionId: String(collectionId).slice(0, 80),
          itemId,
          xpAwarded,
          levelsGained,
          mowbucksAwarded,
          level: after.level
        };
      }
    }
    await client.query('COMMIT');
    return { opening: opening.rows[0], inventoryItem: awarded.rows[0], collectionReward };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function getCollectionUnlocks(accountId) {
  const { rows } = await query(
    `SELECT collection_id, case_id, item_id, xp_awarded, unlocked_at
       FROM skin_collection_unlocks
      WHERE account_id = $1
      ORDER BY unlocked_at ASC`,
    [accountId]
  );
  return rows;
}

async function listMarketListings({ limit = 50, search = '', sort = 'newest', itemId = '', weapon = '' } = {}) {
  // Keep the SQL bounded: marketplace pages request small slices, with weapon
  // filtering applied after the active-listing query for the current simple id
  // naming scheme.
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
  const clauses = [`l.status = 'active'`];
  const params = [];
  if (itemId) { params.push(String(itemId)); clauses.push(`l.item_id = $${params.length}`); }
  if (search) { params.push(`%${String(search).toLowerCase()}%`); clauses.push(`lower(l.item_id) LIKE $${params.length}`); }
  const order = sort === 'priceAsc' ? 'l.price ASC, l.created_at DESC'
    : sort === 'priceDesc' ? 'l.price DESC, l.created_at DESC'
      : 'l.created_at DESC';
  params.push(safeLimit);
  const { rows } = await query(
    `SELECT l.id, l.seller_id, a.username AS seller_name, l.inventory_id, inventory.item_id,
            inventory.pattern_seed, inventory.rarity_tier, inventory.wear_value, inventory.wear_seed,
            l.price, l.status, l.created_at, l.updated_at
       FROM skin_market_listings l
       JOIN accounts a ON a.id = l.seller_id
       JOIN skin_inventory inventory ON inventory.id = l.inventory_id AND inventory.account_id = l.seller_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY ${order}
      LIMIT $${params.length}`,
    params
  );
  return weapon ? rows.filter(row => String(row.item_id || '').startsWith(`${String(weapon).toLowerCase()}_`)) : rows;
}

async function getFeaturedMarketListing() {
  // A showcase deal must be grounded in a completed fixed-price sale. Auctions
  // are deliberately excluded: their final value is only known at settlement.
  const { rows } = await query(
    `SELECT l.id, l.seller_id, a.username AS seller_name, l.inventory_id, inventory.item_id,
            inventory.pattern_seed, inventory.rarity_tier, inventory.wear_value, inventory.wear_seed,
            l.price, l.status, l.created_at, l.updated_at,
            history.prior_high_price,
            history.prior_high_price - l.price AS price_difference,
            ROUND(((history.prior_high_price - l.price)::numeric / NULLIF(history.prior_high_price, 0)) * 100) AS discount_percent,
            NULL::numeric AS rarity_average_price,
            'historical_drop'::text AS showcase_basis
       FROM skin_market_listings l
       JOIN accounts a ON a.id = l.seller_id
       JOIN skin_inventory inventory ON inventory.id = l.inventory_id AND inventory.account_id = l.seller_id
       JOIN LATERAL (
         SELECT MAX(sold.price) AS prior_high_price
           FROM skin_market_listings sold
          WHERE sold.item_id = l.item_id
            AND sold.status = 'sold'
       ) history ON history.prior_high_price > l.price
      WHERE l.status = 'active'
        AND l.listing_type = 'fixed'
      ORDER BY price_difference DESC, discount_percent DESC, l.price ASC, l.created_at ASC
      LIMIT 1`
  );
  if (rows[0]) return rows[0];

  const { rows: fallbackRows } = await query(
    `WITH rarity_sales AS (
       SELECT rarity_tier, AVG(price)::numeric AS rarity_average_price
         FROM skin_market_listings
        WHERE status = 'sold'
          AND rarity_tier IS NOT NULL
        GROUP BY rarity_tier
     )
     SELECT l.id, l.seller_id, a.username AS seller_name, l.inventory_id, inventory.item_id,
            inventory.pattern_seed, inventory.rarity_tier, inventory.wear_value, inventory.wear_seed,
            l.price, l.status, l.created_at, l.updated_at,
            NULL::numeric AS prior_high_price,
            GREATEST(0, ROUND(COALESCE(rarity_sales.rarity_average_price, l.price) - l.price)) AS price_difference,
            CASE WHEN rarity_sales.rarity_average_price > 0
              THEN ROUND(((rarity_sales.rarity_average_price - l.price)::numeric / rarity_sales.rarity_average_price) * 100)
              ELSE 0
            END AS discount_percent,
            rarity_sales.rarity_average_price,
            'rarity_value'::text AS showcase_basis
       FROM skin_market_listings l
       JOIN accounts a ON a.id = l.seller_id
       JOIN skin_inventory inventory ON inventory.id = l.inventory_id AND inventory.account_id = l.seller_id
       LEFT JOIN rarity_sales ON rarity_sales.rarity_tier = inventory.rarity_tier
      WHERE l.status = 'active'
        AND l.listing_type = 'fixed'
      ORDER BY (rarity_sales.rarity_average_price IS NULL) ASC,
               (l.price::numeric / NULLIF(rarity_sales.rarity_average_price, 0)) ASC NULLS LAST,
               l.price ASC,
               l.created_at ASC
      LIMIT 1`
  );
  return fallbackRows[0] || null;
}

async function getMarketOverview({ excludedItemIds = [] } = {}) {
  const excluded = [...new Set((excludedItemIds || []).map(String).filter(Boolean))];
  const { rows } = await query(
    `WITH circulation AS (
       SELECT item_id, COUNT(*)::bigint AS quantity
         FROM skin_inventory
        WHERE NOT (item_id = ANY($1::text[]))
        GROUP BY item_id
     ), sold_prices AS (
       SELECT item_id, AVG(price)::numeric AS average_sold_price
         FROM skin_market_listings
        WHERE status = 'sold'
        GROUP BY item_id
     ), active_prices AS (
       SELECT item_id, MIN(price)::numeric AS lowest_active_price
         FROM skin_market_listings
        WHERE status = 'active'
        GROUP BY item_id
     )
     SELECT COALESCE(SUM(c.quantity), 0)::bigint AS circulation,
            ROUND(COALESCE(SUM(c.quantity * COALESCE(s.average_sold_price, a.lowest_active_price, 0)), 0))::bigint AS market_cap,
            (SELECT COUNT(*)::bigint FROM case_openings) AS cases_unboxed,
            (SELECT COUNT(*)::bigint FROM trade_up_transactions) AS trade_ups_completed,
            ((SELECT COALESCE(SUM(mowbucks), 0)::bigint FROM stats)
              + (SELECT COALESCE(SUM(price), 0)::bigint FROM skin_market_listings
                  WHERE status = 'active' AND listing_type = 'auction' AND highest_bidder_id IS NOT NULL)) AS money_supply
       FROM circulation c
       LEFT JOIN sold_prices s ON s.item_id = c.item_id
       LEFT JOIN active_prices a ON a.item_id = c.item_id`,
    [excluded]
  );
  const row = rows[0] || {};
  return {
    marketCap: Number(row.market_cap || 0),
    circulation: Number(row.circulation || 0),
    casesUnboxed: Number(row.cases_unboxed || 0),
    tradeUpsCompleted: Number(row.trade_ups_completed || 0),
    moneySupply: Number(row.money_supply || 0)
  };
}

async function getSoldMarketCatalog({ search = '', limit = 500 } = {}) {
  const safeSearch = String(search || '').trim().toLowerCase();
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 500)));
  const { rows } = await query(
    `SELECT l.item_id,
            COUNT(*)::bigint AS sold_count,
            ROUND(AVG(l.price))::bigint AS average_price,
            MIN(l.price)::bigint AS lowest_price,
            MAX(l.price)::bigint AS highest_price,
            MAX(l.updated_at) AS last_sold_at,
            ARRAY(
              SELECT recent.price
                FROM (
                  SELECT h.price, h.updated_at
                    FROM skin_market_listings h
                   WHERE h.item_id = l.item_id AND h.status = 'sold'
                   ORDER BY h.updated_at DESC
                   LIMIT 24
                ) recent
               ORDER BY recent.updated_at ASC
            ) AS recent_prices
       FROM skin_market_listings l
      WHERE l.status = 'sold'
        AND ($1 = '' OR lower(l.item_id) LIKE ('%' || $1 || '%'))
      GROUP BY l.item_id
      ORDER BY last_sold_at DESC, l.item_id ASC
      LIMIT $2`,
    [safeSearch, safeLimit]
  );
  return rows.map((row) => ({
    ...row,
    sold_count: Number(row.sold_count || 0),
    average_price: Number(row.average_price || 0),
    lowest_price: Number(row.lowest_price || 0),
    highest_price: Number(row.highest_price || 0),
    recent_prices: (row.recent_prices || []).map((price) => Number(price || 0))
  }));
}

async function getMarketItemHistory(itemId, { limit = 500 } = {}) {
  const safeItemId = String(itemId || '').trim();
  if (!safeItemId) return [];
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 500)));
  const { rows } = await query(
    `SELECT * FROM (
       SELECT l.id, l.seller_id, l.buyer_id, l.inventory_id, l.item_id, l.pattern_seed, l.rarity_tier,
              l.wear_value, l.wear_seed, l.price, l.listing_type, l.updated_at AS sold_at,
              seller.username AS seller_name, buyer.username AS buyer_name
         FROM skin_market_listings l
         LEFT JOIN accounts seller ON seller.id = l.seller_id
         LEFT JOIN accounts buyer ON buyer.id = l.buyer_id
        WHERE l.status = 'sold' AND l.item_id = $1
        ORDER BY l.updated_at DESC
        LIMIT $2
     ) history
     ORDER BY sold_at ASC`,
    [safeItemId, safeLimit]
  );
  return rows;
}

const MARKET_AUCTION_DURATIONS_MINUTES = new Set([15, 60, 360, 1440]);

function normalizeMarketListingType(value) {
  return String(value || '').toLowerCase() === 'auction' ? 'auction' : 'fixed';
}

function normalizeMarketAuctionDuration(value) {
  const duration = Math.floor(Number(value) || 60);
  return MARKET_AUCTION_DURATIONS_MINUTES.has(duration) ? duration : 60;
}

// asAdmin lifts the two limits a seller has: it cancels somebody else's listing,
// and it cancels an auction that already has bids.
//
// The refund is the part that matters. Bidding deducts the bid immediately and
// hands it back when you are outbid, so an auction's current price is money
// already taken from the highest bidder. Pulling that listing without returning
// it would quietly delete a player's balance, so a forced cancel refunds them in
// the same transaction as the cancel - either both land or neither does.
async function cancelMarketListing({ accountId, listingId, asAdmin = false }) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      asAdmin
        ? `SELECT * FROM skin_market_listings WHERE id = $1 AND status = 'active' FOR UPDATE`
        : `SELECT * FROM skin_market_listings WHERE id = $1 AND seller_id = $2 AND status = 'active' FOR UPDATE`,
      asAdmin ? [listingId] : [listingId, accountId]
    );
    const listing = locked.rows[0];
    if (!listing) {
      await client.query('ROLLBACK');
      return null;
    }
    const hasBids = listing.listing_type === 'auction' && Number(listing.bid_count || 0) > 0;
    if (hasBids && !asAdmin) throw new Error('auction_has_bids');

    let refunded = null;
    if (hasBids && listing.highest_bidder_id) {
      const amount = Number(listing.price || 0);
      if (amount > 0) {
        await client.query(
          `INSERT INTO stats (account_id, mowbucks) VALUES ($1, $2)
           ON CONFLICT (account_id) DO UPDATE SET mowbucks = stats.mowbucks + EXCLUDED.mowbucks, updated_at = now()`,
          [listing.highest_bidder_id, amount]
        );
        refunded = { accountId: String(listing.highest_bidder_id), amount };
      }
    }

    const { rows } = await client.query(
      `UPDATE skin_market_listings
          SET status = 'cancelled', updated_at = now()
        WHERE id = $1
        RETURNING id, seller_id, inventory_id, item_id, pattern_seed, rarity_tier, wear_value, wear_seed,
                  price, listing_type, ends_at, highest_bidder_id, bid_count, status, created_at, updated_at`,
      [listingId]
    );
    await client.query('COMMIT');
    const cancelled = rows[0] || null;
    if (cancelled) cancelled.refunded = refunded;
    return cancelled;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

// Repricing somebody else's listing. Admin only - the caller does that check.
//
// Refuses an auction that has already taken a bid. Bidding deducts the bid at
// once and the listing's price IS that held amount, so moving it would either
// strand money in a bidder's account or hand the seller more than was ever
// taken. A fixed-price listing has no such claim on it and can be moved freely.
async function setMarketListingPrice({ listingId, price }) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const safePrice = Math.max(0, Math.min(1000000000, Math.floor(Number(price) || 0)));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT * FROM skin_market_listings WHERE id = $1 AND status = 'active' FOR UPDATE`,
      [listingId]
    );
    const listing = locked.rows[0];
    if (!listing) {
      await client.query('ROLLBACK');
      return null;
    }
    if (listing.listing_type === 'auction' && Number(listing.bid_count || 0) > 0) {
      throw new Error('auction_has_bids');
    }
    const { rows } = await client.query(
      `WITH updated AS (
         UPDATE skin_market_listings SET price = $2, updated_at = now()
          WHERE id = $1
        RETURNING id, seller_id, inventory_id, item_id, pattern_seed, rarity_tier, wear_value, wear_seed,
                  price, listing_type, ends_at, highest_bidder_id, bid_count, status, created_at, updated_at
       )
       SELECT updated.*, seller.username AS seller_name
         FROM updated LEFT JOIN accounts seller ON seller.id = updated.seller_id`,
      [listingId, safePrice]
    );
    await client.query('COMMIT');
    const updated = rows[0] || null;
    // The caller needs the old figure to say what actually changed.
    if (updated) updated.previous_price = Number(listing.price || 0);
    return updated;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

function minimumMarketAuctionBid(listing) {
  const current = Math.max(1, Number(listing?.price || 1));
  if (Number(listing?.bid_count || 0) <= 0) return current;
  return current + Math.max(1, Math.ceil(current * 0.05));
}

async function placeMarketAuctionBid({ bidderId, listingId, amount }) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const safeAmount = Math.max(1, Math.floor(Number(amount) || 0));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT * FROM skin_market_listings WHERE id = $1 AND status = 'active' FOR UPDATE`,
      [listingId]
    );
    const listing = locked.rows[0];
    if (!listing) throw new Error('listing_not_found');
    if (listing.listing_type !== 'auction') throw new Error('not_an_auction');
    if (!listing.ends_at || new Date(listing.ends_at).getTime() <= Date.now()) throw new Error('auction_ended');
    if (String(listing.seller_id) === String(bidderId)) throw new Error('own_listing');
    const minimumBid = minimumMarketAuctionBid(listing);
    if (safeAmount < minimumBid) {
      const error = new Error('bid_too_low');
      error.minimumBid = minimumBid;
      throw error;
    }

    const previousBidderId = listing.highest_bidder_id;
    const accountIds = [...new Set([bidderId, previousBidderId].filter(Boolean).map(String))].sort((a, b) => Number(a) - Number(b));
    for (const accountId of accountIds) {
      await client.query(`INSERT INTO stats (account_id, mowbucks) VALUES ($1, 0) ON CONFLICT (account_id) DO NOTHING`, [accountId]);
    }
    const balances = await client.query(
      `SELECT account_id, mowbucks FROM stats
        WHERE account_id = ANY($1::bigint[])
        ORDER BY account_id
        FOR UPDATE`,
      [accountIds]
    );
    const balanceByAccount = new Map(balances.rows.map(row => [String(row.account_id), Number(row.mowbucks || 0)]));
    const sameBidder = previousBidderId && String(previousBidderId) === String(bidderId);
    const charge = sameBidder ? safeAmount - Number(listing.price || 0) : safeAmount;
    if ((balanceByAccount.get(String(bidderId)) || 0) < charge) throw new Error('not_enough_coins');
    if (charge > 0) {
      await client.query(`UPDATE stats SET mowbucks = mowbucks - $2, updated_at = now() WHERE account_id = $1`, [bidderId, charge]);
    }
    if (previousBidderId && !sameBidder) {
      await client.query(`UPDATE stats SET mowbucks = mowbucks + $2, updated_at = now() WHERE account_id = $1`, [previousBidderId, Number(listing.price || 0)]);
    }

    const updated = await client.query(
      `WITH auction AS (
         UPDATE skin_market_listings
            SET price = $2,
                highest_bidder_id = $3,
                bid_count = bid_count + 1,
                ends_at = CASE WHEN ends_at < now() + interval '15 seconds' THEN now() + interval '15 seconds' ELSE ends_at END,
                updated_at = now()
          WHERE id = $1
        RETURNING *
       )
       SELECT auction.*, seller.username AS seller_name, bidder.username AS highest_bidder_name
         FROM auction
         LEFT JOIN accounts seller ON seller.id = auction.seller_id
         LEFT JOIN accounts bidder ON bidder.id = auction.highest_bidder_id`,
      [listingId, safeAmount, bidderId]
    );
    await client.query(
      `INSERT INTO skin_market_bids (listing_id, bidder_id, amount) VALUES ($1, $2, $3)`,
      [listingId, bidderId, safeAmount]
    );
    await client.query('COMMIT');
    return {
      listing: updated.rows[0],
      previousBidderId: previousBidderId && !sameBidder ? previousBidderId : null,
      minimumNextBid: minimumMarketAuctionBid(updated.rows[0])
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function settleMarketAuctionListing(listingId) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT * FROM skin_market_listings WHERE id = $1 AND status = 'active' FOR UPDATE`,
      [listingId]
    );
    const listing = locked.rows[0];
    if (!listing || listing.listing_type !== 'auction') {
      await client.query('ROLLBACK');
      return null;
    }
    if (!listing.ends_at || new Date(listing.ends_at).getTime() > Date.now()) {
      await client.query('ROLLBACK');
      return null;
    }
    if (!listing.highest_bidder_id || Number(listing.bid_count || 0) <= 0) {
      const cancelled = await client.query(
        `UPDATE skin_market_listings SET status = 'cancelled', updated_at = now()
          WHERE id = $1 RETURNING *`,
        [listingId]
      );
      await client.query('COMMIT');
      return { listing: cancelled.rows[0], sold: false, reason: 'no_bids' };
    }

    const accountIds = [listing.seller_id, listing.highest_bidder_id].map(String).sort((a, b) => Number(a) - Number(b));
    for (const accountId of accountIds) {
      await client.query(`INSERT INTO stats (account_id, mowbucks) VALUES ($1, 0) ON CONFLICT (account_id) DO NOTHING`, [accountId]);
    }
    await client.query(
      `SELECT account_id FROM stats WHERE account_id = ANY($1::bigint[]) ORDER BY account_id FOR UPDATE`,
      [accountIds]
    );
    const owned = await client.query(
      `SELECT id, item_id, pattern_seed, rarity_tier, wear_value, wear_seed
         FROM skin_inventory WHERE id = $1 AND account_id = $2 FOR UPDATE`,
      [listing.inventory_id, listing.seller_id]
    );
    const inventory = owned.rows[0];
    if (!inventory) {
      await client.query(`UPDATE stats SET mowbucks = mowbucks + $2, updated_at = now() WHERE account_id = $1`, [listing.highest_bidder_id, Number(listing.price || 0)]);
      const cancelled = await client.query(
        `UPDATE skin_market_listings SET status = 'cancelled', updated_at = now()
          WHERE id = $1 RETURNING *`,
        [listingId]
      );
      await client.query('COMMIT');
      return { listing: cancelled.rows[0], sold: false, reason: 'item_missing', refundedBidderId: listing.highest_bidder_id };
    }

    await client.query(`UPDATE stats SET mowbucks = mowbucks + $2, updated_at = now() WHERE account_id = $1`, [listing.seller_id, Number(listing.price || 0)]);
    await client.query(`UPDATE skin_inventory SET account_id = $1 WHERE id = $2`, [listing.highest_bidder_id, listing.inventory_id]);
    await client.query(`DELETE FROM skin_loadouts WHERE inventory_id = $1`, [listing.inventory_id]);
    const sold = await client.query(
      `WITH auction AS (
         UPDATE skin_market_listings
            SET status = 'sold', buyer_id = highest_bidder_id,
                item_id = $2, pattern_seed = $3, rarity_tier = $4,
                wear_value = $5, wear_seed = $6, updated_at = now()
          WHERE id = $1
        RETURNING *
       )
       SELECT auction.*, seller.username AS seller_name, buyer.username AS buyer_name
         FROM auction
         LEFT JOIN accounts seller ON seller.id = auction.seller_id
         LEFT JOIN accounts buyer ON buyer.id = auction.buyer_id`,
      [listingId, inventory.item_id, normalizePatternSeed(inventory.pattern_seed), inventory.rarity_tier || null, Number(inventory.wear_value || 0), normalizePositiveIntSeed(inventory.wear_seed)]
    );
    await client.query('COMMIT');
    return { listing: sold.rows[0], sold: true };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function settleExpiredMarketAuctions({ limit = 25 } = {}) {
  if (!pool) return [];
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 25)));
  const { rows } = await query(
    `SELECT id FROM skin_market_listings
      WHERE status = 'active' AND listing_type = 'auction' AND ends_at <= now()
      ORDER BY ends_at ASC
      LIMIT $1`,
    [safeLimit]
  );
  const settled = [];
  for (const row of rows) {
    const result = await settleMarketAuctionListing(row.id);
    if (result) settled.push(result);
  }
  return settled;
}

async function createCaseMarketListing({ accountId, caseId, price }) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const safeCaseId = String(caseId || '').trim().slice(0, 80);
  const safePrice = Math.max(0, Math.min(1000000000, Math.floor(Number(price) || 0)));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owned = await client.query(
      `SELECT quantity FROM case_inventory WHERE account_id = $1 AND case_id = $2 FOR UPDATE`,
      [accountId, safeCaseId]
    );
    if (Number(owned.rows[0]?.quantity || 0) <= 0) throw new Error('case_not_owned');
    await client.query(
      `UPDATE case_inventory SET quantity = quantity - 1, updated_at = now() WHERE account_id = $1 AND case_id = $2`,
      [accountId, safeCaseId]
    );
    await client.query(`DELETE FROM case_inventory WHERE account_id = $1 AND case_id = $2 AND quantity <= 0`, [accountId, safeCaseId]);
    const listed = await client.query(
      `INSERT INTO case_market_listings (seller_id, case_id, price)
       VALUES ($1, $2, $3)
       RETURNING id, seller_id, case_id, price, status, created_at, updated_at`,
      [accountId, safeCaseId, safePrice]
    );
    await client.query('COMMIT');
    return listed.rows[0] || null;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function listCaseMarketListings({ limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 100)));
  const { rows } = await query(
    `SELECT l.id, l.seller_id, a.username AS seller_name, l.case_id, l.price, l.status, l.created_at, l.updated_at
       FROM case_market_listings l
       JOIN accounts a ON a.id = l.seller_id
      WHERE l.status = 'active'
      ORDER BY l.price ASC, l.created_at ASC
      LIMIT $1`,
    [safeLimit]
  );
  return rows;
}

async function cancelCaseMarketListing({ accountId, listingId }) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const listing = await client.query(
      `SELECT * FROM case_market_listings WHERE id = $1 AND seller_id = $2 AND status = 'active' FOR UPDATE`,
      [listingId, accountId]
    );
    const row = listing.rows[0];
    if (!row) throw new Error('listing_not_found');
    await client.query(
      `INSERT INTO case_inventory (account_id, case_id, quantity, updated_at) VALUES ($1, $2, 1, now())
       ON CONFLICT (account_id, case_id) DO UPDATE SET quantity = case_inventory.quantity + 1, updated_at = now()`,
      [accountId, row.case_id]
    );
    const cancelled = await client.query(
      `UPDATE case_market_listings SET status = 'cancelled', updated_at = now() WHERE id = $1
       RETURNING id, seller_id, case_id, price, status, created_at, updated_at`,
      [listingId]
    );
    await client.query('COMMIT');
    return cancelled.rows[0] || null;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function buyCaseMarketListing({ buyerId, listingId }) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const listing = await client.query(`SELECT * FROM case_market_listings WHERE id = $1 AND status = 'active' FOR UPDATE`, [listingId]);
    const row = listing.rows[0];
    if (!row) throw new Error('listing_not_found');
    if (String(row.seller_id) === String(buyerId)) throw new Error('own_listing');
    await client.query(`INSERT INTO stats (account_id, mowbucks) VALUES ($1, 0), ($2, 0) ON CONFLICT (account_id) DO NOTHING`, [buyerId, row.seller_id]);
    const accountIds = [String(buyerId), String(row.seller_id)].sort((a, b) => Number(a) - Number(b));
    await client.query(`SELECT account_id FROM stats WHERE account_id = ANY($1::bigint[]) ORDER BY account_id FOR UPDATE`, [accountIds]);
    const buyer = await client.query(`SELECT mowbucks FROM stats WHERE account_id = $1`, [buyerId]);
    const price = Number(row.price || 0);
    if (Number(buyer.rows[0]?.mowbucks || 0) < price) throw new Error('not_enough_coins');
    await client.query(`UPDATE stats SET mowbucks = mowbucks - $2, updated_at = now() WHERE account_id = $1`, [buyerId, price]);
    await client.query(`UPDATE stats SET mowbucks = mowbucks + $2, updated_at = now() WHERE account_id = $1`, [row.seller_id, price]);
    await client.query(
      `INSERT INTO case_inventory (account_id, case_id, quantity, updated_at) VALUES ($1, $2, 1, now())
       ON CONFLICT (account_id, case_id) DO UPDATE SET quantity = case_inventory.quantity + 1, updated_at = now()`,
      [buyerId, row.case_id]
    );
    const sold = await client.query(
      `UPDATE case_market_listings SET status = 'sold', updated_at = now() WHERE id = $1
       RETURNING id, seller_id, case_id, price, status, created_at, updated_at`,
      [listingId]
    );
    await client.query('COMMIT');
    return sold.rows[0] || row;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function createTradeRequest({ fromAccount, toAccount, offer = {}, request = {} }) {
  // Pending trades intentionally store the requested payload as JSON; acceptance
  // below is the first point where assets/coins move.
  const { rows } = await query(
    `INSERT INTO skin_trade_requests (from_account, to_account, offer_json, request_json)
       VALUES ($1, $2, $3::jsonb, $4::jsonb)
     RETURNING id, from_account, to_account, offer_json, request_json, status, created_at, updated_at`,
    [fromAccount, toAccount, JSON.stringify(offer || {}), JSON.stringify(request || {})]
  );
  return rows[0] || null;
}

async function respondTradeRequest({ accountId, tradeId, action }) {
  // Trade acceptance is all-or-nothing: lock the request, reject listed/missing
  // items, verify both balances, move items/coins, clear loadouts, then mark done.
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tradeResult = await client.query(`SELECT * FROM skin_trade_requests WHERE id = $1 FOR UPDATE`, [tradeId]);
    const trade = tradeResult.rows[0];
    if (!trade || trade.status !== 'pending') throw new Error('trade_not_found');
    const isSender = String(trade.from_account) === String(accountId);
    const isReceiver = String(trade.to_account) === String(accountId);
    if (!isSender && !isReceiver) throw new Error('not_trade_party');
    if (action === 'cancel' && isSender) {
      const cancelled = await client.query(`UPDATE skin_trade_requests SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *`, [tradeId]);
      await client.query('COMMIT');
      return cancelled.rows[0];
    }
    if (action === 'decline' && isReceiver) {
      const declined = await client.query(`UPDATE skin_trade_requests SET status = 'declined', updated_at = now() WHERE id = $1 RETURNING *`, [tradeId]);
      await client.query('COMMIT');
      return declined.rows[0];
    }
    if (action !== 'accept' || !isReceiver) throw new Error('invalid_trade_action');
    const offer = trade.offer_json || {};
    const request = trade.request_json || {};
    const offerItems = Array.isArray(offer.items) ? offer.items.map(Number).filter(Number.isSafeInteger) : [];
    const requestItems = Array.isArray(request.items) ? request.items.map(Number).filter(Number.isSafeInteger) : [];
    const offerCoins = Math.max(0, Math.floor(Number(offer.coins) || 0));
    const requestCoins = Math.max(0, Math.floor(Number(request.coins) || 0));
    const allItems = [...offerItems, ...requestItems];
    if (new Set(allItems).size !== allItems.length) throw new Error('duplicate_trade_item');
    if (allItems.length) {
      const listed = await client.query(`SELECT inventory_id FROM skin_market_listings WHERE inventory_id = ANY($1::bigint[]) AND status = 'active'`, [allItems]);
      if (listed.rows.length) throw new Error('trade_item_listed');
    }
    for (const id of offerItems) {
      const owned = await client.query(`SELECT id FROM skin_inventory WHERE id = $1 AND account_id = $2 FOR UPDATE`, [id, trade.from_account]);
      if (!owned.rows[0]) throw new Error('sender_item_missing');
    }
    for (const id of requestItems) {
      const owned = await client.query(`SELECT id FROM skin_inventory WHERE id = $1 AND account_id = $2 FOR UPDATE`, [id, trade.to_account]);
      if (!owned.rows[0]) throw new Error('receiver_item_missing');
    }
    if (offerCoins || requestCoins) {
      await client.query(`INSERT INTO stats (account_id, mowbucks) VALUES ($1, 0) ON CONFLICT (account_id) DO NOTHING`, [trade.from_account]);
      await client.query(`INSERT INTO stats (account_id, mowbucks) VALUES ($1, 0) ON CONFLICT (account_id) DO NOTHING`, [trade.to_account]);
      const stats = await client.query(`SELECT account_id, mowbucks FROM stats WHERE account_id = ANY($1::bigint[]) FOR UPDATE`, [[trade.from_account, trade.to_account]]);
      const balances = new Map(stats.rows.map(row => [String(row.account_id), Number(row.mowbucks || 0)]));
      if ((balances.get(String(trade.from_account)) || 0) < offerCoins) throw new Error('sender_coins_missing');
      if ((balances.get(String(trade.to_account)) || 0) < requestCoins) throw new Error('receiver_coins_missing');
      if (offerCoins) {
        await client.query(`UPDATE stats SET mowbucks = mowbucks - $2, updated_at = now() WHERE account_id = $1`, [trade.from_account, offerCoins]);
        await client.query(`UPDATE stats SET mowbucks = mowbucks + $2, updated_at = now() WHERE account_id = $1`, [trade.to_account, offerCoins]);
      }
      if (requestCoins) {
        await client.query(`UPDATE stats SET mowbucks = mowbucks - $2, updated_at = now() WHERE account_id = $1`, [trade.to_account, requestCoins]);
        await client.query(`UPDATE stats SET mowbucks = mowbucks + $2, updated_at = now() WHERE account_id = $1`, [trade.from_account, requestCoins]);
      }
    }
    if (offerItems.length) await client.query(`UPDATE skin_inventory SET account_id = $1 WHERE id = ANY($2::bigint[])`, [trade.to_account, offerItems]);
    if (requestItems.length) await client.query(`UPDATE skin_inventory SET account_id = $1 WHERE id = ANY($2::bigint[])`, [trade.from_account, requestItems]);
    if (allItems.length) await client.query(`DELETE FROM skin_loadouts WHERE inventory_id = ANY($1::bigint[])`, [allItems]);
    const accepted = await client.query(`UPDATE skin_trade_requests SET status = 'accepted', updated_at = now() WHERE id = $1 RETURNING *`, [tradeId]);
    await client.query('COMMIT');
    return accepted.rows[0];
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function createMarketListing({ accountId, inventoryId, price, listingType = 'fixed', durationMinutes = 60 }) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const safeListingType = normalizeMarketListingType(listingType);
  const safePrice = Math.max(safeListingType === 'auction' ? 1 : 0, Math.floor(Number(price) || 0));
  const safeDuration = normalizeMarketAuctionDuration(durationMinutes);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [`skin-economy:${accountId}`]);
    const owned = await client.query(
      `SELECT id, item_id, pattern_seed, rarity_tier, wear_value, wear_seed
         FROM skin_inventory WHERE id = $1 AND account_id = $2 FOR UPDATE`,
      [inventoryId, accountId]
    );
    if (!owned.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const item = owned.rows[0];
    const listing = await client.query(
      `INSERT INTO skin_market_listings
         (seller_id, inventory_id, item_id, pattern_seed, rarity_tier, wear_value, wear_seed, price, listing_type, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               CASE WHEN $9 = 'auction' THEN now() + ($10::int * interval '1 minute') ELSE NULL END)
       RETURNING id, seller_id, inventory_id, item_id, pattern_seed, rarity_tier, wear_value, wear_seed,
                 price, listing_type, ends_at, highest_bidder_id, bid_count, status, created_at, updated_at`,
      [accountId, inventoryId, item.item_id, normalizePatternSeed(item.pattern_seed), item.rarity_tier || null, Number(item.wear_value || 0), normalizePositiveIntSeed(item.wear_seed), safePrice, safeListingType, safeDuration]
    );
    await client.query('COMMIT');
    return listing.rows[0] || null;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function listMarketListings({ limit = 50, search = '', sort = 'newest', itemId = '', weapon = '' } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
  const clauses = [`l.status = 'active'`];
  const params = [];
  if (itemId) { params.push(String(itemId)); clauses.push(`l.item_id = $${params.length}`); }
  if (search) { params.push(`%${String(search).toLowerCase()}%`); clauses.push(`lower(l.item_id) LIKE $${params.length}`); }
  const order = sort === 'priceAsc' ? 'l.price ASC, l.created_at DESC'
    : sort === 'priceDesc' ? 'l.price DESC, l.created_at DESC'
      : 'l.created_at DESC';
  params.push(safeLimit);
  const { rows } = await query(
    `SELECT l.id, l.seller_id, a.username AS seller_name, l.inventory_id, inventory.item_id,
            inventory.pattern_seed, inventory.rarity_tier, inventory.wear_value, inventory.wear_seed,
            l.price, l.listing_type, l.ends_at, l.highest_bidder_id,
            highest_bidder.username AS highest_bidder_name, l.bid_count,
            l.status, l.created_at, l.updated_at
       FROM skin_market_listings l
       JOIN accounts a ON a.id = l.seller_id
       JOIN skin_inventory inventory ON inventory.id = l.inventory_id AND inventory.account_id = l.seller_id
       LEFT JOIN accounts highest_bidder ON highest_bidder.id = l.highest_bidder_id
      WHERE ${clauses.join(' AND ')}
        AND (l.listing_type <> 'auction' OR l.ends_at > now())
      ORDER BY ${order}
      LIMIT $${params.length}`,
    params
  );
  return weapon ? rows.filter(row => String(row.item_id || '').startsWith(`${String(weapon).toLowerCase()}_`)) : rows;
}

// Legacy fixed-price cancellation retained for migration history only. The
// auction-aware implementation above is the runtime function exported below.
async function legacyCancelMarketListing({ accountId, listingId }) {
  const { rows } = await query(
    `UPDATE skin_market_listings
        SET status = 'cancelled', updated_at = now()
      WHERE id = $1 AND seller_id = $2 AND status = 'active'
      RETURNING id, seller_id, inventory_id, item_id, pattern_seed, rarity_tier, wear_value, wear_seed, price, status, created_at, updated_at`,
    [listingId, accountId]
  );
  return rows[0] || null;
}

async function buyMarketListing({ buyerId, listingId }) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const listing = await client.query(
      `SELECT * FROM skin_market_listings WHERE id = $1 AND status = 'active' FOR UPDATE`,
      [listingId]
    );
    const row = listing.rows[0];
    if (!row) throw new Error('listing_not_found');
    if (row.listing_type === 'auction') throw new Error('auction_requires_bid');
    if (String(row.seller_id) === String(buyerId)) throw new Error('own_listing');
    await client.query(`INSERT INTO stats (account_id, mowbucks) VALUES ($1, 0) ON CONFLICT (account_id) DO NOTHING`, [buyerId]);
    const buyer = await client.query(`SELECT mowbucks FROM stats WHERE account_id = $1 FOR UPDATE`, [buyerId]);
    const balance = Number(buyer.rows[0]?.mowbucks || 0);
    const price = Number(row.price || 0);
    if (balance < price) throw new Error('not_enough_coins');
    const owned = await client.query(
      `SELECT id, item_id, pattern_seed, rarity_tier, wear_value, wear_seed
         FROM skin_inventory WHERE id = $1 AND account_id = $2 FOR UPDATE`,
      [row.inventory_id, row.seller_id]
    );
    const inventory = owned.rows[0];
    if (!inventory) throw new Error('seller_no_longer_owns_item');
    await client.query(`UPDATE stats SET mowbucks = mowbucks - $2, updated_at = now() WHERE account_id = $1`, [buyerId, price]);
    await client.query(
      `INSERT INTO stats (account_id, mowbucks) VALUES ($1, $2)
       ON CONFLICT (account_id) DO UPDATE SET mowbucks = stats.mowbucks + EXCLUDED.mowbucks, updated_at = now()`,
      [row.seller_id, price]
    );
    await client.query(`UPDATE skin_inventory SET account_id = $1 WHERE id = $2`, [buyerId, row.inventory_id]);
    await client.query(`DELETE FROM skin_loadouts WHERE inventory_id = $1`, [row.inventory_id]);
    const sold = await client.query(
      `WITH updated AS (
         UPDATE skin_market_listings
            SET status = 'sold', buyer_id = $2,
                item_id = $3, pattern_seed = $4, rarity_tier = $5,
                wear_value = $6, wear_seed = $7, updated_at = now()
          WHERE id = $1
        RETURNING id, seller_id, buyer_id, inventory_id, item_id, pattern_seed, rarity_tier, wear_value, wear_seed, price, status, created_at, updated_at
       )
       SELECT updated.*, seller.username AS seller_name, buyer.username AS buyer_name
         FROM updated
         LEFT JOIN accounts seller ON seller.id = updated.seller_id
         LEFT JOIN accounts buyer ON buyer.id = updated.buyer_id`,
      [
        listingId,
        buyerId,
        inventory.item_id,
        normalizePatternSeed(inventory.pattern_seed),
        inventory.rarity_tier || null,
        Number(inventory.wear_value || 0),
        normalizePositiveIntSeed(inventory.wear_seed)
      ]
    );
    await client.query('COMMIT');
    return sold.rows[0] || row;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function createTradeRequest({ fromAccount, toAccount, offer = {}, request = {} }) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const offerItems = Array.isArray(offer?.items) ? offer.items.map(Number).filter(id => Number.isSafeInteger(id) && id > 0) : [];
  const requestItems = Array.isArray(request?.items) ? request.items.map(Number).filter(id => Number.isSafeInteger(id) && id > 0) : [];
  const allItems = [...offerItems, ...requestItems];
  if (allItems.length > 100 || new Set(allItems).size !== allItems.length) throw new Error('duplicate_trade_item');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const accountIds = [Number(fromAccount), Number(toAccount)].sort((a, b) => a - b);
    for (const id of accountIds) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [`skin-economy:${id}`]);
    }
    if (offerItems.length) {
      const owned = await client.query(
        `SELECT id FROM skin_inventory WHERE account_id = $1 AND id = ANY($2::bigint[]) FOR UPDATE`,
        [fromAccount, offerItems]
      );
      if (owned.rowCount !== offerItems.length) throw new Error('sender_item_missing');
    }
    if (requestItems.length) {
      const owned = await client.query(
        `SELECT id FROM skin_inventory WHERE account_id = $1 AND id = ANY($2::bigint[]) FOR UPDATE`,
        [toAccount, requestItems]
      );
      if (owned.rowCount !== requestItems.length) throw new Error('receiver_item_missing');
    }
    if (allItems.length) {
      const listed = await client.query(
        `SELECT inventory_id FROM skin_market_listings WHERE inventory_id = ANY($1::bigint[]) AND status = 'active'`,
        [allItems]
      );
      if (listed.rowCount) throw new Error('trade_item_listed');
    }
    const inserted = await client.query(
      `INSERT INTO skin_trade_requests (from_account, to_account, offer_json, request_json)
         VALUES ($1, $2, $3::jsonb, $4::jsonb)
       RETURNING id, from_account, to_account, offer_json, request_json, status, created_at, updated_at`,
      [fromAccount, toAccount, JSON.stringify(offer || {}), JSON.stringify(request || {})]
    );
    await client.query('COMMIT');
    return inserted.rows[0] || null;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function respondTradeRequest({ accountId, tradeId, action }) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tradeResult = await client.query(`SELECT * FROM skin_trade_requests WHERE id = $1 FOR UPDATE`, [tradeId]);
    const trade = tradeResult.rows[0];
    if (!trade || trade.status !== 'pending') throw new Error('trade_not_found');
    const isSender = String(trade.from_account) === String(accountId);
    const isReceiver = String(trade.to_account) === String(accountId);
    if (!isSender && !isReceiver) throw new Error('not_trade_party');
    if (action === 'cancel' && isSender) {
      const cancelled = await client.query(`UPDATE skin_trade_requests SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *`, [tradeId]);
      await client.query('COMMIT');
      return cancelled.rows[0];
    }
    if (action === 'decline' && isReceiver) {
      const declined = await client.query(`UPDATE skin_trade_requests SET status = 'declined', updated_at = now() WHERE id = $1 RETURNING *`, [tradeId]);
      await client.query('COMMIT');
      return declined.rows[0];
    }
    if (action !== 'accept' || !isReceiver) throw new Error('invalid_trade_action');
    const offer = trade.offer_json || {};
    const request = trade.request_json || {};
    const offerItems = Array.isArray(offer.items) ? offer.items.map(Number).filter(Number.isSafeInteger) : [];
    const requestItems = Array.isArray(request.items) ? request.items.map(Number).filter(Number.isSafeInteger) : [];
    const offerCoins = Math.max(0, Math.floor(Number(offer.coins) || 0));
    const requestCoins = Math.max(0, Math.floor(Number(request.coins) || 0));
    const allItems = [...offerItems, ...requestItems];
    if (new Set(allItems).size !== allItems.length) throw new Error('duplicate_trade_item');
    if (allItems.length) {
      const listed = await client.query(`SELECT inventory_id FROM skin_market_listings WHERE inventory_id = ANY($1::bigint[]) AND status = 'active'`, [allItems]);
      if (listed.rows.length) throw new Error('trade_item_listed');
    }
    for (const id of offerItems) {
      const owned = await client.query(`SELECT id FROM skin_inventory WHERE id = $1 AND account_id = $2 FOR UPDATE`, [id, trade.from_account]);
      if (!owned.rows[0]) throw new Error('sender_item_missing');
    }
    for (const id of requestItems) {
      const owned = await client.query(`SELECT id FROM skin_inventory WHERE id = $1 AND account_id = $2 FOR UPDATE`, [id, trade.to_account]);
      if (!owned.rows[0]) throw new Error('receiver_item_missing');
    }
    if (offerCoins || requestCoins) {
      await client.query(`INSERT INTO stats (account_id, mowbucks) VALUES ($1, 0) ON CONFLICT (account_id) DO NOTHING`, [trade.from_account]);
      await client.query(`INSERT INTO stats (account_id, mowbucks) VALUES ($1, 0) ON CONFLICT (account_id) DO NOTHING`, [trade.to_account]);
      const stats = await client.query(`SELECT account_id, mowbucks FROM stats WHERE account_id = ANY($1::bigint[]) FOR UPDATE`, [[trade.from_account, trade.to_account]]);
      const balances = new Map(stats.rows.map(row => [String(row.account_id), Number(row.mowbucks || 0)]));
      if ((balances.get(String(trade.from_account)) || 0) < offerCoins) throw new Error('sender_coins_missing');
      if ((balances.get(String(trade.to_account)) || 0) < requestCoins) throw new Error('receiver_coins_missing');
      if (offerCoins) {
        await client.query(`UPDATE stats SET mowbucks = mowbucks - $2, updated_at = now() WHERE account_id = $1`, [trade.from_account, offerCoins]);
        await client.query(`UPDATE stats SET mowbucks = mowbucks + $2, updated_at = now() WHERE account_id = $1`, [trade.to_account, offerCoins]);
      }
      if (requestCoins) {
        await client.query(`UPDATE stats SET mowbucks = mowbucks - $2, updated_at = now() WHERE account_id = $1`, [trade.to_account, requestCoins]);
        await client.query(`UPDATE stats SET mowbucks = mowbucks + $2, updated_at = now() WHERE account_id = $1`, [trade.from_account, requestCoins]);
      }
    }
    if (offerItems.length) await client.query(`UPDATE skin_inventory SET account_id = $1 WHERE id = ANY($2::bigint[])`, [trade.to_account, offerItems]);
    if (requestItems.length) await client.query(`UPDATE skin_inventory SET account_id = $1 WHERE id = ANY($2::bigint[])`, [trade.from_account, requestItems]);
    if (allItems.length) await client.query(`DELETE FROM skin_loadouts WHERE inventory_id = ANY($1::bigint[])`, [allItems]);
    const accepted = await client.query(`UPDATE skin_trade_requests SET status = 'accepted', updated_at = now() WHERE id = $1 RETURNING *`, [tradeId]);
    await client.query('COMMIT');
    return accepted.rows[0];
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

function friendPair(accountId, otherId) {
  const a = BigInt(accountId);
  const b = BigInt(otherId);
  return a < b ? [String(a), String(b)] : [String(b), String(a)];
}

async function createFriendRequest(accountId, username) {
  const targetResult = await query(
    `SELECT id, username FROM accounts
      WHERE lower(username) = lower($1) AND status = 'active'
      LIMIT 1`,
    [username]
  );
  const target = targetResult.rows[0];
  if (!target) return { state: 'not_found' };
  if (String(target.id) === String(accountId)) return { state: 'self' };

  const [low, high] = friendPair(accountId, target.id);
  const inserted = await query(
    `INSERT INTO friendships (account_low, account_high, requested_by, status)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (account_low, account_high) DO NOTHING
     RETURNING status, requested_by`,
    [low, high, accountId]
  );
  if (inserted.rows.length) return { state: 'sent', target };

  const existing = await query(
    `SELECT status, requested_by FROM friendships
      WHERE account_low = $1 AND account_high = $2`,
    [low, high]
  );
  const row = existing.rows[0];
  if (row?.status === 'accepted') return { state: 'already_friends', target };
  return {
    state: String(row?.requested_by) === String(accountId) ? 'already_sent' : 'incoming_exists',
    target
  };
}

async function respondFriendRequest(accountId, otherId, accept) {
  const [low, high] = friendPair(accountId, otherId);
  if (accept) {
    const { rows } = await query(
      `UPDATE friendships
          SET status = 'accepted', updated_at = now()
        WHERE account_low = $1 AND account_high = $2
          AND status = 'pending' AND requested_by <> $3
      RETURNING account_low, account_high, requested_by, status`,
      [low, high, accountId]
    );
    return rows[0] || null;
  }
  const { rows } = await query(
    `DELETE FROM friendships
      WHERE account_low = $1 AND account_high = $2
        AND status = 'pending' AND requested_by <> $3
    RETURNING account_low, account_high, requested_by, status`,
    [low, high, accountId]
  );
  return rows[0] || null;
}

async function areFriends(accountId, otherId) {
  const [low, high] = friendPair(accountId, otherId);
  const { rows } = await query(
    `SELECT 1 FROM friendships
      WHERE account_low = $1 AND account_high = $2
        AND status = 'accepted'
      LIMIT 1`,
    [low, high]
  );
  return rows.length > 0;
}

async function removeFriend(accountId, otherId) {
  const [low, high] = friendPair(accountId, otherId);
  const { rows } = await query(
    `DELETE FROM friendships
      WHERE account_low = $1 AND account_high = $2
        AND (account_low = $3 OR account_high = $3)
    RETURNING account_low, account_high, requested_by, status`,
    [low, high, accountId]
  );
  return rows[0] || null;
}

async function getFriendships(accountId) {
  const { rows } = await query(
    `SELECT f.account_low, f.account_high, f.requested_by, f.status,
            f.created_at, f.updated_at,
            other.id AS other_id, other.username AS other_username,
            GREATEST(other.last_login, (
              SELECT max(s.last_seen) FROM sessions s WHERE s.account_id = other.id
            )) AS other_last_seen
       FROM friendships f
       JOIN accounts other ON other.id = CASE
         WHEN f.account_low = $1 THEN f.account_high ELSE f.account_low END
      WHERE f.account_low = $1 OR f.account_high = $1
      ORDER BY CASE WHEN f.status = 'pending' THEN 0 ELSE 1 END,
               lower(other.username) ASC`,
    [accountId]
  );
  return rows;
}

function crossServerTokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

async function createCrossServerHandoff({ accountId, destinationInstance, roomCode, ttlMinutes = 5 }) {
  const token = crypto.randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO cross_server_auth_handoffs
       (token_hash, account_id, destination_instance, room_code, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5::int * interval '1 minute'))`,
    [crossServerTokenHash(token), accountId, destinationInstance, roomCode, Math.max(1, Math.min(10, Number(ttlMinutes) || 5))]
  );
  return token;
}

async function consumeCrossServerHandoff({ token, destinationInstance }) {
  const { rows } = await query(
    `UPDATE cross_server_auth_handoffs
        SET consumed_at = now()
      WHERE token_hash = $1 AND destination_instance = $2
        AND consumed_at IS NULL AND expires_at > now()
      RETURNING account_id, room_code`,
    [crossServerTokenHash(token), destinationInstance]
  );
  return rows[0] || null;
}

async function claimActiveRoom({ roomCode, instanceId, leaseId, publicUrl, socketUrl = null, privateRoom, ttlSeconds = 30 }) {
  const { rows } = await query(
    `INSERT INTO active_game_rooms
       (room_code, instance_id, lease_id, public_url, socket_url, player_count, private, expires_at)
     VALUES ($1, $2, $3, $4, $5, 0, $6, now() + ($7::int * interval '1 second'))
     ON CONFLICT (room_code) DO UPDATE SET
       instance_id = EXCLUDED.instance_id,
       lease_id = EXCLUDED.lease_id,
       public_url = EXCLUDED.public_url,
       socket_url = EXCLUDED.socket_url,
       player_count = 0,
       private = EXCLUDED.private,
       updated_at = now(),
       expires_at = EXCLUDED.expires_at
     WHERE active_game_rooms.expires_at <= now()
     RETURNING room_code`,
    [roomCode, instanceId, leaseId, publicUrl, socketUrl, !!privateRoom, Math.max(10, Math.min(120, Number(ttlSeconds) || 30))]
  );
  return !!rows[0];
}

async function publishActiveRoom({ roomCode, instanceId, leaseId, publicUrl, playerCount, privateRoom, ttlSeconds = 30 }) {
  const { rows } = await query(
    `INSERT INTO active_game_rooms
       (room_code, instance_id, lease_id, public_url, player_count, private, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + ($7::int * interval '1 second'))
     ON CONFLICT (room_code) DO UPDATE SET
       instance_id = EXCLUDED.instance_id,
       lease_id = EXCLUDED.lease_id,
       public_url = EXCLUDED.public_url,
       player_count = EXCLUDED.player_count,
       private = EXCLUDED.private,
       updated_at = now(),
       expires_at = EXCLUDED.expires_at
     WHERE active_game_rooms.lease_id = EXCLUDED.lease_id OR active_game_rooms.expires_at <= now()
     RETURNING room_code`,
    [roomCode, instanceId, leaseId, publicUrl, Math.max(0, Number(playerCount) || 0), !!privateRoom, Math.max(10, Math.min(120, Number(ttlSeconds) || 30))]
  );
  return !!rows[0];
}

async function findActiveRoom(roomCode) {
  const { rows } = await query(
    `SELECT room_code, instance_id, public_url, socket_url, player_count, private
       FROM active_game_rooms
      WHERE room_code = $1 AND player_count > 0 AND expires_at > now()`,
    [roomCode]
  );
  return rows[0] || null;
}

async function removeActiveRoom(roomCode, instanceId, leaseId) {
  await query(
    `DELETE FROM active_game_rooms WHERE room_code = $1 AND instance_id = $2 AND lease_id = $3`,
    [roomCode, instanceId, leaseId]
  );
}

async function clearActiveRoomsForInstance(instanceId) {
  await query(`DELETE FROM active_game_rooms WHERE instance_id = $1`, [instanceId]);
}

async function recordRecentPlayerEncounters(accountId, otherAccountIds = []) {
  // Insert both directions in one statement: when A joins B's room, both A and B
  // should be able to find each other from the recent-player search.
  const unique = [...new Set(otherAccountIds
    .map(id => String(id || ''))
    .filter(id => /^\d+$/.test(id) && id !== String(accountId)))];
  if (!/^\d+$/.test(String(accountId || '')) || !unique.length) return 0;

  const values = [];
  const params = [];
  let paramIndex = 1;
  for (const otherId of unique) {
    values.push(`($${paramIndex++}, $${paramIndex++})`, `($${paramIndex++}, $${paramIndex++})`);
    params.push(accountId, otherId, otherId, accountId);
  }
  await query(
    `INSERT INTO recent_player_encounters (account_id, other_account_id, last_seen)
     VALUES ${values.join(', ')}
     ON CONFLICT (account_id, other_account_id) DO UPDATE
       SET last_seen = EXCLUDED.last_seen`,
    params
  );
  return unique.length;
}

async function getRecentPlayerEncounters(accountId, hours = 24, limit = 50) {
  // Search returns recent active accounts that are not already accepted friends.
  // Pending requests are still shown so the UI can retry/show normal request
  // handling instead of hiding useful discovery results.
  const safeHours = Math.max(1, Math.min(168, Number(hours) || 24));
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const { rows } = await query(
    `SELECT a.id AS account_id, a.username, r.last_seen
       FROM recent_player_encounters r
       JOIN accounts a ON a.id = r.other_account_id
      WHERE r.account_id = $1
        AND r.last_seen >= now() - ($2::int * INTERVAL '1 hour')
        AND a.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM friendships f
           WHERE f.status = 'accepted'
             AND f.account_low = LEAST(r.account_id, r.other_account_id)
             AND f.account_high = GREATEST(r.account_id, r.other_account_id)
        )
      ORDER BY r.last_seen DESC, lower(a.username) ASC
      LIMIT $3`,
    [accountId, safeHours, safeLimit]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

async function getNewsMessages(limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const { rows } = await query(
    `SELECT id, title, body, author_id, author_name, created_at
       FROM news_messages
      ORDER BY created_at DESC, id DESC
      LIMIT $1`,
    [safeLimit]
  );
  return rows;
}

async function createNewsMessage({ title, body, authorId, authorName }) {
  const { rows } = await query(
    `INSERT INTO news_messages (title, body, author_id, author_name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, body, author_id, author_name, created_at`,
    [title, body, authorId || null, authorName || 'Admin']
  );
  return rows[0];
}

async function deleteNewsMessage(id) {
  const { rows } = await query(
    `DELETE FROM news_messages
      WHERE id = $1
      RETURNING id`,
    [id]
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Chat logs
// ---------------------------------------------------------------------------

// rows: array of { account_id, name, room_code, message, ip, ts }
async function insertChatLogs(batch) {
  if (!batch.length) return;
  const cols = 6;
  const values = [];
  const params = [];
  batch.forEach((r, i) => {
    const b = i * cols;
    values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`);
    params.push(r.account_id, r.name, r.room_code, r.message, r.ip, r.ts);
  });
  await query(
    `INSERT INTO chat_logs (account_id, name, room_code, message, ip, ts) VALUES ${values.join(',')}`,
    params
  );
}

async function searchChatLogs({ room, accountId, name, q, from, to, limit = 200, offset = 0 } = {}) {
  const lim = Math.min(1000, Math.max(1, Number(limit) || 200));
  const off = Math.max(0, Number(offset) || 0);
  const { rows } = await query(
    `SELECT id, account_id, name, room_code, message, ip, ts FROM chat_logs
      WHERE ($1::text IS NULL OR room_code = $1)
        AND ($2::bigint IS NULL OR account_id = $2)
        AND ($3::text IS NULL OR name ILIKE '%'||$3||'%')
        AND ($4::text IS NULL OR message ILIKE '%'||$4||'%')
        AND ($5::timestamptz IS NULL OR ts >= $5)
        AND ($6::timestamptz IS NULL OR ts <= $6)
      ORDER BY ts DESC LIMIT $7 OFFSET $8`,
    [
      room || null,
      accountId || null,
      name || null,
      q || null,
      from || null,
      to || null,
      lim,
      off
    ]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// IP events (rate-limit / flag only — never used to ban)
// ---------------------------------------------------------------------------

async function logIpEvent({ ip, subnet, event, accountId }) {
  await query(`INSERT INTO ip_events (ip, subnet, event, account_id) VALUES ($1, $2, $3, $4)`, [
    ip || null,
    subnet || null,
    event,
    accountId || null
  ]);
}

async function sweepRetention(chatDays = 90) {
  await query(`DELETE FROM ip_events WHERE ts < now() - interval '30 days'`);
  await query(`DELETE FROM account_email_codes WHERE consumed_at IS NOT NULL OR expires_at < now() - interval '7 days'`);
  await query(`DELETE FROM sessions WHERE last_seen < now() - interval '30 days'`);
  await query(`DELETE FROM chat_logs WHERE ts < now() - ($1 || ' days')::interval`, [String(chatDays)]);
  await query(`DELETE FROM violations WHERE ts < now() - interval '60 days'`);
  await query(`DELETE FROM cross_server_auth_handoffs WHERE consumed_at IS NOT NULL OR expires_at < now()`);
  await query(`DELETE FROM active_game_rooms WHERE expires_at < now()`);
}

module.exports = {
  isEnabled,
  isTransientDatabaseError,
  isRetryableRead,
  initDb,
  query,
  // accounts
  createAccount,
  getAccountByEmail,
  getAccountById,
  getAccountForRecovery,
  getRecoveryCodeCiphertext,
  setRecoveryCodeCiphertext,
  emailExists,
  usernameExists,
  setLastLogin,
  setAccountStatus,
  updateUsername,
  updatePassword,
  updatePasswordAndRecoveryCode,
  updateEmail,
  updateEmailAndRecoveryCode,
  markHealthshotUsed,
  getTradeUpTutorialSeen,
  markTradeUpTutorialSeen,
  createEmailCode,
  getLatestEmailCode,
  incrementEmailCodeAttempts,
  consumeEmailCode,
  incStrikes,
  // sessions
  createSession,
  getSession,
  deleteSession,
  deleteSessionByAccount,
  touchSession,
  // devices
  upsertDevice,
  getDevice,
  getAccountsForDeviceOrFingerprint,
  findAltClusters,
  // bans
  createBan,
  liftBan,
  getActiveBans,
  getActiveAccountBansWithNames,
  listAccounts,
  getBansForAccount,
  logViolation,
  getViolationsForAccount,
  getViolationCounts,
  listRecentViolations,
  // stats
  flushStat,
  getStats,
  addXp,
  addMowbucks,
  resetXp,
  resetAllXp,
  recordWeaponKill,
  getGlobalWeaponKills,
  getDailyWeaponKills,
  getDailyChallengeTemplates,
  upsertDailyChallengeTemplate,
  deleteDailyChallengeTemplate,
  getWeeklyChallengeRotation,
  saveWeeklyChallengeRotation,
  incrementDailyChallengeCounters,
  getDailyChallengeCounters,
  claimDailyChallenge,
  getDailyChallengeClaims,
  recordDailyStats,
  getDailyStats,
  getDailyStatsForPlayer,
  getDailyStatsRange,
  getAllTimeLeaderboardStats,
  resetLeaderboardStats,
  // skins
  ensureStarterSkinInventory,
  getSkinInventory,
  getSkinInventoryItem,
  getTradeUpState,
  completeTradeUp,
  getSkinLoadouts,
  setSkinLoadout,
  clearSkinLoadout,
  clearPlayerInventory,
  listAccountRoles,
  setAccountRole,
  adminInventorySnapshot,
  adminSetSkinWear,
  adminRemoveSkinInstance,
  adminRemoveCases,
  grantCases,
  buyCase,
  getCaseInventory,
  getCustomCases,
  upsertCustomCase,
  deleteCustomCase,
  awardCaseRoll,
  getCollectionUnlocks,
  createMarketListing,
  listMarketListings,
  getFeaturedMarketListing,
  getMarketOverview,
  getSoldMarketCatalog,
  getMarketItemHistory,
  cancelMarketListing,
  setMarketListingPrice,
  buyMarketListing,
  placeMarketAuctionBid,
  settleMarketAuctionListing,
  settleExpiredMarketAuctions,
  createCaseMarketListing,
  listCaseMarketListings,
  cancelCaseMarketListing,
  buyCaseMarketListing,
  createTradeRequest,
  respondTradeRequest,
  // friends
  createFriendRequest,
  respondFriendRequest,
  areFriends,
  removeFriend,
  getFriendships,
  recordRecentPlayerEncounters,
  getRecentPlayerEncounters,
  listAccountBalances,
  setMowbucks,
  findAccountByUsername,
  grantSkinToAccount,
  getAccountSettings,
  saveAccountSettings,
  createCrossServerHandoff,
  consumeCrossServerHandoff,
  claimActiveRoom,
  publishActiveRoom,
  findActiveRoom,
  removeActiveRoom,
  clearActiveRoomsForInstance,
  // news
  getNewsMessages,
  createNewsMessage,
  deleteNewsMessage,
  // chat
  insertChatLogs,
  searchChatLogs,
  // ip
  logIpEvent,
  sweepRetention
};
