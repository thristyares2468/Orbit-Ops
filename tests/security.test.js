import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import express from "express";
import pg from "pg";
import {
  databasePoolConfig, databaseSslOptions, normaliseDatabaseConnectionString
} from "../database/database.js";
import { configuredOwnerIdentity, provisionConfiguredOwner } from "../database/ownerProvisioning.js";
import { DUMMY_PASSWORD_HASH } from "../server/authService.js";
import { rateLimitKey } from "../server/gameServer.js";
import { GameServer } from "../server/gameServer.js";
import { RateLimiter } from "../server/rateLimits.js";
import { configureTrustedProxy, resolveTrustedClientIp } from "../server/trustedClientIp.js";

test("trusted proxy resolution ignores a spoofed left-most forwarded address", () => {
  const app = express();
  configureTrustedProxy(app, 1);
  const request = {
    headers: { "x-forwarded-for": "192.0.2.44, 198.51.100.20" },
    socket: { remoteAddress: "10.0.0.5" }
  };
  assert.equal(resolveTrustedClientIp(app, request), "198.51.100.20");
  assert.equal(Object.hasOwn(request, "app"), false);
});

test("direct deployments ignore forwarded addresses until proxy trust is configured", () => {
  const app = express();
  configureTrustedProxy(app);
  const request = {
    headers: { "x-forwarded-for": "192.0.2.44" },
    socket: { remoteAddress: "203.0.113.9" }
  };
  assert.equal(resolveTrustedClientIp(app, request), "203.0.113.9");
});

test("authentication rate limits survive a new socket while gameplay limits remain per connection", () => {
  const first = { id: "socket-a", data: { clientIp: "198.51.100.20" }, handshake: {} };
  const second = { id: "socket-b", data: { clientIp: "198.51.100.20" }, handshake: {} };
  assert.equal(rateLimitKey(first, "login"), rateLimitKey(second, "login"));
  assert.notEqual(rateLimitKey(first, "playerInput"), rateLimitKey(second, "playerInput"));

  const limiter = new RateLimiter();
  assert.equal(limiter.allow(rateLimitKey(first, "login"), 2, 60_000), true);
  assert.equal(limiter.allow(rateLimitKey(second, "login"), 2, 60_000), true);
  assert.equal(limiter.allow(rateLimitKey(second, "login"), 2, 60_000), false);
});

test("missing-account password work uses a valid cost-12 bcrypt hash", async () => {
  assert.equal(bcrypt.getRounds(DUMMY_PASSWORD_HASH), 12);
  assert.equal(await bcrypt.compare("definitely-not-the-dummy-password", DUMMY_PASSWORD_HASH), false);
  const source = await readFile(new URL("../server/authService.js", import.meta.url), "utf8");
  assert.match(source, /account\?\.password_hash \?\? DUMMY_PASSWORD_HASH/);
  assert.match(source, /recordFailedLogin\(account\.id\)/);
});

test("database TLS verifies certificates and refuses insecure production modes", () => {
  assert.deepEqual(databaseSslOptions({}), { rejectUnauthorized: true });
  assert.deepEqual(
    databaseSslOptions({ DATABASE_SSL_CA: "line-one\\nline-two" }),
    { rejectUnauthorized: true, ca: "line-one\nline-two" }
  );
  assert.deepEqual(
    databaseSslOptions({ NODE_ENV: "development", DATABASE_SSL_MODE: "insecure" }),
    { rejectUnauthorized: false }
  );
  assert.throws(
    () => databaseSslOptions({ NODE_ENV: "production", DATABASE_SSL_MODE: "insecure" }),
    /must verify/u
  );
  assert.throws(
    () => databaseSslOptions({ NODE_ENV: "production", DATABASE_SSL: "false" }),
    /cannot disable TLS/u
  );

  const config = databasePoolConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://crew:secret@db.example/orbit?application_name=custom&ssl=no-verify&sslmode=no-verify&sslrootcert=%2Ftmp%2Fevil.pem",
    DATABASE_SSL_MODE: "verify-full",
    DATABASE_SSL_CA: "trusted-provider-ca"
  });
  assert.deepEqual(config.ssl, { rejectUnauthorized: true, ca: "trusted-provider-ca" });
  assert.equal(new URL(config.connectionString).searchParams.get("application_name"), "custom");
  assert.equal(new URL(config.connectionString).searchParams.has("ssl"), false);
  assert.equal(new URL(config.connectionString).searchParams.has("sslmode"), false);
  assert.equal(new URL(config.connectionString).searchParams.has("sslrootcert"), false);
  assert.deepEqual(
    new pg.Client(config).connectionParameters.ssl,
    { rejectUnauthorized: true, ca: "trusted-provider-ca" },
    "node-postgres must receive the verified TLS policy after URL parsing"
  );
  assert.throws(() => normaliseDatabaseConnectionString("https://db.example/orbit"), /postgres/u);
});

test("owner provisioning uses configured immutable identity and contains no boot-time DDL", async () => {
  assert.deepEqual(
    configuredOwnerIdentity({ NODE_ENV: "development", ORBIT_OWNER_EMAIL: "Captain@Example.com" }),
    { kind: "email", value: "captain@example.com" }
  );
  assert.deepEqual(
    configuredOwnerIdentity({ ORBIT_OWNER_ACCOUNT_ID: "550e8400-e29b-41d4-a716-446655440000" }),
    { kind: "id", value: "550e8400-e29b-41d4-a716-446655440000" }
  );
  assert.throws(
    () => configuredOwnerIdentity({ ORBIT_OWNER_ACCOUNT_ID: "not-a-uuid" }),
    /must be a UUID/u
  );
  assert.throws(
    () => configuredOwnerIdentity({ NODE_ENV: "production", ORBIT_OWNER_EMAIL: "captain@example.com" }),
    /requires ORBIT_OWNER_ACCOUNT_ID/u
  );

  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (String(sql).startsWith("SELECT id")) return { rowCount: 1, rows: [{ id: "owner-id" }] };
      return { rowCount: 1, rows: [{ id: "owner-id" }] };
    }
  };
  const result = await provisionConfiguredOwner({
    environment: { NODE_ENV: "development", ORBIT_OWNER_EMAIL: "captain@example.com" },
    databaseConfigured: true,
    transaction: (callback) => callback(client)
  });
  assert.deepEqual(result, { configured: true, found: true, updated: true });
  assert.match(calls[0].sql, /lower\(email\)/);
  assert.ok(calls.some(({ sql }) => /role = 'player'/u.test(sql)), "stale owners are demoted");
  assert.ok(calls.some(({ sql }) => /role = 'owner'/u.test(sql)), "the configured account is promoted");

  const noMatchCalls = [];
  const noMatch = await provisionConfiguredOwner({
    environment: { NODE_ENV: "development", ORBIT_OWNER_EMAIL: "not-registered@example.com" },
    databaseConfigured: true,
    transaction: (callback) => callback({
      async query(sql, params) {
        noMatchCalls.push({ sql, params });
        return { rowCount: 0, rows: [] };
      }
    })
  });
  assert.deepEqual(noMatch, { configured: true, found: false });
  assert.equal(noMatchCalls.length, 1, "a missing configured account must not demote the current owner");

  const source = await readFile(new URL("../database/ownerProvisioning.js", import.meta.url), "utf8");
  assert.match(source, /ORBIT_OWNER_ACCOUNT_ID/);
  assert.match(source, /ORBIT_OWNER_EMAIL/);
  assert.doesNotMatch(source, /display_name/);
  assert.doesNotMatch(source, /ALTER TABLE/i);
});

test("active bans and mutes are enforced by authentication, joining, and chat", async () => {
  const repository = await readFile(new URL("../database/repositories/accountsRepository.js", import.meta.url), "utf8");
  const auth = await readFile(new URL("../server/authService.js", import.meta.url), "utf8");
  const gameServer = await readFile(new URL("../server/gameServer.js", import.meta.url), "utf8");
  assert.match(repository, /FROM bans[\s\S]*expires_at > now\(\)/);
  assert.match(repository, /FROM mutes[\s\S]*expires_at > now\(\)/);
  assert.match(auth, /restrictions\.banned/);
  assert.match(gameServer, /requireAccountAccess\(socket\.data\.auth\.accountId\)/);
  assert.match(gameServer, /requireAccountAccess\(player\.accountId, \{ chat: true \}\)/);
  assert.match(gameServer, /room\.mode === "private"[\s\S]*?\["moderator", "admin", "owner"\]\.includes\(socket\.data\.auth\?\.role\)/);
});

test("a restricted account cannot allocate orphaned rooms", async (context) => {
  const handlers = new Map();
  const socket = {
    id: "restricted-socket",
    data: {},
    emit() {},
    join() {},
    on(event, handler) { handlers.set(event, handler); }
  };
  const server = new GameServer({ on() {}, to() { return { emit() {} }; } });
  context.after(() => server.stop());
  server.registerSocket(socket);
  socket.data.auth = {
    accountId: "restricted-account",
    displayName: "Restricted",
    guest: false,
    appearance: {}
  };
  server.requireAccountAccess = async () => { throw new Error("This account is banned from multiplayer."); };

  const request = (event, payload = {}) => new Promise((resolve) => {
    handlers.get(event)(payload, resolve);
  });
  assert.equal((await request("createRoom", { mode: "private" })).ok, false);
  assert.equal((await request("joinPublic")).ok, false);
  assert.equal(server.rooms.size, 0);
});

test("pre-checked room creation performs one restriction lookup before allocation", async (context) => {
  const handlers = new Map();
  const socket = {
    id: "single-check-socket",
    data: {},
    emit() {},
    join() {},
    on(event, handler) { handlers.set(event, handler); }
  };
  const server = new GameServer({ on() {}, to() { return { emit() {} }; } });
  context.after(() => server.stop());
  server.registerSocket(socket);
  socket.data.auth = {
    accountId: "allowed-account",
    displayName: "Allowed",
    guest: false,
    appearance: {}
  };
  let checks = 0;
  server.requireAccountAccess = async () => {
    checks += 1;
    if (checks > 1) throw new Error("transient duplicate lookup");
  };

  const response = await new Promise((resolve) => {
    handlers.get("createRoom")({ mode: "private" }, resolve);
  });
  assert.equal(response.ok, true);
  assert.equal(checks, 1);
  assert.equal(server.rooms.size, 1);
});
