-- Account recovery, moderation history, friendships and announcements.
--
-- The recovery code is stored as reversible ciphertext rather than a hash: a
-- player who has lost their password must be able to read the code back while
-- signed in, and an owner must be able to read it out to help them. That is a
-- deliberate trade - see server/recoveryCodes.js for the key handling.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS recovery_code_ciphertext text,
  ADD COLUMN IF NOT EXISTS recovery_code_updated_at timestamptz;

-- Friendship is one row per pair, not two. Ordering the columns by uuid means a
-- pair can only ever be stored one way round, so the unique index really does
-- prevent duplicate and reciprocal-duplicate requests.
CREATE TABLE IF NOT EXISTS friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lower_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  higher_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT friendships_distinct_accounts CHECK (lower_account_id <> higher_account_id),
  CONSTRAINT friendships_ordered CHECK (lower_account_id < higher_account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_uidx
  ON friendships (lower_account_id, higher_account_id);
CREATE INDEX IF NOT EXISTS friendships_higher_idx ON friendships (higher_account_id);
CREATE INDEX IF NOT EXISTS friendships_status_idx ON friendships (status);

CREATE TABLE IF NOT EXISTS news_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(120) NOT NULL,
  body text NOT NULL,
  posted_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS news_posts_created_idx ON news_posts (created_at DESC) WHERE published = true;

-- Leaderboards read player_stats ordered by score. Without this the query is a
-- sequential scan plus a sort on every request.
CREATE INDEX IF NOT EXISTS player_stats_score_idx ON player_stats (score DESC, games_played DESC);

-- Moderation lookups are always "is this account restricted right now", so the
-- partial indexes carry the active predicate rather than filtering after the fact.
CREATE INDEX IF NOT EXISTS bans_active_expiry_idx
  ON bans (account_id, expires_at) WHERE active = true;
CREATE INDEX IF NOT EXISTS mutes_active_expiry_idx
  ON mutes (account_id, expires_at) WHERE active = true;
