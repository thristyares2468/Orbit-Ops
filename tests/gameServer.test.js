import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
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

function player(id, faction, position = { x: 0, z: 0 }) {
  const result = server.makePlayer({
    id,
    socketId: `socket-${id}`,
    displayName: id,
    appearance: { colour: "cyan", symbol: "orbit", number: 7 },
    x: position.x,
    z: position.z
  });
  result.faction = faction;
  result.role = faction === "operative" ? "signal-operative" : "operations-crew";
  return result;
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
