'use strict';

// The remote C4 charge. What matters here is the pair of rules that make it a
// charge rather than a hand grenade: it only arms after a delay, and only its
// planter can set it off. Both are the server's to enforce, so both are pinned.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const core = require('../core');

const ROOT = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('core carries one authoritative C4 table', () => {
  const c4 = core.C4;
  assert.ok(c4, 'core must export C4');
  assert.equal(c4.armDelayMs, 2000, 'the charge arms two seconds after it is planted');
  assert.ok(c4.radius > 0 && c4.maxDamage > 0);
  assert.ok(c4.selfScale > 0 && c4.selfScale < 1, 'the planter takes a reduced share of their own blast');
  assert.ok(c4.deployDistance >= c4.minRange && c4.deployDistance <= c4.deployRange);
  assert.ok(c4.health > 0, 'a planted charge must be shootable');
  assert.equal(core.UTILITY_LIFE_CAPS.c4, 1);
  assert.equal(typeof core.UTILITY_PRICES.c4, 'number');
  assert.ok(core.UTILITY_PRICES.c4 > 0);
});

test('C4 is appended to the weapon tables without moving existing indexes', () => {
  assert.deepEqual(core.WEAPON_NAMES.slice(19, 25), ['Frag', 'Smoke', 'Flash', 'Molotov', 'Barricade', 'C4']);
  assert.equal(core.weaponIndexFromName('C4'), 24);
  assert.equal(core.WEAPONS.C4.type, 'utility');
});

test('the client exposes C4 as a utility slot', () => {
  assert.match(client, /const GRENADE_KINDS = \[[^\]]*'c4'/);
  assert.match(client, /grenadeWeaponIndex = \{[^}]*c4: 24/);
  assert.match(client, /name: 'C4', type: 'grenade', kind: 'c4'/);
  assert.match(client, /utilityC4: 'Digit9'/);
  assert.match(client, /\['c4', 'utilityC4', 'C4'\]/);
});

test('one button plants, then detonates', () => {
  const use = client.slice(client.indexOf('function useC4()'));
  const body = use.slice(0, use.indexOf('\n        }\n'));
  assert.match(body, /const live = myLiveC4Charge\(\);/);
  assert.match(body, /if \(now < live\.userData\.armsAtLocal\)/, 'the arming delay is respected before detonating');
  assert.match(body, /sendPacket\('detonateC4'/);
  assert.match(body, /sendPacket\('deployC4'/);
  assert.ok(body.indexOf("sendPacket('detonateC4'") < body.indexOf("sendPacket('deployC4'"),
    'a live charge takes priority over planting another');
  // The slot has to stay drawable with an empty inventory, or the detonator is
  // unreachable the moment the charge is planted.
  assert.match(client, /const holdsDetonator = kind === 'c4' && !!myLiveC4Charge\(\);/);
  assert.match(client, /if \(wp\.kind === 'c4'\) \{ useC4\(\); return; \}/);
});

test('arming is timed from the placement landing, not a shared clock', () => {
  assert.match(client, /function c4ArmDelayRemaining[\s\S]{0,320}?Math\.max\(0, Math\.min\(C4\.armDelayMs, serverRemaining\)\)/);
  assert.match(client, /armsAtLocal = performance\.now\(\) \+ c4ArmDelayRemaining\(record\)/);
});

test('the server owns arming, ownership and cleanup', () => {
  assert.match(server, /ROUND_LOCKED_MESSAGES = new Set\(\[[\s\S]*?'deployC4', 'detonateC4', 'c4Damage'/);
  assert.match(server, /armsAt: now \+ C4\.armDelayMs/);
  assert.match(server, /charge\.ownerId === client\.id/, 'only the planter may detonate');
  assert.match(server, /const armed = mine\.filter\(charge => now >= charge\.armsAt\);/);
  assert.match(server, /if \(!armed\.length\)[\s\S]{0,140}?'The charge is still arming\.'/);
  assert.match(server, /c4DeployedThisLife \|\| 0\) >= c4Allowance\(room, player\)/);
  assert.match(server, /removeC4ChargesOwnedBy\(roomCode, room, player\.id, 'owner-died'\)/, 'a dead planter cannot detonate');
  assert.match(server, /removeC4ChargesOwnedBy\(roomCode, room, id, 'left'\)/);
  const resets = server.match(/clearRoomBarricades\(room\);\n\s*clearRoomC4Charges\(room\);/g) || [];
  assert.equal(resets.length, 4, 'all four round resets clear planted charges');
  assert.match(server, /c4Charges: publicC4Charges\(room\)/);
});

test('blast damage is server-validated against the detonation', () => {
  assert.match(server, /data\.kind === 'c4'[\s\S]{0,220}?c4DamageFor\(room, client\.id, target, now\)/);
  assert.match(server, /resolvedWeapon = 'C4';/);
  assert.match(server, /function c4DamageFor[\s\S]{0,420}?burst\.ownerId !== ownerId\) continue;/);
  assert.match(server, /function c4DamageFor[\s\S]{0,520}?now - burst\.ts > GRENADE_HIT_WINDOW_MS\) break;/);
  // Its own burst list: sharing recentBursts would let a detonation pay out as
  // frag damage and vice versa.
  assert.match(server, /room\.recentC4Bursts\.push\(/);
  assert.match(client, /sendPacket\('playerHit', \{ targetId: id, kind: 'c4', damage \}\)/);
});

test('shooting a charge destroys it instead of setting it off', () => {
  const handler = server.slice(server.indexOf("if (type === 'c4Damage')"));
  const body = handler.slice(0, handler.indexOf('\n  if (type ==='));
  assert.match(body, /broadcastToRoom\([^\n]*'c4Removed', \{ id: charge\.id, reason: 'destroyed'/);
  assert.doesNotMatch(body, /detonateC4Charge/, 'destroying a charge must never trigger the blast');
  assert.match(client, /const c4Id = hit\.object\?\.userData\?\.c4Id;[\s\S]{0,140}?reportC4Hit/);
});

test('the authored charge model is wired to the asset loader', () => {
  const glb = path.join(ROOT, 'assets/weapons/c4.glb');
  assert.ok(fs.existsSync(glb), 'the C4 model must ship with the client');
  const bytes = fs.readFileSync(glb);
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF', 'weapon models are binary glTF');
  assert.ok(bytes.length < 1.5 * 1024 * 1024, 'a utility model should stay in weapon-model territory');
  assert.match(client, /'C4': \{ path: '\/assets\/weapons\/c4\.glb', axis: 'z'/);
  // The asset is the charge; the detonator that replaces it is procedural, so
  // the loader must be skipped in that state or it overwrites the view model.
  // Order, not adjacency: other weapons guard the same call, and the parent it
  // attaches to has been renamed once already.
  const build = client.slice(client.indexOf('function buildGunModel'));
  const guard = build.indexOf("wp.kind === 'c4' && myLiveC4Charge()");
  const attach = build.indexOf('attachWeaponAsset(');
  assert.ok(guard > 0 && attach > guard, 'the C4 detonator guard must run before the asset is attached');
  // Clones share the cache's geometry and textures - removing a charge must not
  // dispose them, or the next charge renders broken.
  assert.match(client, /model\.userData\.isSharedAsset = true;/);
  assert.match(client, /if \(child\.userData\?\.isSharedAsset\) continue;/);
});

test('a live charge is never a wallbang surface and never blocks movement', () => {
  assert.match(client, /isBarricadePanel \|\| obj\?\.userData\?\.isC4Charge\) return false;/);
  const spawn = client.slice(client.indexOf('function spawnC4Charge'));
  const body = spawn.slice(0, spawn.indexOf('\n        }\n'));
  assert.match(body, /objects\.push\(body\);/);
  assert.doesNotMatch(body, /mapObjects\.push/, 'a charge is shootable but must not be world collision');
});
