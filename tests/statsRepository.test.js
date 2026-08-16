import assert from "node:assert/strict";
import { test } from "node:test";
import { recordMatch } from "../database/repositories/statsRepository.js";

function player(overrides = {}) {
  return {
    accountId: null,
    displayName: "Guest",
    role: "crew",
    faction: "crew",
    won: true,
    score: 12,
    connected: true,
    alive: true,
    survivalSeconds: 90,
    stats: {
      tasksCompleted: 2,
      sabotagesStarted: 0,
      sabotagesRepaired: 1,
      eliminations: 0,
      incidentsReported: 1,
      correctVotes: 1,
      incorrectVotes: 0
    },
    ...overrides
  };
}

test("recordMatch batches player history and account-stat writes while preserving the real map", async () => {
  const queries = [];
  const matchId = "11111111-1111-4111-8111-111111111111";
  const accountId = "22222222-2222-4222-8222-222222222222";
  const client = {
    async query(sql, values = []) {
      queries.push({ sql: String(sql), values });
      return queries.length === 1 ? { rows: [{ id: matchId }] } : { rows: [] };
    }
  };
  const transaction = (callback) => callback(client);

  const result = await recordMatch({
    roomCode: "ABCDE",
    startedAt: new Date("2026-08-14T00:00:00Z"),
    endedAt: new Date("2026-08-14T00:02:00Z"),
    winner: "crew",
    mapId: "the-skeld",
    durationSeconds: 120,
    summary: { reason: "tasks" },
    players: [
      player(),
      player({
        accountId,
        displayName: "Captain",
        role: "engineer",
        score: 20,
        alive: false,
        connected: false
      })
    ]
  }, { transaction });

  assert.equal(result, matchId);
  assert.equal(queries.length, 3, "one match insert, one player batch and one account-stat batch");
  assert.equal(queries[0].values[5], "the-skeld");
  assert.match(queries[1].sql, /slot_index/u);
  assert.match(queries[1].sql, /VALUES \([^)]*\),\([^)]*\)/u);
  assert.equal(queries[1].values.length, 34);
  assert.equal(queries[1].values[1], 0);
  assert.equal(queries[1].values[18], 1);
  assert.match(queries[2].sql, /UPDATE player_stats AS stats[\s\S]*FROM \(VALUES/u);
  assert.equal(queries[2].values.length, 13, "guests do not produce an aggregate-stat row");
  assert.equal(queries[2].values[0], accountId);
});
