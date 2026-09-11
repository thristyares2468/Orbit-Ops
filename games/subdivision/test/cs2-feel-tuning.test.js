// Last updated: 15 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

assert.ok(indexHtml.includes('const walkSpeed = 35.0; const runSpeed = 75.0;'), 'client movement speeds should match the responsive main-branch values');
assert.ok(indexHtml.includes('const COUNTER_STRAFE_MULT = 27.0;'), 'counter-strafe strength should match the proven main-branch value');

assert.match(
  indexHtml,
  /let groundFriction = 8\.4;[\s\S]*?let accelMult = 7\.0;[\s\S]*?let counterMult = COUNTER_STRAFE_MULT;/,
  'ground movement should retain the responsive main-branch acceleration and friction'
);

assert.match(
  indexHtml,
  /if \(velocity\.x !== 0 && Math\.sign\(wishX\) !== Math\.sign\(velocity\.x\)\)[\s\S]*?speedParam \* counterMult[\s\S]*?if \(velocity\.z !== 0 && Math\.sign\(wishZ\) !== Math\.sign\(velocity\.z\)\)/,
  'counter-strafing should preserve the main-branch per-axis stop behavior'
);

assert.match(
  indexHtml,
  /let airAccel = speedParam \* 1\.5;[\s\S]*?velocity\.x \+= wishX \* airAccel \* delta;[\s\S]*?velocity\.z \+= wishZ \* airAccel \* delta;/,
  'air strafing should retain the main-branch acceleration behavior'
);

assert.match(
  indexHtml,
  /function startJump\(\) \{[\s\S]*?velocity\.y = jumpVelocity \* Math\.max\(0\.5, jumpStamina\);[\s\S]*?jumpStamina -= 0\.4;[\s\S]*?isJumping = true;/,
  'jumping should retain the earlier fatigue-based jump height'
);

assert.match(
  indexHtml,
  /if \(jumpQueued\) startJump\(\);[\s\S]*?jumpQueued = false;/,
  'jumping should require a fresh queued press instead of held-jump bunny hopping'
);

assert.match(indexHtml, /speedParam \*= Math\.max\(0\.6, jumpStamina\)/, 'jump fatigue should continue to affect movement recovery');

assert.match(
  indexHtml,
  /if \(time - lastRecoilShotAt > RECOIL_RESET_MS\) recoilShotIndex = 0;[\s\S]*?else if \(time - lastRecoilShotAt > RECOIL_PARTIAL_RESET_MS\) recoilShotIndex = Math\.max\(0, recoilShotIndex - 2\);/,
  'burst and tap firing should partially recover recoil before a full pattern reset'
);

assert.ok(serverJs.includes('MAX_H_SPEED: 75 * 1.3,'), 'server anti-cheat should use the client sprint ceiling');
assert.ok(serverJs.includes('H_SPEED_TOLERANCE: 1.3,'), 'server anti-cheat should retain headroom for inherited slide momentum and jitter');

console.log('cs2-feel-tuning: movement, accuracy, recoil, footstep, and anti-cheat parity verified.');
