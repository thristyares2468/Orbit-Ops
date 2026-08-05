import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { LOBBY_MAP_ID, MAP_IDS, getMapDefinition, isWalkable, stationById } from "../public/src/shipData.js";
import { GameServer } from "../server/gameServer.js";
import { PHASES } from "../server/constants.js";
import { checkSoloWin } from "../server/roleEngine.js";
import { ROLE_DEFINITIONS } from "../public/src/roleData.js";

class RecordingIo {
  constructor() {
    this.events = [];
  }

  on() {}

  to(target) {
    return {
      emit: (event, payload) => this.events.push({ target, event, payload })
    };
  }
}

let server;

afterEach(() => {
  if (!server) return;
  clearInterval(server.loop);
  clearInterval(server.rateCleanup);
  for (const room of server.rooms.values()) server.destroyRoom(room);
  server = null;
});

function player(id, faction, position = { x: 0, z: 0 }, mapId = "the-skeld") {
  const result = server.makePlayer({
    id,
    socketId: `socket-${id}`,
    displayName: id,
    appearance: { colour: "cyan", symbol: "orbit", number: 7 },
    x: position.x,
    z: position.z,
    mapId
  });
  result.faction = faction;
  result.role = faction === "operative" ? "signal-operative" : "operations-crew";
  return result;
}

function assignRole(member, role, faction, usesLeft = null) {
  member.role = role;
  member.faction = faction;
  member.roleState = {
    usesLeft,
    cooldownEndsAt: 0,
    activeUntil: 0,
    protectedUntil: 0,
    targetId: null,
    trackedTargetId: null,
    shieldTargetId: null,
    morphTargetId: null
  };
  return member;
}

test("the server owns elimination, incident, voting, and victory resolution", () => {
  const io = new RecordingIo();
  server = new GameServer(io);
  const room = server.createRoom("private", {
    operativeCount: 1,
    eliminationCooldownSeconds: 10,
    discussionSeconds: 10,
    votingSeconds: 10
  });
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now() - 20_000;
  room.taskTotal = 15;

  const operative = player("operative", "operative");
  const victim = player("victim", "crew", { x: 0.5, z: 0 });
  const reporter = player("reporter", "crew", { x: 0.5, z: 0 });
  const witness = player("witness", "crew", { x: 0.5, z: 0 });
  operative.lastEliminationAt = Date.now() - 11_000;
  for (const member of [operative, victim, reporter, witness]) room.players.set(member.id, member);

  const elimination = server.eliminationAttempt(room, operative, victim.id);
  assert.ok(elimination.incidentId);
  assert.equal(victim.alive, false);
  assert.equal(room.incidents.get(elimination.incidentId).reported, false);

  const meeting = server.reportIncident(room, reporter, elimination.incidentId);
  assert.ok(meeting.meetingId);
  assert.equal(room.incidents.get(elimination.incidentId).reported, true);

  for (const timer of room.timers) clearTimeout(timer);
  room.timers.clear();
  server.startVoting(room);
  server.submitVote(room, reporter, operative.id);
  server.submitVote(room, witness, operative.id);
  server.submitVote(room, operative, reporter.id);

  assert.equal(operative.alive, false);
  assert.equal(room.phase, PHASES.REMOVAL);
  for (const timer of room.timers) clearTimeout(timer);
  room.timers.clear();
  assert.equal(server.checkWinConditions(room, "vote"), true);
  assert.equal(room.phase, PHASES.RESULTS);
  const matchEnded = io.events.find((entry) => entry.event === "matchEnded");
  assert.equal(matchEnded.payload.winner, "crew");
  assert.equal(matchEnded.payload.reason, "all-operatives-removed");
});

test("a disconnected host is reassigned to a connected human", () => {
  const io = new RecordingIo();
  server = new GameServer(io);
  const room = server.createRoom("private", {});
  const originalHost = player("original-host", "crew");
  const successor = player("successor", "crew");
  originalHost.connected = false;
  room.players.set(originalHost.id, originalHost);
  room.players.set(successor.id, successor);
  room.hostId = originalHost.id;

  server.syncHost(room);

  assert.equal(room.hostId, successor.id);
  assert.equal(originalHost.isHost, false);
  assert.equal(successor.isHost, true);
  assert.deepEqual(io.events.find((entry) => entry.event === "hostChanged")?.payload, {
    previousHostId: originalHost.id,
    hostId: successor.id
  });
});

test("a Medic shield is server-authoritative and consumed by one elimination", () => {
  const io = new RecordingIo();
  server = new GameServer(io);
  const room = server.createRoom("private", { eliminationCooldownSeconds: 10 });
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now() - 20_000;
  room.taskTotal = 15;

  const operative = player("operative", "operative");
  const medic = assignRole(player("medic", "crew", { x: 0.25, z: 0 }), "medic", "crew", 1);
  const protectedCrew = player("protected", "crew", { x: 0.5, z: 0 });
  const witness = player("witness", "crew", { x: 0.75, z: 0 });
  operative.lastEliminationAt = Date.now() - 11_000;
  for (const member of [operative, medic, protectedCrew, witness]) room.players.set(member.id, member);

  server.roleAction(room, medic, { targetId: protectedCrew.id });
  assert.equal(medic.roleState.shieldTargetId, protectedCrew.id);

  const blocked = server.eliminationAttempt(room, operative, protectedCrew.id);
  assert.equal(blocked.blocked, true);
  assert.equal(protectedCrew.alive, true);
  assert.equal(medic.roleState.shieldTargetId, null);
  assert.ok(io.events.some((entry) => entry.event === "shieldBlocked" && entry.payload.playerId === protectedCrew.id));

  operative.lastEliminationAt = Date.now() - 11_000;
  const secondAttempt = server.eliminationAttempt(room, operative, protectedCrew.id);
  assert.ok(secondAttempt.incidentId);
  assert.equal(protectedCrew.alive, false);
});

test("the Sheriff eliminates an Operative and misfires on an innocent", () => {
  const io = new RecordingIo();
  server = new GameServer(io);
  const hitRoom = server.createRoom("private", {});
  hitRoom.phase = PHASES.ACTIVE;
  hitRoom.matchStartedAt = Date.now() - 20_000;
  hitRoom.taskTotal = 15;
  const sheriff = assignRole(player("sheriff", "crew"), "sheriff", "crew");
  const operative = player("operative", "operative", { x: 0.5, z: 0 });
  const crew = player("crew", "crew", { x: 0.75, z: 0 });
  for (const member of [sheriff, operative, crew]) hitRoom.players.set(member.id, member);

  const hit = server.roleAction(hitRoom, sheriff, { targetId: operative.id });
  assert.equal(hit.effect, "sheriff-hit");
  assert.equal(operative.alive, false);

  const missRoom = server.createRoom("private", {});
  missRoom.phase = PHASES.ACTIVE;
  missRoom.matchStartedAt = Date.now() - 20_000;
  missRoom.taskTotal = 15;
  const secondSheriff = assignRole(player("sheriff-two", "crew"), "sheriff", "crew");
  const innocent = player("innocent", "crew", { x: 0.5, z: 0 });
  const secondOperative = player("operative-two", "operative", { x: 1, z: 0 });
  for (const member of [secondSheriff, innocent, secondOperative]) missRoom.players.set(member.id, member);

  const misfire = server.roleAction(missRoom, secondSheriff, { targetId: innocent.id });
  assert.equal(misfire.effect, "sheriff-misfire");
  assert.equal(secondSheriff.alive, false);
  assert.equal(innocent.alive, true);
});

test("every map emergency button starts a meeting and consumes the caller allowance", () => {
  const io = new RecordingIo();
  server = new GameServer(io);
  for (const mapId of MAP_IDS) {
    const room = server.createRoom("private", { emergencyMeetings: 1, mapId });
    room.phase = PHASES.ACTIVE;
    room.matchStartedAt = Date.now() - 20_000;
    const meetingConsole = stationById(room.mapId, "meeting-console");
    const caller = player(`caller-${mapId}`, "crew", { x: meetingConsole.x - 2.5, z: meetingConsole.z }, mapId);
    const operative = player(`operative-${mapId}`, "operative", { x: meetingConsole.x + 3, z: meetingConsole.z }, mapId);
    const witness = player(`witness-${mapId}`, "crew", { x: meetingConsole.x, z: meetingConsole.z + 3 }, mapId);
    for (const member of [caller, operative, witness]) room.players.set(member.id, member);

    const result = server.callMeeting(room, caller);
    assert.ok(result.meetingId, mapId);
    assert.equal(caller.emergencyMeetings, 1, mapId);
    assert.equal(room.phase, PHASES.INCIDENT, mapId);
    assert.ok(io.events.some((entry) => entry.event === "meetingStarted" && entry.payload.incidentRoom === null), mapId);
    for (const timer of room.timers) clearTimeout(timer);
    room.timers.clear();
  }
});

test("the first fallen crew member becomes a Guardian Angel ghost who can shield the living", () => {
  const io = new RecordingIo();
  server = new GameServer(io);
  const room = server.createRoom("private", { eliminationCooldownSeconds: 10 });
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now() - 20_000;
  room.taskTotal = 15;

  const operative = player("operative", "operative");
  const first = player("first", "crew", { x: 0.5, z: 0 });
  const second = player("second", "crew", { x: 1, z: 0 });
  const witness = player("witness", "crew", { x: 0.75, z: 0 });
  operative.lastEliminationAt = Date.now() - 11_000;
  for (const member of [operative, first, second, witness]) room.players.set(member.id, member);

  server.eliminationAttempt(room, operative, first.id);
  assert.equal(first.alive, false);
  assert.equal(first.role, "guardian-angel", "first crew death is promoted");
  assert.equal(room.guardianAngelId, first.id);

  const protect = server.roleAction(room, first, { targetId: second.id });
  assert.equal(protect.effect, "protect");
  assert.ok(second.roleState.protectedUntil > Date.now());

  operative.lastEliminationAt = Date.now() - 11_000;
  const blocked = server.eliminationAttempt(room, operative, second.id);
  assert.equal(blocked.blocked, true);
  assert.equal(second.alive, true);
  assert.ok(io.events.some((entry) => entry.event === "shieldBlocked" && entry.payload.protection === "guardian-shield"));

  operative.lastEliminationAt = Date.now() - 11_000;
  const kill = server.eliminationAttempt(room, operative, second.id);
  assert.ok(kill.incidentId, "the guardian shield is consumed by one block");
  assert.equal(second.alive, false);
  assert.notEqual(second.role, "guardian-angel", "only the first death claims the role");

  // Ghosts keep moving, unconstrained by walls, at a slight speed bonus.
  const start = first.position.x;
  for (let step = 0; step < 20; step += 1) {
    first.input = { x: 1, z: 0, yaw: 0, sprint: false, crouch: false, seq: step };
    first.lastInputAt = Date.now();
    server.tickPlayerMovement(room, first, Date.now(), 0.05);
  }
  assert.ok(first.position.x > start, "dead players still move as ghosts");
  const bounds = getMapDefinition(room.mapId).bounds;
  assert.ok(first.position.x <= bounds.maxX, "ghosts stay inside map bounds");
});

test("pre-match movement is simulated in the dropship lobby, not on the selected map", () => {
  const io = new RecordingIo();
  server = new GameServer(io);
  const room = server.createRoom("private", { mapId: "polus" });
  assert.equal(room.phase, PHASES.LOBBY);
  assert.equal(room.mapId, "the-skeld", "removed maps fall back to the only playable map");

  const [spawnX, spawnZ] = getMapDefinition(LOBBY_MAP_ID).spawnPoints[0];
  const walker = server.makePlayer({
    id: "walker", socketId: "socket-walker", displayName: "Walker",
    appearance: { colour: "cyan", symbol: "orbit", number: 7 },
    x: spawnX, z: spawnZ, mapId: LOBBY_MAP_ID
  });
  room.players.set(walker.id, walker);
  assert.equal(walker.currentRoom, "dropship-hold");

  // Hold "east" long enough to reach the hull wall; the lobby geometry must contain it.
  for (let step = 0; step < 60; step += 1) {
    walker.input = { x: 1, z: 0, yaw: 0, sprint: false, crouch: false, seq: step };
    walker.lastInputAt = Date.now();
    server.tickPlayerMovement(room, walker, Date.now(), 0.05);
  }
  assert.ok(walker.position.x > spawnX, "lobby input moves the player");
  assert.ok(isWalkable(LOBBY_MAP_ID, walker.position.x, walker.position.z), "player stays on the deck");
  assert.equal(walker.currentRoom, "dropship-hold");
  assert.equal(getMapDefinition(room.mapId).rooms.some((item) => item.id === "dropship-hold"), false,
    "the lobby deck belongs to the lobby map alone");
});

test("bot routes follow every authored corridor without targeting blocked room centres", () => {
  const io = new RecordingIo();
  server = new GameServer(io);
  for (const mapId of MAP_IDS) {
    const map = getMapDefinition(mapId);
    for (const route of map.corridorRoutes) {
      const waypoints = server.buildBotPath(mapId, route.from, route.to);
      assert.ok(waypoints.length > 0, `${mapId}:${route.id}`);
      assert.ok(waypoints.every(({ x, z }) => isWalkable(mapId, x, z, 0.2)), `${mapId}:${route.id}`);
    }
  }
});

function botPlayer(id, faction, position, mapId = "the-skeld") {
  const member = player(id, faction, position, mapId);
  member.bot = true;
  member.socketId = null;
  return member;
}

test("practice bots wait out an opening grace period before the first sabotage", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("practice", { sabotageCooldownSeconds: 10 });
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now();
  room.lastSabotageAt = room.matchStartedAt;
  room.sabotageClearedAt = room.matchStartedAt;

  const justStarted = server.botSabotageReadyAt(room) - room.matchStartedAt;
  assert.ok(justStarted >= 60_000 && justStarted <= 90_000,
    `first practice sabotage should be 60-90s out, got ${Math.round(justStarted / 1000)}s`);

  // A short configured cooldown must not shorten the practice grace period.
  assert.ok(server.botSabotageReadyAt(room) > Date.now() + 55_000);
});

test("bot sabotage cooldown restarts when the deck is cleared, not when it began", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("practice", { sabotageCooldownSeconds: 10 });
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now() - 10 * 60_000;
  room.lastSabotageAt = Date.now() - 5 * 60_000;

  // A sabotage that has just been repaired restarts the wait, so bots cannot chain.
  room.activeSabotage = { id: "x", repairStations: [], repairs: new Set() };
  server.clearActiveSabotage(room);
  const wait = server.botSabotageReadyAt(room) - Date.now();
  assert.ok(wait >= 45_000 && wait <= 60_000,
    `gap between bot sabotages should be 45-60s, got ${Math.round(wait / 1000)}s`);
  assert.equal(room.activeSabotage, null);
});

test("online bot sabotage pacing still follows the room's configured cooldown", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", { sabotageCooldownSeconds: 24 });
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now();
  room.lastSabotageAt = Date.now();
  room.sabotageClearedAt = Date.now();
  const wait = server.botSabotageReadyAt(room) - Date.now();
  assert.ok(wait >= 24_000 && wait <= 32_000, `online pacing unchanged, got ${Math.round(wait / 1000)}s`);
});

test("crew bots answer a single-station sabotage and repair it", () => {
  const io = new RecordingIo();
  server = new GameServer(io);
  const room = server.createRoom("practice", {});
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now() - 60_000;
  const panel = stationById("the-skeld", "skeld-comms-panel");

  const operative = player("operative", "operative", { x: panel.x, z: panel.z + 30 });
  const responder = botPlayer("bot-near", "crew", { x: panel.x, z: panel.z + 4 });
  const bystander = botPlayer("bot-far", "crew", { x: panel.x, z: panel.z + 40 });
  for (const member of [operative, responder, bystander]) room.players.set(member.id, member);

  server.startSabotage(room, operative, "skeld-comms-sabotage");
  server.assignSabotageRepairs(room);

  assert.equal(responder.repairStationId, "skeld-comms-panel", "the nearest crew bot responds");
  assert.equal(bystander.repairStationId, null, "one station never draws two bots");

  // Walk the responder in and let it interact.
  responder.position = { x: panel.x, z: panel.z };
  responder.currentRoom = panel.roomId;
  responder.botTarget = null;
  server.tickBot(room, responder, Date.now(), 0.05);

  assert.equal(room.activeSabotage, null, "the bot repaired the sabotage");
  assert.equal(responder.repairStationId, null, "the assignment is released afterwards");
});

test("a two-station sabotage sends one crew bot to each repair point", () => {
  const io = new RecordingIo();
  server = new GameServer(io);
  const room = server.createRoom("practice", {});
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now() - 60_000;
  const alpha = stationById("the-skeld", "skeld-reactor-alpha");
  const beta = stationById("the-skeld", "skeld-reactor-beta");

  const operative = player("operative", "operative", { x: alpha.x, z: alpha.z + 25 });
  const first = botPlayer("bot-alpha", "crew", { x: alpha.x, z: alpha.z });
  const second = botPlayer("bot-beta", "crew", { x: beta.x, z: beta.z });
  const third = botPlayer("bot-spare", "crew", { x: alpha.x, z: alpha.z + 18 });
  for (const member of [operative, first, second, third]) room.players.set(member.id, member);

  server.startSabotage(room, operative, "skeld-reactor-meltdown");
  server.assignSabotageRepairs(room);

  const assigned = [first, second, third].map((bot) => bot.repairStationId).filter(Boolean);
  assert.equal(assigned.length, 2, "exactly the required number of bots respond");
  assert.equal(new Set(assigned).size, 2, "the two bots take different stations");
  assert.ok(assigned.includes("skeld-reactor-alpha") && assigned.includes("skeld-reactor-beta"));

  for (const bot of [first, second, third]) {
    if (!bot.repairStationId) continue;
    const station = stationById("the-skeld", bot.repairStationId);
    bot.position = { x: station.x, z: station.z };
    bot.currentRoom = station.roomId;
    bot.botTarget = null;
    server.tickBot(room, bot, Date.now(), 0.05);
  }

  assert.equal(room.activeSabotage, null, "both stations were repaired, ending the meltdown");
});

test("crew bots route to their repair station through walkable geometry", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("practice", {});
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now() - 60_000;
  const panel = stationById("the-skeld", "skeld-comms-panel");

  const operative = player("operative", "operative", { x: 0, z: 0 });
  const responder = botPlayer("bot-remote", "crew", { x: 0, z: 0 });
  responder.position = { ...getMapDefinition("the-skeld").rooms.find(({ id }) => id === "navigation") };
  responder.currentRoom = "navigation";
  for (const member of [operative, responder]) room.players.set(member.id, member);

  server.startSabotage(room, operative, "skeld-comms-sabotage");
  server.assignSabotageRepairs(room);
  server.tickBot(room, responder, Date.now(), 0.05);

  assert.equal(responder.botTarget?.stationId, "skeld-comms-panel");
  assert.ok(Array.isArray(responder.botPath));
  assert.ok(responder.botPath.every(({ x, z }) => isWalkable("the-skeld", x, z, 0.2)),
    "every routed waypoint stays on authored walkable geometry");
});

test("crew bots use embedded repair panels from their collision-safe edge", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("practice", {});
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now() - 60_000;
  const map = getMapDefinition("the-skeld");
  const panel = stationById(map.id, "skeld-reactor-alpha");
  const operative = player("operative", "operative", map.rooms.find(({ id }) => id === "cafeteria").navigationAnchor);
  const responder = botPlayer("bot-responder", "crew", map.rooms.find(({ id }) => id === "cafeteria").navigationAnchor);
  for (const member of [operative, responder]) room.players.set(member.id, member);

  server.startSabotage(room, operative, "skeld-reactor-meltdown");
  responder.repairStationId = panel.id;
  responder.botTarget = {
    x: panel.x, z: panel.z, roomId: panel.roomId,
    stationId: panel.id, repairSabotageId: panel.refId
  };
  responder.botPath = server.buildBotPath(map.id, "cafeteria", panel.roomId, responder.position, panel);
  responder.position = { ...responder.botPath.at(-1) };
  responder.currentRoom = panel.roomId;
  responder.botPath = [];

  const clearDistance = Math.hypot(responder.position.x - panel.x, responder.position.z - panel.z);
  assert.ok(clearDistance > 1.6 && clearDistance <= 2.8,
    "the wall panel is only reachable within the shared interaction radius");
  server.tickBot(room, responder, Date.now(), 0.05);
  assert.equal(room.activeSabotage.repairs.has(panel.id), true,
    "the responder activates the panel without crossing its collision");
});

test("crew bots follow tight Skeld corners and clear a two-panel meltdown", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("practice", {});
  const map = getMapDefinition("the-skeld");
  const operative = player("operative", "operative", map.rooms.find(({ id }) => id === "cafeteria").navigationAnchor);
  const responders = map.spawnPoints.slice(0, 3).map(([x, z], index) =>
    botPlayer(`route-bot-${index}`, "crew", { x, z }));
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now() - 60_000;
  for (const member of [operative, ...responders]) room.players.set(member.id, member);

  server.startSabotage(room, operative, "skeld-reactor-meltdown");
  let now = Date.now();
  for (let tick = 0; tick < 900 && room.activeSabotage; tick += 1) {
    now += 50;
    server.assignSabotageRepairs(room);
    for (const responder of responders) server.tickBot(room, responder, now, 0.05);
  }

  assert.equal(room.activeSabotage, null,
    "responders traverse the Upper Engine corner and activate both Reactor panels within 45 seconds");
});

test("clearing a sabotage releases every bot repair assignment", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("practice", {});
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now() - 60_000;
  const panel = stationById("the-skeld", "skeld-light-panel");
  const operative = player("operative", "operative", { x: panel.x, z: panel.z + 20 });
  const responder = botPlayer("bot-one", "crew", { x: panel.x, z: panel.z + 3 });
  for (const member of [operative, responder]) room.players.set(member.id, member);

  server.startSabotage(room, operative, "skeld-lights-out");
  server.assignSabotageRepairs(room);
  assert.equal(responder.repairStationId, "skeld-light-panel");

  server.clearActiveSabotage(room);
  assert.equal(responder.repairStationId, null);

  // With nothing to repair the bot returns to ordinary assignments.
  responder.botTarget = { x: 0, z: 0, roomId: "cafeteria", stationId: "x", repairSabotageId: "skeld-lights-out" };
  server.assignSabotageRepairs(room);
  server.tickBot(room, responder, Date.now(), 0.05);
  assert.notEqual(responder.botTarget?.repairSabotageId, "skeld-lights-out");
});

test("sight is limited to a radius and collapses when the lights go out", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", {});
  room.phase = PHASES.ACTIVE;
  const crew = player("crew", "crew");
  const operative = player("operative", "operative");
  for (const member of [crew, operative]) room.players.set(member.id, member);

  const litCrew = server.visionRadiusFor(room, crew);
  const litOperative = server.visionRadiusFor(room, operative);
  assert.ok(litCrew > 0);
  assert.ok(litOperative > litCrew, "operatives see further than crew");

  room.activeSabotage = { id: "skeld-lights-out", repairStations: [], repairs: new Set() };
  assert.equal(server.lightsAreOut(room), true);
  const darkCrew = server.visionRadiusFor(room, crew);
  const darkOperative = server.visionRadiusFor(room, operative);
  assert.ok(darkCrew < litCrew * 0.6, "a lights sabotage badly blinds the crew");
  assert.ok(darkOperative > darkCrew, "the operative keeps the advantage in the dark");

  // A non-lighting sabotage must not darken anything.
  room.activeSabotage = { id: "skeld-reactor-meltdown", repairStations: [], repairs: new Set() };
  assert.equal(server.lightsAreOut(room), false);
  assert.equal(server.visionRadiusFor(room, crew), litCrew);
});

test("host visibility settings still scale the sight radius", () => {
  server = new GameServer(new RecordingIo());
  const wide = server.createRoom("private", { crewVisibility: 1.5 });
  const narrow = server.createRoom("private", { crewVisibility: 0.5 });
  wide.phase = PHASES.ACTIVE;
  narrow.phase = PHASES.ACTIVE;
  const a = player("a", "crew");
  const b = player("b", "crew");
  wide.players.set(a.id, a);
  narrow.players.set(b.id, b);
  assert.ok(server.visionRadiusFor(wide, a) > server.visionRadiusFor(narrow, b));
});

test("ghosts and meetings see the whole deck", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", {});
  room.phase = PHASES.ACTIVE;
  const alive = player("alive", "crew");
  const dead = player("dead", "crew");
  dead.alive = false;
  for (const member of [alive, dead]) room.players.set(member.id, member);

  assert.equal(server.seesEverything(room, alive), false, "the living are limited to their radius");
  assert.equal(server.seesEverything(room, dead), true, "ghosts spectate everything");

  room.phase = PHASES.DISCUSSION;
  assert.equal(server.seesEverything(room, alive), true, "meetings reveal everyone");
});

test("snapshots cull players and bodies beyond the viewer's sight radius", () => {
  const io = new RecordingIo();
  server = new GameServer(io);
  const room = server.createRoom("private", {});
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now();

  const viewer = player("viewer", "crew", { x: 0, z: 0 });
  const radius = server.visionRadiusFor(room, viewer);
  const near = player("near", "crew", { x: radius - 2, z: 0 });
  const far = player("far", "crew", { x: radius + 40, z: 0 });
  for (const member of [viewer, near, far]) room.players.set(member.id, member);
  room.incidents.set("body-near", { id: "body-near", x: 1, z: 0, roomId: "cafeteria", reported: false });
  room.incidents.set("body-far", { id: "body-far", x: radius + 50, z: 0, roomId: "navigation", reported: false });

  room.lastSnapshotAt = 0;
  server.tick();

  const sent = io.events.filter((entry) => entry.event === "worldSnapshot" && entry.target === viewer.socketId);
  assert.ok(sent.length > 0, "the viewer receives a snapshot");
  const payload = sent.at(-1).payload;
  const ids = payload.players.map((snapshot) => snapshot.id);
  assert.ok(ids.includes("viewer"), "you always see yourself");
  assert.ok(ids.includes("near"), "players inside the radius are visible");
  assert.ok(!ids.includes("far"), "players beyond the radius are not sent at all");
  assert.ok(payload.incidents.some((incident) => incident.id === "body-near"));
  assert.ok(!payload.incidents.some((incident) => incident.id === "body-far"),
    "bodies beyond the radius are not sent either");
  assert.equal(payload.visionRadius, Number(radius.toFixed(2)));
  assert.equal(payload.lightsOut, false);
});

test("vents form a network an operative travels through, not a fixed pair", () => {
  const io = new RecordingIo();
  server = new GameServer(io);
  const room = server.createRoom("private", {});
  room.phase = PHASES.ACTIVE;
  const entry = stationById("the-skeld", "skeld-vent-cafeteria");
  const operative = player("operative", "operative", { x: entry.x, z: entry.z });
  room.players.set(operative.id, operative);

  const entered = server.enterVent(room, operative, entry.id);
  assert.equal(entered.vent.inVent, true);
  assert.equal(operative.ventId, entry.id);
  assert.ok(entered.vent.exits.length >= 1, "the network offers somewhere to go");
  assert.ok(entered.vent.exits.every((exit) => exit.id !== entry.id), "never lists the vent you are in");

  const destination = entered.vent.exits[0];
  const moved = server.moveVent(room, operative, destination.id);
  assert.equal(operative.ventId, destination.id);
  assert.equal(operative.currentRoom, destination.roomId);
  assert.equal(moved.vent.exits.some((exit) => exit.id === entry.id), true,
    "you can travel back the way you came");

  server.exitVent(room, operative);
  assert.equal(operative.ventId, null);
});

test("vents refuse crew, cross-network hops and movement while inside", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", {});
  room.phase = PHASES.ACTIVE;
  const entry = stationById("the-skeld", "skeld-vent-cafeteria");
  const farNetwork = stationById("the-skeld", "skeld-vent-upper-engine");
  const crew = player("crew", "crew", { x: entry.x, z: entry.z });
  const operative = player("operative", "operative", { x: entry.x, z: entry.z });
  for (const member of [crew, operative]) room.players.set(member.id, member);

  assert.throws(() => server.enterVent(room, crew, entry.id), /cannot use the vent/u);

  server.enterVent(room, operative, entry.id);
  assert.throws(() => server.moveVent(room, operative, farNetwork.id), /different network/u);

  // Frozen while riding: movement input must not shift them off the vent.
  const before = { ...operative.position };
  operative.input = { x: 1, z: 0, yaw: 0, sprint: false, crouch: false, seq: 1 };
  operative.lastInputAt = Date.now();
  server.tickPlayerMovement(room, operative, Date.now(), 0.5);
  assert.deepEqual(operative.position, before, "a vented player does not walk");
});

test("a vented operative cannot kill, be killed, or be seen", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", { eliminationCooldownSeconds: 0 });
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now();
  const entry = stationById("the-skeld", "skeld-vent-cafeteria");
  const operative = player("operative", "operative", { x: entry.x, z: entry.z });
  const victim = player("victim", "crew", { x: entry.x + 0.5, z: entry.z });
  operative.lastEliminationAt = 0;
  for (const member of [operative, victim]) room.players.set(member.id, member);

  server.enterVent(room, operative, entry.id);
  assert.throws(() => server.eliminationAttempt(room, operative, victim.id), /Climb out/u);

  // And an operative hiding in a vent is not a valid target either.
  const hunter = player("hunter", "operative", { x: entry.x, z: entry.z });
  room.players.set(hunter.id, hunter);
  const hidden = player("hidden", "crew", { x: entry.x, z: entry.z });
  room.players.set(hidden.id, hidden);
  hidden.ventId = "skeld-vent-admin";
  hunter.lastEliminationAt = 0;
  assert.throws(() => server.eliminationAttempt(room, hunter, hidden.id), /inside the vents/u);
});

test("meetings empty the vents", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", {});
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now() - 20_000;
  const entry = stationById("the-skeld", "skeld-vent-cafeteria");
  const operative = player("operative", "operative", { x: entry.x, z: entry.z });
  const caller = player("caller", "crew", { x: entry.x, z: entry.z });
  for (const member of [operative, caller]) room.players.set(member.id, member);

  server.enterVent(room, operative, entry.id);
  assert.equal(operative.ventId, entry.id);
  server.startMeeting(room, caller, null);
  assert.equal(operative.ventId, null, "everyone is pulled out for the meeting");
  for (const timer of room.timers) clearTimeout(timer);
  room.timers.clear();
});

test("the admin table reports live occupancy without naming anyone", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", {});
  room.phase = PHASES.ACTIVE;
  const table = stationById("the-skeld", "skeld-admin-table");
  const reader = player("reader", "crew", { x: table.x, z: table.z });
  const other = player("other", "crew", { x: table.x, z: table.z });
  const vented = player("vented", "operative", { x: table.x, z: table.z });
  vented.ventId = "skeld-vent-cafeteria";
  for (const member of [reader, other, vented]) room.players.set(member.id, member);

  const view = server.requestAdmin(room, reader);
  const admin = view.rooms.find((item) => item.id === "admin");
  assert.equal(admin.count, 2, "both standing players are counted");
  assert.ok(!JSON.stringify(view).includes("reader"), "the table never names anyone");
  assert.ok(view.rooms.every((item) => typeof item.count === "number"));

  // Vented players are off the table entirely, and darkness kills the feed.
  assert.equal(view.rooms.reduce((total, item) => total + item.count, 0), 2);
  room.activeSabotage = { id: "skeld-lights-out", repairStations: [], repairs: new Set() };
  assert.throws(() => server.requestAdmin(room, reader), /dark/u);
});

test("cameras show a live feed and exclude vented players", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", {});
  room.phase = PHASES.ACTIVE;
  const cameras = stationById("the-skeld", "skeld-cameras");
  const watcher = player("watcher", "crew", { x: cameras.x, z: cameras.z });
  const walker = player("walker", "crew", { x: 10, z: 10 });
  const vented = player("vented", "operative", { x: 12, z: 12 });
  vented.ventId = "skeld-vent-cafeteria";
  for (const member of [watcher, walker, vented]) room.players.set(member.id, member);

  const feed = server.requestSecurity(room, watcher);
  const ids = feed.motion.map((entry) => entry.playerId);
  assert.ok(ids.includes("walker"), "moving crew appear on camera");
  assert.ok(!ids.includes("vented"), "vented players do not");
  const walkerFeed = feed.motion.find((entry) => entry.playerId === "walker");
  assert.equal(typeof walkerFeed.x, "number", "the feed carries live positions");
  assert.ok(walkerFeed.at >= Date.now() - 1000, "and is current, not delayed");
});

test("the nine reference assignments all resolve to real stations", () => {
  server = new GameServer(new RecordingIo());
  const map = getMapDefinition("the-skeld");
  assert.equal(map.taskDefinitions.length, 9);
  const names = map.taskDefinitions.map((task) => task.name);
  for (const expected of [
    "Turn On The Lights", "Fix The Electricity Wires", "Stabilize The Ship's Navigation",
    "Reboot The Wifi", "Empty The Garbage", "Divert Power To Reactor",
    "Align Engine Output", "Fuel Lower Engine", "Clear The Asteroids"
  ]) {
    assert.ok(names.includes(expected), `${expected} is assignable`);
  }
  for (const task of map.taskDefinitions) {
    assert.ok(stationById("the-skeld", `task:${task.id}`), `${task.id} has a station`);
    assert.ok(map.rooms.some((room) => room.id === task.roomId), `${task.id} sits in a real room`);
  }
});

test("an alerted Veteran turns an elimination back on the attacker", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", { eliminationCooldownSeconds: 0 });
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now();
  const veteran = assignRole(player("veteran", "crew", { x: 0.5, z: 0 }), "veteran", "crew", 3);
  const operative = player("operative", "operative", { x: 0, z: 0 });
  operative.lastEliminationAt = 0;
  for (const member of [veteran, operative]) room.players.set(member.id, member);

  veteran.roleState.alertUntil = Date.now() + 10_000;
  server.eliminationAttempt(room, operative, veteran.id);

  assert.equal(veteran.alive, true, "the Veteran survives");
  assert.equal(operative.alive, false, "the attacker dies instead");
});

test("retaliation does not recurse when two guarded roles meet", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", { eliminationCooldownSeconds: 0 });
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now();
  const veteran = assignRole(player("veteran", "crew", { x: 0.5, z: 0 }), "veteran", "crew", 3);
  const werewolf = assignRole(player("werewolf", "neutral", { x: 0, z: 0 }), "werewolf", "neutral");
  werewolf.lastEliminationAt = 0;
  for (const member of [veteran, werewolf]) room.players.set(member.id, member);
  veteran.roleState.alertUntil = Date.now() + 10_000;
  werewolf.roleState.rampageUntil = Date.now() + 10_000;

  // Must terminate rather than bouncing the kill back and forth forever.
  server.eliminateInternal(room, werewolf, veteran, "test");
  assert.equal(veteran.alive, true);
  assert.equal(werewolf.alive, false);
});

test("the Mayor's vote counts twice", () => {
  const io = new RecordingIo();
  server = new GameServer(io);
  const room = server.createRoom("private", { votingSeconds: 10 });
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now() - 20_000;
  room.taskTotal = 15;
  const mayor = assignRole(player("mayor", "crew"), "mayor", "crew");
  mayor.roleState.voteWeight = 2;
  const suspect = player("suspect", "crew", { x: 1, z: 0 });
  const other = player("other", "crew", { x: 2, z: 0 });
  const operative = player("operative", "operative", { x: 3, z: 0 });
  for (const member of [mayor, suspect, other, operative]) room.players.set(member.id, member);

  room.meeting = { id: "m", reporterId: mayor.id, incidentId: null, incidentRoom: null, evidence: [], votes: new Map() };
  server.startVoting(room);
  for (const timer of room.timers) clearTimeout(timer);
  room.timers.clear();
  // One weighted vote outvotes one plain vote.
  server.submitVote(room, mayor, suspect.id);
  server.submitVote(room, other, mayor.id);
  server.submitVote(room, suspect, mayor.id);
  server.submitVote(room, operative, suspect.id);

  const result = io.events.filter((entry) => entry.event === "voteResult").at(-1).payload;
  assert.equal(result.removedId, suspect.id, "the Mayor's extra weight carries the vote");
  for (const timer of room.timers) clearTimeout(timer);
  room.timers.clear();
});

test("the Executioner wins when its mark is voted out", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", {});
  room.phase = PHASES.ACTIVE;
  const executioner = assignRole(player("exec", "neutral"), "executioner", "neutral");
  const mark = player("mark", "crew");
  for (const member of [executioner, mark]) room.players.set(member.id, member);
  executioner.roleState.executionerTargetId = mark.id;

  assert.equal(checkSoloWin(room, { votedOutId: "someone-else" }), null);
  const win = checkSoloWin(room, { votedOutId: mark.id });
  assert.ok(win, "removing the mark wins the match");
  assert.equal(win.winner, "neutral");
  assert.deepEqual(win.winnerIds, [executioner.id]);
});

test("the Jester still wins by being voted out", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", {});
  const jester = assignRole(player("jester", "neutral"), "jester", "neutral");
  room.players.set(jester.id, jester);
  const win = checkSoloWin(room, { votedOutId: jester.id });
  assert.ok(win);
  assert.match(win.reason, /jester/u);
});

test("the Swapper exchanges two players' votes before the tally", () => {
  const io = new RecordingIo();
  server = new GameServer(io);
  const room = server.createRoom("private", { votingSeconds: 10 });
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now() - 20_000;
  room.taskTotal = 15;
  const swapper = assignRole(player("swapper", "crew"), "swapper", "crew", 1);
  const doomed = player("doomed", "crew", { x: 1, z: 0 });
  const spared = player("spared", "crew", { x: 2, z: 0 });
  const operative = player("operative", "operative", { x: 3, z: 0 });
  for (const member of [swapper, doomed, spared, operative]) room.players.set(member.id, member);
  swapper.roleState.swapFirstId = doomed.id;
  swapper.roleState.swapSecondId = spared.id;

  room.meeting = { id: "m", reporterId: swapper.id, incidentId: null, incidentRoom: null, evidence: [], votes: new Map() };
  server.startVoting(room);
  for (const timer of room.timers) clearTimeout(timer);
  room.timers.clear();
  // Everyone piles onto "doomed" - the swap should send it to "spared" instead.
  server.submitVote(room, swapper, doomed.id);
  server.submitVote(room, operative, doomed.id);
  server.submitVote(room, doomed, doomed.id);
  server.submitVote(room, spared, doomed.id);

  const result = io.events.filter((entry) => entry.event === "voteResult").at(-1).payload;
  assert.equal(result.removedId, spared.id, "the votes landed on the swapped player");
  assert.equal(swapper.roleState.swapFirstId, null, "the swap is spent");
  for (const timer of room.timers) clearTimeout(timer);
  room.timers.clear();
});

test("a blackmailed player cannot speak during the meeting", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", {});
  room.phase = PHASES.DISCUSSION;
  const blackmailer = assignRole(player("bm", "operative"), "blackmailer", "operative");
  const silenced = player("silenced", "crew");
  const free = player("free", "crew");
  for (const member of [blackmailer, silenced, free]) room.players.set(member.id, member);
  blackmailer.roleState.blackmailedId = silenced.id;

  assert.throws(() => server.chat(room, silenced, "it was not me"), /blackmailed/u);
  assert.equal(server.chat(room, free, "I saw something").ok, true, "others still speak");

  // Outside a meeting the silence does not apply.
  room.phase = PHASES.ACTIVE;
  silenced.alive = false;
  assert.equal(server.chat(room, silenced, "ghost talk").ok, true);
});

test("the Plumber seals a vent and it stops working", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", {});
  room.phase = PHASES.ACTIVE;
  const vent = stationById("the-skeld", "skeld-vent-cafeteria");
  const plumber = assignRole(player("plumber", "crew", { x: vent.x, z: vent.z }), "plumber", "crew", 2);
  const operative = player("operative", "operative", { x: vent.x, z: vent.z });
  for (const member of [plumber, operative]) room.players.set(member.id, member);

  server.roleAction(room, plumber, {});
  assert.ok((room.sealedVents ?? []).length === 1, "a vent was sealed");
  assert.throws(() => server.enterVent(room, operative, room.sealedVents[0]), /welded shut/u);
});

test("a killer neutral takes the match once nothing living opposes it", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", {});
  room.phase = PHASES.ACTIVE;
  const wolf = assignRole(player("wolf", "neutral"), "werewolf", "neutral");
  const prey = player("prey", "crew");
  for (const member of [wolf, prey]) room.players.set(member.id, member);

  assert.equal(checkSoloWin(room), null, "not yet - someone still lives");
  prey.alive = false;
  const win = checkSoloWin(room);
  assert.ok(win, "the last one standing wins");
  assert.match(win.reason, /last-standing/u);
  assert.deepEqual(win.winnerIds, [wolf.id]);
});

test("the Phantom wins by finishing its assignments after death", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", {});
  room.phase = PHASES.ACTIVE;
  const phantom = assignRole(player("phantom", "neutral"), "phantom", "neutral");
  phantom.tasks = [{ id: "a" }, { id: "b" }];
  phantom.alive = false;
  room.players.set(phantom.id, phantom);

  phantom.completedTasks = new Set(["a"]);
  assert.equal(checkSoloWin(room), null, "half-finished is not a win");
  phantom.completedTasks = new Set(["a", "b"]);
  const win = checkSoloWin(room);
  assert.ok(win, "finishing every assignment wins, even dead");
  assert.deepEqual(win.winnerIds, [phantom.id]);
});

test("being blinded collapses sight harder than any sabotage", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", {});
  room.phase = PHASES.ACTIVE;
  const victim = player("victim", "crew");
  room.players.set(victim.id, victim);

  const normal = server.visionRadiusFor(room, victim);
  victim.roleState.blindedUntil = Date.now() + 5_000;
  const blind = server.visionRadiusFor(room, victim);
  assert.ok(blind < normal / 3, `blinded sight should be tiny, got ${blind} vs ${normal}`);

  // And it wears off.
  victim.roleState.blindedUntil = Date.now() - 1;
  assert.equal(server.visionRadiusFor(room, victim), normal);
});

test("a cuffed player cannot act", () => {
  server = new GameServer(new RecordingIo());
  const room = server.createRoom("private", { eliminationCooldownSeconds: 0 });
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now();
  const operative = assignRole(player("operative", "operative"), "swooper", "operative");
  const victim = player("victim", "crew", { x: 0.5, z: 0 });
  operative.lastEliminationAt = 0;
  for (const member of [operative, victim]) room.players.set(member.id, member);

  operative.roleState.cuffedUntil = Date.now() + 20_000;
  assert.throws(() => server.roleAction(room, operative, {}), /cuffed/u);
  assert.throws(() => server.eliminationAttempt(room, operative, victim.id), /cuffed/u);

  operative.roleState.cuffedUntil = 0;
  assert.equal(server.roleAction(room, operative, {}).ok, true, "the cuffs come off");
});

test("elimination hooks reach the roles that listen for them", () => {
  const io = new RecordingIo();
  server = new GameServer(io);
  const room = server.createRoom("private", { eliminationCooldownSeconds: 0 });
  room.phase = PHASES.ACTIVE;
  room.matchStartedAt = Date.now();
  const mystic = assignRole(player("mystic", "crew", { x: 20, z: 20 }), "mystic", "crew");
  const warden = assignRole(player("warden", "crew", { x: 25, z: 25 }), "warden", "crew");
  const operative = player("operative", "operative");
  const victim = player("victim", "crew", { x: 0.5, z: 0 });
  operative.lastEliminationAt = 0;
  for (const member of [mystic, warden, operative, victim]) room.players.set(member.id, member);
  warden.roleState.fortifiedId = victim.id;

  server.eliminationAttempt(room, operative, victim.id);

  const findings = io.events.filter((entry) => entry.event === "roleFinding");
  assert.ok(findings.some((entry) => entry.target === mystic.socketId && entry.payload.type === "premonition"),
    "the Mystic feels the death");
  assert.ok(findings.some((entry) => entry.target === warden.socketId && entry.payload.type === "breach"),
    "the Warden learns its fortification broke");
  assert.ok(!findings.some((entry) => entry.target === operative.socketId),
    "roles without the hook hear nothing");
});

test("the full Town Of Us R roster is present and well formed", () => {
  const ids = Object.keys(ROLE_DEFINITIONS);
  assert.equal(ids.length, 63, "the roster is complete");
  for (const id of [
    "aurial", "seer", "mystic", "cleric", "deputy", "warden", "politician", "imitator",
    "eclipsal", "haunter"
  ]) {
    assert.ok(ROLE_DEFINITIONS[id], `${id} is implemented`);
  }
  // Hooks must be callable, since a throwing hook would break an elimination.
  for (const role of Object.values(ROLE_DEFINITIONS)) {
    for (const hook of Object.values(role.hooks)) {
      if (hook) assert.equal(typeof hook, "function", `${role.id} hook`);
    }
  }
});
