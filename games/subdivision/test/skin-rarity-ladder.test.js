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

test('mythic stays knife-only', () => {
  for (const item of FIREARMS) {
    assert.notStrictEqual(item.rarity, 'mythic', `${item.id} must not be mythic`);
  }
  assert.throws(
    () => skins.sanitizeCaseDefinition({
      id: 'probe3', displayName: 'Probe 3',
      items: [{ itemId: FIREARMS[0].id, rarity: 'mythic', weight: 1 }]
    }),
    /mythic_requires_knife/
  );
});

test('every knife is mythic except the two defaults', () => {
  const knives = CATALOG.filter((item) => item.weapon === 'Knife');
  for (const knife of knives) {
    const expected = skins.DEFAULT_KNIFE_ITEM_IDS.includes(knife.id) ? 'common' : 'mythic';
    assert.strictEqual(knife.rarity, expected, `${knife.id} should be ${expected}`);
  }
});
