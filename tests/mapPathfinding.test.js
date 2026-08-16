import assert from "node:assert/strict";
import test from "node:test";
import { GameServer } from "../server/gameServer.js";
import { findWalkablePath, segmentWalkable } from "../public/src/mapPathfinding.js";
import { getMapDefinition, isWalkable, stationById } from "../public/src/shipData.js";

class SilentIo {
  on() {}
  emit() {}
  to() { return { emit() {} }; }
}

test("Skeld bot navigation traverses every room in both directions without cutting fixtures", () => {
  const server = new GameServer(new SilentIo());
  server.stop();
  const map = getMapDefinition("the-skeld");
  for (const from of map.rooms) {
    for (const to of map.rooms) {
      if (from.id === to.id) continue;
      const path = server.buildBotPath(map.id, from.id, to.id);
      assert.ok(path.length > 0, `${from.id} -> ${to.id} has a route`);
      assert.ok(path.every(({ x, z }) => isWalkable(map.id, x, z)), `${from.id} -> ${to.id} waypoints`);
      for (let index = 1; index < path.length; index += 1) {
        assert.ok(segmentWalkable(map.id, path[index - 1], path[index], 0.55),
          `${from.id} -> ${to.id} segment ${index} stays clear`);
      }
    }
  }
});

test("critical Skeld repair panels have collision-safe routes from distant rooms", () => {
  const server = new GameServer(new SilentIo());
  server.stop();
  const map = getMapDefinition("the-skeld");
  for (const stationId of ["skeld-reactor-alpha", "skeld-reactor-beta"]) {
    const station = stationById(map.id, stationId);
    for (const roomId of ["cafeteria", "navigation", "storage"]) {
      const room = map.rooms.find(({ id }) => id === roomId);
      const path = server.buildBotPath(map.id, roomId, "reactor", room, station);
      assert.ok(path.length > 0, `${roomId} reaches ${stationId}`);
      assert.ok(path.every(({ x, z }) => isWalkable(map.id, x, z)), `${roomId} -> ${stationId}`);
      assert.ok(Math.hypot(path.at(-1).x - station.x, path.at(-1).z - station.z) <= 2.8,
        `${stationId} ends within repair range`);
    }
  }
});

test("every traced hallway, room anchor and interaction belongs to the same reachable deck", () => {
  const map = getMapDefinition("the-skeld");
  const cafeteria = map.rooms.find(({ id }) => id === "cafeteria").navigationAnchor;
  for (const corridor of map.corridors) {
    assert.equal(isWalkable(map.id, corridor.x, corridor.z), true, `${corridor.id} has player clearance at its centre`);
  }
  for (const room of map.rooms) {
    assert.equal(isWalkable(map.id, room.navigationAnchor.x, room.navigationAnchor.z), true, `${room.id} anchor is clear`);
    assert.ok(findWalkablePath(map.id, cafeteria, room.navigationAnchor).length > 0, `Cafeteria reaches ${room.id}`);
  }
  for (const station of map.stations) {
    let reachable = false;
    for (const radius of [0, 0.4, 0.8, 1.2, 1.6, 2, 2.4, 2.8]) {
      for (let index = 0; index < 32 && !reachable; index += 1) {
        const angle = index * Math.PI / 16;
        const position = {
          x: station.x + Math.cos(angle) * radius,
          z: station.z + Math.sin(angle) * radius
        };
        if (!isWalkable(map.id, position.x, position.z)) continue;
        reachable = findWalkablePath(map.id, cafeteria, position).length > 0;
      }
      if (reachable) break;
    }
    assert.equal(reachable, true, `${station.id} has a reachable use position within 2.8 units`);
  }
});

test("the emergency button has a collision-safe use position at the table rim", () => {
  const map = getMapDefinition("the-skeld");
  const cafeteria = map.rooms.find(({ id }) => id === "cafeteria").navigationAnchor;
  const button = stationById(map.id, "meeting-console");
  const path = findWalkablePath(map.id, cafeteria, button, { step: 0.5 });
  assert.ok(path.length > 0, "the emergency table is reachable from Cafeteria floor");
  assert.ok(Math.hypot(path.at(-1).x - button.x, path.at(-1).z - button.z) <= button.range,
    "the table pedestal leaves the button inside its authored use radius");
});
