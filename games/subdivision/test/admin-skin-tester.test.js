const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('admin room exposes a catalogue-backed skin tester', () => {
  assert.match(client, /id="admin-skin-weapon"/);
  assert.match(client, /id="admin-skin-item"/);
  assert.match(client, /id="btn-admin-test-skin"/);
  assert.match(client, /function adminSkinItemsForWeapon\(weapon\)[\s\S]*?skinInventoryState\.catalog\?\.items/);
  assert.match(client, /sendPacket\('adminTestSkin', \{ weapon, itemId \}\)/);
});

test('selected test skins override rendering without changing inventory loadouts', () => {
  assert.match(client, /const adminTestSkinOverrides = new Map\(\)/);
  // The same override map also backs the localhost dev console, so the gate is
  // "admin room OR dev console" rather than the admin room alone. What matters
  // is that it stays gated - an ungated read here would let any client render
  // any skin - so the assertion pins both halves instead of the exact spelling.
  assert.match(client, /function equippedSkinItem\(weaponName\) \{[\s\S]{0,400}?if \(\(isAdminRoom \|\| devConsole\.enabled\) && adminTestSkinOverrides\.has\(weaponName\)\)/);
  assert.match(client, /const devConsole = \{\s*enabled: localTestHost,/,
    'the dev console half of that gate should be localhost-only');
  assert.match(client, /adminTestSkinOverrides\.clear\(\)/);
  assert.doesNotMatch(client.match(/function applyAdminTestSkin\(\)[\s\S]*?\n        \}/)?.[0] || '', /equipSkin|inventoryId/);
});

test('server validates and broadcasts admin-room skin tests', () => {
  const handler = server.match(/if \(type === 'adminTestSkin'\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(handler, /client\.roomCode !== ADMIN_ROOM_CODE \|\| !isAdminUser\(client\)/);
  assert.match(handler, /skins\.getItem\(itemId\)/);
  assert.match(handler, /item\.weapon !== weapon/);
  assert.match(handler, /effectiveClientSkinLoadout\(client\)/);
  assert.match(handler, /broadcastToRoom\(client\.roomCode, client\.id, 'playerSkinLoadout'/);
  assert.match(handler, /send\(client, 'adminTestSkinResult'/);
});

test('admin skin overrides are room-scoped and preserve saved loadouts', () => {
  assert.match(server, /client\.adminSkinOverrides = \{\};\s*const player = makePlayer/);
  assert.match(server, /function effectiveClientSkinLoadout\(client\)[\s\S]*?const result = \{ \.\.\.\(client\?\.skinLoadout \|\| \{\}\) \}/);
  assert.match(server, /if \(skinRef\) result\[weapon\] = \{ \.\.\.skinRef \};\s*else delete result\[weapon\]/);
});
