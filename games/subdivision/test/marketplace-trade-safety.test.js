// Last updated: 15 July 2026
const fs = require('fs');
const assert = require('assert');

// Static safety net for the skin economy. It checks that the dangerous paths are
// transaction-backed and still reject duplicate/listed/missing assets.
const db = fs.readFileSync('db.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');

assert.ok(
  /CREATE UNIQUE INDEX IF NOT EXISTS uq_skin_market_one_active_listing[\s\S]*?WHERE status = 'active'/.test(db),
  'marketplace should prevent duplicate active listings for the same inventory item'
);

assert.ok(
  /async function getFeaturedMarketListing\(\)[\s\S]*?sold\.item_id = l\.item_id[\s\S]*?sold\.status = 'sold'[\s\S]*?history\.prior_high_price > l\.price[\s\S]*?ORDER BY price_difference DESC, discount_percent DESC/.test(db),
  'showcased listing should compare active prices with completed sales for the same item and choose the largest absolute saving'
);

assert.ok(
  /Promise\.all\(\[[\s\S]*?db\.listMarketListings\(data \|\| \{\}\)[\s\S]*?db\.getFeaturedMarketListing\(\)[\s\S]*?featuredListing/.test(server),
  'market data should include the authoritative showcased listing'
);

assert.ok(
  /async function buyMarketListing[\s\S]*?BEGIN[\s\S]*?SELECT \* FROM skin_market_listings WHERE id = \$1 AND status = 'active' FOR UPDATE[\s\S]*?own_listing[\s\S]*?SELECT mowbucks FROM stats WHERE account_id = \$1 FOR UPDATE[\s\S]*?SELECT id FROM skin_inventory WHERE id = \$1 AND account_id = \$2 FOR UPDATE[\s\S]*?UPDATE skin_inventory SET account_id = \$1 WHERE id = \$2[\s\S]*?DELETE FROM skin_loadouts WHERE inventory_id = \$1[\s\S]*?UPDATE skin_market_listings SET status = 'sold'[\s\S]*?COMMIT[\s\S]*?ROLLBACK/.test(db),
  'marketplace buys should be atomic, lock the active listing, validate ownership/balance, transfer ownership, clear loadout state, and mark sold'
);

assert.ok(
  /async function respondTradeRequest[\s\S]*?SELECT \* FROM skin_trade_requests WHERE id = \$1 FOR UPDATE[\s\S]*?action !== 'accept' \|\| !isReceiver[\s\S]*?duplicate_trade_item[\s\S]*?skin_market_listings WHERE inventory_id = ANY\(\$1::bigint\[\]\) AND status = 'active'[\s\S]*?SELECT id FROM skin_inventory WHERE id = \$1 AND account_id = \$2 FOR UPDATE[\s\S]*?SELECT account_id, mowbucks FROM stats WHERE account_id = ANY\(\$1::bigint\[\]\) FOR UPDATE[\s\S]*?UPDATE skin_inventory SET account_id = \$1 WHERE id = ANY\(\$2::bigint\[\]\)[\s\S]*?DELETE FROM skin_loadouts WHERE inventory_id = ANY\(\$1::bigint\[\]\)[\s\S]*?status = 'accepted'[\s\S]*?COMMIT[\s\S]*?ROLLBACK/.test(db),
  'trade acceptance should be receiver-confirmed, atomic, reject listed/duplicate/missing items, verify coin balances, transfer items/coins, and clear moved loadouts'
);

assert.ok(
  /if \(type === 'marketBuyListing'\) \{[\s\S]*?handleMarketBuyListing\(client, data\);[\s\S]*?if \(type === 'marketCancelListing'\) \{[\s\S]*?handleMarketCancelListing\(client, data\);[\s\S]*?if \(type === 'tradeRespond'\) \{[\s\S]*?handleTradeRespond\(client, data\);/.test(server),
  'server should expose buy, cancel, and trade response packets'
);

assert.ok(
  /CREATE TABLE IF NOT EXISTS case_market_listings[\s\S]*?async function createCaseMarketListing[\s\S]*?SELECT quantity FROM case_inventory[\s\S]*?FOR UPDATE[\s\S]*?quantity = quantity - 1[\s\S]*?INSERT INTO case_market_listings[\s\S]*?COMMIT/.test(db),
  'listing an unavailable case should atomically reserve one owned case'
);

assert.ok(
  /async function buyCaseMarketListing[\s\S]*?status = 'active' FOR UPDATE[\s\S]*?own_listing[\s\S]*?not_enough_coins[\s\S]*?INSERT INTO case_inventory[\s\S]*?status = 'sold'[\s\S]*?COMMIT/.test(db),
  'case resale purchases should atomically transfer currency and case ownership'
);

assert.ok(
  /async function handleMarketCreateCaseListing[\s\S]*?caseDef\.marketVisible !== false[\s\S]*?createCaseMarketListing/.test(server),
  'only cases hidden from direct sale should be eligible for player resale'
);

assert.ok(
  /case_id\s+TEXT NOT NULL REFERENCES custom_cases\(id\) ON DELETE RESTRICT[\s\S]*?async function deleteCustomCase[\s\S]*?active_case_listing/.test(db)
    && /handleDeleteCaseDefinition[\s\S]*?Remove active player listings before deleting this case/.test(server),
  'admins should not be able to orphan active player case listings by deleting their case definition'
);

assert.ok(
  /const TRADE_MIN_LEVEL = 5;[\s\S]*?async function accountLevelForTrade\(accountId\)[\s\S]*?progressionForXpLocal\(stats\?\.xp \|\| 0\)\.level/.test(server),
  'server should compute trade eligibility from the authoritative saved XP level'
);

assert.ok(
  /async function handleTradeRequestCreate[\s\S]*?accountLevelForTrade\(client\.accountId\)[\s\S]*?Reach level \$\{TRADE_MIN_LEVEL\} before sending trades/.test(server),
  'server should require level 5 before sending trades'
);

assert.ok(
  /async function handleTradeRespond[\s\S]*?if \(action === 'accept'\)[\s\S]*?accountLevelForTrade\(client\.accountId\)[\s\S]*?Reach level \$\{TRADE_MIN_LEVEL\} before accepting trades/.test(server),
  'server should require level 5 before accepting trades'
);

console.log('marketplace-trade-safety: marketplace and trade transaction guards verified.');
