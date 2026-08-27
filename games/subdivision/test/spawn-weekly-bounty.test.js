// Last updated: 16 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.match(server, /const RESPAWN_PROTECTION_MS = 10000;/, 'stationary spawn protection should last 10 seconds');
assert.match(server, /const SPAWN_PROTECTION_AFTER_MOVE_MS = 3000;/, 'movement should start a three-second protection countdown');
assert.match(
  server,
  /function beginSpawnProtectionMoveCountdown[\s\S]*?player\.invulnerableUntil = now \+ SPAWN_PROTECTION_AFTER_MOVE_MS;[\s\S]*?player\.spawnProtectionOrigin = null;/,
  'movement should start one non-extending protection countdown'
);
const movementCheck = server.match(/function shouldBeginSpawnProtectionMoveCountdown[\s\S]*?\n}/)?.[0] || '';
assert.match(movementCheck, /distanceBetweenVectors\(player\.spawnProtectionOrigin, nextPos\)/, 'movement should compare player positions');
assert.doesNotMatch(movementCheck, /rotation/, 'camera rotation must not affect spawn protection');
assert.match(server, /clearSpawnProtection\(player, now, client, 'shoot'\);/, 'shooting should clear server protection immediately');
assert.match(server, /if \(type === 'throwGrenade'\)[\s\S]*?clearSpawnProtection\(player, Date\.now\(\), client, 'throw'\);/, 'throwing utility should clear server protection immediately');
assert.match(server, /if \(type === 'grenadeBurst'\)[\s\S]*?clearSpawnProtection\(player, burstAt, client, 'utility'\);/, 'a utility burst should defensively clear stale server protection');
assert.match(server, /broadcastToRoom\(client\.roomCode, null, 'spawnProtectionUpdated', payload\)/, 'protection deadlines should be synchronized to the room');
assert.match(client, /function updateRemoteSpawnProtectionVisual[\s\S]*?flashesPerSecond = THREE\.MathUtils\.lerp\(1\.1, 6, urgency\)[\s\S]*?const pulseFade = pulse \* pulse \* \(3 - 2 \* pulse\);[\s\S]*?material\.emissiveIntensity = THREE\.MathUtils\.lerp\(lowIntensity, highIntensity, pulseFade\);/, 'protected skins should fade smoothly and accelerate near expiry');
assert.match(client, /function restoreRemoteSpawnProtectionVisual[\s\S]*?entry\.material\.emissive\?\.copy\(entry\.emissive\)/, 'protection expiry should restore original materials');
assert.match(client, /if \(!u\?\.spawnProtectionVisualEntries \|\| !u\.spawnProtectionVisualActive\) return;/, 'inactive players should not rewrite restored materials every frame');
assert.match(client, /function applyLocalSpawnProtectionUntil\(serverUntil, force = false\)[\s\S]*?localSpawnProtectionActionPending[\s\S]*?function clearLocalSpawnProtectionForAction\(\)[\s\S]*?localSpawnProtectionUntil = 0;/, 'stale snapshots should not visually restore protection after a local action');
assert.match(client, /function shoot\(isAlt = false\)[\s\S]*?clearLocalSpawnProtectionForAction\(\);[\s\S]*?soundShoot/, 'a valid local shot should clear the protected HUD immediately');
assert.match(client, /function throwGrenadeWithCharge\(kind, isAlt, charge = 1\)[\s\S]*?clearLocalSpawnProtectionForAction\(\);[\s\S]*?sendPacket\('throwGrenade'/, 'every valid utility throw path should clear the protected HUD immediately');
assert.match(client, /team === myTeam\) \{\s*sendShotPacket\(\);\s*continue;/, 'shooting a teammate should still tell the server to clear spawn protection');
assert.match(client, /if \(pGroup\.userData\.isAdminDummy\) \{\s*sendShotPacket\(\);/, 'shooting an admin dummy should still tell the server to clear spawn protection');

assert.match(
  server,
  /if \(!result\.claimed\) \{\s*claimed\.add\(challenge\.tier\);\s*return false;/,
  'concurrent challenge claim conflicts should remain completed in every response'
);
assert.match(client, /function challengeProgressStatus[\s\S]*?if \(challenge\.claimed\) return 'COMPLETED';[\s\S]*?if \(challenge\.rewardPending\) return 'REWARD PENDING';/, 'challenge status labels should be authoritative and consistent');
assert.match(client, /const complete = !!challenge\.claimed;\s*const targetReached = rawTotal >= target;/, 'reaching a target should not masquerade as a claimed reward');

assert.match(server, /const BOUNTY_STREAK_THRESHOLD = 4;/, 'a bounty should begin on the fourth consecutive kill');
assert.match(server, /const BOUNTY_KILL_SCORE_BONUS = 25;/, 'bountied players should receive a modest per-kill score bonus');
assert.match(server, /const BOUNTY_CLAIM_SCORE_BONUS = 100;/, 'ending a bounty should award an additional score bonus');
assert.match(server, /player\.bountyActive = player\.killStreak >= BOUNTY_STREAK_THRESHOLD;/, 'bounty state should be server-owned');
assert.match(server, /killContext\.domination = true;[\s\S]*?killContext\.bountyKill = true;/, 'bountied kills should use the Domination feed icon');
assert.match(server, /if \(victimHadBounty\)[\s\S]*?killContext\.revenge = true;[\s\S]*?killContext\.bountyClaimed = true;/, 'claiming a bounty should use the Revenge feed icon');
assert.doesNotMatch(server, /pairKills/, 'legacy pair-kill domination state should not remain after bounties replace it');
assert.match(client, /\['revenge', 'Revenge\.webp'/, 'the Revenge kill-feed asset should stay wired');
assert.match(client, /\['domination', 'Domination\.webp'/, 'the Domination kill-feed asset should stay wired');

console.log('spawn, weekly challenge, and bounty tests passed');
