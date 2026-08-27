// Last updated: 13 August 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const maps = require(path.join(ROOT, 'maps'));
const { loadMapCollision } = require(path.join(ROOT, 'mapCollision'));
const { surfaceTypeForTextureName } = require(path.join(ROOT, 'scripts/import-goldsrc-map'));
const VALID_FOOTSTEP_SURFACES = new Set([
  'concrete', 'wood', 'metal', 'metal_grate', 'dirt', 'mud', 'grass',
  'gravel', 'sand', 'tile', 'glass', 'carpet', 'rubber', 'wet', 'ladder'
]);

function downwardTriangleHit(origin, a, b, c) {
  const edgeA = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const edgeB = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p = [-edgeB[2], 0, edgeB[0]];
  const det = edgeA[0] * p[0] + edgeA[2] * p[2];
  if (Math.abs(det) < 1e-8) return null;
  const relative = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]];
  const u = (relative[0] * p[0] + relative[2] * p[2]) / det;
  if (u < 0 || u > 1) return null;
  const q = [
    relative[1] * edgeA[2] - relative[2] * edgeA[1],
    relative[2] * edgeA[0] - relative[0] * edgeA[2],
    relative[0] * edgeA[1] - relative[1] * edgeA[0]
  ];
  const v = -q[1] / det;
  if (v < 0 || u + v > 1) return null;
  const distance = (edgeB[0] * q[0] + edgeB[1] * q[1] + edgeB[2] * q[2]) / det;
  if (distance <= 0) return null;
  const normal = [
    edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
    edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
    edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0]
  ];
  const length = Math.hypot(...normal) || 1;
  return { distance, normalY: normal[1] / length };
}

function collectPrimitiveTriangles(document, mapScale) {
  const triangles = [];
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      assert.ok(primitive.getMaterial()?.getBaseColorTexture(), `${mesh.getName()} primitive should have a real tiled texture`);
      const extras = primitive.getMaterial()?.getExtras() || {};
      assert.ok(VALID_FOOTSTEP_SURFACES.has(extras.footstepSurface), `${primitive.getMaterial()?.getName()} should carry a footstep surface`);
      assert.match(String(extras.sourceArchive || ''), /^(?:embedded|wad:)/, `${primitive.getMaterial()?.getName()} should come from its BSP or an official WAD`);
      const positions = primitive.getAttribute('POSITION').getArray();
      const indices = primitive.getIndices()?.getArray();
      const count = indices ? indices.length / 3 : positions.length / 9;
      for (let triangle = 0; triangle < count; triangle++) {
        const ids = indices
          ? [indices[triangle * 3], indices[triangle * 3 + 1], indices[triangle * 3 + 2]]
          : [triangle * 3, triangle * 3 + 1, triangle * 3 + 2];
        triangles.push(ids.map(index => [
          positions[index * 3] * mapScale,
          positions[index * 3 + 1] * mapScale,
          positions[index * 3 + 2] * mapScale
        ]));
      }
    }
  }
  return triangles;
}

assert.deepStrictEqual(maps.ADMIN_MAP_IDS, ['nuke', 'inferno', 'vertigo', 'mirage'], 'the supplied maps should form the imported map catalog');
assert.deepStrictEqual(maps.PUBLIC_MAP_IDS, ['dust2', 'nuke', 'inferno', 'mirage'], 'Dust2, Nuke, Inferno, and Mirage should be the public map pool');
assert.deepStrictEqual(Object.keys(maps.HALF_MAP_RULES).sort(), ['inferno', 'mirage', 'nuke'], 'only Nuke, Inferno, and Mirage should define new half-map layouts');
assert.ok(!maps.HALF_MAP_RULES.vertigo, 'Vertigo should remain full-map only');
assert.strictEqual(maps.IMPORTED_MAP_SCALE, 22, 'imported maps should be ten percent larger than their original browser scale');
assert.strictEqual(
  surfaceTypeForTextureName('verylongtexture', new Map([['verylongtext', 'wood']])),
  'wood',
  'Valve material tags should match the first 12 texture-name characters'
);
assert.strictEqual(surfaceTypeForTextureName('{ladder3a'), 'ladder', 'ladder textures should retain their dedicated climb-footstep surface');
for (const mapId of maps.ADMIN_MAP_IDS) {
  const def = maps.MAP_DEFS[mapId];
  const spawns = maps.SPAWN_SETS[mapId];
  assert.strictEqual(def?.adminOnly, mapId === 'vertigo', `${mapId} should expose the intended public/admin visibility`);
  assert.ok(fs.existsSync(path.join(ROOT, def.collisionPath)), `${mapId} GLB should exist`);
  assert.strictEqual(fs.statSync(path.join(ROOT, def.collisionPath)).size, def.bytes, `${mapId} byte metadata should match its GLB`);
  assert.match(def.path, /\?v=2026-08-13-mirage-uv-breakables-v6$/, `${mapId} should cache-bust the corrected GLB`);
  assert.strictEqual(def.scale, maps.IMPORTED_MAP_SCALE, `${mapId} rendering should use the shared larger scale`);
  assert.ok(def.brightness > 1 && def.brightness < 1.2, `${mapId} should receive a restrained brightness lift`);
  assert.ok((def.background & 0xff) > ((def.background >> 16) & 0xff), `${mapId} should use a blue sky instead of a grey background`);
  assert.ok(def.bytes > 1000000, `${mapId} should carry a real converted map asset`);
  assert.ok(spawns.points.length >= 20, `${mapId} should preserve at least 20 authored spawns`);
  assert.ok(spawns.teams[0].length >= 10 && spawns.teams[1].length >= 10, `${mapId} should preserve both authored teams`);
  assert.ok(
    spawns.points.every(point => typeof point.halfMap === 'boolean' && Number.isFinite(point.yaw)),
    `${mapId} spawns should declare half-map eligibility and authored yaw`
  );
  if (mapId === 'nuke') {
    assert.ok(spawns.points.some(point => point.halfMap === false), 'Nuke should include supplemental full-map-only spawn coverage');
  }
}

for (const mapId of Object.keys(maps.HALF_MAP_RULES)) {
  const rule = maps.HALF_MAP_RULES[mapId];
  const spawns = maps.SPAWN_SETS[mapId];
  for (const team of [0, 1]) {
    const halfSpawns = spawns.teams[team].map(id => spawns.points[id]).filter(point => point.halfMap);
    assert.ok(halfSpawns.length >= 8, `${mapId} team ${team} should have a practical compact spawn pool`);
    for (const point of halfSpawns) {
      if (rule.type === 'wallX' && rule.keep === 'less') assert.ok(point.x < rule.x, `${mapId} half spawn ${point.id} should stay on the retained side`);
      if (rule.type === 'wallX' && rule.keep === 'greater') assert.ok(point.x > rule.x, `${mapId} half spawn ${point.id} should stay on the retained side`);
      if (rule.type === 'floor') assert.ok(point.y - 18 >= rule.top, `${mapId} half spawn ${point.id} should stay above the lower-level blocker`);
    }
  }
}
assert.ok(maps.SPAWN_SETS.inferno.points.some(point => point.halfOnly), 'Inferno should include compact-only CT starts near B');
assert.ok(maps.SPAWN_SETS.mirage.points.some(point => point.halfOnly), 'Mirage should include compact-only CT starts near A');

assert.ok(html.includes('<script src="/maps.js"></script>'), 'the client should load the shared map catalog');
assert.match(html, /PUBLIC_MAP_IDS = window\.GameMaps\?\.PUBLIC_MAP_IDS \|\| \[MAP_DUST2, 'nuke'\]/, 'the client should consume the shared public map pool');
assert.ok(html.includes('id="create-map-select"'), 'lobby creation should expose a public map selector');
assert.match(html, /VALID_MAP_IDS = new Set\(\[MAP_DUST2, MAP_BACKROOMS, \.\.\.ADMIN_MAP_IDS\]\)/, 'the client should accept admin catalog ids from room snapshots');
assert.match(html, /importedSpawnSet = window\.GameMaps\?\.SPAWN_SETS\?\.\[def\.id\]/, 'the client should select map-specific authored spawns');
assert.match(html, /localAdminMapTestId[\s\S]*?__readAdminMapQa/, 'localhost QA should exercise the real gameplay map loader and report canvas/ground state');
assert.match(html, /localAdminHalfMapTest[\s\S]*?applyRoomSettings\(\{ fullMap: !localAdminHalfMapTest, gamemode: 'deathmatch', mapId: localAdminMapTestId \}\)/, 'localhost QA should exercise both full and compact imported-map layouts');
assert.match(html, /FULL_MAP_ONLY_IDS = new Set\(\[MAP_BACKROOMS, 'vertigo'\]\)/, 'the client should leave only Backrooms and Vertigo full-map only');
assert.match(html, /function addMapCutoffWall[\s\S]*?rule\?\.type === 'floor'[\s\S]*?rule\?\.type === 'wallX'/, 'the client should construct both floor and wall compact-map blockers');
assert.match(html, /currentRoomSettings\.fullMap \? !point\?\.halfOnly : point\?\.halfMap !== false/, 'client spawning should keep compact-only points out of full matches');
assert.match(html, /alphaTest: glassPane \? 0 : \(maskedCutout \? Math\.max\(0\.5, Number\(material\.alphaTest\) \|\| 0\)/, 'baked map materials should retain masked texture cutouts outside transparent glass panes');
assert.match(html, /color\.multiplyScalar\(Math\.max\(0\.5, Number\(def\.brightness \|\| 1\)\)\)/, 'baked map materials should apply the map brightness setting');
assert.match(html, /next\.userData = \{[\s\S]*?\.\.\.\(material\.userData \|\| \{\}\)[\s\S]*?isGlassPane: glassPane/, 'map material metadata should survive the baked-material conversion');
assert.match(html, /const MAP_GLASS_OPACITY = 0\.30;/, 'map glass panes should render at thirty percent opacity');
assert.match(html, /function isGlassMapMaterial[\s\S]*?footstepSurface[\s\S]*?MAP_GLASS_OPACITY[\s\S]*?depthWrite: glassPane \? false/, 'all imported glass-classified materials should use transparent non-depth-writing rendering');
assert.match(html, /materialForRaycastHit[\s\S]*?footstepSurfaceAt[\s\S]*?footstepSfxBySurface\[surface\]/, 'footsteps should raycast the floor material and select its surface sound pool');
assert.match(html, /findGroundSpawnAt\(point\.x, point\.z, point\.y \+ 28\)/, 'authored multi-level spawns should probe near their intended elevation');
assert.match(html, /minimapVisible = isTDM\(\) && currentRoomSettings\.mapId === MAP_DUST2/, 'imported maps must not display the Dust2 minimap');
assert.match(server, /if \(client\.roomCode !== ADMIN_ROOM_CODE \|\| !isAdminUser\(client\)\) return;[\s\S]*?VALID_MAP_IDS\.has\(patch\.mapId\)/, 'only an authenticated admin-room member may switch to catalog maps');
assert.match(server, /requestedMapId = PUBLIC_MAP_SET\.has\(data\.mapId\) \? data\.mapId : MAP_DUST2/, 'ordinary lobby creation should only accept public maps');
assert.doesNotMatch(server, /if \(type === 'hostSettings'\)[\s\S]*?mapId:\s*settingsPatch\.mapId/, 'ordinary room hosts must not be able to switch maps');
assert.match(server, /MAP_COLLISION_PATHS = new Map[\s\S]*?ADMIN_MAP_IDS\.map[\s\S]*?scale: gameMaps\.MAP_DEFS\[id\]\.scale/, 'the server should load collision for every imported map at its render scale');
assert.match(server, /function getMapCollision\(roomOrMapId\)[\s\S]*?mapCollisions\.get\(mapId\)/, 'gameplay validation should select collision by room map');
assert.match(server, /SPAWN_GROUND_PROBE_UP = 28[\s\S]*?pt\.y \+ SPAWN_GROUND_PROBE_UP/, 'server spawn grounding should not raycast through upper floors');
assert.match(server, /FULL_MAP_ONLY_IDS = new Set\(\[MAP_BACKROOMS, 'vertigo'\]\)/, 'the server should leave only Backrooms and Vertigo full-map only');
assert.match(server, /function correctedHalfMapPosition[\s\S]*?rule\.type === 'floor'[\s\S]*?rule\.type === 'wallX'/, 'the server should correct players who cross a compact-map blocker');
assert.match(server, /halfMapSegmentBlocked\(room, shot\.start, target\.position\)/, 'synthetic compact-map blockers should participate in authoritative shot validation');
assert.match(server, /fullMap \? !pt\.halfOnly : pt\.halfMap/, 'server spawning should keep compact-only points out of full matches');

assert.match(html, /const INSPECT_VARIANT_COUNT = 3;/, 'every inspectable item should expose three animation variants');
assert.match(html, /function nextInspectVariant\(itemId\)[\s\S]*?state\.remaining = bag;[\s\S]*?state\.last = variant;/, 'inspect selection should cycle a shuffled bag containing every variant');
assert.match(html, /if \(bag\[0\] === state\.last\)[\s\S]*?\[bag\[0\], bag\[swapIndex\]\]/, 'inspect selection should avoid immediate repeats between shuffled bags');
assert.match(html, /const variant = nextInspectVariant\(variantId\);/, 'inspect should choose a variant for every weapon and utility');
assert.match(html, /function knifeSupportsAirToss[\s\S]*?case 'knifeAirToss':[\s\S]*?Math\.PI \* 4 \* tossT/, 'suitable knives should have a toss, spin, and catch animation');
assert.match(html, /p\.variant === 1[\s\S]*?p\.variant === 2/, 'the common pose sampler should make all three variants visibly distinct');

(async () => {
  const { NodeIO } = await import('@gltf-transform/core');
  for (const mapId of maps.ADMIN_MAP_IDS) {
    const glbPath = path.join(ROOT, maps.MAP_DEFS[mapId].collisionPath);
    const collision = await loadMapCollision(glbPath, maps.MAP_DEFS[mapId].scale);
    const document = await new NodeIO().readBinary(fs.readFileSync(glbPath));
    const glassMaterials = document.getRoot().listMaterials().filter(material => {
      const extras = material.getExtras() || {};
      return String(extras.footstepSurface || '').toLowerCase() === 'glass';
    });
    if (mapId === 'nuke') assert.ok(glassMaterials.length > 0, 'Nuke should retain its classified underground glass pane material');
    const triangles = collectPrimitiveTriangles(document, maps.MAP_DEFS[mapId].scale);
    assert.ok(collision.triCount > 10000, `${mapId} should contain full collision geometry`);
    for (const spawn of maps.SPAWN_SETS[mapId].points) {
      const walkableGround = collision.walkableGroundY(spawn.x, spawn.z, spawn.y + 28);
      assert.notStrictEqual(walkableGround, null, `${mapId} spawn ${spawn.id} should ground near its authored level`);
      let nearest = null;
      for (const triangle of triangles) {
        const hit = downwardTriangleHit([spawn.x, spawn.y + 28, spawn.z], ...triangle);
        if (hit && hit.normalY > 0.65 && (!nearest || hit.distance < nearest.distance)) nearest = hit;
      }
      assert.ok(nearest && nearest.normalY > 0.65, `${mapId} spawn ${spawn.id} should land on an upward walkable triangle`);
      assert.ok(Math.abs((spawn.y + 28 - nearest.distance) - walkableGround) < 0.01, `${mapId} spawn ${spawn.id} should use the same floor on client and server`);
    }
  }
  console.log('maps-inspect-variants: official textures, larger map scale, blue skies, surface audio metadata, spawn floors, collision routing, and inspect variance verified.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
