import { query } from "../database.js";

// The shared room-code directory. Claiming is a single insert that either wins
// or does not: two instances racing for the same code cannot both succeed,
// because the primary key decides it rather than a read-then-write.

export async function claimRoomCode(code, instanceId, ttlSeconds = 900) {
  const result = await query(
    `INSERT INTO active_room_codes (code, instance_id, expires_at)
     VALUES ($1, $2, now() + ($3::int * interval '1 second'))
     ON CONFLICT (code) DO UPDATE
       SET instance_id = EXCLUDED.instance_id,
           created_at = now(),
           expires_at = EXCLUDED.expires_at
     WHERE active_room_codes.expires_at <= now()
        OR active_room_codes.instance_id = EXCLUDED.instance_id
     RETURNING code`,
    [code, instanceId, Math.max(60, Math.min(86_400, Number(ttlSeconds) || 900))]
  );
  // No row means another live instance holds it; the caller tries a new code.
  return result.rowCount > 0;
}

export async function releaseRoomCode(code, instanceId) {
  const result = await query(
    `DELETE FROM active_room_codes WHERE code = $1 AND instance_id = $2 RETURNING code`,
    [code, instanceId]
  );
  return result.rowCount > 0;
}

// Renew every code this instance still has open. A room outliving its lease
// would otherwise have its code handed to somebody else mid-match.
export async function renewRoomCodes(codes, instanceId, ttlSeconds = 900) {
  if (!codes.length) return 0;
  const result = await query(
    `UPDATE active_room_codes
        SET expires_at = now() + ($3::int * interval '1 second')
      WHERE instance_id = $2 AND code = ANY($1::varchar[])`,
    [codes, instanceId, Math.max(60, Math.min(86_400, Number(ttlSeconds) || 900))]
  );
  return result.rowCount;
}

export async function releaseInstanceRoomCodes(instanceId) {
  const result = await query(`DELETE FROM active_room_codes WHERE instance_id = $1`, [instanceId]);
  return result.rowCount;
}

export async function sweepExpiredRoomCodes() {
  const result = await query(`DELETE FROM active_room_codes WHERE expires_at <= now()`);
  return result.rowCount;
}
