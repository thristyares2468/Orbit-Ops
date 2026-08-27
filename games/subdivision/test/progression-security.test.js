// Last updated: 15 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// Security contract for hidden/dev economy commands: enforcement must remain
// backend-only, and gameplay anti-cheat should avoid latency-prone auto bans.
assert.match(
  serverJs,
  /function handleOpenCaseTest\(client, data = \{\}\) \{[\s\S]*?if \(!isAdminUser\(client\)\) return;/,
  'hidden case-test rewards must self-gate to admin users'
);

assert.match(
  serverJs,
  /const ECONOMY_TAMPER_TYPES = new Set\(\[[\s\S]*?'AmountMowCoins'[\s\S]*?'GrantCases'[\s\S]*?'UnlockAllSkins'[\s\S]*?\]\);[\s\S]*?if \(ECONOMY_TAMPER_TYPES\.has\(type\)\) \{[\s\S]*?handleUnauthorizedEconomyCommand\(client, type, data\);/,
  'unauthorized economy/admin packet names should be caught server-side'
);

assert.match(
  serverJs,
  /async function handleUnauthorizedEconomyCommand\(client, type, data = \{\}\) \{[\s\S]*?tamperRestrictionMinutes\(data\)[\s\S]*?bans\.banAccount\(\{ accountId: client\.accountId, deviceId: client\.deviceId, reason, byAdmin: 'server', expiresAt \}\)[\s\S]*?bans\.banDevice\(\{ deviceId: client\.deviceId, reason, byAdmin: 'server', expiresAt \}\)/,
  'unauthorized economy commands should only enforce from backend ban logic, not frontend trap code'
);

assert.match(
  serverJs,
  /let hardRejectHit = false;[\s\S]*?if \(!corr\.ok\) \{[\s\S]*?trustedHit = false;[\s\S]*?hardRejectHit = true;[\s\S]*?if \(dist > \(melee \? AC\.MELEE_RANGE : AC\.GUN_RANGE\)\) \{[\s\S]*?trustedHit = false;[\s\S]*?hardRejectHit = true;/,
  'uncorrelated or impossible-range hit packets should be dropped before health changes'
);

assert.match(
  serverJs,
  /const countsRoundStats = !isCasualWarmup\(room\) && trustedForProgression;[\s\S]*?const countsStats = countsForAccuracyStats\(room, player\) && trustedForProgression;/,
  'untrusted hit packets must not count for round stats, account stats, XP, or daily challenge progress'
);

assert.match(
  serverJs,
  /if \(!damageRateOk\(player\.ac, weapon, wdef, now\)\) \{[\s\S]*?recordViolationSafe\(client, 'rapidFire', weapon\);[\s\S]*?trustedHit = false;[\s\S]*?\}[\s\S]*?if \(!trustedHit\) \{[\s\S]*?trustedForProgression = false;[\s\S]*?if \(progressionEligible\) suppressRoundProgression\(room, `untrusted_hit:\$\{weapon\}`\);[\s\S]*?if \(hardRejectHit\) return;/,
  'latency-sensitive rate bucket misses should suppress progression without blocking combat damage'
);

assert.doesNotMatch(
  serverJs,
  /function shotWithinView|SHOT_START_SLACK|const safePos = ac\.lastValidPos/,
  'latency-sensitive view, shot-origin, and movement checks should not hard reject regular players'
);

assert.match(
  serverJs,
  /function openCaseForClient\(client, data = \{\}, \{ consume = true, label = 'case-open' \} = \{\}\) \{[\s\S]*?if \(!client\.accountId \|\| client\.guest \|\| !db\.isEnabled\(\)\) \{[\s\S]*?send\(client, 'caseRollNotice', \{ ok: false, message: consume \? 'Case opening is unavailable\.' : 'Case testing is unavailable\.' \}\);/,
  'unavailable case opens should return a notice instead of silently no-oping'
);

assert.match(
  serverJs,
  /if \(room\.progressionSuppressedRound\) return;[\s\S]*?const awardKey = `\$\{room\.settings\?\.gamemode \|\| 'mode'\}:\$\{room\.roundStartedAt \|\| 0\}:\$\{room\.settings\?\.roundEndsAt \|\| 0\}`;[\s\S]*?if \(room\.lastXpAwardKey === awardKey\) return;/,
  'round XP awards must be suppressed for tainted rounds and idempotent per round'
);

console.log('progression-security: server reward and hit-packet hardening verified.');
