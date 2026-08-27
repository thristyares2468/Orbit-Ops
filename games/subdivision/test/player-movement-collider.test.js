// Last updated: 17 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

assert.match(
  html,
  /const PLAYER_MOVEMENT_COLLIDER = Object\.freeze\(\{\s*radius: 1\.55,\s*topInset: 1\.35,\s*skin: 0\.08\s*\}\);/,
  'the movement collider should remain thinner and shorter than the visible damage hitboxes'
);
assert.match(
  html,
  /function movementColliderHeight\(eyeHeight = currentHeight\)[\s\S]*?eyeHeight - PLAYER_MOVEMENT_COLLIDER\.topInset/,
  'the movement collider height should be derived from eye height with an inset top'
);
assert.match(
  html,
  /function allowedPlayerUpwardMovement[\s\S]*?currentTop = playerPos\.y - PLAYER_MOVEMENT_COLLIDER\.topInset[\s\S]*?for \(const offset of collisionFootprint\)[\s\S]*?intersectObjects\(mapObjects, false\)/,
  'ceiling collision should sweep upward across the movement collider footprint'
);
assert.match(
  html,
  /function movePlayerVertically[\s\S]*?allowedPlayerUpwardMovement[\s\S]*?velocity\.y = Math\.min\(0, velocity\.y\)/,
  'blocked upward movement should stop vertical velocity'
);
assert.match(
  html,
  /const PLAYER_MAX_STEP_HEIGHT = 7\.0;[\s\S]*?const feetY = newPos\.y - currentHeight;[\s\S]*?feetY \+ Math\.max\(PLAYER_MAX_STEP_HEIGHT \+ PLAYER_MOVEMENT_COLLIDER\.skin, colliderHeight \* 0\.22\)[\s\S]*?feetY \+ colliderHeight \* 0\.82/,
  'horizontal collision samples should begin above the allowed stair riser and remain anchored through the compact body'
);
assert.match(
  html,
  /const maxStepHeight = PLAYER_MAX_STEP_HEIGHT;[\s\S]*?feetY \+ Math\.max\(maxStepHeight \+ PLAYER_MOVEMENT_COLLIDER\.skin, colliderHeight \* 0\.22\)[\s\S]*?hitY <= currentFeet \+ maxStepHeight/,
  'the active movement solver should use the same stair allowance as its lowest wall probe'
);
assert.match(
  html,
  /requestedHeightDelta > 0[\s\S]*?allowedPlayerUpwardMovement\(controls\.getObject\(\)\.position, requestedHeightDelta\)/,
  'standing from crouch should respect overhead clearance'
);
assert.match(
  html,
  /movePlayerVertically\(playerPos, velocity\.y \* delta\)/,
  'the active movement loop should apply vertical movement through the ceiling solver'
);
assert.match(
  html,
  /movePlayerVertically\(playerPos, velocity\.y \* step\)/,
  'paused vertical physics should apply the same ceiling solver'
);

console.log('player-movement-collider: foot-anchored compact body and multi-point ceiling sweep verified.');
