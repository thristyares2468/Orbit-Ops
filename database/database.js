import pg from "pg";

const { Pool } = pg;
const hasDatabase = Boolean(process.env.DATABASE_URL);

const pool = hasDatabase ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  max: Math.max(1, Math.min(20, Number(process.env.DATABASE_POOL_MAX) || 10)),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
  statement_timeout: 10_000,
  application_name: "orbit-ops-render"
}) : null;

pool?.on("error", (error) => {
  console.error("Unexpected idle database client error:", error.message);
});

export function isDatabaseConfigured() {
  return Boolean(pool);
}

export async function query(text, params = []) {
  if (!pool) throw new Error("Database is not configured.");
  return pool.query(text, params);
}

export async function withTransaction(callback) {
  if (!pool) throw new Error("Database is not configured.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '10s'");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function checkDatabaseHealth() {
  if (!pool) return false;
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase() {
  await pool?.end();
}
