'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const maps = require('../maps');
const { loadMapCollision } = require('../mapCollision');

const ROOT = path.resolve(__dirname, '..');
const SOURCES = {
  dust2: { path: 'assets/maps/de_dust_2_with_real_light.glb', scale: 20 },
  ...Object.fromEntries(Object.entries(maps.MAP_DEFS).map(([id, map]) => [id, {
    path: map.collisionPath,
    scale: map.scale
  }]))
};

test('every shipped combat map has grounded containment choke gates', async () => {
  for (const [mapId, gates] of Object.entries(maps.CONTAINMENT_GATES)) {
    const buyable = gates.filter(gate => !gate.unbuyable);
    if (mapId === 'dust2') {
      assert.equal(buyable.length, 15, 'Dust 2 should expose all fifteen labelled buyable gates');
      assert.equal(gates.filter(gate => gate.unbuyable && gate.hidden).length, 2,
        'Dust 2 keeps both labelled invisible map boundaries');
      assert.deepEqual(buyable.map(gate => gate.label), Array.from({ length: 15 }, (_, index) => `Gate ${index + 1}`));
      for (const gate of buyable) {
        assert.ok(gate.width >= 8 && gate.width <= 160, `dust2/${gate.id} has a complete wall-to-wall span`);
        assert.ok(Number.isFinite(gate.yHint), `dust2/${gate.id} retains a scanned floor hint`);
      }
    } else {
      assert.equal(buyable.length, 3, `${mapId} should expose three progression gates`);
      for (let i = 0; i < buyable.length; i += 1) {
        const gate = buyable[i];
        assert.ok(gate.width >= 20 && gate.width <= 80, `${mapId}/${gate.id} has a useful barrier span`);
        for (let j = i + 1; j < buyable.length; j += 1) {
          const distance = Math.hypot(gate.x - buyable[j].x, gate.z - buyable[j].z);
          assert.ok(distance >= 80, `${mapId} gates ${gate.id} and ${buyable[j].id} are not bunched together`);
        }
      }
    }

    const source = SOURCES[mapId];
    const collision = await loadMapCollision(path.join(ROOT, source.path), source.scale);
    for (const gate of buyable) {
      const ground = collision.walkableGroundY(gate.x, gate.z, gate.yHint + (mapId === 'dust2' ? 12 : 30));
      assert.notEqual(ground, null, `${mapId}/${gate.id} is grounded on the shipped GLB`);
      if (mapId === 'dust2') {
        assert.ok(Math.abs(ground - gate.yHint) <= 1,
          `${mapId}/${gate.id} is snapped to the scanned walkable floor`);
      }
      const axisX = Math.cos(gate.yaw || 0);
      const axisZ = -Math.sin(gate.yaw || 0);
      const half = gate.width / 2;
      // Seven units is the lower-body collision slice used by the geometry
      // scan. Dust2 has sloped parapets whose upper edge recedes, but their
      // floor-level collision is what prevents walking around a gate end.
      const collisionY = ground + 7;
      for (const side of [-1, 1]) {
        assert.equal(collision.blocked(
          gate.x, collisionY, gate.z,
          gate.x + axisX * half * side, collisionY, gate.z + axisZ * half * side
        ), true, `${mapId}/${gate.id} reaches the ${side < 0 ? 'left' : 'right'} route wall`);
      }
      if (mapId === 'dust2') {
        const routeX = Math.sin(gate.yaw || 0);
        const routeZ = Math.cos(gate.yaw || 0);
        for (const side of [-1, 1]) {
          assert.equal(collision.blocked(
            gate.x, collisionY, gate.z,
            gate.x + routeX * 8 * side, collisionY, gate.z + routeZ * 8 * side
          ), false, `${mapId}/${gate.id} crosses an open route instead of lying along a wall`);
        }
      }
    }
  }
});

test('every map has one fixed staging start and verified breach sections', async () => {
  for (const [mapId, layout] of Object.entries(maps.CONTAINMENT_LAYOUTS)) {
    const gates = maps.CONTAINMENT_GATES[mapId] || [];
    const gateIds = new Set(gates.filter(gate => !gate.unbuyable).map(gate => gate.id));
    assert.ok(layout.start?.id, `${mapId} has one named staging start`);
    assert.equal(layout.breaches.filter(point => !point.requiresGate).length, 1,
      `${mapId} exposes exactly one initial breach`);
    const gatedBreaches = new Set(layout.breaches.filter(point => point.requiresGate).map(point => point.requiresGate));
    if (mapId === 'dust2') {
      assert.equal(gatedBreaches.size, 0,
        'Dust 2 deliberately keeps the horde in the verified staging sector until new breach coordinates are captured');
    } else {
      assert.deepEqual(gatedBreaches, gateIds, `${mapId} unlocks one distinct breach section per gate`);
    }

    const source = SOURCES[mapId];
    const collision = await loadMapCollision(path.join(ROOT, source.path), source.scale);
    for (const point of [layout.start, ...layout.breaches]) {
      const ground = collision.walkableGroundY(point.x, point.z, point.yHint + 30);
      assert.notEqual(ground, null, `${mapId}/${point.id} is grounded on the shipped GLB`);
      assert.ok(Math.abs(ground - point.yHint) <= 8,
        `${mapId}/${point.id} targets the intended vertical map section`);
    }
  }
});

test('authored gates are kept away from imported player and zombie spawn markers', () => {
  for (const [mapId, gates] of Object.entries(maps.CONTAINMENT_GATES)) {
    const points = maps.SPAWN_SETS[mapId]?.points || [];
    if (!points.length) continue;
    for (const gate of gates) {
      if (gate.unbuyable) continue;
      const nearest = Math.min(...points.map(point => Math.hypot(point.x - gate.x, point.z - gate.z)));
      assert.ok(nearest >= 35, `${mapId}/${gate.id} is ${nearest.toFixed(1)} units from a spawn`);
    }
  }
});
