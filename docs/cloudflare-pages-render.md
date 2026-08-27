# Free Cloudflare Pages + Render deployment

This deployment keeps the large, immutable game client on Cloudflare Pages and
uses the existing free Render service only for HTTP health/auth support,
Socket.IO, the Subdivision WebSocket gateway, and database access. No custom
domain is required.

## Addresses

- Public game: `https://<pages-project>.pages.dev`
- Multiplayer backend: `https://<render-service>.onrender.com`
- Orbit Ops and Subdivision database URLs remain private Render variables.

## 1. Render

Use the repository's `render.yaml`, or verify the existing service has:

```text
Build:  pnpm install --frozen-lockfile && pnpm run subdivision:install && pnpm run db:migrate
Start:  pnpm start
Health: /health
Plan:   Free
Region: Singapore
```

Keep the existing database and secret variables. Add `PUBLIC_CLIENT_ORIGINS`
after choosing the Pages project name:

```text
PUBLIC_CLIENT_ORIGINS=https://orbit-ops.pages.dev,https://*.orbit-ops.pages.dev
```

Replace `orbit-ops` with the exact Pages project name. The first entry is the
production site. The project-scoped wildcard permits Cloudflare's preview URLs
without allowing unrelated `pages.dev` sites. Existing Blueprint services do
not automatically prompt for newly added `sync: false` variables, so add this
one manually in **Render > Service > Environment**.

Deploy Render and confirm:

```text
https://<render-service>.onrender.com/health
```

## 2. Cloudflare Pages

In **Cloudflare > Workers & Pages > Create application > Pages > Connect to
Git**, select this repository and configure:

```text
Production branch: main
Framework preset:  None
Root directory:    /
Build command:     pnpm install --frozen-lockfile && pnpm run build:cloudflare
Output directory:  dist-pages
```

Add one non-secret build variable:

```text
PUBLIC_BACKEND_URL=https://<render-service>.onrender.com
```

Do not add either database URL, session secret, owner ID, admin token, device
secret, or mail credential to Cloudflare. A Pages build is public.

The build produces only:

- the Orbit Ops browser client and assets at `/`;
- the Subdivision browser client and assets at `/tips/`;
- local Phaser and Socket.IO browser bundles;
- generated public endpoint configuration;
- `_headers` security/cache rules and two static redirects. Asset responses use
  a one-day browser cache plus revalidation, and the Subdivision service-worker
  cache is versioned from Cloudflare's commit SHA so a new deployment cannot
  strand players on old models or scripts.

It does not copy either Node server, database code, migrations, environment
files, or moderation credentials.

## 3. Verification

Open the assigned `pages.dev` address and use browser developer tools:

1. Images, audio, GLBs, JavaScript, and Phaser load from `pages.dev`.
2. `/health` loads from the configured `onrender.com` origin.
3. Orbit Ops opens `wss://<render-service>.onrender.com/socket.io/`.
4. Subdivision opens `wss://<render-service>.onrender.com/tips/ws`.
5. The Subdivision button opens `/tips/`; its return button opens `/`.
6. Login, lobby creation, two-browser joining, movement, and reconnect work in
   both games.

If `/health` reports a CORS error or either socket is rejected, verify the
browser's exact origin appears in `PUBLIC_CLIENT_ORIGINS`, then redeploy Render.

## Free-tier boundaries

- Keep the Pages project static; do not add a `functions/` directory.
- Continue sharing a single Render service between the two multiplayer servers.
- Large files remain below Pages' 25 MiB per-file limit.
- A sleeping free Render service can make the first connection slow; Pages is
  still available while Render wakes.
