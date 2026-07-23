import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { io as createClient } from "socket.io-client";

const PORT = 3139;
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

function requestResult(socket, event, payload = {}, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function waitFor(socket, event, predicate, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for matching ${event}`));
    }, timeoutMs);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

async function connectGuest(index) {
  const socket = createClient(ORIGIN, { transports: ["websocket"], forceNew: true, reconnection: false });
  clients.push(socket);
  await once(socket, "connected");
  await request(socket, "guestLogin", { displayName: `Tester-${index}`, appearance: { colour: ["cyan", "amber", "violet", "lime"][index], symbol: "orbit", number: index + 1 } });
  return socket;
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

test("four clients join, receive private roles, and move through authoritative snapshots", { timeout: 30_000 }, async () => {
  const sockets = await Promise.all([0, 1, 2, 3].map(connectGuest));
  const created = await request(sockets[0], "createRoom", { mode: "private", settings: { operativeCount: 2, discussionSeconds: 10, votingSeconds: 10, eliminationCooldownSeconds: 10 } });
  const roomCode = created.room.code;
  for (const mapId of ["mira-hq", "polus", "the-skeld", "the-airship"]) {
    const changed = await request(sockets[0], "hostSettings", { mapId });
    assert.equal(changed.settings.mapId, mapId);
  }
  for (let index = 1; index < sockets.length; index += 1) await request(sockets[index], "joinRoom", { code: roomCode });
  for (const socket of sockets) await request(socket, "readyState", { ready: true });

  const privateStates = new Map();
  const snapshots = new Map();
  sockets.forEach((socket, index) => {
    socket.on("roleAssigned", (state) => privateStates.set(index, state));
    socket.on("worldSnapshot", (snapshot) => snapshots.set(index, snapshot));
  });

  const started = sockets.map((socket, index) => once(socket, "matchStarted", 12_000).catch((error) => { throw new Error(`Client ${index}: ${error.message}`); }));
  await request(sockets[0], "startMatch");
  await Promise.all(started);
  assert.equal(privateStates.size, 4);
  const operativeEntries = [...privateStates.entries()].filter(([, state]) => state.faction === "operative");
  assert.equal(operativeEntries.length, 1, "four-player games clamp to one Operative");
  const [operativeIndex, operativeState] = operativeEntries[0];
  const crewEntries = [...privateStates.entries()].filter(([, state]) => state.faction === "crew");
  assert.equal(crewEntries.length, 3);
  assert.ok(operativeState.tasks.every((task) => task.fake), "Operative assignments are marked fake only in private state");
  assert.ok(crewEntries.every(([, state]) => state.tasks.every((task) => !task.fake)));

  const [crewIndex, crewState] = crewEntries[0];
  const initialPosition = { ...crewState.position };
  const movement = { x: initialPosition.x <= 0 ? -1 : 1, z: 0 };
  const movedSnapshot = waitFor(
    sockets[crewIndex],
    "worldSnapshot",
    (snapshot) => snapshot.players.some((player) =>
      player.id === crewState.id
      && player.seq === 501
      && Math.hypot(player.x - initialPosition.x, player.z - initialPosition.z) > 0.05
    ),
    8_000
  );
  sockets[crewIndex].emit("playerInput", { ...movement, yaw: Math.atan2(movement.x, movement.z), seq: 501 });
  const movedPlayer = (await movedSnapshot).players.find((player) => player.id === crewState.id);
  assert.ok(Math.hypot(movedPlayer.x - initialPosition.x, movedPlayer.z - initialPosition.z) > 0.05, "movement intent is reflected by a server snapshot");
  assert.equal(movedPlayer.seq, 501);

  const rejectedElimination = await requestResult(sockets[crewIndex], "eliminationAttempt", { targetId: operativeState.id });
  assert.deepEqual(rejectedElimination, { ok: false, error: "Elimination is unavailable." });
});
