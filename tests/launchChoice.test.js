import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const ui = await readFile(new URL("../public/src/ui.js", import.meta.url), "utf8");
const main = await readFile(new URL("../public/src/main.js", import.meta.url), "utf8");

test("the loading screen offers both games", () => {
  const choice = index.match(/<div class="menu-actions launch-choice">([\s\S]*?)<\/div>/u);
  assert.ok(choice, "the launch choice block exists");
  // Two destinations, and no third thing quietly added to the same row.
  const buttons = [...choice[1].matchAll(/<button[^>]*id="([^"]+)"/gu)].map((m) => m[1]);
  assert.deepEqual(buttons, ["loading-continue", "loading-subdivision"]);
  assert.match(choice[1], /<b>Orbit Ops<\/b>/u);
  assert.match(choice[1], /<b>OOSD<\/b>/u);
});

test("choosing Orbit Ops still boots the game rather than navigating", () => {
  const handler = main.match(/getElementById\("loading-continue"\)\.addEventListener\("click",[\s\S]*?\n\}\);/u)[0];
  assert.match(handler, /new OrbitOpsGame\(/u);
  assert.match(handler, /ui\.enterApp\(\)/u);
  assert.doesNotMatch(handler, /location\.assign/u, "Orbit Ops must not leave the page");
});

test("choosing OOSD goes through the launch route", () => {
  // The launch route is what mints the access cookie; linking at /tips directly
  // would 404 for anyone who has not been through it.
  assert.match(
    main,
    /getElementById\("loading-subdivision"\)\.addEventListener\("click", \(\) => \{\s*window\.location\.assign\("\/easter-egg\/jims-launch"\);/u
  );
});

test("the OOSD option reflects whether the embedded game is up", () => {
  // /health reports jimsGameRunning, so an offline Subdivision is shown as
  // offline here instead of sending the player through the door to find out.
  assert.match(ui, /jimsGameAvailable, jimsGameRunning \}/u, "setLoading accepts the health flags");
  const branch = ui.match(/if \(jimsGameAvailable !== undefined \|\| jimsGameRunning !== undefined\) \{[\s\S]*?\n    \}/u);
  assert.ok(branch, "there is a branch driving the OOSD option");
  assert.match(branch[0], /byId\("loading-subdivision"\)\.disabled = !up/u);
  assert.match(branch[0], /currently offline/u);
});

test("Orbit Ops still waits for its own assets and socket", () => {
  // The two gates are different: Orbit Ops needs its assets and a live socket,
  // OOSD needs neither - only the gateway. Collapsing them would make one
  // destination wait on the other's readiness for no reason.
  assert.match(ui, /byId\("loading-continue"\)\.disabled = !\(assetsReady && serverReady\)/u);
});

test("retry and reconnect survived the rearrangement", () => {
  for (const id of ["loading-retry", "loading-reconnect"]) {
    assert.match(index, new RegExp(`id="${id}"`, "u"), `${id} is still on the loading screen`);
  }
  assert.match(main, /getElementById\("loading-retry"\)\.addEventListener\("click", loadAssets\)/u);
});
