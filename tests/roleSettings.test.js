import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DEFAULT_ROLE_SETTINGS, normaliseRoleSettings, rolePoolForFaction } from "../public/src/roleSettings.js";
import { GameServer } from "../server/gameServer.js";
import { validateSettings } from "../server/validation.js";

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

test("role settings clamp amounts and odds and discard unknown roles", () => {
  const settings = validateSettings({
    roleSettings: {
      medic: { count: 99, chance: -12 },
      "not-a-role": { count: 4, chance: 100 }
    }
  }).roleSettings;
  assert.deepEqual(settings.medic, { count: 4, chance: 0 });
  assert.equal(settings["not-a-role"], undefined);
  assert.equal(Object.keys(settings).length, Object.keys(DEFAULT_ROLE_SETTINGS).length);
});

test("each configured role copy rolls its own odds", () => {
  const settings = normaliseRoleSettings();
  for (const rule of Object.values(settings)) {
    rule.count = 0;
    rule.chance = 0;
  }
  settings.medic = { count: 3, chance: 50 };
  const rolls = [0.1, 0.75, 0.49];
  assert.deepEqual(rolePoolForFaction("crew", settings, () => rolls.shift()), ["medic", "medic"]);
});

test("match drafting honors per-role maximums and uses the base role for remaining slots", () => {
  gameServer = new GameServer(new SilentIo());
  const roleSettings = normaliseRoleSettings();
  for (const rule of Object.values(roleSettings)) {
    rule.count = 0;
    rule.chance = 0;
  }
  roleSettings.medic = { count: 2, chance: 100 };
  roleSettings["signal-operative"] = { count: 1, chance: 100 };
  const room = gameServer.createRoom("practice", { operativeCount: 1, roleSettings });
  const spawn = room.mapId === "the-skeld" ? [-1.1, -25] : [0, 0];
  for (let index = 0; index < 5; index += 1) {
    const member = gameServer.makePlayer({
      id: `member-${index}`,
      socketId: `socket-${index}`,
      displayName: `Member ${index}`,
      appearance: {},
      x: spawn[0],
      z: spawn[1],
      mapId: room.mapId,
      bot: index > 0
    });
    room.players.set(member.id, member);
  }

  gameServer.startMatch(room);
  const crewRoles = [...room.players.values()].filter((member) => member.faction === "crew").map((member) => member.role);
  assert.equal(crewRoles.filter((role) => role === "medic").length, 2);
  assert.ok(crewRoles.every((role) => ["medic", "operations-crew"].includes(role)));
});
