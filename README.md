# Orbit Ops Subdivision

Orbit Ops Subdivision is the primary game in this repository: a browser-based,
Three.js tactical multiplayer FPS with Deathmatch, Team Deathmatch, Gun Game,
server-authoritative combat, utilities, maps, player progression, skins, cases,
Trade Ups, friends, parties, and moderation tools.

The original 2D social-deduction Orbit Ops game remains in the root source tree
as a legacy project. It is not the main contributor target. New game work should
normally begin in [`games/subdivision`](games/subdivision).

## Open-source release checklist

Before making this repository public:

1. Review the working tree **and Git history** for credentials, private URLs,
   personal data, unpublished assets, and configuration files. Rotate anything
   that might have been exposed before publishing.
2. Confirm redistribution rights for every model, texture, map, sound, font,
   trademark, and third-party dependency. Review [`LICENSE`](LICENSE),
   [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), and `third_party/`.
   Remove or replace anything without clear permission to redistribute.
3. Add contributor governance before inviting outside work: a contribution guide,
   code of conduct, security-contact policy, issue templates, and protected
   branches requiring pull-request review.
4. Enable GitHub security features such as Dependabot, secret scanning, and
   code scanning. Keep production credentials and operational configuration out
   of GitHub entirely.
5. Run the relevant tests and a browser playtest before publishing. A static
   check is useful, but it is not proof that multiplayer state works.

To make the GitHub repository public, an administrator opens repository
**Settings**, scrolls to **Danger Zone**, chooses **Change repository
visibility**, selects **Make public**, and completes GitHub's confirmation.
Read GitHub's current [repository-visibility guide](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)
first, especially if the repository has forks or a long commit history.

## Start here

```bash
cd games/subdivision
npm install
npm start
```

Open `http://localhost:3000` for local guest play and browser rendering checks.
The public repository deliberately does not document access to production
services, operational accounts, or hosting configuration. Features that require
private services are maintained by project operators and should be tested only
in an approved environment.

## Self-host your own instance

You can run a separate Orbit Ops Subdivision server under your own domain and
with your own data. This does **not** grant access to the project's existing
game service, accounts, or stored player data.

1. Fork the repository, clone your fork, and install the Subdivision dependencies:

   ```bash
   git clone https://github.com/<your-account>/Orbit-Ops.git
   cd Orbit-Ops/games/subdivision
   npm ci --omit=dev
   ```

2. For a private persistent instance, provision your own PostgreSQL database and
   set private environment variables in your host's secret manager—not in Git:

   ```text
   NODE_ENV=production
   PORT=3000
   DATABASE_URL=<your-private-postgres-url>
   ADMIN_TOKEN=<your-long-random-admin-token>
   DEVICE_SECRET=<your-long-random-device-secret>
   ```

   The server initializes its schema when it starts. Use a new database for your
   own instance; never reuse or request access to another operator's database.

3. Start one server process:

   ```bash
   npm start
   ```

4. Put the process behind your own HTTPS reverse proxy or platform routing.
   Preserve WebSocket upgrades, route the public site and Socket.IO through the
   same origin, and keep only the proxy publicly exposed. Run a single game
   replica unless you add shared room-state coordination; match state currently
   lives in one server process.

5. Before inviting players, verify the health route, guest login, two-browser
   room joining, shooting, utility placement, disconnect/rejoin, and a complete
   round. Add optional mail delivery only after basic gameplay works, and keep
   its credentials in the host's secret manager.

Use your hosting provider's normal process supervision, TLS, backups, logs, and
secret rotation. Do not publish your configuration file, deployment dashboard
links, database URL, or administrative tokens in an issue, pull request, or
fork.

## What lives where

| Path | Responsibility |
| --- | --- |
| `games/subdivision/index.html` | Three.js client, menus, HUD, input, first-person models, previews, and browser-side feedback |
| `games/subdivision/server.js` | Authoritative FPS rooms, combat validation, match state, scoring, utilities, socket handlers, and admin actions |
| `games/subdivision/core.js` | Shared weapon, utility, snapshot, and balance constants used by client and server |
| `games/subdivision/maps.js` | FPS map catalogue, spawns, and map access metadata |
| `games/subdivision/mapCollision.js` | Server-side grounding, collision, line-of-sight, and hit-validation geometry |
| `games/subdivision/assets/` | Shipped game models, textures, maps, audio, and skin artwork |
| `games/subdivision/skins.js` | Skin catalog, cases, rarity rules, and secure reward helpers |
| `games/subdivision/tradeups.js` | Pure Trade Up validation and outcome rules |
| `games/subdivision/scripts/` | Repeatable asset, skin, and map import/build tools |
| `games/subdivision/test/` | Focused regression tests for gameplay, authority, assets, and UI contracts |
| `games/subdivision/docs/` | Player-facing and contributor-facing feature notes |
| Root `server/`, `public/src/`, `database/` | Legacy 2D Orbit Ops project; avoid changing it unless the task explicitly concerns that game |

## Maintaining Subdivision

### Core rule: the server owns outcomes

The browser is responsible for input, rendering, sounds, HUD state, local
feedback, and requests. The server decides damage, ammunition, movement
validity, scoring, utility placement, currency, inventory ownership, case
results, Trade Ups, trades, and match outcomes.

Never make the client authoritative just because a change is easier there. For
any new player-visible action, trace the entire path:

```text
shared rule / balance → client request → server validation and state change
→ server broadcast → client rendering and feedback → regression test
```

### Weapons and combat

1. Put damage, fire rate, magazine, reserve ammunition, reload timing, and
   shared balance values in `core.js`.
2. Update `index.html` only for client presentation: viewmodel position,
   animation, recoil, muzzle position, spread display, audio, and HUD details.
3. Ensure `server.js` reads the shared definition when validating shots and
   applying damage. Do not accept client-reported damage, hit results, or
   ammunition as truth.
4. Add or update `test/<weapon>.test.js`. Test the actual player outcome—for
   example, a three-headshot kill should prove that two headshots leave a
   full-health target alive and the third kills.
5. Playtest firing, reload, switching, respawn reset, a remote player view, and
   the intended game modes.

### Utilities and deployables

1. Define geometry, health, spacing, range, and limits in `core.js`.
2. Validate placement, ownership, cooldowns, damage, destruction, and cleanup
   in `server.js`.
3. In `index.html`, show a placement preview but render the real entity only
   after server approval.
4. For GLB-backed deployables, test model loading, orientation, collision proxy,
   full/partial/destroyed health states, cleanup, and multiple placement yaws.

The barricade is the reference pattern: its collider remains an authoritative
server concern, while the imported visual and connected health bar are client
rendering adapters.

### Maps, collision, and visual assets

- Keep map identity, legal spawn locations, and access restrictions in
  `maps.js`.
- Keep server ground, collision, line-of-sight, and hit validation in
  `mapCollision.js`. Never weaken collision to hide a visual problem.
- Use GLB/glTF for shipped 3D assets. Preserve asset provenance and license
  information whenever importing third-party material.
- For skinned animated Three.js GLBs, use `THREE.SkeletonUtils.clone`; a regular
  clone can share a skeleton and break remote-player animation.
- Capture browser screenshots for model orientation, material, HUD obstruction,
  and map placement changes. Syntax checks alone cannot catch visual regressions.

### Skins, cases, marketplace, and Trade Ups

- Treat every client item ID, price, rarity, pattern index, wear value, trade
  payload, and case selection as a request—not proof of ownership or value.
- Keep ownership and currency changes in server-side transactional paths.
- `skins_imported.js` is generated. Update its source metadata or asset pipeline
  rather than hand-editing generated item entries.
- Preserve a skin instance's pattern and wear through loadout, listing, sale,
  trade, and inventory reload paths.
- Test idempotency and failure paths whenever changing an economy action; a
  successful UI animation does not prove a safe transfer.

### Accounts, moderation, and persistent systems

Authentication, permissions, rate limits, mail delivery, bans, moderation,
inventory, and persistent progression are server-side responsibilities. Keep
credentials private, validate permissions again on the server, and never expose
private operational setup in issues, pull requests, screenshots, or docs.

Schema changes must use a new ordered migration. Do not edit a migration that
may already have run in another environment. Test permission changes as both an
ordinary player and an authenticated administrator.

## Tests and playtesting

Run the smallest relevant test first, followed by syntax and client parsing:

```bash
cd games/subdivision
node --test test/<relevant-test>.test.js
node --check server.js
node --test test/client-script-parses.test.js
```

Before handing off a gameplay change, run a browser check. For a multiplayer or
persistent-state change, use a two-client or approved server-backed check where
possible. Report validation honestly: a local render fixture, a guest browser
session, and a real multi-player match prove different things.

## Contribution workflow

1. Start from current `main` and make one focused change at a time.
2. Read the relevant implementation and existing test before editing.
3. Keep shared rules, server authority, client rendering, remote-player state,
   reconnect/reset paths, and tests aligned.
4. Add or update focused regression coverage, then run it and playtest in a
   browser when the change affects gameplay or visuals.
5. Commit with a clear title and body explaining the player-visible effect,
   authority/security implications, and exactly what was tested. Do not commit
   secrets or operational access information.
6. Use pull requests and review for public contributions. State any untested
   boundary clearly rather than implying a full production test occurred.

## Legacy Orbit Ops

The root 2D social-deduction game is retained as historical/legacy source. It
has its own architecture and should not be used as the default reference for
Subdivision work. If a contribution does target it, scope the change explicitly
and maintain its server-authoritative design independently.
