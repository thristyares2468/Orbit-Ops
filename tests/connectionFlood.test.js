import assert from "node:assert/strict";
import test from "node:test";
import { ConnectionFloodGuard, subnetOf } from "../server/connectionFlood.js";

test("addresses are grouped into the block they are rented in", () => {
  assert.equal(subnetOf("203.0.113.44"), "203.0.113.0/24");
  assert.equal(subnetOf("203.0.113.1"), subnetOf("203.0.113.250"));
  assert.notEqual(subnetOf("203.0.113.1"), subnetOf("203.0.114.1"));
  // Node reports IPv4 clients as IPv4-mapped IPv6 behind some proxies.
  assert.equal(subnetOf("::ffff:203.0.113.9"), "203.0.113.0/24");
  assert.equal(subnetOf("2001:db8:1:2:3:4:5:6"), "2001:db8:1:2::/64");
  assert.equal(subnetOf(""), "unknown");
  assert.equal(subnetOf(null), "unknown");
});

test("a flood of unauthenticated connections is shed", () => {
  const guard = new ConnectionFloodGuard({ now: () => 0 });
  let admitted = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (guard.admit("203.0.113.5") === null) admitted += 1;
  }
  assert.equal(admitted, 6);
  assert.equal(guard.admit("203.0.113.5"), "pending-address");
});

test("a refused connection is not counted against the limit", () => {
  const guard = new ConnectionFloodGuard({ now: () => 0 });
  for (let attempt = 0; attempt < 6; attempt += 1) guard.admit("198.51.100.2");
  const before = guard.addresses.get("198.51.100.2").total;
  guard.admit("198.51.100.2");
  guard.admit("198.51.100.2");
  assert.equal(guard.addresses.get("198.51.100.2").total, before);
});

test("signing in frees the pending slot it was holding", () => {
  const guard = new ConnectionFloodGuard({ now: () => 0 });
  for (let attempt = 0; attempt < 6; attempt += 1) guard.admit("198.51.100.7");
  assert.ok(guard.admit("198.51.100.7"));
  guard.authenticated("198.51.100.7");
  assert.equal(guard.admit("198.51.100.7"), null);
});

test("rotating through a rented range does not dodge the cap", () => {
  const guard = new ConnectionFloodGuard({ now: () => 0 });
  let admitted = 0;
  for (let host = 1; host < 40; host += 1) {
    if (guard.admit(`192.0.2.${host}`) === null) admitted += 1;
  }
  assert.equal(admitted, 24);
  // A genuinely different network is unaffected by that neighbour's behaviour.
  assert.equal(guard.admit("198.18.0.1"), null);
});

test("the burst window caps arrivals and then reopens", () => {
  let clock = 0;
  const guard = new ConnectionFloodGuard({
    now: () => clock,
    maxPendingPerAddress: 1000, maxPerAddress: 1000,
    maxPendingPerSubnet: 5000, maxPerSubnet: 5000
  });
  let admitted = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (guard.admit("203.0.113.99") === null) admitted += 1;
  }
  assert.equal(admitted, 30);
  assert.equal(guard.admit("203.0.113.99"), "burst");
  clock += 10_001;
  assert.equal(guard.admit("203.0.113.99"), null);
});

test("disconnecting returns the slot", () => {
  const guard = new ConnectionFloodGuard({ now: () => 0 });
  for (let attempt = 0; attempt < 6; attempt += 1) guard.admit("203.0.113.31");
  assert.ok(guard.admit("203.0.113.31"));
  guard.released("203.0.113.31");
  assert.equal(guard.admit("203.0.113.31"), null);
});

test("an authenticated connection releases only its total, not a pending slot", () => {
  const guard = new ConnectionFloodGuard({ now: () => 0 });
  guard.admit("203.0.113.41");
  guard.authenticated("203.0.113.41");
  guard.released("203.0.113.41", { wasAuthenticated: true });
  const scope = guard.addresses.get("203.0.113.41");
  // Either the entry was forgotten, or its counters are back to zero - never negative.
  assert.ok(!scope || (scope.pending === 0 && scope.total === 0));
});

test("idle entries are forgotten so the maps do not grow forever", () => {
  let clock = 0;
  const guard = new ConnectionFloodGuard({ now: () => clock });
  guard.admit("203.0.113.77");
  assert.ok(guard.addresses.has("203.0.113.77"));
  guard.released("203.0.113.77");
  clock += 10_001;
  guard.sweep();
  assert.equal(guard.addresses.size, 0);
  assert.equal(guard.subnets.size, 0);
});
