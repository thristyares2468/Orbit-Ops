// Last updated: 15 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const skins = require('../skins');
const tradeups = require('../tradeups');

const ROOT = path.resolve(__dirname, '..');
const db = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

assert.deepStrictEqual(tradeups.RARITY_ORDER, ['common', 'rare', 'epic', 'legendary', 'mythic']);
assert.strictEqual(tradeups.requiredInputCount('common'), 10);
assert.strictEqual(tradeups.requiredInputCount('rare'), 10);
assert.strictEqual(tradeups.requiredInputCount('epic'), 10);
assert.strictEqual(tradeups.requiredInputCount('legendary'), 5);
assert.strictEqual(tradeups.requiredInputCount('mythic'), 0);
assert.strictEqual(tradeups.nextRarity('legendary'), 'mythic');
assert.strictEqual(tradeups.nextRarity('mythic'), null);

const definitions = new Map([
  ['a_common', { id: 'a_common', weapon: 'AK47', displayName: 'A Common', minimumFloat: 0.1, maximumFloat: 0.7, tradeUpEligible: true }],
  ['b_common', { id: 'b_common', weapon: 'P90', displayName: 'B Common', minimumFloat: 0, maximumFloat: 0.5, tradeUpEligible: true }],
  ['a_rare_1', { id: 'a_rare_1', weapon: 'AWP', displayName: 'A Rare 1', minimumFloat: 0, maximumFloat: 1, tradeUpEligible: true }],
  ['a_rare_2', { id: 'a_rare_2', weapon: 'Deagle', displayName: 'A Rare 2', minimumFloat: 0.2, maximumFloat: 0.6, tradeUpEligible: true }],
  ['b_rare', { id: 'b_rare', weapon: 'FAMAS', displayName: 'B Rare', minimumFloat: 0.06, maximumFloat: 0.8, tradeUpEligible: true }],
  ['legendary', { id: 'legendary', weapon: 'AK47', displayName: 'Legendary', minimumFloat: 0, maximumFloat: 1, tradeUpEligible: true }],
  ['knife', { id: 'knife', weapon: 'Knife', displayName: 'Knife', minimumFloat: 0, maximumFloat: 1, tradeUpEligible: true }]
]);
const getDefinition = id => definitions.get(id) || null;
const collectionsById = new Map([
  ['collection_a', { id: 'collection_a', items: [{ itemId: 'a_rare_1', rarity: 'rare' }, { itemId: 'a_rare_2', rarity: 'rare' }] }],
  ['collection_b', { id: 'collection_b', items: [{ itemId: 'b_rare', rarity: 'rare' }] }]
]);
const inputs = [
  ...Array.from({ length: 7 }, (_, index) => ({ id: index + 1, item_id: 'a_common', rarity_tier: 'common', collection_id: 'collection_a', wear_value: 0.22 })),
  ...Array.from({ length: 3 }, (_, index) => ({ id: index + 8, item_id: 'b_common', rarity_tier: 'common', collection_id: 'collection_b', wear_value: 0.1 }))
];
const rolls = [7, 0, 713, 122];
const outcome = tradeups.buildTradeUpOutcome({
  inputs,
  collectionsById,
  getDefinition,
  randomInt: max => rolls.shift() % max
});
assert.strictEqual(outcome.selectedCollectionId, 'collection_b', 'selecting one of the three B slots should choose Collection B');
assert.strictEqual(outcome.outputDefinition.id, 'b_rare', 'the selected collection should exclusively determine the output pool');
assert.ok(Math.abs(outcome.averageNormalizedFloat - 0.2) < 1e-12, 'input floats should be normalized against their own ranges before averaging');
assert.ok(Math.abs(outcome.outputFloat - 0.208) < 1e-12, 'normalized average should map into the selected output range');
assert.strictEqual(outcome.outputWearCondition, 'Field Tested');
assert.strictEqual(outcome.outputPatternSeed, 714);
assert.strictEqual(outcome.outputWearSeed, 123);

assert.strictEqual(tradeups.wearConditionForFloat(0.069999), 'Factory New');
assert.strictEqual(tradeups.wearConditionForFloat(0.07), 'Minimal Wear');
assert.strictEqual(tradeups.wearConditionForFloat(0.15), 'Field Tested');
assert.strictEqual(tradeups.wearConditionForFloat(0.38), 'Well Worn');
assert.strictEqual(tradeups.wearConditionForFloat(0.45), 'Battle Scarred');

const knifeCollection = { id: 'knife_collection', items: [{ itemId: 'knife', rarity: 'mythic' }] };
const legendaryInputs = Array.from({ length: 5 }, (_, index) => ({ id: index + 20, item_id: 'legendary', rarity_tier: 'legendary', collection_id: 'knife_collection', wear_value: 0.3 }));
const knifeOutcome = tradeups.buildTradeUpOutcome({
  inputs: legendaryInputs,
  collectionsById: new Map([['knife_collection', knifeCollection]]),
  getDefinition,
  randomInt: () => 0
});
assert.strictEqual(knifeOutcome.outputRarity, 'mythic');
assert.strictEqual(knifeOutcome.outputDefinition.weapon, 'Knife');
assert.throws(() => tradeups.buildTradeUpOutcome({
  inputs: [{ ...legendaryInputs[0], rarity_tier: 'mythic' }],
  collectionsById: new Map([['knife_collection', knifeCollection]]),
  getDefinition,
  randomInt: () => 0
}), /trade_up_wrong_count/, 'Mythic items must never be accepted as inputs');

assert.ok(skins.ITEMS.every(item => Number.isFinite(item.minimumFloat) && Number.isFinite(item.maximumFloat)), 'every skin definition should expose a float range');
assert.ok(skins.ITEMS.every(item => typeof item.tradeUpEligible === 'boolean'), 'every skin definition should explicitly expose Trade Up eligibility');
assert.ok(skins.DEFAULT_KNIFE_ITEM_IDS.every(id => skins.getItem(id)?.tradeUpEligible === false), 'default CT and T knives must not be Trade Up inputs or outputs');

assert.match(db, /trade_up_tutorial_seen BOOLEAN NOT NULL DEFAULT false/, 'tutorial completion should persist on the account');
assert.match(db, /CREATE TABLE IF NOT EXISTS trade_up_transactions[\s\S]*?UNIQUE \(account_id, idempotency_key\)/, 'Trade Ups should have a permanent idempotent audit table');
assert.doesNotMatch(db.match(/CREATE TABLE IF NOT EXISTS trade_up_transactions[\s\S]*?\n\);/)?.[0] || '', /account_id[^\n]*REFERENCES accounts/, 'completed Trade Up audits must survive later account deletion');
assert.match(db, /async function completeTradeUp[\s\S]*?BEGIN[\s\S]*?pg_advisory_xact_lock[\s\S]*?trade_up_transactions WHERE account_id = \$1 AND idempotency_key = \$2[\s\S]*?FOR UPDATE[\s\S]*?trade_up_item_listed[\s\S]*?trade_up_item_in_trade[\s\S]*?buildTradeUpOutcome[\s\S]*?DELETE FROM skin_inventory[\s\S]*?INSERT INTO skin_inventory[\s\S]*?UPDATE trade_up_transactions SET output_inventory_item_id[\s\S]*?COMMIT[\s\S]*?ROLLBACK/, 'Trade Up completion should be locked, idempotent, server-selected, audited, and atomic');
assert.match(db, /INSERT INTO skin_inventory \(account_id, item_id, source, collection_id, pattern_seed, rarity_tier, wear_value, wear_seed\)[\s\S]*?`case:\$\{caseId\}`/, 'case rewards should persist their immutable collection association');
assert.match(db, /ALTER TABLE skin_inventory ADD COLUMN IF NOT EXISTS collection_id[\s\S]*?backfill_skin_inventory_collections_2026_07_14[\s\S]*?UPDATE skin_inventory[\s\S]*?SET collection_id = substring\(source FROM 6\)/, 'legacy case rewards should backfill collection membership through a one-time migration');
assert.match(db, /async function createMarketListing[\s\S]*?skin-economy:\$\{accountId\}[\s\S]*?FOR UPDATE[\s\S]*?INSERT INTO skin_market_listings/, 'listing creation should share the Trade Up account lock');
assert.match(db, /async function createTradeRequest[\s\S]*?skin-economy:\$\{id\}[\s\S]*?FOR UPDATE[\s\S]*?INSERT INTO skin_trade_requests/, 'friend-trade creation should share the Trade Up account lock');

assert.match(server, /if \(type === 'getTradeUpState'\)[\s\S]*?sendTradeUpState\(client\)/, 'server should expose the authoritative eligibility state');
assert.match(server, /if \(type === 'completeTradeUp'\)[\s\S]*?handleCompleteTradeUp\(client, data\)/, 'server should route Trade Up completion');
assert.match(server, /db\.completeTradeUp\(\{ accountId: client\.accountId, inventoryItemIds, idempotencyKey \}\)/, 'the frontend should submit only inventory IDs and an idempotency key');

for (const id of ['btn-open-trade-up', 'trade-up-menu', 'trade-up-eligible-grid', 'trade-up-selected-grid', 'trade-up-sort', 'btn-trade-up-clear', 'trade-up-ready', 'btn-trade-up-proceed', 'trade-up-tutorial', 'trade-up-confirm']) {
  assert.ok(html.includes(`id="${id}"`), `Trade Up UI should include ${id}`);
}
assert.match(html, /function addTradeUpItem[\s\S]*?tradeUpState\.activeRarity = rarity[\s\S]*?tradeUpState\.selectedIds\.push/, 'the first input should lock the client to one rarity');
assert.match(html, /function removeTradeUpItem[\s\S]*?selectedIds\.filter[\s\S]*?activeRarity = tradeUpState\.selectedIds\.length/, 'removing every input should reset the rarity filter');
assert.match(html, /function submitTradeUp[\s\S]*?sendPacket\('completeTradeUp', \{[\s\S]*?inventoryItemIds:[\s\S]*?idempotencyKey:/, 'the client should send IDs and an idempotency key only after confirmation');
assert.match(html, /function handleTradeUpResult[\s\S]*?if \(!data\.ok\)[\s\S]*?openTradeUpRewardInspect\(data\)/, 'the reveal should only start after a successful server result');
assert.doesNotMatch(html, /id="trade-up-(?:possible|odds|probability|output-preview)/, 'the Trade Up screen must not contain an outcome preview or odds panel');
assert.match(html, /\.trade-up-workspace \{[^}]*grid-template-columns:minmax\(0,1fr\) 1px minmax\(0,1fr\)[^}]*overflow:hidden/, 'desktop Trade Up layout should preserve two independently scrollable columns');
assert.match(html, /\.trade-up-bottom \{[^}]*flex:0 0 auto/, 'Trade Up controls should remain fixed below the scrolling panes');
assert.match(html, /@media \(max-width: 620px\)[\s\S]*?\.trade-up-workspace \{[^}]*grid-template-rows:minmax\(0,1fr\) 1px minmax\(0,1fr\)/, 'mobile Trade Up panes should share available height without overlapping the fixed controls');
assert.match(html, /@media \(max-height: 600px\)[\s\S]*?#trade-up-menu\.hub-embedded-view \{[^}]*top:0[^}]*[\s\S]*?\.trade-up-workspace \{[^}]*grid-template-columns:minmax\(0,1fr\) 1px minmax\(0,1fr\)/, 'short viewports should give the integrated Trade Up screen enough usable height');
assert.match(html, /function localTradeUpPreviewState[\s\S]*?tradeUpEligible === false[\s\S]*?knife_default_ct_vanilla[\s\S]*?knife_default_t_vanilla/, 'the local QA fixture should mirror server eligibility and exclude default knives');

console.log('trade-up-system: rarity progression, normalized wear, server authority, atomicity, idempotency, tutorial, and two-pane UI verified.');
