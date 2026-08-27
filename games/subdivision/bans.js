// Last updated: 15 July 2026
// bans.js — ban enforcement + anti-cheat strike escalation.
//
// Bans live in Postgres but are enforced from an in-memory cache so the per-message
// check is O(1). Auto-actions may ban an ACCOUNT and/or the specific DEVICE that was
// in use — NEVER an IP or subnet (shared-network safe).

const db = require('./db');

const num = (name, def) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : def;
};

const STRIKE_TEMPBAN_AT = num('STRIKE_TEMPBAN_AT', 3);
const STRIKE_PERMABAN_AT = num('STRIKE_PERMABAN_AT', 5);

// In-memory cache.
let bannedAccounts = new Map(); // accountId(string) -> { reason, expiresAt }
let bannedDevices = new Map();  // deviceId -> { reason, expiresAt }

async function refresh() {
  if (!db.isEnabled()) return;
  try {
    const rows = await db.getActiveBans();
    const accts = new Map();
    const devs = new Map();
    for (const r of rows) {
      const exp = r.expires_at ? new Date(r.expires_at).getTime() : null;
      if (r.scope === 'account' && r.account_id != null) {
        accts.set(String(r.account_id), { reason: r.reason, expiresAt: exp });
      } else if (r.scope === 'device' && r.device_id) {
        devs.set(r.device_id, { reason: r.reason, expiresAt: exp });
      }
    }
    bannedAccounts = accts;
    bannedDevices = devs;
  } catch (e) {
    console.error('[bans] refresh failed:', e.message);
  }
}

function notExpired(entry) {
  if (!entry) return false;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) return false;
  return true;
}

function checkAccount(accountId) {
  const e = bannedAccounts.get(String(accountId));
  return notExpired(e) ? { banned: true, reason: e.reason, expiresAt: e.expiresAt } : { banned: false };
}

// Active (non-expired) account bans from the in-memory cache. Used to list bans
// when the DB is disabled (no username enrichment available in that mode).
function listActiveAccounts() {
  const out = [];
  for (const [accountId, e] of bannedAccounts) {
    if (notExpired(e)) out.push({ accountId, reason: e.reason, expiresAt: e.expiresAt || null });
  }
  return out;
}

function checkDevice(deviceId) {
  if (!deviceId) return { banned: false };
  const e = bannedDevices.get(deviceId);
  return notExpired(e) ? { banned: true, reason: e.reason, expiresAt: e.expiresAt } : { banned: false };
}

// Does a device/fingerprint resolve to any banned account? (signup/login gate)
async function deviceLinkedToBan(deviceId, fingerprint) {
  if (checkDevice(deviceId).banned) return { blocked: true, reason: 'device_banned' };
  if (!db.isEnabled()) return { blocked: false };
  try {
    const accts = await db.getAccountsForDeviceOrFingerprint(deviceId, fingerprint);
    for (const a of accts) {
      if (a.status === 'banned' || checkAccount(a.id).banned) {
        return { blocked: true, reason: 'linked_to_banned_account' };
      }
    }
  } catch (e) {
    console.error('[bans] deviceLinkedToBan failed:', e.message);
  }
  return { blocked: false };
}

async function banAccount({ accountId, deviceId, reason, byAdmin, expiresAt }) {
  if (db.isEnabled()) {
    await db.createBan({ scope: 'account', accountId, reason, byAdmin, expiresAt });
    if (deviceId) await db.createBan({ scope: 'device', deviceId, reason, byAdmin, expiresAt });
  }
  bannedAccounts.set(String(accountId), { reason, expiresAt: expiresAt ? new Date(expiresAt).getTime() : null });
  if (deviceId) bannedDevices.set(deviceId, { reason, expiresAt: expiresAt ? new Date(expiresAt).getTime() : null });
}

async function banDevice({ deviceId, reason, byAdmin, expiresAt }) {
  if (db.isEnabled()) await db.createBan({ scope: 'device', deviceId, reason, byAdmin, expiresAt });
  bannedDevices.set(deviceId, { reason, expiresAt: expiresAt ? new Date(expiresAt).getTime() : null });
}

async function unban({ banId, accountId, deviceId }) {
  if (db.isEnabled()) await db.liftBan({ banId, accountId, deviceId });
  if (accountId) bannedAccounts.delete(String(accountId));
  if (deviceId) bannedDevices.delete(deviceId);
  await refresh();
}

// ---------------------------------------------------------------------------
// Anti-cheat strike escalation. Called fire-and-forget from the hot path.
// `onAutoBan(accountId)` lets server.js kick any live socket immediately.
// ---------------------------------------------------------------------------
let onAutoBan = null;
function setAutoBanHandler(fn) { onAutoBan = fn; }

async function recordViolation(accountId, type, detail, deviceId) {
  if (!accountId) return;
  try {
    if (db.isEnabled()) {
      // Log + track strikes for admin visibility ONLY. Anti-cheat NEVER auto-bans —
      // false positives must never cost a player their account. A human admin reviews
      // strikes in /admin and bans manually. (STRIKE_TEMPBAN_AT / STRIKE_PERMABAN_AT
      // and onAutoBan are intentionally unused now.)
      await db.logViolation(accountId, type, detail, deviceId);
      await db.incStrikes(accountId, 1);
    }
  } catch (e) {
    console.error('[bans] recordViolation failed:', e.message);
  }
}

function startRefreshLoop(intervalMs = 30000) {
  refresh();
  const t = setInterval(refresh, intervalMs);
  t.unref?.();
  return t;
}

module.exports = {
  refresh,
  startRefreshLoop,
  checkAccount,
  checkDevice,
  listActiveAccounts,
  deviceLinkedToBan,
  banAccount,
  banDevice,
  unban,
  recordViolation,
  setAutoBanHandler
};
