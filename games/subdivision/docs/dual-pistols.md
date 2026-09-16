# Dual Berettas admin prototype

Secondary weapon. Complete the existing placeholder rather than adding another
snapshot ID. Supplied source: `CS2 Dual Elite 3D Model.glb`. The source has two
pistols in a single mesh, embedded textures, and no authored animation clips.
The renderer separates whole triangles across the empty gap, retains UVs and
normals, and gives the pistols independent recoil and staggered reload motion.
First-person shots and tracers alternate sides; third-person holders get one
pistol per hand. Existing draw, inspect and pistol audio paths are reused.

## Balance decision

Research references:

- https://op.gg/cs2/weapons/2 — 30-round magazine, 60 reserve, 500 RPM,
  21 armored chest damage.
- https://liquipedia.net/counterstrike/Dual_Berettas — close-range pistol role,
  accuracy and long reload tradeoffs.
- https://csdb.gg/weapon/dual-berettas/ — 3.77-second reload.
- https://www.counter-strike.net/newsentry/508485755865137963 — Valve notes
  first-person and spectator Dual Berettas fixes; verify both perspectives.

Orbit Ops tuning: semi-auto, 0.12 seconds between shots, 24/72 ammunition
(deliberately not CS2's 30/60 — smaller magazines make the 3.77s reload bite
more often, and three whole spare mags is easier to read than a loose count),
3.77-second reload, 84/21/18 head/body/leg damage, range modifier 0.79,
standing spread 0.018 and moving spread 0.07. The damage values use this game's
existing per-part convention rather than introducing a separate armor system.
Price remains the existing experimental 400. This is a close-range secondary
with greater capacity than Glock and less precision than Deagle.

## Access and validation

Open in every mode. It shipped behind a JIMS-ADMIN gate while it was being
tuned; that gate is gone and it is now a normal buyable sidearm alongside Glock
and Deagle, at the existing price of 400.

Two lists had to agree for that to be true, and they did not. Dropping
`adminOnly` alone would have left the server's own CASUAL_ONLY_WEAPONS still
naming the weapon, so it would have been buyable in the client and rejected by
the server in deathmatch and TDM - allowed only in casual. Both lists are now
consistent, and the test reads the real set out of server.js rather than a stub,
which is what let the mismatch hide in the first place.

The generic `adminOnly` mechanism stays in place, unused, with test coverage
against a synthetic weapon, so a future weapon can be gated the same way.

Not wired in: the gun-game progression (`gunGameOrder`) is a fixed ladder of
weapon indexes and does not include the duals. Add them there deliberately if
they should appear in that rotation.

Local account authentication requires DATABASE_URL, and this machine has no
Postgres, so no admin account can exist and the server closes unauthenticated
sockets with not_authed. What was verified locally:

- Server gating, over a real WebSocket against a running server: an admin
  client joins JIMS-ADMIN and isWeaponAvailableInMode admits the weapon there
  and nowhere else. This used a temporary handleAuth stub that was reverted and
  never committed; it proves the room gate, not the authentication path.
- The model split, rendered offline from the shipped GLB: 41,966 template
  triangles divide 20,983/20,983 into two intact pistols with materials and UVs
  preserved and no lost geometry. Each half measures 0.042 x 0.165 x 0.263,
  against 0.55 x 0.165 x 0.263 for the pair, which is why the split has to run
  before the viewmodel length normalisation.

Not verified: firing, recoil alternation, the staggered reload dip and the
third-person per-hand holders in a live match. Pointer lock does not engage in
the automated browser, so the client could not be un-paused. Those need a human
playtest - and now that the weapon is open, any mode will do.
