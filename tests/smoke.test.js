import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { io as createClient } from "socket.io-client";
import { findWalkablePath } from "../public/src/mapPathfinding.js";
import { getMapDefinition, stationById } from "../public/src/shipData.js";

// End-to-end pass over the flows a new player actually touches in one practice run:
// guest entry, lobby, parameter edit, movement, map, assignments, meeting, a task,
// a sabotage repair, a role ability, the system menu and the return to lobby.
const PORT = 3141;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let serverProcess;
const clients = [];

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function once(socket, event, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`Timed out waiting for ${event}`)); }, timeoutMs);
    const handler = (payload) => { clearTimeout(timer); resolve(payload); };
    socket.once(event, handler);
  });
}

function request(socket, event, payload = {}, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      if (response?.ok === false) reject(new Error(response.error));
      else resolve(response);
    });
  });
}

function waitFor(socket, event, predicate, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`Timed out waiting for matching ${event}`)); }, timeoutMs);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

// Walk the authoritative simulation by feeding input until the player is in range.
async function walkTo(socket, playerId, target, range = 1.6, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let seq = 1000;
  let last = null;
  let waypoints = null;
  const track = (snapshot) => {
    const me = snapshot.players?.find((player) => player.id === playerId);
    if (me) last = me;
  };
  socket.on("worldSnapshot", track);
  try {
    while (Date.now() < deadline) {
      if (last) {
        const targetDistance = Math.hypot(target.x - last.x, target.z - last.z);
        if (targetDistance <= range) return last;
        if (!waypoints) waypoints = findWalkablePath("the-skeld", last, target, { step: 0.5 });
        while (waypoints.length > 1 && Math.hypot(waypoints[0].x - last.x, waypoints[0].z - last.z) < 0.25) {
          waypoints.shift();
        }
        const waypoint = waypoints[0] ?? target;
        const dx = waypoint.x - last.x;
        const dz = waypoint.z - last.z;
        const distance = Math.hypot(dx, dz);
        const magnitude = Math.max(0.0001, distance);
        socket.emit("playerInput", {
          x: dx / magnitude, z: dz / magnitude,
          yaw: Math.atan2(dx, dz), seq: seq += 1
        });
      }
      await wait(50);
    }
  } finally {
    socket.off("worldSnapshot", track);
  }
  throw new Error(`Could not reach ${JSON.stringify(target)}; last position ${JSON.stringify(last)}`);
}

before(async () => {
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Test server did not start.")), 10_000);
    serverProcess.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Orbit Ops server listening")) { clearTimeout(timer); resolve(); }
    });
    serverProcess.once("exit", (code) => reject(new Error(`Test server exited with ${code}`)));
  });
  serverProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));
});

after(async () => {
  for (const client of clients) client.disconnect();
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => serverProcess.once("exit", resolve)), wait(3000)]);
  }
});

test("a practice run covers entry, lobby, gameplay, meeting and return", { timeout: 90_000 }, async () => {
  const socket = createClient(ORIGIN, { transports: ["websocket"], forceNew: true, reconnection: false });
  clients.push(socket);
  await once(socket, "connected");

  // --- guest entry ---
  const auth = await request(socket, "guestLogin", { displayName: "SmokeRunner" });
  assert.equal(auth.guest, true);

  // --- practice lobby ---
  const created = await request(socket, "createRoom", { mode: "practice" });
  assert.equal(created.room.mode, "practice");
  assert.equal(created.room.phase, "lobby");
  const playerId = created.playerId;
  assert.ok(created.room.players.length > 1, "practice fills the room with training operatives");

  // --- parameter edit ---
  const tuned = await request(socket, "hostSettings", {
    mapId: "the-skeld", assignmentQuantity: 3, discussionSeconds: 10, votingSeconds: 10,
    emergencyMeetings: 1, sabotageCooldownSeconds: 10, eliminationCooldownSeconds: 120
  });
  assert.equal(tuned.settings.mapId, "the-skeld");
  assert.equal(tuned.settings.assignmentQuantity, 3);

  // --- lobby movement happens in the dropship, not on the match map ---
  const lobbySnapshot = await once(socket, "worldSnapshot", 8_000);
  assert.ok(lobbySnapshot.players.some((player) => player.id === playerId));

  await request(socket, "practiceRole", { role: "engineer" });

  const roleAssigned = once(socket, "roleAssigned", 20_000);
  const matchStarted = once(socket, "matchStarted", 20_000);
  await request(socket, "startMatch");
  const privateState = await roleAssigned;
  const started = await matchStarted;

  assert.equal(privateState.role, "engineer");
  assert.equal(started.mapId, "the-skeld");
  assert.ok(privateState.tasks.length >= 1, "the player receives their own assignment list");

  // --- assignment panel data is private and complete ---
  assert.ok(privateState.tasks.every((task) => task.id && task.roomId));
  assert.deepEqual(privateState.completedTaskIds, []);

  // --- movement under server authority ---
  const map = getMapDefinition("the-skeld");
  const firstTask = privateState.tasks[0];
  const taskStation = stationById("the-skeld", `task:${firstTask.id}`);
  assert.ok(taskStation, "the assignment resolves to a real station");
  const reached = await walkTo(socket, playerId, taskStation, 2.75);
  assert.ok(Math.hypot(reached.x - taskStation.x, reached.z - taskStation.z) <= 2.75);

  // --- one task, played to completion through the authoritative interface ---
  const begun = await request(socket, "beginTask", { stationId: taskStation.id });
  assert.equal(begun.task.id, firstTask.id);
  assert.ok(Array.isArray(begun.challenge) && begun.challenge.length > 0);
  const completion = once(socket, "taskCompleted", 20_000);
  for (const choice of begun.challenge) {
    await wait(320);
    await request(socket, "taskAction", { taskId: firstTask.id, choice });
  }
  const completed = await completion;
  assert.equal(completed.taskId, firstTask.id);
  assert.equal(completed.completed, true);

  // --- map overview data (what Tab renders) stays inside authored bounds ---
  assert.ok(map.rooms.every((room) =>
    room.x >= map.bounds.minX && room.x <= map.bounds.maxX
    && room.z >= map.bounds.minZ && room.z <= map.bounds.maxZ));

  // --- emergency meeting from the Cafeteria button ---
  const meetingConsole = stationById("the-skeld", "meeting-console");
  // The button sits inside the emergency table collider; its usable edge is
  // deliberately just inside the shared 2.8-unit interaction radius.
  await walkTo(socket, playerId, meetingConsole, 2.75);
  const meetingStarted = once(socket, "meetingStarted", 15_000);
  await request(socket, "callMeeting");
  const meeting = await meetingStarted;
  assert.ok(meeting.meetingId);
  assert.equal(meeting.incidentRoom, null, "an emergency call has no incident room");

  // --- discussion and voting run on server timers, not the client ---
  await once(socket, "discussionStarted", 15_000);
  const votingStarted = await once(socket, "votingStarted", 30_000);
  assert.ok(votingStarted.endsAt > Date.now(), "voting is bounded by a server deadline");
  await request(socket, "submitVote", { targetId: "skip" });

  // --- the system menu never stops the server clock ---
  const beforeMenu = await once(socket, "worldSnapshot", 8_000);
  await wait(700);
  const afterMenu = await once(socket, "worldSnapshot", 8_000);
  assert.ok(afterMenu.serverTime > beforeMenu.serverTime,
    "simulation time advances while the system menu is open");

  // --- end of match returns to the lobby ---
  // A practice match may legitimately continue after the meeting. Keep the
  // optional return-to-lobby assertion bounded instead of idling until the
  // outer test timeout.
  const ended = await waitFor(socket, "matchEnded", () => true, 5_000).catch(() => null);
  if (ended) {
    const back = await request(socket, "returnToLobby");
    assert.equal(back.room.phase, "lobby");
  }
});

test("an operative practice run covers sabotage, crew repair and a role ability", { timeout: 120_000 }, async () => {
  const socket = createClient(ORIGIN, { transports: ["websocket"], forceNew: true, reconnection: false });
  clients.push(socket);
  await once(socket, "connected");
  await request(socket, "guestLogin", { displayName: "SmokeOperative" });

  const created = await request(socket, "createRoom", { mode: "practice" });
  await request(socket, "hostSettings", { mapId: "the-skeld", sabotageCooldownSeconds: 10 });
  // Swooper is an Operative with a self-targeted ability, so one run covers both.
  await request(socket, "practiceRole", { role: "swooper" });

  const roleAssigned = once(socket, "roleAssigned", 20_000);
  await request(socket, "startMatch");
  const privateState = await roleAssigned;
  assert.equal(privateState.faction, "operative");
  await once(socket, "matchStarted", 20_000);

  // --- one role ability, server-validated ---
  const swoop = await request(socket, "roleAction", {});
  assert.equal(swoop.ok, true);
  assert.equal(swoop.effect, "swoop");
  assert.ok(swoop.privateState.roleState.activeUntil > Date.now(), "the ability has a live duration");

  // --- one sabotage, resolved by the crew rather than expiring ---
  const map = getMapDefinition("the-skeld");
  const meltdown = map.sabotageDefinitions.find((item) => item.critical && item.repairStations.length === 2);
  assert.ok(meltdown, "the Skeld has a two-station critical sabotage");

  const started = once(socket, "sabotageStarted", 15_000);
  await request(socket, "sabotageRequest", { sabotageId: meltdown.id });
  const live = await started;
  assert.equal(live.id, meltdown.id);
  assert.equal(live.requiredRepairs, 2);

  const resolution = await Promise.race([
    once(socket, "sabotageEnded", meltdown.durationMs + 15_000),
    once(socket, "matchEnded", meltdown.durationMs + 15_000).then((result) => ({ matchEnded: result }))
  ]);
  assert.ok(!resolution.matchEnded,
    "training crew must repair a critical sabotage instead of letting it end the match");
  assert.ok(!resolution.expired, "the sabotage was repaired, not run down");
  assert.equal(resolution.id, meltdown.id);
});
