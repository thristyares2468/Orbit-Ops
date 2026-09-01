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

test('core carries one authoritative shield table', () => {
  const shield = core.SHIELD;
  assert.ok(shield, 'core must export SHIELD');
  assert.equal(shield.weapon, 'Shield');
  assert.ok(shield.bodyBlock > 0 && shield.bodyBlock < 1, 'a shield reduces damage, it does not erase it');
  assert.equal(shield.headBlock, 0, 'standing, the head is above the shield');
  assert.equal(shield.crouchHeadBlock, shield.bodyBlock, 'crouched, the carrier is behind it completely');
  assert.ok(shield.fireLockoutMs > 0, 'firing has to drop the guard');
  assert.ok(shield.arcCos > 0 && shield.arcCos < 1, 'cover is a frontal arc, not all-round');
  assert.equal(core.WEAPONS.Shield.type, 'shield');
  assert.equal(core.WEAPONS.Shield.dmg.body, 0, 'a shield deals no damage');
  assert.equal(core.weaponIndexFromName('Shield'), 26);
  assert.equal(core.UTILITY_LIFE_CAPS.shield, 1);
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

test('every condition for cover is checked server-side', () => {
  const fn = server.slice(server.indexOf('function shieldBlockFraction'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /target\.weapon !== SHIELD\.weapon/, 'the shield has to be the held weapon');
  assert.match(body, /utilityPurchasedThisLife\?\.shield\) > 0/, 'and one that was actually bought this life');
  assert.match(body, /now - Number\(target\.lastShotAt \|\| 0\) < SHIELD\.fireLockoutMs/, 'and not just used to shoot with');
  assert.match(body, /dot\(forwardFlat, toAttacker\) < SHIELD\.arcCos/, 'and hit from within the frontal arc');
  assert.match(body, /headshot\) return target\.crouching \? SHIELD\.crouchHeadBlock : SHIELD\.headBlock/);
  assert.doesNotMatch(body, /data\./, 'nothing here may be read off the packet');
  assert.match(server, /player\.lastShotAt = now;/, 'firing has to stamp the lockout');
});

test('cover applies to direct fire only', () => {
  // The grenade / molotov / C4 branches set their own damage above this point,
  // so utility keeps working on someone hiding behind a shield.
  const hit = server.slice(server.indexOf('function handlePlayerHit'));
  const block = hit.indexOf('shieldBlockFraction(target, player.position');
  const utility = hit.indexOf("data.kind === 'c4'");
  assert.ok(block > utility, 'the block must sit in the direct-fire branch, after the utility branches');
  assert.match(server, /damage = Math\.max\(1, Math\.round\(damage \* \(1 - blocked\)\)\)/, 'a blocked hit still chips');
});

test('the client holds it, never fires it, and cannot get one free', () => {
  assert.match(client, /name: 'Shield', type: 'shield', kind: 'shield'/);
  assert.match(client, /if \(wp\.type === 'shield'\) return;/, 'shoot() must refuse the shield outright');
  assert.match(client, /const PURCHASE_ONLY_UTILITY = new Set\(\['shield'\]\);/);
  assert.match(client, /GRENADE_KINDS\.filter\(kind => !PURCHASE_ONLY_UTILITY\.has\(kind\)\)/,
    'a spawn must not hand out a shield, since the server only honours a purchased one');
  assert.match(client, /utilityShield: 'Digit0'/);
  assert.match(client, /\['shield', 'utilityShield', 'Shield'\]/);
  assert.match(client, /speedMult: 0\.72/, 'carrying a shield has to cost movement');
  // The standing/crouched rule is invisible unless the HUD says it.
  assert.match(client, /isCrouching \? 'FULL COVER' : 'HEAD EXPOSED'/);
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
