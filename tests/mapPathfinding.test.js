import assert from "node:assert/strict";
import test from "node:test";
import { GameServer } from "../server/gameServer.js";
import { segmentWalkable } from "../public/src/mapPathfinding.js";
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
