import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { LOBBY_MAP_ID, MAP_IDS, getMapDefinition, isWalkable, stationById } from "../public/src/shipData.js";
import { GameServer } from "../server/gameServer.js";
import { PHASES } from "../server/constants.js";

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
