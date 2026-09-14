const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.match(
  server,
  /const eyePosition = sanitizeVector\(data\.eyePosition, player\.position\);[\s\S]*?y: eyePosition\.y - \(crouching \? ADMIN_DUMMY_CROUCH_EYE_HEIGHT : ADMIN_DUMMY_STAND_EYE_HEIGHT\)/,
  'the server should convert the spawning player eye position to the dummy feet origin'
);
assert.match(
  client,
  /function summonAdminDummy\(\)[\s\S]*?sendImmediatePlayerState\(\);[\s\S]*?sendPacket\('adminSummonDummy', \{[\s\S]*?eyePosition: vecObj\(eye\)[\s\S]*?crouching: isCrouching/,
  'the summon packet should carry the current player position and stance after an immediate state update'
);

const spawnDummy = client.match(/function spawnAdminDummy\(def\) \{[\s\S]*?\n        \}/)?.[0] || '';
assert.doesNotMatch(spawnDummy, /group\.scale\.setScalar/, 'dummy hitboxes must not be scaled away from normal player dimensions');
assert.match(spawnDummy, /isRemotePlayer: true/, 'dummies should use the normal imported player-model adapter');
assert.match(spawnDummy, /applyBackroomsCharacterModel\(group\)/, 'dummies should request the visible team player model');
assert.match(
  client,
  /function updateAdminDummyPoses\(delta, time\)[\s\S]*?data\.isMoving = false;[\s\S]*?updateCharacterAssetAnimation\(group, delta, time\);/,
  'stationary dummies should still advance the normal player idle/aim animation and grounding pass'
);
assert.match(
  client,
  /updateRemotePlayerPoses\(delta, time\);\s*updateAdminDummyPoses\(delta, time\);/,
  'the gameplay frame loop should update dummy poses beside normal remote players'
);

// --- what the dummy is holding ----------------------------------------------

const core = require('../core');

// The picker, the summon packet and the server gate must all read the SAME
// list. A hand-written list in the panel would drift the moment a weapon is
// added, and the dummy would either be unarmable or armed with a name no
// other client can build a model for.
assert.match(
  client,
  /function adminDummyWeaponNames\(\) \{\s*return window\.GameCore\?\.WEAPON_NAMES/,
  'the dummy weapon picker must come from the shared core list'
);
assert.match(
  server,
  /function adminDummyWeapon\(name\) \{[\s\S]*?WEAPON_NAMES\.includes\(wanted\) \? wanted : 'AK47'/,
  'the server must validate a dummy weapon against the shared list and fall back to AK47'
);
assert.ok(core.WEAPON_NAMES.includes('AK47'), 'AK47 must remain a real name to fall back to');
assert.match(
  client,
  /function summonAdminDummy\(\)[\s\S]*?weapon: selectedAdminDummyWeapon\(\)/,
  'the summon packet should carry the chosen weapon'
);
assert.match(
  server,
  /const dummy = \{[\s\S]*?weapon: adminDummyWeapon\(data\.weapon\)/,
  'a summoned dummy should be stored with a validated weapon'
);

// Ordering: refreshRemoteThirdPersonWeapon reads userData.weapon and otherwise
// falls through to its own AK47 default, so setting the weapon after the
// refresh would build the wrong model and only self-correct on the next sync.
const spawnWithWeapon = client.match(/function spawnAdminDummy\(def\) \{[\s\S]*?\n        \}/)?.[0] || '';
const weaponAssign = spawnWithWeapon.indexOf('group.userData.weapon =');
const weaponRefresh = spawnWithWeapon.indexOf('refreshRemoteThirdPersonWeapon(group)');
assert.ok(weaponAssign > 0, 'a spawning dummy must be given its weapon');
assert.ok(weaponAssign < weaponRefresh, 'the weapon must be set before the third-person model is built');

// Re-arming what is already standing there, rather than clear-and-resummon.
assert.match(
  server,
  /if \(type === 'adminSetDummyWeapon'\) \{\s*if \(client\.roomCode !== ADMIN_ROOM_CODE \|\| !isAdminUser\(client\)\) return;/,
  'the re-arm handler must be gated on the admin room AND an admin account'
);
assert.match(
  server,
  /for \(const dummy of room\.adminDummies\.values\(\)\) dummy\.weapon = weapon;[\s\S]*?broadcastToRoom\(client\.roomCode, null, 'adminDummyWeapon', \{ weapon \}\)/,
  're-arming must update room state and tell every client in the room'
);
assert.match(
  client,
  /type === 'adminDummyWeapon'\) \{\s*setAllAdminDummyWeapons\(data\?\.weapon\);/,
  'the client must apply a broadcast re-arm'
);
assert.match(
  client,
  /function applyAdminDummyWeapon\(group, weapon\) \{[\s\S]*?adminDummyWeaponNames\(\)\.includes\(weapon\) \? weapon : ADMIN_DUMMY_DEFAULT_WEAPON;[\s\S]*?refreshRemoteThirdPersonWeapon\(group\)/,
  'applying a weapon must re-validate it and rebuild the held model'
);

console.log('admin dummy spawn tests passed');
