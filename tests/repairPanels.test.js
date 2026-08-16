import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { stationById } from "../public/src/shipData.js";
import { PHASES } from "../server/constants.js";
import { GameServer } from "../server/gameServer.js";

class SilentIo {
  on() {}
  to() { return { emit() {} }; }
}

let server;

afterEach(() => {
  server?.stop();
  server = null;
});

function makePlayer(room, id, faction, position) {
  const player = server.makePlayer({
    id,
    socketId: null,
    displayName: id,
    appearance: {},
    x: position.x,
    z: position.z,
    mapId: room.mapId,
    bot: true
  });
  player.faction = faction;
  room.players.set(id, player);
  return player;
}

function setup(sabotageId, stationId) {
  server = new GameServer(new SilentIo());
  const room = server.createRoom("practice", {});
  room.phase = PHASES.ACTIVE;
  const station = stationById(room.mapId, stationId);
  const operative = makePlayer(room, "operative", "operative", { x: station.x + 8, z: station.z });
  const fixer = makePlayer(room, "fixer", "crew", station);
  server.startSabotage(room, operative, sabotageId);
  return { room, operative, fixer, station };
}

test("shared light breakers can be repaired and deliberately flipped back by an operative", () => {
  const { room, operative, fixer, station } = setup("skeld-lights-out", "skeld-light-panel");
  room.activeSabotage.panel.switches = [false, false, true, true, true];
  const firstDown = room.activeSabotage.panel.switches.findIndex((value) => !value);
  assert.notEqual(firstDown, -1);

  assert.equal(server.repairAction(room, fixer, { stationId: station.id, value: firstDown }).solved, false);

  operative.position = { x: station.x, z: station.z };
  server.repairAction(room, operative, { stationId: station.id, value: firstDown });
  assert.equal(room.activeSabotage.panel.switches[firstDown], false);

  let finalResult = null;
  for (const index of room.activeSabotage.panel.switches
    .map((value, index) => value ? null : index)
    .filter((index) => index !== null)) {
    finalResult = server.repairAction(room, fixer, { stationId: station.id, value: index });
  }
  assert.equal(finalResult.solved, true);
  assert.equal(room.activeSabotage, null);
});

test("both O2 keypads require the same server-generated code", () => {
  const { room, fixer, station } = setup("skeld-o2-depletion", "skeld-o2-panel");
  const second = stationById(room.mapId, "skeld-admin-o2");
  const code = room.activeSabotage.panel.code;

  assert.equal(server.repairAction(room, fixer, { stationId: station.id, value: "000000" }).rejected, true);
  assert.equal(server.repairAction(room, fixer, { stationId: station.id, value: code }).solved, false);
  fixer.position = { x: second.x, z: second.z };
  assert.equal(server.repairAction(room, fixer, { stationId: second.id, value: code }).solved, true);
  assert.equal(room.activeSabotage, null);
});

test("the communications dial rejects an out-of-phase value and accepts its carrier", () => {
  const { room, fixer, station } = setup("skeld-comms-sabotage", "skeld-comms-panel");
  const target = room.activeSabotage.panel.target;
  const wrong = target < 0.5 ? 1 : 0;

  assert.equal(server.repairAction(room, fixer, { stationId: station.id, value: wrong }).rejected, true);
  assert.equal(server.repairAction(room, fixer, { stationId: station.id, value: target }).solved, true);
  assert.equal(room.activeSabotage, null);
});

test("reactor clears only while both hand scanners are held", () => {
  const { room, operative, fixer, station } = setup("skeld-reactor-meltdown", "skeld-reactor-alpha");
  const second = stationById(room.mapId, "skeld-reactor-beta");
  const secondFixer = makePlayer(room, "second-fixer", "crew", second);

  assert.equal(server.repairAction(room, fixer, { stationId: station.id, value: "hold" }).solved, false);
  assert.equal(server.repairAction(room, secondFixer, { stationId: second.id, value: "hold" }).solved, true);
  assert.equal(room.activeSabotage, null);
  assert.ok(operative.matchStats.sabotagesStarted > 0);
});
