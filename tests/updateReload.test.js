import assert from "node:assert/strict";
import test from "node:test";
import { RELOAD_SAFE_PHASES, UpdateReloader, reloadIsSafe } from "../public/src/updateReload.js";
import { resolveBuildId } from "../server/buildInfo.js";

function reloader() {
  const state = { reloads: 0, said: [] };
  state.controller = new UpdateReloader({
    reload: () => { state.reloads += 1; },
    notify: (message) => state.said.push(message),
    delayMs: 0
  });
  return state;
}

test("a reload is only safe on the quiet screens", () => {
  for (const phase of RELOAD_SAFE_PHASES) assert.equal(reloadIsSafe(phase), true, phase);
  for (const phase of ["active", "countdown", "roleReveal", "discussion", "voting", "removal", "incidentTransition"]) {
    assert.equal(reloadIsSafe(phase), false, phase);
  }
  // Unknown phases wait: a stale client is cheaper than a dropped match.
  assert.equal(reloadIsSafe("a-phase-added-later"), false);
  assert.equal(reloadIsSafe(undefined), true);
});

test("a deploy during a match waits for the match to end", () => {
  const state = reloader();
  state.controller.noteUpdate("active");
  assert.equal(state.reloads, 0);
  assert.match(state.said[0], /when this match ends/u);

  for (const phase of ["discussion", "voting", "removal", "active"]) {
    state.controller.applyWhenSafe(phase);
  }
  assert.equal(state.reloads, 0, "nothing may interrupt a live match");
  assert.equal(state.said.length, 1, "the player is told once, not every phase");

  state.controller.applyWhenSafe("results");
  assert.equal(state.reloads, 1);
  assert.match(state.said[1], /reloading/u);
});

test("a deploy while idle is taken immediately", () => {
  const state = reloader();
  state.controller.noteUpdate("lobby");
  assert.equal(state.reloads, 1);
  assert.equal(state.said.length, 1);
});

test("without an update nothing reloads", () => {
  const state = reloader();
  assert.equal(state.controller.applyWhenSafe("menu"), false);
  assert.equal(state.reloads, 0);
});

test("one deploy reloads once however often it is signalled", () => {
  const state = reloader();
  state.controller.noteUpdate("menu");
  state.controller.noteUpdate("menu");
  state.controller.applyWhenSafe("menu");
  assert.equal(state.reloads, 1);
});

test("the build id identifies the deployed commit", () => {
  assert.equal(resolveBuildId({ RENDER_GIT_COMMIT: "abcdef1234567890" }), "abcdef123456");
  assert.equal(resolveBuildId({ ORBIT_BUILD_ID: "release-42" }), "release-42");
  // The commit is the truth when both are present.
  assert.equal(resolveBuildId({ RENDER_GIT_COMMIT: "aaaaaaaaaaaa", ORBIT_BUILD_ID: "x" }), "aaaaaaaaaaaa");
  // Redeploying the same commit must not look like a new build.
  assert.equal(resolveBuildId({ RENDER_GIT_COMMIT: "c0ffee123456" }), resolveBuildId({ RENDER_GIT_COMMIT: "c0ffee123456" }));
  assert.match(resolveBuildId({}), /^dev-/u);
});
