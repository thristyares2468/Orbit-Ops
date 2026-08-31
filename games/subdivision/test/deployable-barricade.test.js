'use strict';

// The deployable barricade spans core.js (shared geometry), server.js (placement
// authority + health) and index.html (preview, mesh, hit reporting). Nothing here
// needs a browser: the shared table is required directly, and the two runtimes are
// checked against the rules they must not lose in a merge.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const core = require('../core');

const ROOT = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('core carries one authoritative barricade table', () => {
  const barricade = core.BARRICADE;
  assert.ok(barricade, 'core must export BARRICADE');
  assert.ok(barricade.width > 0 && barricade.height > 0 && barricade.thickness > 0);
  // Tall enough to stop a step-up and to crouch behind, short enough to shoot over.
  assert.ok(barricade.height > 7, 'a barricade must not be steppable');
  assert.ok(barricade.height < 18, 'a barricade must not be a full wall');
  assert.ok(barricade.deployDistance >= barricade.minRange, 'the fixed deploy spot must clear the minimum range');
  assert.ok(barricade.deployDistance <= barricade.deployRange, 'the fixed deploy spot must sit inside the server bound');
  assert.ok(barricade.spacing > barricade.deployDistance - barricade.minRange, 'spacing must stop panels being chained');
  assert.ok(barricade.health >= 100, 'a barricade must survive more than one bullet');
});

test('the barricade is a priced utility kind with its own life cap', () => {
  assert.equal(typeof core.UTILITY_PRICES.barricade, 'number');
  assert.ok(core.UTILITY_PRICES.barricade > 0);
  assert.equal(core.UTILITY_LIFE_CAPS.barricade, 1, 'persistent cover is capped tighter than a grenade');
});

test('Barricade is appended to the weapon tables without moving existing indexes', () => {
  // The snapshot encoder sends this index over the wire; renumbering it would
  // silently repaint every remote player's weapon.
  assert.deepEqual(core.WEAPON_NAMES.slice(19, 24), ['Frag', 'Smoke', 'Flash', 'Molotov', 'Barricade']);
  assert.equal(core.weaponIndexFromName('Barricade'), 23);
  assert.equal(core.WEAPONS.Barricade.type, 'utility');
  assert.equal(core.WEAPONS.Barricade.dmg.body, 0, 'the deployable itself never deals damage');
});

test('the client exposes the barricade as a utility slot', () => {
  assert.match(client, /const GRENADE_KINDS = \[[^\]]*'barricade'/, 'HUD, buy menu and rebuy all iterate GRENADE_KINDS');
  assert.match(client, /grenadeWeaponIndex = \{[^}]*barricade: 23/);
  assert.match(client, /name: 'Barricade', type: 'grenade', kind: 'barricade'/, 'typed as utility so ammo/reload rules already apply');
  assert.match(client, /utilityBarricade: 'Digit8'/, 'the barricade needs its own bindable key');
  assert.match(client, /\['barricade', 'utilityBarricade', 'Barricade'\]/, 'the utility HUD lists it with its bind');
});

test('a deployed panel is solid cover on the client', () => {
  // Pushing the panel into both lists is what gives it bullet blocking, player
  // collision and grenade bounces for free.
  assert.match(client, /objects\.push\(body\);\s*\n\s*mapObjects\.push\(body\);/);
  assert.match(client, /isBarricadePanel/, 'the panel is tagged so penetration can exclude it');
  assert.match(
    client,
    /function isWallbangSurface\(hitOrObj\)[\s\S]{0,400}?isBarricadePanel\) return false;/,
    'bullets must not pass through a live barricade'
  );
  assert.match(client, /barricadeId;\s*\n\s*if \(barricadeId\) \{\s*\n\s*reportBarricadeHit/, 'bullet impacts report to the server');
});

test('the client never places a panel on its own authority', () => {
  const deploy = client.slice(client.indexOf('function attemptDeployBarricade'));
  const body = deploy.slice(0, deploy.indexOf('\n        }\n'));
  assert.match(body, /sendPacket\('deployBarricade'/);
  assert.doesNotMatch(body, /spawnBarricade\(/, 'the panel appears only from the server broadcast');
  assert.match(client, /type === 'barricadePlaced'[\s\S]{0,160}spawnBarricade\(data\)/);
  assert.match(client, /type === 'barricadeRemoved'[\s\S]{0,160}removeBarricadeById/);
});

test('the barricade is deployed, never thrown', () => {
  assert.match(client, /if \(wp\.kind === 'barricade'\) \{ attemptDeployBarricade\(\); return; \}/);
  assert.match(client, /function throwGrenadeWithCharge[\s\S]{0,300}?if \(kind === 'barricade'\) return;/);
  assert.match(server, /function sanitizeGrenadeKind[\s\S]{0,200}?'molotov' \? value : 'frag'/,
    'the throw/burst paths must keep rejecting the barricade kind');
});

test('the server owns placement, health and cleanup', () => {
  assert.match(server, /ROUND_LOCKED_MESSAGES = new Set\(\[[\s\S]*?'deployBarricade', 'barricadeDamage'/);
  assert.match(server, /type === 'deployBarricade'/);
  assert.match(server, /type === 'barricadeDamage'/);
  assert.match(server, /barricadesDeployedThisLife \|\| 0\) >= barricadeAllowance\(room, player\)/, 'the allowance is checked server-side');
  assert.match(server, /const damage = melee \? 45 : Math\.max\(1, Math\.round\(wdef\.dmg\.body \* BARRICADE\.bulletScale\)\)/,
    'client-reported damage is never trusted');
  assert.match(server, /damageRateOk\(player\.ac, weapon, wdef, now, 'barricadeBucket'\)/, 'panel fire has its own rate bucket');
  assert.match(server, /if \(kind === 'frag' && position\) damageBarricadesFromFrag/);
  assert.match(server, /removeBarricadesOwnedBy\(roomCode, room, id\)/, 'a leaving player takes their panels with them');
  // Every round reset that clears fire and smoke must clear panels too.
  const resets = server.match(/room\.recentBursts = \[\];\n\s*clearRoomBarricades\(room\);/g) || [];
  assert.equal(resets.length, 4, 'all four round resets clear deployed barricades');
  assert.match(server, /barricades: publicBarricades\(room\)/, 'late joiners receive the live panels');
});

test('placement yaw turns the panel face toward the player', () => {
  // Mirrors the client: rotation.y = atan2(-fx, -fz) must send the panel's local
  // -Z (its wide face) away from the player, so its width blocks the view.
  const rotateY = (v, angle) => ({
    x: v.x * Math.cos(angle) + v.z * Math.sin(angle),
    z: -v.x * Math.sin(angle) + v.z * Math.cos(angle)
  });
  for (const heading of [0, 0.4, 1.9, -2.7, Math.PI]) {
    const forward = { x: Math.sin(heading), z: Math.cos(heading) };
    const yaw = Math.atan2(-forward.x, -forward.z);
    const face = rotateY({ x: 0, z: -1 }, yaw);   // panel front
    const span = rotateY({ x: 1, z: 0 }, yaw);    // panel width
    assert.ok(Math.abs(face.x - forward.x) < 1e-9 && Math.abs(face.z - forward.z) < 1e-9,
      'the panel front points where the player is looking');
    assert.ok(Math.abs(span.x * forward.x + span.z * forward.z) < 1e-9,
      'the width sits across the line of sight');
  }
});
