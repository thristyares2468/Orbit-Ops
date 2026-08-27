// Last updated: 17 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const maps = require(path.join(ROOT, 'maps'));
const { loadMapCollision } = require(path.join(ROOT, 'mapCollision'));

assert.match(
  html,
  /function audioChannelVolume\(channel = 'effects'\)[\s\S]*?channel === 'gunfire'\) return gunVolume;/,
  'gunfire should have its own channel gain'
);
assert.match(
  html,
  /function soundShoot\([\s\S]*?spatial\.channel = 'gunfire';[\s\S]*?playSfxSample\([\s\S]*?'gunfire', spatial\)/,
  'firearm samples should route through the gunfire slider'
);
assert.match(html, /volumeScale: 1\.12,[\s\S]*?cooldownKey: 'bullet:glass'/, 'glass impacts should use the louder requested gain');

assert.match(html, /function installBreakableGlassMesh[\s\S]*?breakableGlassPaneId: paneId/, 'Nuke glass should be split into individually addressable panes');
assert.match(html, /function breakablePanePrefix\(material\)[\s\S]*?currentMapId === 'nuke'\) return 'nuke-glass'/, 'client breakable panes should use the same stable Nuke prefix as authoritative collision');
assert.match(html, /function breakGlassPane[\s\S]*?pane\.parent\.remove\(mesh\)[\s\S]*?mapObjects = mapObjects\.filter/, 'broken panes should leave rendering and movement collision');
assert.match(html, /if \(!pane\) \{[\s\S]*?pendingBrokenGlassPaneIds\.add\(id\)/, 'glass breaks received during map loading should be applied when the pane installs');
assert.match(html, /function spawnBreakableGlassShards[\s\S]*?glassShards\.push/, 'broken panes should create falling shards');
assert.match(html, /function resetBreakableGlass[\s\S]*?pendingBrokenGlassPaneIds\.clear\(\)[\s\S]*?restoreGlassPane[\s\S]*?clearGlassShards/, 'round reset should restore panes, clear pending breaks, and remove shards');
assert.match(server, /function handleGlassBreak[\s\S]*?room\.brokenGlassPanes\.add\(paneId\)[\s\S]*?broadcastToRoom\([^\n]*'glassBreak'/, 'the server should synchronize validated glass breaks');
assert.match(server, /mapCollision\?\.glassPaneIds\?\.includes\(paneId\)[\s\S]*?distanceFromSegment\(position, shot\.start, shot\.target\) <= 4/, 'glass break packets should name a shipped pane on the matching recent bullet path');
assert.match(server, /function scheduleRoomBreakableGlassReset[\s\S]*?resetRoomBreakableGlass/, 'the server should restore breakable glass at the next round start');
assert.match(server, /ignoredGlassPanes: room\.brokenGlassPanes/, 'server line-of-sight should ignore only shattered panes');

assert.match(html, /if \(!controls\.isLocked \|\| isDead \|\| mvpCameraInputLocked\) return;/, 'mouse look should stop during MVP presentation');
assert.match(html, /function showMvpScreen[\s\S]*?mvpCameraInputLocked = true;[\s\S]*?startMvpPreview/, 'MVP presentation should lock camera input before staging');
assert.match(html, /function hideMvpScreen[\s\S]*?stopMvpPreview\(\);[\s\S]*?mvpCameraInputLocked = false;/, 'closing MVP presentation should restore camera input');

(async () => {
  const def = maps.MAP_DEFS.nuke;
  const collision = await loadMapCollision(path.join(ROOT, def.collisionPath), def.scale);
  assert.deepStrictEqual(
    collision.glassPaneIds,
    Array.from({ length: 3 }, (_, index) => `nuke-glass-${index}`),
    'the shipped Nuke mesh should resolve to the same three static pane IDs after interactive door glass is excluded'
  );
  console.log('breakable-glass-camera-audio: panes, shards, reset, LOS, MVP camera lock, and gunfire routing verified.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
