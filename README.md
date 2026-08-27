# Orbit Ops

Orbit Ops is a playable, server-authoritative 2D social-deduction game. One Node.js service hosts the Phaser client, Socket.IO simulation, Express health route, and optional Neon PostgreSQL persistence.

The current release has one selectable match map: **The Skeld**. Its shared definition drives server movement, collision, room routes, spawns, tasks, sabotages, bot paths, the rendered deck, and the player-map overlay. The walkable dropship is a separate pre-match map and never appears in the match-map selector.

## Current feature set

- Guest, registration, login, hashed passwords, opaque HMAC-hashed sessions, logout, profile, and saved settings
- Account recovery without a mail provider: registration issues a four-group recovery code, shown once and readable again from the profile panel. Email, callsign and code together reset a password, which also revokes every existing session and issues a fresh code. Registration refuses known throwaway mailbox domains.
- Moderation that can actually be applied: bans and mutes are issued and lifted from an in-game panel visible only to moderator, admin and owner accounts, and from a break-glass `POST /admin/:action` route guarded by `ORBIT_ADMIN_TOKEN`. The route 404s entirely when that secret is unset. A ban takes effect immediately - the account's sockets are dropped rather than left playing until next sign-in.
- Crewmates and parties: link up by callsign or from the people you have just played with, then invite them into a party. Public matchmaking seats the whole party in one lobby rather than splitting it, by looking for a room with enough free seats for the group instead of for one more player.
- Leaderboards over the statistics already being recorded - score, victories, assignments, eliminations and longest survival - and owner-posted bulletins pushed live to everyone connected.
- A walkable dropship lobby built from the supplied Lobby artwork: players move, gather, and chat in-world before launch, with the host's parameters, room code, crew manifest, and a boarding-console launch point layered over the live scene
- Public matchmaking with all-ready auto-launch, private room codes, practice simulations with bots, host settings, ready state, and host reassignment
- 45-second reconnect reservation with rotated rejoin tokens
- 20 Hz authoritative movement simulation and 20 Hz world snapshots
- A declarative role framework: each role states its faction, ability (targeting, cooldown, uses), win condition, hooks and extra state, rather than being branched on by id. Abilities run server-side against a narrow API so a role cannot reach past the rules it is allowed to touch. Sixty-three roles ship: 31 crew, 15 operative and 17 neutral, matching the Town Of Us R roster. Roles may also declare lifecycle hooks, so a role can react to a death, a vote or a meeting without the server knowing it exists.
- The bake is rendered unlit, so the deck keeps the artwork's own palette. Among Us surfaces are painted with their shading already in them; lighting them again only washes the colour toward grey.
- Collision is derived from that same 3D model rather than hand-authored: the model is rendered straight down with each surface coloured by world height, and the threshold sits just above the floor plane, so anything standing on the floor - tables, consoles, crates, beds - is solid automatically and correctly placed. The map carries no authored collision rectangles at all.
- All 18 Skeld assignments use their configured task-panel art across 28 physical consoles; the meeting button, cameras, admin table, vents, and sabotage repair points have their own station mappings. Markers sit on a dark backing disc where the detailed deck needs extra contrast.
- The deck is the only source of Skeld map art. Procedural room floors, walls, corridor fills and the superseded per-room crops are all gone: nothing is drawn over the bake, and nothing unused is downloaded.
- The deck is a bake of the supplied 3D Skeld model, rendered through an orthographic camera tilted 24 degrees so the floor still reads top-down while each room's far wall stays visible. The model's ground plane is pinned to world coordinates by `render.deck`, so `worldToScreen`, movement and collision are all unchanged - the art is fitted to the game, never the other way round.
- An Admin table showing live per-room head counts (never names, and dark during a lights sabotage) and a security monitor showing a live camera feed rather than delayed telemetry. Vented players appear on neither.
- The vent network follows the real Skeld: two three-vent loops (Cafeteria/Admin/Hallway and Electrical/Security/MedBay) and four two-vent loops (Reactor/Upper Engine, Reactor/Lower Engine, Weapons/Navigation, Navigation/Shields). Navigation and Reactor each hold two vents that deliberately do not link to each other, which is what stops an operative crossing the deck in a single hop.
- While riding a vent, arrows appear around you in the world, one per exit, pointing along the key that reaches it and naming where it leads.
- Vents are a connected network rather than fixed pairs: an operative climbs in, travels between any vents sharing that network with WASD, and climbs out with E. The server gives every exit on a loop its own W/A/S/D key and sends it with the exit, so the keys are always unambiguous even where two exits lie in the same compass direction. While inside they are frozen, hidden from every other client's snapshot, and cannot kill, be killed, report, or run assignments. Meetings empty the vents, and the client always mirrors the server's vent state rather than tracking its own guess - E climbs out and only out, never back in.
- Sensory states are server truths the client only renders: being flashed, hypnotised or eclipsed collapses sight to almost nothing, cuffs block acting entirely, and the HUD says which is happening rather than leaving the player guessing.
- Limited sight: the deck is dark beyond a radius around you, enforced server-side so culled players and bodies are never sent to the client at all. Operatives see further than crew, and a lights sabotage collapses the crew's radius while barely touching the operative's. Ghosts and meetings reveal everything.
- Server-private role assignment with Engineer, Medic, Sheriff, Tracker, Morphling, Swooper, Janitor, Jester, Survivor, and base Crew/Operative roles
- Ghosts: eliminated players keep drifting through walls at a small speed bonus, finish their assignments, and chat on the dead-only channel, while the living never receive ghost positions; the first fallen crew member returns as the Guardian Angel with a protect shield
- Eighteen server-sequenced Skeld assignments across 28 consoles, including ordered multi-room wiring, data, garbage, fuel, power, and engine routes
- Five Skeld sabotage systems: reactor, O2, communications, lights, and timed room-door lockdowns; practice mode removes action cooldowns for testing and paces bot sabotage so the opening minute stays playable
- Server-validated role abilities, elimination, incident evidence, emergency-button calls, reporting, meetings, discussion, voting, removal, and faction/neutral win conditions
- Living/dead chat separation, input validation, payload limits, action rate limits, and no direct client database access
- Security telemetry, delayed door logs, Operative maintenance routes, spectator state, match results, and persistent statistics
- Responsive low-chrome HUD, minimap, settings, accessibility options, synthesized fallback audio, and a lazy-loaded supplied-art archive

## Run locally

Requirements: Node.js 20 or newer and pnpm.

```bash
pnpm install --frozen-lockfile
pnpm start
```

Open `http://localhost:3000`. Guest multiplayer and practice mode work without PostgreSQL. Account registration and persistence become available when `DATABASE_URL` is configured.

For development with automatic server restart:

```bash
pnpm run dev
```

## Controls

| Input | Action |
| --- | --- |
| `W A S D` or arrow keys | Move |
| `Shift` | Sprint |
| `C` or `Ctrl` | Stealth-walk |
| `E` | Use a nearby station, repair, console, reportable incident, or the lobby boarding console; enter a vent, and always climb back out (never re-enters) |
| `W A S D` (while vented) | Hop to the exit marked with that key. Arrows appear around you in-world showing each exit's key and destination |
| `Alt` | Cycle through vent exits in order, as an alternative to the direction keys |
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
database/migrations/              Numbered, checksummed PostgreSQL migrations
database/repositories/            Parameterized account and match queries
public/index.html                 Application surfaces and HUD
public/style.css                  Responsive visual system
public/src/game.js                Client orchestration and Phaser bridge
public/src/mapSchema.js           Reusable map validation and corridor generation
public/src/shipData.js            Skeld/lobby registry and indexed geometry lookup
public/src/maps/                  Skeld, dropship, map factory, and walk-grid data
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

The Skeld follows a data/build split without importing compiled Unity code or third-party map art.
`public/src/maps/theSkeld.js` owns its room transforms, adjacency, traced corridor routes, station
anchors, spawn points, tasks, sabotages, camera bounds, render layers, and model-derived walk grid.
`public/src/maps/mapFactory.js` validates and freezes that data, and builds a private station index
for constant-time authoritative lookups. `public/src/game2d/MapBuilder.js` turns the definition into
disposable Phaser containers while the server reads the same geometry for movement, interactions,
and bot navigation. The dropship uses the same schema through `lobbyDropship.js`.

This layered/object-group organization adapts the useful public-domain map-loading pattern in the
project-owner-supplied Python fan conversion: visible map layers are built in order, while named
object groups carry collision, spawn, and interaction data. The conversion's bundled original-game
TMX map and ripped assets are deliberately excluded.

The Skeld uses its two central hubs and east/west ship wings. The clickable HUD map and `Tab`
overlay render that same authoritative definition, with private assignment, sabotage, and
local-player markers layered on top. MIRA HQ, Polus, and Airship are not playable definitions in
this release; related supplied sheets remain archived for possible future authored maps.

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
| `public/assets/maps/skeld-deck.png` | Live baked Skeld deck, aligned to the authoritative world and walk grid |
| `Maps/Lobby/Lobby-sharedassets0.assets-54.png` | Split losslessly into `public/assets/lobby/` and rendered as the pre-match dropship lobby |
| `Maps/*`, `HQAssets*`, `PlanetSprites*`, and other packed sheets | Retained in the archive for future extraction; not preloaded as playable room art |
| `player-models/base/idle`, `walk`, and `death` frames | Live 58×76 player model, movement animation, and elimination animation |
| `Tasks/Consolas_0`, `Emergency`, `DoorLog`, `panel_doors_bg`, and reactor panel art | Live world station markers |
| `Tasks/grid-sharedassets0.assets-156.png` | Task-console holographic surface |
| Configured task-panel art | Live station art for all 18 Skeld assignments |
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
pnpm run assets:inventory
```

The generator rejects any file placed in a `Logos` category.

## Neon PostgreSQL

The schema includes accounts, sessions, settings, aggregate player statistics, matches, match players, cosmetics, bans, and mutes. Passwords use bcrypt with cost 12. Session and rejoin tokens are random, stored only as HMAC-SHA-256 hashes, and never sent to other clients. Database work uses parameterized queries and transactions.

1. Create a Neon project and copy its pooled PostgreSQL connection string.
2. Use `.env.example` as a template, load those variables through your shell or service, and set `DATABASE_URL`.
3. Set a unique `SESSION_SECRET` of at least 32 random characters. Changing it invalidates existing sessions and room rejoin tokens.
4. Register the owner account, look up its immutable UUID (`SELECT id, email, display_name FROM accounts WHERE lower(email) = lower('owner@example.com');`), and set it as `ORBIT_OWNER_ACCOUNT_ID`. Production deliberately rejects email-only owner bootstrap because an unregistered address could otherwise be claimed by another user. `ORBIT_OWNER_EMAIL` remains a development-only convenience. A missing or mistyped UUID leaves the current owner unchanged; once the target exists, stale owner assignments are retired. Staff roles (`moderator`, `admin`, and `owner`) can start a below-minimum private lobby for supervised testing, but do not gain host control over another player's room.
5. Keep `DATABASE_SSL_MODE=verify-full` for Neon. `DATABASE_SSL_CA` may contain a provider CA bundle when the platform trust store does not contain it; escaped `\\n` line breaks are accepted.
6. Apply and optionally seed the database:

```bash
DATABASE_URL='postgresql://...' SESSION_SECRET='your-long-random-secret' pnpm run db:migrate
DATABASE_URL='postgresql://...' SESSION_SECRET='your-long-random-secret' pnpm run db:seed
```

Numbered files under `database/migrations/` are applied once and tracked in `schema_migrations`.
Applied migrations must stay immutable; schema changes belong in the next numbered file. The
application never exposes the connection string to the browser.

## Render deployment

The included `render.yaml` creates one Web Service containing both games. Subdivision is versioned directly under `games/subdivision`, so a deploy no longer clones a second private repository or requires a GitHub token. The build installs both sets of production dependencies. Orbit Ops starts Subdivision on an internal-only port and exposes it through the signed `/tips/` gateway.

The games share source control and a deployment, but not account storage. The Orbit Ops process receives `DATABASE_URL`; the child Subdivision process receives `SUBDIVISION_DATABASE_URL` as its private `DATABASE_URL`. Never point those variables at the same database.

1. Review the changes, then push this repository to GitHub when ready.
2. Create a Render Web Service or apply the repository Blueprint.
3. Use build command `pnpm install --frozen-lockfile && pnpm run subdivision:install && pnpm run db:migrate` and start command `pnpm start`.
4. Add the Neon connection string as `DATABASE_URL`.
5. Add a strong `SESSION_SECRET`; the Blueprint can generate one.
6. Set `DATABASE_SSL_MODE=verify-full`, `TRUST_PROXY_HOPS=1`, and `NODE_ENV=production`.
7. The build applies pending numbered migrations before the new service starts. Run `pnpm run db:seed` separately if starter cosmetics are wanted.
8. Add the three required private Subdivision variables listed below. They point to its existing database and are deliberately separate from Orbit Ops account data.
9. Set the health-check path to `/health` and deploy.
10. Open the public Render URL, then confirm the client loads, Socket.IO connects on the same origin, and `/health` reports `"databaseConnected": true` and `"jimsGameRunning": true`.
11. Test guest mode, registration/login, two-browser room joining, and one complete match in each game. In the embedded game, room code `ORBIT OPS` returns to the Orbit Ops menu.

Required production variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon PostgreSQL pooled connection string |
| `SESSION_SECRET` | HMAC secret, minimum 32 characters in production |
| `DATABASE_SSL_MODE=verify-full` | Requires TLS and verifies the database certificate in production |
| `ORBIT_OWNER_ACCOUNT_ID` | Immutable UUID of the single account provisioned as owner; required instead of email in production |
| `TRUST_PROXY_HOPS=1` | Trusts Render's one proxy hop for client-IP rate limits |
| `NODE_ENV=production` | Production caching and secret validation |
| `SUBDIVISION_DATABASE_URL` | Subdivision PostgreSQL URL; never expose it to the client or reuse Orbit's database |
| `SUBDIVISION_ADMIN_TOKEN` | A strong admin token used only by Subdivision |
| `SUBDIVISION_DEVICE_SECRET` | A strong device/session secret used only by Subdivision |

Optional Subdivision mail variables are `SUBDIVISION_MAIL_PROVIDER`, `SUBDIVISION_BREVO_API_KEY`, `SUBDIVISION_BREVO_FROM`, and `SUBDIVISION_EMAIL_REPLY_TO`. Existing Subdivision accounts continue to work when `SUBDIVISION_DATABASE_URL` points to the same database as the former standalone deployment. Rotate any connection string that has ever been pasted into chat or committed, then enter only the replacement in Render's secret environment-variable UI.

Legacy `JIMS_*` variables are still accepted so an existing deployment can move without downtime. New deployments should use `SUBDIVISION_*`. No GitHub token is needed because all game source is now in this repository.

Render supplies `PORT`; the server binds `0.0.0.0` and defaults to port 3000 locally.

### Free split hosting with Cloudflare Pages

To move static game bandwidth off Render without buying a domain, build the
browser-only bundle with `PUBLIC_BACKEND_URL=https://<service>.onrender.com pnpm
run build:cloudflare` and publish `dist-pages` through Cloudflare Pages. Add the
assigned production and project-scoped preview `pages.dev` origins to Render's
`PUBLIC_CLIENT_ORIGINS`. The exact dashboard fields, security boundary, and
verification checklist are in
[`docs/cloudflare-pages-render.md`](docs/cloudflare-pages-render.md).

## Verification

```bash
pnpm run check
pnpm test
```

`tests/smoke.test.js` additionally drives one full practice run over a real Socket.IO
connection: guest entry, practice lobby, a parameter edit, authoritative movement, the
assignment panel, one task played to completion, an emergency meeting with its discussion
and voting timers, confirmation that simulation time advances while the system menu is
open, and the return to lobby. A second pass covers an Operative sabotage being resolved
by crew bots and a server-validated role ability.

The automated suite validates every Skeld and lobby room, routed corridor, spawn, collision, task,
sabotage repair point, emergency button, and live-art allowlist. It also
verifies the authoritative elimination → incident → vote → victory path and four real Socket.IO
clients joining, receiving private role/task state, starting a match, moving through
server snapshots, and being denied a Crew elimination request.

The checked-in visual artefacts cover the Skeld lobby, gameplay view, and map overlay. Database
migration requires a configured Neon `DATABASE_URL` and is intentionally separate from the
database-free game and client tests.

## Known limitations and next integration points

- The Skeld is the only selectable match map. Future maps should be added as isolated definitions rather than combined into its deck.
- The supplied asset pack contains several packed atlases whose filenames resemble rooms but whose pixels also contain props, effects, or task-animation frames. The baked Skeld deck is the only match-map image rendered; packed sheets stay available in the archive.
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
