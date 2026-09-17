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
  // A block, not a reduction: a round the plate catches does not reach the
  // carrier at all. The cost is capacity, facing and the fire lockout below.
  assert.equal(shield.bodyBlock, 1, 'a caught body/leg hit is caught outright');
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
  assert.equal(frontBody.damage, 0, 'a caught round does not leak any damage through');
  assert.equal(frontBody.shieldBlocked, true);
  assert.equal(frontBody.absorbed, 14);
  assert.equal(frontBody.staggered, false);

  assert.equal(core.resolveShieldHit(target, { x: 0, y: 0, z: -10 }, true, 56, now).damage, 56,
    'standing headshots clear the plate');
  assert.equal(core.resolveShieldHit({ ...target, crouching: true }, { x: 0, y: 0, z: -10 }, true, 56, now).damage, 0,
    'crouching brings the head behind the plate');
  assert.equal(core.resolveShieldHit(target, { x: 0, y: 0, z: 10 }, false, 14, now).damage, 14,
    'rear hits bypass it');
  assert.equal(core.resolveShieldHit({ ...target, lastShotAt: now - 50 }, { x: 0, y: 0, z: -10 }, false, 14, now).damage, 14,
    'the short Glock firing opening bypasses it');

  // No damage reaches a facing carrier at all. The round that breaks the guard
  // is still stopped in full - the stagger is the penalty, and the overflow is
  // not a second one. Previously the last 5 points of guard ate 5 of a 27 and
  // let 22 through, so a nearly-broken shield was worth almost nothing and the
  // breaking round hurt about as much as one against bare armour.
  const broken = core.resolveShieldHit({ ...target, shieldDamage: 145 }, { x: 0, y: 0, z: -10 }, false, 27, now);
  assert.deepEqual({ damage: broken.damage, absorbed: broken.absorbed, shieldDamage: broken.shieldDamage },
    { damage: 0, absorbed: 27, shieldDamage: core.SHIELD.capacity });
  assert.equal(broken.staggered, true);
  assert.equal(broken.staggeredUntil, now + core.SHIELD.staggerMs);
  // The hit that lands exactly on the capacity breaks it too - a guard sitting
  // at zero that has not staggered would block forever.
  const exact = core.resolveShieldHit({ ...target, shieldDamage: core.SHIELD.capacity - 27 }, { x: 0, y: 0, z: -10 }, false, 27, now);
  assert.equal(exact.staggered, true, 'spending the last of the guard breaks it');
  assert.equal(exact.damage, 0);
  // A hit that leaves the guard intact must not stagger. Absorbing past the cap
  // is only allowed to happen on the hit that actually exhausts it.
  const survives = core.resolveShieldHit({ ...target, shieldDamage: 100 }, { x: 0, y: 0, z: -10 }, false, 27, now);
  assert.equal(survives.staggered, false);
  assert.equal(survives.shieldDamage, 127);

  const duringStagger = core.resolveShieldHit({ ...target, shieldDamage: 150, shieldStaggeredUntil: now + 500 }, { x: 0, y: 0, z: -10 }, false, 27, now);
  assert.equal(duringStagger.damage, 27, 'the broken guard provides no cover');
  const recovered = core.resolveShieldHit({ ...target, shieldDamage: 150, shieldStaggeredUntil: now - 1 }, { x: 0, y: 0, z: -10 }, false, 14, now);
  assert.equal(recovered.shieldDamage, 14, 'the next hit after stagger starts a fresh guard');
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
  // Three states now, so the HUD reads them from one function instead of a
  // ternary - a sprinting carrier is neither fully covered nor merely head-exposed.
  assert.match(client, /\$\{shieldCoverLabel\(\)\}/u);
  const label = client.slice(client.indexOf('function shieldCoverLabel'));
  const labelBody = label.slice(0, label.indexOf('\n        function ', 1));
  assert.match(labelBody, /isCrouching\) return 'FULL COVER'/u);
  assert.match(labelBody, /isSprinting\) return 'HALF EXPOSED'/u);
  assert.match(labelBody, /return 'HEAD EXPOSED'/u);
  // Crouching and sprinting are both silent state changes - nothing else
  // repaints the HUD - so the label would sit stale until an unrelated event.
  assert.match(client, /if \(coverLabel !== lastShieldCoverLabel\)/u);
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

// --- what OTHER players see the shield carrier holding -----------------------

test('the third-person shield hangs off the torso, not off the swinging arm', () => {
  // It used to be `leftArmPivot.add(thirdPersonShield)` with position and scale
  // copied byte-for-byte from thirdPersonWeapon, the RIGHT-hand rifle holder.
  // The arm pivot carries the support-hand aim pose (rotation.x ~= PI/2.2, plus
  // a y/z twist) and the walk swing, so the plate came out edge-on above the
  // head and flapped as the carrier walked. tools/shield-thirdperson.html
  // renders both: before, the plate measured 2.5 units tall at y 15.8..18.3 -
  // a sliver through the face; body-locked it is 11.1 tall at y 6.1..17.2,
  // which is the torso.
  const decl = client.match(
    /const thirdPersonShield = new THREE\.Group\(\);[\s\S]{0,400}?\.add\(thirdPersonShield\);/u);
  assert.ok(decl, 'index.html must build a third-person shield holder');
  const block = decl[0];
  assert.match(block, /bodyPivot\.add\(thirdPersonShield\);/u,
    'the shield must be parented to the torso');
  assert.doesNotMatch(block, /leftArmPivot\.add\(thirdPersonShield\);/u,
    'parented to the arm it inherits the aim pose and the walk swing');

  const gun = client.match(
    /const thirdPersonWeapon = new THREE\.Group\(\);[\s\S]{0,300}?rightArmPivot\.add\(thirdPersonWeapon\);/u);
  assert.ok(gun, 'index.html must build a third-person weapon holder');
  const grab = (text, name) => {
    const pos = text.match(new RegExp(`${name}\\.position\\.set\\(([^)]*)\\)`, 'u'));
    const scale = text.match(new RegExp(`${name}\\.scale\\.setScalar\\(([^)]*)\\)`, 'u'));
    return { pos: pos && pos[1].trim(), scale: scale && scale[1].trim() };
  };
  const shield = grab(block, 'thirdPersonShield');
  const rifle = grab(gun[0], 'thirdPersonWeapon');
  assert.ok(shield.pos && rifle.pos, 'both holders must set a position');
  assert.notEqual(shield.pos, rifle.pos, 'a shield is not held where a rifle is');
  assert.notEqual(shield.scale, rifle.scale, 'a body-sized plate is not rifle-sized');
});

test('a shield carrier braces the off arm instead of swinging it', () => {
  const brace = client.match(
    /const SHIELD_THIRD_PERSON_ARM = Object\.freeze\(\{ x: (-?[\d.]+), y: (-?[\d.]+), z: (-?[\d.]+) \}\)/u);
  assert.ok(brace, 'index.html must declare the shield brace pose');
  assert.ok(Number(brace[1]) < Math.PI / 2.2,
    'the braced forearm tucks in behind the plate rather than reaching past it');

  // All three procedural-body pose sites - the streaming-in fallback, remote
  // players, and the MVP actor - have to agree, or the shield detaches from the
  // arm on whichever body the viewer happens to be looking at.
  const uses = client.match(/SHIELD_THIRD_PERSON_ARM/gu) || [];
  assert.equal(uses.length, 4, 'one declaration and three pose sites');
  for (const site of ['shieldArmA', 'shieldArm', 'shieldArmC']) {
    assert.match(client, new RegExp(`const ${site} = [^;]*SHIELD\\.weapon \\? SHIELD_THIRD_PERSON_ARM : null`, 'u'),
      `${site} must gate the brace on the held weapon`);
  }
  // The brace is a constant, so no swing term may reach it.
  assert.doesNotMatch(client,
    /SHIELD_THIRD_PERSON_ARM\.x \+ (movingSwing|swing|shootingKick)/u,
    'the brace must not pick the walk swing back up');
});

test('an agent-held shield skips the rifle grip corrections', () => {
  // applyAgentHeldWeaponTransform aims a barrel down the hand: the first of its
  // corrections is `rig.rotation.x += AGENT_HELD_WEAPON_GRIP_ROT_X`, and that
  // constant is PI. On a flat plate a half turn about X is just hanging the
  // shield upside down.
  assert.match(client, /const AGENT_HELD_WEAPON_GRIP_ROT_X = Math\.PI;/u);
  const fn = client.slice(client.indexOf('function applyAgentHeldWeaponTransform'));
  const body = fn.slice(0, fn.indexOf('\n        function ', 1));
  const shieldReturn = body.indexOf('weaponName === SHIELD.weapon');
  const gripRoll = body.indexOf('AGENT_HELD_WEAPON_GRIP_ROT_X');
  assert.ok(shieldReturn > 0, 'the shield must have its own branch');
  assert.ok(shieldReturn < gripRoll, 'and it must return before the rifle grip roll');
});

test('full cover looks different from head exposed', () => {
  // core.js already says these are different states: standing, a headshot is
  // unblocked; crouched, it is absorbed outright. The model has to say so too,
  // or a shooter cannot tell whether the head in front of them is a target.
  assert.equal(core.SHIELD.headBlock, 0, 'standing, the head is exposed');
  assert.equal(core.SHIELD.crouchHeadBlock, 1, 'crouched, the head is covered');

  const raise = client.match(/const SHIELD_COVER_RAISE = ([\d.]+);/u);
  assert.ok(raise, 'index.html must declare the full-cover raise');
  // Measured against the procedural body: the plate rests at torso-local
  // y -3.9..7.2 and the helmet tops out at 12.3, so anything less than ~5.1
  // leaves the head sticking out of a pose the server treats as full cover.
  assert.ok(Number(raise[1]) > 5.1, 'the raised plate must clear the top of the helmet');

  const fn = client.slice(client.indexOf('function poseShieldCover'));
  const body = fn.slice(0, fn.indexOf('\n        function ', 1));
  assert.ok(body, 'index.html must pose the shield for cover');
  assert.match(body, /data\.weapon === SHIELD\.weapon && data\.isCrouching/u,
    'the raise is gated on holding a shield AND being crouched');
  // Both bodies a carrier can be drawn as: the procedural fallback plate and
  // the imported agent's hand holder. Raising only one means the cue vanishes
  // the moment the character GLB finishes streaming in.
  assert.match(body, /applyShieldCoverOffset\(data\.thirdPersonShield/u);
  assert.match(body, /applyShieldCoverOffset\(data\.characterAsset\?\.userData\?\.assetShieldHolder/u);

  // Both parents are rotated - the torso pitches forward when crouched, the
  // hand bone points wherever the animation put it - so a raise applied in
  // local space would tip the plate away instead of lifting it.
  const offset = client.slice(client.indexOf('function applyShieldCoverOffset'));
  const offsetBody = offset.slice(0, offset.indexOf('\n        function ', 1));
  assert.match(offsetBody, /\.matrixWorld\.decompose\(/u,
    'the raise must be converted out of the parent world transform');
  assert.match(offsetBody, /_shieldCoverQuat\.invert\(\)/u);

  // prepareAgentWeaponHolder re-authors holder.position, so a rest captured
  // before it ran would leave the plate permanently displaced.
  const prep = client.slice(client.indexOf('function prepareAgentWeaponHolder'));
  assert.match(prep.slice(0, prep.indexOf('\n        function ', 1)),
    /holder\.userData\.shieldCoverRest = null;/u,
    're-authoring the holder must invalidate the cached rest position');

  // Called for real players and for admin dummies, on every frame either is posed.
  assert.equal((client.match(/poseShieldCover\(/gu) || []).length, 3,
    'one declaration plus the remote-player and admin-dummy pose loops');
});

// The cue that was missing. The previous pass moved every carrier EXCEPT the
// one whose decision it informs: the HUD told the local player "FULL COVER" /
// "HEAD EXPOSED" while their own plate never moved, so the whole feature was
// invisible to the person choosing whether to crouch.
test('the carrier sees their own plate rise into cover', () => {
  const raise = client.match(/const SHIELD_FP_COVER_RAISE = ([\d.]+);/u);
  assert.ok(raise, 'index.html must declare a first-person cover raise');
  // The procedural plate is 1.5 tall and rests centred just below the eye line,
  // so a lift under about a third of its height never crosses the crosshair and
  // reads as nothing happening at all.
  assert.ok(Number(raise[1]) > 0.5, 'the raise must clear the eye line, not jitter');

  const fn = client.slice(client.indexOf('function updateShieldCoverPose'));
  const body = fn.slice(0, fn.indexOf('\n        function ', 1));
  assert.ok(body, 'index.html must pose the first-person shield');
  assert.match(body, /isCrouching/u, 'the raise is gated on crouching');
  // A fixed per-frame lerp raises the plate twice as fast at 120fps as at 60.
  assert.match(body, /Math\.exp\(-SHIELD_FP_COVER_RATE \* Math\.max\(0, delta\)\)/u,
    'the approach must be frame-rate independent');
  // It moves the shield's own holder. Moving weaponGroup would drag the sidearm
  // in the other hand up with it, which is not what crouching does.
  assert.match(body, /firstPersonShieldHolder/u);
  assert.doesNotMatch(body, /weaponGroup\.position/u,
    'the sidearm must not ride up with the plate');

  // clearObjectChildren(weaponGroup) orphans the previous plate on every
  // rebuild, so a stale handle would pose a detached group forever.
  const build = client.slice(client.indexOf('clearObjectChildren(weaponGroup);'));
  const reset = build.indexOf('firstPersonShieldHolder = null;');
  const capture = build.indexOf('firstPersonShieldHolder = shieldAssetHolder;');
  assert.ok(reset > 0, 'the handle is cleared when the viewmodel is rebuilt');
  assert.ok(capture > reset, 'and re-captured only when a shield is actually built');

  // And it has to be driven every frame, not just on the crouch keypress.
  assert.match(client, /updateShieldCoverPose\(delta\);/u, 'the frame loop drives it');
});

// Sprinting with a shield: the carrier is running, not covering. The plate is
// dropped out of the firing line, so the body it was protecting is half open.
test('sprinting drops the plate and half-exposes the body', () => {
  const s = core.SHIELD;
  assert.equal(s.sprintBodyBlock, 0.5, 'sprinting leaves the body half covered');
  assert.ok(s.sprintBodyBlock > s.headBlock && s.sprintBodyBlock < s.bodyBlock,
    'half exposed has to sit strictly between no cover and full cover');

  const now = 10_000;
  const base = {
    position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 }, weapon: 'Shield',
    loadout: { main: 'Shield' }, crouching: false, sprinting: false,
    lastShotAt: 0, shieldDamage: 0, shieldStaggeredUntil: 0
  };
  const front = { x: 0, y: 0, z: -10 };
  const hit = (over, headshot = false, dmg = 40, from = front) =>
    core.resolveShieldHit({ ...base, ...over }, from, headshot, dmg, now);

  assert.equal(hit({}).damage, 0, 'standing, a front body shot is absorbed outright');
  assert.equal(hit({ sprinting: true }).damage, 20, 'sprinting, half of it lands');
  assert.equal(hit({ crouching: true }).damage, 0, 'crouched is unchanged');
  // The head is already exposed whenever you are not crouched, so sprinting
  // must not become a way to pick up head cover by accident.
  assert.equal(hit({ sprinting: true }, true, 80).damage, 80,
    'sprinting does not change what a headshot does');
  // Facing still gates everything: a plate dropped to run does not start
  // covering your back.
  assert.equal(hit({ sprinting: true }, false, 40, { x: 0, y: 0, z: 10 }).damage, 40,
    'a shot from behind ignores the shield entirely');
  // Absorbing half means draining half, which is the tradeoff worth keeping
  // honest: sprinting costs health but makes the guard last twice as long.
  assert.equal(hit({ sprinting: true }).absorbed, 20);
  assert.equal(hit({}).absorbed, 40);
});

test('the first-person plate visibly leaves the firing line when sprinting', () => {
  const drop = Number(client.match(/const SHIELD_FP_SPRINT_DROP = ([\d.]+);/u)[1]);
  const raise = Number(client.match(/const SHIELD_FP_COVER_RAISE = ([\d.]+);/u)[1]);
  // The plate is 1.5 tall and rests centred just under the eye line. Dropping
  // it less than a third of its height leaves it still covering the chest,
  // which contradicts what the server now scores.
  assert.ok(drop > 0.5, 'the sprint drop must clear the chest, not jitter');
  assert.ok(drop > raise, 'sprinting must move it further out of the way than crouching moves it in');
  assert.ok(client.includes('const SHIELD_FP_SPRINT_SWING'), 'and swing it outboard');
  assert.ok(client.includes('const SHIELD_FP_SPRINT_ROLL'), 'and roll it edge-on');

  const fn = client.slice(client.indexOf('function updateShieldCoverPose'));
  const body = fn.slice(0, fn.indexOf('\n        function ', 1));
  assert.match(body, /isSprinting/u, 'the drop is gated on sprinting');
  // Same smoothing as the cover raise: a hard snap on a state that flickers
  // every time you release W would strobe the viewmodel.
  assert.match(body, /firstPersonShieldSprint \+= \(\(isSprinting \? 1 : 0\) - firstPersonShieldSprint\) \* step/u);
  // Both offsets are applied from the same captured rest position, so the two
  // states compose instead of each fighting over holder.position.
  assert.match(body, /SHIELD_FP_COVER_RAISE \* cover - SHIELD_FP_SPRINT_DROP \* sprint/u);
});

// Breaking the guard used to be worth doing twice over: it staggered the
// carrier AND leaked whatever the last of the capacity could not cover. The
// closer a shield was to breaking, the less it was worth - which is backwards,
// since the carrier has already paid for every point of guard they spent.
test('a breaking guard does not leak the rest of the round', () => {
  const now = 10_000;
  const base = {
    position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 }, weapon: 'Shield',
    loadout: { main: 'Shield' }, crouching: false, sprinting: false,
    lastShotAt: 0, shieldDamage: 0, shieldStaggeredUntil: 0
  };
  const front = { x: 0, y: 0, z: -10 };
  // An AWP body shot into a guard with one point left. The old rule passed 111
  // of it through; a shield is either up or it is not.
  const awp = core.resolveShieldHit({ ...base, shieldDamage: core.SHIELD.capacity - 1 }, front, false, 112, now);
  assert.equal(awp.damage, 0, 'the round that breaks the plate is still stopped');
  assert.equal(awp.shieldBlocked, true);
  assert.equal(awp.staggered, true);
  assert.equal(awp.shieldDamage, core.SHIELD.capacity, 'the guard cannot bank more than its capacity');

  // Once it is actually broken, the next round goes straight through. That is
  // the stagger doing its job, and it is the only thing that should.
  const after = core.resolveShieldHit(
    { ...base, shieldDamage: core.SHIELD.capacity, shieldStaggeredUntil: now + core.SHIELD.staggerMs },
    front, false, 112, now);
  assert.equal(after.damage, 112, 'a staggered carrier has no cover at all');
  assert.equal(after.shieldBlocked, false);

  // Half cover still only ever stops half. Sprinting exposure is not a leak,
  // so the fix must not quietly promote it to full cover on the breaking hit.
  const sprinting = core.resolveShieldHit(
    { ...base, sprinting: true, shieldDamage: core.SHIELD.capacity - 1 }, front, false, 112, now);
  assert.equal(sprinting.damage, 56, 'the exposed half still lands');
  assert.equal(sprinting.staggered, true);
});
