// Last updated: 13 August 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const skins = require('../skins');

// Case editor and rarity rules are mostly static contracts, so this test locks
// the catalog shape, Mythic knife-only rule, and admin UI/server packet wiring.
const ROOT = path.resolve(__dirname, '..');
const dbJs = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const skinsJs = fs.readFileSync(path.join(ROOT, 'skins.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

assert.deepStrictEqual(
  skins.RARITIES.map(rarity => [rarity.id, rarity.displayName]),
  [
    ['common', 'Common'],
    ['rare', 'Rare'],
    ['epic', 'Epic'],
    ['legendary', 'Legendary'],
    ['mythic', 'Mythic']
  ],
  'case rarity names should match the requested public names'
);

const nonDefaultKnives = skins.ITEMS.filter(item => item.weapon === 'Knife' && !skins.DEFAULT_KNIFE_ITEM_IDS.includes(item.id));
assert.ok(nonDefaultKnives.length > 0, 'catalog should include non-default knife rewards');
assert.ok(nonDefaultKnives.every(item => item.rarity === 'mythic'), 'non-default knife rewards should be Mythic');
assert.ok(!skins.STARTER_ITEM_IDS.some(itemId => nonDefaultKnives.some(item => item.id === itemId)), 'starter inventory should not grant extra knife variants');

const rifle = skins.ITEMS.find(item => item.weapon !== 'Knife');
assert.throws(
  () => skins.sanitizeCaseDefinition({ id: 'bad_case', items: [{ itemId: rifle.id, rarity: 'mythic', weight: 1 }] }),
  /mythic_requires_knife/,
  'Mythic rarity should be rejected for non-knife items'
);

const knife = nonDefaultKnives[0];
const customCase = skins.sanitizeCaseDefinition({
  id: 'Admin Test Case',
  displayName: 'Admin Test Case',
  marketVisible: false,
  designId: 'diamond-vault',
  price: 500,
  availableUntil: '2026-08-14T00:00:00.000Z',
  showTimeRemaining: true,
  discountMode: 'final',
  discountPrice: 300,
  finalDiscountMinutes: 120,
  rarityMode: 'class',
  rarityWeights: { common: 75, mythic: 25 },
  items: [
    { itemId: rifle.id, rarity: 'common', weight: 3 },
    { itemId: knife.id, rarity: 'mythic', weight: 1 }
  ]
});
assert.strictEqual(customCase.id, 'admin_test_case', 'case ids should be URL/server safe');
assert.strictEqual(customCase.marketVisible, false, 'case sanitizer should preserve admin marketplace visibility');
assert.strictEqual(customCase.designId, 'diamond-vault', 'case sanitizer should preserve a selected authored case design');
assert.strictEqual(skins.sanitizeCaseDefinition({ ...customCase, id: 'invalid_design_case', designId: '../../bad' }).designId, 'auto', 'unknown case designs should fail closed to automatic artwork');
assert.ok(skins.CASE_DESIGNS.length >= 15, 'case creator should offer at least fifteen distinct authored designs');
assert.ok(skins.CASE_DESIGNS.some(({ id }) => id === 'operative-gold'), 'case designs should include the gold space-themed Operative case');
assert.ok(skins.CASE_DESIGNS.some(({ id }) => id === 'garden-bloom'), 'case designs should include an explicit garden theme');
assert.ok(skins.CASE_DESIGNS.some(({ id }) => id === 'diamond-vault'), 'case designs should include an explicit diamond theme');
assert.ok(skins.CASE_DESIGNS.some(({ id }) => id === 'tradie-esky'), 'case designs should include an explicit tradie esky theme');
for (const id of ['gardener-case', 'lawn-care-case', 'mulch-case', 'nuke-case', 'warehouse-case']) {
  assert.ok(skins.CASE_DESIGNS.some((design) => design.id === id), `case designs should include ${id}`);
}
assert.ok(skins.CASE_DESIGNS.some(({ id }) => id === 'curry-case'), 'case designs should include the Curry Case');
assert.ok(fs.existsSync(path.join(ROOT, 'assets/ui/cases/curry-case.jpg')), 'Curry Case artwork should ship with the game');
assert.match(indexHtml, /\['curry-case', 'Curry Case'\]/, 'client fallback designs should include the Curry Case');
assert.match(indexHtml, /\/\(curry\|turmeric\|saffron\|spice\)\//, 'legacy Curry cases should resolve to the authored artwork');
assert.strictEqual(customCase.discountPrice, 300, 'case sanitizer should preserve a bounded discount price');
assert.strictEqual(customCase.finalDiscountMinutes, 120, 'case sanitizer should preserve final availability discount duration');
const finalDiscountCase = { ...customCase, marketVisible: true };
assert.strictEqual(skins.caseAvailability(finalDiscountCase, Date.parse('2026-08-13T21:00:00.000Z')).price, 500, 'base price should apply before the final discount window');
assert.strictEqual(skins.caseAvailability(finalDiscountCase, Date.parse('2026-08-13T23:00:00.000Z')).price, 300, 'discount price should apply during the final window');
assert.strictEqual(skins.caseAvailability(finalDiscountCase, Date.parse('2026-08-14T00:00:00.000Z')).available, false, 'case should become unavailable exactly at expiry');
assert.strictEqual(customCase.rarityMode, 'class', 'case sanitizer should preserve per-rarity-class weighting mode');
assert.strictEqual(customCase.rarityWeights.common, 75, 'case sanitizer should preserve Common class weight');
assert.strictEqual(customCase.rarityWeights.mythic, 25, 'case sanitizer should preserve Mythic class chance');
const classRolls = [7500, 0];
const roll = skins.rollCaseDefinition(customCase, (max) => {
  const value = classRolls.shift() ?? 0;
  assert.ok(value >= 0 && value < max, `deterministic class roll ${value} must be below ${max}`);
  return value;
});
assert.strictEqual(roll.item.id, knife.id, 'weighted custom case rolls should return catalog items');
assert.strictEqual(roll.tier, 'mythic', 'custom case rolls should preserve the selected rarity');
assert.strictEqual(roll.gold, true, 'Mythic case rolls should drive the gold/mythic animation branch');
const commonRolls = [0, 0];
assert.strictEqual(
  skins.rollCaseDefinition(customCase, max => Math.min(max - 1, commonRolls.shift() ?? 0)).tier,
  'common',
  'per-class mode should choose the configured class before choosing a skin within it'
);
const reel = skins.buildCaseReel(roll, () => 0, { caseDef: customCase });
assert.ok(reel && reel.reel[reel.winningIndex].itemId === knife.id, 'custom case reels should put the awarded item at the winning index');
assert.strictEqual(skins.CASES.length, 0, 'default cases should not ship in the game catalog');
assert.deepStrictEqual(skins.publicCatalog([]).cases, [], 'public catalog should have no cases until admins create custom ones');
assert.ok(skins.publicCatalog([customCase]).cases.some(caseDef => caseDef.id === customCase.id), 'public catalog should include sanitized custom cases');

assert.match(dbJs, /CREATE TABLE IF NOT EXISTS custom_cases/, 'database schema should persist custom cases');
assert.match(dbJs, /visible_in_market BOOLEAN NOT NULL DEFAULT true/, 'database should persist whether a custom case is shown in the marketplace');
assert.match(dbJs, /design_id\s+TEXT NOT NULL DEFAULT 'auto'/, 'database should persist the selected case design');
assert.match(dbJs, /available_until TIMESTAMPTZ[\s\S]*?discount_price BIGINT[\s\S]*?final_discount_minutes INT/, 'database should persist availability and both discount scheduling modes');
assert.match(dbJs, /rarity_mode TEXT NOT NULL DEFAULT 'skin'/, 'database should persist per-skin or per-rarity-class weighting');
assert.match(dbJs, /async function getCustomCases\(\)/, 'database should read custom cases');
assert.match(dbJs, /async function upsertCustomCase/, 'database should save custom cases');
assert.match(dbJs, /async function deleteCustomCase/, 'database should delete custom cases');

assert.match(serverJs, /if \(type === 'getCaseEditor'\)[\s\S]*?sendCaseEditorData\(client, \{ force: true \}\);/, 'server should expose admin-gated case editor data');
assert.match(serverJs, /if \(type === 'saveCaseDefinition'\)[\s\S]*?handleSaveCaseDefinition\(client, data\);/, 'server should expose admin-gated case saving');
assert.match(serverJs, /if \(type === 'deleteCaseDefinition'\)[\s\S]*?handleDeleteCaseDefinition\(client, data\);/, 'server should expose admin-gated case deletion');
assert.match(serverJs, /skins\.rollCaseDefinition\(caseDef, randomInt\)/, 'case tests should use custom weighted roll definitions');

assert.ok(indexHtml.includes('id="case-editor-panel"'), 'admin UI should include a case editor panel');
assert.ok(indexHtml.includes('id="btn-owner-case-editor"'), 'Owner Settings should expose a visible Case Editor button');
assert.ok(!indexHtml.includes('id="btn-admin-skin-lab"'), 'Admin Settings should not expose the removed Skins Lab shortcut');
assert.ok(indexHtml.includes('id="case-editor-menu"'), 'case editor should live in a standalone admin menu');
assert.ok(indexHtml.includes('id="case-editor-skin-search"'), 'case editor should include skin search');
assert.ok(indexHtml.includes('id="case-editor-weapon-filter"'), 'case editor should include weapon filtering');
assert.ok(indexHtml.includes('id="case-editor-summary"'), 'case editor should show a live drop summary');
assert.ok(indexHtml.includes('id="case-editor-case-list"'), 'case editor should use a scannable case library instead of only a select');
assert.ok(indexHtml.includes('id="case-editor-library-list"'), 'case editor should expose a searchable skin library');
assert.ok(indexHtml.includes('id="case-editor-drop-search"'), 'case editor should filter the active drop table');
assert.ok(indexHtml.includes('id="case-editor-drop-weapon-filter"'), 'case editor should filter added drops by weapon');
assert.ok(indexHtml.includes('id="btn-case-editor-clear"'), 'case editor should provide a clear-all command');
assert.ok(indexHtml.includes('id="case-editor-market-visible"'), 'case editor should provide a marketplace visibility toggle');
assert.ok(indexHtml.includes('id="case-editor-design"'), 'case editor should provide a case design selector');
assert.ok(indexHtml.includes('id="case-editor-design-preview"'), 'case editor should preview the selected authored case design');
assert.match(indexHtml, /case-art-image[\s\S]*?assets\/ui\/cases\//, 'case presentation should render the authored case artwork directly');
assert.doesNotMatch(indexHtml, /id="case-preview-canvas"/, 'case inspection should not include the removed 3D preview canvas');
assert.doesNotMatch(indexHtml, /function loadCaseAsset\(caseDef\)/, 'case inspection should not load case GLB assets');
assert.match(indexHtml, /function updateCasePreview\(caseDef\)[\s\S]*?applyCaseCrateElement\(imagePreview, caseDef\)/, 'case inspection should present the selected authored case image');
assert.match(indexHtml, /\.case-inspect-hero \.case-crate \{[^}]*width:470px;[^}]*height:376px/, 'case inspection should display the authored artwork at its larger native aspect ratio');
assert.match(indexHtml, /casePreviewTest/, 'localhost should expose a direct case artwork preview for browser QA');
for (const id of ['case-editor-limited-availability', 'case-editor-available-from', 'case-editor-available-until', 'case-editor-show-time-remaining', 'case-editor-discount-mode', 'case-editor-discount-price', 'case-editor-final-discount-hours']) assert.ok(indexHtml.includes(`id="${id}"`), `case editor should provide ${id}`);
assert.ok(indexHtml.includes('data-case-rarity-mode="skin"') && indexHtml.includes('data-case-rarity-mode="class"'), 'case editor should offer per-skin and per-rarity-class weighting');
assert.match(indexHtml, /Common chance %[\s\S]*?Rare chance %[\s\S]*?case-editor-class-total/, 'class mode should expose direct percentage controls and a 100 percent total');
assert.match(indexHtml, /function syncCaseEditorClassChanceInputs\(\)[\s\S]*?input\.disabled = locked \|\| !active\.includes\(rarity\)/, 'class chance controls should disable rarity classes without any drops');
assert.match(indexHtml, /case-editor-class-weights'\)\.addEventListener\('input'[\s\S]*?setCaseEditorDirty\(true\);\s*applyCaseEditorClassWeights\(\);/, 'editing one class chance should leave every other manually entered percentage unchanged');
assert.match(indexHtml, /function normalizeCaseEditorClassChances\(\)[\s\S]*?100 - assigned/, 'the explicit normalize command should bring active rarity classes to exactly 100 percent');
assert.match(indexHtml, /function applyCaseEditorRarityWeights\(\)[\s\S]*?caseEditorRarityMode\(\) === 'class'[\s\S]*?applyCaseEditorClassWeights\(\)/, 'weight preset action should preserve rarity-class mode calculations');
assert.match(indexHtml, /\.admin-case-editor \{[^}]*grid-template-columns: minmax\(280px, \.62fr\) minmax\(480px, 1\.05fr\) minmax\(600px, 1\.25fr\)/, 'desktop case editor should use the concept-aligned three-pane workspace');
assert.match(indexHtml, /body\.experimental-ui #case-editor-menu\.hub-embedded-view \{[^}]*top: 0;[^}]*left: 0;[^}]*right: 0;[^}]*bottom: 0;/, 'case editor should own the full viewport instead of sitting under the lobby navigation');
assert.match(indexHtml, /function setCaseEditorDirty\(dirty, message = ''\)[\s\S]*?Unsaved changes/, 'case editor should expose unsaved draft state');
assert.match(indexHtml, /function renderCaseEditorSummary\(\)[\s\S]*?data-case-probability[\s\S]*?Probability total/, 'drop table should calculate and display per-row probability totals');
assert.match(indexHtml, /function sortCaseEditorRowsByRarity\(\)[\s\S]*?caseRarityRank[\s\S]*?appendChild\(row\)/, 'case editor drops should automatically group from Common through Mythic');
assert.doesNotMatch(indexHtml, /data-case-move=/, 'automatic rarity ordering should replace conflicting manual row ordering');
assert.match(indexHtml, /function addCaseEditorLibraryItem\(itemId\)[\s\S]*?already in this case/, 'skin library should prevent duplicate drop rows');
assert.match(indexHtml, /data-case-library-inspect=[\s\S]*?function openCaseEditorSkinInspect\(itemId\)[\s\S]*?updateInventoryPreview\(null, item, false\)/, 'clicking a case-editor thumbnail should open the shared 3D skin inspector');
assert.match(indexHtml, /case-editor-case-membership[\s\S]*?function caseEditorCasesForItem\(itemId\)[\s\S]*?caseDef\.items/, 'skin library rows should list every saved case containing that skin');
assert.match(indexHtml, /function readCaseEditorDraft\(\)[\s\S]*?availableUntil[\s\S]*?discountMode[\s\S]*?finalDiscountMinutes[\s\S]*?rarityMode/, 'case editor should save availability and discount scheduling with the draft');
assert.match(indexHtml, /id="case-editor-limited-availability"[\s\S]*?function syncCaseEditorScheduleControls\([\s\S]*?initializeAvailability[\s\S]*?7 \* 24 \* 60 \* 60 \* 1000/, 'limited availability should be an explicit toggle with a usable default week');
assert.match(indexHtml, /case_availability_end_required[\s\S]*?case_final_discount_too_long[\s\S]*?case_discount_outside_availability/, 'the editor should explain invalid availability and discount schedules');
assert.match(skinsJs, /case_final_discount_too_long[\s\S]*?case_discount_outside_availability/, 'the server sanitizer should enforce availability-aware discount bounds');
assert.match(indexHtml, /function renderMarketplaceCases\(\)[\s\S]*?caseMarketplaceAvailability\(caseDef\)\.available/, 'marketplace should omit hidden, future, and expired cases');
assert.match(indexHtml, /const expired = caseDef\?\.availableUntil[\s\S]*?if \(!caseDef \|\| expired/, 'expired cases should also disappear from player resale cards');
assert.match(indexHtml, /market-price-original[\s\S]*?text-decoration:line-through/, 'marketplace should cross out the original discounted price');
assert.match(indexHtml, /function openCaseInspect\(caseId\)[\s\S]*?data-case-content-inspect/, 'case contents should be individually inspectable');
assert.match(serverJs, /const availability = caseDef \? skins\.caseAvailability\(caseDef\)[\s\S]*?!availability\?\.available[\s\S]*?availability\.price/, 'server should reject unavailable purchases and charge authoritative scheduled pricing');
assert.match(indexHtml, /const localCaseEditorTest = \['localhost', '127\.0\.0\.1'\]/, 'localhost should expose a rendered case editor preview for visual QA');
assert.ok(indexHtml.includes("document.getElementById('btn-owner-case-editor').addEventListener('click', () => showCaseEditor(banManagerReturn));"), 'Owner Settings Case Editor button should open the editor');
assert.ok(indexHtml.includes("document.getElementById('btn-admin-room-case-editor').addEventListener('click', () => showCaseEditor('pause'));"), 'admin-room controls should expose a shortcut to the same editor');
assert.ok(indexHtml.includes('function showCaseEditor(from = '), 'case editor menu should have a dedicated open function');
assert.ok(indexHtml.includes("sendPacket('saveCaseDefinition'"), 'case editor should save through the server');
assert.ok(indexHtml.includes("sendPacket('openCaseTest', { case: draft })"), 'case editor should test the current unsaved draft through the server');
assert.match(serverJs, /!consume && data\.case[\s\S]*?skins\.sanitizeCaseDefinition\(data\.case\)/, 'server should sanitize an unsaved admin draft before a test open');
assert.ok(indexHtml.includes('Mythic can only be used for knives.'), 'case editor should explain the Mythic knife-only rule');

console.log('case-editor: three-pane custom case editor, probability tooling, rarity names, and Mythic rules verified.');
