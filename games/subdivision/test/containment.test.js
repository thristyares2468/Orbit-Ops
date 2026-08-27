'use strict';

// Containment's wave director, scaling and economy.
//
// These are the parts where a quiet arithmetic mistake becomes an exploit or an
// unplayable curve, and they are pure, so they can be walked exhaustively rather
// than sampled. Anything needing sockets or a map is covered elsewhere.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PHASES,
  DEFAULT_TUNING,
  waveBudget,
  createMatch,
  registerPlayer,
  restorePlayer,
  configureGates,
  publicGates,
  openGate,
  preparationVoteState,
  voteToSkipPreparation,
  beginMatch,
  step,
  createEnemy,
  chooseTarget,
  stepEnemy,
  damageEnemy,
  credits,
  grant,
  rewardFor,
  purchase,
  pickSpawn,
  hudState
} = require('../containment');

const at = (match, ms) => step(match, ms, { alivePlayers: 1, totalPlayers: 1 });

// --- scaling ---------------------------------------------------------------

test('the wave curve rises without ever going backwards', () => {
  let previousCount = 0;
  let previousHealth = 0;
  for (let wave = 1; wave <= 60; wave += 1) {
    const budget = waveBudget(wave, 1);
    assert.ok(budget.count >= previousCount, `wave ${wave} count must not drop`);
    assert.ok(budget.health >= previousHealth, `wave ${wave} health must not drop`);
    previousCount = budget.count;
    previousHealth = budget.health;
  }
});

test('every wave stays inside its ceilings', () => {
  // The count and health ceilings are per-solo-player limits scaled by team
  // size - see teamScaling. Concurrency is NOT scaled: it caps how many are
  // alive at once, which is what keeps one screen readable and one simulation
  // cheap no matter how many people are playing.
  for (let players = 1; players <= 4; players += 1) {
    const countMultiplier = 1 + DEFAULT_TUNING.countPerExtraPlayer * (players - 1);
    const teamHealthFactor = Math.max(1, Math.pow(players, DEFAULT_TUNING.teamScaling) / countMultiplier);
    for (let wave = 1; wave <= 400; wave += 1) {
      const budget = waveBudget(wave, players);
      assert.ok(budget.count <= Math.round(DEFAULT_TUNING.maxCount * countMultiplier), 'count ceiling');
      assert.ok(budget.health <= Math.round(DEFAULT_TUNING.maxHealth * teamHealthFactor), 'health ceiling');
      assert.ok(budget.speed <= DEFAULT_TUNING.maxSpeed, 'speed ceiling');
      assert.ok(budget.damage <= DEFAULT_TUNING.maxDamage, 'damage ceiling');
      assert.ok(budget.concurrent <= DEFAULT_TUNING.maxConcurrent, 'concurrency is never scaled');
      assert.ok(budget.spawnIntervalMs >= 120, 'spawn interval floor');
    }
  }
});

test('zombies start at a chase pace and continue accelerating by wave', () => {
  assert.ok(DEFAULT_TUNING.baseSpeed >= 20, 'wave one zombies move meaningfully against a 35 u/s walking player');
  assert.ok(waveBudget(10, 1).speed > waveBudget(1, 1).speed, 'later waves move faster');
  assert.ok(DEFAULT_TUNING.maxSpeed >= 45, 'the late-wave pursuit cap remains threatening');
});

// --- team scaling ----------------------------------------------------------

// The whole point of the mode evening out: a wave should be as much work for
// each player in a four-stack as it is for someone playing alone. Counting
// bodies alone does not do that - four players bring four times the damage but
// only 2.65x the enemies - so the health multiplier makes up the difference.
const pool = (wave, players, tuning) => {
  const budget = waveBudget(wave, players, tuning);
  return budget.count * budget.health;
};
const perPlayerLoad = (wave, players, tuning) =>
  (pool(wave, players, tuning) / pool(wave, 1, tuning)) / players;

test('a full team works as hard each as a solo player, at every wave', () => {
  for (let wave = 1; wave <= 120; wave += 1) {
    for (let players = 1; players <= 4; players += 1) {
      const load = perPlayerLoad(wave, players);
      assert.ok(
        load > 0.9 && load < 1.15,
        `wave ${wave} with ${players} players: per-player load ${load.toFixed(2)} should sit near 1`
      );
    }
  }
});

test('the total enemy pool rises roughly in step with the number of guns', () => {
  for (const players of [2, 3, 4]) {
    const ratio = pool(10, players) / pool(10, 1);
    assert.ok(
      ratio > players * 0.9 && ratio < players * 1.15,
      `${players} players should face about ${players}x the pool, got ${ratio.toFixed(2)}x`
    );
  }
});

test('the extra difficulty is split between bodies and health', () => {
  // Four times the bodies would hit the concurrency cap and quadruple both the
  // simulation and the snapshot, and a screen that full stops being readable.
  const solo = waveBudget(10, 1);
  const four = waveBudget(10, 4);
  assert.ok(four.count > solo.count, 'more enemies');
  assert.ok(four.count < solo.count * 4, 'but not four times as many');
  assert.ok(four.health > solo.health, 'and each is tougher');
});

test('teamScaling at zero restores the old, softer behaviour', () => {
  const load = perPlayerLoad(10, 4, { teamScaling: 0 });
  assert.ok(load < 0.75, `no scaling should be easier per player, got ${load.toFixed(2)}`);
  // And a solo run is identical either way - the dial only concerns team size.
  assert.deepEqual(waveBudget(10, 1, { teamScaling: 0 }), waveBudget(10, 1, { teamScaling: 1 }));
});

test('a solo run is untouched by any of this', () => {
  assert.equal(waveBudget(1, 1).health, DEFAULT_TUNING.baseHealth);
  for (let wave = 1; wave <= 40; wave += 1) {
    assert.equal(perPlayerLoad(wave, 1), 1, `wave ${wave} solo is the baseline`);
  }
});

test('the count ceiling binding does not let a deep wave go soft', () => {
  // Past the cap the bodies stop arriving but the guns do not, so the shortfall
  // has to land on health or the mode gets easier exactly where it should not.
  const deep = waveBudget(60, 4);
  const deepSolo = waveBudget(60, 1);
  assert.ok(deep.health > deepSolo.health, 'health absorbs what the cap swallowed');
  assert.ok(perPlayerLoad(60, 4) > 0.9, 'and the wave stays honest');
});

test('wave one is a warm-up rather than a scramble', () => {
  const solo = waveBudget(1, 1);
  assert.equal(solo.health, DEFAULT_TUNING.baseHealth);
  assert.ok(solo.count <= 8, `wave 1 solo should be small, got ${solo.count}`);
  assert.equal(solo.boss, false);
});

test('more players means a busier wave, not a proportionally longer one', () => {
  const solo = waveBudget(5, 1).count;
  const four = waveBudget(5, 4).count;
  assert.ok(four > solo, 'four players face more');
  assert.ok(four < solo * 4, 'but not four times as many');
});

test('player count is clamped, so a malformed lobby cannot inflate a wave', () => {
  assert.deepEqual(waveBudget(3, 99), waveBudget(3, 4));
  assert.deepEqual(waveBudget(3, 0), waveBudget(3, 1));
  assert.deepEqual(waveBudget(3, -5), waveBudget(3, 1));
  assert.deepEqual(waveBudget(0, 1), waveBudget(1, 1));
});

test('boss waves land on the configured cadence', () => {
  for (let wave = 1; wave <= 40; wave += 1) {
    assert.equal(waveBudget(wave, 1).boss, wave % DEFAULT_TUNING.bossEveryWaves === 0, `wave ${wave}`);
  }
});

// --- the wave director -----------------------------------------------------

test('a match runs waiting to preparation to active to cleared and round again', () => {
  const match = createMatch({ now: 0 });
  assert.equal(match.phase, PHASES.WAITING);

  beginMatch(match, 0);
  assert.equal(match.phase, PHASES.PREPARATION);
  assert.equal(match.wave, 0, 'the wave number only advances when the wave starts');

  // Preparation holds until its timer is up.
  assert.deepEqual(at(match, 1_000), []);
  assert.equal(match.phase, PHASES.PREPARATION);

  const started = at(match, DEFAULT_TUNING.firstPreparationMs);
  assert.equal(match.phase, PHASES.ACTIVE);
  assert.equal(match.wave, 1);
  assert.equal(started[0].type, 'waveStarted');
  assert.equal(match.pending, waveBudget(1, 1).count);

  // Clearing the wave needs the queue empty AND nothing alive.
  match.pending = 0;
  match.enemies.set('z1', { id: 'z1', health: 10 });
  assert.deepEqual(at(match, 40_000), [], 'a live enemy keeps the wave open');
  match.enemies.clear();

  const cleared = at(match, 41_000);
  assert.equal(match.phase, PHASES.CLEARED);
  assert.equal(cleared[0].type, 'waveCleared');
  assert.equal(match.stats.wavesCleared, 1);

  const prep = at(match, 41_000 + DEFAULT_TUNING.clearedMs);
  assert.equal(match.phase, PHASES.PREPARATION);
  assert.equal(prep[0].type, 'preparation');
  assert.equal(prep[0].wave, 2, 'the banner names the wave about to start');
});

test('preparation skips only when a majority of eligible players vote', () => {
  const match = createMatch({ now: 0 });
  beginMatch(match, 0);
  const eligible = ['p1', 'p2', 'p3'];

  const first = voteToSkipPreparation(match, 'p1', eligible, 1_000);
  assert.equal(first.ok, true);
  assert.equal(first.skipped, false);
  assert.deepEqual(preparationVoteState(match, eligible, 'p1'), {
    available: true, votes: 1, required: 2, eligible: 3, voted: true
  });
  assert.equal(match.phaseEndsAt, DEFAULT_TUNING.firstPreparationMs, 'one player cannot shorten the timer');

  const duplicate = voteToSkipPreparation(match, 'p1', eligible, 1_100);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, 'already-voted');

  const second = voteToSkipPreparation(match, 'p2', eligible, 1_200);
  assert.equal(second.ok, true);
  assert.equal(second.skipped, true);
  assert.equal(match.phaseEndsAt, 1_200, 'the director will start the wave on its normal next tick');
  const started = step(match, 1_200, { alivePlayers: 3, totalPlayers: 3 });
  assert.equal(started[0].type, 'waveStarted');
  assert.equal(match.preparationVotes.size, 0, 'votes never leak into the live wave');
});

test('only currently eligible players count toward a preparation vote', () => {
  const match = createMatch({ now: 0 });
  beginMatch(match, 0);
  assert.equal(voteToSkipPreparation(match, 'spectator', ['p1', 'p2'], 1).reason, 'ineligible');
  voteToSkipPreparation(match, 'p1', ['p1', 'p2', 'p3'], 1);
  // p3 leaving reduces the majority to one out of two rather than preserving a
  // ghost vote; p1's vote remains valid because they are still alive.
  const view = preparationVoteState(match, ['p1', 'p2'], 'p1');
  assert.deepEqual(view, { available: true, votes: 1, required: 2, eligible: 2, voted: true });
});

test('a team wipe ends the run from any live phase', () => {
  for (const phase of [PHASES.PREPARATION, PHASES.ACTIVE, PHASES.CLEARED]) {
    const match = createMatch({ now: 0 });
    beginMatch(match, 0);
    match.phase = phase;
    const events = step(match, 5_000, { alivePlayers: 0, totalPlayers: 3 });
    assert.equal(match.phase, PHASES.DEFEAT, `${phase} should end in defeat`);
    assert.equal(events[0].type, 'defeat');
  }
});

test('an empty room is not a team wipe', () => {
  // Everyone disconnecting must not record a defeat - there is nobody to lose.
  const match = createMatch({ now: 0 });
  beginMatch(match, 0);
  step(match, 5_000, { alivePlayers: 0, totalPlayers: 0 });
  assert.equal(match.phase, PHASES.PREPARATION);
});

test('a finished run opens extraction instead of another wave', () => {
  const match = createMatch({ now: 0, endless: false, waveLimit: 2 });
  beginMatch(match, 0);
  match.phase = PHASES.CLEARED;
  match.wave = 2;
  match.phaseEndsAt = 0;
  const events = at(match, 1_000);
  assert.equal(match.phase, PHASES.EXTRACTION);
  assert.equal(events[0].type, 'extractionOpen');
});

test('endless mode never opens extraction on its own', () => {
  const match = createMatch({ now: 0, endless: true, waveLimit: 2 });
  beginMatch(match, 0);
  match.phase = PHASES.CLEARED;
  match.wave = 50;
  match.phaseEndsAt = 0;
  at(match, 1_000);
  assert.equal(match.phase, PHASES.PREPARATION);
});

test('a terminal phase is terminal', () => {
  for (const phase of [PHASES.DEFEAT, PHASES.EXTRACTED]) {
    const match = createMatch({ now: 0 });
    match.phase = phase;
    assert.deepEqual(step(match, 999_999, { alivePlayers: 4, totalPlayers: 4 }), []);
    assert.equal(match.phase, phase, 'nothing restarts a finished match');
  }
});

test('spawns are paced and capped rather than arriving all at once', () => {
  const match = createMatch({ now: 0 });
  beginMatch(match, 0);
  at(match, DEFAULT_TUNING.firstPreparationMs);
  const budget = waveBudget(1, 1);

  let now = DEFAULT_TUNING.firstPreparationMs;
  const due = at(match, now).filter((e) => e.type === 'spawnDue');
  assert.equal(due.length, 1, 'one release at a time');

  // Too soon for the next one.
  assert.equal(at(match, now + 10).filter((e) => e.type === 'spawnDue').length, 0);
  now += budget.spawnIntervalMs;
  assert.equal(at(match, now).filter((e) => e.type === 'spawnDue').length, 1);

  // And the concurrent cap holds the queue back.
  for (let i = 0; i < DEFAULT_TUNING.maxConcurrent; i += 1) {
    match.enemies.set(`f${i}`, { id: `f${i}`, health: 1 });
  }
  match.pending = 50;
  assert.equal(at(match, now + 60_000).filter((e) => e.type === 'spawnDue').length, 0);
});

// --- enemies ---------------------------------------------------------------

test('an enemy walks toward its target and bites only in range', () => {
  const match = createMatch({ now: 0 });
  const enemy = createEnemy(match, waveBudget(1, 1), { x: 0, y: 0, z: 0 }, 0);
  const target = { id: 'p1', x: 10, y: 0, z: 0 };

  const walk = stepEnemy(enemy, target, 0.25, 1_000);
  assert.equal(walk.moved, true);
  assert.equal(walk.attacked, false);
  assert.ok(enemy.x > 0 && enemy.x < 10, 'it closed some of the gap');

  enemy.x = 9.5;
  const bite = stepEnemy(enemy, target, 1, 2_000);
  assert.equal(bite.attacked, true);
  assert.equal(bite.damage, enemy.damage);

  // And the cooldown holds.
  assert.equal(stepEnemy(enemy, target, 1, 2_100).attacked, false);
  assert.equal(stepEnemy(enemy, target, 1, 2_000 + DEFAULT_TUNING.attackCooldownMs).attacked, true);
});

test('an enemy with no target does nothing at all', () => {
  const match = createMatch({ now: 0 });
  const enemy = createEnemy(match, waveBudget(1, 1), { x: 0, y: 0, z: 0 }, 0);
  assert.deepEqual(stepEnemy(enemy, null, 1, 1_000), { moved: false, attacked: false });
});

test('the horde spreads across players instead of stacking on the nearest', () => {
  const players = [
    { id: 'p1', x: 0, z: 0 },
    { id: 'p2', x: 6, z: 0 }
  ];
  const assignments = new Map();
  const picks = [];
  for (let i = 0; i < 10; i += 1) {
    const enemy = { x: 1, z: 0 };   // nearest is always p1
    const id = chooseTarget(enemy, players, { assignments, enemyCount: 10 });
    picks.push(id);
    assignments.set(id, (assignments.get(id) || 0) + 1);
  }
  assert.ok(picks.includes('p2'), 'the far player is still targeted by someone');
  assert.ok(assignments.get('p1') < 10, 'not everything piles onto one player');
});

test('a downed player is not a target', () => {
  const players = [{ id: 'p1', x: 0, z: 0, alive: false }, { id: 'p2', x: 40, z: 0 }];
  assert.equal(chooseTarget({ x: 0, z: 0 }, players, {}), 'p2');
  assert.equal(chooseTarget({ x: 0, z: 0 }, [{ id: 'p1', x: 0, z: 0, alive: false }], {}), null);
  assert.equal(chooseTarget({ x: 0, z: 0 }, [], {}), null);
});

test('damage cannot overkill, revive a corpse, or be negative', () => {
  const match = createMatch({ now: 0 });
  const enemy = createEnemy(match, { ...waveBudget(1, 1), health: 100 }, { x: 0, y: 0, z: 0 }, 0);

  assert.equal(damageEnemy(match, enemy.id, -50), null, 'negative damage is refused');
  assert.equal(damageEnemy(match, enemy.id, 0), null, 'zero damage is refused');
  assert.equal(enemy.health, 100);

  const hit = damageEnemy(match, enemy.id, 30);
  assert.equal(hit.applied, 30);
  assert.equal(hit.killed, false);
  assert.equal(enemy.health, 70);

  // 70 left. A 20 headshot lands 40, so it wounds rather than kills.
  const wound = damageEnemy(match, enemy.id, 20, { headshot: true });
  assert.equal(wound.applied, 40, 'a headshot doubles');
  assert.equal(wound.killed, false);
  assert.equal(enemy.health, 30);

  const head = damageEnemy(match, enemy.id, 20, { headshot: true });
  assert.equal(head.applied, 30, 'only the remaining health is applied');
  assert.equal(head.killed, true);
  assert.equal(match.enemies.has(enemy.id), false, 'a dead enemy leaves the field');

  assert.equal(damageEnemy(match, enemy.id, 999), null, 'and cannot be hit again');
});

test('applied damage never exceeds remaining health', () => {
  const match = createMatch({ now: 0 });
  const enemy = createEnemy(match, { ...waveBudget(1, 1), health: 40 }, { x: 0, y: 0, z: 0 }, 0);
  const hit = damageEnemy(match, enemy.id, 1_000);
  assert.equal(hit.applied, 40, 'only the remaining health is credited');
  assert.equal(hit.overkill, 960);
});

// --- economy ---------------------------------------------------------------

test('credits start empty and only rise by whole amounts', () => {
  const match = createMatch({ now: 0 });
  assert.equal(credits(match, 'p1'), 0);
  grant(match, 'p1', 60);
  assert.equal(credits(match, 'p1'), 60);
  grant(match, 'p1', -100);
  assert.equal(credits(match, 'p1'), 60, 'a negative grant cannot drain a purse');
  grant(match, 'p1', 0.9);
  assert.equal(credits(match, 'p1'), 60, 'fractions do not accumulate');
});

test('registering a player grants the starting purse exactly once', () => {
  const match = createMatch();
  assert.equal(registerPlayer(match, 'p1'), DEFAULT_TUNING.startingCredits);
  grant(match, 'p1', 125);
  assert.equal(registerPlayer(match, 'p1'), DEFAULT_TUNING.startingCredits + 125, 're-registering cannot duplicate the start grant');
  assert.equal(restorePlayer(match, 'p2', 910), 910, 'a reconnect can restore its authoritative purse');
});

test('gates are configured once and opened through the same purse authority', () => {
  const match = createMatch();
  registerPlayer(match, 'p1');
  configureGates(match, [{ id: 'sector-1', label: 'Sector 1 gate', x: 10, y: 18, z: 20, price: 400 }]);
  configureGates(match, [{ id: 'replacement', x: 0, z: 0, price: 0 }]);
  assert.equal(publicGates(match).length, 1, 'live gate state is not replaced after setup');
  const opened = openGate(match, 'p1', 'sector-1');
  assert.equal(opened.ok, true);
  assert.equal(opened.remaining, DEFAULT_TUNING.startingCredits - 400);
  assert.equal(publicGates(match)[0].open, true);
  assert.equal(openGate(match, 'p1', 'sector-1').reason, 'open', 'an open gate cannot charge twice');
});

test('credits are capped', () => {
  const match = createMatch({ now: 0 });
  grant(match, 'p1', DEFAULT_TUNING.creditCap * 10);
  assert.equal(credits(match, 'p1'), DEFAULT_TUNING.creditCap);
});

test('rewards come from one table, and an unknown event is worth nothing', () => {
  const match = createMatch({ now: 0 });
  assert.equal(rewardFor('kill', match), DEFAULT_TUNING.killReward);
  assert.equal(rewardFor('kill', match, { headshot: true }), DEFAULT_TUNING.killReward + DEFAULT_TUNING.headshotBonus);
  assert.equal(rewardFor('revive', match), DEFAULT_TUNING.reviveReward);
  assert.equal(rewardFor('waveClear', match), DEFAULT_TUNING.waveClearReward);
  assert.equal(rewardFor('somethingInvented', match), 0);
  assert.equal(rewardFor(undefined, match), 0);
});

test('a purchase is refused rather than allowed to go negative', () => {
  const match = createMatch({ now: 0 });
  grant(match, 'p1', 100);

  const poor = purchase(match, 'p1', 'door', 250);
  assert.equal(poor.ok, false);
  assert.equal(poor.reason, 'insufficient');
  assert.equal(credits(match, 'p1'), 100, 'a refused purchase costs nothing');

  const bought = purchase(match, 'p1', 'door', 100);
  assert.equal(bought.ok, true);
  assert.equal(bought.remaining, 0);
  assert.equal(credits(match, 'p1'), 0);
});

test('a purchase cannot be talked into paying out', () => {
  const match = createMatch({ now: 0 });
  grant(match, 'p1', 100);
  for (const price of [-500, NaN, Infinity, '-100']) {
    const result = purchase(match, 'p1', 'door', price);
    assert.equal(result.ok, false, `price ${price} must be refused`);
  }
  assert.equal(purchase(match, 'p1', '', 10).ok, false, 'an unnamed item is refused');
  assert.equal(credits(match, 'p1'), 100, 'the purse is untouched throughout');
});

test('one player spending does not touch another purse', () => {
  const match = createMatch({ now: 0 });
  grant(match, 'p1', 500);
  grant(match, 'p2', 500);
  purchase(match, 'p1', 'rifle', 500);
  assert.equal(credits(match, 'p1'), 0);
  assert.equal(credits(match, 'p2'), 500);
});

// --- spawning --------------------------------------------------------------

const POINTS = [
  { id: 'near', x: 0, z: 2 },
  { id: 'far', x: 0, z: 60 },
  { id: 'mid', x: 0, z: 30 }
];

test('an enemy never materialises on top of a player', () => {
  const players = [{ id: 'p1', x: 0, z: 0 }];
  const chosen = pickSpawn(POINTS, players, { isVisible: () => false });
  assert.notEqual(chosen.id, 'near', 'the point inside the minimum distance is skipped');
});

test('an unseen spawn is preferred to a watched one', () => {
  const players = [{ id: 'p1', x: 0, z: 0 }];
  const watched = new Set(['far']);
  const chosen = pickSpawn(POINTS, players, { isVisible: (point) => watched.has(point.id) });
  assert.equal(chosen.id, 'mid', 'the watched point loses to an unwatched one');
});

test('a wave does not stall when every door is covered', () => {
  const players = [{ id: 'p1', x: 0, z: 0 }];
  const chosen = pickSpawn(POINTS, players, { isVisible: () => true });
  assert.ok(chosen, 'something is still chosen');
  assert.notEqual(chosen.id, 'near', 'but never the unfairly close one');
});

test('when everything is too close, the furthest point is the fallback', () => {
  const players = [{ id: 'p1', x: 0, z: 0 }];
  const tight = [{ id: 'a', x: 0, z: 1 }, { id: 'b', x: 0, z: 4 }];
  assert.equal(pickSpawn(tight, players, { isVisible: () => false }).id, 'b');
});

test('spawn selection copes with nothing to choose from', () => {
  assert.equal(pickSpawn([], [{ id: 'p1', x: 0, z: 0 }], {}), null);
  assert.equal(pickSpawn(null, [], {}), null);
  assert.equal(pickSpawn(POINTS, [], {}).id, 'near', 'with no players, the first point is fine');
});

// --- hud -------------------------------------------------------------------

test('the hud reports the wave, what is left, and this player s own purse', () => {
  const match = createMatch({ now: 0 });
  beginMatch(match, 0);
  at(match, DEFAULT_TUNING.firstPreparationMs);
  grant(match, 'p1', 300);
  match.enemies.set('z1', { id: 'z1', health: 5 });

  const view = hudState(match, 'p1');
  assert.equal(view.phase, PHASES.ACTIVE);
  assert.equal(view.wave, 1);
  assert.equal(view.credits, 300);
  assert.equal(view.alive, 1);
  assert.equal(view.remaining, match.pending + 1, 'remaining counts the queue as well as the field');
  assert.equal(hudState(match, 'p2').credits, 0, 'and never leaks another purse');
});
