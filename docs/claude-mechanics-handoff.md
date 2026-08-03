# Claude mechanics refinement handoff

Copy the prompt below into Claude after pulling the latest Orbit Ops commit.

```text
You are continuing work on the local Orbit Ops repository. Treat the existing 2D map rebuild as approved and do not replace, retrace, rename, crop, resize, or procedurally redraw the lobby or The Skeld room art unless I explicitly ask. Do not reintroduce Airship. The active match maps remain The Skeld, MIRA HQ, and Polus.

What Codex completed in the latest map pass:

- Re-proportioned the Dropship lobby with independent horizontal and vertical source scales so the playable hold is nearly square. The floor, player spawns, laptop, crates, collisions, hull, exhaust and door remain on the same coordinate transform. The front door/ramp was pulled upward beneath the final floor row.
- Rebuilt both Skeld engine rooms from the supplied floor and machinery regions, enlarged Upper Engine and Lower Engine, and kept their colliders aligned.
- Added complete room-specific runtime art for Reactor, Security, Electrical, Storage, Admin, Communications, Shields and Weapons instead of generic procedural placeholders.
- Kept the supplied Cafeteria, MedBay, O2 and Navigation art; fixed MedBay's room/art scale, enlarged Security, corrected Weapons proportions and stretched Navigation vertically.
- Restored the supplied Admin map table, Security monitors, Communications workstation, Shields platform/console bank and Storage cargo details.
- Put the O2 sabotage repair point on O2's north/top wall and moved the Shields vent to the south/bottom edge.
- Updated collision rectangles, map bounds, preload keys, validation tests and the asset-placement audit.
- Reference screenshots are still reference-only and are never loaded by the game.
- Automated result at handoff: 22/22 Node tests passed, syntax checks passed, and the browser console reported no warnings or errors during two live practice sessions.

Mechanics/UI refinement work to do next, in priority order:

1. Fix practice-bot sabotage pacing. In the first live practice run an Operative bot started repeated sabotage and a Reactor Meltdown ended the match after 78 seconds, before a new player could explore. Add a practice-only opening grace period and a real cooldown between bot sabotages. A good starting target is 60-90 seconds before the first sabotage and 45-60 seconds between later sabotage attempts. Do not weaken server authority or change normal online-match settings.

2. Teach crew bots to respond to critical sabotage. When a critical system starts, at least the required number of eligible crew bots should temporarily prioritize the correct repair stations over ordinary assignments. Route them through authored corridors, respect collision geometry, and prevent all bots from selecting the same repair station. Add deterministic server tests for single-station and two-station repairs.

3. Clarify pause behavior. The current Escape modal says “OPERATIONS PAUSED,” but the server-authoritative match and sabotage countdown continue. For online games, rename it to “SYSTEM MENU — MATCH CONTINUES.” For solo practice, either implement a genuine server-side practice pause or clearly state that simulation time continues. Do not merely freeze the canvas while server timers run.

4. Correct practice role-use feedback. `server/gameServer.js` intentionally does not decrement finite role uses in practice mode, but `public/src/ui.js` still displays “1 use.” Show “Unlimited practice” (or an infinity symbol with an accessible label) in practice, while preserving real cooldown feedback and finite-use behavior in online matches. Add UI/state tests.

5. Make the minimap modal responsive. At the live test's narrow 376x768 CSS viewport, the right side of The Skeld overview/Navigation was clipped. Fit the authored map bounds inside the available canvas area, including legend and modal padding, without changing world geometry. Verify 1280x720, 1024x768, 948x720, 390x844 and 376x768.

6. Fix narrow lobby footer overflow. At the same 376x768 CSS viewport, the Start Operation control ran beyond the right edge. Allow the footer actions to wrap or collapse while keeping Leave, readiness state and Start Operation reachable by keyboard and touch.

7. Improve practice onboarding. Keep bot task contribution, but distinguish “your assignments” from shared crew progress so the global counter changing while the player is idle is understandable. Add a short first-run hint for map, interaction, emergency and role controls, and suppress repeated hints after acknowledgement.

8. Expand the end-to-end smoke suite. Cover: guest entry, practice lobby, parameter edit, movement, map open/close, assignment panel, emergency meeting, one task, one sabotage repair, one role ability, pause/resume and end-of-match return. Preserve the existing authoritative elimination, voting, role, reconnect and multiplayer tests.

Implementation constraints:

- Inspect the current code and tests before editing. Prefer small server-authoritative changes over client-only simulation.
- Do not change approved map coordinates, room dimensions, asset files, crop masks, vents, sabotage station placement, lobby scale or map selection.
- Keep reference images out of the runtime.
- Run `pnpm test` and `pnpm run check`, then perform a real browser practice run and inspect console errors.
- Commit all completed work, do not push unless asked, and include this exact trailer:
  Co-authored-by: ChatGPT Codex 5.6 Sol <noreply@openai.com>
- In your final response, list changed files, tests performed, observed behavior and the commit hash.
```
