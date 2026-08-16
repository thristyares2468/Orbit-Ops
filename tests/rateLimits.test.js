import assert from "node:assert/strict";
import test from "node:test";
import { RateLimiter } from "../server/rateLimits.js";

test("rate-limit windows include their limit and reset exactly at the boundary", () => {
  const realNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  try {
    const limiter = new RateLimiter();
    assert.equal(limiter.allow("login:203.0.113.4", 2, 1_000), true);
    assert.equal(limiter.allow("login:203.0.113.4", 2, 1_000), true);
    assert.equal(limiter.allow("login:203.0.113.4", 2, 1_000), false);

    now = 10_999;
    assert.equal(limiter.allow("login:203.0.113.4", 2, 1_000), false);
    now = 11_000;
    assert.equal(limiter.allow("login:203.0.113.4", 2, 1_000), true);
    assert.equal(limiter.entries.get("login:203.0.113.4").count, 1);
  } finally {
    Date.now = realNow;
  }
});

test("cleanup removes entries at their exact expiry and keeps future entries", () => {
  const realNow = Date.now;
  Date.now = () => 600_000;
  try {
    const limiter = new RateLimiter();
    limiter.entries.set("expired", { expiresAt: 599_999, count: 1 });
    limiter.entries.set("boundary", { expiresAt: 600_000, count: 1 });
    limiter.entries.set("recent", { expiresAt: 601_000, count: 1 });
    limiter.cleanup();
    assert.deepEqual([...limiter.entries.keys()], ["recent"]);
  } finally {
    Date.now = realNow;
  }
});

test("failed-account counters can be checked and reset independently", () => {
  const realNow = Date.now;
  let now = 50_000;
  Date.now = () => now;
  try {
    const limiter = new RateLimiter();
    assert.equal(limiter.recordFailure("account:captain@example.com", 2_000), 1);
    assert.equal(limiter.recordFailure("account:captain@example.com", 2_000), 2);
    assert.equal(limiter.isBlocked("account:captain@example.com", 2), true);
    limiter.reset("account:captain@example.com");
    assert.equal(limiter.isBlocked("account:captain@example.com", 2), false);

    limiter.recordFailure("account:captain@example.com", 2_000);
    now = 52_000;
    assert.equal(limiter.isBlocked("account:captain@example.com", 2), false,
      "the account budget reopens at the exact expiry");
  } finally {
    Date.now = realNow;
  }
});
