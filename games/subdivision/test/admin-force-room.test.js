'use strict';

// An admin overriding a room's mode or map size from outside the host seat.
//
// This hands one account control over everyone else's match, so the checks here
// are less about "does it work" than about the ways it could be abused or could
// leave a room in a state nothing else expects.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const antiflood = fs.readFileSync(path.join(root, 'antiflood.js'), 'utf8');

const handler = server.match(/function handleAdminForceRoomSettings\(client, room, data = \{\}\) \{[\s\S]*?\n\}/u)[0];

// --- authority --------------------------------------------------------------

test('the role comes from the socket, and it is the first thing checked', () => {
  assert.match(handler, /^function handleAdminForceRoomSettings\(client, room, data = \{\}\) \{\s*\n\s*if \(!isAdminUser\(client\) \|\| !room\) return;/u);
  // Never from the packet - a forged flag must buy nothing.
  for (const field of ['data.isAdmin', 'data.role', 'data.admin', 'data.accountRole']) {
    assert.ok(!handler.includes(field), `${field} must never be trusted`);
  }
});

test('the packet is routed and rate limited like other admin endpoints', () => {
  assert.match(server, /if \(type === 'adminForceRoomSettings'\) \{\s*\n\s*handleAdminForceRoomSettings\(client, room, data\);/u);
  const limit = /adminForceRoomSettings: \{ ratePerSec: (\d+(?:\.\d+)?), burst: (\d+) \}/u.exec(antiflood);
  assert.ok(limit, 'it has its own bucket');
  // Forcing respawns everyone and rebroadcasts the room; human-click pace only.
  assert.ok(Number(limit[1]) <= 1, `${limit[1]}/sec is too fast for something this disruptive`);
  assert.ok(Number(limit[2]) <= 3, `a burst of ${limit[2]} is too generous`);
});

// --- what it may set --------------------------------------------------------

test('only a real mode can be forced', () => {
  assert.match(handler, /VALID_GAMEMODES\.has\(requestedMode\)/u);
  assert.match(handler, /sanitizeRoomSettings\(\{/u, 'and it still goes through the shared sanitizer');
});

test('nothing happens when nothing was asked for', () => {
  assert.match(handler, /if \(!changingMode && !changingMap\) return;/u);
});

test('a queued mode cannot quietly undo the override', () => {
  // Leaving nextGamemode set would let the next round revert it, which reads as
  // the force having silently failed.
  assert.match(handler, /nextGamemode: null,/u);
});

// --- leaving the room in a coherent state -----------------------------------

test('entering a team mode rebalances the teams', () => {
  // Otherwise everyone stays on whichever side a free-for-all left them.
  assert.match(handler, /if \(MODE_CONFIG\[room\.settings\.gamemode\]\?\.teams && !wasTeams\) rebalanceTeams\(room\);/u);
});

test('a Containment run is torn down on the way out', () => {
  // Its wave director, gates and breach catalog are mode-owned. Carried into a
  // PvP mode they would leave a horde simulating inside a deathmatch.
  for (const field of ['room.containment = null;', 'room.containmentSpawns = null;', 'room.containmentSpawnCatalog = null;']) {
    assert.ok(handler.includes(field), `${field} should be cleared`);
  }
});

test('the whole room is resynced rather than just the settings', () => {
  // Team assignment and spawn scaling both just moved under the players' feet,
  // so this reuses the map-switch path: rescale, reset, respawn, rebroadcast.
  assert.match(handler, /switchRoomMap\(roomCode, room, room\.settings\.mapId, 'mapChanged', \{ forced: true \}\);/u);
  assert.match(handler, /broadcastRoomList\(\);/u, 'and the lobby browser is refreshed');
});

test('every use is audited', () => {
  assert.match(handler, /console\.warn\(\s*\n?\s*`\[admin-room\] \$\{client\.accountId\} forced/u);
});

// --- the client -------------------------------------------------------------

test('an admin can reach host controls in a room they do not host', () => {
  assert.match(client, /const canConfigure = isHost \|\| isAdminRoom \|\| accountIsAdmin;/u);
});

test('the force controls are admin-only in the UI', () => {
  // Presentation only - the server checks the socket regardless - but a control
  // an ordinary player can press and watch do nothing is worse than no control.
  assert.match(client, /getElementById\('host-admin-actions'\)\.style\.display = accountIsAdmin \? 'block' : 'none'/u);
  assert.match(client, /id="admin-force-mode-select"/u);
  assert.match(client, /id="btn-admin-force-map"/u);
});

test('the force buttons send the force packet, not the host one', () => {
  assert.match(client, /sendPacket\('adminForceRoomSettings', \{ gamemode \}\);/u);
  assert.match(client, /sendPacket\('adminForceRoomSettings', \{ fullMap: !currentRoomSettings\.fullMap \}\);/u);
  // The host's own control still queues, and is left alone.
  assert.match(client, /sendHostSettings\(\{ nextGamemode: hostModeSelect\.value \}\);/u);
});

test('a full-map-only map is refused before the packet is sent', () => {
  assert.match(client, /if \(FULL_MAP_ONLY_IDS\.has\(currentRoomSettings\.mapId\)\) \{\s*\n\s*flashToast\('This map is full-map only\.'\);/u);
});
