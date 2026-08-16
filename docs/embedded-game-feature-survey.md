# What Orbit Ops could take from the embedded game

*Survey of `Orbit-Ops-Subdivision` (the hidden game at `/tips`) for features worth porting
into Orbit Ops, 2026-08-14. Ranked by value against effort. Nothing here is implemented.*

The two games share a database host and an account model, but not a codebase: the embedded
game is CommonJS with a hand-rolled WebSocket protocol, Orbit Ops is ES modules on Socket.IO.
Nothing ports by copy — these are designs to reimplement, not files to move.

---

## 1. Ban issuance — finish what the audit started

**This is a gap the audit sweep opened.** `accounts.role`, `bans` and `mutes` are now read on
sign-in and on joining a room (`server/authService.js`, `server/gameServer.js`), but **nothing
in Orbit Ops can create a ban**. There is no `INSERT INTO bans` anywhere. So the moderation
system is enforced and unreachable: the tables stay empty, and the enforcement is dead weight.

The embedded game has the whole thing in `bans.js` (150 lines): `banAccount`, `banDevice`,
`unban`, `listActiveAccounts`, a 30-second refresh loop so a ban takes effect without a
restart, and `recordViolation` with an auto-ban handler. `admin.js` exposes it over a
token-guarded HTTP route.

Smallest useful port: `banAccount` / `unban` / `listActiveAccounts`, plus an admin route
guarded by the existing owner role. Without it, close the loop the other way and drop the
enforcement — but do one or the other, because right now it is neither.

## 2. Password reset

Orbit Ops has **no account recovery at all**. A forgotten password is a lost account, with no
route back. For a game that asks people to register, that is the most user-visible hole.

The embedded game does it without email dependence: a recovery code is generated at
registration, shown once, stored encrypted (`recovery_code_ciphertext`), and accepted against
email + username to authorise a reset (`auth.js:647-677`). Codex has since made it rotate
after account changes. It also has an email link flow via `mailer.js` (Brevo), but the
recovery-code path is the one worth copying — no mail provider, no deliverability problem.

Orbit Ops already has `bcryptjs`, a `sessions` table, and `revokeSession`. This is mostly a
column, two socket handlers, and a UI panel.

## 3. Friends and parties

Neither exists in Orbit Ops. For a social deduction game this is the biggest *gameplay* miss
on the list — Among Us is played with people you know, and right now the only way to play
together is to pass a five-character room code by hand.

The embedded game has both: `friendRequest` / `friendRespond` / `friendRemove` / `getFriends`,
`getRecentPlayers` (a "played with recently" list, which is what makes friend-adding actually
happen), and a party system (`partyInvite` / `partyRespond` / `partyKick` / `partyLeave`) that
moves a group into a room together.

Parties interact with `MAX_ROOM_PLAYERS` and with `joinPublic` matchmaking, so this is the
largest item here. Friends and `getRecentPlayers` alone are worth doing first and are much
smaller.

## 4. Anti-flood

`antiflood.js` (299 lines) tracks per-IP and **per-/24-subnet** connection state, with
`onConnect` / `onAuthenticated` phases so an unauthenticated flood is cheap to shed before it
reaches game logic.

Orbit Ops now resolves a trusted client IP (`server/trustedClientIp.js`) and rate-limits
per action, which covers the common case. What it does not have is subnet-level shedding or a
cheap pre-auth reject. Worth taking only if the game is actually attacked — the audit fix
addressed the credential-stuffing route, which was the real hole.

## 5. Leaderboards

`player_stats` already accumulates everything needed (`games_played`, `total_wins`, `score`,
`experience`, `longest_survival_seconds`) and nothing reads it back except a single profile
line. The embedded game's `getLeaderboards` is a straightforward ranked query.

This is the cheapest item on the list — one indexed query and a panel — and it makes the stats
that are already being written mean something.

## 6. Disposable-email blocking

The embedded game ships `disposable-domains.json` (271 domains) and rejects them at
registration. Orbit Ops validates email shape only. Cheap, and it keeps throwaway accounts
from filling the owner-name space and the leaderboard.

## 7. News / announcements

`getNews` / `postNews`, owner-gated. Useful for saying "servers restarting" without a deploy.
Small, and it pairs naturally with whatever admin route item 1 needs.

---

## Deliberately not recommended

- **Skins, cases, trade-ups, the auction marketplace** (`skins.js`, `skins_imported.js`,
  `tradeups.js` — 8700 lines). An FPS cosmetic economy. Orbit Ops has a small appearance
  picker and no reason for an economy.
- **Map voting.** Orbit Ops ships one map, so there is nothing to vote on. Revisit if MIRA HQ
  or Polus are ever built.
- **Daily/weekly challenge templates.** Retention scaffolding for a live-service shooter; a
  poor fit for a game played in short social sessions, and a large surface.
- **Device fingerprinting** (`fingerprint.js`). Ban evasion control that carries real privacy
  weight. Not worth it at this scale.

---

## Suggested order

1. Ban issuance — closes a hole this repo currently has open.
2. Password reset — the worst user-facing gap.
3. Leaderboards — cheapest win, and the data is already there.
4. Friends plus `getRecentPlayers` — the real social gain.
5. Parties — largest, do last.
