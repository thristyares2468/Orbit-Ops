const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const core = require(path.join(root, 'core.js'));
const modelPath = path.join(root, 'assets', 'weapons', 'rpg.glb');

test('RPG is a three-shot admin-room utility weapon', () => {
  assert.equal(core.UTILITY_LIFE_CAPS.rpg, 3);
  assert.equal(core.WEAPONS.RPG.type, 'utility');
  assert.match(client, /name: 'RPG', type: 'grenade', kind: 'rpg'/);
  assert.match(client, /kind === 'rpg' && !isAdminRoom/);
  assert.match(server, /kind === 'rpg' && !isAdminRoom\(room\)/);
  assert.match(server, /!isAdminRoom\(room\) \|\| player\.weapon !== 'RPG'/);
  assert.match(server, /player\.rpgShotsRemaining -= 1/);
  assert.match(client, /const infiniteUtility = kind !== 'rpg' && adminInfiniteUtilityEnabled\(\)/);
});

test('RPG flight and explosion are validated instead of trusting client damage', () => {
  assert.match(client, /if \(kind === 'rpg'\) return \{ start, vel \}/);
  assert.match(client, /if \(g\.kind !== 'rpg'\) g\.vel\.y -= 400 \* delta/);
  assert.match(client, /kind: kind === 'rpg' \? 'rpg' : 'grenade'/);
  assert.match(server, /recentRpgShots\.push\(\{ id, ts: now, start, velocity, burst: false \}\)/);
  assert.match(server, /Math\.sqrt\(lateralSq\) > 42/);
  assert.match(server, /damage = rpgDamageFor\(room, client\.id, target, now\)/);
  assert.doesNotMatch(server, /data\.kind === 'rpg'[\s\S]{0,180}data\.damage/);
});

test('supplied GLB is installed and contains launcher and rocket materials', () => {
  const glb = fs.readFileSync(modelPath);
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
  assert.match(glb.toString('utf8'), /launcher_wooden_body/);
  assert.match(glb.toString('utf8'), /rocket_?\.?001|rocket/);
  assert.match(client, /'RPG': \{ path: '\/assets\/weapons\/rpg\.glb'/);
  assert.match(client, /\/rocket\/i\.test/);
});
