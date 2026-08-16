import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getMapDefinition, stationById } from "../public/src/shipData.js";
import { PHASES } from "../server/constants.js";
import { GameServer } from "../server/gameServer.js";

class RecordingIo {
  constructor() { this.events = []; }
  on() {}
  to(target) {
    return { emit: (event, payload) => this.events.push({ target, event, payload }) };
  }
}

let server;

afterEach(() => {
  server?.stop();
  server = null;
});

function player(room, id, faction, position, socketId = null) {
  const member = server.makePlayer({
    id,
    socketId,
    displayName: id,
    appearance: {},
    x: position.x,
    z: position.z,
    mapId: room.mapId,
    bot: !socketId
  });
  member.faction = faction;
  member.role = faction === "operative" ? "signal-operative" : "operations-crew";
  room.players.set(id, member);
  return member;
}

test("sabotage capabilities keep working when a definition id changes", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("practice", {});
  room.phase = PHASES.ACTIVE;
  const lightPanel = stationById(room.mapId, "skeld-light-panel");
  const operative = player(room, "operative", "operative", lightPanel);

  const lights = server.startSabotage(room, operative, "skeld-lights-out").sabotage;
  room.activeSabotage.id = "renamed-darkness-system";
  assert.equal(lights.blindsPlayers, true);
  assert.equal(server.lightsAreOut(room), true);

  server.clearActiveSabotage(room);
  const security = stationById(room.mapId, "skeld-cameras");
  const crew = player(room, "crew", "crew", security);
  server.startSabotage(room, operative, "skeld-comms-sabotage");
  room.activeSabotage.id = "renamed-radio-system";
  assert.equal(room.activeSabotage.jamsTelemetry, true);
  assert.throws(() => server.requestSecurity(room, crew), /jammed/u);
});

test("critical-sabotage countdown updates are emitted at most once per elapsed second", () => {
  const io = new RecordingIo();
  server = new GameServer(io);
  clearInterval(server.loop);
  clearInterval(server.rateCleanup);
  const room = server.createRoom("practice", {});
  room.phase = PHASES.ACTIVE;
  const spawn = getMapDefinition(room.mapId).spawnPoints[0];
  const operative = player(room, "operative", "operative", { x: spawn[0], z: spawn[1] });
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    server.lastTickAt = now;
    server.startSabotage(room, operative, "skeld-o2-depletion");
    io.events.length = 0;

    now += 999;
    server.tick();
    assert.equal(io.events.filter(({ event }) => event === "sabotageUpdated").length, 0);

    now += 1;
    server.tick();
    assert.equal(io.events.filter(({ event }) => event === "sabotageUpdated").length, 1);

    now += 250;
    server.tick();
    assert.equal(io.events.filter(({ event }) => event === "sabotageUpdated").length, 1);
  } finally {
    Date.now = realNow;
  }
});

test("snapshot shield discovery scans the room once rather than once per player", () => {
  server = new GameServer(new RecordingIo());
  clearInterval(server.loop);
  clearInterval(server.rateCleanup);
  const room = server.createRoom("practice", {});
  room.phase = PHASES.ACTIVE;
  room.lastSnapshotAt = 0;
  const spawn = getMapDefinition(room.mapId).spawnPoints[0];
  let shieldReads = 0;
  for (let index = 0; index < 10; index += 1) {
    const medic = player(room, `medic-${index}`, "crew", { x: spawn[0], z: spawn[1] }, `socket-${index}`);
    medic.role = "medic";
    medic.roleState = {
      protectedUntil: 0,
      get shieldTargetId() {
        shieldReads += 1;
        return null;
      }
    };
  }

  server.lastTickAt = Date.now() - 50;
  server.tick();
  assert.equal(shieldReads, room.players.size);
});

test("survivor winners are collected once before match results are mapped", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("practice", {});
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now() - 5_000;
  const spawn = getMapDefinition(room.mapId).spawnPoints[0];
  let roleReads = 0;
  for (let index = 0; index < 8; index += 1) {
    const member = player(room, `crew-${index}`, "crew", { x: spawn[0], z: spawn[1] });
    Object.defineProperty(member, "role", {
      configurable: true,
      get() {
        roleReads += 1;
        return "operations-crew";
      }
    });
  }

  server.endMatch(room, "crew", "test");
  assert.ok(roleReads <= room.players.size * 4,
    `expected a linear role scan, observed ${roleReads} reads for ${room.players.size} players`);
});
