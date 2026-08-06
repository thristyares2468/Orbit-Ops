import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOrthogonalCorridors,
  buildRoutedCorridors,
  mapShapePolygon,
  pointInMapShape,
  validateMapDefinition,
  visibleMapLayers
} from "../public/src/mapSchema.js";
import {
  LOBBY_MAP_ID,
  MAP_DEFINITIONS,
  MAP_IDS,
  getMapDefinition,
  isWalkable,
  stationById
} from "../public/src/shipData.js";
import { PHASER_ASSETS, worldDetailScale, worldMetrics } from "../public/src/game2d/assets.js";

test("The Skeld is the only selectable match map and has valid authoritative geometry", () => {
  assert.deepEqual(MAP_IDS, ["the-skeld"]);
  assert.deepEqual(Object.keys(MAP_DEFINITIONS), ["the-skeld"]);
  const map = getMapDefinition("the-skeld");
  assert.deepEqual(validateMapDefinition(map), { valid: true, errors: [] });
  assert.equal(map.corridors.length, 16, "the traced deck reuses physical junctions instead of drawing one corridor per graph edge");
  assert.ok(map.corridors.every((corridor) => ["x", "z"].includes(corridor.axis)));
  assert.ok(map.connections.every(([from, to]) => map.corridorRoutes.some((route) =>
    (route.from === from && route.to === to) || (route.from === to && route.to === from)
  )));
  assert.ok(map.spawnPoints.every(([x, z]) => isWalkable(map.id, x, z, 0)));
  assert.ok(stationById(map.id, "meeting-console"), "the emergency button remains available");
  assert.equal(map.objectGroups.find((group) => group.id === "collisions")?.objects, map.collisionRects);
  assert.deepEqual(visibleMapLayers(map).map((layer) => layer.id), [
    "backgrounds", "zones", "corridors", "rooms", "props", "stations"
  ]);
  assert.ok(map.taskDefinitions.every((definition) => map.rooms.some((room) => room.id === definition.roomId)));
  assert.ok(map.sabotageDefinitions.every((sabotage) =>
    sabotage.repairStations.every((id) => stationById(map.id, id)?.refId === sabotage.id)
  ));
});

test("removed map ids fall back to The Skeld and their assets are not preloaded", () => {
  assert.equal(getMapDefinition("mira-hq").id, "the-skeld");
  assert.equal(getMapDefinition("polus").id, "the-skeld");
  assert.ok(Object.keys(PHASER_ASSETS).every((key) => !key.startsWith("mira-") && !key.startsWith("polus-")));
});

test("the dropship lobby is a valid map that is never selectable as a match map", () => {
  const lobby = getMapDefinition(LOBBY_MAP_ID);
  assert.equal(lobby.id, "lobby-dropship");
  assert.ok(!MAP_IDS.includes(LOBBY_MAP_ID), "the lobby must not appear in the map selector");
  assert.equal(Object.keys(MAP_DEFINITIONS).length, 1);
  assert.deepEqual(validateMapDefinition(lobby), { valid: true, errors: [] }, lobby.name);
  assert.deepEqual(visibleMapLayers(lobby).map((layer) => layer.id), [
    "backgrounds", "zones", "corridors", "rooms", "decals", "props", "stations"
  ]);
  assert.ok(lobby.decals.length > 0, "the lobby is drawn from the supplied dropship artwork");
  assert.equal(lobby.taskDefinitions.length, 0);
  assert.equal(lobby.sabotageDefinitions.length, 0);
  const launch = stationById(LOBBY_MAP_ID, "lobby-launch");
  assert.equal(launch?.type, "launch");
  assert.equal(launch?.assetKey, "lobbyLaptop");
  assert.ok(lobby.spawnPoints.length >= 16, "every seat in a full room needs a spawn");
  assert.ok(Math.abs(lobby.spawnPoints[0][0]) < 0.01, "the host enters with the cabin centred");
  assert.ok(lobby.spawnPoints.every(([x, z]) => isWalkable(LOBBY_MAP_ID, x, z, 0.55)));
  const hold = lobby.rooms.find(({ id }) => id === "dropship-hold");
  assert.ok(Math.abs(hold.width - hold.depth) < 0.5, "the playable dropship cabin stays nearly square");
  for (const crate of lobby.collisionRects) {
    assert.equal(isWalkable(LOBBY_MAP_ID, crate.x, crate.z), false, crate.id);
  }
  const decalAssets = new Set(lobby.decals.map(({ assetKey }) => assetKey));
  assert.deepEqual(decalAssets, new Set([
    "lobbyDropship",
    "lobbyCargoDoor",
    "lobbyExhaust",
    "lobbyCrate",
    "lobbyEquipmentCase"
  ]));
  assert.equal(lobby.collisionRects.length, 4, "three crates and the equipment case block movement");
  assert.equal(lobby.decals.filter(({ assetKey }) => assetKey === "lobbyExhaust").length, 4,
    "two paired exhaust sprites make four plumes on each engine pod");
});

test("the deck is the only Skeld map art, and nothing unused is preloaded", () => {
  const skeld = getMapDefinition("the-skeld");
  // The baked 3D deck supplies the whole map, so no room carries its own image.
  for (const room of skeld.rooms) {
    assert.equal(room.assetKey, undefined, `${room.id} must not carry per-room art`);
  }
  assert.ok(skeld.render.deck, "the Skeld renders from the baked deck");
  assert.equal(skeld.render.deck.assetKey, "skeld-deck");
  assert.ok(Object.hasOwn(PHASER_ASSETS, "skeld-deck"), "the deck is preloaded");
  // The superseded per-room images must not still be downloaded on every load.
  const stale = Object.keys(PHASER_ASSETS)
    .filter((key) => key.startsWith("skeld-") && key !== "skeld-deck");
  assert.deepEqual(stale, [], `superseded room art still preloaded: ${stale.join(", ")}`);
  for (const mapId of [...MAP_IDS, LOBBY_MAP_ID]) {
    for (const decal of getMapDefinition(mapId).decals) {
      assert.ok(Object.hasOwn(PHASER_ASSETS, decal.assetKey), `${mapId}:${decal.id}:${decal.assetKey}`);
    }
  }
});

test("Skeld room art and interaction positions match the supplied deck reference", () => {
  const skeld = getMapDefinition("the-skeld");
  const rooms = new Map(skeld.rooms.map((room) => [room.id, room]));
  // Room rectangles still anchor labels, collision props and room detection even
  // though the deck now draws them.
  for (const roomId of [
    "upper-engine", "lower-engine", "reactor", "security", "medbay", "electrical",
    "storage", "communications", "admin", "shields", "weapons", "navigation"
  ]) {
    assert.ok(rooms.get(roomId), `${roomId} is still an authored room`);
  }
  assert.deepEqual(rooms.get("cafeteria").referenceRect, { left: 539, top: 2, right: 826, bottom: 294 });
  assert.deepEqual(rooms.get("reactor").referenceRect, { left: 69, top: 190, right: 219, bottom: 392 });
  assert.deepEqual(rooms.get("storage").referenceRect, { left: 559, top: 394, right: 727, bottom: 620 });
  assert.deepEqual(rooms.get("navigation").referenceRect, { left: 1090, top: 224, right: 1200, bottom: 356 });
  assert.ok(rooms.get("upper-engine").depth > rooms.get("upper-engine").width);
  assert.ok(rooms.get("lower-engine").depth > rooms.get("lower-engine").width);
  assert.ok(rooms.get("medbay").depth > rooms.get("medbay").width);
  assert.ok(rooms.get("navigation").depth > rooms.get("navigation").width);
  const o2Panel = stationById("the-skeld", "skeld-o2-panel");
  const shieldsVent = stationById("the-skeld", "skeld-vent-shields");
  assert.ok(o2Panel.z < rooms.get("o2").z, "the O2 sabotage panel sits at the top of O2");
  assert.ok(shieldsVent.z > rooms.get("shields").z, "the Shields vent sits at the bottom of Shields");

  // Task consoles are no longer frozen to traced pixels: they are snapped onto the
  // floor derived from the 3D model, so what matters is that each one can be reached.
  const reachable = (x, z) => {
    for (let radius = 0.3; radius <= 2.8; radius += 0.15) {
      for (let step = 0; step < 24; step += 1) {
        const angle = step / 24 * Math.PI * 2;
        if (isWalkable("the-skeld", x + Math.cos(angle) * radius, z + Math.sin(angle) * radius, 0.55)) return true;
      }
    }
    return false;
  };
  for (const definition of skeld.taskDefinitions) {
    assert.ok(reachable(definition.x, definition.z), `${definition.name} console is reachable`);
    assert.ok(skeld.rooms.some((room) => room.id === definition.roomId), `${definition.name} sits in a real room`);
  }
});

test("Skeld physical corridors are the sixteen traced deck sections", () => {
  const skeld = getMapDefinition("the-skeld");
  assert.deepEqual(skeld.corridors.map(({ id, referenceRect }) => [id, referenceRect]), [
    ["port-engine-spine", { left: 210, top: 205, right: 342, bottom: 408 }],
    ["upper-engine-cafeteria-hall", { left: 315, top: 110, right: 560, bottom: 171 }],
    ["medbay-neck", { left: 432, top: 155, right: 550, bottom: 203 }],
    ["lower-engine-electrical-hall", { left: 315, top: 427, right: 454, bottom: 491 }],
    ["lower-engine-storage-bypass", { left: 315, top: 500, right: 568, bottom: 568 }],
    ["electrical-south-neck", { left: 426, top: 478, right: 550, bottom: 532 }],
    ["cafeteria-storage-spine", { left: 642, top: 275, right: 717, bottom: 416 }],
    ["admin-branch", { left: 697, top: 305, right: 780, bottom: 390 }],
    ["storage-shields-hall", { left: 710, top: 440, right: 893, bottom: 503 }],
    ["communications-neck", { left: 779, top: 484, right: 829, bottom: 527 }],
    ["cafeteria-weapons-hall", { left: 811, top: 107, right: 875, bottom: 173 }],
    ["weapons-south-neck", { left: 911, top: 176, right: 981, bottom: 263 }],
    ["o2-navigation-junction", { left: 908, top: 231, right: 1007, bottom: 318 }],
    ["navigation-hall", { left: 978, top: 245, right: 1103, bottom: 316 }],
    ["starboard-spine", { left: 919, top: 291, right: 987, bottom: 455 }],
    ["shields-north-neck", { left: 909, top: 406, right: 992, bottom: 458 }]
  ]);
});

test("Skeld uses clipped room hulls and keeps every interaction reachable", () => {
  const skeld = getMapDefinition("the-skeld");
  const rooms = new Map(skeld.rooms.map((room) => [room.id, room]));
  assert.ok(skeld.rooms.every((room) => room.assetOnly && room.walkablePolygon?.length >= 3),
    "every Skeld room is clipped to its authored artwork instead of a generic rectangle");

  const navigation = rooms.get("navigation");
  assert.ok(Math.abs(navigation.width / navigation.depth - 110 / 132) < 0.01,
    "Navigation preserves the traced reference footprint");
  assert.equal(mapShapePolygon(navigation).length, 10, "Navigation includes its traced west doorway and tapered hull");
  assert.equal(pointInMapShape(55, -3.1, navigation, 0.2), true, "Navigation entrance is open");
  assert.equal(isWalkable("the-skeld", 61, -3.1, 0.2), true, "Navigation centre aisle is clear");
  assert.equal(isWalkable("the-skeld", 63.7, -3.1, 0.2), false, "Navigation console blocks movement");
  assert.equal(isWalkable("the-skeld", 67.5, -3.1, 0.2), false, "Navigation outer hull blocks space");

  const reachableWithinInteractionRange = (station) => {
    for (const radius of [0, 0.7, 1.4, 2.1, 2.7]) {
      for (let index = 0; index < 16; index += 1) {
        const angle = index * Math.PI / 8;
        if (isWalkable(
          "the-skeld",
          station.x + Math.cos(angle) * radius,
          station.z + Math.sin(angle) * radius,
          0.2
        )) return true;
      }
    }
    return false;
  };
  assert.ok(skeld.stations.every(reachableWithinInteractionRange),
    "every task, vent, meeting button, security console, and sabotage panel has a reachable use position");
  assert.ok(skeld.collisionRects.every((collision) => !isWalkable("the-skeld", collision.x, collision.z, 0.2)),
    "every visible room fixture has matching collision");
  assert.ok(skeld.collisionRects.every((collision) => pointInMapShape(
    collision.x,
    collision.z,
    rooms.get(collision.roomId),
    0
  )), "every fixture collision belongs to its authored room");
});

test("the outer ship silhouette is decorative and never becomes walkable floor", () => {
  const skeld = getMapDefinition("the-skeld");
  const hull = skeld.zones.find(({ id }) => id === "skeld-outer-hull");
  assert.equal(hull?.walkable, false);
  assert.equal(hull?.minimap, false);
  assert.ok(hull?.walkablePolygon.length >= 24);
  assert.equal(isWalkable("the-skeld", (400 - 635) / 8.4, (100 - 316) / 8.4), false,
    "empty plating inside the ship silhouette is not playable floor");
});

test("game maps and the lobby never load the visual reference screenshots", () => {
  assert.ok(Object.values(PHASER_ASSETS).every((assetPath) => !assetPath.includes("/assets/maps/reference/")));
  for (const mapId of [...MAP_IDS, LOBBY_MAP_ID]) {
    const map = getMapDefinition(mapId);
    assert.equal("referenceDeck" in map, false, map.name);
    assert.ok(map.rooms.every((room) => !String(room.assetKey ?? "").includes("reference")), map.name);
    assert.ok(map.decals.every((decal) => !String(decal.assetKey ?? "").includes("reference")), map.name);
  }
});

test("the canonical Skeld room set is complete and no other map room leaks in", () => {
  const roomIds = new Set(getMapDefinition("the-skeld").rooms.map((room) => room.id));
  assert.deepEqual(roomIds, new Set([
    "cafeteria", "upper-engine", "reactor", "security", "medbay", "lower-engine", "electrical",
    "storage", "communications", "admin", "o2", "weapons", "navigation", "shields"
  ]));
});

test("the room silhouette follows the supplied port-to-starboard and north-to-south layout", () => {
  const room = (roomId) => getMapDefinition("the-skeld").rooms.find(({ id }) => id === roomId);
  assert.ok(room("cafeteria").z < room("storage").z);
  assert.ok(room("reactor").x < room("security").x);
  assert.ok(room("security").x < room("medbay").x);
  assert.ok(room("o2").x < room("navigation").x);
  assert.ok(room("upper-engine").z < room("lower-engine").z);
  assert.ok(room("admin").z < room("communications").z);
});

test("world rendering details and padding use the single Skeld scale", () => {
  const map = getMapDefinition("the-skeld");
  const metrics = worldMetrics(map);
  assert.equal(metrics.scale, 40);
  assert.equal(metrics.padding, 260);
  assert.equal(worldDetailScale(map), 40 / 46);
  assert.equal(metrics.width, (map.bounds.maxX - map.bounds.minX) * 40 + 520);
  assert.equal(metrics.height, (map.bounds.maxZ - map.bounds.minZ) * 40 + 520);
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

test("the map validator rejects malformed authored room hulls", () => {
  const validation = validateMapDefinition({
    id: "broken-polygon",
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    rooms: [{
      id: "alpha", x: 0, z: 0, width: 8, depth: 8,
      walkablePolygon: [{ x: -4, z: -4 }, { x: 4, z: -4 }]
    }],
    connections: [], corridors: [], stations: [], spawnPoints: [[0, 0]]
  });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /invalid walkable polygon/u);
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
