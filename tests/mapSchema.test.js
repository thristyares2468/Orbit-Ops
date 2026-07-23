import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOrthogonalCorridors,
  buildRoutedCorridors,
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
import { worldDetailScale, worldMetrics } from "../public/src/game2d/assets.js";

test("all four maps have isolated, valid server geometry and interactions", () => {
  assert.deepEqual(MAP_IDS, ["the-skeld", "mira-hq", "polus", "the-airship"]);
  assert.equal(new Set(Object.values(MAP_DEFINITIONS).map((map) => map.rooms)).size, 4);
  for (const mapId of MAP_IDS) {
    const map = getMapDefinition(mapId);
    assert.deepEqual(validateMapDefinition(map), { valid: true, errors: [] }, map.name);
    assert.ok(map.corridors.length >= map.connections.length, map.name);
    assert.ok(map.corridors.every((corridor) => ["x", "z"].includes(corridor.axis)), map.name);
    assert.ok(map.connections.every(([from, to]) =>
      map.corridorRoutes.some((route) =>
        (route.from === from && route.to === to) || (route.from === to && route.to === from)
      )
    ), `${map.name} routed topology`);
    assert.ok(map.spawnPoints.every(([x, z]) => isWalkable(mapId, x, z, 0)), map.name);
    assert.ok(stationById(mapId, "meeting-console"), `${map.name} emergency button`);
    assert.equal(map.objectGroups.find((group) => group.id === "collisions")?.objects, map.collisionRects);
    assert.deepEqual(visibleMapLayers(map).map((layer) => layer.id), [
      "backgrounds", "zones", "corridors", "rooms", "props", "stations"
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

test("room artwork uses only verified whole-room images or deliberate crops", () => {
  const allowedAssets = new Map([
    ["the-skeld", new Set(["skeld-cafeteria", "skeld-engine", "skeld-medbay", "skeld-weapons", "skeld-navigation"])],
    ["mira-hq", new Set(["mira-launchpad"])],
    ["polus", new Set(["polus-o2", "polus-broadcast", "polus-science", "polus-specimen", "polus-tunnel", "polus-weapons", "polus-storage"])],
    ["the-airship", new Set()]
  ]);
  for (const [mapId, allowed] of allowedAssets) {
    for (const room of getMapDefinition(mapId).rooms) {
      assert.ok(!room.assetKey || allowed.has(room.assetKey), `${mapId}:${room.id}:${room.assetKey}`);
    }
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

test("map silhouettes follow the supplied canonical reference layouts", () => {
  const room = (mapId, roomId) => getMapDefinition(mapId).rooms.find(({ id }) => id === roomId);
  assert.ok(room("the-skeld", "cafeteria").z < room("the-skeld", "storage").z);
  assert.ok(room("the-skeld", "reactor").x < room("the-skeld", "navigation").x);
  assert.ok(room("mira-hq", "greenhouse").z < room("mira-hq", "cafeteria").z);
  assert.ok(room("mira-hq", "launchpad").x < room("mira-hq", "laboratory").x);
  assert.ok(room("polus", "dropship").z < room("polus", "office").z);
  assert.ok(room("polus", "specimen-room").x > room("polus", "office").x);
  assert.ok(getMapDefinition("polus").zones.length >= 4);
  assert.equal(room("the-airship", "vault").shape, "ellipse");
  assert.equal(room("the-airship", "records").shape, "ellipse");
  assert.ok(getMapDefinition("the-airship").bounds.maxX - getMapDefinition("the-airship").bounds.minX > 170);
});

test("world rendering details and padding scale with each map", () => {
  const expectedScales = new Map([
    ["the-skeld", 42],
    ["mira-hq", 41],
    ["polus", 39],
    ["the-airship", 36]
  ]);
  for (const [mapId, expectedScale] of expectedScales) {
    const map = getMapDefinition(mapId);
    const metrics = worldMetrics(map);
    assert.equal(metrics.scale, expectedScale, map.name);
    assert.equal(metrics.padding, expectedScale * 6.5, map.name);
    assert.equal(worldDetailScale(map), expectedScale / 46, map.name);
    assert.equal(metrics.width, (map.bounds.maxX - map.bounds.minX) * expectedScale + metrics.padding * 2, map.name);
    assert.equal(metrics.height, (map.bounds.maxZ - map.bounds.minZ) * expectedScale + metrics.padding * 2, map.name);
  }
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

test("reference routes generate only axis-aligned corridor segments", () => {
  const rooms = [
    { id: "alpha", x: 0, z: 0, width: 8, depth: 8 },
    { id: "beta", x: 20, z: 16, width: 8, depth: 8 }
  ];
  const corridors = buildRoutedCorridors(rooms, [{
    id: "alpha-beta",
    from: "alpha",
    to: "beta",
    via: [{ x: 12, z: 0 }, { x: 12, z: 16 }]
  }], 4);
  assert.equal(corridors.length, 3);
  assert.deepEqual(corridors.map(({ axis }) => axis), ["x", "z", "x"]);
  assert.ok(corridors.every(({ routeId }) => routeId === "alpha-beta"));
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
