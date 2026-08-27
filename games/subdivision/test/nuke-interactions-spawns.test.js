// Last updated: 4 August 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const maps = require('../maps');
const { loadMapCollision } = require('../mapCollision');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const importer = fs.readFileSync(path.join(ROOT, 'scripts', 'import-goldsrc-map.js'), 'utf8');

assert.strictEqual(maps.NUKE_LADDERS.length, 4, 'all shipped Nuke ladder components should be authored');
assert.strictEqual(maps.NUKE_VENTS.length, 6, 'all shipped Nuke vent covers should be authored');
assert.ok(maps.SPAWN_SETS.nuke.points.length >= 32, 'Nuke full-map play should have a distributed spawn pool');
assert.ok(maps.SPAWN_SETS.nuke.points.filter(point => point.halfMap === false).length >= 12, 'Nuke should add full-map-only spawn candidates');
assert.ok(maps.ADMIN_TELEPORTS.nuke.A.yHint > maps.ADMIN_TELEPORTS.nuke.B.yHint, 'Nuke A and B teleports should target different vertical levels');
assert.deepStrictEqual(
  [maps.ADMIN_TELEPORTS.nuke.A.x, maps.ADMIN_TELEPORTS.nuke.A.z],
  [187, 213.4],
  'Nuke A should use the upper BSP bomb-target center'
);
assert.deepStrictEqual(
  [maps.ADMIN_TELEPORTS.nuke.B.x, maps.ADMIN_TELEPORTS.nuke.B.z],
  [178.2, 248.6],
  'Nuke B should use the lower BSP bomb-target center'
);

assert.match(html, /function installBreakableVentMesh[\s\S]*?breakableVentId: definition\.id/, 'real vent-cover faces should become addressable breakable meshes');
assert.match(html, /function breakVentCover[\s\S]*?mapObjects = mapObjects\.filter/, 'broken vents should leave movement and bullet collision');
assert.match(html, /function standingMovementCrossesBrokenVent[\s\S]*?if \(crouching[\s\S]*?brokenVentIds/, 'standing players should be blocked at broken vent openings while crouched players can pass');
assert.match(html, /function nukeLadderAtWorldPosition[\s\S]*?function ladderClimbDirection/, 'ladder volumes should drive local climb input');
assert.match(html, /climbingLadder[\s\S]*?velocity\.y = ladderDirection \* 46/, 'active ladders should replace gravity with climb velocity');
assert.match(html, /if \(climbingLadder\) playerPos\.y \+= velocity\.y \* delta;\s*else movePlayerVertically/, 'authored ladder shafts should not be blocked by the normal standing ceiling footprint');
assert.match(html, /function shouldDismountNukeLadderAtTop[\s\S]*?contact\.feetY >= contact\.ladder\.max\[1\] - topThreshold/, 'ladder traversal should detect the real top from player feet');
assert.match(html, /function findNukeLadderDismount[\s\S]*?intersectMapObjects\(floorRay\)[\s\S]*?intersectMapObjects\(ceilingRay\)[\s\S]*?intersectMapObjects\(pathRay\)/, 'top dismount should require a walkable, clear, directly reachable ledge through accelerated map collision');
assert.match(html, /function beginNukeLadderDismount[\s\S]*?ladderDismountUntil = time \+ 700[\s\S]*?position\.copy\(target\)[\s\S]*?velocity\.set\(0, 0, 0\)/, 'top dismount should place the player on the selected ledge without immediate reattachment');
assert.match(html, /function startJump[\s\S]*?nukeLadderOutwardNormal[\s\S]*?position\.addScaledVector\(away, 12\)/, 'jumping off a ladder should move away from its real plane instead of a fixed world direction');
assert.match(html, /if \(!climbingLadder && onFloor && jumpGraceTimer <= 0/, 'descending a ladder should not be snapped back onto the top floor');
assert.match(html, /stage === 'top-down'[\s\S]*?moveBackward = stage === 'top-down'/, 'browser QA should exercise entering and descending from the top of every ladder');
assert.match(html, /nukeLadderContact\(controls\.getObject\(\)\.position, moveForward \|\| moveBackward \? 10 : 4\)/, 'idle players should release the ladder instead of remaining magnetized by the broad climb-entry volume');
assert.match(html, /let ladderDismountUntil = 0;/, 'ladder movement cooldown state should exist before the frame loop reads it');
assert.match(html, /if \(localAdminMapTestId\) \{[\s\S]*?mapId: localAdminMapTestId[\s\S]*?currentRoomSettings = normalizeRoomSettings\(settings\)/, 'local map QA should remain on the requested map when default room settings arrive');
assert.match(html, /window\.__setNukeLadderQa[\s\S]*?window\.__jumpNukeLadderQa[\s\S]*?window\.__readNukeLadderMotionQa[\s\S]*?window\.__stopNukeLadderQa/, 'local browser QA should exercise climb, jump, and dismount state');
assert.match(html, /localLadderCycleTest[\s\S]*?cycle < 3[\s\S]*?action: 'up'[\s\S]*?action: 'down'[\s\S]*?action: 'top-exit'[\s\S]*?action: 'jump-exit'/, 'browser QA should repeat every ladder entry and exit path three times');
assert.match(html, /interactiveDoorId\) hit\.object\.attach\(decal\)/, 'bullet marks should remain attached to moving door leaves');
assert.match(html, /animationDurationMs: 620[\s\S]*?const eased = t \* t \* \(3 - 2 \* t\)/, 'door leaves should use a smooth time-based animation');
assert.match(html, /function maskedMapTextureWithoutColorFringe[\s\S]*?source\[neighbor \+ 3\] !== 0/, 'masked map textures should dilate opaque edge color into transparent texels');
assert.ok(
  html.indexOf('const maskedMapTextureCache = new WeakMap();') < html.indexOf('init();'),
  'masked texture cache must initialize before init starts asynchronous map loading'
);
assert.ok(
  html.indexOf('const MAP_GLASS_OPACITY = 0.30;') < html.indexOf('init();')
    && html.indexOf('const MIRAGE_BREAKABLE_WINDOWS = window.GameMaps?.MIRAGE_BREAKABLE_WINDOWS || [];') < html.indexOf('init();'),
  'all map-material constants must initialize before init starts asynchronous map loading'
);
assert.match(importer, /function dilateTransparentRgb[\s\S]*?group\.texture\.name\.startsWith\('\{'\)/, 'future BSP imports should preserve fringe-free masked textures');

assert.match(server, /function handleVentBreak[\s\S]*?room\.brokenVentIds\.add\(ventId\)[\s\S]*?'ventBreak'/, 'the server should validate and synchronize vent breaks');
assert.match(server, /ignoredVents: room\.brokenVentIds/, 'broken vents should no longer block authoritative LOS');
assert.match(server, /mapCollision\.onLadder\?\.\(pos\.x, pos\.y, pos\.z\)/, 'legitimate ladder climbing should not be reported as flying');
assert.match(server, /gameMaps\.ADMIN_TELEPORTS\?\.\[mapId\]\?\.\[siteId\]/, 'admin site teleports should use the active map coordinates');
assert.match(server, /const SPAWN_EYE_OFFSET = 18;/, 'server grounding should match the browser standing eye height');

(async () => {
  const def = maps.MAP_DEFS.nuke;
  const collision = await loadMapCollision(path.join(ROOT, def.collisionPath), def.scale);
  assert.deepStrictEqual([...collision.ventIds].sort(), maps.NUKE_VENTS.map(vent => vent.id).sort(), 'server collision should identify every shipped vent cover');
  for (const ladder of maps.NUKE_LADDERS) {
    const center = ladder.center.map(value => value * def.scale);
    assert.ok(collision.onLadder(...center), `${ladder.id} should be climbable at its authored center`);
  }
  const siteFloors = Object.fromEntries(Object.entries(maps.ADMIN_TELEPORTS.nuke).map(([id, site]) => [
    id,
    collision.walkableGroundY(site.x, site.z, site.yHint)
  ]));
  assert.ok(Number.isFinite(siteFloors.A) && Number.isFinite(siteFloors.B), 'both Nuke site teleports should ground onto real geometry');
  assert.ok(siteFloors.A - siteFloors.B > 80, 'Nuke A and B should resolve to distinct stacked floors');
  console.log('nuke-interactions-spawns: doors, vents, ladders, fence alpha, sites, and full-map spawns verified.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
