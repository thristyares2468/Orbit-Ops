import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOrthogonalCorridors,
  pointInCollisionRect,
  validateMapDefinition,
  visibleMapLayers
} from "../public/src/mapSchema.js";
import {
  COLLISION_RECTS,
  CONNECTIONS,
  MAP_VALIDATION,
  MERIDIAN_MAP,
  ROOMS,
  isWalkable,
  stationById
} from "../public/src/shipData.js";

test("the shared Meridian map schema drives valid server geometry", () => {
  assert.deepEqual(MAP_VALIDATION, { valid: true, errors: [] });
  assert.equal(MERIDIAN_MAP.rooms, ROOMS);
  assert.equal(MERIDIAN_MAP.corridors.length, CONNECTIONS.length * 2);
  assert.ok(MERIDIAN_MAP.spawnPoints.every(([x, z]) => isWalkable(x, z, 0)));
  assert.equal(stationById("meeting-console")?.roomId, "operations-hub");
  assert.equal(MERIDIAN_MAP.objectGroups.find((group) => group.id === "collisions")?.objects, COLLISION_RECTS);
  assert.deepEqual(visibleMapLayers(MERIDIAN_MAP).map((layer) => layer.id), [
    "backgrounds", "corridors", "rooms", "stations"
  ]);
  assert.equal(isWalkable(0, 0), false);
  assert.equal(pointInCollisionRect(0, 0, COLLISION_RECTS[0], 0.55), true);
});

test("the reusable map schema builder generates orthogonal corridor transforms", () => {
  const rooms = [
    { id: "alpha", x: 0, z: 0, width: 8, depth: 8 },
    { id: "beta", x: 12, z: 10, width: 8, depth: 8 }
  ];
  const corridors = buildOrthogonalCorridors(rooms, [["alpha", "beta"]], 4);
  assert.deepEqual(corridors.map(({ id, axis, x, z, width, depth }) => ({ id, axis, x, z, width, depth })), [
    { id: "alpha:beta:x", axis: "x", x: 6, z: 0, width: 16, depth: 4 },
    { id: "alpha:beta:z", axis: "z", x: 12, z: 5, width: 4, depth: 14 }
  ]);
});

test("the map validator rejects broken station references", () => {
  const validation = validateMapDefinition({
    id: "broken",
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    rooms: [{ id: "alpha", x: 0, z: 0, width: 8, depth: 8 }],
    connections: [],
    corridors: [],
    stations: [{ id: "console", roomId: "missing", x: 0, z: 0 }],
    spawnPoints: [[0, 0]]
  });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /unknown room/u);
});

test("the map validator checks Tiled-style object and render layers", () => {
  const validation = validateMapDefinition({
    id: "broken-layers",
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    rooms: [{ id: "alpha", x: 0, z: 0, width: 8, depth: 8 }],
    connections: [],
    corridors: [],
    collisionRects: [{ id: "crate", roomId: "missing", x: 0, z: 0, width: 2, depth: 2 }],
    objectGroups: [{ id: "collisions", objects: [] }],
    render: { layers: [{ id: "rooms", kind: "rooms", depth: "not-a-number" }] },
    stations: [],
    spawnPoints: [[2, 2]]
  });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /unknown room/u);
  assert.match(validation.errors.join(" "), /requires a kind/u);
  assert.match(validation.errors.join(" "), /finite depth/u);
});
