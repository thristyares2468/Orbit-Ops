const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../core');
const {readGlb} = require('../scripts/build-skin-glbs');
test('minigun balance and snapshot table agree', () => {
  assert.equal(core.WEAPONS.Minigun.dmg.body, 10);
  assert.equal(core.WEAPONS.Minigun.dmg.head, 10 * 1.25);
  assert.equal(core.WEAPONS.Minigun.firerate, 1 / 12);
  assert.equal(core.MINIGUN.ammo, 240);
  assert.equal(core.MINIGUN.speedMult, 0.5);
  assert.equal(core.WEAPON_NAMES[28], 'Minigun');
  assert.ok(Object.values(core.MINIGUN).every(value => value >= 0));
});
test('thermal lockout follows 72 shots and cannot be bypassed by repeated attempts', () => {
  const state = {};
  for (let i = 0; i < 72; i++) assert.equal(core.minigunShot(state, i * 1000 / 12), true);
  const end = state.lockedUntil;
  assert.equal(core.minigunShot(state, end - 1), false);
  assert.equal(core.minigunShot(state, end), true);
});
test('interrupted bursts cool without negative heat', () => {
  const state = {};
  core.minigunShot(state, 0);
  core.minigunShot(state, 10000);
  assert.equal(state.heat, 1);
});
test('shipped asset preserves animated rig and required frame range', () => {
  const {json} = readGlb(path.join(__dirname, '../assets/weapons/minigun.glb'));
  assert.ok(json.skins.length);
  assert.ok(json.animations[0].channels.length > 0);
  const duration = Math.max(...json.animations[0].samplers.map(s => json.accessors[s.input].max[0]));
  assert.ok(duration >= 180 / 30);
});
test('RPG weight increased and minigun uses shared ammo/thermal logic', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /name: 'RPG'[^\n]+speedMult: 0\.58/);
  assert.match(html, /name: 'Minigun'[^\n]+mag: window.GameCore.MINIGUN.ammo, reserve: 0/);
  assert.match(html, /window.GameCore.minigunShot\(minigunThermal, time\)/);
});
