// Last updated: 13 August 2026
// auth.js — registration, login, session resume/logout.
//
// Email verification flows use short-lived one-time codes delivered by mailer.js.
// Password recovery uses an account-held recovery code, so it remains available
// even when this small private server has no transactional email provider.
// domain checks before sending anything. Passwords use Node's built-in scrypt
// (memory-hard, no extra dependency). Sessions are opaque random tokens; only the
// sha256 of the token is stored, and there is exactly one session per account.

const crypto = require('crypto');
const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');

const db = require('./db');
const fingerprint = require('./fingerprint');
const antiflood = require('./antiflood');
const bans = require('./bans');
const mailer = require('./mailer');

// ---------------------------------------------------------------------------
// Disposable-domain blocklist
// ---------------------------------------------------------------------------
let DISPOSABLE = new Set();
try {
  const raw = fs.readFileSync(path.join(__dirname, 'disposable-domains.json'), 'utf8');
  DISPOSABLE = new Set(JSON.parse(raw).map((d) => String(d).toLowerCase()));
  console.log(`[auth] loaded ${DISPOSABLE.size} disposable domains`);
} catch (e) {
  console.warn('[auth] disposable-domains.json not loaded:', e.message);
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt). Pick the largest cost that hashes in <~120ms.
// ---------------------------------------------------------------------------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
(function tuneScrypt() {
  for (const N of [16384, 8192, 4096]) {
    try {
      const t0 = process.hrtime.bigint();
      crypto.scryptSync('benchmark', crypto.randomBytes(16), 64, { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      SCRYPT.N = N;
      if (ms < 120) break;
    } catch {
      // try a smaller N
    }
  }
  console.log(`[auth] scrypt N=${SCRYPT.N}`);
})();

function hashPassword(plain) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(plain, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 256 * 1024 * 1024 }, (err, derived) => {
      if (err) return reject(err);
      resolve(`scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${derived.toString('base64')}`);
    });
  });
}

function verifyPassword(plain, encoded) {
  return new Promise((resolve) => {
    try {
      const [scheme, N, r, p, saltB64, hashB64] = String(encoded).split('$');
      if (scheme !== 'scrypt') return resolve(false);
      const salt = Buffer.from(saltB64, 'base64');
      const expected = Buffer.from(hashB64, 'base64');
      crypto.scrypt(plain, salt, expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 }, (err, derived) => {
        if (err) return resolve(false);
        resolve(derived.length === expected.length && crypto.timingSafeEqual(derived, expected));
      });
    } catch {
      resolve(false);
    }
  });
}

// Constant-ish work for the "no such user" path to avoid timing enumeration.
const DUMMY_HASH = `scrypt$${SCRYPT.N}$8$1$${crypto.randomBytes(16).toString('base64')}$${crypto.randomBytes(64).toString('base64')}`;

// ---------------------------------------------------------------------------
// Email validation
// ---------------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (e.length < 6 || e.length > 254) return { ok: false, code: 'bad_email' };
  if (!EMAIL_RE.test(e)) return { ok: false, code: 'bad_email' };
  const local = e.split('@')[0];
  if (local.length > 64) return { ok: false, code: 'bad_email' };
  const domain = e.split('@')[1];
  if (DISPOSABLE.has(domain)) return { ok: false, code: 'disposable_email' };
  return { ok: true, email: e, domain };
}

async function domainCanReceiveMail(domain) {
  // 4s budget; soft-allow on timeout so a slow resolver doesn't block a real user.
  const lookup = (async () => {
    try {
      const mx = await dns.resolveMx(domain);
      if (mx && mx.length) return 'mx';
    } catch { /* fall through */ }
    try {
      const a = await dns.resolve(domain);
      if (a && a.length) return 'a';
    } catch { /* fall through */ }
    try {
      const a6 = await dns.resolve6(domain);
      if (a6 && a6.length) return 'aaaa';
    } catch { /* fall through */ }
    return 'none';
  })();
  const timeout = new Promise((res) => setTimeout(() => res('timeout'), 4000));
  return Promise.race([lookup, timeout]);
}

function validateUsername(name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 20);
  if (n.length < 2 || n.length > 20) return null;
  // Letters/numbers from any language plus a small set of harmless separators.
  // Markup, quotes, controls and bidi overrides never reach storage.
  if (!/^[\p{L}\p{N} _.-]+$/u.test(n) || /[\p{C}]/u.test(n)) return null;
  return n;
}

function validatePassword(pw) {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 128;
}

const EMAIL_CODE_TTL_MS = 15 * 60 * 1000;
const EMAIL_CODE_MAX_ATTEMPTS = 6;
const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function normalizeCode(code) {
  return String(code || '').replace(/\D/g, '').slice(0, 12);
}

function newEmailCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function emailCodeHash(purpose, email, code) {
  return crypto
    .createHash('sha256')
    .update(`${purpose}:${String(email || '').trim().toLowerCase()}:${normalizeCode(code)}`)
    .digest('hex');
}

function normalizeRecoveryCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 16);
}

function newRecoveryCode() {
  let value = '';
  for (let index = 0; index < 16; index += 1) value += RECOVERY_CODE_ALPHABET[crypto.randomInt(RECOVERY_CODE_ALPHABET.length)];
  return value.match(/.{1,4}/g).join('-');
}

function recoveryCipherKey() {
  return crypto.createHash('sha256').update(`orbit-ops-subdivision-recovery:${process.env.DEVICE_SECRET || process.env.SESSION_SECRET || 'development-only'}`).digest();
}

function encryptRecoveryCode(code) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', recoveryCipherKey(), iv);
  const data = Buffer.concat([cipher.update(String(code), 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
}

function decryptRecoveryCode(ciphertext) {
  try {
    const [ivText, tagText, dataText] = String(ciphertext || '').split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', recoveryCipherKey(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

async function getOrCreateRecoveryCode(accountId) {
  const existing = decryptRecoveryCode(await db.getRecoveryCodeCiphertext(accountId));
  if (normalizeRecoveryCode(existing).length === 16) return existing;
  const code = newRecoveryCode();
  await db.setRecoveryCodeCiphertext(accountId, encryptRecoveryCode(code));
  return code;
}

async function sendCodeEmail({ to, subject, code, intro, purpose, recordId }) {
  const text = [
    intro,
    '',
    `Code: ${code}`,
    '',
    'This code expires in 15 minutes. If you did not request it, you can ignore this email.',
    '',
    "Orbit Ops Subdivision"
  ].join('\n');
  const safeIntro = String(intro || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const safeCode = String(code || '').replace(/\D/g, '').slice(0, 12);
  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;background:#111914;color:#eef4ec;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px">
    <div style="border:1px solid #355b35;background:#172019;padding:32px">
      <div style="font-size:13px;font-weight:700;color:#8fd05f;text-transform:uppercase">Orbit Ops Subdivision</div>
      <h1 style="margin:14px 0 12px;font-size:24px;line-height:1.3;color:#ffffff">Account security code</h1>
      <p style="margin:0 0 24px;line-height:1.6;color:#c8d2c5">${safeIntro}</p>
      <div style="padding:18px;text-align:center;background:#0c110d;border:1px solid #4f7648;font-family:monospace;font-size:34px;font-weight:700;color:#a6e36f">${safeCode}</div>
      <p style="margin:24px 0 0;line-height:1.6;color:#9eaa9b">This code expires in 15 minutes. If you did not request it, you can ignore this email.</p>
    </div>
  </div>
</body>
</html>`;
  return mailer.sendMail({
    to,
    subject,
    text,
    html,
    idempotencyKey: `account-code/${purpose}/${recordId}`,
    tags: [{ name: 'account_action', value: purpose }]
  });
}

async function createAndSendEmailCode({ purpose, accountId = null, email, emailDomain = null, username = null, passwordHash = null, subject, intro }) {
  const code = newEmailCode();
  const record = await db.createEmailCode({
    purpose,
    accountId,
    email,
    emailDomain,
    username,
    passwordHash,
    codeHash: emailCodeHash(purpose, email, code),
    expiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString()
  });
  await sendCodeEmail({ to: email, subject, code, intro, purpose, recordId: record.id });
  return record;
}

async function verifyEmailCode({ purpose, email, code, accountId = null }) {
  const cleanCode = normalizeCode(code);
  if (cleanCode.length < 6) return err('bad_code', 'Enter the 6-digit email code.');
  const record = await db.getLatestEmailCode({ purpose, email, accountId });
  if (!record) return err('code_expired', 'That code is expired or invalid. Send a new one.');
  if (Number(record.attempts || 0) >= EMAIL_CODE_MAX_ATTEMPTS) {
    await db.consumeEmailCode(record.id);
    return err('code_expired', 'That code has been locked. Send a new one.');
  }
  const expected = emailCodeHash(purpose, record.email, cleanCode);
  const provided = Buffer.from(expected, 'hex');
  const stored = Buffer.from(String(record.code_hash || ''), 'hex');
  if (stored.length !== provided.length || !crypto.timingSafeEqual(stored, provided)) {
    const attempts = await db.incrementEmailCodeAttempts(record.id);
    if (attempts >= EMAIL_CODE_MAX_ATTEMPTS) await db.consumeEmailCode(record.id);
    return err('bad_code', 'That email code is not correct.');
  }
  return { ok: true, record };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}
function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

let nextGuestNumber = 1;
const LEVEL_BASE_XP = 350;
const LEVEL_XP_GROWTH = 1.15;

function progressionForXp(rawXp) {
  // XP curve: increasingly expensive levels through 20, then a plateau so long-
  // term players keep progressing without the next level becoming unreachable.
  const xp = Math.max(0, Math.floor(Number(rawXp) || 0));
  let remaining = xp;
  let level = 1;
  let required = LEVEL_BASE_XP;
  while (remaining >= required && level < 1000) {
    remaining -= required;
    level += 1;
    required = level <= 20 ? Math.round(LEVEL_BASE_XP * Math.pow(LEVEL_XP_GROWTH, level - 1)) : Math.round(LEVEL_BASE_XP * Math.pow(LEVEL_XP_GROWTH, 19));
  }
  return { xp, level, levelXp: remaining, nextLevelXp: required };
}

function nextGuestUsername() {
  return `anonymous${nextGuestNumber++}`;
}

async function statsPayload(accountId) {
  const s = (await db.getStats(accountId)) || {};
  const kills = Number(s.kills || 0);
  const deaths = Number(s.deaths || 0);
  const shotsFired = Number(s.shots_fired || 0);
  const shotsHit = Number(s.shots_hit || 0);
  return {
    kills,
    deaths,
    assists: Number(s.assists || 0),
    wins: Number(s.wins || 0),
    gamesPlayed: Number(s.games_played || 0),
    playtimeSecs: Number(s.playtime_secs || 0),
    bestStreak: Number(s.best_streak || 0),
    gungameKills: Number(s.gungame_kills || 0),
    gungameWins: Number(s.gungame_wins || 0),
    deathmatchKills: Number(s.deathmatch_kills || 0),
    deathmatchWins: Number(s.deathmatch_wins || 0),
    mvps: Number(s.mvps || 0),
    mowbucks: Number(s.mowbucks || 0),
    ...progressionForXp(s.xp),
    weaponKills: s.weapon_kills || {},
    shotsFired,
    shotsHit,
    accuracy: shotsFired > 0 ? Number((shotsHit / shotsFired).toFixed(3)) : 0,
    kd: deaths > 0 ? Number((kills / deaths).toFixed(2)) : kills
  };
}

function emptyStats() {
  return {
    kills: 0,
    deaths: 0,
    assists: 0,
    wins: 0,
    gamesPlayed: 0,
    playtimeSecs: 0,
    bestStreak: 0,
    gungameKills: 0,
    gungameWins: 0,
    deathmatchKills: 0,
    deathmatchWins: 0,
    mvps: 0,
    xp: 0,
    level: 1,
    levelXp: 0,
    nextLevelXp: LEVEL_BASE_XP,
    weaponKills: {},
    shotsFired: 0,
    shotsHit: 0,
    accuracy: 0,
    kd: 0
  };
}

// ---------------------------------------------------------------------------
// Public flows. Each returns either:
//   { ok:true, accountId, username, deviceId, deviceToken, token, stats }
//   { ok:false, code, message, retryAfter?, reason?, expiresAt? }
// `conn` = { ip, subnet, powDifficulty }
// ---------------------------------------------------------------------------

function err(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

async function resolveDevice(deviceTokenIn, fp, accountId) {
  let deviceId = fingerprint.verifyDeviceToken(deviceTokenIn);
  let deviceToken = deviceId ? deviceTokenIn : null;
  if (!deviceId) {
    const minted = fingerprint.mintDeviceToken();
    deviceId = minted.deviceId;
    deviceToken = minted.deviceToken;
  }
  if (db.isEnabled()) {
    try { await db.upsertDevice({ deviceId, fingerprint: fp, accountId }); } catch (e) { console.error('[auth] upsertDevice:', e.message); }
  }
  return { deviceId, deviceToken };
}

async function guest(data) {
  const fp = fingerprint.sanitizeFingerprint(data.fingerprint);
  const presentedDeviceId = fingerprint.verifyDeviceToken(data.deviceToken);
  const linked = await bans.deviceLinkedToBan(presentedDeviceId, fp);
  if (linked.blocked) return err('device_blocked', 'This device is not allowed to play.');
  const minted = fingerprint.mintDeviceToken();
  return {
    ok: true,
    guest: true,
    accountId: null,
    role: 'user',
    username: nextGuestUsername(),
    deviceId: minted.deviceId,
    deviceToken: minted.deviceToken,
    token: null,
    usedHealthshot: false,
    stats: emptyStats()
  };
}

async function register(data, conn) {
  // 1. Proof of work (always required on register).
  const pow = antiflood.verifyChallenge(conn.ip, data.powSolution, conn.powDifficulty);
  if (!pow.ok) return err('pow_failed', 'Please retry — verification failed.', { needPow: true });

  // 2. Validate inputs.
  const emailCheck = validateEmail(data.email);
  if (!emailCheck.ok) {
    return err(emailCheck.code, emailCheck.code === 'disposable_email'
      ? 'Disposable email addresses are not allowed.'
      : 'Please enter a valid email address.');
  }
  const username = validateUsername(data.username);
  if (!username) return err('bad_username', 'Use 2-20 letters, numbers, spaces, dots, dashes or underscores.');
  if (!validatePassword(data.password)) return err('bad_password', 'Password must be 8-128 characters.');

  if (!db.isEnabled()) return err('server_error', 'Accounts are temporarily unavailable.');

  // 3. Domain must be able to receive mail.
  const fp = fingerprint.sanitizeFingerprint(data.fingerprint);
  const mx = await domainCanReceiveMail(emailCheck.domain);
  if (mx === 'none') return err('no_mx', "That email domain can't receive mail.");
  if (mx === 'timeout') {
    try { await db.logIpEvent({ ip: conn.ip, subnet: conn.subnet, event: 'mx_timeout' }); } catch {}
  }

  // 4. Uniqueness.
  if (await db.emailExists(emailCheck.email)) return err('email_taken', 'An account with that email already exists.');
  if (await db.usernameExists(username)) return err('username_taken', 'That username is already taken.');

  // 5. Device-ban gate (block alts of a banned account).
  const presentedDeviceId = fingerprint.verifyDeviceToken(data.deviceToken);
  const linked = await bans.deviceLinkedToBan(presentedDeviceId, fp);
  if (linked.blocked) return err('device_blocked', 'This device is not allowed to create accounts.');

  // 6. Store a pending registration and send the verification code.
  const passwordHash = await hashPassword(data.password);
  try {
    await createAndSendEmailCode({
      purpose: 'register',
      email: emailCheck.email,
      emailDomain: emailCheck.domain,
      username,
      passwordHash,
      subject: "Verify your Orbit Ops Subdivision account",
      intro: `Use this code to finish creating your Orbit Ops Subdivision account for ${username}.`
    });
  } catch (e) {
    if (/duplicate|unique/i.test(e.message)) return err('email_taken', 'An account with that email already exists.');
    console.error('[auth] send register code:', e.message);
    return err('email_send_failed', 'Could not send the verification email right now.');
  }

  try { await db.logIpEvent({ ip: conn.ip, subnet: conn.subnet, event: 'signup_code', accountId: null }); } catch {}

  return {
    ok: true,
    pendingVerification: true,
    email: emailCheck.email,
    username,
    message: 'Check your email for the 6-digit code to finish creating your account.'
  };
}

async function confirmRegistration(data, conn) {
  const emailCheck = validateEmail(data.email);
  if (!emailCheck.ok) return err('bad_email', 'Enter the email you used to register.');
  if (!db.isEnabled()) return err('server_error', 'Accounts are temporarily unavailable.');
  const verified = await verifyEmailCode({ purpose: 'register', email: emailCheck.email, code: data.code });
  if (!verified.ok) return verified;
  const record = verified.record;
  const username = validateUsername(record.username);
  if (!username || !record.password_hash) return err('code_expired', 'That registration has expired. Please sign up again.');

  if (await db.emailExists(emailCheck.email)) return err('email_taken', 'An account with that email already exists.');
  if (await db.usernameExists(username)) return err('username_taken', 'That username is already taken.');

  const fp = fingerprint.sanitizeFingerprint(data.fingerprint);
  const presentedDeviceId = fingerprint.verifyDeviceToken(data.deviceToken);
  const linked = await bans.deviceLinkedToBan(presentedDeviceId, fp);
  if (linked.blocked) return err('device_blocked', 'This device is not allowed to create accounts.');

  let account;
  try {
    account = await db.createAccount({ email: emailCheck.email, emailDomain: emailCheck.domain, passwordHash: record.password_hash, username });
  } catch (e) {
    if (/username/i.test(e.message)) return err('username_taken', 'That username is already taken.');
    if (/duplicate|unique/i.test(e.message)) return err('email_taken', 'An account with that email already exists.');
    console.error('[auth] confirmRegistration createAccount:', e.message);
    return err('server_error', 'Could not create the account.');
  }
  const device = await resolveDevice(data.deviceToken, fp, account.id);
  const token = newSessionToken();
  await db.createSession({ tokenHash: tokenHash(token), accountId: account.id, deviceId: device.deviceId, ip: conn.ip });
  await db.setLastLogin(account.id);
  await db.consumeEmailCode(record.id);
  try { await db.logIpEvent({ ip: conn.ip, subnet: conn.subnet, event: 'signup', accountId: account.id }); } catch {}

  return {
    ok: true,
    accountId: account.id,
    username: account.username,
    role: account.role,
    deviceId: device.deviceId,
    deviceToken: device.deviceToken,
    token,
    usedHealthshot: false,
    stats: await statsPayload(account.id)
  };
}

async function login(data, conn) {
  // PoW only when the IP is bursting.
  if (conn.powDifficulty > 0) {
    const pow = antiflood.verifyChallenge(conn.ip, data.powSolution, conn.powDifficulty);
    if (!pow.ok) return err('pow_failed', 'Please retry — verification failed.', { needPow: true });
  }
  const emailCheck = validateEmail(data.email);
  if (!emailCheck.ok || typeof data.password !== 'string') {
    await verifyPassword('x', DUMMY_HASH); // keep timing flat
    return err('bad_credentials', 'Incorrect email or password.');
  }
  if (!db.isEnabled()) return err('server_error', 'Accounts are temporarily unavailable.');

  const account = await db.getAccountByEmail(emailCheck.email);
  if (!account) {
    await verifyPassword(data.password, DUMMY_HASH);
    return err('bad_credentials', 'Incorrect email or password.');
  }
  if (account.email_verified === false) return err('email_unverified', 'Please verify your email before logging in.');
  const ok = await verifyPassword(data.password, account.password_hash);
  if (!ok) return err('bad_credentials', 'Incorrect email or password.');

  // Ban check (account + device).
  const fp = fingerprint.sanitizeFingerprint(data.fingerprint);
  const accBan = bans.checkAccount(account.id);
  if (accBan.banned) return err('banned', accBan.reason || 'This account is banned.', { reason: accBan.reason, expiresAt: accBan.expiresAt });
  const presentedDeviceId = fingerprint.verifyDeviceToken(data.deviceToken);
  if (presentedDeviceId && bans.checkDevice(presentedDeviceId).banned) {
    return err('device_blocked', 'This device is banned.');
  }

  const device = await resolveDevice(data.deviceToken, fp, account.id);
  const token = newSessionToken();
  await db.createSession({ tokenHash: tokenHash(token), accountId: account.id, deviceId: device.deviceId, ip: conn.ip });
  await db.setLastLogin(account.id);
  try { await db.logIpEvent({ ip: conn.ip, subnet: conn.subnet, event: 'login', accountId: account.id }); } catch {}

  return {
    ok: true,
    accountId: account.id,
    username: account.username,
    role: account.role,
    deviceId: device.deviceId,
    deviceToken: device.deviceToken,
    token,
    usedHealthshot: !!account.healthshot_used,
    stats: await statsPayload(account.id)
  };
}

async function resume(data, conn) {
  if (!db.isEnabled() || typeof data.token !== 'string') return err('session_invalid', 'Please log in again.');
  const th = tokenHash(data.token);
  const session = await db.getSession(th);
  if (!session) return err('session_invalid', 'Please log in again.');

  const accBan = bans.checkAccount(session.account_id);
  if (accBan.banned) return err('banned', accBan.reason || 'This account is banned.', { reason: accBan.reason, expiresAt: accBan.expiresAt });

  const account = await db.getAccountById(session.account_id);
  if (!account || account.status === 'disabled') return err('session_invalid', 'Please log in again.');

  const fp = fingerprint.sanitizeFingerprint(data.fingerprint);
  const device = await resolveDevice(data.deviceToken || session.device_id, fp, account.id);
  await db.touchSession(th);

  return {
    ok: true,
    accountId: account.id,
    username: account.username,
    role: account.role,
    deviceId: device.deviceId,
    deviceToken: device.deviceToken,
    token: data.token,
    usedHealthshot: !!account.healthshot_used,
    stats: await statsPayload(account.id)
  };
}

async function handoff(data, conn, destinationInstance) {
  if (!db.isEnabled() || typeof data.token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(data.token)) {
    return err('handoff_invalid', 'That game link is invalid or expired.');
  }
  const transfer = await db.consumeCrossServerHandoff({ token: data.token, destinationInstance });
  if (!transfer) return err('handoff_invalid', 'That game link is invalid or expired.');
  const account = await db.getAccountById(transfer.account_id);
  if (!account || account.status === 'disabled') return err('handoff_invalid', 'That account cannot join this game.');
  const accBan = bans.checkAccount(account.id);
  if (accBan.banned) return err('banned', accBan.reason || 'This account is banned.');
  const fp = fingerprint.sanitizeFingerprint(data.fingerprint);
  const device = await resolveDevice(data.deviceToken, fp, account.id);
  const token = newSessionToken();
  await db.createSession({ tokenHash: tokenHash(token), accountId: account.id, deviceId: device.deviceId, ip: conn.ip });
  await db.setLastLogin(account.id);
  return {
    ok: true,
    accountId: account.id,
    username: account.username,
    role: account.role,
    deviceId: device.deviceId,
    deviceToken: device.deviceToken,
    token,
    handoffRoomCode: transfer.room_code,
    usedHealthshot: !!account.healthshot_used,
    stats: await statsPayload(account.id)
  };
}

async function logout(token) {
  if (db.isEnabled() && token) {
    try { await db.deleteSession(tokenHash(token)); } catch (e) { console.error('[auth] logout:', e.message); }
  }
}

async function changeUsername(accountId, username) {
  if (!db.isEnabled()) return err('server_error', 'Accounts are temporarily unavailable.');
  const nextName = validateUsername(username);
  if (!nextName) return err('bad_username', 'Use 2-20 letters, numbers, spaces, dots, dashes or underscores.');
  if (await db.usernameExists(nextName, accountId)) return err('username_taken', 'That username is already taken.');
  let account;
  try {
    account = await db.updateUsername(accountId, nextName);
  } catch (e) {
    if (/username|duplicate|unique/i.test(e.message)) return err('username_taken', 'That username is already taken.');
    throw e;
  }
  if (!account) return err('server_error', 'Could not update username.');
  return { ok: true, accountId: account.id, username: account.username };
}

async function getOwnRecoveryCode(accountId) {
  if (!db.isEnabled()) return err('server_error', 'Accounts are temporarily unavailable.');
  const account = await db.getAccountById(accountId);
  if (!account) return err('not_authed', 'Please log in again.');
  const recoveryCode = await getOrCreateRecoveryCode(account.id);
  return { ok: true, accountNotice: true, recoveryCode, message: 'Save this recovery code somewhere private. It is required to reset your password.' };
}

async function getAdminRecoveryCode(data) {
  if (!db.isEnabled()) return err('server_error', 'Accounts are temporarily unavailable.');
  const emailCheck = validateEmail(data.email);
  if (!emailCheck.ok) return err('bad_email', 'Enter the account email to look up.');
  const account = await db.getAccountByEmail(emailCheck.email);
  if (!account) return err('not_found', 'No account matches that email.');
  const recoveryCode = await getOrCreateRecoveryCode(account.id);
  return { ok: true, adminRecoveryNotice: true, username: account.username, recoveryCode, message: `Recovery code loaded for ${account.username}.` };
}

async function confirmPasswordReset(data) {
  const emailCheck = validateEmail(data.email);
  if (!emailCheck.ok) return err('bad_email', 'Enter the email on your account.');
  const username = validateUsername(data.username);
  if (!username) return err('bad_username', 'Enter the username on your account.');
  if (!validatePassword(data.password)) return err('bad_password', 'Password must be 8-128 characters.');
  if (!db.isEnabled()) return err('server_error', 'Accounts are temporarily unavailable.');
  const account = await db.getAccountForRecovery(emailCheck.email, username);
  const supplied = normalizeRecoveryCode(data.recoveryCode);
  const stored = normalizeRecoveryCode(decryptRecoveryCode(account?.recovery_code_ciphertext));
  const valid = supplied.length === 16 && stored.length === 16 && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(stored));
  if (!account || !valid) return err('bad_recovery_code', 'The email, username, or recovery code is not correct.');
  const passwordHash = await hashPassword(data.password);
  const nextRecoveryCode = newRecoveryCode();
  await db.updatePasswordAndRecoveryCode(account.id, passwordHash, encryptRecoveryCode(nextRecoveryCode));
  await db.deleteSessionByAccount(account.id);
  try { await db.logIpEvent({ event: 'password_reset_recovery_code', accountId: account.id }); } catch {}
  return { ok: true, noticeOnly: true, nextRecoveryCode, message: 'Password changed. Your recovery code has been replaced—save the new one now.' };
}

async function changePassword(accountId, data) {
  if (!db.isEnabled()) return err('server_error', 'Accounts are temporarily unavailable.');
  if (!validatePassword(data.newPassword)) return err('bad_password', 'New password must be 8-128 characters.');
  const basic = await db.getAccountById(accountId);
  if (!basic) return err('not_authed', 'Please log in again.');
  const account = await db.getAccountByEmail(basic.email);
  const ok = account ? await verifyPassword(String(data.currentPassword || ''), account.password_hash) : false;
  if (!ok) return err('bad_credentials', 'Current password is not correct.');
  const passwordHash = await hashPassword(data.newPassword);
  const nextRecoveryCode = newRecoveryCode();
  await db.updatePasswordAndRecoveryCode(accountId, passwordHash, encryptRecoveryCode(nextRecoveryCode));
  return {
    ok: true,
    accountNotice: true,
    recoveryCode: nextRecoveryCode,
    message: 'Password updated. Your recovery code has been replaced—save the new one now.'
  };
}

async function requestEmailChange(accountId, data) {
  // Retained as a protocol-compatible validation step for older clients. Email
  // changes no longer send mail; confirmation requires the account recovery code.
  if (!db.isEnabled()) return err('server_error', 'Accounts are temporarily unavailable.');
  const current = validateEmail(data.currentEmail);
  const next = validateEmail(data.newEmail);
  if (!current.ok || !next.ok) return err('bad_email', 'Enter your current email and a valid new email.');
  const account = await db.getAccountById(accountId);
  if (!account) return err('not_authed', 'Please log in again.');
  if (String(account.email || '').toLowerCase() !== current.email) return err('bad_email', 'Current email does not match this account.');
  if (current.email === next.email) return err('bad_email', 'That is already your account email.');
  const mx = await domainCanReceiveMail(next.domain);
  if (mx === 'none') return err('no_mx', "That email domain can't receive mail.");
  const existing = await db.getAccountByEmail(next.email);
  if (existing && String(existing.id) !== String(accountId)) return err('email_taken', 'An account with that email already exists.');
  return { ok: true, accountNotice: true, message: 'Enter your recovery code to confirm this email change.' };
}

async function confirmEmailChange(accountId, data) {
  if (!db.isEnabled()) return err('server_error', 'Accounts are temporarily unavailable.');
  const current = validateEmail(data.currentEmail);
  const next = validateEmail(data.newEmail || data.email);
  if (!current.ok || !next.ok) return err('bad_email', 'Enter your current email and a valid new email.');
  const account = await db.getAccountById(accountId);
  if (!account) return err('not_authed', 'Please log in again.');
  if (String(account.email || '').toLowerCase() !== current.email) return err('bad_email', 'Current email does not match this account.');
  if (current.email === next.email) return err('bad_email', 'That is already your account email.');
  const supplied = normalizeRecoveryCode(data.recoveryCode);
  const stored = normalizeRecoveryCode(decryptRecoveryCode(await db.getRecoveryCodeCiphertext(accountId)));
  const valid = supplied.length === 16 && stored.length === 16 && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(stored));
  if (!valid) return err('bad_recovery_code', 'That recovery code is not correct.');
  const mx = await domainCanReceiveMail(next.domain);
  if (mx === 'none') return err('no_mx', "That email domain can't receive mail.");
  const existing = await db.getAccountByEmail(next.email);
  if (existing && String(existing.id) !== String(accountId)) return err('email_taken', 'An account with that email already exists.');
  const nextRecoveryCode = newRecoveryCode();
  try {
    await db.updateEmailAndRecoveryCode(accountId, next.email, next.domain, encryptRecoveryCode(nextRecoveryCode));
  } catch (e) {
    if (/duplicate|unique/i.test(e.message)) return err('email_taken', 'An account with that email already exists.');
    throw e;
  }
  return {
    ok: true,
    accountNotice: true,
    email: next.email,
    recoveryCode: nextRecoveryCode,
    message: 'Email updated. Your recovery code has been replaced—save the new one now.'
  };
}

module.exports = {
  register,
  confirmRegistration,
  login,
  resume,
  handoff,
  guest,
  logout,
  changeUsername,
  changePassword,
  getOwnRecoveryCode,
  getAdminRecoveryCode,
  confirmPasswordReset,
  requestEmailChange,
  confirmEmailChange,
  statsPayload,
  emptyStats,
  tokenHash,
  // exported for tests / reuse
  validateEmail,
  validateUsername,
  validatePassword,
  hashPassword,
  newRecoveryCode,
  normalizeRecoveryCode,
  verifyPassword
};
