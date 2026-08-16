import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { JIMS_ACCESS_COOKIE, createJimsGateway } from "../server/jimsGateway.js";

const ORBIT_ROOT = new URL("..", import.meta.url).pathname;
const VALID_HANDOFF = "abcdefghijklmnopqrstuvwxYZ012345";

function responseRecorder() {
  return {
    headers: new Map(),
    statusCode: null,
    body: null,
    redirectTarget: null,
    setHeader(name, value) {
      this.headers.set(String(name).toLowerCase(), value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
    redirect(code, target) {
      this.statusCode = code;
      this.redirectTarget = target;
      return this;
    }
  };
}

function makeGateway() {
  return createJimsGateway({
    server: new EventEmitter(),
    secret: "handoff-test-secret",
    orbitRoot: ORBIT_ROOT,
    childPort: 65_534
  });
}

test("a valid cross-server handoff admits a player without an existing tips cookie", () => {
  const gateway = makeGateway();
  const response = responseRecorder();

  gateway.middleware({ headers: {}, query: { handoff: VALID_HANDOFF } }, response);

  assert.equal(response.statusCode, 503);
  assert.match(response.headers.get("set-cookie"), new RegExp(`^${JIMS_ACCESS_COOKIE}=`));
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("tips rejects malformed or missing handoffs when there is no access cookie", () => {
  for (const handoff of [undefined, "short", `${VALID_HANDOFF}!`, "a".repeat(129)]) {
    const gateway = makeGateway();
    const response = responseRecorder();

    gateway.middleware({ headers: {}, query: { handoff } }, response);

    assert.equal(response.statusCode, 404);
    assert.equal(response.headers.has("set-cookie"), false);
    assert.equal(response.body, "Not found");
  }
});

test("the launch redirect carries only a shape-valid handoff", () => {
  for (const [handoff, expected] of [
    [VALID_HANDOFF, `/tips/?handoff=${VALID_HANDOFF}`],
    ["invalid handoff", "/tips/"],
    [undefined, "/tips/"]
  ]) {
    const gateway = makeGateway();
    const response = responseRecorder();

    gateway.launch({ query: { handoff } }, response);

    assert.equal(response.statusCode, 302);
    assert.equal(response.redirectTarget, expected);
    assert.match(response.headers.get("set-cookie"), new RegExp(`^${JIMS_ACCESS_COOKIE}=`));
  }
});
