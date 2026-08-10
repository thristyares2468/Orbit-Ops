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
