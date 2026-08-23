import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const ui = await readFile(new URL("../public/src/ui.js", import.meta.url), "utf8");
const main = await readFile(new URL("../public/src/main.js", import.meta.url), "utf8");

const style = await readFile(new URL("../public/style.css", import.meta.url), "utf8");
const choice = index.match(/<div class="launch-choice">([\s\S]*?)\n {6}<\/div>/u);

test("the loading screen offers both games as posters", () => {
  assert.ok(choice, "the launch choice block exists");
  // Two destinations, and no third thing quietly added to the same row.
  const buttons = [...choice[1].matchAll(/<button[^>]*id="([^"]+)"/gu)].map((m) => m[1]);
  assert.deepEqual(buttons, ["loading-continue", "loading-subdivision"]);
  assert.match(choice[1], /<b>Orbit Ops<\/b>/u);
  assert.match(choice[1], /<b>OOSD<\/b>/u);
  // Art and a title, nothing else. The poster is the button, so a separate Play
  // control would be a second thing to aim at for the same result.
  assert.doesNotMatch(choice[1], /launch-card-play|launch-card-sub/u);
});

test("a poster's width drives its height, never the other way round", () => {
  // Fixing the height and letting width fall out of the ratio meant that once
  // the computed width passed the grid column, both posters overflowed their
  // tracks and sat edge to edge with the gap gone.
  const rule = style.match(/\.launch-card \{[\s\S]*?\n\}/u)[0];
  assert.match(rule, /width: 100%;/u);
  assert.match(rule, /height: auto;/u);
  assert.match(rule, /aspect-ratio: 7 \/ 10;/u);
  assert.match(style, /\.launch-choice \{[^}]*max-width: 560px/u, "the row is what caps the size");
});

test("the loading chrome folds away once there is nothing left to wait for", () => {
  assert.match(ui, /classList\.toggle\("is-ready", Boolean\(assetsReady && serverReady\)\)/u);
  assert.match(style, /\.loading-card\.is-ready \.loading-track,[\s\S]*?display: none;/u);
  // The status row stays: whether the archive is reachable still decides what a
  // session can save, which is worth knowing before picking a mode.
  assert.doesNotMatch(style, /\.loading-card\.is-ready \.status-grid/u);
});

test("missing poster art degrades to a gradient rather than a broken image", () => {
  // The art is a CSS background, not an <img>, precisely so a file that has not
  // been added yet fails silently instead of leaving a broken-image icon in the
  // middle of the card.
  assert.doesNotMatch(choice[1], /<img/u, "no <img> inside the cards");
  for (const [selector, file] of [["launch-card-orbit", "orbit-ops"], ["launch-card-oosd", "oosd"]]) {
    const rule = new RegExp(
      `\\.${selector} \\.launch-card-art \\{ background-image: url\\("/assets/art/launch/${file}\\.jpg"\\), linear-gradient`,
      "u"
    );
    assert.match(style, rule, `${file} art layers over a gradient fallback`);
  }
});

test("the title stays readable over whatever art is dropped in", () => {
  // A bright poster and white type fight each other without this.
  assert.match(style, /\.launch-card::after \{ content: ""[^}]*linear-gradient\(180deg, transparent/u);
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
  assert.match(branch[0], /Currently offline/u);
  // A dead card must not answer the pointer as though it were live.
  assert.match(style, /\.launch-card:disabled:hover \{ transform: none;/u);
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
