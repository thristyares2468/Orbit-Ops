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
  assert.equal(core.MINIGUN.speedMult, 0.64);
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
  assert.deepEqual(json.materials.map(material => material.name), ['minigun', 'arms'],
    'the weapon and authored first-person arms must remain separate materials');
});
test('previews hide authored arms and remote players aim the Minigun forward', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const hideStart = html.indexOf('function hideMinigunAuthoredArms');
  const hideBody = html.slice(hideStart, html.indexOf('\n        function ', hideStart + 1));
  assert.match(hideBody, /material\?\.name[\s\S]*?=== 'arms'[\s\S]*?obj\.visible = false/u,
    'only the authored arms material should be hidden');
  const previewStart = html.indexOf('function buildWeaponPreviewInstance');
  const previewBody = html.slice(previewStart, html.indexOf('\n        function ', previewStart + 1));
  assert.match(previewBody, /weaponName === 'Minigun'\) hideMinigunAuthoredArms\(model\)/u);
  const instanceStart = html.indexOf('function buildWeaponAssetInstance');
  const instanceBody = html.slice(instanceStart, previewStart);
  assert.match(instanceBody, /weaponName === 'Minigun' && view === 'thirdPerson'\) hideMinigunAuthoredArms\(model\)/u);
  assert.match(html, /const AGENT_HELD_MINIGUN_PITCH_X = -Math\.PI \/ 2;/u);
  const heldStart = html.indexOf('function applyAgentHeldWeaponTransform');
  const heldBody = html.slice(heldStart, html.indexOf('\n        function ', heldStart + 1));
  assert.match(heldBody, /weaponName === 'Minigun'\) rig\.rotateX\(AGENT_HELD_MINIGUN_PITCH_X\)/u,
    'the imported-agent hand needs the measured -90 degree Minigun pitch correction');
});
test('RPG weight increased and minigun uses shared ammo/thermal logic', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const speed = name => Number(html.match(new RegExp(`name: '${name}'[^\\n]+speedMult: ([0-9.]+)`))[1]);
  assert.equal(speed('AWP'), 0.7);
  assert.equal(speed('RPG'), 0.67);
  assert.ok(core.MINIGUN.speedMult < speed('RPG'));
  assert.ok(speed('RPG') < speed('AWP'));
  assert.ok(core.MINIGUN.speedMult / speed('AWP') > 0.9, 'minigun stays within 10% of AWP speed');
  assert.match(html, /name: 'Minigun'[^\n]+mag: window.GameCore.MINIGUN.ammo, reserve: 0/);
  assert.match(html, /window.GameCore.minigunShot\(minigunThermal, time\)/);
  assert.match(html, /actions\.fire\.timeScale = THREE\.MathUtils\.lerp\(0\.2, 1, windupProgress\)/);
  assert.match(html, /windingUp = wp\.name === 'Minigun'/);
});
