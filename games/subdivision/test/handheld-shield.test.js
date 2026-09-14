'use strict';

// The handheld shield. Everything that decides whether a hit is blocked is
// server-owned — the purchase, the held weapon, the carrier's facing, whether
// they are crouched, and whether they just fired — because a client that could
// claim cover would simply always claim it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const core = require('../core');

const ROOT = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function primaryBuyIndexes() {
  const match = client.match(/deathmatchMainWeaponIndexes = \[([^\]]*)\]/);
  assert.ok(match, 'index.html must declare deathmatchMainWeaponIndexes');
  return match[1].split(',').map(part => Number(part.trim()));
}


test('core carries one authoritative shield table', () => {
  const shield = core.SHIELD;
  assert.ok(shield, 'core must export SHIELD');
  assert.equal(shield.weapon, 'Shield');
  assert.ok(shield.bodyBlock > 0 && shield.bodyBlock < 1, 'a shield reduces damage, it does not erase it');
  assert.equal(shield.headBlock, 0, 'standing, the head is above the shield');
  assert.equal(shield.crouchHeadBlock, shield.bodyBlock, 'crouched, the carrier is behind it completely');
  assert.ok(shield.capacity > 100, 'the guard must absorb a meaningful but finite amount');
  assert.ok(shield.staggerMs > 0, 'breaking the guard must create a stagger window');
  assert.ok(shield.fireLockoutMs > 0, 'firing has to create a short opening');
  assert.ok(shield.arcCos > 0 && shield.arcCos < 1, 'cover is a frontal arc, not all-round');
  assert.equal(core.WEAPONS.Shield.type, 'shield');
  assert.equal(core.WEAPONS.Shield.dmg.body, 0, 'a shield deals no damage');
  assert.equal(core.weaponIndexFromName('Shield'), 26);
  // A primary, not a utility kind: it is priced and slotted like a weapon.
  assert.ok(core.WEAPON_PRICES.Shield > 0);
  assert.equal(core.UTILITY_PRICES.shield, undefined);
  assert.deepEqual(core.SHIELD.allowedWeaponTypes, ['pistol', 'melee', 'shield']);
  assert.equal(core.SHIELD.sidearmWeapon, 'Glock');
  assert.ok(core.SHIELD_GLOCK.firerate > core.WEAPONS.Glock.firerate, 'shield Glock fires more slowly');
  for (const part of ['head', 'body', 'legs']) {
    assert.ok(core.SHIELD_GLOCK.dmg[part] < core.WEAPONS.Glock.dmg[part], `shield Glock ${part} damage is reduced`);
  }
});

test('the block arc covers the front and nothing else', () => {
  // Mirrors the server helper: forwardFromRotation flattened, dotted against the
  // direction to the attacker, compared with SHIELD.arcCos.
  const forward = { x: -Math.sin(0), z: -Math.cos(0) };   // yaw 0 faces -Z
  const dotTo = (x, z) => {
    const length = Math.hypot(x, z);
    return forward.x * (x / length) + forward.z * (z / length);
  };
  assert.ok(dotTo(0, -10) >= core.SHIELD.arcCos, 'dead ahead is covered');
  assert.ok(dotTo(7, -7) >= core.SHIELD.arcCos, 'a 45 degree angle is covered');
  assert.ok(dotTo(10, 0) < core.SHIELD.arcCos, 'a flank shot is not');
  assert.ok(dotTo(0, 10) < core.SHIELD.arcCos, 'a shot from behind is not');
});

test('the pure resolver enforces facing, posture, fire opening, capacity and stagger', () => {
  const now = 10_000;
  const target = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { y: 0 }, // faces -Z
    weapon: 'Shield',
    loadout: { main: 'Shield' },
    crouching: false,
    lastShotAt: 0,
    shieldDamage: 0,
    shieldStaggeredUntil: 0
  };

  const frontBody = core.resolveShieldHit(target, { x: 0, y: 0, z: -10 }, false, 14, now);
  assert.equal(frontBody.damage, 2);
  assert.equal(frontBody.shieldBlocked, true);
  assert.equal(frontBody.absorbed, 11.9);
  assert.equal(frontBody.staggered, false);

  assert.equal(core.resolveShieldHit(target, { x: 0, y: 0, z: -10 }, true, 56, now).damage, 56,
    'standing headshots clear the plate');
  assert.equal(core.resolveShieldHit({ ...target, crouching: true }, { x: 0, y: 0, z: -10 }, true, 56, now).damage, 8,
    'crouching brings the head behind the plate');
  assert.equal(core.resolveShieldHit(target, { x: 0, y: 0, z: 10 }, false, 14, now).damage, 14,
    'rear hits bypass it');
  assert.equal(core.resolveShieldHit({ ...target, lastShotAt: now - 50 }, { x: 0, y: 0, z: -10 }, false, 14, now).damage, 14,
    'the short Glock firing opening bypasses it');

  const broken = core.resolveShieldHit({ ...target, shieldDamage: 145 }, { x: 0, y: 0, z: -10 }, false, 27, now);
  assert.deepEqual({ damage: broken.damage, absorbed: broken.absorbed, shieldDamage: broken.shieldDamage },
    { damage: 22, absorbed: 5, shieldDamage: core.SHIELD.capacity });
  assert.equal(broken.staggered, true);
  assert.equal(broken.staggeredUntil, now + core.SHIELD.staggerMs);

  const duringStagger = core.resolveShieldHit({ ...target, shieldDamage: 150, shieldStaggeredUntil: now + 500 }, { x: 0, y: 0, z: -10 }, false, 27, now);
  assert.equal(duringStagger.damage, 27, 'the broken guard provides no cover');
  const recovered = core.resolveShieldHit({ ...target, shieldDamage: 150, shieldStaggeredUntil: now - 1 }, { x: 0, y: 0, z: -10 }, false, 14, now);
  assert.equal(recovered.shieldDamage, 11.9, 'the next hit after stagger starts a fresh guard');
});

test('cover applies to direct fire only', () => {
  // The grenade / molotov / C4 branches set their own damage above this point,
  // so utility keeps working on someone hiding behind a shield.
  const hit = server.slice(server.indexOf('function handlePlayerHit'));
  const block = hit.indexOf('resolveShieldHit(target, player.position');
  const utility = hit.indexOf("data.kind === 'c4'");
  assert.ok(block > utility, 'the block must sit in the direct-fire branch, after the utility branches');
  assert.match(server, /target\.shieldDamage = shieldHit\.shieldDamage;/, 'capacity must live on the server player');
  assert.match(server, /target\.shieldStaggeredUntil = shieldHit\.staggeredUntil;/, 'stagger must live on the server player');
  assert.match(server, /shieldBlocked: !!killContext\.shieldBlocked/);
  assert.match(server, /shieldCapacity: SHIELD\.capacity/);
});

test('a shield loadout cannot deal long-gun damage', () => {
  // The rule that keeps `player.weapon` honest now that the shield is a free
  // primary: claiming to hold one is worth nothing unless you actually gave up
  // your rifle, and the server checks its own record of that rather than the
  // packet's word for it.
  assert.match(server, /player\.loadout\?\.main === SHIELD\.weapon && !SHIELD\.allowedWeaponTypes\.includes\(wdef\.type\)\) return;/);
  assert.match(server, /setPlayerLoadoutWeapon\(player, slot, weapon\);/, 'buyWeapon has to record the slot choice');
  assert.match(server, /handleContainmentBuyWeapon[\s\S]*?setPlayerLoadoutWeapon\(player, slot, weapon\);/,
    'Containment purchases must record the same authoritative loadout');
  assert.match(server, /loadout: \{ \.\.\.\(player\.loadout \|\| \{}\) \}/, 'rejoin state must preserve the server loadout');
  assert.match(server, /if \(player\.loadout\?\.main === SHIELD\.weapon\) setPlayerLoadoutWeapon\(player, 'main', item\.weapon\);/,
    'picking a gun up off the floor must clear the restriction with it');
});

test('the client carries it in the primary slot and fires the reduced-stat Glock', () => {
  assert.match(client, /name: 'Shield', type: 'shield'/);
  assert.doesNotMatch(client, /kind: 'shield'/, 'it is a weapon now, not a utility kind');
  assert.match(client, /let wp = heldWeapon\.type === 'shield' \? SHIELD_GLOCK_PROFILE : heldWeapon;/);
  assert.doesNotMatch(client, /if \(wp\.type === 'shield'\) return;/, 'the Shield slot must not discard fire input');
  assert.match(client, /mag: SHIELD\.sidearmMagazine, reserve: SHIELD\.sidearmReserve/);
  assert.match(client, /spreadBase: 0\.01 \* SHIELD\.sidearmSpreadScale/);
  assert.ok(primaryBuyIndexes().includes(26), 'it belongs in the primary buy list');
  assert.doesNotMatch(client, /GRENADE_KINDS = \[[^\]]*'shield'/, 'and out of the utility rows entirely');
  assert.doesNotMatch(client, /utilityShield/);
  // Carrying a shield costs movement, and where that cost sits relative to the
  // other heavy kit is the actual intent - a literal alone says nothing about
  // whether the ladder still makes sense after someone retunes a neighbour.
  const speedOf = (name) => Number(client.match(new RegExp(`name: '${name}'[^\\n]+speedMult: ([0-9.]+)`))[1]);
  assert.equal(speedOf('Shield'), 0.68, 'carrying a shield has to cost movement');
  assert.ok(speedOf('Shield') < speedOf('AWP'), 'a riot shield is heavier going than an AWP');
  assert.ok(speedOf('Shield') > speedOf('RPG'), 'but lighter than a rocket launcher');
  // The standing/crouched rule is invisible unless the HUD says it.
  assert.match(client, /GUARD \$\{Math\.ceil\(shieldGuardRemaining\)\}\/\$\{SHIELD\.capacity\}/);
  assert.match(client, /isCrouching \? 'FULL COVER' : 'HEAD EXPOSED'/);
  assert.match(client, /SHIELD BROKEN · STAGGERED/);
  assert.match(client, /indicator\.classList\.add\('shield-blocked'\)/);
});

test('the shield is presented square to the view, not held like a gun', () => {
  // A yaw on the view model turns the panel across the body, which is what makes
  // it read as a rifle carried sideways rather than cover held in front.
  const spec = client.match(/'Shield': \{ path: '\/assets\/weapons\/shield\.glb'[^\n]*/);
  assert.ok(spec, 'index.html must declare the shield asset spec');
  const fpRot = spec[0].match(/fp: \{[^}]*rot: \[([^\]]*)\]/);
  assert.ok(fpRot, 'the shield needs an explicit first-person rotation');
  assert.deepEqual(fpRot[1].split(',').map(part => Number(part.trim())), [0, 0, 0]);
  const fpPos = spec[0].match(/fp: \{[^}]*pos: \[([^\]]*)\]/);
  assert.ok(fpPos, 'the shield needs an explicit first-person position');
  assert.ok(Number(fpPos[1].split(',')[0]) < 0, 'negative local X places the shield in the left hand');
  assert.match(client, /first-person-left-hand-shield/);
  assert.match(client, /first-person-right-hand-glock/);
  assert.match(client, /attachWeaponAsset\(weaponAssetParent, wp\.name, 'firstPerson'/);
  assert.match(client, /attachWeaponAsset\(shieldSidearmAssetParent, SHIELD\.sidearmWeapon, 'firstPerson', equippedSkinItem\(SHIELD\.sidearmWeapon\)\)/,
    'the right-hand Glock must load the player equipped Glock skin');
  assert.match(client, /third-person-left-hand-shield/);
  assert.match(client, /buildThirdPersonWeaponModel\(remote\.userData\.thirdPersonWeapon, shieldHeld \? SHIELD\.sidearmWeapon : name/,
    'third person must put the Glock in the right-hand weapon holder');
  assert.match(client, /buildThirdPersonWeaponModel\(remote\.userData\.thirdPersonShield, SHIELD\.weapon, skinItemRef\)/,
    'third person must put the shield in its left-hand holder');
  // And it is braced rather than swung, so the gun bob is damped.
  assert.match(client, /const SHIELD_VIEW_BOB_SCALE = 0\.\d+;/);
  assert.match(client, /type === 'shield' \? SHIELD_VIEW_BOB_SCALE : 1/);
});

test('a respawn restores utility to full', () => {
  // Topping up to one of each meant re-buying the rest after every death.
  assert.match(client, /GRENADE_KINDS\.forEach\(kind => \{\s*\n\s*grenadeInventory\[kind\] = utilityCap\(kind\);/);
  assert.doesNotMatch(client, /grenadeInventory\[kind\] = Math\.min\(utilityCap\(kind\), Math\.max\(grenadeInventory\[kind\] \|\| 0, 1\)\)/);
});

test('the converted model ships in the shape the loader expects', () => {
  const glb = path.join(ROOT, 'assets/weapons/shield.glb');
  assert.ok(fs.existsSync(glb));
  const bytes = fs.readFileSync(glb);
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF', 'the OBJ had to become binary glTF: it is the only format the client loads');
  assert.ok(bytes.length < 256 * 1024);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.equal(json.meshes.length, 1);
  const prim = json.meshes[0].primitives[0];
  assert.ok(prim.attributes.POSITION !== undefined && prim.attributes.NORMAL !== undefined,
    'normals have to survive the conversion or the panel renders flat');
  assert.equal(prim.mode, 4, 'triangles: the OBJ n-gons had to be triangulated');
  assert.match(client, /'Shield': \{ path: '\/assets\/weapons\/shield\.glb', axis: 'z'/);
});

test('the shield viewmodel sits at the middle of the screen, not the top of it', () => {
  // Measured from drawn pixels in a harness that replicates the real chain
  // (camera FOV 70 -> weaponGroup at WEAPON_REST_POS -> the fp spec below),
  // counting covered pixels rather than a bounding box so the empty corners
  // of the shield's curve are not counted as blocked view:
  //
  //     fp.y    coverage   top edge
  //     0.55      27.8%        4%     <- a quarter of the screen, to the ceiling
  //    -0.28      15.1%       50%     <- halfway up, as asked for
  //
  // tools/shield-measure.html reproduces it.
  const spec = client.match(/'Shield': \{ path: '[^']+', axis: 'z', fp: \{ length: ([\d.]+), pos: \[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\]/u);
  assert.ok(spec, 'the Shield asset spec is where this expects');
  const y = Number(spec[3]);
  assert.equal(y, -0.28, 'the shield hangs from the middle of the view');
  assert.ok(y < 0, 'above the weapon rest height it starts eating the top of the screen');
});

test('what the shield actually blocks is server-side, not the model', () => {
  // Why the change above was one number rather than a coupled pair. The RPG's
  // speed needed four edits in step because the server re-derives it; the
  // shield's cover is authored entirely in core.js and never reads the
  // viewmodel, so moving the model changes what you can see and nothing else.
  // If that ever stops being true, this is where it should fail.
  const shieldBlock = core.SHIELD;
  assert.ok(Number.isFinite(shieldBlock.arcCos), 'the cover arc is a constant');
  assert.ok(Number.isFinite(shieldBlock.bodyBlock) && shieldBlock.bodyBlock > 0);
  const fpSpec = client.slice(client.indexOf("'Shield': { path:"), client.indexOf("'Shield': { path:") + 400);
  assert.doesNotMatch(fpSpec, /arcCos|bodyBlock|headBlock/u,
    'the viewmodel spec must never carry a gameplay figure');
});
