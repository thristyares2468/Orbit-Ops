-- What each case can actually drop, so prices can follow the odds rather than
-- the names. Run in the Neon SQL Editor with the Subdivision database selected.
-- Read-only: nothing here writes.
--
-- Run QUERY 1 and send me the output. If it errors, run QUERY 0 instead and
-- send me that plus the error text - query 0 uses nothing but a select, so it
-- works on any Postgres and tells me what shape the data is really in.

-- ---------------------------------------------------------------------------
-- QUERY 0 - the fallback. Dumps the raw rows. Always works.
-- ---------------------------------------------------------------------------
SELECT id, display_name, price, rarity_mode, rarity_weights_json, items_json
  FROM custom_cases
 ORDER BY display_name;

-- ---------------------------------------------------------------------------
-- QUERY 1 - one row per case, with the rarity breakdown. Preferred.
-- ---------------------------------------------------------------------------
-- Grouping by the primary key only: Postgres lets the other columns of that
-- table come along, which avoids grouping by a jsonb column.
--
-- rarity_mode 'class' means the case rolls a rarity first using class_odds and
-- then picks evenly within it, so class_odds is the real chance of a good drop.
-- 'skin' means each skin's own weight competes directly, so the weight totals
-- matter instead. Both are returned.
SELECT
  c.id,
  c.display_name,
  c.price AS current_price,
  c.rarity_mode,
  count(e.value)                                                          AS drops,
  count(*) FILTER (WHERE lower(e.value ->> 'rarity') = 'common')           AS common,
  count(*) FILTER (WHERE lower(e.value ->> 'rarity') = 'rare')             AS rare,
  count(*) FILTER (WHERE lower(e.value ->> 'rarity') = 'epic')             AS epic,
  count(*) FILTER (WHERE lower(e.value ->> 'rarity') = 'legendary')        AS legendary,
  count(*) FILTER (WHERE lower(e.value ->> 'rarity') = 'mythic')           AS mythic_knives,
  sum((e.value ->> 'weight')::numeric) FILTER (WHERE lower(e.value ->> 'rarity') = 'legendary') AS legendary_weight,
  sum((e.value ->> 'weight')::numeric) FILTER (WHERE lower(e.value ->> 'rarity') = 'mythic')    AS mythic_weight,
  sum((e.value ->> 'weight')::numeric)                                    AS total_weight,
  c.rarity_weights_json AS class_odds
FROM custom_cases c
LEFT JOIN LATERAL jsonb_array_elements(c.items_json) AS e(value) ON true
GROUP BY c.id
ORDER BY c.display_name;

-- ---------------------------------------------------------------------------
-- QUERY 2 - every skin with its rarity and case. Only if a case looks wrong.
-- Skin names are not stored - the catalogue lives in the game's code, so an
-- item id is enough for me to look the rest up.
-- ---------------------------------------------------------------------------
-- SELECT c.display_name AS case_name,
--        e.value ->> 'itemId'  AS item_id,
--        e.value ->> 'rarity'  AS rarity,
--        e.value ->> 'weight'  AS weight
--   FROM custom_cases c
--   CROSS JOIN LATERAL jsonb_array_elements(c.items_json) AS e(value)
--  ORDER BY c.display_name, rarity, item_id;

-- ---------------------------------------------------------------------------
-- If QUERY 1 returns drops correctly but every rarity column reads 0, the
-- stored entries use a different key than 'rarity'. QUERY 0's items_json will
-- show which, and I will adjust.
-- ---------------------------------------------------------------------------
