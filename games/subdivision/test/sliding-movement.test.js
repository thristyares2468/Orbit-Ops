// Last updated: 11 September 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

assert.match(
  html,
  /const SLIDE_DURATION_MS = 850;[\s\S]*?const SLIDE_START_SPEED = 96;[\s\S]*?const SLIDE_END_SPEED = 38;[\s\S]*?const SLIDE_STEER_RATIO = 0\.24;/,
  'sliding should have a short, decelerating momentum window with limited steering'
);
assert.match(
  html,
  /function tryStartSlide\(time, onGround\)[\s\S]*?!slideReady[\s\S]*?!onGround[\s\S]*?!crouchHeld[\s\S]*?!moveForward[\s\S]*?moveBackward[\s\S]*?slideReady = false[\s\S]*?setCrouchState\(true, true\)/,
  'holding crouch while moving forward on the ground should start one slide per crouch press'
);
assert.match(
  html,
  /if \(isSliding && \(!crouchHeld \|\| !moveForward \|\| moveBackward \|\| isJumping \|\| wasAirborneLastFrame \|\| time - slideStartedAt >= SLIDE_DURATION_MS\)\) stopSlide\(\);/,
  'releasing crouch or forward, reversing, jumping, or reaching the duration should stop a slide'
);
assert.match(
  html,
  /else if \(isSliding\)[\s\S]*?THREE\.MathUtils\.lerp\(SLIDE_START_SPEED, SLIDE_END_SPEED, easedProgress\)[\s\S]*?velocity\.x = THREE\.MathUtils\.lerp[\s\S]*?velocity\.z = slideSpeed;/,
  'active slides should decay forward speed and permit only controlled lateral steering'
);
assert.match(
  html,
  /controls\.moveRight\(velocity\.x \* delta\);[\s\S]*?controls\.moveForward\(velocity\.z \* delta\);[\s\S]*?raycaster\.intersectObjects\(mapObjects, false\)/,
  'slide displacement should pass through the existing collision-aware movement solver'
);
assert.match(
  html,
  /crouchHeld = false;[\s\S]*?stopSlide\(\{ resetInput: true \}\);[\s\S]*?velocity\.set\(0, 0, 0\);/,
  'death and spawn resets should not preserve slide momentum'
);

console.log('sliding-movement: crouch-forward activation, momentum decay, collision path, and lifecycle resets verified.');
