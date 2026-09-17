# Skin rarity: making it intrinsic, and what still needs calibrating

## What changed

`enrichCatalogItem` in `skins.js` used to null out the rarity of every non-knife
skin:

```js
rarity: item?.weapon === 'Knife' || item?.fixedRarity ? normalizeRarity(item.rarity) : null,
```

The stated principle was that a firearm's rarity belongs to the *case drop*, not
to the reusable skin. In practice that principle had a trap in it. When
`sanitizeCaseDefinition` builds a stored case entry it resolves:

```js
const rarity = normalizeRarity(rawEntry?.rarity || rawEntry?.tier || item.rarity);
```

With `item.rarity` nulled, any case entry saved without a hand-picked rarity
fell through to `normalizeRarity(null)`, which is `'common'`. Not "unset" —
**Common**. `AWP | Dragon Lore` dropped as a Common unless someone remembered to
set it by hand in the case editor.

The authored values were there the whole time: 262 of the 263 non-knife skins
declare a tier in source (AK/AWP inline in `skins.js`, 211 in
`skins_imported.js`, 10 Dual Berettas via `fixedRarity`). `enrichCatalogItem`
was throwing all of them away.

It now reads:

```js
rarity: normalizeRarity(item.rarity),
```

## This cannot disturb the six known-good cases

`sanitizeCaseDefinition` writes an *explicit* rarity onto every stored entry, and
a stored entry always wins over the catalogue. The Warehouse (`wearhouse`),
Tradie, Mulch, Lawn Care, Gardener and Diamond Strong cases keep exactly the
tiers they have. Verified by probe and pinned by
`test/skin-rarity-ladder.test.js`. The change only affects what an *unset* entry
inherits — previously Common, now the skin's authored tier.

## Distribution after the change (non-knife)

`common: 144, rare: 61, epic: 40, legendary: 18`. Mythic stays knife-only, both
by convention and by `sanitizeCaseDefinition` throwing `mythic_requires_knife`.

## What still needs calibrating

The authored tiers are not evenly considered. Grouped by how many distinct tiers
a weapon's skins span:

| Tiers | Weapon | Skins | Distribution |
| --- | --- | --- | --- |
| 1 | Shield | 11 | common 11 |
| 1 | Breacher | 10 | common 10 |
| 1 | RPG | 10 | common 10 |
| 2 | Glock | 25 | common 11, rare 14 |
| 2 | Deagle | 24 | common 13, epic 11 |
| 2 | FAMAS | 24 | common 13, epic 11 |
| 2 | MAC10 | 22 | common 10, rare 12 |
| 2 | Nova | 20 | common 10, rare 10 |
| 2 | P90 | 20 | common 9, rare 11 |
| 2 | XM1014 | 20 | common 10, rare 10 |
| 2 | SSG 08 | 19 | common 9, epic 10 |
| 3 | AWP | 26 | common 13, epic 2, legendary 11 |
| 4 | AK47 | 22 | common 13, rare 1, epic 3, legendary 5 |
| 4 | Dual Berettas | 10 | common 2, rare 3, epic 3, legendary 2 |

Only AK47 and Dual Berettas have a real ladder. The single-tier and two-tier
blocks look like a per-weapon blanket applied at import time rather than a
judgement about individual skins — Breacher/RPG/Shield are uniformly Common, and
the two-tier weapons split roughly 50/50 between Common and exactly one other
tier, which is the signature of a bulk assignment.

AWP's 11 legendaries out of 26 is the opposite problem: too top-heavy to sit
alongside AK47's 5-of-22.

Open items:

1. Retier Breacher, RPG and Shield (31 skins currently sharing one tier).
2. Retier the seven two-tier weapons into a full ladder.
3. Reconsider AWP's legendary count against AK47's.
4. `AWP | Sovereign Flame` was the one skin that never declared a tier. It is now
   pinned explicitly to `common` — the value it already resolved to — so the
   intrinsic-rarity change is a no-op for it. That is a placeholder, not a
   placement.

None of this should be done by invention. Run `docs/case-rarity-export.sql`
QUERY A against the live database and calibrate against what the six known-good
cases actually assign; those came from the original dev team and are the only
trustworthy reference in the system.
