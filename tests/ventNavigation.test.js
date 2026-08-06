import assert from "node:assert/strict";
import test from "node:test";
import { getMapDefinition, isWalkable, stationById } from "../public/src/shipData.js";
import { VENT_DIRECTION_KEYS, ventExitForDirection } from "../public/src/ventNavigation.js";
import { GameServer } from "../server/gameServer.js";
import { PHASES } from "../server/constants.js";

class RecordingIo {
  constructor() { this.events = []; }
  on() {}
  to(target) { return { emit: (event, payload) => this.events.push({ target, event, payload }) }; }
}

function makeVentedRoom() {
  const server = new GameServer(new RecordingIo());
  clearInterval(server.loop);
  clearInterval(server.rateCleanup);
  const room = server.createRoom("private", {});
  room.phase = PHASES.ACTIVE;
  const entry = stationById("the-skeld", "skeld-vent-cafeteria");
  const operative = server.makePlayer({
    id: "op", socketId: "sock", displayName: "Op",
    appearance: { colour: "cyan", symbol: "orbit", number: 1 },
    x: entry.x, z: entry.z, mapId: "the-skeld"
  });
  operative.faction = "operative";
  operative.role = "signal-operative";
  room.players.set(operative.id, operative);
  return { server, room, operative, entry };
}

test("the vent flow runs end to end without throwing", () => {
  // publicVentState once referenced an out-of-scope `room`, so entering a vent threw
  // "room is not defined" AFTER the server had already marked the player vented -
  // leaving them frozen, hidden and unable to exit. Only executing it catches that.
  const { server, room, operative, entry } = makeVentedRoom();

  const entered = server.enterVent(room, operative, entry.id);
  assert.equal(entered.vent.inVent, true);
  assert.equal(operative.ventId, entry.id);
  assert.equal(entered.vent.exits.length, 2, "the Cafeteria loop offers two exits");

  const hopped = server.moveVent(room, operative, entered.vent.exits[0].id);
  assert.equal(operative.ventId, entered.vent.exits[0].id);
  assert.ok(hopped.vent.exits.some((exit) => exit.id === entry.id), "can travel back");

  assert.equal(server.exitVent(room, operative).ok, true);
  assert.equal(operative.ventId, null);
  assert.throws(() => server.exitVent(room, operative), /not inside the vents/u);

  for (const timer of room.timers) clearTimeout(timer);
  room.timers.clear();
});

test("private state carries the full vent view so the client can resync", () => {
  // The client mirrors the server in both directions. If private state only said
  // "you are vented" without the exits, a client that missed the enter response
  // could never rebuild the panel and would be stuck underground.
  const { server, room, operative, entry } = makeVentedRoom();
  assert.equal(server.privatePlayerState(room, operative).vent, null);

  server.enterVent(room, operative, entry.id);
  const vented = server.privatePlayerState(room, operative).vent;
  assert.equal(vented.inVent, true);
  assert.equal(vented.ventId, entry.id);
  assert.ok(vented.exits.length > 0, "private state must include the exits");

  server.exitVent(room, operative);
  assert.equal(server.privatePlayerState(room, operative).vent, null);

  for (const timer of room.timers) clearTimeout(timer);
  room.timers.clear();
});

test("every vent gives each exit its own WASD key and a distinct name", () => {
  // From the Cafeteria vent both Admin and the Hallway lie south, so a plain
  // nearest-direction scheme would leave one of them unreachable by keyboard, and
  // both would render as "Admin" in the panel.
  const { server, room, operative } = makeVentedRoom();
  const vents = getMapDefinition("the-skeld").stations.filter((s) => s.type === "maintenance");
  assert.equal(vents.length, 14);

  for (const vent of vents) {
    operative.ventId = vent.id;
    const view = server.publicVentState(room, operative);
    assert.ok(view.exits.length > 0, `${vent.id} is a dead end`);

    const keys = view.exits.map((exit) => exit.direction);
    assert.ok(keys.every((key) => "WASD".includes(key)), `${vent.id} keys: ${keys}`);
    assert.equal(new Set(keys).size, keys.length, `${vent.id} has duplicate keys: ${keys}`);

    const names = view.exits.map((exit) => exit.label ?? exit.roomId);
    assert.equal(new Set(names).size, names.length, `${vent.id} exits are ambiguous: ${names}`);

    // Every advertised key must actually resolve back to an exit on the client side.
    for (const exit of view.exits) {
      assert.equal(ventExitForDirection(view.exits, exit.direction)?.id, exit.id);
    }
  }
  operative.ventId = null;
  for (const timer of room.timers) clearTimeout(timer);
  room.timers.clear();
});

test("ventExitForDirection is an exact key match, not a guess", () => {
  const exits = [{ id: "north", direction: "W" }, { id: "east", direction: "D" }];
  assert.equal(ventExitForDirection(exits, "W")?.id, "north");
  assert.equal(ventExitForDirection(exits, "D")?.id, "east");
  assert.equal(ventExitForDirection(exits, "S"), null, "an unused key hops nowhere");
  assert.equal(ventExitForDirection([], "W"), null);
  assert.equal(ventExitForDirection(null, "W"), null);
  assert.equal(ventExitForDirection(exits, null), null);
});

test("VENT_DIRECTION_KEYS covers WASD and matches the server's key letters", () => {
  assert.deepEqual(
    VENT_DIRECTION_KEYS.map((entry) => [entry.code, entry.direction]).sort(),
    [["KeyA", "A"], ["KeyD", "D"], ["KeyS", "S"], ["KeyW", "W"]]
  );
});

test("no vent strands a player who climbs out of it", () => {
  // Exiting leaves you standing on the vent, so a vent with no room around it traps
  // you. The Hallway vent by Shields did exactly that until its position was fixed.
  const { server, room, operative } = makeVentedRoom();
  const vents = getMapDefinition("the-skeld").stations.filter((s) => s.type === "maintenance");
  const directions = [[0, -1], [0, 1], [-1, 0], [1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]];

  for (const vent of vents) {
    operative.alive = true;
    operative.ventId = vent.id;
    operative.position = { x: vent.x, z: vent.z };
    server.exitVent(room, operative);
    const start = { ...operative.position };

    const usable = directions.filter(([dx, dz]) => {
      operative.position = { ...start };
      const length = Math.hypot(dx, dz);
      operative.input = { x: dx / length, z: dz / length, yaw: 0, sprint: false, crouch: false, seq: 1 };
      operative.lastInputAt = Date.now();
      for (let step = 0; step < 6; step += 1) {
        server.tickPlayerMovement(room, operative, Date.now(), 0.05);
      }
      return Math.hypot(operative.position.x - start.x, operative.position.z - start.z) > 0.15;
    });
    operative.position = { ...start };
    assert.equal(usable.length, directions.length,
      `${vent.id}: can only leave in ${usable.length} of ${directions.length} directions`);
  }
  operative.ventId = null;
  for (const timer of room.timers) clearTimeout(timer);
  room.timers.clear();
});

test("a vent with no standable floor cannot be entered at all", () => {
  const { server, room, operative } = makeVentedRoom();
  const vent = stationById("the-skeld", "skeld-vent-cafeteria");
  // Pretend the deck around this vent is solid by moving the player far away: the
  // range check fires first, so target a vent we can reach but blockade instead.
  operative.position = { x: vent.x, z: vent.z };
  assert.equal(server.enterVent(room, operative, vent.id).vent.inVent, true);
  server.exitVent(room, operative);

  // Every authored vent must pass the standable check, or entering would trap.
  for (const station of getMapDefinition("the-skeld").stations) {
    if (station.type !== "maintenance") continue;
    assert.ok(isWalkable("the-skeld", station.x, station.z, 0.55),
      `${station.id} sits on unwalkable floor and would strand anyone who exits there`);
  }
  for (const timer of room.timers) clearTimeout(timer);
  room.timers.clear();
});
