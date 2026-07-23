# Orbit Ops

Orbit Ops is a playable, server-authoritative 3D social-deduction game set aboard the O.S.V. Meridian. One Node.js service hosts the Three.js client, Socket.IO simulation, Express health route, and optional Neon PostgreSQL persistence.

The current map and astronaut are intentionally procedural placeholders. The supplied non-logo artwork is preserved, catalogued, and separated from gameplay rules so authored map/asset-use code can replace the placeholders without rewriting the multiplayer systems.

## Current feature set

- Guest, registration, login, hashed passwords, opaque HMAC-hashed sessions, logout, profile, and saved settings
- Public matchmaking with all-ready auto-launch, private room codes, practice simulations with bots, host settings, ready state, and host reassignment
- 45-second reconnect reservation with rotated rejoin tokens
- 20 Hz authoritative movement simulation and 10 Hz world snapshots
- Secret Crew/Signal Operative assignment and role-private fake tasks
- Ten server-sequenced assignment interfaces using supplied task artwork
- Six sabotage systems, including timed critical failures and multi-station repair; practice mode removes action cooldowns for testing
- Server-validated elimination, incident evidence, reporting, meetings, discussion, voting, removal, and win conditions
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
| `W A S D` | Move |
| Mouse | Third-person camera |
| `Shift` | Sprint |
| `C` or `Ctrl` | Crouch |
| `Space` | Jump |
| `E` | Use a nearby station, repair, console, or reportable incident |
| `R` | Report a nearby incident |
| `Q` | Operative elimination attempt |
| `F` | Operative sabotage panel |
| `Tab` | Meridian map |
| `Enter` | Focus meeting chat |
| `Esc` | Pause |

Click the game viewport once to capture the pointer. The server decides whether interactions are valid; client buttons and proximity prompts are only requests.

## Project layout

```text
server.js                         Express, Socket.IO, health route, shutdown
server/gameServer.js              Authoritative rooms, simulation, match rules, bots
server/authService.js             Account and session service
database/schema.sql               Neon/PostgreSQL schema
database/repositories/            Parameterized account and match queries
public/index.html                 Application surfaces and HUD
public/style.css                  Responsive visual system
public/src/game.js                Client orchestration and render loop
public/src/world.js               Replaceable procedural map adapter
public/src/characterFactory.js    Replaceable procedural character adapter
public/src/shipData.js            Placeholder room graph, stations, tasks, collision data
public/src/tasks.js               Assignment interfaces and supplied task art mapping
public/src/assetManifest.js       Runtime-critical asset manifest
public/src/artCatalog.js          Generated full non-logo catalog
docs/asset-inventory.json         Machine-readable dimensions and intended use
tests/                             Authoritative rule and real Socket.IO tests
render.yaml                       Render Blueprint configuration
```

The two main replacement boundaries for the future authored map are `public/src/world.js` and `public/src/shipData.js`. Character/model integration is isolated in `public/src/characterFactory.js`. Server rules reference stable room and station IDs from `shipData.js`, so new geometry should retain or deliberately migrate those IDs.

## Supplied assets

All 172 supplied non-logo PNG files are copied under `public/assets/art/` without destructive conversion. Logo files are deliberately excluded at the owner's request. The full per-file inventory is in [`docs/asset-inventory.json`](docs/asset-inventory.json), with a readable summary in [`docs/asset-inventory.md`](docs/asset-inventory.md).

Important runtime mappings:

| Asset | Current use |
| --- | --- |
| `Background/Stars-sharedassets0.assets-56.png` | Loading/menu background and 3D sky texture |
| `Background/Paralax1-sharedassets0.assets-115.png` | Essential anomaly/environment layer in the asset loader |
| `Tasks/grid-sharedassets0.assets-156.png` | Task-console holographic surface |
| Ten task images including `Radio`, `Calibrator`, `SetCourse`, `ProcessData`, `SortGame`, `MonitorOxy`, `BoardingPass`, `engineAlign_base`, `MedScan`, and `Wifi` | Reference art for the ten playable assignments |
| `Voting`, `DISCUSS!`, `SHHHHH!`, `Maps`, `Players`, `Gui`, `Accessories & Pets`, and remaining images | Catalogued, lazy-rendered in the Asset Archive, and ready for authored integration |

No audio or browser-ready 3D model files were present in the supplied asset folder; it contains PNG artwork. WebAudio cues and procedural geometry therefore keep the game playable until authored audio, map, and model code is provided.

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

The automated suite verifies the authoritative elimination → incident → vote → victory path directly and verifies four real Socket.IO clients joining, receiving private role/task state, starting a match, moving through server snapshots, and being denied a Crew elimination request.

The project has also been browser-playtested through loading, guest authentication, menu, four-player practice lobby, role reveal, active gameplay, HUD, and minimap. Database migration was not executed in this checkout because no Neon `DATABASE_URL` was supplied; the migration command correctly refuses to run without it.

## Known limitations and next integration points

- The Meridian geometry, collision volumes, room layout, and astronaut mesh are explicit placeholders pending the owner's authored map/asset-use code.
- Supplied transition, map, cosmetics, and animation-frame art is preserved and browsable but not all of it is yet mapped to final gameplay presentation.
- Audio is synthesized because no supplied audio files were found.
- The controls are desktop-first; responsive menus work at narrow widths, but touch gameplay controls are not implemented.
- Practice bots exercise navigation, tasks, sabotage, elimination, and voting heuristics; they are training opponents, not production matchmaking AI.
- Render's free service may cold-start, and in-memory rooms do not survive a process restart. Durable match/account data remains in Neon.

Recommended next step: provide the authored map and asset-use code, then replace `world.js`, `shipData.js`, and `characterFactory.js` behind their current stable interfaces before adding final animation/audio packages and GLB optimisation.
