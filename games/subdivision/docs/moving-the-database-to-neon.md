# Moving this game's database onto Neon, without a terminal

Everything here happens in a browser: the Neon console, the Railway console and the
Render dashboard. No local tooling, no `pg_dump`.

It works because Neon supports the `postgres_fdw` extension, so Neon itself can reach
across to Railway and pull the rows in. The copying runs inside Neon's SQL Editor.

## Before you start

**Check the size.** Railway → Postgres → Metrics. Neon's free tier holds 0.5 GB;
`skin_inventory`, `case_openings` and `chat_logs` are the likely bulk. If it is over,
stop here — the plan needs a paid Neon tier or a trimmed copy.

**Do it when nobody is playing.** Rows written to Railway after the copy starts will not
come across.

**Both instances must move together.** The embedded game (Render) and the standalone
game (Railway) share one database, and that is what makes cross-play, shared accounts and
the room directory work. If only one moves, they stop seeing each other and the two
copies of every account drift apart from that moment.

## 1. Make the database

Neon console → your project → **Databases** → **New Database** → name it `subdivision`.

It goes in the *same project* Orbit Ops already uses, but as its own database. It cannot
share Orbit Ops' database: both games define `accounts`, `sessions`, `bans` and
`friendships` with different columns, and because both create tables with
`IF NOT EXISTS`, whichever booted first would win while the other quietly ran against the
wrong shape.

## 2. Let the game build its own schema

Copy the Neon connection string for `subdivision` (Neon console → Connection Details,
then change the database name in the URL).

Render → orbit-ops → Environment → set `JIMS_DATABASE_URL` to it → save. Render
redeploys, the embedded game boots, and `initDb()` creates all 33 tables with their keys,
constraints and indexes.

Confirm before continuing: `https://orbit-ops.onrender.com/health` should report
`"jimsGameRunning": true`.

Doing it this way means the copy only has to move rows, never schema — which is what
keeps it to plain `INSERT` statements.

## 3. Copy the rows

Neon SQL Editor, with `subdivision` selected as the database. Run
[`neon-migration.sql`](./neon-migration.sql) — paste it in sections, in order.

It needs four values from Railway → Postgres → Variables → `DATABASE_PUBLIC_URL`, which
reads `postgresql://USER:PASSWORD@HOST:PORT/DBNAME`. Use the **public** URL: the internal
`postgres.railway.internal` hostname resolves only inside Railway, so Neon cannot reach it.

The script is ordered so no child row lands before its parent, and every insert carries
`ON CONFLICT DO NOTHING`, so a failure part-way through can be resumed by running it again
rather than producing duplicates.

Step 3e prints a row count per table from both sides. **They must all match before you go
on.**

## 4. Move the standalone game too

Railway → your game service → Variables → set `DATABASE_URL` to the same Neon
`subdivision` string.

At this point both instances are on Neon and cross-play works again. The Railway Postgres
service now holds nothing live — leave it running until you are satisfied, then delete it.

## 5. Close the door

Re-run the last section of the script to drop the foreign server. Until you do, Neon
stores Railway's credentials in `pg_user_mappings`.

## What to check afterwards

- Sign in on both deployments with the same account; inventories should match.
- Host a room on one and join by code from the other — it should connect in place now
  rather than redirecting.
- Open a case, then confirm the row appears in `case_openings` from the other side.

## If it goes wrong

Nothing here writes to Railway — `postgres_fdw` only reads. Until step 4, Railway is
still the live database for the standalone game, so reverting is just putting the old
`JIMS_DATABASE_URL` back on Render.
