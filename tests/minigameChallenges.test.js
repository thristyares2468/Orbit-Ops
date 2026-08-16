import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getMapDefinition, stationById } from "../public/src/shipData.js";
import { MINIGAMES } from "../public/src/tasks/minigames.js";
import { PHASES } from "../server/constants.js";
import { GameServer } from "../server/gameServer.js";

class SilentIo {
  on() {}
  to() { return { emit() {} }; }
}

let server;

afterEach(() => {
  if (!server) return;
  clearInterval(server.loop);
  clearInterval(server.rateCleanup);
  for (const room of server.rooms.values()) server.destroyRoom(room);
  server = null;
});

function begin(taskId) {
  const station = stationById("the-skeld", `task:${taskId}`);
  assert.ok(station, `${taskId} has a primary console`);
  const room = server.createRoom("private", {});
  room.phase = PHASES.ACTIVE;
  const player = server.makePlayer({
    id: "challenge-player",
    socketId: "challenge-socket",
    displayName: "Challenge Player",
    appearance: {},
    x: station.x,
    z: station.z,
    mapId: room.mapId
  });
  player.tasks = [{ id: taskId, site: 0 }];
  room.players.set(player.id, player);
  return server.beginTask(room, player, { stationId: station.id }).challenge;
}

test("server-fed minigame challenges have the shapes their clients consume", () => {
  server = new GameServer(new SilentIo());

  const simon = begin("skeld-start-reactor");
  assert.equal(simon.length, 5);
  simon.forEach((round, index) => {
    assert.equal(round.length, index + 1);
    assert.ok(round.every((cell) => Number.isInteger(cell) && cell >= 0 && cell < 4));
  });

  const wires = begin("skeld-fix-wiring");
  assert.equal(wires.length, 4);
  assert.deepEqual([...wires].sort((a, b) => a - b), [0, 1, 2, 3]);

  const sample = begin("skeld-inspect-sample");
  assert.equal(sample.length, 1);
  assert.ok(Number.isInteger(sample[0]) && sample[0] >= 0 && sample[0] < 6);
});

test("every authored Skeld assignment resolves to a client minigame", () => {
  const map = getMapDefinition("the-skeld");
  assert.equal(map.taskDefinitions.length, 18);
  assert.equal(map.stations.filter(({ type }) => type === "task").length, 28);
  for (const task of map.taskDefinitions) {
    assert.equal(typeof MINIGAMES[task.kind]?.build, "function", `${task.id}:${task.kind}`);
  }
});
