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

Only the server-owned JIMS-ADMIN room permits the weapon. Public state, purchase,
shoot and damage packets carrying its name are rejected, and the buy/switch
client paths hide it outside that room. Leaving the room resets the sidearm.
No admin authentication bypass was added.

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
playtest in the real admin room.
