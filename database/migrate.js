import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { closeDatabase, isDatabaseConfigured, withTransaction } from "./database.js";

const MIGRATION_FILE = /^(\d{3,})_[a-z0-9_]+\.sql$/u;

export async function discoverMigrations(directory) {
  const names = (await readdir(directory))
    .filter((name) => MIGRATION_FILE.test(name))
    .sort((left, right) => left.localeCompare(right));
  if (!names.length) throw new Error("No numbered database migrations were found.");

  return Promise.all(names.map(async (name) => {
    const sql = await readFile(join(directory, name), "utf8");
    return {
      version: name.slice(0, name.indexOf("_")),
      name,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex")
    };
  }));
}

export async function runMigrations({
  directory = join(dirname(fileURLToPath(import.meta.url)), "migrations"),
  transaction = withTransaction
} = {}) {
  const migrations = await discoverMigrations(directory);
  const applied = [];

  await transaction((client) => client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version varchar(40) PRIMARY KEY,
       name text NOT NULL,
       checksum char(64) NOT NULL,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`
  ));

  for (const migration of migrations) {
    const didApply = await transaction(async (client) => {
      // Serialise concurrent deploys before checking and claiming a version.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('orbit_ops_schema_migrations'))");
      const existing = await client.query(
        "SELECT checksum FROM schema_migrations WHERE version = $1",
        [migration.version]
      );
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== migration.checksum) {
          throw new Error(`Migration ${migration.version} was modified after it was applied.`);
        }
        return false;
      }

      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
        [migration.version, migration.name, migration.checksum]
      );
      return true;
    });
    if (didApply) applied.push(migration.version);
  }

  return { applied, total: migrations.length };
}

async function main() {
  if (!isDatabaseConfigured()) {
    console.error("DATABASE_URL is not configured; migration was not run.");
    process.exitCode = 1;
    return;
  }
  try {
    const result = await runMigrations();
    console.log(`Orbit Ops database schema is up to date (${result.applied.length} applied).`);
  } catch (error) {
    console.error("Database migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
