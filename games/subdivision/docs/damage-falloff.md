# Damage falloff

## What was there before

Nothing. Every weapon dealt its full table damage at any distance up to
`AC.GUN_RANGE` (1050 units), where the hit was rejected as a range hack.

The client weapon table carried a `rangeMod` value on all 29 entries — AWP 0.99,
AK47 0.98, MAC10 0.80, Nova 0.70 — which are CS:GO's own `RangeModifier`
constants, lifted verbatim. Nothing in the client or the server ever read the
column. It is still unread; it is kept as the provenance for the per-weapon
ordering below, and `core.js` is now the thing that actually decides falloff.

## Scale

Falloff distances only mean something if we know what a world unit is. Three
independent anchors agree on **22 units per metre**:

| anchor | value | implies |
|---|---|---|
| `maps.js` `IMPORTED_MAP_SCALE` | 22 | the imported map GLBs are authored in metres and scaled by 22 |
| `AC.MELEE_RANGE` | 25.2 units | 1.15 m knife reach |
| `walkSpeed` / `runSpeed` | 35 / 75 u/s | 1.6 / 3.4 m/s — walking and jogging |

The player viewmodel is authored smaller (an 18-unit eye height would be 0.82 m),
but engagement distance is a property of the map, not of the arms on screen, so
the map scale governs. `core.UNITS_PER_METRE` is asserted against `maps.js` in
the tests so the two cannot drift apart.

Consequence: `AC.GUN_RANGE` is ~48 m, and the public maps are roughly 45–90 m
across. **45 m is the longest realistic sightline**, and is the distance every
table below is calibrated at.

## Research

Two distinct models are in use across the genre.

**CS:GO / CS2** — an unbounded exponential, `damage × rangeModifier^(distance/500)`,
where 500 units ≈ 9.5 m. Per-weapon `rangeModifier` runs from about 0.70 on
shotguns to 0.99 on the AWP. Valve does not publish the curve; the community
figures are reverse-engineered, but the per-weapon constants are in the game
files and are the ones already sitting in our weapon table. No floor: damage
decays toward zero.

**Everything else** — piecewise linear with a floor: full damage to a start
distance, linear decay to a minimum at an end distance, flat beyond.

| game | shotgun | SMG | assault rifle | sniper |
|---|---|---|---|---|
| Battlefield 2042 | 20 → 40 m | 50 → 100 m | 50 → 100 m | minimal |
| Apex Legends | — | 25–35 → 75–100 m | 25–35 → 75–100 m | minimal |
| Valorant | Bucky 8 m / 12 m tiers, ~53% floor, 50 m cap | — | Phantom 20 m → ~90%; Vandal none | none |
| Call of Duty (MW) | very short | short | ~37.5 → 50 m | none |
| CS:GO/CS2 (equivalent) | ~47% @ 20 m, ~18% @ 45 m | ~63% @ 20 m, ~35% @ 45 m | ~96% @ 20 m, ~91% @ 45 m | ~95% @ 45 m |

The consensus shape:

- **Shotguns** start dropping almost immediately and bottom out by ~30 m.
- **SMGs** hold to 15–25 m, bottom out by 45–60 m.
- **Rifles** hold to 25–40 m, bottom out by 75–100 m.
- **Snipers** have effectively none.

## What we implemented

Piecewise linear with a floor — the majority model, and the one the phrase
"falloff distance" actually describes. CS's per-weapon ordering is preserved via
`rangeMod`, but the curve is bounded so a long-range pellet lands on a floor
instead of decaying to nothing.

Class defaults (`core.DAMAGE_FALLOFF_CLASSES`):

| class | full to | floor at | floor |
|---|---|---|---|
| shotgun | 8 m | 30 m | 30% |
| SMG | 16 m | 45 m | 55% |
| pistol | 14 m | 40 m | 60% |
| rifle | 28 m | 75 m | 75% |
| sniper, melee, launcher, utility | — | — | 100% (none) |

Per-weapon departures exist only where `rangeMod` says the weapon is an outlier
in its class: Deagle and the accurate pistols (USP-S, Five-SeveN) hold up better;
the spray pistols (Dual Berettas, Tec-9, CZ75) worse; P90 better than MAC10;
Breacher better than the pure scatterguns; FAMAS worse than the AK.

### Two deliberate choices

**Rifles never reach their floor on these maps.** A 75 m end distance on a 45 m
map means an AK gives up ~9% at the longest sightline and no more. That is not an
oversight — it is what the research says, and it is what makes shotguns and SMGs
feel different. Flattening rifles to fit the map would have deleted the contrast
the feature exists to create.

**The rifle floor is 0.75 specifically to protect the one-tap.** CS's curve puts
the AK at 0.91 across 45 m, which leaves a headshot at 101 damage — lethal by a
single point. Our curve tracks that to within 0.02. A floor of 0.65 also looks
reasonable on paper and silently takes the AK's one-tap headshot away at long
range; that would be a change to the rifle's identity smuggled in under a
balance pass.

### Resulting shots-to-kill (100 hp, body)

| weapon | 3 m | 10 m | 20 m | 30 m | 45 m |
|---|---|---|---|---|---|
| Nova | 1 | 1 | 2 | 3 | 3 |
| XM1014 | 2 | 2 | 2 | 4 | 4 |
| MAC10 | 7 | 7 | 8 | 10 | 13 |
| P90 | 6 | 6 | 6 | 7 | 9 |
| FAMAS | 5 | 5 | 5 | 5 | 6 |
| AK47 | 4 | 4 | 4 | 4 | 4 |
| Deagle | 2 | 2 | 2 | 2 | 3 |
| Glock | 4 | 4 | 4 | 5 | 6 |
| AWP / SSG 08 | 1 / 2 | 1 / 2 | 1 / 2 | 1 / 2 | 1 / 2 |

## Where it is applied

`handlePlayerHit` in `server.js`, on the same `dist` the range check already
validated — before the shield (so the plate stops what actually arrives) and
before the wallbang cut (so the two compound). Melee is excluded: the knife has
no distance to fall off over. Blast weapons are excluded: they carry their own
radius falloff and stacking a second would double-count.

The client computes none of it. Damage is server-authoritative, and a client
that calculated its own falloff would be a client that could claim not to have
any.

## Sources

- [Damage dependence on distance (Steam guide)](https://steamcommunity.com/sharedfiles/filedetails/?id=2599082552)
- [CS2 Damage Falloff by Distance](https://cs2damage.com/damage-falloff/)
- [Modify weapon accurate range (AlliedModders)](https://forums.alliedmods.net/showthread.php?t=308978)
- [A Comparison of Damage Falloff in PvP FPSs](https://zekevirant.medium.com/a-comparison-of-damage-falloff-in-pvp-fpss-7be74fbb131)
- [Damage — Battlefield Wiki](https://battlefield.fandom.com/wiki/Damage)
- [Weapon — Apex Legends Wiki](https://apexlegends.wiki.gg/wiki/Weapon)
- [Bucky — Valorant Wiki](https://valorant.fandom.com/wiki/Bucky)
- [Phantom — Valorant Wiki](https://valorant.fandom.com/wiki/Phantom)
