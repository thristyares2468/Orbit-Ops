'use strict';

// Distance damage falloff. Before this there was none at all: the weapon table
// carried a rangeMod column on every weapon - CS:GO's own RangeModifier values -
// and nothing anywhere read it, so a Nova pellet was worth exactly as much
// across the map as it was point blank.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const core = require('../core');

const ROOT = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

const U = core.UNITS_PER_METRE;
const at = (weapon, metres) => core.damageFalloffScale(weapon, core.WEAPONS[weapon].type, metres * U);

test('the scale conversion is the one the maps are built on', () => {
  // maps.js scales the imported map GLBs, which are authored in metres, by
  // this. If the two ever disagree every distance below means nothing.
  const maps = fs.readFileSync(path.join(ROOT, 'maps.js'), 'utf8');
  const scale = Number(maps.match(/const IMPORTED_MAP_SCALE = (\d+);/u)[1]);
  assert.equal(core.UNITS_PER_METRE, scale, 'falloff distances must use the map scale');
});

test('close range is always full damage', () => {
  for (const name of core.WEAPON_NAMES) {
    const wp = core.WEAPONS[name];
    if (!wp?.dmg) continue;
    assert.equal(core.damageFalloffScale(name, wp.type, 0), 1, `${name} at zero range`);
    // Every profile holds full damage to at least 8 m. A weapon that started
    // shedding damage inside a room would feel broken rather than balanced.
    assert.equal(at(name, 8), 1, `${name} at 8 m`);
  }
});

test('snipers and melee do not fall off at all', () => {
  for (const name of ['AWP', 'SSG 08', 'Knife']) {
    assert.equal(at(name, 45), 1, `${name} keeps full damage across the longest sightline`);
    assert.equal(core.damageFalloffProfile(name, core.WEAPONS[name].type), null);
  }
  // Blast weapons carry their own radius falloff; stacking a second one on the
  // direct hit would double-count.
  assert.equal(core.damageFalloffProfile('RPG', 'launcher'), null);
  assert.equal(core.damageFalloffProfile('Frag', 'utility'), null);
});

test('the class ordering matches what the genre converged on', () => {
  // Shotgun worse than SMG worse than rifle, at every distance past the point
  // any of them has started to drop. This is the whole shape of the feature.
  for (const metres of [15, 20, 30, 45]) {
    assert.ok(at('Nova', metres) < at('MAC10', metres),
      `a shotgun must fall off harder than an SMG at ${metres} m`);
    assert.ok(at('MAC10', metres) < at('AK47', metres),
      `an SMG must fall off harder than a rifle at ${metres} m`);
    assert.ok(at('AK47', metres) <= at('AWP', metres),
      `a rifle must not out-range a sniper at ${metres} m`);
  }
  // Shotguns are a close-range weapon or they are nothing: half damage or worse
  // by 25 m, and on the floor before the longest sightline.
  assert.ok(at('Nova', 25) < 0.5);
  assert.equal(at('Nova', 45), core.DAMAGE_FALLOFF_CLASSES.shotgun.min);
});

test('within a class the rangeMod column still ranks the weapons', () => {
  // The per-weapon overrides exist to preserve CS's ordering, which is the only
  // reason to depart from a class default at all. A departure that inverted the
  // order would be a straight mistake.
  const pairs = [
    ['P90', 'MAC10'],            // 0.86 vs 0.80
    ['Deagle', 'Tec-9'],         // 0.81 vs 0.78
    ['USP-S', 'Glock'],          // 0.90 vs 0.85
    ['Glock', 'Dual Berettas'],  // 0.85 vs 0.79
    ['AK47', 'FAMAS'],           // 0.98 vs 0.96
    ['Breacher', 'Nova']         // 0.80 vs 0.70
  ];
  for (const [better, worse] of pairs) {
    assert.ok(at(better, 30) > at(worse, 30), `${better} must out-range ${worse}`);
  }
});

test('the rifle keeps its one-tap headshot at the longest sightline', () => {
  // CS's own curve puts the AK at 0.91 across 45 m, which leaves a headshot at
  // 101 - a one-tap by a single point. That margin is the rifle's identity, and
  // a floor set even slightly lower silently takes it away.
  const head = core.applyDamageFalloff(core.WEAPONS.AK47.dmg.head, 'AK47', 'rifle', 45 * U);
  assert.ok(head >= 100, `an AK headshot at 45 m must still kill (got ${head})`);
  assert.ok(Math.abs(at('AK47', 45) - 0.91) < 0.02, 'and should track CS at that range');
});

test('the curve is continuous, monotonic and floored', () => {
  for (const name of ['Nova', 'MAC10', 'AK47', 'Glock', 'Breacher']) {
    const profile = core.damageFalloffProfile(name, core.WEAPONS[name].type);
    let previous = 1;
    for (let d = 0; d <= profile.end + 400; d += 10) {
      const scale = core.damageFalloffScale(name, core.WEAPONS[name].type, d);
      assert.ok(scale <= previous + 1e-9, `${name} must never regain damage at ${d}`);
      assert.ok(scale >= profile.min - 1e-9, `${name} must never drop below its floor`);
      previous = scale;
    }
    assert.equal(core.damageFalloffScale(name, core.WEAPONS[name].type, profile.start), 1,
      'full damage right up to the start of the curve');
    assert.equal(core.damageFalloffScale(name, core.WEAPONS[name].type, profile.end), profile.min,
      'and exactly the floor at the end of it');
  }
});

test('a hit that connected is never worth nothing', () => {
  // Rounding a long-range pellet to zero reads as the shot not registering,
  // which is a worse lie to tell a player than one damage.
  assert.equal(core.applyDamageFalloff(1, 'Nova', 'shotgun', 100 * U), 1);
  assert.equal(core.applyDamageFalloff(2, 'Nova', 'shotgun', 100 * U), 1);
  // But nothing invents damage out of a weapon that does none.
  assert.equal(core.applyDamageFalloff(0, 'Nova', 'shotgun', 0), 0);
  // Garbage distance must not silently become a damage buff.
  for (const bad of [NaN, undefined, null, -50, 'far']) {
    assert.equal(core.damageFalloffScale('Nova', 'shotgun', bad), 1, `distance ${bad}`);
  }
});

test('the server applies it, in the right order, to the distance it already trusts', () => {
  const fn = server.slice(server.indexOf('function handlePlayerHit'));
  const body = fn.slice(0, fn.indexOf('\nfunction ', 1));
  assert.match(body, /const falloff = core\.damageFalloffScale\(weapon, wdef\.type, dist\);/u,
    'falloff must be server-side and use the validated distance');

  const applyAt = body.indexOf('if (falloff < 1) damage =');
  const meleeAt = body.indexOf('damage = Boolean(data.alt) ? 50 : 34;');
  const shieldAt = body.indexOf('const shieldHit = resolveShieldHit(');
  const wallbangAt = body.indexOf("if (data.wallbang) damage = Math.max(1, Math.round(damage * 0.62));");
  assert.ok(applyAt > 0 && shieldAt > 0 && wallbangAt > 0 && meleeAt > 0);
  // A knife has no distance to fall off over, and the melee branch sets its own
  // damage - applying the scale after it would cut backstabs by range.
  assert.ok(applyAt > meleeAt, 'falloff belongs in the gunfire branch, not after the melee one');
  // Before the shield, so the plate stops what actually arrives rather than
  // what was fired; before the wallbang cut, so the two compound.
  assert.ok(applyAt < shieldAt, 'the shield must absorb the fallen-off damage');
  assert.ok(applyAt < wallbangAt);
  // `dist` is the value the range check already validated. Measuring it a
  // second time would let the two disagree.
  assert.match(body, /const dist = distanceBetweenVectors\(player\.position, target\.position\);/u);
  assert.ok(body.indexOf('const dist = distanceBetweenVectors') < applyAt);
});

test('the client stays out of it', () => {
  const client = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  // Damage is server-authoritative. A client that computed its own falloff
  // would be a client that could claim not to have any. core.js reaches the
  // client as window.GameCore, so that is the only way it could call in - the
  // weapon table's comment naming the function is documentation, not a call.
  assert.doesNotMatch(client, /GameCore\.(damageFalloffScale|applyDamageFalloff|damageFalloffProfile)/u);
  assert.doesNotMatch(client, /(damageFalloffScale|applyDamageFalloff)\(/u);
});
