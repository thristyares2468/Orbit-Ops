// Last updated: 17 September 2026
// The catalogue's rarity ladder.
//
// Background: firearm rarity used to be nulled out of the catalogue on the
// principle that only a case drop should classify a skin. The authored tiers
// existed anyway - 262 of the 263 non-knife skins declared one - and throwing
// them away meant any case entry saved without a hand-picked rarity became a
// Common drop, because normalizeRarity(null) is 'common'. AWP | Dragon Lore
// dropped as a Common.
//
// So the catalogue now carries the tier, and this file holds the two things
// that makes safe: a case entry still overrides it, and mythic stays on knives.
const assert = require('assert');
const test = require('node:test');
const skins = require('../skins');

const RARITY_IDS = new Set(skins.RARITIES.map((rarity) => rarity.id));
const CATALOG = skins.publicCatalog([]).items;
const FIREARMS = CATALOG.filter((item) => item.weapon !== 'Knife');

test('every catalog skin carries a valid tier', () => {
  for (const item of CATALOG) {
    assert.ok(RARITY_IDS.has(item.rarity), `${item.id} has no valid rarity (${item.rarity})`);
  }
});

test('a case entry still overrides the catalog tier', () => {
  // This is what the old "no catalog rarity" rule was really protecting, and it
  // is the reason changing the catalog cannot disturb a case that is already
  // correct: the six built by the original team store a rarity on every entry.
  const legendary = FIREARMS.find((item) => item.rarity === 'legendary');
  assert.ok(legendary, 'expected at least one legendary firearm to test with');
  const overridden = skins.sanitizeCaseDefinition({
    id: 'probe', displayName: 'Probe',
    items: [{ itemId: legendary.id, rarity: 'common', weight: 5 }]
  });
  assert.strictEqual(overridden.items[0].rarity, 'common', 'the stored entry must win');
});

test('an entry with no rarity inherits the catalog tier, not Common', () => {
  const legendary = FIREARMS.find((item) => item.rarity === 'legendary');
  const inherited = skins.sanitizeCaseDefinition({
    id: 'probe2', displayName: 'Probe 2',
    items: [{ itemId: legendary.id, weight: 5 }]
  });
  assert.strictEqual(inherited.items[0].rarity, 'legendary',
    'an unset entry used to silently become Common; it must now inherit');
});

// Mythic used to mean "knife", and the M4A1 Elite Retaliator is the deliberate exception
// that ended that. What replaced it is a stricter rule than the one it relaxed:
// Mythic is now an authored per-item allowlist, so a case entry can confirm the
// tier but can never promote an ordinary skin into it. This pins the allowlist
// itself, so widening it again has to be a decision rather than an accident.
const MYTHIC_NON_KNIVES = [
  'awp_heavy_sniper',
  'deagle_firestrike_elite',
  'dual_berettas_doublestrike',
  'glock_jolt',
  'm4a1_g36',
  'm4a1_vanguard',
  'mac10_retaliator',
  'p90_delete',
  'ssg08_super_soaker'
];

test('mythic is an authored allowlist, not a tier a case entry can hand out', () => {
  const mythicNonKnives = skins.ITEMS
    .filter((item) => item.rarity === 'mythic' && item.weapon !== 'Knife')
    .map((item) => item.id)
    .sort();
  assert.deepStrictEqual(mythicNonKnives, MYTHIC_NON_KNIVES.slice().sort(),
    'a firearm became Mythic without being added to the allowlist above');
  for (const item of FIREARMS) {
    if (MYTHIC_NON_KNIVES.includes(item.id)) continue;
    assert.notStrictEqual(item.rarity, 'mythic', `${item.id} must not be mythic`);
  }
  const ordinary = FIREARMS.find((item) => !MYTHIC_NON_KNIVES.includes(item.id));
  assert.throws(
    () => skins.sanitizeCaseDefinition({
      id: 'probe3', displayName: 'Probe 3',
      items: [{ itemId: ordinary.id, rarity: 'mythic', weight: 1 }]
    }),
    /mythic_requires_knife/
  );
  // The allowlisted one is accepted, so the guard is discriminating rather than
  // simply still rejecting everything.
  assert.doesNotThrow(() => skins.sanitizeCaseDefinition({
    id: 'probe4', displayName: 'Probe 4',
    items: [{ itemId: 'm4a1_vanguard', rarity: 'mythic', weight: 1 }]
  }));
});

test('an authored mythic never drops from the ordinary pull pool', () => {
  // The prototype case's non-gold pool used to be "everything that is not a
  // knife", so a Mythic rifle would have fallen straight into it as an ordinary
  // pull. Driven through the real roll rather than the private array: every
  // non-gold result must still be a non-Mythic item.
  for (let seed = 1; seed < 400; seed += 1) {
    let next = seed;
    const randomInt = (max) => {
      next = (next * 1103515245 + 12345) % 2147483648;
      return next % max;
    };
    const result = skins.rollPrototypeCase(randomInt);
    assert.ok(result, 'the prototype case must always roll something');
    if (result.gold) {
      assert.strictEqual(result.item.weapon, 'Knife', 'the gold pull stays knife-only');
      continue;
    }
    assert.notStrictEqual(result.tier, 'mythic', `${result.item.id} dropped as an ordinary pull`);
    assert.ok(!MYTHIC_NON_KNIVES.includes(result.item.id), `${result.item.id} must not be an ordinary pull`);
  }
});

test('every knife is mythic, including the two defaults', () => {
  const knives = CATALOG.filter((item) => item.weapon === 'Knife');
  for (const knife of knives) {
    assert.strictEqual(knife.rarity, 'mythic', `${knife.id} should be mythic`);
  }
});

// ---------------------------------------------------------------------------
// The taxonomy taken from the six cases the original dev team authored
// (wearhouse, tradie, mulch, lawn_care, gardener, diamond_strong). Rarity there
// is a property of the finish, not of the weapon: 46 of the 48 finishes those
// cases use hold the same tier every time they appear. These are those 46, and
// they are what the rest of the catalogue was calibrated against.
// ---------------------------------------------------------------------------
const REFERENCE_FINISHES = Object.freeze({
  blue_steel: 'common', bright_water: 'common', forest_ddpat: 'common',
  graffiti_nigh: 'common', midnight_palm: 'common', night_stripe: 'common',
  olive_drab: 'common', safari_mesh: 'common', scales: 'common',
  scorched: 'common', scraped_steel: 'common', snake_camo: 'common',
  sunrise_dunes: 'common', ultraviolet_swirl: 'common', urban_ddpat: 'common',
  urban_masked: 'common', woodgrain: 'common', woodland_leaves: 'common',
  afterimage: 'rare', fever_dream: 'rare', franklin: 'rare', monkeyflage: 'rare',
  monster_melt: 'rare', sacrifice: 'rare', wave_breaker: 'rare', wurst_holle: 'rare',
  asiimov: 'epic', conspiracy: 'epic', hyper_beast: 'epic', ice_coaled: 'epic',
  jog: 'epic', mirror_mosaic: 'epic', neo_noir: 'epic', neoqueen: 'epic',
  ocular: 'epic', rangeen: 'epic', watchdog: 'epic',
  bad_trip: 'legendary', case_hardened: 'legendary', cat_fight: 'legendary',
  deathgaze: 'legendary', dragonfire: 'legendary', firebreathing: 'legendary',
  inheritence: 'legendary', printstream: 'legendary', ramese_s_reach: 'legendary',
  rising_sun: 'legendary', sovereign_flame: 'legendary', stalker: 'legendary'
});

// graphite_tech and royal_camo are the two the reference cases disagree on, each
// by one adjacent tier. The catalogue takes the majority reading; the cases keep
// their own stored values either way, so nothing live moves.
const REFERENCE_EXCEPTIONS = Object.freeze(['graphite_tech', 'royal_camo']);

const WEAPON_PREFIXES = ['dual_berettas', 'm4a1', 'ak47', 'awp', 'deagle', 'famas', 'glock',
  'mac10', 'nova', 'p90', 'ssg08', 'xm1014', 'breacher', 'rpg', 'shield'];

function finishOf(id) {
  const prefix = WEAPON_PREFIXES
    .filter((candidate) => id.startsWith(`${candidate}_`))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? id.slice(prefix.length + 1) : null;
}

test('firearm skins match the tier the reference cases give their finish', () => {
  for (const item of FIREARMS) {
    const finish = finishOf(item.id);
    if (!finish || !(finish in REFERENCE_FINISHES)) continue;
    assert.strictEqual(item.rarity, REFERENCE_FINISHES[finish],
      `${item.id} carries ${item.rarity} but the reference cases rate ${finish} as ${REFERENCE_FINISHES[finish]}`);
  }
});

test('a finish keeps one tier across every weapon it appears on', () => {
  const tiersByFinish = new Map();
  for (const item of FIREARMS) {
    const finish = finishOf(item.id);
    if (!finish || REFERENCE_EXCEPTIONS.includes(finish)) continue;
    if (!tiersByFinish.has(finish)) tiersByFinish.set(finish, new Map());
    tiersByFinish.get(finish).set(item.rarity, item.id);
  }
  for (const [finish, tiers] of tiersByFinish) {
    assert.strictEqual(tiers.size, 1,
      `${finish} is split across ${[...tiers.keys()].join('/')} (${[...tiers.values()].join(', ')})`);
  }
});

// No weapon is currently exempt from the complete common/rare/epic/legendary
// ladder. Future exemptions must be deliberate and temporary.
const LADDER_PENDING_WEAPONS = new Set();

test('every weapon spans the full four-tier ladder', () => {
  const tiersByWeapon = new Map();
  for (const item of FIREARMS) {
    if (!tiersByWeapon.has(item.weapon)) tiersByWeapon.set(item.weapon, new Set());
    tiersByWeapon.get(item.weapon).add(item.rarity);
  }
  for (const [weapon, tiers] of tiersByWeapon) {
    if (LADDER_PENDING_WEAPONS.has(weapon)) {
      // Still assert what it does have, so the exemption cannot hide a
      // regression in the skins it already ships.
      assert.ok(tiers.has('mythic'), `${weapon} is exempt only while it has its mythic`);
      continue;
    }
    for (const tier of ['common', 'rare', 'epic', 'legendary']) {
      assert.ok(tiers.has(tier), `${weapon} has no ${tier} skin (only ${[...tiers].join('/')})`);
    }
  }
});

// ---------------------------------------------------------------------------
// Every case in the live database, as exported on 17 September 2026: the six
// the original dev team authored (wearhouse, tradie, mulch, lawn_care,
// gardener, diamond_strong) plus operative_case, curry_case, arsenal_case and
// nuke. 624 drops in total.
//
// The catalogue agrees with all of them bar two, so this is the real guard on
// the calibration - far stronger than the taxonomy check above, because it
// pins actual stored values rather than a rule inferred from them.
// ---------------------------------------------------------------------------
const STORED_CASES = require('./fixtures/stored-case-rarities.json');

// The only two disagreements, and they are disagreements the reference cases
// have with themselves: both finishes appear at two adjacent tiers across the
// six, so the catalogue takes the majority (Common) reading. The stored entries
// keep their own values, so neither case actually changes.
const KNOWN_DIVERGENCES = Object.freeze({
  'lawn_care:ak47_royal_camo': 'rare',
  'wearhouse:mac10_graphite_tech': 'rare'
});

test('the catalogue matches every drop stored in every live case', () => {
  const byId = new Map(CATALOG.map((item) => [item.id, item]));
  const mismatches = [];
  let checked = 0;
  for (const [caseId, drops] of Object.entries(STORED_CASES)) {
    for (const [itemId, storedRarity] of Object.entries(drops)) {
      const item = byId.get(itemId);
      assert.ok(item, `${caseId} drops ${itemId}, which is not in the catalogue`);
      if (KNOWN_DIVERGENCES[`${caseId}:${itemId}`] === storedRarity) continue;
      checked += 1;
      if (item.rarity !== storedRarity) {
        mismatches.push(`${caseId} / ${itemId}: stored ${storedRarity}, catalogue ${item.rarity}`);
      }
    }
  }
  assert.deepStrictEqual(mismatches, [], `catalogue disagrees with stored case drops:\n  ${mismatches.join('\n  ')}`);
  assert.ok(checked > 600, `expected to check the whole export, only saw ${checked} drops`);
});

test('the two known divergences are still the only ones tolerated', () => {
  const byId = new Map(CATALOG.map((item) => [item.id, item]));
  for (const [key, storedRarity] of Object.entries(KNOWN_DIVERGENCES)) {
    const [caseId, itemId] = key.split(':');
    assert.strictEqual(STORED_CASES[caseId]?.[itemId], storedRarity,
      `${key} is no longer stored as ${storedRarity}; re-check the exemption`);
    assert.notStrictEqual(byId.get(itemId)?.rarity, storedRarity,
      `${key} now agrees with the catalogue - delete the exemption`);
  }
});
