import assert from "node:assert/strict";
import test from "node:test";
import {
  CREW_ROLE_IDS, NEUTRAL_ROLE_IDS, OPERATIVE_ROLE_IDS, PRACTICE_ROLE_IDS,
  ROLE_DEFINITIONS, getRoleDefinition, roleIdsForFaction
} from "../public/src/roleData.js";
import { TARGETING, WIN_KINDS, defineRole } from "../public/src/roles/defineRole.js";

test("every declared role is well formed", () => {
  for (const role of Object.values(ROLE_DEFINITIONS)) {
    assert.ok(role.name, `${role.id} needs a name`);
    assert.ok(role.objective, `${role.id} needs an objective`);
    assert.ok(["crew", "operative", "neutral"].includes(role.faction), `${role.id} faction`);
    assert.ok(Object.values(WIN_KINDS).includes(role.win.kind), `${role.id} win kind`);
    if (!role.ability) continue;
    assert.ok(role.ability.label, `${role.id} ability needs a label`);
    assert.ok(Object.values(TARGETING).includes(role.ability.targeting), `${role.id} targeting`);
    assert.equal(typeof role.ability.perform, "function", `${role.id} needs a perform`);
    assert.ok(role.ability.cooldownMs >= 0, `${role.id} cooldown`);
    assert.ok(role.ability.uses === null || role.ability.uses > 0, `${role.id} uses`);
  }
});

test("faction lists partition the registry exactly once", () => {
  const listed = [...CREW_ROLE_IDS, ...OPERATIVE_ROLE_IDS, ...NEUTRAL_ROLE_IDS];
  assert.equal(listed.length, Object.keys(ROLE_DEFINITIONS).length);
  assert.equal(new Set(listed).size, listed.length, "no role may appear twice");
  for (const id of CREW_ROLE_IDS) assert.equal(ROLE_DEFINITIONS[id].faction, "crew");
  for (const id of OPERATIVE_ROLE_IDS) assert.equal(ROLE_DEFINITIONS[id].faction, "operative");
  for (const id of NEUTRAL_ROLE_IDS) assert.equal(ROLE_DEFINITIONS[id].faction, "neutral");
  assert.deepEqual(roleIdsForFaction("operative"), OPERATIVE_ROLE_IDS);
  assert.equal(PRACTICE_ROLE_IDS.length, listed.length);
});

test("no shipped role was lost migrating to the registry", () => {
  for (const id of [
    "operations-crew", "engineer", "medic", "sheriff", "tracker",
    "signal-operative", "morphling", "swooper", "janitor",
    "jester", "survivor", "guardian-angel"
  ]) {
    assert.ok(ROLE_DEFINITIONS[id], `${id} must survive the migration`);
  }
});

test("an unknown role falls back to base crew", () => {
  assert.equal(getRoleDefinition("nonsense").id, "operations-crew");
  assert.equal(getRoleDefinition(undefined).id, "operations-crew");
});

test("solo win kinds belong only to neutral roles", () => {
  for (const role of Object.values(ROLE_DEFINITIONS)) {
    if (role.win.kind === WIN_KINDS.WITH_FACTION) continue;
    assert.equal(role.faction, "neutral", `${role.id} wins alone but is not neutral`);
  }
  assert.equal(ROLE_DEFINITIONS.jester.win.kind, WIN_KINDS.VOTED_OUT);
  assert.equal(ROLE_DEFINITIONS.executioner.win.kind, WIN_KINDS.TARGET_VOTED_OUT);
  assert.equal(ROLE_DEFINITIONS.survivor.win.kind, WIN_KINDS.SURVIVE);
});

test("defineRole rejects a malformed role", () => {
  assert.throws(() => defineRole({ name: "No Id", faction: "crew" }), /needs an id/u);
  assert.throws(() => defineRole({ id: "x", faction: "wrong" }), /unknown faction/u);
});

test("role-declared state is exposed for the server to seed", () => {
  assert.equal(ROLE_DEFINITIONS.mayor.state.voteWeight, 2);
  assert.equal(ROLE_DEFINITIONS.executioner.state.executionerTargetId, null);
  assert.ok("markX" in ROLE_DEFINITIONS.escapist.state);
});
