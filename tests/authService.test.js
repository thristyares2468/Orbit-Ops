import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DUMMY_PASSWORD_HASH, hashToken, login, logout, profile, register, resume
} from "../server/authService.js";

const ACCOUNT = Object.freeze({
  id: "11111111-1111-4111-8111-111111111111",
  email: "captain@example.com",
  password_hash: "stored-password-hash",
  display_name: "Captain",
  account_status: "active",
  role: "player",
  created_at: new Date("2026-08-14T00:00:00Z"),
  last_login_at: null,
  failed_login_attempts: 0,
  failed_login_window_started_at: null,
  login_locked_until: null
});

function service(overrides = {}) {
  return {
    isDatabaseConfigured: () => true,
    hashPassword: async () => "new-password-hash",
    comparePassword: async () => true,
    createAccount: async () => ({ ...ACCOUNT }),
    createSession: async () => {},
    findAccountBySession: async () => ({ ...ACCOUNT }),
    findAccountForLogin: async () => ({ ...ACCOUNT }),
    getActiveAccountRestrictions: async () => ({ banned: false, muted: false }),
    getProfile: async () => ({ account: { ...ACCOUNT } }),
    recordFailedLogin: async () => {},
    clearFailedLogins: async () => {},
    revokeSession: async () => {},
    touchLastLogin: async () => {},
    randomToken: () => "fixed-session-token",
    now: () => Date.parse("2026-08-14T01:00:00Z"),
    ...overrides
  };
}

test("registration validates, hashes and creates a resumable session", async () => {
  const calls = [];
  const result = await register({
    email: " Captain@Example.com ", displayName: "Captain", password: "correct horse"
  }, service({
    hashPassword: async (password, rounds) => {
      calls.push(["hash", password, rounds]);
      return "new-password-hash";
    },
    createAccount: async (payload) => {
      calls.push(["account", payload]);
      return { ...ACCOUNT };
    },
    createSession: async (payload) => calls.push(["session", payload])
  }));

  assert.deepEqual(calls[0], ["hash", "correct horse", 12]);
  assert.deepEqual(calls[1][1], {
    email: "captain@example.com", displayName: "Captain", passwordHash: "new-password-hash"
  });
  assert.equal(calls[2][1].accountId, ACCOUNT.id);
  assert.equal(calls[2][1].tokenHash, hashToken("fixed-session-token"));
  assert.equal(result.token, "fixed-session-token");
  assert.equal(result.account.displayName, "Captain");
});

test("login uses the dummy hash for misses and records known-account failures", async () => {
  let comparedHash = null;
  await assert.rejects(
    login({ email: ACCOUNT.email, password: "incorrect password" }, service({
      findAccountForLogin: async () => null,
      comparePassword: async (_password, hash) => { comparedHash = hash; return false; }
    })),
    /Email or password is incorrect/u
  );
  assert.equal(comparedHash, DUMMY_PASSWORD_HASH);

  let failedId = null;
  await assert.rejects(
    login({ email: ACCOUNT.email, password: "incorrect password" }, service({
      comparePassword: async () => false,
      recordFailedLogin: async (accountId) => { failedId = accountId; }
    })),
    /Email or password is incorrect/u
  );
  assert.equal(failedId, ACCOUNT.id);
});

test("login enforces persistent lockouts and active bans before issuing a session", async () => {
  await assert.rejects(
    login({ email: ACCOUNT.email, password: "correct horse" }, service({
      findAccountForLogin: async () => ({
        ...ACCOUNT, login_locked_until: new Date("2026-08-14T01:05:00Z")
      })
    })),
    /Too many failed/u
  );
  await assert.rejects(
    login({ email: ACCOUNT.email, password: "correct horse" }, service({
      getActiveAccountRestrictions: async () => ({ banned: true, muted: false })
    })),
    /cannot currently sign in/u
  );
});

test("successful login clears failures, touches the account and creates a session", async () => {
  const calls = [];
  const result = await login({ email: ACCOUNT.email, password: "correct horse" }, service({
    clearFailedLogins: async (id) => calls.push(["clear", id]),
    touchLastLogin: async (id) => calls.push(["touch", id]),
    createSession: async (payload) => calls.push(["session", payload])
  }));
  assert.deepEqual(calls.map(([name]) => name), ["clear", "touch", "session"]);
  assert.equal(result.account.id, ACCOUNT.id);
  assert.equal(result.token, "fixed-session-token");
});

test("session resume, profile and logout use only hashed persisted credentials", async () => {
  const calls = [];
  const dependencies = service({
    findAccountBySession: async (tokenHash) => { calls.push(["resume", tokenHash]); return { ...ACCOUNT }; },
    getProfile: async (accountId) => { calls.push(["profile", accountId]); return { stats: {} }; },
    revokeSession: async (tokenHash) => calls.push(["logout", tokenHash])
  });
  assert.equal((await resume("session-token", dependencies)).account.email, ACCOUNT.email);
  assert.deepEqual(await profile(ACCOUNT.id, dependencies), { stats: {} });
  await logout("session-token", dependencies);
  assert.deepEqual(calls, [
    ["resume", hashToken("session-token")],
    ["profile", ACCOUNT.id],
    ["logout", hashToken("session-token")]
  ]);
});
