// Last updated: 15 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const skins = require('../skins');

const ROOT = path.resolve(__dirname, '..');
const db = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const patternItem = skins.ITEMS.find(item => item.textureApplication === 'pattern' && item.weapon !== 'Knife');
const mythicKnife = skins.ITEMS.find(item => item.weapon === 'Knife' && item.rarity === 'mythic');
assert.ok(patternItem?.finish, 'pattern catalog items should expose a searchable finish');
assert.ok(mythicKnife?.knifeType, 'knife catalog items should expose a searchable knife type');

const caseDef = skins.sanitizeCaseDefinition({
  id: 'collection_case',
  displayName: 'Mowers United Case',
  collectionName: 'Mowers United Collection',
  items: [
    { itemId: patternItem.id, rarity: 'rare', weight: 50 },
    { itemId: mythicKnife.id, rarity: 'mythic', weight: 1 }
  ]
});
const catalog = skins.publicCatalog([caseDef]);
assert.strictEqual(caseDef.collectionName, 'Mowers United Collection');
assert.deepStrictEqual(catalog.collections[0].items.map(item => item.itemId), [patternItem.id], 'collection progress should exclude knives');

const mythicResult = { item: mythicKnife, tier: 'mythic', gold: true };
const reel = skins.buildCaseReel(mythicResult, () => 0, { caseDef });
assert.ok(reel.reel.every((entry, index) => index === reel.winningIndex || entry.rarity !== 'mythic'), 'mythics must never appear as reel filler');
assert.strictEqual(reel.reel[reel.winningIndex].gold, true, 'the winning mythic should still use the gold reveal');

assert.match(db, /skin_inventory \([\s\S]*?pattern_seed INT NOT NULL DEFAULT 0[\s\S]*?rarity_tier TEXT[\s\S]*?wear_value[\s\S]*?wear_seed/, 'inventory instances should persist case rarity, pattern seeds, and seeded wear');
assert.match(db, /CREATE TABLE IF NOT EXISTS skin_collection_unlocks[\s\S]*?PRIMARY KEY \(account_id, collection_id, item_id\)/, 'collection discoveries should be unique per account and skin');
assert.match(db, /clear_all_inventories_2026_07_10[\s\S]*?UPDATE skin_market_listings SET status = 'cancelled'[\s\S]*?DELETE FROM skin_inventory/, 'deployment should perform the requested one-time inventory reset');
assert.match(db, /async function clearPlayerInventory[\s\S]*?DELETE FROM skin_loadouts[\s\S]*?DELETE FROM case_inventory[\s\S]*?DELETE FROM skin_inventory/, 'admin inventory clearing should remove loadouts, cases, and skins atomically');
assert.doesNotMatch(db, /async function removeSkinInventoryItem/, 'admin settings should not expose a single-skin ownership mutation helper');
assert.match(db, /ON DELETE SET NULL/, 'inventory clearing should preserve completed marketplace history');
assert.match(db, /async function awardCaseRoll[\s\S]*?pattern_seed[\s\S]*?skin_collection_unlocks[\s\S]*?nextLevelXp \* 0\.1/, 'real case opens should persist patterns and award first-discovery XP');
assert.match(db, /async function getMarketOverview[\s\S]*?market_cap[\s\S]*?cases_unboxed[\s\S]*?money_supply/, 'market overview should aggregate global economy statistics');
assert.match(db, /normalize_pattern_seeds_1_1000_2026_07_11[\s\S]*?MOD\(pattern_seed - 1, 1000\)/, 'existing pattern indices should migrate into the 1-1000 range');
assert.match(db, /async function getSoldMarketCatalog[\s\S]*?status = 'sold'[\s\S]*?average_price/, 'sold-skin catalog should only include completed sales');
assert.match(db, /async function getMarketItemHistory[\s\S]*?ORDER BY sold_at ASC/, 'per-skin history should return a chronological trend');

assert.doesNotMatch(server, /ensureStarters: isAdminUser/, 'admins must not be auto-granted the catalog after an inventory clear');
assert.match(server, /if \(!consume\) \{[\s\S]*?test: true[\s\S]*?return;[\s\S]*?db\.awardCaseRoll/, 'test opens should present a real roll without granting inventory');
assert.match(server, /const landingFraction = \(28 \+ randomInt\(45\)\) \/ 100;/, 'case rolls should receive a safe randomized landing position inside the winning card');
assert.match(server, /const patternSeed = crypto\.randomInt\(1, 1001\);[\s\S]*?const wearValue = defaultReward \? 0 : crypto\.randomInt\(0, 1000001\) \/ 1000000;[\s\S]*?const wearSeed = defaultReward \? 0 : crypto\.randomInt\(1, 2147483647\)/, 'case rewards should use pattern 1-1000 plus persistent wear values and seeds');
assert.match(server, /DEFAULT_KNIFE_ITEM_IDS\.includes[\s\S]*?default_skin_not_sellable/, 'default CT and T knives should be blocked server-side from listings');
assert.match(server, /requestedDefault[\s\S]*?DEFAULT_KNIFE_ITEM_IDS\.includes\(requestedDefault\)[\s\S]*?setSkinLoadout[\s\S]*?itemId: requestedDefault/, 'default CT and T knife selection should persist as an explicit loadout');
assert.match(server, /adminClearPlayerInventory[\s\S]*?handleAdminClearPlayerInventory/, 'admin packet routing should expose targeted inventory clearing');
assert.doesNotMatch(server, /admin(?:GetPlayerInventory|GrantPlayerSkin|RemovePlayerSkin)/, 'admin packet routing should not expose skin ownership mutation commands');
assert.match(server, /if \(type === 'useHealthshot'\)[\s\S]*?player\.healthshots -= 1[\s\S]*?healthshotHealRemaining = 60/, 'healthshot use should consume a server-owned charge before heal ticks');

for (const id of ['case-editor-knife-filter', 'case-editor-finish-filter', 'case-editor-texture-filter', 'case-editor-sort', 'btn-case-editor-add-selected', 'btn-case-editor-add-filtered', 'case-editor-collection-name']) {
  assert.ok(html.includes(`id="${id}"`), `case editor should include ${id}`);
}
assert.match(html, /btn-case-editor-toggle-details[\s\S]*?function setCaseEditorDetailsExpanded[\s\S]*?function updateCaseEditorDetailsSummary/, 'saved case details should collapse into a compact editable summary');
assert.match(html, /\.case-editor-bulk-bar \{ flex:0 0 auto;/, 'bulk editor controls should not flex-shrink underneath the library header');
assert.match(html, /\.case-editor-row \{ grid-template-columns:20px minmax\(105px,1fr\) 72px 52px 78px;/, 'mobile drop rows should preserve the full action cluster without clipping');
assert.match(html, /\.case-editor-row select, \.case-editor-row input \{ box-sizing:border-box;/, 'drop controls should stay inside their grid tracks');
assert.match(html, /function caseEditorFilteredItems[\s\S]*?knifeType[\s\S]*?finish[\s\S]*?textureType[\s\S]*?comparators/, 'case editor should combine rich filters with multiple sort modes');
assert.match(html, /function applySkinMaterialLayers[\s\S]*?skinOverlaySample = mapTexelToLinear[\s\S]*?overlayProtection = 1\.0 - smoothstep\(0\.01, 0\.12, skinOverlaySample\.a\)[\s\S]*?mix\(diffuseColor\.rgb, skinOverlaySample\.rgb, skinOverlaySample\.a\)/, 'wear should affect the pattern underlay while every visible alpha-overlay pixel remains protected on top');
assert.match(html, /skinWearGrungeMap[\s\S]*?skinWearCrackedMap[\s\S]*?crackedWear \+=[\s\S]*?mix\(0\.86, 0\.63, pow\(wearAmount, 0\.55\)\)/, 'wear should smooth both monochrome masks and cap worn regions near 40 percent');
assert.doesNotMatch(html, /naturalEdgeWear|uvEdgeDistance/, 'wear must not consume whole atlas-edge components such as the AK magazine');
assert.match(html, /vec3 originalSkinColor = diffuseColor\.rgb[\s\S]*?vec3 wornSkinColor = mix\(originalSkinColor, vec3\(wornLuma\), 0\.42\) \* mix\(0\.62, 0\.30, wearAmount\)[\s\S]*?mix\(originalSkinColor, wornSkinColor, skinWearMaskValue\)/, 'worn regions should strongly darken the original skin instead of revealing a different base texture');
assert.match(html, /texture\.minFilter = THREE\.LinearMipmapLinearFilter[\s\S]*?texture\.generateMipmaps = true[\s\S]*?float wearFeather = 0\.11;[\s\S]*?smoothstep\(threshold - wearFeather, threshold \+ wearFeather, combinedWear\)/, 'wear masks should use mipmaps and a fixed broad feather so movement cannot change the wear boundary');
assert.doesNotMatch(html, /float wearFeather = max\([^;]*fwidth/, 'wear coverage should not depend on frame-varying screen derivatives');
assert.doesNotMatch(html, /skinBaseMap|sampledSkinBase/, 'wear must not replace pattern artwork with unrelated base-material pixels');
assert.doesNotMatch(html, /floor\(wearUv \* 640\.0\)/, 'wear should not use the old per-pixel random coverage gate that caused colored speckling');
assert.match(html, /wearUv\.x \*= seedB > 0\.5 \? -1\.0 : 1\.0[\s\S]*?mat2\(cos\(angle\)/, 'wear seeds should mirror, rotate, and offset mask placement');
assert.match(html, /function wearRatingLabel\(value\)[\s\S]*?Factory New[\s\S]*?Minimal Wear[\s\S]*?Field Tested[\s\S]*?Well Worn[\s\S]*?Battle Scarred/, 'wear metadata should use the five standard rating names');
assert.match(html, /texture\.offset\.set[\s\S]*?texture\.rotation[\s\S]*?patternSeed/, 'pattern instances should rotate and offset deterministically by seed');
assert.match(html, /inventoryThumbnailKey[\s\S]*?@pattern:/, 'thumbnail identity should include the pattern instance seed');
assert.match(html, /WEAPON_REFLECTION_TEXTURE_PATH = '\/assets\/environments\/dust2-reflection\.png'[\s\S]*?scene\.environment = texture[\s\S]*?metadataNeedsReflection/, 'all scene and weapon reflections should use the exact supplied environment image');
assert.ok(html.includes("url('/assets/ui/case-gold.jpeg')"), 'mythic reel cards should use the supplied gold art');
assert.match(html, /function caseInspectDisplayEntries\(caseDef\)[\s\S]*?item\.weapon !== 'Knife'[\s\S]*?special: true, rarity: 'mythic'/, 'case inspect should collapse all knife rewards into one gold special entry');
assert.match(html, /Rare Special Item[\s\S]*?Knife · Mythic/, 'case inspect should label the collapsed gold entry as Rare Special Item');
for (const functionName of ['caseItemsWithCatalog', 'openCaseInspect', 'closeCaseInspect', 'buildLocalCaseRoll', 'openOwnedCase']) {
  assert.strictEqual((html.match(new RegExp(`function ${functionName}\\(`, 'g')) || []).length, 1, `${functionName} should have one implementation so stale declarations cannot override case presentation`);
}
assert.ok(html.includes('data-case-content-inspect="${escapeHtml(item.id)}"'), 'non-knife case contents should render an inspect command');
assert.ok(html.includes("openCaseEditorSkinInspect(card.dataset.caseContentInspect || '')"), 'non-knife case contents should open the live skin inspector');
assert.ok(html.includes('if (special) return `<div class="case-content-card rare-special rarity-mythic">'), 'the collapsed knife special entry should remain a non-interactive card');
assert.match(html, /function sortCaseEntriesByRarity\(entries\)[\s\S]*?caseRarityRank[\s\S]*?localeCompare/, 'case contents should sort by rarity and then by item name');
assert.match(html, /const LOBBY_MUSIC_MAX_SCALE = 0\.3;/, 'lobby music should peak at half its previous 0.6 scale');
assert.match(html, /fadeLobbyMusicForCase[\s\S]*?resumeLobbyMusicAfterCase[\s\S]*?openCaseRewardInspect/, 'case opening should duck music until the full-screen reward inspect closes');
assert.match(html, /prewarmCaseSfx[\s\S]*?caseSfxReady/, 'case animation should preload SFX before the reel starts');
assert.doesNotMatch(html, /case-roll-card\.winner/, 'case animation should not reveal the winning card with a border');
assert.match(html, /case-roll-card rarity-\$\{[\s\S]*?landingFraction[\s\S]*?Math\.max\(0\.28, Math\.min\(0\.72/, 'case reel should use rarity strips and land within a safe randomized portion of the winner');
assert.match(html, /function caseRollTrackOffset[\s\S]*?getComputedStyle\(track\)\.transform[\s\S]*?caseRollPointerIndex/, 'case scroll SFX should follow the real rendered transform rather than a mismatched easing approximation');
assert.doesNotMatch(html, /confirm\(`Buy \$\{caseDef\.displayName/, 'case purchases should begin immediately without a confirmation prompt');
assert.match(html, /function caseVisualTheme\(caseDef\)[\s\S]*diamond[\s\S]*case-theme-\$\{escapeHtml\(theme\)\}/, 'case cards should derive distinctive crate artwork from each case name');
assert.ok(!html.includes('id="admin-skin-account"'), 'Admin Settings should not include a skin inventory ownership editor');
assert.ok(!html.includes("sendPacket('adminGrantPlayerSkin'"), 'Admin Settings should not grant catalog skins');
assert.ok(!html.includes("sendPacket('adminRemovePlayerSkin'"), 'Admin Settings should not remove owned skin instances');
assert.match(html, /assets\/models\/healthshot\.glb[\s\S]*?healthshotUseState/, 'healthshot use should render the supplied model during its injection sequence');
assert.match(html, /const EMBEDDED_AGENT_IMPORTED_LOCOMOTION = true[\s\S]*?function embeddedAgentLocomotionClip[\s\S]*?rootMotionTrack[\s\S]*?THREE\.NormalAnimationBlendMode[\s\S]*?action\.timeScale/, 'walking should blend native GLB locomotion while stripping only root motion');
assert.match(html, /targetWeight = data\.isCrouching \? 0\.82 : \(data\.isWalking \? 0\.78 : 0\.88\)/, 'walking should use a softer native blend than running');
assert.match(html, /localSkinLabTest && blocker\.style\.display === 'none'/, 'localhost skin QA should only accept pointer-lock-free fire input on the active playfield');
assert.match(html, /setInventoryHubVisible\(isAuthed && \(!isGuest \|\| localSkinLabTest\)\)/, 'localhost skin QA should expose inventory and market surfaces without changing production guest access');
assert.match(html, /local_collection_preview[\s\S]*?Mowers United Collection/, 'localhost skin QA should include a collection fixture for rendered progress testing');
assert.match(html, /localSkinWearTest[\s\S]*?qa_pattern_case[\s\S]*?Pattern Wear QA Case/, 'localhost wear QA should expose a mixed-rarity case for rendered case-inspect testing');
assert.match(html, /catalog: localSkinLabTest[\s\S]*?\? skinInventoryState\.catalog[\s\S]*?: \(data\.catalog/, 'localhost skin QA should preserve its augmented catalog when inventory data arrives');
assert.match(html, /function localMarketPreviewData[\s\S]*?prior_high_price: 2690[\s\S]*?recent_prices: prices/, 'localhost market QA should exercise featured drops and non-empty sale trends');
assert.match(html, /'Frag':[^\n]*?pos: \[-0\.34, 0\.24, 0\.72\][^\n]*?rot: \[1\.2, 0\.04, 1\.28\]/, 'frag first-person transform should use the supplied placement');
assert.match(html, /'Smoke':[^\n]*?pos: \[-0\.32, 0\.34, 0\.8\][^\n]*?rot: \[1\.04, 0, -1\.38\]/, 'smoke first-person transform should use the supplied placement');
assert.match(html, /'Flash':[^\n]*?pos: \[-0\.28, 0\.22, 0\.58\][^\n]*?rot: \[0\.96, 0, 0\.8\]/, 'flash first-person transform should use the supplied placement');
assert.match(html, /'Molotov':[^\n]*?pos: \[-0\.72, 0\.76, 1\.36\][^\n]*?rot: \[1\.08, 0, 0\]/, 'molotov first-person transform should use the supplied placement');
for (const utility of ['Frag', 'Smoke', 'Flash', 'Molotov']) {
  assert.match(html, new RegExp(`'${utility}':[^\\n]*?fpEndFlip: Math\\.PI`), `${utility} should receive the first-person end-over-end correction`);
}
assert.match(html, /view === 'firstPerson'[\s\S]*?spec\.fpEndFlip[\s\S]*?model\.rotateX\(spec\.fpEndFlip\)/, 'utility should swap its cap and base in first person instead of rolling around its length axis');
assert.doesNotMatch(html, /spec\.assetRoll[\s\S]*?rig\.rotateZ/, 'the ineffective utility length-axis roll should stay removed');
assert.ok(html.includes('id="market-overview"'), 'marketplace should show global economy statistics');
assert.ok(html.includes('id="market-history-view"'), 'marketplace should expose the sold-skin history catalog');
assert.match(html, /function renderMarketHistory[\s\S]*?market-trend-chart[\s\S]*?market-sale-row/, 'market history should render a trend chart and individual completed sales');
assert.ok(!html.includes('id="inventory-collections"'), 'collections should not render as a separate inventory section');
assert.ok(!html.includes('No collections match this view'), 'inventory should not show a collection-specific empty state');
assert.doesNotMatch(html, /#inventory-menu\.hub-embedded-view \.panel-close,[\s\S]*?#marketplace-menu\.hub-embedded-view \.panel-close \{ display: none; \}/, 'title views should keep their top-right close controls visible');

console.log('economy-collections-case-presentation: patterns, collections, market history, case presentation, healthshot, and locomotion verified.');
