// Last updated: 15 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const core = require('../core');

const ROOT = path.resolve(__dirname, '..');
const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function readArray(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `${label} array should remain discoverable`);
  return Function(`"use strict"; return [\n${match[1]}\n];`)();
}

function span(points, key) {
  const values = points.map(point => point[key]);
  return Math.max(...values) - Math.min(...values);
}

const serverPoints = readArray(
  serverJs,
  /const SPAWN_POINTS = \[([\s\S]*?)\n\];\nconst BACKROOMS_SPAWN_POINTS/,
  'server Dust2 spawn'
);
const clientPoints = readArray(
  indexHtml,
  /const DUST2_CUSTOM_SPAWN_POINTS = \[([\s\S]*?)\n\s*\];\n\s*const TEAM_SPAWN_INDEXES/,
  'client Dust2 spawn'
);

assert.deepStrictEqual(
  clientPoints,
  serverPoints.map(({ x, y, z, halfMap }) => ({ x, y, z, halfMap })),
  'client fallback spawns must mirror the authoritative server coordinates'
);

const halfMapIds = serverPoints.filter(point => point.halfMap).map(point => point.id);
assert.deepStrictEqual(halfMapIds, [0, 1, 2, 3, 4, 5, 6, 7], 'half-map matches should keep their original compact spawn set');

const fullOnly = serverPoints.filter(point => !point.halfMap);
assert.ok(fullOnly.length >= 19, 'full-map matches should have a substantial distributed spawn pool');
assert.ok(span(fullOnly, 'x') > 900, 'full-map spawns should cover Dust2 from B side through long A');
assert.ok(span(fullOnly, 'z') > 850, 'full-map spawns should cover Dust2 from the sites through T spawn');

const ctIds = core.TEAM_FULL_MAP_SPAWN_IDS[0];
const tIds = core.TEAM_FULL_MAP_SPAWN_IDS[1];
assert.strictEqual(new Set([...ctIds, ...tIds]).size, ctIds.length + tIds.length, 'full-map team spawn pools should not overlap');
for (const [label, ids] of [['CT', ctIds], ['T', tIds]]) {
  const points = ids.map(id => serverPoints.find(point => point.id === id));
  assert.ok(points.every(Boolean), `${label} full-map spawn ids must reference real points`);
  assert.ok(span(points, 'x') > 550, `${label} full-map spawns should cover multiple horizontal routes`);
  assert.ok(span(points, 'z') > 650, `${label} full-map spawns should cover both site-side and T-side routes`);
}

console.log('full-map-spawns: distributed Dust2 spawn coverage and client parity verified.');
