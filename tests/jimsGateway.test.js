import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createJimsAccessToken, verifyJimsAccessToken } from "../server/jimsGateway.js";

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
  assert.match(source, /connect-src 'self' blob: https:\/\/cdn\.jsdelivr\.net ws: wss:/);
});

test("Orbit Ops ships its own embedded-game favicon", async () => {
  const icon = await readFile(new URL("../public/orbit-ops-favicon.svg", import.meta.url), "utf8");
  assert.match(icon, /aria-label="Orbit Ops"/);
  assert.match(icon, /<svg/);
});
