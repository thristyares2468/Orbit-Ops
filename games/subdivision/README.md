# Orbit Ops Subdivision

> Last updated: 27 August 2026

Orbit Ops Subdivision is a browser-based tactical multiplayer game. It
combines public and private rooms, authoritative combat, account progression,
custom cases, persistent skin instances, a player marketplace, Trade Ups,
friends and parties, challenges, moderation tools, and a Three.js client.

## Current Features

- Deathmatch, Team Deathmatch, and Gun Game on Dust2 and Backrooms maps, plus
  admin-room-only Nuke, Inferno, Vertigo, and Mirage test maps.
- Public rooms, private room codes, reconnect/rejoin support, parties, friends,
  recent players, friend inventory viewing, and account-level leaderboards.
- Match exits use an acknowledged leave transaction, so an immediate create or
  join waits for the old room to release without trapping the account between lobbies.
- Server-owned damage, fire rate, movement validation, score, utility, health,
  inventory ownership, case rewards, Trade Ups, listings, trades, and currency.
- Ten seconds of spawn immunity while stationary. Real movement starts one
  three-second countdown; shooting or throwing utility removes it immediately.
  Protected players visibly brighten and pulse faster as protection expires.
- Killstreak bounties from the fourth consecutive kill. Bountied kills earn a
  score bonus and use the Domination marker; claiming a bounty earns a larger
  bonus and uses the Revenge marker.
- Verified-email registration, login recovery, password and email management,
  sessions, guest testing, device identity, flood protection, and account bans.
- XP, levels, Mowbucks, twice-daily challenges, weekly challenges, challenge
  editing, collection discovery rewards, and one visible case for a completed
  weekly hard challenge. Flash-assisted and through-smoke eliminations count as
  utility kills from server-observed flash and smoke state.
- Persistent skins with rarity instances, pattern indices from 1 through 1000,
  seeded wear, wear classes, collection metadata, loadouts, cases, and previews.
- Player listings, hidden-case resale, balances, listing cancellation, sale and
  ownership history, per-wear price charts, economy totals, and featured deals.
- Atomic, server-authoritative Trade Ups with idempotency and collection-aware
  output selection.
- Rich admin tools for users, bans, inventory wipes, XP resets, cases, daily and
  weekly challenge templates, news, room testing, and moderation records.

## Local Development

Install dependencies and start the service:

```bash
npm install
npm start
```

The default address is `http://localhost:3000`. Without `DATABASE_URL`, the
server can run guest/local rendering checks, but accounts, progression, economy,
moderation records, and other persistent features are unavailable.

For a persistent local environment:

```bash
createdb jimfps
export DATABASE_URL="postgres://<user>@localhost:5432/jimfps"
export ADMIN_TOKEN="choose-a-strong-token"
export DEVICE_SECRET="choose-a-random-secret"
npm start
```

The admin panel is available at `http://localhost:3000/admin` and requires the
configured `ADMIN_TOKEN`.

## Environment

Production requires:

- `DATABASE_URL`: Postgres connection string.
- `ADMIN_TOKEN`: shared secret for the HTTP moderation panel.
- `DEVICE_SECRET`: HMAC secret for persistent device identity.
- `NODE_ENV=production`: enables required-variable checks and production rules.

Common optional variables:

- `PORT`: HTTP/WebSocket port; defaults to `3000`.
- `PUBLIC_BASE_PATH`: optional same-origin mount prefix such as `/tips`.
  When set, HTML asset URLs, the WebSocket endpoint, and legal links are
  rewritten beneath that prefix. The generated client config also exposes the
  host application's return URL and disables the standalone service worker.
- `CANOPY_CLIENT_API_KEY`: when set, WebSocket upgrades must present the
  matching credential generated into Canopy's bundled client. Keep this value
  in Railway variables and Canopy's git-ignored local credential file; never
  commit it. Player login and session checks still apply after this gate. A
  shared credential can be recovered from a distributed app, so rotate it when
  access changes and do not reuse a Railway management or database credential.
- `DATABASE_SSL`: set the Postgres SSL mode where required by the provider.
- `CHAT_LOG_RETENTION_DAYS`: chat retention window; defaults to `90`.
- `AC_ENABLE_LOS=1`: enables server line-of-sight validation.
- `MAIL_PROVIDER=brevo`: selects the recommended Railway transactional provider.
- `BREVO_API_KEY`: server-only Brevo API key.
- `BREVO_FROM`: verified sender, including an optional display name, for example
  `Orbit Ops Subdivision <accounts@example.com>`.
- `MAIL_PROVIDER=resend`: selects Resend when an owned sender domain is available.
- `RESEND_API_KEY`: server-only Resend sending key.
- `RESEND_FROM`: verified sender, including an optional display name, for example
  `Orbit Ops Subdivision <accounts@mail.example.com>`.
- `EMAIL_REPLY_TO`: optional reply address for account messages.

When launched from the combined Orbit Ops service, entering `ORBIT OPS` in the
private-room code field returns to the shared game selector. The child runtime
receives its own PostgreSQL URL from the parent, so existing Subdivision accounts
remain separate from Orbit Ops accounts.

Brevo's HTTPS transactional API is the primary Railway transport, so account mail
works on plans that block outbound SMTP. The server sends branded HTML and
plain-text registration and email-change codes. Password resets instead use the
per-account recovery code shown in Account Settings, so they do not require mail
delivery.
Resend remains supported for deployments with an owned, DNS-verified sender
domain and adds a stable per-code idempotency key. Production rejects the account
action when delivery is not configured instead of reporting a fake success.

The existing SMTP transport remains available as a fallback. Set
`MAIL_PROVIDER=smtp` with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and
`SMTP_FROM`; use `SMTP_SECURE=true` for implicit TLS or `SMTP_STARTTLS=false` only
when required by that service. In local development with no provider, messages
are logged to the server console.

## Accounts And Moderation

New accounts must confirm the code sent to their email before registration is
completed. Password recovery is available from login, and account settings can
change a password, request a reset email, or verify a new email address.

In-game authority is stored in `accounts.role` in Postgres. Valid roles are
`user`, `admin`, and `owner`; owners inherit admin access, and a partial unique
index allows only one owner. New accounts always default to `user`. Role changes
take effect on the account's next login or session resume.

The legal page contains Privacy, Terms, and Rules sections. It documents browser
asset caching, friend inventory visibility, inventory wipes, XP/stat resets,
account restrictions/deletion/bans, school/work use responsibility, and
prohibitions on cheating, bots, macros, autoclickers, scripts, AFK automation,
and ban evasion. Access is restricted to users aged 18 or older, and the Terms
identify the game as an independent Counter-Strike-inspired parody whose jokes
and fictional presentation are not meant seriously. A versioned Terms gate
requires `I Agree` on first boot after a material policy revision. There is
intentionally no public Contact page.

Trades require both players to be at least level 5. Default account CT/T knives
and default weapon skins are not marketable. Vanilla earned knives remain normal
owned items.

## Progression And Challenges

Match XP rewards participation even without a win. Wins multiply the final match
XP by two. Level-up Mowbucks increase with level and cap at 200 per level. Weekly
progress, claims, and the selected weekly rotation are stored in Postgres, so a
process restart or deploy does not replace an active week's objectives.

Daily challenge windows use Australia/Brisbane time and rotate twice per day:
midnight to midday, then midday to midnight. Weekly challenges rotate on Monday.
The Escape menu shows daily and weekly saved progress plus the lighter increment
earned in the current match. Completed claims remain completed across refreshes
and concurrent claim responses.

## Skins, Cases, And Economy

Every non-default owned skin carries its own persistent rarity, wear value, wear
seed, and pattern seed. Wear labels are Factory New, Minimal Wear, Field Tested,
Well Worn, and Battle Scarred. Those values must survive equip, listing, sale,
trade, Trade Up, and reload paths.

Admins create cases in the case editor. It supports library search and filters,
sorting, pagination, existing-case visibility, full-screen skin inspection,
per-skin or direct per-rarity-class chances, unsaved Test Open drafts, and a
Show in Marketplace switch. Each case also stores a selectable authored case
design; the editor ships with twenty-five distinct designs including Operative
Gold, Garden Bloom, Diamond Vault, Tradie Esky, and themes matching the existing
Gardener, Lawn-Care, Mulch, Nuke, and Warehouse cases. It previews the choice before save. The case
preview collapses all knife outcomes into a
single non-inspectable `Rare Special Item` entry. Hidden cases cannot be bought
directly but owned hidden cases can be resold by players.

Case cards, editor previews, and case inspection use the authored JPEG artwork
directly. Case inspection intentionally uses a large static image so the design
shown to players remains faithful to its authored concept.

Trade Ups accept ten same-rarity Common, Rare, or Epic skins. Legendary contracts
accept five inputs for a Mythic knife. Listed, traded, default, Mythic, and invalid
collection items are rejected. Output selection, normalized float mapping, row
locking, deletion, award, and audit insertion happen in one database transaction.

## Rendering And Assets

- The main client, menus, renderer, previews, inventory, market, and case editor
  live in `index.html`; make narrow changes and always parse its inline script.
- Reflective materials use `assets/environments/dust2-reflection.png` in gameplay
  and preview scenes.
- Pattern artwork, overlay masks, wear masks, and authored UV wrapping are treated
  as separate layers. Wear masks never contribute their RGB color.
- Character and weapon GLBs retain authored animation clips. Directional movement
  chooses available run, walk, forward, back, left, right, or crouch-run clips.
- Every first-person inspectable weapon and utility cycles through a shuffled bag
  of three distinct inspect variants. Suitable knives include a toss, aerial spin,
  and catch as one of those variants.
- GoldSrc BSP imports for Nuke, Inferno, Vertigo, and Mirage preserve authored
  CT/T spawns, lighting colors, embedded textures, plane-correct face winding,
  and full server collision. External textures are resolved from explicitly
  supplied official WAD3 archives, Valve `materials.txt` tags drive surface
  footsteps, and stacked-map spawn probes select upward walkable floors near the
  authored elevation. These imported maps render at a 22-unit scale, apply a
  restrained brightness lift, and use map-specific blue sky colors.
- Nuke's four authored double sliding doors use their real imported brush faces.
  The configurable Interact key defaults to `E`; door state, collision, LOS, and
  round resets are synchronized by the server, with a one-time proximity hint.
- Three.js cache sharing, service-worker asset caching, request deduplication, and
  conditional remote-player work reduce repeat loading and crowded-lobby cost.
- `skins_imported.js` is generated. Update source metadata/assets and regenerate it
  instead of editing generated item rows.

## Architecture

- `server.js`: HTTP/WebSocket routing, rooms, authoritative gameplay, progression,
  challenge orchestration, social/economy handlers, and persistence coordination.
- `index.html`: Three.js game client and all interactive game/admin UI surfaces.
- `db.js`: Postgres schema, migrations, accounts, stats, inventory, cases,
  marketplace, trades, Trade Ups, challenges, moderation, and logs.
- `skins.js`: curated catalog, case rules, rarity helpers, and secure rolls.
- `tradeups.js`: pure Trade Up validation and outcome rules.
- `core.js`: shared weapon, snapshot, and gameplay constants.
- `maps.js`: shared admin-map catalog and authored CT/T spawn sets.
- `mapCollision.js`: server-side ground, map geometry, and line-of-sight helpers.
- `auth.js`, `mailer.js`, `fingerprint.js`, `antiflood.js`, `bans.js`, `admin.js`:
  account, mail, device, flood, ban, and moderation subsystems.
- `sw.js`: same-origin asset caching for repeat visits.
- `scripts/build-skin-glbs.js`: generated skin GLB build pipeline.
- `scripts/import-goldsrc-map.js`: deterministic GoldSrc BSP-to-GLB map importer
  with repeatable `--wad` and `--materials` inputs.
- `scripts/export-map-texture-catalog.js`: exports every texture embedded in the
  shipped imported-map GLBs with map, material name, source, and footstep type.
- `test/*.test.js`: static and behavioral regression contracts.
- `handoff.md`: detailed implementation history, guardrails, and QA fixtures.

## Railway Deployment

Railway builds the included `Dockerfile`. Attach Postgres, configure the required
environment variables, and use `/health` as the health check.

To enable real account email on Railway:

1. In Brevo, add and verify the email address used for account messages.
2. Create a dedicated Brevo API key. Keep it only in Railway, never in the client,
   repository, screenshots, or support messages.
3. In the Railway game service's Variables tab set `MAIL_PROVIDER=brevo`,
   `BREVO_API_KEY`, `BREVO_FROM`, and optionally `EMAIL_REPLY_TO`.
4. Redeploy and confirm the startup log says `[mail] brevo ready:` followed by
   the configured sender. Then exercise registration verification and email
   change with an inbox you control.

The application never stores provider keys in Postgres and never exposes them to
the browser. Resend can be selected later with `MAIL_PROVIDER=resend`,
`RESEND_API_KEY`, and a `RESEND_FROM` domain authorized in Resend. SMTP remains a
portable fallback, but Railway tiers that block outbound SMTP must use an HTTPS
provider such as Brevo or Resend.

Keep exactly one game-service replica. Rooms, player state, and reconnect state
are process-local, so multiple replicas split WebSocket players across unrelated
servers. Scale the single instance vertically. For Australian players, place the
game service near Australia; gameplay packets do not wait for normal asynchronous
stats flushes.

## Combined deployment

Subdivision is deployed from the parent repository's root `render.yaml`; this
directory intentionally has no independent Blueprint. The parent installs these
dependencies, launches this server on an internal port, and passes
`SUBDIVISION_DATABASE_URL` into this process as `DATABASE_URL`. Cross-server
lobby routing is disabled because both games now live behind one gateway.

Use the parent repository's `.env.example` and deployment instructions. Keep one
combined service replica because live rooms, player state, and reconnect state
are process-local.

## Verification

Run the complete maintained-code verification set before deployment:

```bash
for file in $(git ls-files '*.js'); do node --check "$file" || exit 1; done
node -e "const fs=require('fs'),vm=require('vm');const h=fs.readFileSync('index.html','utf8');const s=h.match(/<script>([\\s\\S]*?)<\\/script>/);if(!s)throw new Error('inline script missing');new vm.Script(s[1]);"
for file in test/*.test.js; do node "$file" || exit 1; done
git diff --check
```

Rendered QA should cover a desktop and mobile viewport, two-player WebSocket room
behavior, the legal page, reward inspection, utility orientation, and representative
default, artwork, overlay, pattern, and worn skins. Imported maps should also be
rendered from several angles and checked against their authored spawn/collision set.

## Repository Maintenance

Maintained source, scripts, tests, and documentation carry a `Last updated` marker.
Machine-readable JSON, lockfiles, generated catalogs, and binary media are excluded:
adding comments would invalidate JSON, while rewriting generated or binary files
would create deployment churn without changing behavior. Their generators, source
assets, manifests, and this document are the maintenance record instead.

Completed releases are mirrored to `main` and `Development`. Commit messages belong
to commits rather than individual files; this repository does not rewrite published
history merely to alter old messages.
