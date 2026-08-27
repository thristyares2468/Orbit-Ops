# Containment

Co-operative wave survival for 1–4 players. Original mode; no assets, names or
layouts taken from anything else.

## Where the code lives

| File | Holds |
|---|---|
| `containment.js` | All the rules. Pure: no sockets, no database, no timers, no imports. Time is passed in. |
| `server.js` | The wiring. Rooms, sockets, ticks, and the authoritative damage path. Search for `// Containment (co-op wave survival)`. |
| `index.html` | HUD, procedural infected presentation, interpolation, weapon shop and gate interaction. |
| `test/containment.test.js` | The rules, walked exhaustively. |
| `test/containment-server.test.js` | The boundary — mode registration, packet routing, and the economy/authority guarantees. |

Containment also applies a mode-specific procedural sunset sky, smoky mauve fog
and warmer, lower-key lighting. The normal map atmosphere is restored whenever
the player returns to a PvP mode; the map itself does not need to reload.

The split is deliberate. `server.js` is already 8,000 lines carrying every PvP
mode, and Containment's wave curves and economy are where a quiet arithmetic
mistake becomes an exploit rather than a visual bug. Keeping them pure is what
lets the whole curve be walked in a test instead of sampled.

## Wave state machine

```
waiting ──beginMatch──▶ preparation ──timer──▶ active ──all dead──▶ cleared
                             ▲                                        │
                             └────────────timer───────────────────────┘
                                                                      │
                          (finite run, wave limit reached) ───────────▶ extraction

any live phase, no players alive but some present ──▶ defeat   (terminal)
                                                     extracted (terminal)
```

- A team wipe is checked before any other transition, so nothing else can fire
  on the tick the last player goes down.
- An **empty** room is not a wipe. Everyone disconnecting must not record a
  defeat — there is nobody to lose. `totalPlayers > 0 && alivePlayers === 0`.
- Terminal phases are terminal: `step()` returns immediately and nothing
  restarts a finished match.

## Scaling

`waveBudget(wave, players)` is the single source of difficulty. Count grows
quadratically, health compounds, speed and damage are capped so a late wave is
*dense* rather than impossible.

### Evening out across team size

Counting bodies alone does **not** even out. Four players bring four times the
damage but, at 0.55 a head, only 2.65× the enemies — a full lobby was about a
third easier per person than playing solo, and the mode got easier the more
people joined:

| wave | 1p | 2p | 3p | 4p |
|---|---|---|---|---|
| 10, before | 1.00 | 0.77 | 0.69 | **0.66** |
| 10, after | 1.00 | 0.99 | 0.99 | **1.00** |

*(per-player load; 1.00 = as much work each as a solo run)*

The health multiplier is derived so that

```
countMultiplier × healthMultiplier = players ^ teamScaling
```

At `teamScaling: 1` the total enemy health pool rises in step with the number of
guns pointed at it. Measured across waves 1–120 at every party size, per-player
load stays between **0.97 and 1.07**.

Split between count and health on purpose: four times the bodies would hit the
concurrency cap and quadruple both the simulation and the snapshot, and a screen
that full stops being readable. Raising health for part of it keeps the pool
honest at a fraction of the cost.

**The ceilings are team-aware.** `maxCount` and `maxHealth` are per-solo-player
limits — they exist to keep one screen readable and one simulation cheap, so
each is scaled by the same factor as the thing it caps. Left fixed they bind
past wave 25 and a full team's run silently goes soft (0.25 per-player by wave
40), which is exactly backwards. `maxConcurrent` is **not** scaled: how many are
alive at once is what keeps the screen readable regardless of party size.

Every output is still clamped. `waveBudget(400, 99)` is a valid call; player
count is clamped to 1–4 so a malformed lobby cannot inflate a wave.

## Economy

Credits are **match-local and never persisted.** `mowbucks` is written from
fifteen places in `server.js`, and Containment must never become a way to farm
the PvP economy. The tests assert the Containment section of `server.js`
contains no reference to `mowbucks`, `addMoney`, `addScore` or `statDelta`.

| Event | Credits |
|---|---|
| Kill | 60 |
| Headshot bonus | +30 |
| Assist | 20 |
| Revive | 120 |
| Repair | 15 |
| Wave clear | 250, to each player still standing |

Every player starts with 500 credits, a Glock and a knife. Press **B** to use
the familiar loadout screen: owned weapons can be re-equipped for free and new
weapons use the server's shared authoritative price table. Credits and unlocks
last only for the current run; a reconnect restores them without granting the
starting purse twice.

Three sector gates are distributed over the active map's valid spawn network.
Walk to a closed gate and press the normal interact binding to spend the shown
credit cost. The server validates the gate, distance and price, then broadcasts
the open state to the whole room; late joiners receive the same state.

## Preparation vote

During every preparation countdown, any living player can press **V** or use
the HUD button to vote to skip it. Votes are match-local and one-way for that
countdown. A strict majority of the currently eligible living players is
required; the server owns the voter list, tally and timer, then lets the normal
director tick start the next wave. Votes clear as soon as the wave begins, so
they cannot carry into later rounds.

`purchase()` returns a decision rather than performing one and refuses on any
doubt. It validates **before** any `|| 0` fallback — `Number(NaN) || 0` is `0`,
so coercing first would turn an unparseable price into a free purchase. That was
a real bug the tests caught while being written.

## Authority

Nothing below is ever taken from a packet:

- **Enemy damage** — from `core.WEAPONS[player.weapon]`, not `data.damage`.
- **Rewards** — from `rewardFor()`, a single table.
- **Prices** — passed in by the server, never read from the request.
- **Wave state** — the director's alone; the client is told, never asked.

A hit must also be within plausible range of the shooter, and an enemy already
removed from the map cannot be hit again.

## Fair spawning

`pickSpawn()` enforces two rules in order: never inside `minSpawnDistance` of a
player, and prefer somewhere nobody is looking. Line of sight is **injected** —
the server passes a callback backed by the map's own collision mesh, so
`containment.js` stays free of geometry.

Being seen is expensive, not disqualifying: a wave must not stall because
players are covering every door. If every candidate is too close, the furthest
point is used as a fallback — a spawn still has to happen somewhere.

## Host settings

Clamped in `sanitizeRoomSettings`, so nothing downstream has to decide whether a
lobby setting can be trusted.

| Setting | Range | Default |
|---|---|---|
| `containmentEndless` | boolean | `true` |
| `containmentWaveLimit` | 0–100 | 0 (unused when endless) |
| `containmentStartWave` | 0–50 | 0 |
| `containmentTeamScaling` | 0–1.5 | 1 |

`containmentTeamScaling` is the difficulty dial: 1 keeps every player working as
hard as a solo run, 0 is the older "more bodies, same toughness" curve. Values
below about 0.87 behave like 0, because enemy health is never reduced below the
solo baseline.

## Ticks

- `containmentTick` — 10 Hz. Phases, spawn release, wave rewards.
- `containmentEnemyTick` — 10 Hz. Motion, targeting, attacks, stuck recovery.

Two rather than one so the pacing of each can change without starving the other.
Only enemies that actually moved are broadcast, quantised the same way player
positions already are.

## Testing

```bash
node --test test/containment.test.js test/containment-server.test.js test/containment-client.test.js
```

The suites cover the director/economy, server authority boundary and the client
runtime bridge (spawn, interpolation, shooting, purchases and solid gates).

**A trap worth knowing:** the boundary test anchors its section slice on the
header line, not the prefix, because the import comment near the top of
`server.js` begins with the same words. Matching the prefix swallows most of the
file and turns every "must not appear" assertion into a false failure.

## Current limit

Enemies slide along collision segments and recover to a valid player spawn if
wedged, but this is lightweight pursuit rather than a baked navigation mesh.
Downed-player revival and a bespoke objective/extraction map remain future
extensions; a full team wipe already ends the run authoritatively.
