import pg from "pg";

const { Pool } = pg;
const hasDatabase = Boolean(process.env.DATABASE_URL);

const SECURE_SSL_MODES = new Set(["true", "require", "verify-ca", "verify-full"]);
const DISABLED_SSL_MODES = new Set(["false", "disable"]);
const INSECURE_SSL_MODES = new Set(["insecure", "no-verify"]);
const CONNECTION_SSL_PARAMETERS = Object.freeze([
  "ssl", "sslmode", "sslcert", "sslkey", "sslrootcert", "sslpassword",
  "ssl_min_protocol_version", "ssl_max_protocol_version", "sslsni"
]);

export function databaseSslOptions(environment = process.env) {
  const mode = String(environment.DATABASE_SSL_MODE ?? environment.DATABASE_SSL ?? "verify-full")
    .trim()
    .toLowerCase();
  const production = environment.NODE_ENV === "production";

  if (DISABLED_SSL_MODES.has(mode)) {
    if (production) throw new Error("Production database connections cannot disable TLS.");
    return false;
  }
  if (INSECURE_SSL_MODES.has(mode)) {
    if (production) throw new Error("Production database connections must verify the server certificate.");
    return { rejectUnauthorized: false };
  }
  if (!SECURE_SSL_MODES.has(mode)) {
    throw new Error(`Unsupported DATABASE_SSL_MODE: ${mode || "(empty)"}.`);
  }

  const ca = String(environment.DATABASE_SSL_CA ?? "").replaceAll("\\n", "\n").trim();
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}

// node-postgres applies SSL parameters embedded in a connection URL after the
// explicit `ssl` option. A provider URL containing `sslmode=require` could
// therefore silently discard our CA and verification policy. Keep the address
// and credentials, but make DATABASE_SSL_MODE / DATABASE_SSL_CA the sole TLS
// authority for this process.
export function normaliseDatabaseConnectionString(connectionString) {
  let url;
  try {
    url = new URL(String(connectionString ?? ""));
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql scheme.");
  }
  for (const parameter of CONNECTION_SSL_PARAMETERS) url.searchParams.delete(parameter);
  return url.toString();
}

export function databasePoolConfig(environment = process.env) {
  if (!environment.DATABASE_URL) return null;
  return {
    connectionString: normaliseDatabaseConnectionString(environment.DATABASE_URL),
    ssl: databaseSslOptions(environment),
    max: Math.max(1, Math.min(20, Number(environment.DATABASE_POOL_MAX) || 10)),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 10_000,
    application_name: "orbit-ops-render"
  };
}

const poolConfig = hasDatabase ? databasePoolConfig() : null;
const pool = poolConfig ? new Pool(poolConfig) : null;

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
