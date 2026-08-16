import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { discoverMigrations, runMigrations } from "../database/migrate.js";

test("numbered migrations are discovered in deterministic order with checksums", async () => {
  const directory = fileURLToPath(new URL("../database/migrations/", import.meta.url));
  const migrations = await discoverMigrations(directory);
  assert.ok(migrations.length >= 2);
  assert.equal(migrations[0].name, "001_initial_schema.sql");
  assert.equal(migrations[1].name, "002_match_player_slots.sql");
  assert.match(migrations[0].checksum, /^[0-9a-f]{64}$/u);
  assert.match(migrations[0].sql, /failed_login_attempts/);
  assert.match(migrations[0].sql, /accounts_role_check/);
  assert.match(migrations[1].sql, /map_id SET DEFAULT 'the-skeld'/);
  assert.match(migrations[1].sql, /ADD COLUMN IF NOT EXISTS slot_index smallint/);
  assert.doesNotMatch(
    migrations[1].sql,
    /ALTER COLUMN slot_index SET NOT NULL/,
    "the expand migration must remain compatible with the previous writer during a rolling deploy"
  );
});

test("the migration runner records each version once and skips an identical replay", async () => {
  const versions = new Map();
  let schemaExecutions = 0;
  const client = {
    async query(sql, params = []) {
      if (String(sql).startsWith("SELECT checksum")) {
        const checksum = versions.get(params[0]);
        return { rowCount: checksum ? 1 : 0, rows: checksum ? [{ checksum }] : [] };
      }
      if (String(sql).startsWith("INSERT INTO schema_migrations")) {
        versions.set(params[0], params[2]);
        return { rowCount: 1, rows: [] };
      }
      if (String(sql).includes("CREATE EXTENSION IF NOT EXISTS pgcrypto")) schemaExecutions += 1;
      return { rowCount: 0, rows: [] };
    }
  };
  const transaction = (callback) => callback(client);

  const first = await runMigrations({ transaction });
  const second = await runMigrations({ transaction });
  assert.deepEqual(first.applied, ["001", "002"]);
  assert.deepEqual(second.applied, []);
  assert.equal(schemaExecutions, 1);
});
