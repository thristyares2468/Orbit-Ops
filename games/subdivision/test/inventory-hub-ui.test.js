// Last updated: 15 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Static UI guard for the full-screen inventory/marketplace hub split and the
// account Mowbucks icon alignment fix.
const indexHtml = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const serverJs = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');

assert.ok(indexHtml.includes('id="btn-toggle-loadout"'), 'inventory should include a loadout drawer toggle');
assert.ok(indexHtml.includes('id="inventory-loadout-panel"'), 'inventory should render loadout inside a collapsible drawer');
assert.ok(indexHtml.includes('function setInventoryLoadoutOpen(open)'), 'loadout drawer should have an explicit open/close controller');
assert.ok(indexHtml.includes('setInventoryLoadoutOpen(false);'), 'inventory should default to the collapsed loadout view');

assert.ok(indexHtml.includes('id="marketplace-menu"'), 'marketplace should be its own hub view');
assert.ok(indexHtml.includes('function showMarketplace()'), 'marketplace should have a dedicated open function');
assert.match(indexHtml, /#inventory-menu, #trade-up-menu, #marketplace-menu/, 'inventory, Trade Up, and marketplace should share the same hidden default state');

const inventoryMenuStart = indexHtml.indexOf('<div id="inventory-menu"');
const marketplaceMenuStart = indexHtml.indexOf('<div id="marketplace-menu"');
assert.ok(inventoryMenuStart >= 0 && marketplaceMenuStart > inventoryMenuStart, 'marketplace should be a sibling after inventory');
const inventoryMarkup = indexHtml.slice(inventoryMenuStart, marketplaceMenuStart);
assert.ok(!inventoryMarkup.includes('id="btn-open-marketplace"'), 'inventory should not include a marketplace shortcut button');
assert.ok(!inventoryMarkup.includes('id="market-list"'), 'market listings should not render inside inventory');
assert.ok(!inventoryMarkup.includes('class="market-panel"'), 'marketplace panel should not render inside inventory');

assert.match(indexHtml, /body\.experimental-ui #inventory-menu\.hub-embedded-view,\s*body\.experimental-ui #trade-up-menu\.hub-embedded-view,\s*body\.experimental-ui #marketplace-menu\.hub-embedded-view \{\s*top: 112px;[\s\S]*?left: 0;[\s\S]*?right: 0;[\s\S]*?bottom: 0;/, 'inventory, Trade Up, and marketplace should use the full hub surface under the nav');
assert.match(indexHtml, /\.mowbucks-line \{[^}]*display: inline-flex;[^}]*align-items: center;/, 'mowbucks text line should center-align the icon');
assert.match(indexHtml, /\.mowbucks-icon \{[^}]*display:block;[^}]*object-fit: contain;/, 'mowbucks icon should render as a centered image box');
assert.ok(indexHtml.includes('id="market-balance-amount"'), 'marketplace should show the player account balance');
assert.match(indexHtml, /function renderProfile\(s, name\)[\s\S]*?accountMowbucks = Math\.max[\s\S]*?renderMarketplaceBalance\(\)/, 'account stats should keep the marketplace balance current');
assert.match(indexHtml, /function playMarketplacePurchaseSfx\(\)[\s\S]*?linearRampToValueAtTime[\s\S]*?exponentialRampToValueAtTime/, 'confirmed purchases should use a smooth attack and release sound');
assert.match(indexHtml, /type === 'marketNotice'[\s\S]*?data\.ok && \(data\.purchase \|\| data\.balanceChanged\)[\s\S]*?if \(data\.purchase\) playMarketplacePurchaseSfx\(\)/, 'player listing purchases should only play sound after server confirmation');
assert.match(indexHtml, /type === 'caseBuyNotice'[\s\S]*?if \(data\.ok\)[\s\S]*?playMarketplacePurchaseSfx\(\)/, 'direct case purchases should only play sound after server confirmation');
// The message is now conditional because a gifted purchase names the recipient
// instead, but the buyer-facing purchase flag and the plain-purchase wording are
// the things this has always guarded, and both still have to be there.
assert.match(serverJs, /marketNotice', \{\s*ok: true, purchase: true, listing,\s*message: giftName \? .+ : 'Purchase complete\.'/, 'skin purchase confirmations should be explicitly identified for the buyer');
assert.match(serverJs, /marketNotice', \{ ok: true, purchase: true, listing, message: gifted \? .+ : 'Case purchase complete\.' \}/, 'case resale purchase confirmations should be explicitly identified for the buyer');
assert.ok(indexHtml.includes('Showcased Listing'), 'hub should label the featured marketplace deal clearly');
assert.ok(indexHtml.includes('id="hub-featured-prices"'), 'showcased listing should display historical and current prices');
assert.match(indexHtml, /function openFeaturedMarketListing\(\)[\s\S]*?marketFocusedItemId = featured\.item_id[\s\S]*?showMarketplace\(\)/, 'showcased item should open its matching marketplace listings');
assert.match(indexHtml, /function renderInventory\(\)[\s\S]*?const meta = \[item\.weapon, rarityMeta, wearRatingName\(item\)\]/, 'inventory cards should only show weapon, rarity, and wear class metadata');
assert.match(indexHtml, /function renderMarketListings\(data = marketData\)[\s\S]*?item\.weapon \|\| 'Skin'[\s\S]*?wearRatingName\(item\)/, 'market cards should use the same concise weapon, rarity, and wear-class metadata');
assert.match(indexHtml, /function renderMarketHistory\(\)[\s\S]*?MARKET_WEAR_COLORS[\s\S]*?wearGroups[\s\S]*?trendLines[\s\S]*?trendDots/, 'market history should aggregate one skin while drawing separate wear-class trend lines and points');
assert.match(indexHtml, /function listOwnedCaseForSale\(\)[\s\S]*?marketVisible !== false[\s\S]*?marketCreateCaseListing/, 'hidden owned cases should be listable from the case inspector');

console.log('inventory-hub-ui: inventory drawer, standalone marketplace, removed inventory shortcut, and mowbucks alignment verified.');
