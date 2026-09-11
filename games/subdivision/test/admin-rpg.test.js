const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const core = require(path.join(root, 'core.js'));
const modelPath = path.join(root, 'assets', 'weapons', 'rpg.glb');

test('RPG is a three-shot public primary weapon', () => {
  assert.equal(core.WEAPONS.RPG.type, 'launcher');
  assert.equal(core.WEAPON_PRICES.RPG, 6000);
  assert.equal(core.UTILITY_PRICES.rpg, undefined);
  assert.match(client, /name: 'RPG', type: 'launcher', kind: 'rpg'[\s\S]{0,180}?mag: 1, reserve: 2/);
  assert.match(client, /deathmatchMainWeaponIndexes = \[[^\]]*27, 28\]/);
  assert.doesNotMatch(client, /name === 'RPG' && !isAdminRoom/);
  assert.doesNotMatch(server, /weaponName === 'RPG' && !isAdminRoom\(room\)/);
  assert.match(server, /if \(player\.weapon !== 'RPG'\) return;/);
  assert.match(server, /!usesUtility\(room\) && !\(isContainment\(room\) && kind === 'rpg'\)/);
  assert.match(server, /player\.rpgShotsRemaining -= 1/);
  assert.match(server, /player\.rpgShotsRemaining = 3/);
});

test('RPG flight and explosion are validated instead of trusting client damage', () => {
  assert.match(client, /if \(kind === 'rpg'\) return \{ start, vel \}/);
  assert.match(client, /if \(wp\.type === 'launcher'\)[\s\S]{0,1800}?fireRpgProjectile\(\)/);
  assert.match(client, /currentAmmo--/);
  assert.match(client, /if \(reserveAmmo > 0\) reloadWeapon\(\)/);
  assert.match(client, /reloadTime: 2\.8/);
  assert.match(client, /rpgReloadRocket = createGrenadeProjectileModel\('rpg'\)/);
  assert.match(client, /THREE\.MathUtils\.smoothstep\(progress, 0\.2, 0\.72\)/);
  assert.match(client, /rpgReloadRocket\.position\.set/);
  assert.match(client, /'RPG': \{ path: '\/assets\/weapons\/rpg\.glb', axis: 'z'/);
  assert.match(client, /fp: \{ length: 4\.4, pos: \[0\.45,/);
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

test('admin-room infinite ammo applies to RPG client and server authority', () => {
  assert.match(client, /const infiniteRpgAmmo = adminInfiniteAmmoEnabled\(\)/);
  assert.match(client, /if \(infiniteRpgAmmo\)[\s\S]{0,500}?syncHeldRpgRocket\(weaponGroup, false\)/);
  assert.match(client, /if \(weapons\[currentWeaponIndex\]\?\.name === 'RPG' && adminInfiniteAmmoEnabled\(\)\)/);
  assert.match(client, /data\.rpgInfiniteAmmo \? 180 : 2800/);
  assert.match(server, /rpgInfiniteAmmo = isAdminRoom\(room\) && ensureAdminConfig\(room\)\.infiniteAmmo === true/);
  assert.match(server, /if \(!rpgInfiniteAmmo\) player\.rpgShotsRemaining -= 1/);
  assert.match(server, /rpgInfiniteAmmo,\s*\n\s*start,/);
});

test('RPG uses a dedicated layered fiery explosion cloud', () => {
  assert.match(client, /if \(kind === 'rpg'\)[\s\S]{0,500}?spawnRpgExplosionCloud\(pos, radius\)/);
  assert.match(client, /function spawnRpgExplosionCloud\(pos, radius\)/);
  assert.match(client, /for \(let i = 0; i < 15; i\+\+\) addCloudPuff\(\{ fire: true/);
  assert.match(client, /for \(let i = 0; i < 13; i\+\+\) addCloudPuff\(\{ fire: false/);
  assert.match(client, /for \(let i = 0; i < 18; i\+\+\)/);
  assert.match(client, /if \(f\.cloud\)[\s\S]{0,900}?f\.mesh\.material\.color\.lerpColors/);
  assert.match(client, /const blastRadius = Math\.max\(24, Number\(radius\) \|\| GRENADE_CONFIG\.rpg\.radius\)/);
  assert.match(client, /spawnFragFlash\(point, 0xfff0a0, blastRadius \* 0\.22\)/);
  assert.match(client, /spawnFragShockwave\(point, blastRadius, true\)/);
  assert.match(client, /const radialStart = blastRadius \*/);
  assert.match(client, /const endScale = blastRadius \*/);
  assert.match(client, /direction\.multiplyScalar\(blastRadius \*/);
  assert.match(client, /matchRadius \? Math\.max\(18, radius \/ 1\.2 - 1\)/);
});

test('supplied GLB is installed and contains launcher and rocket materials', () => {
  const glb = fs.readFileSync(modelPath);
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
  assert.match(glb.toString('utf8'), /launcher_wooden_body/);
  assert.match(glb.toString('utf8'), /rocket_?\.?001|rocket/);
  assert.match(client, /'RPG': \{ path: '\/assets\/weapons\/rpg\.glb'/);
  assert.match(client, /\/rocket\/i\.test/);
});

// Orientation. This has been got wrong twice - once standing the launcher on
// end and aiming it at the floor, once flying the rocket broadside - so the
// reasoning is pinned here rather than the numbers alone.
//
// Measured from the GLB's own world-space bounds (after node transforms):
//   X span 0.73   Y span 2.19   Z span 8.08
// so the tube runs along Z. The sight sits at +Y and the grips hang at -Y, so
// +Y is up. The warhead protrudes to -Z, which is forward in this engine.
// Therefore the correct transform is no transform.
test('the RPG is not rotated off its own long axis', () => {
  // axis 'y' maps the model's +Z to +Y. On a Z-length model that is what
  // stands it upright and points the muzzle at the ground.
  assert.doesNotMatch(client, /'RPG': \{ path: '\/assets\/weapons\/rpg\.glb', axis: 'y'/,
    "axis 'y' aims a Z-length launcher at the floor");
  // A 180deg yaw is the other failed attempt: it points the warhead back at
  // the player, because -Z is already forward.
  assert.doesNotMatch(client, /'RPG': \{ path: '[^']*rpg\.glb', axis: 'z', fp: \{[^}]*rot:/u,
    'the RPG needs no rot; -Z is already the muzzle and +Y is already up');

  const rpgBranch = client.slice(
    client.indexOf("if (kind === 'rpg') {"),
    client.indexOf('const weaponName = grenadeWeaponName(kind);')
  );
  assert.ok(rpgBranch.length > 500 && rpgBranch.length < 4000, 'the rpg projectile branch is where this expects');

  // The flight code aligns the group's -Z to the velocity, and the rocket's
  // nose is already at -Z, so any rotation here tips it off the flight axis.
  assert.doesNotMatch(rpgBranch, /rocket\.rotation\.x/u,
    'rotating the loaded rocket about X makes it fly broadside-on');
  assert.match(client, /g\.mesh\.quaternion\.setFromUnitVectors\(new THREE\.Vector3\(0, 0, -1\), g\.vel/u,
    'this is the contract the rocket model has to satisfy');

  // The placeholder shown until the GLB resolves has to agree with it. A
  // cylinder is Y-axis with its narrow end at +Y, so -90deg puts the nose
  // on -Z; +90deg would fly it tail-first.
  assert.match(rpgBranch, /fallback\.rotation\.x = -Math\.PI \/ 2;/u);

  // The source carries a spare rocket above the tube. A bare /rocket/i keeps
  // both, so the projectile flew as two warheads and the spare pulled the
  // bounding box off-axis, skewing the recentring.
  assert.match(rpgBranch, /!\/rocket_\?\\\.001\/i\.test\(name\)/u,
    'the spare rocket must be excluded from the projectile');
});
