import assert from "node:assert/strict";
import { test } from "node:test";
import { closedDoorBarriers, doorStepAllowed } from "../public/src/doorPhysics.js";
import { THE_SKELD } from "../public/src/maps/theSkeld.js";
import { isWalkable } from "../public/src/shipData.js";
import { PHASES } from "../server/constants.js";
import { GameServer } from "../server/gameServer.js";

class RecordingIo {
  constructor() {
    this.events = [];
  }
  on() {}
  to(target) {
    return { emit: (event, payload) => this.events.push({ target, event, payload }) };
  }
}

function reachableCellsWithDoors(group, closedDoorIds = group.doors.map(({ id }) => id)) {
  const map = THE_SKELD;
  const step = map.walkGrid.cell;
  const key = (column, row) => `${column}:${row}`;
  const world = (column, row) => ({
    x: map.walkGrid.originX + column * step,
    z: map.walkGrid.originZ + row * step
  });
  const nearestCell = (point) => {
    const baseColumn = Math.round((point.x - map.walkGrid.originX) / step);
    const baseRow = Math.round((point.z - map.walkGrid.originZ) / step);
    for (let radius = 0; radius <= 4; radius += 1) {
      for (let columnOffset = -radius; columnOffset <= radius; columnOffset += 1) {
        for (let rowOffset = -radius; rowOffset <= radius; rowOffset += 1) {
          const column = baseColumn + columnOffset;
          const row = baseRow + rowOffset;
          if (column < 0 || row < 0 || column >= map.walkGrid.cols || row >= map.walkGrid.rows) continue;
          if (isWalkable(map.id, world(column, row).x, world(column, row).z, 0.55)) return { column, row };
        }
      }
    }
    return null;
  };
  const baseRoom = map.rooms.find(({ id }) => id === (group.id === "cafeteria" ? "storage" : "cafeteria"));
  const start = nearestCell(baseRoom.navigationAnchor);
  assert.ok(start, `${baseRoom.id} has a walkable flood-fill anchor`);
  const sabotage = { closedDoorIds };
  const queue = [start];
  const seen = new Set([key(start.column, start.row)]);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const from = world(current.column, current.row);
    for (const [columnOffset, rowOffset] of directions) {
      const column = current.column + columnOffset;
      const row = current.row + rowOffset;
      const cellKey = key(column, row);
      if (column < 0 || row < 0 || column >= map.walkGrid.cols || row >= map.walkGrid.rows || seen.has(cellKey)) continue;
      const to = world(column, row);
      if (!isWalkable(map.id, to.x, to.z, 0.55) || !doorStepAllowed(map, sabotage, from, to, 0.55)) continue;
      if (columnOffset && rowOffset) {
        const horizontal = world(column, current.row);
        const vertical = world(current.column, row);
        if (!isWalkable(map.id, horizontal.x, horizontal.z, 0.55)
          || !isWalkable(map.id, vertical.x, vertical.z, 0.55)) continue;
      }
      seen.add(cellKey);
      queue.push({ column, row });
    }
  }

  return (point) => {
    const cell = nearestCell(point);
    return Boolean(cell && seen.has(key(cell.column, cell.row)));
  };
}

test("The Skeld exposes one timed door-lockdown target for each authored room group", () => {
  const sabotage = THE_SKELD.sabotageDefinitions.find(({ repairKind }) => repairKind === "doors");
  assert.ok(sabotage);
  assert.equal(sabotage.critical, false);
  assert.equal(sabotage.durationMs, 10_000);
  assert.deepEqual(sabotage.repairStations, []);
  assert.deepEqual(
    sabotage.doorTargets.map(({ id }) => id),
    THE_SKELD.doorGroups.map(({ id }) => id)
  );
  assert.ok(THE_SKELD.doorGroups.every((group) => group.doors.length > 0));
});

test("every authored lockdown isolates its room without cutting off the rest of the deck", () => {
  const openReachable = reachableCellsWithDoors({ id: "cafeteria", doors: [] }, []);
  for (const room of THE_SKELD.rooms) {
    assert.equal(openReachable(room.navigationAnchor), true, `${room.name} is reachable before a lockdown`);
  }
  for (const group of THE_SKELD.doorGroups) {
    const reachable = reachableCellsWithDoors(group);
    for (const room of THE_SKELD.rooms) {
      assert.equal(
        reachable(room.navigationAnchor),
        room.id !== group.roomId,
        `${group.name} lockdown ${room.id === group.roomId ? "seals its room" : `keeps ${room.name} connected`}`
      );
    }
  }
});

test("closed doors block crossing movement without turning the whole corridor solid", () => {
  const map = {
    doorGroups: [{
      id: "test-room",
      doors: [{ id: "test-door", x: 0, z: 0, width: 0.4, depth: 4 }]
    }]
  };
  const sabotage = { closedDoorIds: ["test-door", "missing-door"] };

  assert.deepEqual(closedDoorBarriers(map, sabotage).map(({ id }) => id), ["test-door"]);
  assert.equal(doorStepAllowed(map, sabotage, { x: -2, z: 0 }, { x: 2, z: 0 }, 0), false);
  assert.equal(doorStepAllowed(map, sabotage, { x: -2, z: 3 }, { x: 2, z: 3 }, 0), true);
  assert.equal(doorStepAllowed(map, { closedDoorIds: [] }, { x: -2, z: 0 }, { x: 2, z: 0 }, 0), true);
});

test("a shutter closing over a player does not trap them inside its collision rectangle", () => {
  const map = {
    doorGroups: [{
      id: "test-room",
      doors: [{ id: "test-door", x: 0, z: 0, width: 1, depth: 4 }]
    }]
  };
  const sabotage = { closedDoorIds: ["test-door"] };

  assert.equal(doorStepAllowed(map, sabotage, { x: 0, z: 0 }, { x: -1, z: 0 }, 0), true);
});

test("the authoritative room publishes a chosen lockdown and clears it on expiry", (context) => {
  const io = new RecordingIo();
  const server = new GameServer(io);
  context.after(() => server.stop());
  const room = server.createRoom("practice", {});
  room.phase = PHASES.ACTIVE;
  const [x, z] = THE_SKELD.spawnPoints[0];
  const operative = server.makePlayer({
    id: "door-operative",
    socketId: null,
    displayName: "Door Operative",
    appearance: {},
    x,
    z,
    mapId: room.mapId,
    bot: true
  });
  operative.faction = "operative";
  room.players.set(operative.id, operative);

  const result = server.startSabotage(
    room,
    operative,
    "skeld-door-lockdown",
    "cafeteria"
  );
  const expectedIds = THE_SKELD.doorGroups.find(({ id }) => id === "cafeteria").doors.map(({ id }) => id);
  assert.equal(result.sabotage.doorTargetId, "cafeteria");
  assert.deepEqual(result.sabotage.closedDoorIds, expectedIds);
  assert.deepEqual([...room.closedDoorIds], expectedIds);

  room.activeSabotage.endsAt = Date.now() - 1;
  server.tick();

  assert.equal(room.activeSabotage, null);
  assert.equal(room.closedDoorIds.size, 0);
  assert.ok(io.events.some(({ event, payload }) => event === "sabotageEnded" && payload.expired));
});
