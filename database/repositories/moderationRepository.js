import { query } from "../database.js";

// Issuing and lifting the restrictions the rest of the server already enforces.
// Enforcement lives in accountsRepository.getActiveAccountRestrictions; this file
// is the only thing that writes to bans and mutes.

const TARGET_COLUMNS = `id, email, display_name, account_status, role`;

export async function findAccountByDisplayName(displayName) {
  const result = await query(
    `SELECT ${TARGET_COLUMNS} FROM accounts WHERE lower(display_name) = lower($1) LIMIT 1`,
    [displayName]
  );
  return result.rows[0] ?? null;
}

export async function findAccountById(accountId) {
  const result = await query(`SELECT ${TARGET_COLUMNS} FROM accounts WHERE id = $1`, [accountId]);
  return result.rows[0] ?? null;
}

// expiresAt null is a permanent restriction. Re-issuing against an already
// restricted account is allowed: the newest row wins because enforcement asks
// whether *any* active row exists.
export async function createRestriction(table, { accountId, reason, issuedBy, expiresAt = null }) {
  if (!["bans", "mutes"].includes(table)) throw new Error("Unknown restriction table.");
  const result = await query(
    `INSERT INTO ${table} (account_id, reason, issued_by, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, account_id, reason, issued_at, expires_at, active`,
    [accountId, reason, issuedBy ?? null, expiresAt]
  );
  return result.rows[0];
}

// Lifts every active restriction of that kind, so a second ban issued while the
// first was live cannot leave the account still restricted after an unban.
export async function revokeRestrictions(table, accountId) {
  if (!["bans", "mutes"].includes(table)) throw new Error("Unknown restriction table.");
  const result = await query(
    `UPDATE ${table} SET active = false WHERE account_id = $1 AND active = true RETURNING id`,
    [accountId]
  );
  return result.rowCount;
}

export async function listRestrictions(table, { limit = 50 } = {}) {
  if (!["bans", "mutes"].includes(table)) throw new Error("Unknown restriction table.");
  const result = await query(
    `SELECT r.id, r.account_id, a.display_name, r.reason, r.issued_at, r.expires_at,
            issuer.display_name AS issued_by_name
       FROM ${table} r
       JOIN accounts a ON a.id = r.account_id
       LEFT JOIN accounts issuer ON issuer.id = r.issued_by
      WHERE r.active = true AND (r.expires_at IS NULL OR r.expires_at > now())
      ORDER BY r.issued_at DESC
      LIMIT $1`,
    [Math.max(1, Math.min(200, Number(limit) || 50))]
  );
  return result.rows;
}

export async function setAccountRole(accountId, role) {
  if (!["player", "moderator", "admin", "owner"].includes(role)) throw new Error("Unknown role.");
  const result = await query(
    `UPDATE accounts SET role = $2, updated_at = now() WHERE id = $1 RETURNING ${TARGET_COLUMNS}`,
    [accountId, role]
  );
  return result.rows[0] ?? null;
}
