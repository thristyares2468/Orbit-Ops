# Skin rarity: making it intrinsic, then calibrating it

## Part 1 - rarity became intrinsic

`enrichCatalogItem` in `skins.js` used to null out the rarity of every non-knife
skin, on the principle that a firearm's rarity belonged to the *case drop* rather
than to the reusable skin. That had a trap in it. `sanitizeCaseDefinition`
resolves a stored entry's tier as:

```js
const rarity = normalizeRarity(rawEntry?.rarity || rawEntry?.tier || item.rarity);
```

With `item.rarity` nulled, any case entry saved without a hand-picked rarity fell
through to `normalizeRarity(null)`, which is `'common'`. Not "unset" - **Common**.
`AWP | Dragon Lore` dropped as a Common unless someone remembered to set it by
hand in the case editor.

The authored tiers were there the whole time; `enrichCatalogItem` was discarding
them. It now reads `rarity: normalizeRarity(item.rarity)`.

## Part 2 - the taxonomy the original dev team actually used

Exporting the six known-good cases (`wearhouse`, `tradie`, `mulch`, `lawn_care`,
`gardener`, `diamond_strong`) and grouping their drops by *finish* rather than by
weapon shows the rule they were built on:

> **Rarity is a property of the finish, not of the weapon it is painted on.**

Across all six cases, **46 of the 48 finishes hold the same tier every single
time they appear**, on whatever weapon. The tiers group by how much artwork is on
the gun:

| Tier | What it looks like | Reference finishes |
| --- | --- | --- |
| Common | Plain camouflage, solid metal treatments | safari mesh, forest/urban ddpat, scraped steel, scorched, woodgrain, night stripe, snake camo, olive drab, bright water, blue steel, ultraviolet swirl, scales, woodland leaves, midnight palm, sunrise dunes, urban masked, graffiti nigh |
| Rare | One stylised motif over a plain body | franklin, afterimage, fever dream, monkeyflage, monster melt, sacrifice, wave breaker, wurst holle |
| Epic | Full-coverage artwork, anime/mecha/graphic | asiimov, hyper beast, neo-noir, mirror mosaic, ocular, neoqueen, watchdog, conspiracy, rangeen, ice coaled, jog |
| Legendary | Showpieces | case hardened, printstream, dragonfire, firebreathing, deathgaze, cat fight, stalker, rising sun, bad trip, inheritence, ramese's reach, sovereign flame |
| Mythic | Knives only | enforced by `mythic_requires_knife` |

Only `graphite_tech` and `royal_camo` vary, each by exactly one adjacent tier -
a per-case nudge rather than a disagreement. The catalogue takes the majority
(Common) reading for both; the stored case entries keep their own values, so
nothing live moves.

This taxonomy is encoded as `FINISH_RARITY` in `skins.js` and pinned as
`REFERENCE_FINISHES` in `test/skin-rarity-ladder.test.js`.

## Part 3 - what was corrected

**33 reference-backed corrections.** These are not judgement calls - the six
cases assign these tiers directly, and the catalogue disagreed. Notable ones:

- `awp_sovereign_flame` common → **legendary** (Mulch drops it as a legendary; it
  was the one skin in the whole catalogue that never declared a tier at all)
- `ak47_case_hardened` rare → **legendary**, `deagle_printstream` epic →
  **legendary**, `deagle_firebreathing` epic → **legendary**
- Demotions too: `ak47_asiimov` and `awp_asiimov` legendary → **epic**,
  `awp_ice_coaled` legendary → **epic**, `famas_afterimage` epic → **rare**,
  `ssg08_fever_dream` epic → **rare**
- Every `franklin` variant common → **rare**

**Equipment stopped being blanket-Common.** `equipmentPatternSkin` hardcoded
`rarity: 'common'`, so all 31 Breacher/RPG/Shield skins sat on one tier. It now
takes a rarity, and the shared-finish loop derives it from `FINISH_RARITY` - so
`rpg_case_hardened` and `breacher_case_hardened` are legendary for the same
reason `ak47_case_hardened` is.

**16 judged by appearance**, for finishes the reference never covers. These are
the only calls not backed by data, listed here so they can be argued with:

| Skin | From | To | Why |
| --- | --- | --- | --- |
| `rpg_fade`, `breacher_fade` | common | epic | Fade is a vivid full-coverage metallic gradient, not a camo |
| `shield_aurora_aegis` | common | legendary | Shield's showpiece; it had no top tier at all |
| `shield_gamma_energy` | common | epic | |
| `shield_crimson_bulwark`, `shield_rexton` | common | rare | |
| `breacher_ember_entry`, `breacher_dual_energy`, `rpg_orbital_energy` | common | rare | Bespoke finishes sitting among plain camos |
| `xm1014_oxide_blaze` | rare | epic | One finish, one tier - it was epic on Deagle and rare here |
| `glock_wasteland_rebel`, `glock_bullet_queen`, `mac10_neon_rider`, `p90_emerald_dragon` | rare | epic | Full-coverage artwork sitting beside plainer rares |
| `deagle_code_red`, `deagle_kumicho_dragon`, `ssg08_blood_in_the_water` | epic | legendary | Iconic showpieces, comparable to the reference legendaries |
| `xm1014_irezumi` | rare | legendary | The most elaborate artwork on the only weapon still missing a top tier |

## Result

Distribution went from `common 144, rare 61, epic 40, legendary 18` to
**`common 126, rare 53, epic 52, legendary 32`**.

Every weapon now spans all four tiers. Before, three weapons (Breacher, RPG,
Shield - 31 skins) sat entirely on Common, and eight more spanned only two tiers:

| | Before | After |
| --- | --- | --- |
| Weapons on 1 tier | 3 | 0 |
| Weapons on 2 tiers | 8 | 0 |
| Weapons on 3 tiers | 1 | 0 |
| Weapons on 4 tiers | 2 | 14 |

The catalogue agrees with the six reference cases on **64 of 66** firearm drops;
the two exceptions are `graphite_tech` and `royal_camo`, which the reference
cases disagree about internally.

## Cross-check: every live case

All ten cases in the database were exported on 17 September 2026 - the six the
original dev team authored plus `operative_case`, `curry_case`, `arsenal_case`
and `nuke`. **The calibrated catalogue agrees with all 624 stored drops except
the two the reference cases disagree about among themselves** (`ak47_royal_camo`
in Lawn Care, `mac10_graphite_tech` in Warehouse, both one adjacent tier).

So no stored case needs rewriting. `docs/case-rarity-migrate.sql` is a no-op
against the current data and is kept only for future imports.

### The sixteen appearance calls are no longer guesses

Every one of the calls made on appearance alone is confirmed by a stored case,
and **none is contradicted**:

| Call | Tier | Confirmed by |
| --- | --- | --- |
| `rpg_fade`, `breacher_fade` | epic | `arsenal_case` |
| `shield_aurora_aegis` | legendary | `curry_case`, `arsenal_case` |
| `shield_gamma_energy` | epic | `arsenal_case` |
| `shield_crimson_bulwark`, `shield_rexton` | rare | `arsenal_case` |
| `breacher_ember_entry`, `breacher_dual_energy` | rare | `arsenal_case` |
| `rpg_orbital_energy` | rare | `curry_case`, `arsenal_case` |
| `xm1014_oxide_blaze` | epic | `operative_case` |
| `glock_wasteland_rebel`, `glock_bullet_queen` | epic | `operative_case` |
| `mac10_neon_rider`, `p90_emerald_dragon` | epic | `operative_case` |
| `deagle_code_red`, `deagle_kumicho_dragon` | legendary | `operative_case` |
| `ssg08_blood_in_the_water` | legendary | `operative_case` |
| `xm1014_irezumi` | legendary | `operative_case`, `curry_case` |

The equipment ones are the meaningful part of this. Before the calibration,
`equipmentPatternSkin` hardcoded `rarity: 'common'`, so there was no value
anywhere in the repository saying `rpg_fade` was an epic or `shield_aurora_aegis`
a legendary - those tiers existed only as hand-picked entries in the case
editor, which had not been exported when the calls were made. The agreement is
independent.

### Where this is pinned

`test/fixtures/stored-case-rarities.json` holds all 624 drops, and
`test/skin-rarity-ladder.test.js` asserts the catalogue matches every one. That
is a stronger guard than the finish taxonomy, because it pins real stored values
rather than a rule inferred from them.
