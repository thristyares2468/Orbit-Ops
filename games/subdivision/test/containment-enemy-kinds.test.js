'use strict';

// Four body types, and a wave that changes shape as well as size.
//
// The stat curve was already doing the "harder each wave" work - count, health,
// speed and damage all climb. What it could not do was change what a player has
// to DO. Every enemy was the same silhouette at a bigger number, so wave 20 was
// wave 3 held down longer. Kinds are the other axis: a runner punishes backing
// up, a crawler punishes aiming where a head normally is, a juggernaut punishes
// standing your ground. A player should have to switch behaviour, not just
// reload more.
//
// Everything here is deterministic on (wave, serial). No RNG: the same wave
// always produces the same mix, which is what makes this testable at all and
// keeps a match reproducible.

const assert = require('node:assert/strict');
const test = require('node:test');
const containment = require('../containment.js');

const { ENEMY_KINDS, ENEMY_KIND_NAMES, DEFAULT_TUNING, waveComposition, enemyKindFor, waveBudget } = containment;

// What a wave of `count` bodies is actually made of.
function rollWave(wave, count = 400) {
  const tally = Object.fromEntries(ENEMY_KIND_NAMES.map((k) => [k, 0]));
  for (let serial = 1; serial <= count; serial++) tally[enemyKindFor(wave, serial)] += 1;
  return tally;
}

test('the four kinds exist and are described against the walker', () => {
  assert.deepEqual([...ENEMY_KIND_NAMES].sort(), ['crawler', 'heavy', 'runner', 'walker']);
  const { walker } = ENEMY_KINDS;
  assert.deepEqual({ ...walker }, { health: 1, speed: 1, damage: 1, reward: 1 },
    'the walker is the baseline, so it must be all ones');

  // Each kind has to actually change something, or it is a reskin.
  for (const kind of ENEMY_KIND_NAMES) {
    if (kind === 'walker') continue;
    const m = ENEMY_KINDS[kind];
    assert.ok(m.health !== 1 || m.speed !== 1 || m.damage !== 1, `${kind} is indistinguishable from a walker`);
  }
});

test('each kind trades something for what it is good at', () => {
  const { runner, crawler, heavy } = ENEMY_KINDS;
  assert.ok(runner.speed > 1.3 && runner.health < 1, 'a runner buys speed with durability');
  assert.ok(crawler.health < 1 && crawler.speed < 1, 'a crawler is neither fast nor tough; its size is the threat');
  assert.ok(heavy.health >= 4 && heavy.speed < 1, 'a juggernaut buys durability with pace');
  // Nothing may out-run a sprinting player outright, or the mode stops being
  // survivable: a player sprints at 75 and the speed curve caps at maxSpeed.
  assert.ok(DEFAULT_TUNING.maxSpeed * runner.speed < 75, 'even a late runner must be out-sprintable');
});

test('a wave is always made of exactly one wave', () => {
  for (let wave = 1; wave <= 40; wave++) {
    const shares = waveComposition(wave);
    const total = Object.values(shares).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `wave ${wave} sums to ${total}`);
    for (const [kind, share] of Object.entries(shares)) {
      assert.ok(share >= 0, `wave ${wave} has a negative share of ${kind}`);
    }
  }
});

test('wave 1 is walkers only, so a player meets one kind at a time', () => {
  assert.equal(waveComposition(1).walker, 1);
  const first = rollWave(1);
  assert.equal(first.walker, 400, 'nothing but walkers should arrive in wave 1');
});

test('each kind joins later than the last', () => {
  const firstWaveOf = (kind) => {
    for (let wave = 1; wave <= 60; wave++) if (waveComposition(wave)[kind] > 0) return wave;
    return Infinity;
  };
  const crawler = firstWaveOf('crawler');
  const runner = firstWaveOf('runner');
  const heavy = firstWaveOf('heavy');
  assert.ok(crawler > 1, 'nothing special in wave 1');
  assert.ok(runner > crawler, 'runners come after crawlers');
  assert.ok(heavy > runner, 'juggernauts come last');
  assert.ok(heavy < 12, 'and not so late that nobody ever sees one');
});

test('the mix gets nastier with the wave, not just bigger', () => {
  const specialShare = (wave) => 1 - waveComposition(wave).walker;
  // Boss waves spike above the trend and the wave after drops back, which is
  // the point of them, so the trend is measured on the ordinary waves.
  const isBoss = (wave) => wave % DEFAULT_TUNING.bossEveryWaves === 0;
  let previous = -1;
  for (let wave = 1; wave <= 30; wave++) {
    if (isBoss(wave)) {
      assert.ok(specialShare(wave) > previous, `boss wave ${wave} should spike, not blend in`);
      continue;
    }
    const share = specialShare(wave);
    assert.ok(share >= previous - 1e-9, `wave ${wave} is a softer mix than the last ordinary wave`);
    previous = share;
  }
  assert.ok(specialShare(30) > specialShare(5) + 0.2, 'late waves must feel materially different');
  // But never so far that walkers vanish - the mode still has to read as a horde.
  assert.ok(waveComposition(60).walker > 0.2, 'walkers must remain the bulk of a wave');
});

test('a boss wave is a spine of juggernauts, not a wall of them', () => {
  const boss = DEFAULT_TUNING.bossEveryWaves;
  const shares = waveComposition(boss);
  assert.ok(shares.heavy >= DEFAULT_TUNING.bossHeavyShare - 1e-9, 'a boss wave raises the juggernaut floor');
  // This is the regression that matters. `budget.boss` used to be read once per
  // enemy, so every body in wave 8 spawned with six times health - twenty-odd
  // juggernauts at once, which is where a run ended.
  assert.ok(shares.heavy < 0.5, 'a boss wave must not be entirely juggernauts');
  assert.ok(shares.walker > 0.2, 'and still has ordinary zombies in it');
});

test('the kinds interleave instead of arriving in blocks', () => {
  // Spawns are released one at a time, so taking the kinds in order would send
  // every juggernaut through the door together while the walkers queued behind.
  const wave = DEFAULT_TUNING.bossEveryWaves;
  const first20 = [];
  for (let serial = 1; serial <= 20; serial++) first20.push(enemyKindFor(wave, serial));
  assert.ok(new Set(first20).size > 1, 'the front of the wave must not be one single kind');

  // No kind may occupy a long unbroken run of the sequence.
  let run = 1, longest = 1;
  for (let i = 1; i < first20.length; i++) {
    run = first20[i] === first20[i - 1] ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  assert.ok(longest <= 8, `a run of ${longest} identical spawns reads as a block, not a mix`);
});

test('the composition matches the shares it promises', () => {
  const wave = 25;
  const shares = waveComposition(wave);
  const tally = rollWave(wave, 1000);
  for (const kind of ENEMY_KIND_NAMES) {
    assert.ok(Math.abs(tally[kind] / 1000 - shares[kind]) < 0.03,
      `${kind}: got ${tally[kind] / 1000}, promised ${shares[kind]}`);
  }
});

test('a kind is a multiplier on the wave, never a stat block of its own', () => {
  // A juggernaut on wave 3 must be a wave-3 juggernaut. If kinds carried flat
  // stats, an early special would be an instant wipe and a late one a joke.
  const match = containment.createMatch();
  const spawn = { x: 0, y: 0, z: 0 };
  const made = (wave) => {
    const budget = waveBudget(wave, 1);
    const out = {};
    for (let i = 0; i < 400 && Object.keys(out).length < 4; i++) {
      const enemy = containment.createEnemy(match, budget, spawn, 0);
      if (!out[enemy.kind]) out[enemy.kind] = enemy;
    }
    return { budget, out };
  };
  const late = made(24);
  const early = made(3);
  for (const kind of Object.keys(late.out)) {
    const enemy = late.out[kind];
    const mult = ENEMY_KINDS[kind];
    assert.equal(enemy.health, Math.max(1, Math.round(late.budget.health * mult.health)), `${kind} health`);
    assert.equal(enemy.maxHealth, enemy.health, `${kind} spawns at full health`);
    assert.ok(Math.abs(enemy.speed - late.budget.speed * mult.speed) < 1e-9, `${kind} speed`);
    // And the same kind must be strictly tougher later than earlier.
    if (early.out[kind]) {
      assert.ok(enemy.health > early.out[kind].health, `a wave-24 ${kind} must beat a wave-3 one`);
    }
  }
});

test('a tougher kind pays out more, but a headshot is worth the same everywhere', () => {
  const match = containment.createMatch();
  const base = containment.rewardFor('kill', match, { enemy: { rewardScale: 1 } });
  const juggernaut = containment.rewardFor('kill', match, { enemy: { rewardScale: ENEMY_KINDS.heavy.reward } });
  assert.ok(juggernaut > base * 2, 'a juggernaut is worth walking back for');

  const bonus = DEFAULT_TUNING.headshotBonus;
  assert.equal(containment.rewardFor('kill', match, { enemy: { rewardScale: 1 }, headshot: true }), base + bonus);
  assert.equal(
    containment.rewardFor('kill', match, { enemy: { rewardScale: ENEMY_KINDS.heavy.reward }, headshot: true }),
    juggernaut + bonus,
    'the headshot bonus is flat, so precision is not worth triple against a juggernaut'
  );

  // An enemy from before kinds existed, or any malformed one, must still pay.
  assert.equal(containment.rewardFor('kill', match, {}), base, 'a missing scale is 1, not 0');
  assert.equal(containment.rewardFor('kill', match, { enemy: { rewardScale: 0 } }), base);
  assert.equal(containment.rewardFor('kill', match, { enemy: { rewardScale: 'lots' } }), base);
});

test('a mis-set tuning makes a strange wave, not a broken one', () => {
  // Shares that over-subscribe the wave must be scaled back, never allowed to
  // push walkers negative and hand enemyKindFor a nonsense distribution.
  const greedy = {
    ...DEFAULT_TUNING,
    kindMix: { crawler: { from: 1, per: 1, max: 1 }, runner: { from: 1, per: 1, max: 1 }, heavy: { from: 1, per: 1, max: 1 } }
  };
  const shares = waveComposition(5, greedy);
  const total = Object.values(shares).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `over-subscribed wave sums to ${total}`);
  assert.ok(Object.values(shares).every((s) => s >= 0), 'no negative share');
  for (let serial = 1; serial <= 50; serial++) {
    assert.ok(ENEMY_KIND_NAMES.includes(enemyKindFor(5, serial, greedy)), 'every body still gets a real kind');
  }
});
