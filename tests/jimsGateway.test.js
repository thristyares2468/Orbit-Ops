import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { JIMS_PUBLIC_PATH, createJimsAccessToken, verifyJimsAccessToken } from "../server/jimsGateway.js";

test("the hidden game uses the concise tips gateway path", () => {
  assert.equal(JIMS_PUBLIC_PATH, "/tips");
});

test("Jim's gateway access tokens expire and reject tampering", () => {
  const now = Date.UTC(2026, 7, 10, 5, 0, 0);
  const token = createJimsAccessToken("test-secret", now);
  assert.equal(verifyJimsAccessToken(token, "test-secret", now + 1000), true);
  assert.equal(verifyJimsAccessToken(token, "wrong-secret", now + 1000), false);
  assert.equal(verifyJimsAccessToken(`${token}x`, "test-secret", now + 1000), false);
  assert.equal(verifyJimsAccessToken(token, "test-secret", now + (7 * 60 * 60 * 1000)), false);
});

test("the embedded Subdivision CSP permits its GLB decoder runtime", async () => {
  const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
  // The Subdivision loader needs the emscripten glue used by the Draco and Basis
  // decoders. Keep this exception scoped to /tips; Orbit Ops retains its strict
  // no-eval CSP.
  assert.match(source, /request\.path === "\/tips" \|\| request\.path\.startsWith\("\/tips\/"\)/u);
  assert.match(source, /script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https:\/\/cdn\.jsdelivr\.net/u);
  assert.match(source, /connect-src 'self' blob: https:\/\/cdn\.jsdelivr\.net ws: wss:/);
  assert.match(source, /: "default-src 'self'; script-src 'self';/u, "Orbit Ops keeps the stricter policy");
});

test("Orbit Ops declares its own favicon for both the game and embedded-game route", async () => {
  const icon = await readFile(new URL("../public/orbit-ops-favicon.svg", import.meta.url), "utf8");
  const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(icon, /aria-label="Orbit Ops"/);
  assert.match(icon, /<svg/);
  assert.match(index, /rel="icon" type="image\/svg\+xml" href="\/orbit-ops-favicon\.svg"/);
});

test("Subdivision is an ordinary labelled launch card in the shared selector", async () => {
  const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../public/src/main.js", import.meta.url), "utf8");
  assert.match(index, /<button id="loading-subdivision" class="launch-card launch-card-oosd" type="button">/u);
  assert.match(index, /<b>Subdivision<\/b>/u);
  // One click, straight to the signed launch route. No repository URL, secret
  // code, or standalone deployment is involved.
  assert.match(main, /getElementById\("loading-subdivision"\)\.addEventListener\("click", \(\) => \{\s*window\.location\.assign\("\/easter-egg\/jims-launch"\);/u);
});

test("the old hidden door is gone entirely", async () => {
  const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const ui = await readFile(new URL("../public/src/ui.js", import.meta.url), "utf8");
  // The press-counting door, its access code and the module behind them were
  // removed rather than left unreferenced - a dead second way in is worse than
  // no second way in, because nothing tells you when it stops matching the door.
  for (const gone of [/SecretDoor/u, /codeOpensDoor/u, /openAccessCodePrompt/u, /accessCodePrompt/u]) {
    assert.doesNotMatch(ui, gone, `${gone} should no longer appear in ui.js`);
  }
  assert.doesNotMatch(index, /manual-ghosts/u, "the Ghosts heading no longer carries a hook");
  await assert.rejects(readFile(new URL("../public/src/secretDoor.js", import.meta.url), "utf8"));
});

test("the embedded game uses bounded Railway connection settings and restarts after transient boot failures", async () => {
  const source = await readFile(new URL("../server/jimsGateway.js", import.meta.url), "utf8");
  assert.match(source, /DATABASE_POOL_MAX: process\.env\.SUBDIVISION_DATABASE_POOL_MAX/);
  assert.match(source, /DATABASE_CONNECT_TIMEOUT_MS: process\.env\.SUBDIVISION_DATABASE_CONNECT_TIMEOUT_MS/);
  assert.match(source, /DATABASE_APPLICATION_NAME: "orbit-ops-subdivision-embedded"/);
  assert.match(source, /DATABASE_URL: configuration\.databaseUrl/);
  assert.match(source, /restarting child in \$\{delay\}ms/);
  assert.match(source, /scheduleRestart\(\)/);
});
