import { isDatabaseConfigured, withTransaction } from "./database.js";

// These are the game-owner account details supplied by the project owner.  Keep
// the operation idempotent so a Render restart can safely finish provisioning
// after a database restore or a first deployment.
const ORBIT_OWNER_DISPLAY_NAME = "orbit op";
export async function provisionConfiguredOwner() {
  if (!isDatabaseConfigured()) return { configured: false };

  return withTransaction(async (client) => {
    // Older deployments accepted only player/moderator/admin.  Upgrade that
    // check before assigning the distinct owner role.
    await client.query("ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_role_check");
    await client.query(
      "ALTER TABLE accounts ADD CONSTRAINT accounts_role_check CHECK (role IN ('player', 'moderator', 'admin', 'owner'))"
    );
    const account = await client.query(
      "SELECT id, display_name FROM accounts WHERE lower(display_name) = lower($1) LIMIT 1",
      [ORBIT_OWNER_DISPLAY_NAME]
    );
    if (!account.rowCount) return { configured: true, found: false };

    const updated = await client.query(
      "UPDATE accounts SET role = 'owner', updated_at = now() WHERE id = $1 AND role <> 'owner' RETURNING id",
      [account.rows[0].id]
    );
    return { configured: true, found: true, updated: Boolean(updated.rowCount) };
  });
}
