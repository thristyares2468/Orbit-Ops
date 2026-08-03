import assert from "node:assert/strict";
import test from "node:test";
import { pauseCopy, progressLabels, roleAbilityStatus } from "../public/src/hudState.js";

const NOW = 1_000_000;

test("practice never advertises a countable number of role uses", () => {
  const roleState = { usesLeft: 1, cooldownEndsAt: 0, activeUntil: 0 };
  const practice = roleAbilityStatus({ mode: "practice", roleState, now: NOW });
  assert.equal(practice.label, "∞ practice");
  assert.equal(practice.ariaLabel, "Unlimited uses in practice");
  assert.equal(practice.disabled, false);

  const online = roleAbilityStatus({ mode: "private", roleState, now: NOW });
  assert.equal(online.label, "1 use");
  assert.equal(online.ariaLabel, null);
  assert.equal(online.disabled, false);
});

test("finite uses still run out online but never in practice", () => {
  const spent = { usesLeft: 0, cooldownEndsAt: 0, activeUntil: 0 };
  assert.equal(roleAbilityStatus({ mode: "public", roleState: spent, now: NOW }).disabled, true);
  assert.equal(roleAbilityStatus({ mode: "practice", roleState: spent, now: NOW }).disabled, false);
  assert.equal(roleAbilityStatus({ mode: "practice", roleState: spent, now: NOW }).label, "∞ practice");
});

test("cooldown and active feedback stay truthful in practice", () => {
  const cooling = { usesLeft: 1, cooldownEndsAt: NOW + 8_000, activeUntil: 0 };
  const cooled = roleAbilityStatus({ mode: "practice", roleState: cooling, now: NOW });
  assert.equal(cooled.label, "8s");
  assert.equal(cooled.disabled, true, "a real cooldown still disables the button in practice");

  const running = { usesLeft: 1, cooldownEndsAt: 0, activeUntil: NOW + 5_000 };
  assert.equal(roleAbilityStatus({ mode: "practice", roleState: running, now: NOW }).label, "ACTIVE 5s");
});

test("roles without finite uses read as Ready in both modes", () => {
  const unlimited = { usesLeft: null, cooldownEndsAt: 0, activeUntil: 0 };
  assert.equal(roleAbilityStatus({ mode: "practice", roleState: unlimited, now: NOW }).label, "Ready");
  assert.equal(roleAbilityStatus({ mode: "private", roleState: unlimited, now: NOW }).label, "Ready");
});

test("the system menu never claims the match is paused", () => {
  for (const mode of ["private", "public", "practice"]) {
    const copy = pauseCopy(mode);
    assert.match(copy.eyebrow, /^SYSTEM MENU/u, mode);
    assert.doesNotMatch(copy.eyebrow, /PAUSED/iu, mode);
    assert.match(copy.note, /continue|keep running|keep ticking/iu, mode);
  }
  assert.match(pauseCopy("practice").eyebrow, /SIMULATION CONTINUES/u);
  assert.match(pauseCopy("private").eyebrow, /MATCH CONTINUES/u);
});

test("crew progress and personal progress are reported separately", () => {
  const tasks = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const labels = progressLabels({ completed: 7, total: 12 }, tasks, ["a"]);
  assert.equal(labels.crew, "Crew assignments 7 / 12");
  assert.equal(labels.personal, "Your assignments 1 / 3");

  // Bots moving the shared counter must not change the player's own line.
  const later = progressLabels({ completed: 9, total: 12 }, tasks, ["a"]);
  assert.equal(later.personal, labels.personal);
  assert.notEqual(later.crew, labels.crew);
});

test("progress labels degrade safely before a match starts", () => {
  const labels = progressLabels(undefined, [], []);
  assert.equal(labels.crew, "Crew assignments 0 / 0");
  assert.equal(labels.personal, "Your assignments 0 / 0");
});
