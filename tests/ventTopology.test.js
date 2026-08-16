import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  addMinedVent, normaliseVentTopology, sealVent, usableRuntimeVents, ventIsSealed
} from "../public/src/ventTopology.js";

test("runtime vent topology deduplicates reconnect state and rejects malformed coordinates", () => {
  const topology = normaliseVentTopology({
    minedVents: [
      { id: "mined-1", x: 1, z: 2, roomId: "cafeteria" },
      { id: "mined-1", x: 3, z: 4, roomId: "admin" },
      { id: "invalid", x: "not-a-number", z: 0 }
    ],
    sealedVentIds: ["mined-1", "mined-1", null]
  });
  assert.deepEqual(topology.minedVents.map(({ id, x, z }) => ({ id, x, z })), [
    { id: "mined-1", x: 3, z: 4 }
  ]);
  assert.deepEqual(topology.sealedVentIds, ["mined-1"]);
});

test("live mine and seal events update usable interaction targets", () => {
  let topology = addMinedVent(null, { id: "mined-a", x: 1, z: 2, roomId: "storage" });
  topology = addMinedVent(topology, { id: "mined-b", x: 2, z: 3, roomId: "storage" });
  assert.deepEqual(usableRuntimeVents(topology).map(({ id }) => id), ["mined-a", "mined-b"]);
  topology = sealVent(topology, "mined-a");
  assert.equal(ventIsSealed(topology, "mined-a"), true);
  assert.deepEqual(usableRuntimeVents(topology).map(({ id }) => id), ["mined-b"]);
});

test("the browser listens for runtime vent changes and releases task UI for meetings", async () => {
  const source = await readFile(new URL("../public/src/game.js", import.meta.url), "utf8");
  assert.match(source, /network\.on\("ventMined"/u);
  assert.match(source, /network\.on\("ventSealed"/u);
  assert.match(source, /network\.on\("meetingStarted"[\s\S]*?closeTaskInterfaces\(\)[\s\S]*?showMeeting/u);
  assert.match(source, /resetTaskInterfaces\(\)\s*\{\s*this\.closeTaskInterfaces\(\);\s*resetMinigameState\(\)/u,
    "only match-level cleanup clears delayed minigame progress");
  assert.match(source, /nearestInteractable\(map, local, this\.latestIncidents, null, this\.ventTopology\)/u);
});

test("room serialisation includes mined and sealed vents for reconnects", async () => {
  const source = await readFile(new URL("../server/gameServer.js", import.meta.url), "utf8");
  assert.match(source, /ventTopology:\s*\{[\s\S]*?minedVents:[\s\S]*?sealedVentIds:/u);
});
