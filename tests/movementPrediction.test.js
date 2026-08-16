import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { LocalMovementPredictor } from "../public/src/localMovementPredictor.js";
import { advancePlayerPosition, PLAYER_SPEED } from "../public/src/movementPhysics.js";
import { getMapDefinition, isWalkable, LOBBY_MAP_ID } from "../public/src/shipData.js";
import { GameServer } from "../server/gameServer.js";

class SilentIo {
  on() {}
  to() { return { emit() {} }; }
}

let gameServer;

afterEach(() => {
  if (!gameServer) return;
  clearInterval(gameServer.loop);
  clearInterval(gameServer.rateCleanup);
  for (const room of gameServer.rooms.values()) gameServer.destroyRoom(room);
  gameServer = null;
});

test("shared movement advances immediately and slides along blocked axes", () => {
  const moved = advancePlayerPosition({
    position: { x: 0, z: 0 },
    input: { x: 1, z: 0, crouch: false },
    delta: 0.05,
    faction: "crew",
    settings: { crewSpeed: 1 },
    isPositionValid: () => true,
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }
  });
  assert.equal(moved.x, PLAYER_SPEED.walk * 0.05);
  assert.equal(moved.z, 0);

  const slid = advancePlayerPosition({
    position: { x: 0, z: 0 },
    input: { x: 1, z: 1, crouch: false },
    delta: 0.05,
    faction: "crew",
    settings: { crewSpeed: 1 },
    isPositionValid: (x, z) => z === 0 && x > 0,
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }
  });
  assert.ok(slid.x > 0);
  assert.equal(slid.z, 0);
});

test("prediction keeps unacknowledged motion after a small server correction", () => {
  const predictor = new LocalMovementPredictor();
  predictor.reset({ x: 0, z: 0, seq: 0 });
  const context = {
    input: { x: 1, z: 0, crouch: false },
    delta: 0.05,
    faction: "crew",
    settings: { crewSpeed: 1 },
    isPositionValid: () => true,
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }
  };
  predictor.advance(context);
  predictor.recordInput(1);
  predictor.advance(context);
  predictor.recordInput(2);

  const result = predictor.reconcile({ x: 0.3, z: 0, seq: 1 });
  assert.equal(result.snapped, false);
  assert.ok(predictor.position.x > 0.3, "the second, unacknowledged input remains visible");
  assert.deepEqual(predictor.history.map((entry) => entry.seq), [2]);
});

test("a rejected client move rubber-bands to the authoritative position", () => {
  const predictor = new LocalMovementPredictor({ snapDistance: 0.2 });
  predictor.reset({ x: 0, z: 0, seq: 0 });
  predictor.advance({
    input: { x: 1, z: 0, crouch: false },
    delta: 0.05,
    faction: "crew",
    settings: { crewSpeed: 1 },
    isPositionValid: () => true,
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }
  });
  predictor.recordInput(1);

  const result = predictor.reconcile({ x: 0, z: 0, seq: 1 });
  assert.equal(result.snapped, true);
  assert.deepEqual(predictor.position, { x: 0, z: 0 });
  assert.deepEqual(predictor.history, []);
});

test("disconnect clears local drift and the first reconnect snapshot becomes the new anchor", () => {
  const predictor = new LocalMovementPredictor();
  predictor.reset({ x: 2, z: 3, seq: 100 });
  predictor.advance({
    input: { x: 1, z: 0, crouch: false },
    delta: 0.05,
    faction: "crew",
    settings: { crewSpeed: 1 },
    isPositionValid: () => true,
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }
  });
  predictor.clear();
  assert.equal(predictor.advance({}), null, "prediction cannot drift while disconnected");

  const reconciled = predictor.reconcile({ x: 5, z: 6, seq: 0 }, { force: true });
  assert.equal(reconciled.snapped, true);
  assert.deepEqual(predictor.position, { x: 5, z: 6 });
  assert.equal(predictor.lastAcknowledgedSeq, 0);
});

test("room resume resets stale server movement sequences before accepting seq one", async () => {
  gameServer = new GameServer(new SilentIo());
  const room = gameServer.createRoom("private", {});
  const map = getMapDefinition(LOBBY_MAP_ID);
  const [x, z] = map.spawnPoints[0];
  const member = gameServer.makePlayer({
    id: "resuming", socketId: "old-socket", displayName: "Resuming Guest", appearance: {},
    x, z, mapId: LOBBY_MAP_ID
  });
  member.faction = "crew";
  member.lastInputSeq = 100;
  member.lastClientMoveSeq = 100;
  member.lastClientMoveAt = 900;
  member.lastClientPosition = { x, z };
  member.connected = false;
  const token = gameServer.rotateRejoinToken(member);
  room.players.set(member.id, member);
  const temporaryBotHost = gameServer.makePlayer({
    id: "temporary-bot-host", socketId: null, displayName: "Temporary Bot", appearance: {},
    x, z, mapId: LOBBY_MAP_ID, bot: true
  });
  room.players.set(temporaryBotHost.id, temporaryBotHost);
  room.hostId = temporaryBotHost.id;

  const socket = {
    id: "new-socket",
    data: { auth: { accountId: null, displayName: member.displayName, guest: true } },
    join() {}
  };
  const resumed = await gameServer.resumeRoom(socket, token);
  assert.equal(resumed.playerId, member.id);
  assert.equal(room.hostId, member.id, "a returning human reclaims hosting from a temporary bot host");
  assert.equal(member.lastInputSeq, 0);
  assert.equal(member.lastClientMoveSeq, -1);
  assert.equal(gameServer.acceptClientPrediction(
    room,
    member,
    { x, z },
    { x: 0, z: 0, yaw: 0, crouch: false, seq: 1 },
    1_000
  ), true);

  const sameSocketRetry = await gameServer.resumeRoom(socket, token);
  assert.equal(sameSocketRetry.playerId, member.id);
  assert.equal(sameSocketRetry.rejoinToken, token,
    "a lost ack can be retried idempotently on the already-restored socket");

  // If the first resume ack is lost, the browser still holds the original
  // token. One previous generation remains valid only for this retry.
  member.connected = false;
  member.socketId = null;
  const retried = await gameServer.resumeRoom({
    id: "retry-socket",
    data: { auth: { accountId: null, displayName: member.displayName, guest: true } },
    join() {}
  }, token);
  assert.equal(retried.playerId, member.id);
  member.connected = false;
  const previousGenerationRetry = await gameServer.resumeRoom({
    id: "previous-generation-socket",
    data: { auth: { accountId: null, displayName: member.displayName, guest: true } },
    join() {}
  }, token);
  assert.equal(previousGenerationRetry.playerId, member.id);
  member.connected = false;
  member.previousRejoinTokenExpiresAt = Date.now() - 1;
  await assert.rejects(
    () => gameServer.resumeRoom({
      id: "expired-previous-token-socket",
      data: { auth: { accountId: null, displayName: member.displayName, guest: true } },
      join() {}
    }, retried.rejoinToken),
    /expired/u,
    "the previous token's acknowledgement-loss grace is time-bounded"
  );
  await assert.rejects(
    () => gameServer.resumeRoom({
      id: "stale-token-socket",
      data: { auth: { accountId: null, displayName: member.displayName, guest: true } },
      join() {}
    }, token),
    /expired/u,
    "the original token expires after its one idempotent retry"
  );
});

test("the server accepts a plausible prediction and rejects a teleport", () => {
  gameServer = new GameServer(new SilentIo());
  const room = gameServer.createRoom("practice", {});
  const map = getMapDefinition(LOBBY_MAP_ID);
  const spawn = map.spawnPoints[0];
  const member = gameServer.makePlayer({
    id: "local",
    socketId: "socket-local",
    displayName: "Local",
    appearance: {},
    x: spawn[0],
    z: spawn[1],
    mapId: LOBBY_MAP_ID
  });
  member.faction = "crew";
  room.players.set(member.id, member);
  const input = { x: 0, z: 0, yaw: 0, crouch: false, seq: 1 };
  const valid = { x: spawn[0], z: spawn[1] };

  assert.equal(gameServer.acceptClientPrediction(room, member, valid, input, 1_000), true);
  assert.deepEqual(member.position, valid);
  assert.equal(gameServer.acceptClientPrediction(room, member, valid, input, 1_050), false, "stale sequences are ignored");
  const nearby = [
    { x: spawn[0] + 0.25, z: spawn[1] },
    { x: spawn[0] - 0.25, z: spawn[1] },
    { x: spawn[0], z: spawn[1] + 0.25 },
    { x: spawn[0], z: spawn[1] - 0.25 }
  ].find(({ x, z }) => isWalkable(LOBBY_MAP_ID, x, z));
  assert.ok(nearby);
  assert.equal(gameServer.acceptClientPrediction(room, member, nearby, { ...input, seq: 2 }, 1_050), true);
  member.input = { x: 1, z: 0, yaw: 0, crouch: false, seq: 2 };
  member.lastInputAt = 1_050;
  gameServer.tickPlayerMovement(room, member, 1_050, 0.05);
  assert.deepEqual(member.position, nearby, "the authoritative tick does not apply accepted movement twice");
  assert.equal(gameServer.acceptClientPrediction(
    room,
    member,
    { x: spawn[0] + 20, z: spawn[1] + 20 },
    { ...input, seq: 3 },
    1_100
  ), false);
  assert.deepEqual(member.position, nearby);
});

test("the first predicted movement packet accepts normal 60 FPS send cadence", () => {
  gameServer = new GameServer(new SilentIo());
  const room = gameServer.createRoom("practice", {});
  const map = getMapDefinition(LOBBY_MAP_ID);
  const [x, z] = map.spawnPoints[0];
  const member = gameServer.makePlayer({
    id: "first-packet", socketId: "socket-first-packet", displayName: "First packet", appearance: {},
    x, z, mapId: LOBBY_MAP_ID
  });
  member.faction = "crew";
  room.players.set(member.id, member);

  const proposed = { x: x + PLAYER_SPEED.walk / 15, z };
  assert.equal(isWalkable(LOBBY_MAP_ID, proposed.x, proposed.z), true);
  assert.equal(gameServer.acceptClientPrediction(
    room,
    member,
    proposed,
    { x: 1, z: 0, yaw: 0, crouch: false, seq: 1 },
    1_000
  ), true, "a first packet containing four 60 FPS frames is legitimate");
});
