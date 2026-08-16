ALTER TABLE match_players
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS slot_index smallint;

WITH numbered AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY match_id
      ORDER BY account_id NULLS LAST, display_name_snapshot, ctid
    ) - 1 AS slot_index
  FROM match_players
)
UPDATE match_players AS player
SET slot_index = numbered.slot_index
FROM numbered
WHERE player.ctid = numbered.ctid
  AND player.slot_index IS NULL;

ALTER TABLE match_players
  ALTER COLUMN id SET NOT NULL;

-- Keep slot_index nullable for one expand/contract release. The previous
-- application version does not include this column in its INSERT, so making it
-- NOT NULL here would break match completion while old and new Render instances
-- overlap during a rolling deploy. New writers always populate it, and the
-- unique constraint still protects every non-null slot.

ALTER TABLE match_players
  DROP CONSTRAINT IF EXISTS match_players_pkey;

ALTER TABLE match_players
  ADD CONSTRAINT match_players_pkey PRIMARY KEY (id);

ALTER TABLE match_players
  ADD CONSTRAINT match_players_slot_index_check CHECK (slot_index BETWEEN 0 AND 15),
  ADD CONSTRAINT match_players_match_slot_key UNIQUE (match_id, slot_index);

CREATE UNIQUE INDEX match_players_match_account_key
  ON match_players (match_id, account_id)
  WHERE account_id IS NOT NULL;

ALTER TABLE matches
  ALTER COLUMN map_id SET DEFAULT 'the-skeld';
