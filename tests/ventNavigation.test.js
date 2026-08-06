import assert from "node:assert/strict";
import test from "node:test";
import { getMapDefinition } from "../public/src/shipData.js";
import { VENT_DIRECTION_KEYS, pickVentExit } from "../public/src/ventNavigation.js";

test("pickVentExit chooses the exit aligned with the pressed direction", () => {
  const exits = [{ id: "east", x: 10, z: 0 }, { id: "south", x: 0, z: 10 }];
  assert.equal(pickVentExit({ x: 0, z: 0 }, exits, { x: 1, z: 0 })?.id, "east", "D presses east");
  assert.equal(pickVentExit({ x: 0, z: 0 }, exits, { x: 0, z: 1 })?.id, "south", "S presses south");
  assert.equal(pickVentExit({ x: 0, z: 0 }, exits, { x: 0, z: -1 }), null, "W matches neither exit");
  assert.equal(pickVentExit({ x: 0, z: 0 }, exits, { x: -1, z: 0 }), null, "A matches neither exit");
});

test("pickVentExit picks the closer alignment when two exits both lean the same way", () => {
  // One exit almost due east, one exit north-east: pressing D should prefer the
  // more directly-east one rather than whichever happens to be listed first.
  const exits = [{ id: "diagonal", x: 6, z: -6 }, { id: "straight", x: 10, z: -1 }];
  assert.equal(pickVentExit({ x: 0, z: 0 }, exits, { x: 1, z: 0 })?.id, "straight");
});

test("pickVentExit degrades safely on missing or empty input", () => {
  assert.equal(pickVentExit(null, [{ id: "x", x: 1, z: 0 }], { x: 1, z: 0 }), null);
  assert.equal(pickVentExit({ x: 0, z: 0 }, [], { x: 1, z: 0 }), null);
  assert.equal(pickVentExit({ x: 0, z: 0 }, [{ id: "x", x: 1, z: 0 }], null), null);
  assert.equal(pickVentExit({ x: 0, z: 0 }, [{ id: "x", x: 1, z: 0 }], { x: 0, z: 0 }), null,
    "a zero-length direction (no key pressed) must not resolve to an exit");
  // An exit sitting exactly on the current vent (malformed data) must not divide by zero.
  assert.equal(pickVentExit({ x: 5, z: 5 }, [{ id: "same-spot", x: 5, z: 5 }], { x: 1, z: 0 }), null);
});

test("VENT_DIRECTION_KEYS matches InputController.movement()'s WASD convention", () => {
  const byCode = Object.fromEntries(VENT_DIRECTION_KEYS.map((k) => [k.code, k]));
  assert.deepEqual(byCode.KeyW, { code: "KeyW", x: 0, z: -1 });
  assert.deepEqual(byCode.KeyS, { code: "KeyS", x: 0, z: 1 });
  assert.deepEqual(byCode.KeyA, { code: "KeyA", x: -1, z: 0 });
  assert.deepEqual(byCode.KeyD, { code: "KeyD", x: 1, z: 0 });
});

test("every vent on the Skeld has at least one WASD direction that reaches an exit", () => {
  // Confirms the real vent layout is actually navigable by direction, not just by
  // the always-available Alt-cycle fallback.
  const map = getMapDefinition("the-skeld");
  const vents = map.stations.filter((station) => station.type === "maintenance");
  assert.ok(vents.length > 0);
  for (const vent of vents) {
    const network = vents.filter((other) => other.refId === vent.refId && other.id !== vent.id);
    if (!network.length) continue;
    const reachable = VENT_DIRECTION_KEYS.some(({ x, z }) => pickVentExit(vent, network, { x, z }) !== null);
    assert.ok(reachable, `${vent.id} has no WASD direction that reaches any of its exits`);
  }
});
