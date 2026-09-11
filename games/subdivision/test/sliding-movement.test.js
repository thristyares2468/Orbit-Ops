// Last updated: 11 September 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

assert.match(
  html,
  /const SPRINT_SPEED_MULTIPLIER = 1\.3;[\s\S]*?const SLIDE_DURATION_MS = 850;[\s\S]*?const SLIDE_ENTRY_SPEED_MULTIPLIER = 1\.08;[\s\S]*?const SLIDE_MIN_ENTRY_RATIO = 0\.8;[\s\S]*?const SLIDE_EXIT_SPEED_RATIO = 0\.5;[\s\S]*?const SLIDE_STEER_RATIO = 0\.24;/,
  'sprint and slide should use conservative tactical movement tuning'
);
assert.match(
  html,
  /function tryStartSlide\(time, onGround, currentSpeed, movementSpeedScale\) \{[\s\S]*?if \(isSliding \|\| !slideReady \|\| !onGround \|\| !crouchHeld \|\| !moveForward \|\| moveBackward\) return false;[\s\S]*?const inheritedSpeed = Math\.max[\s\S]*?slideReady = false[\s\S]*?slideStartSpeed = inheritedSpeed \* SLIDE_ENTRY_SPEED_MULTIPLIER;[\s\S]*?setCrouchState\(true, true\)/,
  'holding crouch while moving forward should inherit and slightly amplify entry momentum once per press'
);
assert.match(
  html,
  /if \(isSliding && \(!crouchHeld \|\| !moveForward \|\| moveBackward \|\| isJumping \|\| wasAirborneLastFrame \|\| time - slideStartedAt >= SLIDE_DURATION_MS\)\) stopSlide\(\);/,
  'releasing crouch or forward, reversing, jumping, or reaching the duration should stop a slide'
);
assert.match(
  html,
  /else if \(isSliding\)[\s\S]*?THREE\.MathUtils\.lerp\(slideStartSpeed, slideEndSpeed, easedProgress\)[\s\S]*?velocity\.x = THREE\.MathUtils\.lerp[\s\S]*?velocity\.z = slideSpeed;/,
  'active slides should decay forward speed and permit only controlled lateral steering'
);
assert.match(
  html,
  /sprint: 'ShiftLeft'[\s\S]*?isSprinting = sprintHeld && moveForward[\s\S]*?speedParam = runSpeed \* SPRINT_SPEED_MULTIPLIER/,
  'Left Shift should sprint only while the player is intentionally moving forward'
);
assert.match(
  html,
  /last\.sprinting !== isSprinting[\s\S]*?last\.sliding !== isSliding[\s\S]*?sprinting: isSprinting[\s\S]*?sliding: isSliding/,
  'sprint and slide state should be synchronized for remote animation'
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

console.log('sliding-movement: Shift sprint, inherited slide momentum, networking, collision, and lifecycle resets verified.');
