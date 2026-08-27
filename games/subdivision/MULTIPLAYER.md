# Multiplayer Deployment

> Last updated: 15 July 2026

The game runs as one HTTP and WebSocket service. Players open the same public
URL; the service serves the client and assets, exposes account/admin/legal routes,
and owns every active room.

## Railway

Railway builds the included `Dockerfile` and starts:

```bash
node server.js
```

Attach Postgres and configure `DATABASE_URL`, `ADMIN_TOKEN`, `DEVICE_SECRET`, and
`NODE_ENV=production`. Configure SMTP variables for registration verification,
email changes, and password recovery. Railway supplies `PORT` automatically.

Use `/health` as the health check. Keep one game-service replica: rooms, live
players, and reconnect state are held in that process, so horizontal replicas
would divide players between separate room registries. Increase the resources of
the single instance when necessary and place it near the primary player region.

## Player Flow

1. A player registers and verifies an email, logs in, resumes a session, or uses
   the supported local/guest testing path.
2. They create or join a public/private room, join through a friend, or enter as
   part of a party.
3. The server owns combat, health, movement checks, scoring, spawn protection,
   bounties, progression, challenge rewards, and persistent economy actions.
4. The client renders timestamped snapshots and interpolates remote players.
5. A brief disconnect can rejoin the same match while the reconnect stash lives.

## Runtime Contracts

- One room has at most the configured player limit; gameplay packets are scoped
  to the room and authenticated account/session.
- Movement and camera rotation are independent. Camera-only movement does not end
  stationary spawn immunity.
- Spawn protection is synchronized with an authoritative expiry timestamp. It
  ends immediately when the player shoots or throws utility.
- Damage, fire rate, kill attribution, score bonuses, and bounty state are
  calculated on the server.
- Persistent stats flush asynchronously so the match loop does not wait on normal
  database writes.
- Dead WebSocket connections are detected by ping/pong heartbeats and removed.
- Client inventory, listing, trade, case, and Trade Up identifiers are requests;
  ownership and currency are always verified and moved in database transactions.

## Release Verification

Before deployment, run syntax checks for tracked JavaScript, parse the inline
`index.html` script, run every `test/*.test.js`, and perform a rendered two-player
room check. Confirm the live Railway `/health` route and WebSocket join flow after
the release.
