import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";
import { INTERACTION_RANGE, ROLE_TARGET_RANGE } from "../public/src/gameplayConstants.js";
import { nearestLivingTarget, nearestRoleTarget } from "../public/src/gameplayTargeting.js";
import { RepairInterface } from "../public/src/repairInterface.js";
import { readStored } from "../public/src/safeStorage.js";
import {
  claimTaskModal, ownsTaskModal, releaseTaskModal
} from "../public/src/taskModalOwner.js";
import { resetMinigameState } from "../public/src/tasks/minigames.js";
import { GameUI } from "../public/src/ui.js";
import { getMapDefinition, stationById } from "../public/src/shipData.js";
import { GameServer } from "../server/gameServer.js";
import { PHASES } from "../server/constants.js";
import { fireHook } from "../server/roleEngine.js";

class RecordingIo {
  constructor() { this.events = []; }
  on() {}
  to(target) {
    return { emit: (event, payload) => this.events.push({ target, event, payload }) };
  }
}

let server = null;

afterEach(() => {
  if (!server) return;
  clearInterval(server.loop);
  clearInterval(server.rateCleanup);
  for (const room of server.rooms.values()) server.destroyRoom(room);
  server = null;
});

function member(id, faction, position = { x: 0, z: 0 }, { bot = false } = {}) {
  const result = server.makePlayer({
    id,
    socketId: bot ? null : `socket-${id}`,
    displayName: id,
    appearance: {},
    x: position.x,
    z: position.z,
    mapId: "the-skeld",
    bot
  });
  result.faction = faction;
  result.role = faction === "operative" ? "signal-operative" : "operations-crew";
  return result;
}

test("interaction and role targeting use one shared pair of constants", () => {
  assert.equal(INTERACTION_RANGE, 2.8);
  assert.equal(ROLE_TARGET_RANGE, 3.2);
});

test("client elimination targeting obeys the host elimination range", () => {
  const players = [
    { id: "self", alive: true },
    { id: "near", alive: true },
    { id: "far", alive: true }
  ];
  const snapshots = new Map([
    ["self", { x: 0, z: 0, alive: true }],
    ["near", { x: 2.2, z: 0, alive: true }],
    ["far", { x: 2.8, z: 0, alive: true }]
  ]);
  assert.equal(nearestLivingTarget(players, snapshots, "self", 2.35)?.id, "near");
  snapshots.set("near", { x: 2.5, z: 0, alive: true });
  assert.equal(nearestLivingTarget(players, snapshots, "self", 2.35), null,
    "a target outside the configured reach is not offered");
  assert.equal(nearestLivingTarget(players, snapshots, "self", 3)?.id, "near");
  snapshots.set("near", { x: 3, z: 0, alive: true });
  snapshots.set("far", { x: 3.1, z: 0, alive: true });
  assert.equal(nearestLivingTarget(players, snapshots, "self", 3)?.id, "near",
    "the exact server-authorized boundary is selectable on the client");
});

test("client role targeting includes the server-authorized boundary", () => {
  const snapshots = new Map([
    ["self", { x: 0, z: 0, alive: true }],
    ["target", { x: ROLE_TARGET_RANGE, z: 0, alive: true }]
  ]);
  const common = {
    local: snapshots.get("self"), snapshots, selfId: "self", maximumRange: ROLE_TARGET_RANGE,
    players: [{ id: "self", alive: true }, { id: "target", alive: true }],
    incidents: [{ id: "incident", x: 0, z: ROLE_TARGET_RANGE }]
  };
  assert.equal(nearestRoleTarget({ ...common, targeting: "player" })?.id, "target");
  assert.equal(nearestRoleTarget({ ...common, targeting: "incident" })?.id, "incident");
});

test("meeting cleanup closes every gameplay overlay, including nested settings", () => {
  const names = ["minimap", "task", "meeting", "sabotage", "admin", "security", "pause", "settings", "firstRunHint"];
  const elements = Object.fromEntries(names.map((name) => [name, {
    hidden: false,
    classList: { toggle(_className, hidden) { elements[name].hidden = hidden; } }
  }]));
  GameUI.prototype.closeGameplayModals.call({ elements });
  assert.ok(names.every((name) => elements[name].hidden), "no gameplay overlay survives into voting");
});

test("closing a repair panel invokes its live teardown before releasing the modal", () => {
  let tornDown = false;
  const repair = Object.create(RepairInterface.prototype);
  repair.active = { kind: "handprint" };
  repair.live = { teardown: () => { tornDown = true; } };
  repair.stage = { replaceChildren() {} };
  repair.modal = { classList: { add() {} } };
  assert.equal(claimTaskModal(repair), true);
  assert.equal(repair.close(), true);
  assert.equal(tornDown, true, "the handprint renewal timer's teardown runs on death/meeting close");
  assert.equal(ownsTaskModal(repair), false);
});

test("corrupt browser storage is discarded instead of throwing during boot", () => {
  const values = new Map([
    ["broken", "{not-json"],
    ["valid", JSON.stringify({ token: "abc" })]
  ]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key)
  };
  assert.deepEqual(readStored("broken", { safe: true }, storage), { safe: true });
  assert.equal(values.has("broken"), false);
  assert.deepEqual(readStored("valid", null, storage), { token: "abc" });
});

test("the shared task modal grants one interface ownership at a time", () => {
  const task = {};
  const repair = {};
  assert.equal(claimTaskModal(task), true);
  assert.equal(ownsTaskModal(task), true);
  assert.equal(claimTaskModal(repair), false);
  assert.equal(releaseTaskModal(repair), false);
  assert.equal(releaseTaskModal(task), true);
  assert.equal(claimTaskModal(repair), true);
  assert.equal(releaseTaskModal(repair), true);
});

test("match cleanup clears pending sample-analyser timers", () => {
  const timers = new Map([["sample:medbay", Date.now()]]);
  assert.equal(resetMinigameState(timers), 1);
  assert.equal(timers.size, 0);
});

test("vent modifications start empty and reset at both match boundaries", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("practice", { operativeCount: 2 });
  assert.deepEqual(room.sealedVents, []);
  assert.deepEqual(room.minedVents, []);

  room.sealedVents.push("old-seal");
  room.minedVents.push({ id: "old-mine" });
  server.resetRoomToLobby(room);
  assert.deepEqual(room.sealedVents, []);
  assert.deepEqual(room.minedVents, []);

  const spawn = getMapDefinition("the-skeld").spawnPoints[0];
  room.players.set("host", member("host", "crew", { x: spawn[0], z: spawn[1] }));
  room.sealedVents.push("second-seal");
  room.minedVents.push({ id: "second-mine" });
  server.startMatch(room);
  assert.deepEqual(room.sealedVents, []);
  assert.deepEqual(room.minedVents, []);
});

test("mined vents can be entered and hopped to while sealed exits remain blocked", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", {});
  room.phase = PHASES.ACTIVE;
  const authored = getMapDefinition("the-skeld").stations.filter((station) => station.type === "maintenance");
  const first = { ...authored[0], id: "mined-alpha", refId: "vent-mined" };
  const second = { ...authored[1], id: "mined-beta", refId: "vent-mined" };
  room.minedVents.push(first, second);
  const operative = member("operative", "operative", first);
  room.players.set(operative.id, operative);

  const entered = server.enterVent(room, operative, first.id);
  assert.equal(entered.vent.ventId, first.id);
  assert.ok(entered.vent.exits.some((exit) => exit.id === second.id));

  room.sealedVents.push(second.id);
  assert.throws(() => server.moveVent(room, operative, second.id), /welded shut/u);
  room.sealedVents.length = 0;
  assert.equal(server.moveVent(room, operative, second.id).vent.ventId, second.id);

  room.phase = PHASES.DISCUSSION;
  assert.throws(() => server.exitVent(room, operative), /cannot exit/u);
  room.phase = PHASES.ACTIVE;
  operative.alive = false;
  assert.throws(() => server.exitVent(room, operative), /cannot exit/u);
  operative.alive = true;
  assert.equal(server.exitVent(room, operative).ok, true);
});

test("the host's operative count is honored up to player count minus one", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("practice", { operativeCount: 3 });
  const spawn = getMapDefinition("the-skeld").spawnPoints[0];
  for (let index = 0; index < 5; index += 1) {
    const candidate = member(`member-${index}`, "crew", { x: spawn[0], z: spawn[1] }, { bot: index > 0 });
    room.players.set(candidate.id, candidate);
  }
  server.startMatch(room);
  assert.equal([...room.players.values()].filter((candidate) => candidate.faction === "operative").length, 3);
});

test("default practice population starts above operative parity", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("practice", { operativeCount: 2, maxPlayers: 12 });
  assert.equal(server.practicePopulationTarget(room), 5);
  server.populatePracticeBots(room, server.practicePopulationTarget(room));
  assert.equal(room.players.size, 5);
  assert.ok(room.players.size > room.settings.operativeCount * 2);
});

test("radio repairs require every configured station", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("practice", {});
  room.phase = PHASES.ACTIVE;
  const station = stationById("the-skeld", "skeld-comms-panel");
  const operative = member("operative", "operative", { x: station.x + 10, z: station.z });
  const fixer = member("fixer", "crew", station);
  room.players.set(operative.id, operative);
  room.players.set(fixer.id, fixer);
  server.startSabotage(room, operative, "skeld-comms-sabotage");
  room.activeSabotage.repairStations = [station.id, "future-radio-panel"];

  const result = server.repairAction(room, fixer, {
    stationId: station.id,
    value: room.activeSabotage.panel.target
  });
  assert.equal(result.solved, false);
  assert.ok(room.activeSabotage, "one dial does not clear a future two-dial outage");
});

test("O2 keypad codes are returned nearby but omitted from room broadcasts", () => {
  const io = new RecordingIo();
  server = new GameServer(io);
  const room = server.createRoom("practice", {});
  room.phase = PHASES.ACTIVE;
  const station = stationById("the-skeld", "skeld-o2-panel");
  const operative = member("operative", "operative", { x: station.x + 10, z: station.z });
  const fixer = member("fixer", "crew", station);
  room.players.set(operative.id, operative);
  room.players.set(fixer.id, fixer);
  server.startSabotage(room, operative, "skeld-o2-depletion");

  const opened = server.repairSabotage(room, fixer, station.id);
  assert.match(opened.panel.code, /^\d{6}$/u);
  const result = server.repairAction(room, fixer, { stationId: station.id, value: opened.panel.code });
  assert.equal(result.solved, false);
  assert.equal(result.panel.code, opened.panel.code, "the nearby player's response keeps the note visible");
  const broadcast = io.events.filter((entry) => entry.event === "sabotagePanel").at(-1);
  assert.ok(broadcast);
  assert.equal(Object.hasOwn(broadcast.payload.panel, "code"), false,
    "players elsewhere in the room do not receive the keypad note");
});

test("role hook failures are logged without breaking the match", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", {});
  const mystic = member("mystic", "crew");
  mystic.role = "mystic";
  room.players.set(mystic.id, mystic);
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    assert.doesNotThrow(() => fireHook(server, room, "onEliminated", {
      victim: { currentRoom: null }
    }));
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.equal(logged[0][1].roleId, "mystic");
  assert.equal(logged[0][1].hookName, "onEliminated");
  assert.match(logged[0][1].message, /replaceAll/u);
});

test("match persistence passes the room's actual map id", async () => {
  const serverSource = await readFile(new URL("../server/gameServer.js", import.meta.url), "utf8");
  const repositorySource = await readFile(
    new URL("../database/repositories/statsRepository.js", import.meta.url),
    "utf8"
  );
  assert.match(serverSource, /mapId: room\.mapId, winner/u);
  assert.match(repositorySource, /match\.mapId/u);
  assert.doesNotMatch(repositorySource, /'osv-meridian'/u);
});

test("breaker selection uses the shared Fisher-Yates shuffle", async () => {
  const source = await readFile(new URL("../server/gameServer.js", import.meta.url), "utf8");
  assert.match(source, /const order = shuffle\(\[0, 1, 2, 3, 4\]\)\.slice/u);
  assert.doesNotMatch(source, /\[0, 1, 2, 3, 4\]\.sort\(\(\) => Math\.random\(\) - 0\.5\)/u);
});
