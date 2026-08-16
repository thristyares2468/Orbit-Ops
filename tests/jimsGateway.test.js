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

test("Jim's embedded CSP permits GLB blob texture decoding", async () => {
  const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
  assert.match(source, /script-src 'self' 'unsafe-inline' https:\/\/cdn\.jsdelivr\.net/);
  assert.match(source, /connect-src 'self' blob: https:\/\/cdn\.jsdelivr\.net ws: wss:/);
  assert.doesNotMatch(source, /'unsafe-eval'/);
});

test("Orbit Ops declares its own favicon for both the game and embedded-game route", async () => {
  const icon = await readFile(new URL("../public/orbit-ops-favicon.svg", import.meta.url), "utf8");
  const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(icon, /aria-label="Orbit Ops"/);
  assert.match(icon, /<svg/);
  assert.match(index, /rel="icon" type="image\/svg\+xml" href="\/orbit-ops-favicon\.svg"/);
});

test("the Ghosts easter egg stays visually neutral on pointer hover", async () => {
  const styles = await readFile(new URL("../public/style.css", import.meta.url), "utf8");
  assert.doesNotMatch(styles, /\.manual-card-link:hover article/);
  assert.match(styles, /\.manual-card-link:focus-visible/);
});

test("the embedded game uses bounded Railway connection settings and restarts after transient boot failures", async () => {
  const source = await readFile(new URL("../server/jimsGateway.js", import.meta.url), "utf8");
  assert.match(source, /DATABASE_POOL_MAX: process\.env\.JIMS_DATABASE_POOL_MAX \|\| "6"/);
  assert.match(source, /DATABASE_CONNECT_TIMEOUT_MS: process\.env\.JIMS_DATABASE_CONNECT_TIMEOUT_MS \|\| "15000"/);
  assert.match(source, /DATABASE_APPLICATION_NAME: "orbit-ops-embedded"/);
  assert.match(source, /restarting child in \$\{delay\}ms/);
  assert.match(source, /scheduleRestart\(\)/);
});
