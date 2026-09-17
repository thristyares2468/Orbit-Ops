-- Export the rarity assignments from the cases that are already correct, so the
-- rest of the catalogue can be calibrated against them.
--
-- WHERE TO RUN IT
--   Neon SQL Editor, Subdivision database selected. Read-only: nothing writes.
--
-- WHY IT IS NEEDED
--   Case contents (items_json) live only in Postgres. skins.js ships
--   `const CASES = Object.freeze([])` and merges the real ones at
--   publicCatalog() time, so the correct rarities are not readable from the
--   repo. This is the one thing that cannot be worked out from the code.
--
--   Run QUERY A and send the output. That is enough on its own.

-- ---------------------------------------------------------------------------
-- QUERY A - every drop in the six known-good cases, with its rarity.
-- ---------------------------------------------------------------------------
-- Skin names are not stored; the catalogue lives in the game's code, so the
-- item id is enough to look the rest up.
SELECT c.id                     AS case_id,
       e.value ->> 'itemId'     AS item_id,
       e.value ->> 'rarity'     AS rarity,
       e.value ->> 'weight'     AS weight
  FROM custom_cases c
  CROSS JOIN LATERAL jsonb_array_elements(c.items_json) AS e(value)
 WHERE c.id IN ('wearhouse', 'tradie', 'mulch', 'lawn_care', 'gardener', 'diamond_strong')
 ORDER BY c.id, rarity, item_id;

-- ---------------------------------------------------------------------------
-- QUERY B - the shape of each case, if QUERY A is too long to paste.
-- ---------------------------------------------------------------------------
-- Less useful: it gives the distribution but not which skin got which tier,
-- and the second is what the rest of the catalogue has to be matched to.
SELECT c.id,
       c.rarity_mode,
       count(e.value)                                                AS drops,
       count(*) FILTER (WHERE lower(e.value ->> 'rarity') = 'common')    AS common,
       count(*) FILTER (WHERE lower(e.value ->> 'rarity') = 'rare')      AS rare,
       count(*) FILTER (WHERE lower(e.value ->> 'rarity') = 'epic')      AS epic,
       count(*) FILTER (WHERE lower(e.value ->> 'rarity') = 'legendary') AS legendary,
       count(*) FILTER (WHERE lower(e.value ->> 'rarity') = 'mythic')    AS mythic,
       c.rarity_weights_json                                         AS class_odds
  FROM custom_cases c
  LEFT JOIN LATERAL jsonb_array_elements(c.items_json) AS e(value) ON true
 WHERE c.id IN ('wearhouse', 'tradie', 'mulch', 'lawn_care', 'gardener', 'diamond_strong')
 GROUP BY c.id
 ORDER BY c.id;

-- ---------------------------------------------------------------------------
-- If QUERY A returns nothing, the case ids differ from the ones above. This
-- lists what is actually there:
--   SELECT id, display_name, jsonb_array_length(items_json) AS drops
--     FROM custom_cases ORDER BY display_name;
-- Note the existing spelling of the Warehouse case id is 'wearhouse'.
-- ---------------------------------------------------------------------------
