// Last updated: 15 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const antifloodJs = fs.readFileSync(path.join(ROOT, 'antiflood.js'), 'utf8');

// Regression checks for deliberately generous gameplay packet limits and stricter
// economy/admin packet throttles. This protects normal latency while blocking spam.
assert.match(
  antifloodJs,
  /playerShoot: \{ ratePerSec: 80, burst: 48 \},[\s\S]*?playerHit: \{ ratePerSec: 120, burst: 72 \},/,
  'shoot/hit packet rate limits should be generous enough for full-auto, shotgun pellets, and jitter bunching'
);

assert.match(
  antifloodJs,
  /openCase: \{ ratePerSec: 0\.15, burst: 1 \},[\s\S]*?openCaseTest: \{ ratePerSec: 0\.15, burst: 1 \},[\s\S]*?getCaseEditor: \{ ratePerSec: 0\.5, burst: 2 \},[\s\S]*?saveCaseDefinition: \{ ratePerSec: 0\.25, burst: 2 \},[\s\S]*?deleteCaseDefinition: \{ ratePerSec: 0\.25, burst: 2 \},[\s\S]*?marketCreateListing: \{ ratePerSec: 0\.5, burst: 2 \},[\s\S]*?marketBuyListing: \{ ratePerSec: 0\.35, burst: 2 \},[\s\S]*?tradeRequestCreate: \{ ratePerSec: 0\.5, burst: 2 \},[\s\S]*?tradeRespond: \{ ratePerSec: 0\.5, burst: 2 \},/,
  'economy/dev endpoints should have explicit low-rate buckets against console spam'
);

assert.match(
  serverJs,
  /client\.caseOpenBusyUntil = Date\.now\(\) \+ 7000;/,
  'admin case test opening should have a server-side cooldown in addition to packet flood limits'
);

assert.match(
  serverJs,
  /function suppressRoundProgression\(room, reason = 'untrusted'\) \{[\s\S]*?room\.progressionSuppressedRound = true;/,
  'server should mark rounds tainted when suspicious hit packets appear'
);

assert.match(
  indexHtml,
  /const bulletSfx = \{[\s\S]*?nearmiss:[\s\S]*?rics:[\s\S]*?tink:/,
  'client should load near-miss, ricochet, and casing-tink bullet SFX packs'
);

assert.match(
  indexHtml,
  /function shoot\(isAlt = false\) \{[\s\S]*?soundShoot\(wp\.name, null, \{ heavy: isAlt \}\); lastFireTime = time; lastLocalShotAt = time;/,
  'local weapon audio should use the non-spatial first-person shot path'
);

assert.doesNotMatch(
  indexHtml,
  /function shoot\(isAlt = false\) \{[\s\S]*?soundNearMiss\(/,
  'local player bullets should never create near-miss/flyby SFX'
);

assert.match(
  indexHtml,
  /const weaponName = shot\.weapon \|\| remote\?\.userData\.weapon \|\| 'AK47';[\s\S]*?soundShoot\(weaponName, start,[\s\S]*?if \(weaponName === 'Knife' \|\| \['Frag', 'Smoke', 'Flash', 'Molotov'\]\.includes\(weaponName\)\) return;[\s\S]*?soundNearMiss\(start, target, weaponName\);[\s\S]*?const surfaceHit = bulletSurfaceHitAlongSegment\(start, target\);[\s\S]*?soundImpact\(surfaceHit\?\.point \|\| target, surfaceHit\);/,
  'remote weapon audio should originate from shot start, skip knife/grenade flyby paths, and resolve the hit material'
);

assert.match(
  indexHtml,
  /sendShotPacket\(\);[\s\S]{0,220}sendPacket\('playerHit', \{[\s\S]{0,520}targetId: pGroup\.userData\.remoteId,/,
  'direct remote hits should send playerShoot before playerHit so server correlation sees the shot'
);

assert.match(
  indexHtml,
  /targetPoint\.copy\(wallbangHit\.point\);[\s\S]*?sendShotPacket\(\);[\s\S]*?sendPacket\('playerHit', \{/,
  'wallbang remote hits should send playerShoot before playerHit so server correlation sees the shot'
);

assert.match(
  indexHtml,
  /const EMBEDDED_AGENT_IMPORTED_LOCOMOTION = true;[\s\S]*?function embeddedAgentLocomotionClip[\s\S]*?rootMotionTrack[\s\S]*?THREE\.NormalAnimationBlendMode[\s\S]*?const usingEmbeddedMove = updateEmbeddedAgentMovementAction\(rig, data\);[\s\S]*?if \(!usingEmbeddedMove\) applyEmbeddedAgentMovementOverlay\(rig, data, delta\);/,
  'live agents should use native root-stripped GLB locomotion with the procedural overlay only as a fallback'
);

console.log('progression-audio-animation-rate: rate limits, shot audio, hit ordering, and native locomotion verified.');
