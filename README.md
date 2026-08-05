# Orbit Ops

Orbit Ops is a playable, server-authoritative 2D social-deduction game. One Node.js service hosts the Phaser client, Socket.IO simulation, Express health route, and optional Neon PostgreSQL persistence.

The host can select one of three isolated maps: **The Skeld**, **MIRA HQ**, or **Polus**. Each selection changes the authoritative room graph, world bounds, collision, spawn points, tasks, sabotages, emergency-button location, bot paths, Phaser deck, and player-map overlay together. Supplied non-logo artwork is kept within its original map family.

## Current feature set

- Guest, registration, login, hashed passwords, opaque HMAC-hashed sessions, logout, profile, and saved settings
- A walkable dropship lobby built from the supplied Lobby artwork: players move, gather, and chat in-world before launch, with the host's parameters, room code, crew manifest, and a boarding-console launch point layered over the live scene
- Public matchmaking with all-ready auto-launch, private room codes, practice simulations with bots, host settings, ready state, and host reassignment
- 45-second reconnect reservation with rotated rejoin tokens
- 20 Hz authoritative movement simulation and 10 Hz world snapshots
- A declarative role framework: each role states its faction, ability (targeting, cooldown, uses), win condition, hooks and extra state, rather than being branched on by id. Abilities run server-side against a narrow API so a role cannot reach past the rules it is allowed to touch. Twenty roles ship so far, growing toward the Town Of Us R roster.
- The reference's nine assignments: Turn On The Lights, Fix The Electricity Wires, Stabilize The Ship's Navigation, Reboot The Wifi, Empty The Garbage, Divert Power To Reactor, Align Engine Output, Fuel Lower Engine, and Clear The Asteroids.
- An Admin table showing live per-room head counts (never names, and dark during a lights sabotage) and a security monitor showing a live camera feed rather than delayed telemetry. Vented players appear on neither.
- Vents are a connected network rather than fixed pairs: an operative climbs in, travels between any vents sharing that network, and climbs out. While inside they are frozen, hidden from every other client's snapshot, and cannot kill, be killed, report, or run assignments. Meetings empty the vents.
- Limited sight: the deck is dark beyond a radius around you, enforced server-side so culled players and bodies are never sent to the client at all. Operatives see further than crew, and a lights sabotage collapses the crew's radius while barely touching the operative's. Ghosts and meetings reveal everything.
- Server-private role assignment with Engineer, Medic, Sheriff, Tracker, Morphling, Swooper, Janitor, Jester, Survivor, and base Crew/Operative roles
- Ghosts: eliminated players keep drifting through walls at a small speed bonus, finish their assignments, and chat on the dead-only channel, while the living never receive ghost positions; the first fallen crew member returns as the Guardian Angel with a protect shield
- Eight map-specific server-sequenced assignments per map using supplied task artwork
- Four map-specific sabotage systems per map, including timed critical failures and multi-station repair; practice mode removes action cooldowns for testing and paces bot sabotage so the opening minute stays playable
- Server-validated role abilities, elimination, incident evidence, emergency-button calls, reporting, meetings, discussion, voting, removal, and faction/neutral win conditions
- Living/dead chat separation, input validation, payload limits, action rate limits, and no direct client database access
- Security telemetry, delayed door logs, Operative maintenance routes, spectator state, match results, and persistent statistics
- Responsive low-chrome HUD, minimap, settings, accessibility options, synthesized fallback audio, and a lazy-loaded supplied-art archive

## Run locally

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm start
```

Open `http://localhost:3000`. Guest multiplayer and practice mode work without PostgreSQL. Account registration and persistence become available when `DATABASE_URL` is configured.

For development with automatic server restart:

```bash
npm run dev
```

## Controls

| Input | Action |
| --- | --- |
| `W A S D` or arrow keys | Move |
| `Shift` | Sprint |
| `C` or `Ctrl` | Stealth-walk |
| `E` | Use a nearby station, repair, console, reportable incident, vent, or the lobby boarding console |
| `Alt` | Move to the next vent while inside the vent network |
| `R` | Report a nearby incident |
| `Q` | Operative elimination attempt |
| `F` | Operative sabotage panel |
| `G` | Use the current role ability |
| `Tab` | Selected map |
| `Enter` | Focus meeting chat |
| `Esc` | System menu (the match keeps running) |

The server decides whether interactions are valid; client buttons and proximity prompts are only requests.

## Project layout

```text
server.js                         Express, Socket.IO, health route, shutdown
server/gameServer.js              Authoritative rooms, simulation, match rules, bots
server/authService.js             Account and session service
database/schema.sql               Neon/PostgreSQL schema
database/repositories/            Parameterized account and match queries
public/index.html                 Application surfaces and HUD
public/style.css                  Responsive visual system
public/src/game.js                Client orchestration and Phaser bridge
public/src/mapSchema.js           Reusable map validation and corridor generation
public/src/shipData.js            Four-map registry and authoritative geometry lookup
public/src/maps/                  Isolated Skeld, MIRA HQ, and Polus definitions
public/src/maps/lobbyDropship.js  Pre-match dropship lobby map (never a selectable match map)
public/assets/lobby/              Sprites split out of the supplied Lobby sheet
public/src/game2d/MapBuilder.js   Layered room/corridor/station Phaser construction
public/src/game2d/MeridianScene.js Replaceable top-down room renderer
public/src/game2d/CharacterSprite.js Channel-aware player animation and recolouring
public/src/game2d/assets.js        Stable 2D map and station asset mappings
public/src/roleData.js             Stable role surface over the registry
public/src/roles/defineRole.js    Role framework: abilities, win kinds, hooks, modifiers
public/src/roles/catalogue.js     Declarative role definitions
server/roleEngine.js              Executes role abilities and solo win conditions
public/src/tasks.js               Assignment interfaces and supplied task art mapping
public/src/assetManifest.js       Runtime-critical asset manifest
public/src/artCatalog.js          Generated full non-logo catalog
docs/asset-inventory.json         Machine-readable dimensions and intended use
tests/                             Authoritative rule and real Socket.IO tests
render.yaml                       Render Blueprint configuration
```

The Skeld and MIRA HQ room transforms and corridor routes are traced from the supplied in-game
minimap sheets (`Gui/map-sharedassets0.assets-125.png` and `Gui/map_HQ-sharedassets0.assets-83.png`)
rather than authored by eye: rooms come from the saturated room blobs, and each corridor route is a
clearance-weighted path across the sheet's real walkable pixels, reduced to axis-aligned `via`
waypoints. Connections whose only path is a long way round are rejected rather than invented, so the
adjacency graph matches the reference. Polus is derived the same way from
`Gui/mapPB-sharedassets0.assets-103.png`, with its open snowfields decomposed into walkable zones.
The Airship was removed at the owner's request because the supplied pack contains no Airship art.

The maps follow a data/build split without importing compiled Unity code or third-party map art.
`public/src/shipData.js` exposes a registry whose four definitions live under `public/src/maps/`.
Every definition owns its room transforms, adjacency, explicit orthogonal corridor routes, prop
collision rectangles, station anchors, spawn points, tasks, sabotages, camera bounds, visible
render layers, and non-rendered object groups. Polus also defines broad walkable exterior zones.
`public/src/game2d/MapBuilder.js` turns the selected definition into disposable Phaser containers.
The authoritative server reads those same routes and volumes for movement, interactions, and bot
navigation.

This layered/object-group organization adapts the useful public-domain map-loading pattern in the
project-owner-supplied Python fan conversion: visible map layers are built in order, while named
object groups carry collision, spawn, and interaction data. The conversion's bundled original-game
TMX map and ripped assets are deliberately excluded.

The Skeld uses its two central hubs and east/west ship wings. MIRA HQ uses its long launchpad route
and three-way headquarters junction. Polus uses its dropship, exposed outpost paths, laboratory, and
specimen route. The clickable HUD map and `Tab` overlay always render the selected server map,
with private assignment, sabotage, and local-player markers layered on top.

Future authored map code can replace any individual definition without putting gameplay rules
inside Phaser. Existing room and station IDs should be retained or migrated deliberately because
tasks, sabotage, meetings, and bot navigation refer to them.
Character sheet integration remains isolated in `public/src/game2d/CharacterSprite.js`.

## Supplied assets

All 172 supplied non-logo PNG files are copied under `public/assets/art/` without destructive conversion. Logo files are deliberately excluded at the owner's request. The full per-file inventory is in [`docs/asset-inventory.json`](docs/asset-inventory.json), with a readable summary in [`docs/asset-inventory.md`](docs/asset-inventory.md).

Important runtime mappings:

| Asset | Current use |
| --- | --- |
| `Background/Stars-sharedassets0.assets-56.png` | Loading/menu background and Phaser world backdrop |
| `Background/Paralax1-sharedassets0.assets-115.png` | Essential anomaly/environment layer in the asset loader |
| `Maps/Cafeteria`, `Engine`, `MedBay`, `Weapons`, and `Navigation` | Verified Skeld room art; mixed sheets use deliberate crops with preserved aspect ratio |
| `Maps/Lobby/Lobby-sharedassets0.assets-54.png` | Split losslessly into `public/assets/lobby/` and rendered as the pre-match dropship lobby |
| `Maps/launchPadWalls` | Verified MIRA HQ Launchpad room art |
| `Maps/HQAssets`, `compLabGreenHouseAdminWalls` | Cropped into `public/assets/rooms/` for MIRA HQ's Cafeteria, Admin, Laboratory, Greenhouse, MedBay, and Storage |
| `Maps/LifeSupport` | Cropped into `public/assets/rooms/skeld-o2.png` for the Skeld O2 room |
| `room_O2`, `room_broadcast`, `room_science`, `room_specimen`, `room_tunnel2`, `room_weapon`, and `room_storage` | Verified Polus room art |
| `HQAssets*`, `PlanetSprites*`, `ReactorRoom`, and other packed sheets | Retained in the archive for future extraction; never stretched across a room |
| `player-models/base/idle`, `walk`, and `death` frames | Live 58×76 player model, movement animation, and elimination animation |
| `Tasks/Consolas_0`, `Emergency`, `DoorLog`, `panel_doors_bg`, and reactor panel art | Live world station markers |
| `Tasks/grid-sharedassets0.assets-156.png` | Task-console holographic surface |
| Ten task images including `Radio`, `Calibrator`, `SetCourse`, `ProcessData`, `SortGame`, `MonitorOxy`, `BoardingPass`, `engineAlign_base`, `MedScan`, and `Wifi` | Reference art for the ten playable assignments |
| `Voting`, `DISCUSS!`, and `SHHHHH!` | Voting, meeting, and role-reveal presentation |
| `Gui`, `Accessories & Pets`, and remaining images | Catalogued, lazy-rendered in the Asset Archive, and ready for authored integration |

No audio files were present in the supplied asset folder, so WebAudio cues keep the game playable until authored audio is provided.

The new player frame archive is colour-mapped by source channel rather than hue-shifted as one
image: red becomes the main suit colour, blue becomes the darker suit shadow, and green becomes the
player's visor colour. The original model proportions remain fixed at the approved on-screen size.
See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the Town Of Us R and player-animation
asset provenance and license boundaries.

Regenerate the catalog after adding or removing non-logo art:

```bash
npm run assets:inventory
```

The generator rejects any file placed in a `Logos` category.

## Neon PostgreSQL

The schema includes accounts, sessions, settings, aggregate player statistics, matches, match players, cosmetics, bans, and mutes. Passwords use bcrypt with cost 12. Session and rejoin tokens are random, stored only as HMAC-SHA-256 hashes, and never sent to other clients. Database work uses parameterized queries and transactions.

1. Create a Neon project and copy its pooled PostgreSQL connection string.
2. Use `.env.example` as a template, load those variables through your shell or service, and set `DATABASE_URL`.
3. Set a unique `SESSION_SECRET` of at least 32 random characters. Changing it invalidates existing sessions and room rejoin tokens.
4. Keep `DATABASE_SSL=true` for Neon.
5. Apply and optionally seed the database:

```bash
DATABASE_URL='postgresql://...' SESSION_SECRET='your-long-random-secret' npm run db:migrate
DATABASE_URL='postgresql://...' SESSION_SECRET='your-long-random-secret' npm run db:seed
```

`schema.sql` is idempotent and can be run again during a deployment. The application never exposes the connection string to the browser.

## Render deployment

The included `render.yaml` creates one free-plan Web Service; no separate static site or hardcoded host is needed.

1. Review the changes, then push this repository to GitHub when ready.
2. Create a Render Web Service or apply the repository Blueprint.
3. Use build command `npm install` and start command `npm start`.
4. Add the Neon connection string as `DATABASE_URL`.
5. Add a strong `SESSION_SECRET`; the Blueprint can generate one.
6. Set `DATABASE_SSL=true` and `NODE_ENV=production`.
7. Run `npm run db:migrate` once against the Neon database. Run `npm run db:seed` if starter cosmetics are wanted.
8. Set the health-check path to `/health` and deploy.
9. Open the public Render URL, then confirm the client loads, Socket.IO connects on the same origin, and `/health` reports `"databaseConnected": true`.
10. Test guest mode, registration/login, two-browser room joining, and one complete match.

Required production variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon PostgreSQL pooled connection string |
| `SESSION_SECRET` | HMAC secret, minimum 32 characters in production |
| `DATABASE_SSL=true` | Enables Neon TLS configuration |
| `NODE_ENV=production` | Production caching and secret validation |

Render supplies `PORT`; the server binds `0.0.0.0` and defaults to port 3000 locally.

## Verification

```bash
npm run check
npm test
```

`tests/smoke.test.js` additionally drives one full practice run over a real Socket.IO
connection: guest entry, practice lobby, a parameter edit, authoritative movement, the
assignment panel, one task played to completion, an emergency meeting with its discussion
and voting timers, confirmation that simulation time advances while the system menu is
open, and the return to lobby. A second pass covers an Operative sabotage being resolved
by crew bots and a server-validated role ability.

The automated suite validates every room, routed corridor, exterior zone, spawn, collision, task,
sabotage repair point, emergency button, and verified room-art allowlist on all three maps. It also
verifies the authoritative elimination → incident → vote → victory path and four real Socket.IO
clients changing maps, joining, receiving private role/task state, starting a match, moving through
server snapshots, and being denied a Crew elimination request.

The project has also been browser-playtested through map selection and rendered gameplay/player-map
views for The Skeld, MIRA HQ, and Polus. Database migration was not executed in this
checkout because no Neon `DATABASE_URL` was supplied.

## Known limitations and next integration points

- The four room transforms and corridor routes are reference-authored approximations ready for the owner's later exact map code. They are intentionally isolated rather than combined into one deck.
- The supplied asset pack contains several packed atlases whose filenames resemble rooms but whose pixels also contain props, effects, or task-animation frames. Only verified whole-room images and deliberate Skeld crops are rendered; other packed sheets stay available in the archive.
- Supplied map, player, station, task, voting, meeting, role-reveal, role-icon, walk, and standard death art is live in gameplay. The three irregular cinematic death sheets are retained as reference assets for a later attacker/victim animation pass.
- Audio is synthesized because no supplied audio files were found.
- The controls are desktop-first; responsive menus work at narrow widths, but touch gameplay controls are not implemented.
- Practice bots exercise navigation, tasks, sabotage, elimination, and voting heuristics; they are training opponents, not production matchmaking AI.
- Practice paces bot sabotage so a new player can explore: the first bot sabotage waits out a 75-second opening grace period, and later attempts wait ~52 seconds after the deck was last cleared. Online pacing still follows the room's configured sabotage cooldown.
- Crew bots answer an active sabotage: one bot is assigned per outstanding repair station, routed through authored corridors, so a two-station critical failure is resolvable rather than an automatic loss.
- Escape opens a system menu, not a pause. The simulation is server-authoritative and keeps running in both online and practice modes, and the menu says so.
- Practice never spends finite role uses, so the HUD reports unlimited practice uses there while online matches still count them down. Cooldowns remain real in both modes.
- Render's free service may cold-start, and in-memory rooms do not survive a process restart. Durable match/account data remains in Neon.

Recommended next step: when exact authored map or asset-use code is ready, replace one definition at
a time under `public/src/maps/` while retaining its room and station IDs or migrating them
deliberately.
