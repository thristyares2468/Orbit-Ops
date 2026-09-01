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

console.log('admin dummy spawn tests passed');
