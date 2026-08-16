import { query } from "../database.js";

// Friendships are stored one row per pair with the ids ordered, so the unique
// index genuinely prevents duplicates - including the reciprocal request that
// arrives when two people add each other at the same moment.
function orderedPair(a, b) {
  return String(a) < String(b) ? [a, b] : [b, a];
}

export async function requestFriendship(requesterId, addresseeId) {
  if (String(requesterId) === String(addresseeId)) throw new Error("You cannot add yourself.");
  const [lower, higher] = orderedPair(requesterId, addresseeId);
  // Both people adding each other resolves to accepted rather than to a second
  // pending row that neither can answer.
  const result = await query(
    `INSERT INTO friendships (lower_account_id, higher_account_id, requested_by, status)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (lower_account_id, higher_account_id) DO UPDATE
       SET status = CASE
             WHEN friendships.status = 'pending' AND friendships.requested_by <> EXCLUDED.requested_by
               THEN 'accepted'
             ELSE friendships.status
           END,
           responded_at = CASE
             WHEN friendships.status = 'pending' AND friendships.requested_by <> EXCLUDED.requested_by
               THEN now()
             ELSE friendships.responded_at
           END
     RETURNING id, status, requested_by`,
    [lower, higher, requesterId]
  );
  return result.rows[0];
}

export async function respondToFriendship(accountId, friendshipId, accept) {
  if (!accept) {
    const removed = await query(
      `DELETE FROM friendships
        WHERE id = $1 AND status = 'pending' AND requested_by <> $2
          AND $2 IN (lower_account_id, higher_account_id)
        RETURNING id`,
      [friendshipId, accountId]
    );
    return { removed: removed.rowCount > 0, accepted: false };
  }
  // Only the person who did not send it may accept it.
  const result = await query(
    `UPDATE friendships SET status = 'accepted', responded_at = now()
      WHERE id = $1 AND status = 'pending' AND requested_by <> $2
        AND $2 IN (lower_account_id, higher_account_id)
      RETURNING id`,
    [friendshipId, accountId]
  );
  return { removed: false, accepted: result.rowCount > 0 };
}

export async function removeFriendship(accountId, friendshipId) {
  const result = await query(
    `DELETE FROM friendships
      WHERE id = $1 AND $2 IN (lower_account_id, higher_account_id) RETURNING id`,
    [friendshipId, accountId]
  );
  return result.rowCount > 0;
}

export async function listFriends(accountId) {
  const result = await query(
    `SELECT f.id, f.status, f.requested_by,
            other.id AS account_id, other.display_name, other.last_login_at
       FROM friendships f
       JOIN accounts other
         ON other.id = CASE WHEN f.lower_account_id = $1 THEN f.higher_account_id ELSE f.lower_account_id END
      WHERE $1 IN (f.lower_account_id, f.higher_account_id)
        AND other.account_status = 'active'
      ORDER BY f.status DESC, other.display_name ASC
      LIMIT 200`,
    [accountId]
  );
  return result.rows.map((row) => ({
    friendshipId: row.id,
    accountId: row.account_id,
    displayName: row.display_name,
    status: row.status,
    // "They asked you" is what decides whether the UI offers Accept or Cancel.
    incoming: row.status === "pending" && String(row.requested_by) !== String(accountId),
    lastLoginAt: row.last_login_at
  }));
}

// People you have actually shared a match with, which is what makes adding a
// friend happen at all - nobody types a display name from memory.
export async function listRecentPlayers(accountId, { limit = 20 } = {}) {
  const result = await query(
    `SELECT DISTINCT ON (other.account_id)
            other.account_id, a.display_name, m.ended_at
       FROM match_players mine
       JOIN match_players other
         ON other.match_id = mine.match_id AND other.account_id <> mine.account_id
       JOIN matches m ON m.id = mine.match_id
       JOIN accounts a ON a.id = other.account_id
      WHERE mine.account_id = $1
        AND other.account_id IS NOT NULL
        AND a.account_status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM friendships f
           WHERE f.lower_account_id = LEAST($1, other.account_id)
             AND f.higher_account_id = GREATEST($1, other.account_id)
        )
      ORDER BY other.account_id, m.ended_at DESC
      LIMIT $2`,
    [accountId, Math.max(1, Math.min(50, Number(limit) || 20))]
  );
  return result.rows.map((row) => ({
    accountId: row.account_id,
    displayName: row.display_name,
    lastPlayedAt: row.ended_at
  }));
}
