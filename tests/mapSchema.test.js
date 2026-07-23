import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOrthogonalCorridors,
  pointInCollisionRect,
  validateMapDefinition,
  visibleMapLayers
} from "../public/src/mapSchema.js";
import {
  MAP_DEFINITIONS,
  MAP_IDS,
  getMapDefinition,
  isWalkable,
  stationById
} from "../public/src/shipData.js";

test("all four maps have isolated, valid server geometry and interactions", () => {
  assert.deepEqual(MAP_IDS, ["the-skeld", "mira-hq", "polus", "the-airship"]);
  assert.equal(new Set(Object.values(MAP_DEFINITIONS).map((map) => map.rooms)).size, 4);
  for (const mapId of MAP_IDS) {
    const map = getMapDefinition(mapId);
    assert.deepEqual(validateMapDefinition(map), { valid: true, errors: [] }, map.name);
    assert.equal(map.corridors.length, map.connections.length * 2, map.name);
    assert.ok(map.spawnPoints.every(([x, z]) => isWalkable(mapId, x, z, 0)), map.name);
    assert.ok(stationById(mapId, "meeting-console"), `${map.name} emergency button`);
    assert.equal(map.objectGroups.find((group) => group.id === "collisions")?.objects, map.collisionRects);
    assert.deepEqual(visibleMapLayers(map).map((layer) => layer.id), [
      "backgrounds", "corridors", "rooms", "stations"
    ]);
    assert.ok(map.taskDefinitions.every((task) => map.rooms.some((room) => room.id === task.roomId)));
    assert.ok(map.sabotageDefinitions.every((sabotage) =>
      sabotage.repairStations.every((id) => stationById(mapId, id)?.refId === sabotage.id)
    ));
    for (const collision of map.collisionRects) {
      assert.equal(isWalkable(mapId, collision.x, collision.z), false);
      assert.equal(pointInCollisionRect(collision.x, collision.z, collision, 0.55), true);
    }
  }
});

test("room artwork never crosses map asset namespaces", () => {
  for (const mapId of ["the-skeld", "mira-hq", "polus"]) {
    const prefix = mapId === "the-skeld" ? "skeld-" : mapId === "mira-hq" ? "mira-" : "polus-";
    assert.ok(getMapDefinition(mapId).rooms.every((room) => !room.assetKey || room.assetKey.startsWith(prefix)), mapId);
  }
  assert.ok(getMapDefinition("the-airship").rooms.every((room) => !room.assetKey), "Airship uses its own procedural deck treatment");
});

test("canonical room sets are kept on their original maps", () => {
  const roomIds = (mapId) => new Set(getMapDefinition(mapId).rooms.map((room) => room.id));
  assert.ok(["cafeteria", "upper-engine", "reactor", "navigation"].every((id) => roomIds("the-skeld").has(id)));
  assert.ok(["launchpad", "greenhouse", "balcony", "decontamination"].every((id) => roomIds("mira-hq").has(id)));
  assert.ok(["dropship", "boiler-room", "specimen-room", "laboratory"].every((id) => roomIds("polus").has(id)));
  assert.ok(["cockpit", "vault", "gap-room", "meeting-room", "cargo-bay"].every((id) => roomIds("the-airship").has(id)));
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
