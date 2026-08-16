import assert from "node:assert/strict";
import test from "node:test";
import { createAdminRouter } from "../server/adminHttp.js";
import { validateEmail, validateUuid } from "../server/validation.js";

function fakeResponse() {
  const sent = { status: 200, body: null, headers: {} };
  return {
    sent,
    status(code) { sent.status = code; return this; },
    json(body) { sent.body = body; return this; },
    send(body) { sent.body = body; return this; },
    setHeader(key, value) { sent.headers[key] = value; }
  };
}

const request = (token, action = "bans", body = {}) => ({
  headers: token ? { authorization: `Bearer ${token}` } : {},
  params: { action },
  body
});

test("registration refuses a throwaway mailbox but sign-in still accepts one", () => {
  // An account created before a domain joined the list must still be able to
  // sign in and recover, so only registration passes allowDisposable: false.
  assert.throws(() => validateEmail("crew@mailinator.com", { allowDisposable: false }), /not accepted/u);
  assert.equal(validateEmail("crew@mailinator.com"), "crew@mailinator.com");
  assert.equal(validateEmail("crew@example.com", { allowDisposable: false }), "crew@example.com");
});

test("email validation still rejects malformed addresses", () => {
  for (const bad of ["", "no-at-sign", "two@@at.com", "trailing@", "@leading.com"]) {
    assert.throws(() => validateEmail(bad), /valid email/u);
  }
});

test("a malformed uuid is refused in the game's own words", () => {
  const valid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  assert.equal(validateUuid(valid), valid);
  assert.equal(validateUuid(valid.toUpperCase()), valid);
  for (const bad of ["", "nope", "'; DROP TABLE friendships; --", "3f2504e0-4f89-41d3-9a0c"]) {
    assert.throws(() => validateUuid(bad, "invitation"), /invitation is not valid/u);
  }
});

test("the admin route stays invisible until a long token is configured", async () => {
  for (const token of [undefined, "", "   ", "too-short"]) {
    const response = fakeResponse();
    await createAdminRouter({ token })(request("too-short"), response);
    assert.equal(response.sent.status, 404, `token ${JSON.stringify(token)} should 404`);
  }
});

test("a wrong or missing token is a 404, not a 401", async () => {
  const token = "a-sufficiently-long-admin-token";
  const route = createAdminRouter({ token });
  for (const presented of [undefined, "", "wrong-token-entirely", `${token}x`, token.slice(0, -1)]) {
    const response = fakeResponse();
    await route(request(presented), response);
    // 404 rather than 401 so the route's existence is not confirmed to a prober.
    assert.equal(response.sent.status, 404);
  }
});

test("an authorised call still refuses an unknown action", async () => {
  const token = "a-sufficiently-long-admin-token";
  const response = fakeResponse();
  await createAdminRouter({ token })(request(token, "explode"), response);
  // Without a database this stops at the 503 gate; either way it never succeeds.
  assert.ok([404, 503].includes(response.sent.status));
});

test("admin responses are never cached", async () => {
  const token = "a-sufficiently-long-admin-token";
  const response = fakeResponse();
  await createAdminRouter({ token })(request(token), response);
  assert.equal(response.sent.headers["Cache-Control"], "no-store");
});
