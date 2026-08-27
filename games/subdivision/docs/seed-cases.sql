-- Prices for the seven cases that exist.
--
-- WHERE TO RUN IT
--   Neon SQL Editor, with the Subdivision database selected. Safe to re-run:
--   it only sets prices and availability, and never touches items_json, so the
--   contents you have already built stay exactly as they are.
--
-- HOW THESE WERE CHOSEN
--   Everything currently sits at 150, so nothing signals which case is worth
--   opening. These spread it across 100 to 250 - the floor and ceiling asked
--   for - in even steps of 25, so the order is obvious without any case being
--   priced out of reach.
--
--   Judged on theme and pool size, which is all I can see from outside the
--   database - the two biggest pools are the everyday collections and sit at
--   the bottom, the branded and map cases sit at the top. If you want this done
--   on the actual odds instead, run the query at the end of this file and send
--   me the output; a case that can drop a knife is worth several times one that
--   cannot, and that is not visible from a name.
--
--   These are opening prices, not a balanced economy. Move them once you see
--   what players actually buy - that is why they live in a table.

UPDATE custom_cases SET price = CASE id
    -- 29 drops, everyday theme: the two most likely to be a player's first.
    WHEN 'gardener'       THEN 100
    WHEN 'lawn_care'      THEN 125
    -- 24 drops, working-yard theme.
    WHEN 'mulch'          THEN 150
    WHEN 'tradie'         THEN 175
    WHEN 'wearhouse'      THEN 200
    -- Map-themed and branded: the two that should feel like a decision.
    WHEN 'nuke'           THEN 225
    WHEN 'diamond_strong' THEN 250
    ELSE price
  END,
  updated_at = now()
WHERE id IN ('gardener', 'lawn_care', 'mulch', 'tradie', 'wearhouse', 'nuke', 'diamond_strong');

-- Every case on sale, with no window or discount left over from earlier edits.
UPDATE custom_cases
   SET visible_in_market = true,
       available_from = NULL,
       available_until = NULL,
       discount_mode = 'none',
       discount_price = NULL,
       discount_starts_at = NULL,
       discount_ends_at = NULL,
       updated_at = now()
 WHERE visible_in_market = false
    OR available_until IS NOT NULL
    OR discount_mode <> 'none';

-- Nothing outside the range, including any case added later.
UPDATE custom_cases SET price = 100, updated_at = now() WHERE price < 100;
UPDATE custom_cases SET price = 250, updated_at = now() WHERE price > 250;

-- What you now have, cheapest first.
SELECT id, display_name, price, visible_in_market AS on_sale,
       jsonb_array_length(items_json) AS drops
  FROM custom_cases
 ORDER BY price ASC, display_name ASC;

-- ---------------------------------------------------------------------------
-- To price on the real odds instead of on theme, run this and send me the
-- output. Knife chance is the single biggest driver of what a case is worth,
-- and it is the one thing a name cannot tell you.
--
-- SELECT id, display_name, price,
--        jsonb_array_length(items_json) AS drops,
--        rarity_mode,
--        rarity_weights_json
--   FROM custom_cases
--  ORDER BY display_name;
