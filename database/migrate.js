import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { closeDatabase, isDatabaseConfigured, withTransaction } from "./database.js";

if (!isDatabaseConfigured()) {
  console.error("DATABASE_URL is not configured; migration was not run.");
  process.exitCode = 1;
} else {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = await readFile(join(here, "schema.sql"), "utf8");
  try {
    await withTransaction((client) => client.query(sql));
    console.log("Orbit Ops database schema is up to date.");
  } catch (error) {
    console.error("Database migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
