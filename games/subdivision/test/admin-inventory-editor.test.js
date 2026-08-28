'use strict';

// The admin inventory editor: add cases, add skins, set wear, remove either.
//
// Two things make this dangerous in a way the other admin tools are not. It
// mints and destroys items that have real value on the market, and a
// skin_inventory row is not free-standing - an active listing holds its id, a
// pending friend trade names it inside a JSON payload, and a loadout row
// references it. Deleting one behind their backs leaves a listing nobody can
// buy and a loadout pointing at nothing.
//
// So what is checked here is the boundary: that only admins reach it, that ids
// are validated against the catalog rather than trusted, and that removal
// unwinds every commitment in one transaction.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const db = fs.readFileSync(path.join(root, 'db.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const limits = fs.readFileSync(path.join(root, 'antiflood.js'), 'utf8');

const handler = (() => {
  const start = server.indexOf('function handleAdminInventoryEdit');
  assert.notEqual(start, -1, 'the edit handler exists');
  const end = server.indexOf('function liveDailyRows');
  assert.ok(end > start, 'and the section boundary is real');
  return server.slice(start, end);
})();

const setWearSource = db.slice(db.indexOf('async function adminSetSkinWear'), db.indexOf('async function adminRemoveSkinInstance'));
const removeSource = db.slice(db.indexOf('async function adminRemoveSkinInstance'), db.indexOf('async function adminRemoveCases'));

test('the slices below are real, or the assertions using them mean nothing', () => {
  // A slice that silently collapses turns every "must not appear" check into a
  // pass. Bound them at both ends rather than trusting the anchors.
  for (const [name, text, min, max] of [
    ['edit handler', handler, 2_000, 12_000],
    ['adminSetSkinWear', setWearSource, 400, 3_000],
    ['adminRemoveSkinInstance', removeSource, 1_500, 8_000]
  ]) {
    assert.ok(text.length > min, `${name} slice is too short to be the real function (${text.length})`);
    assert.ok(text.length < max, `${name} slice ran past its end (${text.length})`);
  }
});

test('both packets are admin-gated at the dispatch', () => {
  // The handlers assume an admin and never re-check, so the gate has to be
  // here. A missing one would let any client read and edit any inventory.
  for (const type of ['adminInventoryLookup', 'adminInventoryEdit']) {
    const dispatch = server.match(
      new RegExp(`if \\(type === '${type}'\\) \\{\\s*\\n\\s*if \\(!isAdminUser\\(client\\)\\) return;`, 'u')
    );
    assert.ok(dispatch, `${type} must be gated on isAdminUser`);
  }
});

test('item and case ids are validated against the catalog, never trusted', () => {
  // The catalog is the allowlist. A packet naming a skin or case that does not
  // exist must not reach the database.
  assert.match(handler, /const item = skins\.getItem\(String\(data\.itemId \|\| ''\)\.trim\(\)\);\s*\n\s*if \(!item\) \{/u);
  assert.match(handler, /if \(!customCases\.some\(row => row\.id === caseId\)\) \{/u);
  // And the id written is the catalog's, not the packet's.
  assert.match(handler, /itemId: item\.id,/u);
});

test('an unknown action does nothing at all', () => {
  // Without the final else, an unrecognised action would fall through to the
  // audit log and the snapshot as though something had happened.
  assert.match(handler, /\} else \{\s*\n\s*adminInventoryFail\(client, 'Unknown inventory action\.'\);\s*\n\s*return;/u);
});

test('quantities are clamped rather than taken as given', () => {
  assert.match(handler, /Math\.max\(1, Math\.min\(1000, Math\.floor\(Number\(data\.quantity\) \|\| 1\)\)\)/u);
});

test('wear is clamped to 0..1 wherever it enters', () => {
  // The column has a CHECK constraint, so an unclamped value is a 500 rather
  // than a corruption - but the grant path would still have inserted junk.
  assert.match(db, /const wear = Math\.max\(0, Math\.min\(1, Number\(wearValue\)\)\);/u);
  assert.match(db, /const wearValue = Number\.isFinite\(asked\) \? Math\.max\(0, Math\.min\(1, asked\)\) : Math\.random\(\);/u);
});

test('wear cannot be changed on an item someone else has a claim to', () => {
  // Changing the wear of a listed or mid-trade skin changes what the buyer or
  // counterparty agreed to buy.
  const setWear = setWearSource;
  assert.match(setWear, /const locked = skinEditLockReason\(row\);\s*\n\s*if \(locked\) return \{ ok: false, reason: locked \};/u);
  assert.match(db, /function skinEditLockReason\(row\) \{[\s\S]*?if \(row\.listed\) return 'listed';[\s\S]*?if \(row\.pendingTrade\) return 'trading';/u);
  // Equipping is not a claim by anyone else, so it must not block the edit.
  assert.doesNotMatch(setWear, /equippedOn/u);
});

test('removing a skin unwinds every commitment, in one transaction', () => {
  const remove = removeSource;
  // Ordered: lock the row, refund live bids, cancel the listing, cancel any
  // trade naming it, drop the loadout reference, then delete.
  assert.match(remove, /BEGIN[\s\S]*?FOR UPDATE[\s\S]*?mowbucks = stats\.mowbucks \+ EXCLUDED\.mowbucks[\s\S]*?UPDATE skin_market_listings SET status = 'cancelled'[\s\S]*?UPDATE skin_trade_requests SET status = 'cancelled'[\s\S]*?DELETE FROM skin_loadouts[\s\S]*?DELETE FROM skin_inventory[\s\S]*?COMMIT/u);
  assert.match(remove, /ROLLBACK/u, 'a failure part-way must not leave the account half-edited');
  // Pending trades name inventory ids inside JSON, so they cannot be matched
  // in SQL and have to be read back and filtered.
  assert.match(remove, /pendingTradeInventoryIds\(\[row\]\)\.has\(id\)/u);
});

test('a bidder on a cancelled auction is made whole', () => {
  const remove = removeSource;
  assert.match(remove, /listing_type = 'auction' AND highest_bidder_id IS NOT NULL/u);
  assert.match(remove, /refunded \+= Number\(row\.price \|\| 0\);/u);
  // And the admin is told, because they may not have known it was listed.
  assert.match(handler, /if \(result\.refunded\) extra\.push\(`\$\{result\.refunded\} refunded to bidders`\)/u);
});

test('the snapshot reports why an item is locked, so display and rule agree', () => {
  const snapshot = db.slice(db.indexOf('async function adminInventorySnapshot'), db.indexOf('function skinEditLockReason'));
  for (const field of ['listed:', 'pendingTrade:', 'equippedOn:']) {
    assert.ok(snapshot.includes(field), `${field} should be computed server-side`);
  }
  // Computed from the live tables rather than inferred from the row itself.
  assert.match(snapshot, /FROM skin_market_listings\s*\n\s*WHERE seller_id = \$1 AND status = 'active'/u);
  assert.match(snapshot, /FROM skin_trade_requests\s*\n\s*WHERE status = 'pending'/u);
});

test('the target sees the change immediately if they are online', () => {
  // Otherwise a player could act on an inventory list that no longer exists -
  // listing a skin an admin just deleted, for instance.
  assert.match(server, /const target = findClientByAccountId\(String\(account\.id\)\);\s*\n\s*if \(target\) sendSkinInventory\(target\);/u);
});

test('every edit is logged with who did it and to whom', () => {
  assert.match(handler, /console\.log\(`\[admin-inventory\] \$\{client\.username\} \$\{action\} on \$\{account\.username\}/u);
  assert.match(handler, /event: 'admin_inventory_edit'/u);
});

test('both packets are rate limited', () => {
  assert.match(limits, /adminInventoryLookup: \{ ratePerSec: [\d.]+, burst: \d+ \}/u);
  assert.match(limits, /adminInventoryEdit: \{ ratePerSec: [\d.]+, burst: \d+ \}/u);
});

// --- client ----------------------------------------------------------------

test('the panel is admin-only and joins the normal overlay lifecycle', () => {
  assert.match(html, /id="btn-owner-inventory-editor"[^>]*style="display:none;"/u,
    'hidden until the account is known to be an admin');
  assert.match(html, /document\.getElementById\('btn-owner-inventory-editor'\)\.style\.display = adminOnly;/u);
  assert.match(html, /function showInventoryEditor\(from = 'title'\) \{\s*\n\s*if \(!accountIsAdmin && !accountIsOwnerAdmin\) return;/u);
  // Registered with the other hub panels, or it would survive closing the menu.
  assert.match(html, /hubPanels\(\)[\s\S]*?document\.getElementById\('inventory-editor-menu'\)/u);
});

test('edits are addressed by account id, not by whatever is in the name box', () => {
  // The username field is only used for the initial lookup. If actions read it
  // live, editing the box mid-session would silently retarget the next edit.
  assert.match(html, /function invEditorSend\(action, payload\) \{[\s\S]*?accountId: invEditorState\.account\.id, action/u);
  assert.match(html, /if \(!invEditorState\.account\) return;/u);
});

test('the panel renders only what the server sent back', () => {
  // No optimistic local mutation: every action re-reads the snapshot, so the
  // list cannot drift from the database.
  assert.match(html, /function applyInventoryEditorData\(data\) \{[\s\S]*?skins: Array\.isArray\(data\.skins\) \? data\.skins : \[\]/u);
  assert.match(html, /type === 'adminInventoryData'\) \{\s*\n\s*applyInventoryEditorData\(data \|\| \{\}\);/u);
});

test('locked items are shown but not editable, with the reason visible', () => {
  assert.match(html, /wear\.disabled = row\.listed \|\| row\.pendingTrade;/u);
  assert.match(html, /save\.disabled = wear\.disabled;/u);
  assert.match(html, /badge\.className = 'inv-editor-lock';/u);
  // Removal stays available - clearing up a stuck listing is the usual reason
  // an admin is here at all.
  assert.match(html, /remove\.textContent = 'Remove';[\s\S]*?invEditorSend\('removeSkin', \{ inventoryId: row\.id \}\)/u);
});

test('a blank wear box means roll it, not zero', () => {
  // Number('') is 0, which would silently make every added skin factory new.
  assert.match(html, /raw === ''\s*\n\s*\? \{ itemId: entry\.id \}\s*\n\s*: \{ itemId: entry\.id, wear: Number\(raw\) \}/u);
});
