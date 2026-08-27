// Last updated: 15 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

const caseOpenStart = server.indexOf('function openCaseForClient');
const caseOpenEnd = server.indexOf('\nfunction handleMarketList', caseOpenStart);
const caseOpen = server.slice(caseOpenStart, caseOpenEnd);
assert.ok(caseOpenStart >= 0 && caseOpenEnd > caseOpenStart, 'case opening handler should be present');
assert.ok(
  caseOpen.indexOf('client.caseOpenBusyUntil = Date.now() + 7000;') < caseOpen.indexOf('(async () => {'),
  'case opening should claim its client slot before entering asynchronous work'
);
assert.ok(
  caseOpen.indexOf('client.caseOpenBusyUntil = Date.now() + 7000;') < caseOpen.indexOf('await resolveCaseDefinition'),
  'case opening should be locked before awaiting the case definition'
);

const uniqueRowsMatch = html.match(/function uniqueSkinInventoryRows\(rows = \[\]\) \{[\s\S]*?\n        \}/);
assert.ok(uniqueRowsMatch, 'inventory should include a duplicate-row guard');
const uniqueRows = new Function(`${uniqueRowsMatch[0]}; return uniqueSkinInventoryRows;`)();
assert.deepStrictEqual(
  uniqueRows([{ id: 8 }, { id: 8 }, { id: 11 }]).map(row => row.id),
  [8, 11],
  'inventory should suppress repeated copies of the same persistent row id'
);
assert.match(html, /inventory:\s*localSkinLabTest[\s\S]*?: uniqueSkinInventoryRows\(data\.inventory\)/, 'server inventory snapshots should pass through the duplicate-row guard');
assert.match(html, /const ownedSkins = uniqueSkinInventoryRows\(skinInventoryState\.inventory\)[\s\S]*?!item\.isDefault/, 'persisted default rows should not duplicate synthetic defaults');

assert.match(html, /function showInventory\(\)[\s\S]*?sendPacket\('marketList', \{ limit: 100 \}\)/, 'opening inventory should load the account listing state');
assert.match(html, /data-inventory-cancel-listing/, 'listed inventory cards should expose a cancellation control');
assert.match(html, /data-inventory-cancel-listing[\s\S]*?sendPacket\('marketCancelListing'/, 'inventory cancellation should use the existing server-authorized endpoint');
assert.match(html, /function syncInventoryListingAction\(\)[\s\S]*?'Cancel Listing' : 'Sell Skin'/, 'the selected-item action should reflect active listing state');

assert.match(html, /function renderInventory\(\)[\s\S]*?viewerModal\.classList\.contains\('open'\) && !viewerModal\.classList\.contains\('case-reward'\)/, 'inventory refreshes should not replace an active reward preview');
assert.match(html, /function updateInventoryPreview\(entry, item, isEquipped, \{ lockToSelection = true \} = \{\}\)/, 'reward previews should be able to stay independent from inventory selection filters');
assert.match(html, /function openTradeUpRewardInspect[\s\S]*?updateInventoryPreview\(entry, item, false, \{ lockToSelection: false \}\)/, 'Trade Up rewards should render the awarded skin even when another weapon filter is active');
assert.match(html, /function openCaseRewardInspect[\s\S]*?updateInventoryPreview\(previewEntry, item, false, \{ lockToSelection: false \}\)/, 'case rewards should use the same stable reward-preview path');
assert.match(html, /localTradeUpRewardTest[\s\S]*?inventoryWeaponFilter = 'AWP'[\s\S]*?openTradeUpRewardInspect[\s\S]*?setTimeout\(renderInventory, 60\)/, 'local QA should reproduce an AWP-filter refresh over a MAC10 Trade Up reward');
assert.match(html, /canvas\.dataset\.previewItemId = item\?\.id \|\| '';[\s\S]*?canvas\.dataset\.previewWeapon = item\?\.weapon \|\| '';/, 'the rendered preview should expose its resolved item identity for regression QA');

assert.match(html, /const MAIN_SCENE_TONE_EXPOSURE = 0\.9;/, 'the main renderer should lift dark map tones slightly');
assert.match(html, /renderer\.toneMappingExposure = MAIN_SCENE_TONE_EXPOSURE;/, 'the main renderer should use the shared exposure value');
assert.match(html, /new THREE\.HemisphereLight\(0xeeeeff, 0x777788, 0\.46\)/, 'the existing scene light intensity should remain unchanged');
assert.match(html, /new THREE\.DirectionalLight\(0xffffff, 0\.72\)/, 'the existing sun intensity should remain unchanged');

assert.match(server, /function matchXpForPlayer[\s\S]*?matchScore \|\| 0\) \/ 11[\s\S]*?Math\.min\(1100, 90 \+ performanceXp \+ \(mvp \? 70 : 0\)\)/, 'match XP should use the slightly slower progression rate');
assert.match(server, /return won \? participationXp \* 2 : participationXp;/, 'wins should retain the exact double XP bonus');

console.log('inventory-race-listing-lighting-xp: inventory safety, cancellation, map exposure, and XP tuning verified.');
