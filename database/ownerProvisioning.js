import { isDatabaseConfigured, withTransaction } from "./database.js";

export function configuredOwnerIdentity(environment = process.env) {
  const accountId = String(environment.ORBIT_OWNER_ACCOUNT_ID ?? "").trim();
  const email = String(environment.ORBIT_OWNER_EMAIL ?? "").trim().toLowerCase();
  if (!accountId && !email) return null;
  if (environment.NODE_ENV === "production" && !accountId) {
    throw new Error("Production owner provisioning requires ORBIT_OWNER_ACCOUNT_ID; email bootstrap is development-only.");
  }
  if (accountId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(accountId)) {
    throw new Error("ORBIT_OWNER_ACCOUNT_ID must be a UUID.");
  }
  return accountId ? { kind: "id", value: accountId } : { kind: "email", value: email };
}

export async function provisionConfiguredOwner({
  environment = process.env,
  databaseConfigured = isDatabaseConfigured(),
  transaction = withTransaction
} = {}) {
  if (!databaseConfigured) return { configured: false };
  const identity = configuredOwnerIdentity(environment);
  if (!identity) return { configured: false };

  return transaction(async (client) => {
    const account = await client.query(
      identity.kind === "id"
        ? "SELECT id, email FROM accounts WHERE id = $1 LIMIT 1"
        : "SELECT id, email FROM accounts WHERE lower(email) = lower($1) LIMIT 1",
      [identity.value]
    );
    if (!account.rowCount) {
      return { configured: true, found: false };
    }

    // This deployment has one configured owner. Retire any stale display-name-
    // provisioned owner before promoting the account identified by immutable id
    // or verified email.
    await client.query(
      "UPDATE accounts SET role = 'player', updated_at = now() WHERE role = 'owner' AND id <> $1",
      [account.rows[0].id]
    );
    const updated = await client.query(
      "UPDATE accounts SET role = 'owner', updated_at = now() WHERE id = $1 AND role <> 'owner' RETURNING id",
      [account.rows[0].id]
    );
    return { configured: true, found: true, updated: Boolean(updated.rowCount) };
  });
}
