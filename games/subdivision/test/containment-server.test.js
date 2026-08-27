'use strict';

// Containment's wiring into server.js.
//
// The rules are tested in containment.test.js against the pure module. What is
// checked here is the boundary: that the mode is registered, that its packets
// and ticks are actually connected, and - most of the point - that none of it
// reaches into the PvP economy or trusts a number that arrived from a client.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

// The Containment section only. The import comment near the top of the file
// begins with the same words, so the header - which ends its line - is what
// anchors this; matching the prefix instead swallows most of server.js and
// makes every "must not appear" assertion below vacuously fail.
const SECTION_START = '// Containment (co-op wave survival)\n';
const SECTION_END = '// Snapshot encoder lives in core.js';
const section = server.slice(server.indexOf(SECTION_START), server.indexOf(SECTION_END));

test('the section boundary is real, or everything below is meaningless', () => {
  assert.ok(server.includes(SECTION_START), 'the section header exists');
  assert.ok(section.length > 1_000, 'the section has content');
  assert.ok(section.length < 40_000, 'and is not accidentally most of the file');
});

test('Containment is a registered mode with its own flags', () => {
  assert.match(server, /containment: \{ timed: false, teams: true, coop: true, fullMap: true \}/u);
  // One team disables friendly fire; coop keeps the wave runtime distinct.
  assert.match(server, /function isContainment\(room\) \{\s*\n\s*return !!MODE_CONFIG\[room\?\.settings\?\.gamemode\]\?\.coop;/u);
  assert.match(server, /if \(isContainment\(room\)\)[\s\S]*?player\.team = 0;/u);
});

test('the pure module is where the rules live', () => {
  assert.match(server, /const containment = require\('\.\/containment'\);/u);
  for (const call of ['containment.step(', 'containment.createEnemy(', 'containment.damageEnemy(',
    'containment.chooseTarget(', 'containment.stepEnemy(', 'containment.pickSpawn(', 'containment.hudState(']) {
    assert.ok(section.includes(call), `${call} should be delegated to the module`);
  }
});

test('the enemy-hit packet is routed and gated on the mode', () => {
  assert.match(
    server,
    /if \(type === 'containmentHit'\) \{ if \(isContainment\(room\)\) handleContainmentHit\(client, room, player, data\); return; \}/u,
    'inert in every PvP room'
  );
});

test('the runtime starts, uses authored sector breaches, and exposes purchases', () => {
  assert.match(server, /if \(room\.players\.size > 0 && match\.phase === containment\.PHASES\.WAITING\) \{\s*containment\.beginMatch\(match, Date\.now\(\)\);/u);
  assert.match(section, /layout\.breaches\.map/u, 'zombies use the active map sector breach set');
  assert.match(section, /room\.containment\?\.gates\?\.get\?\.\(String\(point\.requiresGate\)\)\?\.open === true/u,
    'locked sectors cannot spawn zombies until their gate is purchased');
  assert.match(server, /if \(type === 'containmentBuyWeapon'\) \{ if \(isContainment\(room\)\) handleContainmentBuyWeapon/u);
  assert.match(server, /if \(type === 'containmentOpenGate'\) \{ if \(isContainment\(room\)\) handleContainmentOpenGate/u);
  assert.match(server, /if \(type === 'containmentSkipPreparation'\) \{ if \(isContainment\(room\)\) handleContainmentSkipPreparation/u);
});

test('closed authored gates are authoritative for players and zombies', () => {
  assert.match(section, /gameMaps\.CONTAINMENT_GATES\?\.\[getRoomMapId\(room\)\]/u,
    'gate positions come from per-map choke metadata rather than spawn points');
  assert.match(server, /closedContainmentGateBlocks\(room, player\.position, nextPos, crouching\)/u,
    'a player cannot client-predict through a closed gate');
  assert.match(section, /closedContainmentGateBlocks\(room, before, enemy, false, 1\.5\)/u,
    'the authoritative horde simulation cannot walk through one either');
});

test('Containment players always begin in the map staging location', () => {
  assert.match(server, /const authored = containmentLayout\(room\)\?\.start/u);
  assert.match(server, /const formation = \[-7\.5, -2\.5, 2\.5, 7\.5\][\s\S]*?\.flatMap/u,
    'a full 16-player room shares one staging anchor without overlapping cameras');
  assert.match(server, /player\.lastSpawnId = `containment:\$\{authored\.id \|\| 'staging'\}`/u);
});

test('both ticks are actually started', () => {
  assert.match(server, /safeInterval\('containmentTick', containmentTick, CONTAINMENT_TICK_MS\)/u);
  assert.match(server, /safeInterval\('containmentEnemyTick', containmentEnemyTick, CONTAINMENT_ENEMY_MS\)/u);
});

test('enemy attacks identify the attacker for synchronized bite animation', () => {
  assert.match(section, /applyContainmentDamage\(roomCode, room, victim, result\.damage, enemy\.id\)/u);
  assert.match(section, /enemyId: attackerId/u);
});

test('host settings are clamped at the boundary', () => {
  // Clamped here so nothing downstream has to decide whether a lobby setting
  // can be trusted.
  assert.match(server, /containmentWaveLimit: Math\.max\(0, Math\.min\(100, Math\.floor\(Number\(/u);
  assert.match(server, /containmentStartWave: Math\.max\(0, Math\.min\(50, Math\.floor\(Number\(/u);
});

// --- the part that matters --------------------------------------------------

test('Containment cannot touch the PvP economy', () => {
  // mowbucks is written from many places in this file. If Containment ever
  // reaches one, the mode becomes a way to farm the account balance.
  assert.doesNotMatch(section, /mowbucks/u, 'no account balance');
  assert.doesNotMatch(section, /addMoney\(/u, 'no PvP match purse');
  assert.doesNotMatch(section, /addScore\(/u, 'no PvP scoring');
  assert.doesNotMatch(section, /statDelta/u, 'no PvP stat accumulation');
});

test('no reward, price or damage is ever read from a packet', () => {
  for (const field of ['data.damage', 'data.reward', 'data.credits', 'data.price', 'data.health', 'data.kills']) {
    assert.ok(!section.includes(field), `${field} must never be trusted`);
  }
  // Damage comes from the server's own weapon table instead.
  assert.match(section, /const weapon = core\.WEAPONS\?\.\[player\.weapon\];/u);
  assert.match(section, /const base = Math\.max\(1, Math\.floor\(Number\(weapon\?\.damage\) \|\| 25\)\);/u);
});

test('a hit has to be plausible before it counts', () => {
  assert.match(section, /const reach = Math\.hypot\(/u);
  assert.match(section, /if \(reach > 220\) return;/u);
  // And an enemy that is already dead is not in the map to be hit again.
  assert.match(section, /const enemy = match\.enemies\.get\(String\(data\.enemyId \|\| ''\)\);\s*\n\s*if \(!enemy\) return;/u);
});

test('credits are only ever granted through the module', () => {
  const grants = section.match(/containment\.grant\(/gu) || [];
  assert.equal(grants.length, 2, 'exactly the kill reward and the wave-clear share');
  // Never a bare assignment into the purse from this file.
  assert.doesNotMatch(section, /\.credits\.set\(/u, 'the purse is the module\'s to write');
});

test('a wave clear rewards the squad and respawns downed players', () => {
  assert.match(section, /containment\.grant\(match, id, event\.reward\);/u);
  assert.match(section, /respawnContainmentPlayers\(roomCode, room\);/u);
  assert.match(section, /function respawnContainmentPlayers[\s\S]*?finishRespawn\(roomCode, player, spawn\);/u);
});

test('enemy line of sight uses the map mesh, not a guess', () => {
  assert.match(section, /isVisible: \(spawn, player\) => !segmentBlockedForRoom\(room, spawn, player\)/u);
  // And a missing collision mesh must not throw inside the director tick.
  assert.match(server, /function segmentBlockedForRoom\(room, from, to\) \{[\s\S]*?if \(!collision \|\| typeof collision\.segmentBlocked !== 'function'\) return false;/u);
  assert.match(server, /function segmentBlockedForRoom\(room, from, to\) \{[\s\S]*?\} catch \{\s*\n\s*return false;/u);
});

test('a wedged enemy is recovered rather than left grinding into a wall', () => {
  assert.match(section, /if \(enemy\.stuckSince && now - enemy\.stuckSince > 4_000\)/u);
});

test('enemy positions travel quantised, like player positions do', () => {
  assert.match(section, /x: core\.quantizePos\(enemy\.x\)/u);
  // Only enemies that actually moved are sent.
  assert.match(section, /if \(moved\.length\) \{/u);
});

test('the match is created lazily, so PvP rooms pay nothing for it', () => {
  assert.match(server, /function ensureContainment\(room\) \{\s*\n\s*if \(!isContainment\(room\)\) return null;/u);
});

test('a downed player is present but not alive', () => {
  // This distinction is what separates a team wipe from an empty room.
  assert.match(section, /const isAlive = \(player\.health \|\| 0\) > 0 && !player\.respawningUntil;/u);
  assert.match(section, /totalPlayers: room\.players\.size/u);
});

test('preparation voting is server-owned and only includes eligible players', () => {
  assert.match(section, /function containmentEligiblePlayerIds\(room\) \{/u);
  assert.match(section, /containment\.voteToSkipPreparation\(match, player\.id, containmentEligiblePlayerIds\(room\), Date\.now\(\)\)/u);
  assert.match(section, /preparationVote: containment\.preparationVoteState\(room\.containment, eligibleIds, playerId\)/u);
  assert.match(section, /if \(\(player\.health \|\| 0\) <= 0 \|\| player\.waitingForNextRound\) return;/u);
});
