import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const ui = await readFile(new URL("../public/src/ui.js", import.meta.url), "utf8");
const main = await readFile(new URL("../public/src/main.js", import.meta.url), "utf8");
const loader = await readFile(new URL("../public/src/assetLoader.js", import.meta.url), "utf8");

const style = await readFile(new URL("../public/style.css", import.meta.url), "utf8");
const choice = index.match(/<div class="launch-choice">([\s\S]*?)\n {6}<\/div>/u);

test("the loading screen offers both games as posters", () => {
  assert.ok(choice, "the launch choice block exists");
  // Two destinations, and no third thing quietly added to the same row.
  const buttons = [...choice[1].matchAll(/<button[^>]*id="([^"]+)"/gu)].map((m) => m[1]);
  assert.deepEqual(buttons, ["loading-continue", "loading-subdivision"]);
  assert.match(choice[1], /<b>Orbit Ops<\/b>/u);
  assert.match(choice[1], /<b>Subdivision<\/b>/u);
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
  assert.match(style, /\.launch-choice \{[\s\S]*?max-width: min\(100%,/u, "the row is what caps the size");
});

test("the screen belongs to both games, not to one of them", () => {
  const screen = index.match(/<div id="loading-screen"[\s\S]*?\n {2}<\/div>/u)[0];
  // No lockup, no ship name, no tip: naming one game above a choice between two
  // is picking a side, and the tip was Orbit Ops' own.
  assert.doesNotMatch(screen, /brand-lockup|O\.S\.V\. MERIDIAN|loading-tip/u);
});

test("progress and service state sit along the bottom", () => {
  assert.match(index, /<footer class="loading-status"[\s\S]*?loading-bar[\s\S]*?loading-server[\s\S]*?loading-db[\s\S]*?<\/footer>/u);
  assert.match(style, /\.loading-status \{ position: fixed; z-index: 3; inset: auto 0 0 0;/u);
  // Once there is nothing left to wait for the bar goes; the dots stay, because
  // whether the archive is reachable still decides what a session can save.
  assert.match(style, /\.loading-card\.is-ready ~ \.loading-status \.loading-track,/u);
  assert.doesNotMatch(style, /is-ready ~ \.loading-status \.loading-status-item:first-child/u);
});

test("the menu does not wait on Phaser or on the game module", () => {
  // Phaser is 1.3MB and the select screen needs none of it. Deferring the script
  // and importing game.js only on demand takes both off the path to first paint.
  assert.match(index, /<script defer src="\/vendor\/phaser\/dist\/phaser\.min\.js">/u);
  assert.doesNotMatch(main, /^import \{ OrbitOpsGame \}/mu, "game.js must not be a static import");
  assert.match(main, /const \{ OrbitOpsGame \} = await import\("\.\/game\.js"\)/u);
});

test("the posters are preloaded rather than discovered through the stylesheet", () => {
  for (const file of ["orbit-ops", "oosd"]) {
    assert.match(index, new RegExp(`<link rel="preload" as="image" href="/assets/art/launch/${file}\\.jpg">`, "u"));
  }
});

test("essential assets load together, not one after another", () => {
  // Serially, the group cost the sum of every round trip rather than the longest
  // one - and on a cold instance the round trip is the expensive part.
  assert.match(loader, /await Promise\.all\(keys\.map\(async \(key\) => \{/u);
  assert.doesNotMatch(loader, /for \(const key of keys\) \{[\s\S]*?await this\.load\(/u);
});

test("the aurora sky paints, and respects reduced motion", () => {
  const sky = style.match(/\.loading-screen::before \{[\s\S]*?\n\}/u)[0];
  // Split off from a shared rule; without these it has no box and paints nothing.
  for (const declaration of [/content: "";/u, /position: absolute;/u, /inset: 0;/u]) {
    assert.match(sky, declaration, "the sky needs its own box");
  }
  assert.match(sky, /url\("\/assets\/art\/launch\/sky\.jpg"\)/u, "the painted sky");
  // The gradients sit ABOVE the photograph, so they are also what shows while it
  // is still downloading - the screen is never a flat black rectangle waiting on
  // a 650KB image. That is also why the sky is not preloaded: the posters are,
  // and the two would compete for the same first connections.
  const layers = sky.match(/background-image:([\s\S]*?);/u)[1];
  assert.ok(
    layers.indexOf("radial-gradient") < layers.indexOf("sky.jpg"),
    "the darkening gradient must be painted over the photograph, not under it"
  );
  assert.doesNotMatch(index, /rel="preload"[^>]*sky\.jpg/u, "the sky must not outrank the posters");
  assert.match(style, /@media \(prefers-reduced-motion: reduce\) \{ \.loading-screen::after \{ animation: none; \} \}/u);
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

test("choosing Subdivision uses the deployment-specific destination", () => {
  // Same-origin Render keeps the signed launch route, while the generated Pages
  // configuration supplies its static /tips/ destination.
  assert.match(
    main,
    /getElementById\("loading-subdivision"\)\.addEventListener\("click", \(\) => \{\s*window\.location\.assign\(String\(clientConfig\.subdivisionUrl \|\| "\/easter-egg\/jims-launch"\)\);/u
  );
});

test("the Subdivision option reflects whether the embedded game is up", () => {
  // /health reports jimsGameRunning, so an offline Subdivision is shown as
  // offline here instead of sending the player through the door to find out.
  assert.match(ui, /jimsGameAvailable, jimsGameRunning \}/u, "setLoading accepts the health flags");
  const branch = ui.match(/if \(jimsGameAvailable !== undefined \|\| jimsGameRunning !== undefined\) \{[\s\S]*?\n    \}/u);
  assert.ok(branch, "there is a branch driving the Subdivision option");
  assert.match(branch[0], /byId\("loading-subdivision"\)\.disabled = !up/u);
  assert.match(branch[0], /"Offline"/u);
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
