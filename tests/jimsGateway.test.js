import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { JIMS_PUBLIC_PATH, createJimsAccessToken, publicOrigin, verifyJimsAccessToken } from "../server/jimsGateway.js";

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

test("the gateway gives password emails the real public Orbit Ops origin", () => {
  assert.equal(publicOrigin({ headers: { host: "orbit-ops.example.test" } }), "http://orbit-ops.example.test");
  assert.equal(publicOrigin({ headers: { "x-forwarded-proto": "https", "x-forwarded-host": "orbit.example.test" } }), "https://orbit.example.test");
  assert.equal(publicOrigin({ headers: { host: "orbit.example.test\r\nInjected: nope" } }), "");
});

test("Jim's embedded CSP permits GLB blob texture decoding", async () => {
  const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
  assert.match(source, /connect-src 'self' blob: https:\/\/cdn\.jsdelivr\.net ws: wss:/);
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
