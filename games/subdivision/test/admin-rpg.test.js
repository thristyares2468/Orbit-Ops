const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const core = require(path.join(root, 'core.js'));
const modelPath = path.join(root, 'assets', 'weapons', 'rpg.glb');

test('RPG is a three-shot admin-room primary weapon', () => {
  assert.equal(core.WEAPONS.RPG.type, 'launcher');
  assert.equal(core.WEAPON_PRICES.RPG, 0);
  assert.equal(core.UTILITY_PRICES.rpg, undefined);
  assert.match(client, /name: 'RPG', type: 'launcher', kind: 'rpg'[\s\S]{0,180}?mag: 1, reserve: 2/);
  assert.match(client, /deathmatchMainWeaponIndexes = \[[^\]]*27\]/);
  assert.match(client, /name === 'RPG' && !isAdminRoom/);
  assert.match(server, /weaponName === 'RPG' && !isAdminRoom\(room\)/);
  assert.match(server, /!isAdminRoom\(room\) \|\| player\.weapon !== 'RPG'/);
  assert.match(server, /player\.rpgShotsRemaining -= 1/);
  assert.match(server, /player\.rpgShotsRemaining = 3/);
});

test('RPG flight and explosion are validated instead of trusting client damage', () => {
  assert.match(client, /if \(kind === 'rpg'\) return \{ start, vel \}/);
  assert.match(client, /if \(wp\.type === 'launcher'\)[\s\S]{0,700}?fireRpgProjectile\(\)/);
  assert.match(client, /currentAmmo--/);
  assert.match(client, /if \(reserveAmmo > 0\) reloadWeapon\(\)/);
  assert.match(client, /reloadTime: 2\.8/);
  assert.match(client, /rpgReloadRocket = createGrenadeProjectileModel\('rpg'\)/);
  assert.match(client, /THREE\.MathUtils\.smoothstep\(progress, 0\.2, 0\.72\)/);
  assert.match(client, /rpgReloadRocket\.position\.set/);
  assert.match(client, /'RPG': \{ path: '\/assets\/weapons\/rpg\.glb', axis: 'y'/);
  assert.match(client, /fp: \{ length: 4\.4, pos: \[0\.82,/);
  assert.match(client, /if \(\/rocket_\?\\\.001\/i\.test\(names\)\) obj\.visible = false/);
  assert.match(client, /else if \(\/\(\^\|\\s\)rocket\(\$\|\\s\)\/i\.test\(names\)\) obj\.visible = loaded/);
  assert.match(client, /currentAmmo--;[\s\S]{0,180}?syncHeldRpgRocket\(\)/);
  assert.match(client, /data\.kind === 'rpg'[\s\S]{0,220}?syncHeldRpgRocket\(remote, false\)/);
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
