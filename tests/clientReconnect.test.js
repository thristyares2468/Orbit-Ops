import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { OrbitOpsGame } from "../public/src/game.js";
import { NetworkClient } from "../public/src/network.js";

class FakeSocket {
  constructor() {
    this.handlers = new Map();
    this.anyHandlers = [];
    this.id = "socket-a";
    this.sent = [];
  }

  onAny(handler) { this.anyHandlers.push(handler); }
  on(event, handler) { this.handlers.set(event, handler); }
  emit(event, payload, ack) { this.sent.push({ event, payload, ack }); }
  connect() {}
  trigger(event, payload) { this.handlers.get(event)?.(payload); }
}

const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.localStorage = originalLocalStorage;
});

test("disconnect rejects old acknowledgements immediately and ignores their late replies", async () => {
  const socket = new FakeSocket();
  globalThis.window = { io: () => socket };
  const network = new NetworkClient();
  socket.trigger("connect");

  const pending = network.request("resumeSession", { token: "old" }, 30_000);
  socket.trigger("disconnect", "transport close");
  await assert.rejects(pending, (error) => error.code === "NETWORK_DISCONNECTED");
  assert.equal(network.pendingRequests.size, 0);

  socket.id = "socket-b";
  socket.trigger("connect");
  socket.sent[0].ack({ ok: true, token: "too-late" });
  assert.equal(network.connectionGeneration, 3);
  clearInterval(network.pingTimer);
});

test("a newer connection generation waits out and replaces a stale reconnect attempt", async () => {
  let releaseOld;
  const oldAttempt = new Promise((resolve) => { releaseOld = resolve; });
  const attempts = [];
  const game = Object.create(OrbitOpsGame.prototype);
  game.auth = { guest: true, displayName: "Reconnect" };
  game.network = { connected: true, connectionGeneration: 1 };
  game.reconnectPromise = null;
  game.reconnectGeneration = -1;
  game.performSocketReconnect = async (generation) => {
    attempts.push(generation);
    if (generation === 1) await oldAttempt;
    return generation;
  };

  const first = game.reconnectSocketSession();
  game.network.connectionGeneration = 2;
  const second = game.reconnectSocketSession();
  releaseOld(false);

  assert.equal(await first, 1);
  assert.equal(await second, 2);
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(game.reconnectPromise, null);
});

test("an expired room reservation clears frozen local room state", async () => {
  const stored = new Map([["orbitOps.rejoinSession.v1", JSON.stringify({ token: "expired-token", displayName: "Crew" })]]);
  globalThis.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    removeItem: (key) => stored.delete(key),
    setItem: (key, value) => stored.set(key, value)
  };
  const calls = [];
  const game = Object.create(OrbitOpsGame.prototype);
  Object.assign(game, {
    auth: { displayName: "Crew" },
    network: {
      connected: true,
      request: async () => { throw new Error("The reserved room slot has expired."); }
    },
    socketSessionReady: true,
    room: { code: "ABC12" },
    playerId: "crew-id",
    privateState: { alive: true },
    awaitingAuthoritativeSnapshot: true,
    sceneReady: false,
    latestSnapshots: new Map([["crew-id", { x: 1, z: 1 }]]),
    localMovement: { clear: () => calls.push("movement") },
    input: { setEnabled: (enabled) => calls.push(`input:${enabled}`) },
    clearCharacters: OrbitOpsGame.prototype.clearCharacters,
    resetTaskInterfaces: () => calls.push("tasks"),
    ui: {
      showMainMenu: () => calls.push("menu"),
      toast: (message) => calls.push(message)
    }
  });

  assert.equal(await game.performRoomResume(), false);
  assert.equal(game.room, null);
  assert.equal(game.playerId, null);
  assert.equal(game.privateState, null);
  assert.equal(game.awaitingAuthoritativeSnapshot, false);
  assert.equal(stored.has("orbitOps.rejoinSession.v1"), false);
  assert.ok(calls.includes("menu"));
});
