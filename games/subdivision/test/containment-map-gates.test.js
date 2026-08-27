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

test('every shipped combat map has three separated, grounded containment choke gates', async () => {
  for (const [mapId, gates] of Object.entries(maps.CONTAINMENT_GATES)) {
    assert.equal(gates.length, 3, `${mapId} should expose three progression gates`);
    for (let i = 0; i < gates.length; i += 1) {
      const gate = gates[i];
      assert.ok(gate.width >= 20 && gate.width <= 80, `${mapId}/${gate.id} has a useful barrier span`);
      for (let j = i + 1; j < gates.length; j += 1) {
        const distance = Math.hypot(gate.x - gates[j].x, gate.z - gates[j].z);
        assert.ok(distance >= 80, `${mapId} gates ${gate.id} and ${gates[j].id} are not bunched together`);
      }
    }

    const source = SOURCES[mapId];
    const collision = await loadMapCollision(path.join(ROOT, source.path), source.scale);
    for (const gate of gates) {
      const ground = collision.walkableGroundY(gate.x, gate.z, gate.yHint + 30);
      assert.notEqual(ground, null, `${mapId}/${gate.id} is grounded on the shipped GLB`);
      const axisX = Math.cos(gate.yaw || 0);
      const axisZ = -Math.sin(gate.yaw || 0);
      const half = gate.width / 2;
      const collisionY = ground + 8;
      for (const side of [-1, 1]) {
        assert.equal(collision.blocked(
          gate.x, collisionY, gate.z,
          gate.x + axisX * half * side, collisionY, gate.z + axisZ * half * side
        ), true, `${mapId}/${gate.id} reaches the ${side < 0 ? 'left' : 'right'} route wall`);
      }
    }
  }
});

test('every map has one fixed staging start and gate-owned breach sections', async () => {
  for (const [mapId, layout] of Object.entries(maps.CONTAINMENT_LAYOUTS)) {
    const gates = maps.CONTAINMENT_GATES[mapId] || [];
    const gateIds = new Set(gates.map(gate => gate.id));
    assert.ok(layout.start?.id, `${mapId} has one named staging start`);
    assert.equal(layout.breaches.filter(point => !point.requiresGate).length, 1,
      `${mapId} exposes exactly one initial breach`);
    assert.deepEqual(new Set(layout.breaches.filter(point => point.requiresGate).map(point => point.requiresGate)), gateIds,
      `${mapId} unlocks one distinct breach section per gate`);

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
      const nearest = Math.min(...points.map(point => Math.hypot(point.x - gate.x, point.z - gate.z)));
      assert.ok(nearest >= 35, `${mapId}/${gate.id} is ${nearest.toFixed(1)} units from a spawn`);
    }
  }
});
