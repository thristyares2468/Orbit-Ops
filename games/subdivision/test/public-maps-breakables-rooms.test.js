// Last updated: 13 August 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const maps = require('../maps');
const { loadMapCollision } = require('../mapCollision');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

assert.deepStrictEqual(maps.PUBLIC_MAP_IDS, ['dust2', 'nuke', 'inferno', 'mirage'], 'Inferno and Mirage should ship in the public pool');
for (const mapId of ['inferno', 'mirage']) {
  assert.ok(maps.SPAWN_SETS[mapId].points.length >= 38, `${mapId} should include distributed public spawns beyond the source team rooms`);
  assert.ok(maps.SPAWN_SETS[mapId].points.some(point => point.id >= 32 && !point.halfOnly), `${mapId} should include route-level full-map spawn candidates`);
}
assert.match(html, /MIRAGE_BREAKABLE_WINDOWS/, 'Mirage breakables should use authored coordinate bounds');
assert.match(html, /materials\.some\(isMirageBreakableWindowMaterial\)\) breakableGlassSources\.push\(mesh\)/, 'Mirage breakable surfaces should enter the synchronized pane runtime');
assert.match(server, /\[MAP_NUKE, 'mirage'\]\.includes\(getRoomMapId\(room\)\)/, 'the server should authorize synchronized pane breaks on Mirage');
assert.match(server, /function getRoomList\(\)[\s\S]*?room\.players\.size > 0/, 'the public server browser should omit empty reconnect-held rooms');
assert.match(server, /broadcastToRoom\(roomCode, client\.id, 'playerJoined'[\s\S]*?broadcastRoomList\(\)/, 'public server counts should refresh after joins');
assert.match(server, /if \(room\.players\.size === 0\)[\s\S]*?broadcastRoomList\(\);[\s\S]*?return;/, 'public servers should disappear promptly when their last player leaves');

(async () => {
  const definition = maps.MAP_DEFS.mirage;
  const collision = await loadMapCollision(path.join(ROOT, definition.collisionPath), definition.scale);
  const miragePaneIds = collision.glassPaneIds.filter(id => id.startsWith('mirage-window-'));
  assert.deepStrictEqual(miragePaneIds.sort(), [
    'mirage-window-boarded',
    'mirage-window-boarded-crates',
    'mirage-window-louvered',
    'mirage-window-louvered-high',
    'mirage-window-louvered-low'
  ], 'only the five pictured Mirage inserts should receive synchronized pane ids');
  console.log('public-maps-breakables-rooms: public maps, Mirage breakables, distributed spawns, and live room-list refreshes verified.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
