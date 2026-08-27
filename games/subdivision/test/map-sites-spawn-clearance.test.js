// Last updated: 4 August 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const maps = require('../maps');
const { loadMapCollision } = require('../mapCollision');

const ROOT = path.resolve(__dirname, '..');
const PLAYER_EYE_HEIGHT = 18;
const CLEARANCE_RADIUS = 2.8;
const CLEARANCE_DIRECTIONS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707]
];

function dust2Spawns() {
  const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const match = source.match(/const SPAWN_POINTS = (\[[\s\S]*?\n\]);/);
  assert.ok(match, 'Dust2 spawn catalog should remain discoverable');
  return Function(`return ${match[1]}`)();
}

function resolveDust2EyeY(collision, point) {
  const floor = collision.walkableGroundY(point.x, point.z, point.y + 28);
  if (!Number.isFinite(floor)) return point.y;
  const grounded = floor + PLAYER_EYE_HEIGHT;
  return point.halfMap === false && Math.abs(grounded - point.y) > 22 ? point.y : grounded;
}

function spawnIsClear(collision, point, eyeY) {
  const heights = [eyeY - PLAYER_EYE_HEIGHT + 2, eyeY - PLAYER_EYE_HEIGHT * 0.5, eyeY - 1];
  return !heights.some(y => CLEARANCE_DIRECTIONS.some(([dx, dz]) => collision.blocked(
    point.x, y, point.z,
    point.x + dx * CLEARANCE_RADIUS, y, point.z + dz * CLEARANCE_RADIUS
  )));
}

(async () => {
  assert.deepStrictEqual(
    Object.keys(maps.ADMIN_TELEPORTS).sort(),
    ['dust2', ...maps.ADMIN_MAP_IDS].sort(),
    'every playable non-Backrooms map should expose its own A/B admin teleports'
  );

  for (const mapId of maps.ADMIN_MAP_IDS) {
    const definition = maps.MAP_DEFS[mapId];
    const collision = await loadMapCollision(path.join(ROOT, definition.collisionPath), definition.scale);
    for (const [siteId, site] of Object.entries(maps.ADMIN_TELEPORTS[mapId])) {
      const floor = collision.walkableGroundY(site.x, site.z, site.yHint);
      assert.ok(Number.isFinite(floor), `${mapId} site ${siteId} should ground on real shipped geometry`);
    }
    for (const point of maps.SPAWN_SETS[mapId].points) {
      const floor = collision.walkableGroundY(point.x, point.z, point.y + 28);
      assert.ok(Number.isFinite(floor), `${mapId} spawn ${point.id} should ground on real shipped geometry`);
      assert.ok(
        spawnIsClear(collision, point, floor + PLAYER_EYE_HEIGHT),
        `${mapId} spawn ${point.id} should clear the movement collider`
      );
    }
  }

  const dust2Collision = await loadMapCollision(path.join(ROOT, 'assets/maps/de_dust_2_with_real_light.glb'), 20);
  for (const point of dust2Spawns()) {
    const eyeY = resolveDust2EyeY(dust2Collision, point);
    assert.ok(spawnIsClear(dust2Collision, point, eyeY), `Dust2 spawn ${point.id} should clear the movement collider`);
  }

  console.log('map-sites-spawn-clearance: every site grounds and all non-Backrooms spawn volumes are clear.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
