import { query, withTransaction } from "../database.js";

const SAFE_ACCOUNT_COLUMNS = `id, email, display_name, account_status, role, created_at, last_login_at`;

export async function findAccountForLogin(email) {
  const result = await query(
    `SELECT id, email, password_hash, display_name, account_status, role, created_at, last_login_at
     FROM accounts WHERE lower(email) = lower($1) LIMIT 1`,
    [email]
  );
  return result.rows[0] ?? null;
}

export async function createAccount({ email, displayName, passwordHash }) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO accounts (email, display_name, password_hash)
       VALUES ($1, $2, $3) RETURNING ${SAFE_ACCOUNT_COLUMNS}`,
      [email, displayName, passwordHash]
    );
    const account = result.rows[0];
    await client.query(`INSERT INTO player_stats (account_id) VALUES ($1)`, [account.id]);
    await client.query(`INSERT INTO player_settings (account_id) VALUES ($1)`, [account.id]);
    return account;
  });
}

export async function touchLastLogin(accountId) {
  await query(`UPDATE accounts SET last_login_at = now(), updated_at = now() WHERE id = $1`, [accountId]);
}

export async function createSession({ accountId, tokenHash, expiresAt }) {
  await query(
    `INSERT INTO sessions (account_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [accountId, tokenHash, expiresAt]
  );
}

export async function findAccountBySession(tokenHash) {
  const result = await query(
    `UPDATE sessions s SET last_seen_at = now()
     FROM accounts a
     WHERE s.account_id = a.id AND s.token_hash = $1 AND s.revoked = false
       AND s.expires_at > now() AND a.account_status = 'active'
     RETURNING a.id, a.email, a.display_name, a.account_status, a.role, a.created_at, a.last_login_at`,
    [tokenHash]
  );
  return result.rows[0] ?? null;
}

export async function revokeSession(tokenHash) {
  await query(`UPDATE sessions SET revoked = true WHERE token_hash = $1`, [tokenHash]);
}

export async function getProfile(accountId) {
  const accountResult = await query(
    `SELECT ${SAFE_ACCOUNT_COLUMNS} FROM accounts WHERE id = $1`,
    [accountId]
  );
  if (!accountResult.rows[0]) return null;
  const [statsResult, settingsResult] = await Promise.all([
    query(`SELECT * FROM player_stats WHERE account_id = $1`, [accountId]),
    query(`SELECT * FROM player_settings WHERE account_id = $1`, [accountId])
  ]);
  return { account: accountResult.rows[0], stats: statsResult.rows[0], settings: settingsResult.rows[0] };
}

export async function updateSettings(accountId, settings) {
  const result = await query(
    `UPDATE player_settings SET
      master_volume = $2, music_volume = $3, sfx_volume = $4,
      mouse_sensitivity = $5, camera_distance = $6, invert_y = $7,
      graphics_quality = $8, show_fps = $9, show_ping = $10,
      colour_blind_mode = $11, reduced_motion = $12, screen_shake = $13,
      subtitles = $14, text_size = $15, keybinds_json = $16::jsonb, updated_at = now()
     WHERE account_id = $1 RETURNING *`,
    [
      accountId, settings.masterVolume, settings.musicVolume, settings.sfxVolume,
      settings.mouseSensitivity, settings.cameraDistance, settings.invertY,
      settings.graphicsQuality, settings.showFps, settings.showPing,
      settings.colourBlindMode, settings.reducedMotion, settings.screenShake,
      settings.subtitles, settings.textSize, JSON.stringify(settings.keybinds ?? {})
    ]
  );
  return result.rows[0] ?? null;
}
