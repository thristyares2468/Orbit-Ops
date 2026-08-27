// Last updated: 16 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const db = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

assert.match(db, /ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS buyer_id BIGINT REFERENCES accounts\(id\) ON DELETE SET NULL/, 'existing databases should add nullable market buyer attribution');
assert.ok(db.indexOf('ADD COLUMN IF NOT EXISTS buyer_id') < db.indexOf('CREATE INDEX IF NOT EXISTS idx_skin_market_buyer'), 'the buyer column migration must run before its index on Railway');

const activeListingStart = db.lastIndexOf('async function listMarketListings');
const activeListingFunction = db.slice(activeListingStart, db.indexOf('async function legacyCancelMarketListing', activeListingStart));
for (const field of ['pattern_seed', 'rarity_tier', 'wear_value', 'wear_seed', 'seller_name']) {
  assert.ok(activeListingFunction.includes(field), `active listings should return ${field}`);
}
assert.match(activeListingFunction, /JOIN skin_inventory inventory ON inventory\.id = l\.inventory_id AND inventory\.account_id = l\.seller_id/, 'active listings should render appearance from the still-owned inventory instance');
assert.match(db, /UPDATE skin_market_listings listing[\s\S]*?wear_value = inventory\.wear_value[\s\S]*?listing\.status = 'active'/, 'startup should repair stale active listing wear snapshots');

const buyFunction = db.slice(db.lastIndexOf('async function buyMarketListing'), db.lastIndexOf('async function createTradeRequest'));
assert.match(buyFunction, /SELECT id, item_id, pattern_seed, rarity_tier, wear_value, wear_seed[\s\S]*?FROM skin_inventory[\s\S]*?FOR UPDATE/, 'a purchase should lock and read the exact inventory appearance');
assert.match(buyFunction, /SET status = 'sold', buyer_id = \$2,[\s\S]*?wear_value = \$6, wear_seed = \$7/, 'a completed purchase should persist its buyer and exact sold wear atomically');
assert.match(buyFunction, /seller\.username AS seller_name, buyer\.username AS buyer_name/, 'purchase responses should identify both sides of the sale');

const itemHistoryFunction = db.slice(db.indexOf('async function getMarketItemHistory'), db.indexOf('async function cancelMarketListing'));
for (const field of ['l.inventory_id', 'l.seller_id', 'l.buyer_id', 'seller.username AS seller_name', 'buyer.username AS buyer_name']) {
  assert.ok(itemHistoryFunction.includes(field), `skin history should expose ${field}`);
}
assert.match(db, /COUNT\(\*\)::bigint FROM trade_up_transactions\) AS trade_ups_completed/, 'market statistics should count completed Trade Ups');
assert.match(server, /tradeUpsCompleted: 0/, 'the database-disabled market response should preserve the Trade Up statistic shape');

for (const marker of ['id="market-stat-trade-ups"', 'data-market-inspect=', 'data-market-history-inspect=', 'data-market-lineage=']) {
  assert.ok(html.includes(marker), `market UI should include ${marker}`);
}
assert.match(html, /function renderMarketListings[\s\S]*?Seller: \$\{escapeHtml\(row\.seller_name/, 'active cards should name their seller');
assert.match(html, /function renderMarketHistory[\s\S]*?seller_name[\s\S]*?buyer_name[\s\S]*?toFixed\(6\)/, 'sale rows should show both owners and the exact wear float');
assert.match(html, /function openMarketSkinInspect[\s\S]*?updateInventoryPreview\(null, item, false\)/, 'market inspection should reuse the full 3D inventory viewer without allowing equip');
assert.match(html, /function wearRatingMeta[\s\S]*?toFixed\(6\)/, '3D inspection should display a six-decimal wear float');
assert.match(html, /localMarketTest[\s\S]*?setTimeout\(showMarketplace, 180\)/, 'localhost should expose a rendered marketplace fixture for visual QA');
assert.match(html, /\.market-history-layout \{[^}]*height:clamp\([^}]*overflow:hidden/, 'price history should constrain its desktop columns to independent scroll regions');
assert.match(html, /\.market-history-list \{[^}]*flex:1 1 0[^}]*overflow-y:auto[^}]*overscroll-behavior:contain/, 'the sold-skin catalog should scroll without moving the graph');
assert.match(html, /\.market-history-detail \{[^}]*overflow-y:auto[^}]*overscroll-behavior:contain/, 'the graph and transaction detail should have their own scroll region');

console.log('marketplace-audit-history: exact listing instances, buyer attribution, independent history scrolling, inspection, and Trade Up stats verified.');
