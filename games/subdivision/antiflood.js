// Last updated: 15 July 2026
// antiflood.js — connection/flood defense + proof-of-work.
//
// Design rule from the product owner: IP/subnet is used ONLY for rate-limiting
// and as a soft "possible alt" flag. It is NEVER used to ban — many legitimate
// players share one public IP (a whole school behind NAT). Per-IP caps are tuned
// so a full class fits while a 500-socket flood from one machine is bounced.

const crypto = require('crypto');

const num = (name, def) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : def;
};

const CFG = {
  // Connection caps are deliberately generous: the REAL flood defense is the auth
  // gate (no gameplay without an account) + the 8s grace drop + signup proof-of-work.
  // Generous caps mean a whole class behind one school/NAT IP is never throttled,
  // while a 500-socket flood is still bounced (it can't obtain accounts).
  CONN_BUCKET_CAPACITY: num('CONN_BUCKET_CAPACITY', 40),
  CONN_BUCKET_REFILL_MS: num('CONN_BUCKET_REFILL_MS', 1000), // 1 token / 1s
  MAX_UNAUTHED_PER_IP: num('MAX_UNAUTHED_PER_IP', 40),
  MAX_AUTHED_PER_IP: num('MAX_AUTHED_PER_IP', 100),
  AUTH_GRACE_MS: num('AUTH_GRACE_MS', 8000),
  MAX_TOTAL_CONNECTIONS: num('MAX_TOTAL_CONNECTIONS', 1000),
  MAX_ROOMS: num('MAX_ROOMS', 100),
  MAX_PLAYERS_PER_ROOM: num('MAX_PLAYERS_PER_ROOM', 16),
  POW_DIFFICULTY: num('POW_DIFFICULTY', 18),
  POW_BURST_DIFFICULTY: num('POW_BURST_DIFFICULTY', 22),
  POW_BURST_MAX_DIFFICULTY: num('POW_BURST_MAX_DIFFICULTY', 24),
  POW_TTL_MS: num('POW_TTL_MS', 120000),
  // An IP is "bursting" once it opens this many connections within the window.
  BURST_COUNT: num('BURST_COUNT', 30),
  BURST_WINDOW_MS: num('BURST_WINDOW_MS', 10000)
};

// Per-message-type limits: { ratePerSec, burst }
const MSG_LIMITS = {
  // Client sends playerState at 30 Hz; headroom above that so jitter bunching never drops.
  playerState: { ratePerSec: 45, burst: 12 },
  // Fastest auto weapons fire ~14/s and shotguns can legitimately emit several
  // hit intents at once. Keep these generous; server-side hit correlation and
  // damage buckets are the actual anti-farm authority.
  playerShoot: { ratePerSec: 80, burst: 48 },
  playerHit: { ratePerSec: 120, burst: 72 },
  // Dev/economy endpoints are intentionally slow even for admins. The UI never
  // needs these faster than human clicks/animations, and console spam should not
  // mint unbounded cases, listings, or trade requests.
  openCase: { ratePerSec: 0.15, burst: 1 },
  openCaseTest: { ratePerSec: 0.15, burst: 1 },
  buyCase: { ratePerSec: 0.5, burst: 2 },
  getCaseEditor: { ratePerSec: 0.5, burst: 2 },
  saveCaseDefinition: { ratePerSec: 0.25, burst: 2 },
  // Forcing a room's mode respawns everyone and rebroadcasts the whole room, so
  // it is expensive and disruptive by design. Human-click pace only.
  adminForceRoomSettings: { ratePerSec: 0.35, burst: 2 },
  // Toggling the horde on and off is a deliberate act, not something to hold
  // down. Slow enough that a stuck key cannot thrash the wave director.
  containmentAdminPause: { ratePerSec: 0.5, burst: 3 },
  deleteCaseDefinition: { ratePerSec: 0.25, burst: 2 },
  // Inventory editing mints and destroys items. Human-click pace, and the read
  // is only a little looser than the write because it reloads after each edit.
  adminInventoryLookup: { ratePerSec: 1, burst: 4 },
  adminInventoryEdit: { ratePerSec: 0.5, burst: 3 },
  // Privilege escalation, so slower than the other owner tools even though it
  // only ever runs at human-click pace anyway.
  adminListRoles: { ratePerSec: 1, burst: 4 },
  adminSetRole: { ratePerSec: 0.25, burst: 2 },
  getSkinInventory: { ratePerSec: 1, burst: 3 },
  marketList: { ratePerSec: 1, burst: 3 },
  marketCreateListing: { ratePerSec: 0.5, burst: 2 },
  marketBuyListing: { ratePerSec: 0.35, burst: 2 },
  marketPlaceBid: { ratePerSec: 1, burst: 3 },
  marketCancelListing: { ratePerSec: 0.5, burst: 2 },
  tradeRequestCreate: { ratePerSec: 0.5, burst: 2 },
  tradeRespond: { ratePerSec: 0.5, burst: 2 },
  getStats: { ratePerSec: 1, burst: 4 },
  getDailyChallengeProgress: { ratePerSec: 1, burst: 3 },
  getFriendInventory: { ratePerSec: 0.5, burst: 2 },
  getLeaderboards: { ratePerSec: 0.5, burst: 2 },
  chatMessage: { ratePerSec: 2, burst: 5 },
  ping: { ratePerSec: 2, burst: 5 },
  listRooms: { ratePerSec: 0.5, burst: 2 },
  createRoom: { ratePerSec: 0.1, burst: 2 },
  joinRoom: { ratePerSec: 0.5, burst: 2 },
  // Settings are debounced client-side; this only catches a client that is not.
  saveSettings: { ratePerSec: 0.5, burst: 4 },
  adminListBalances: { ratePerSec: 0.5, burst: 3 },
  adminSetMowbucks: { ratePerSec: 0.5, burst: 4 },
  adminGrantSkin: { ratePerSec: 0.5, burst: 4 },
  default: { ratePerSec: 15, burst: 15 }
};

// ip -> { tokens, last, unauthed, authed, recent:[ts...] }
const ipState = new Map();
// nonce -> { issuedAt, ip, used }
const powChallenges = new Map();
let totalConnections = 0;

function getIpState(ip) {
  let s = ipState.get(ip);
  if (!s) {
    s = { tokens: CFG.CONN_BUCKET_CAPACITY, last: monoNow(), unauthed: 0, authed: 0, recent: [] };
    ipState.set(ip, s);
  }
  return s;
}

// A monotonic-ish clock that doesn't use Date.now() in the hot path semantics.
function monoNow() {
  return Date.now();
}

// ---------------------------------------------------------------------------
// IP extraction (Railway sits behind a proxy that sets X-Forwarded-For).
// ---------------------------------------------------------------------------
const TRUST_PROXY_HOPS = num('TRUST_PROXY_HOPS', 1);

function extractIp(req) {
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (xff) {
    const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) {
      // Take the hop just before our trusted proxy layer(s).
      const idx = Math.max(0, parts.length - TRUST_PROXY_HOPS);
      const candidate = parts[idx] || parts[0];
      if (isValidIp(candidate)) return normalizeIp(candidate);
    }
  }
  const ra = req.socket && req.socket.remoteAddress;
  return normalizeIp(ra || 'unknown');
}

function isValidIp(ip) {
  return /^[0-9a-fA-F:.]+$/.test(ip) && ip.length <= 45;
}

function normalizeIp(ip) {
  return String(ip).replace(/^::ffff:/, '');
}

function subnetOf(ip) {
  if (ip.includes(':')) {
    // IPv6 -> /64
    const groups = ip.split(':');
    return groups.slice(0, 4).join(':') + '::/64';
  }
  const o = ip.split('.');
  return o.length === 4 ? `${o[0]}.${o[1]}.${o[2]}.0/24` : ip;
}

// ---------------------------------------------------------------------------
// Connection admission
// ---------------------------------------------------------------------------

// Returns { ok:true } or { ok:false, code, reason }.
function onConnect(ip) {
  if (totalConnections >= CFG.MAX_TOTAL_CONNECTIONS) {
    return { ok: false, code: 1013, reason: 'server_full' };
  }
  const now = monoNow();
  const s = getIpState(ip);

  // Refill the per-IP connection token bucket.
  const refills = Math.floor((now - s.last) / CFG.CONN_BUCKET_REFILL_MS);
  if (refills > 0) {
    s.tokens = Math.min(CFG.CONN_BUCKET_CAPACITY, s.tokens + refills);
    s.last = now;
  }
  if (s.tokens <= 0) {
    return { ok: false, code: 1013, reason: 'rate_limited' };
  }

  // Track burst for adaptive PoW.
  s.recent.push(now);
  s.recent = s.recent.filter((t) => now - t < CFG.BURST_WINDOW_MS);

  if (s.unauthed >= CFG.MAX_UNAUTHED_PER_IP) {
    return { ok: false, code: 1013, reason: 'too_many_pending' };
  }

  s.tokens -= 1;
  s.unauthed += 1;
  totalConnections += 1;
  return { ok: true };
}

function onAuthenticated(ip) {
  const s = getIpState(ip);
  if (s.unauthed > 0) s.unauthed -= 1;
  s.authed += 1;
  if (s.authed > CFG.MAX_AUTHED_PER_IP) {
    s.authed -= 1;
    return { ok: false, code: 'too_many_sessions' };
  }
  return { ok: true };
}

function onDisconnect(ip, wasAuthed) {
  totalConnections = Math.max(0, totalConnections - 1);
  const s = ipState.get(ip);
  if (!s) return;
  if (wasAuthed) s.authed = Math.max(0, s.authed - 1);
  else s.unauthed = Math.max(0, s.unauthed - 1);
  // Forget cold IPs to keep the map small.
  if (s.authed === 0 && s.unauthed === 0 && s.tokens >= CFG.CONN_BUCKET_CAPACITY) {
    ipState.delete(ip);
  }
}

function isBursting(ip) {
  const s = ipState.get(ip);
  return Boolean(s && s.recent.length >= CFG.BURST_COUNT);
}

// ---------------------------------------------------------------------------
// Proof of work (hashcash: find counter s.t. sha256(nonce:counter) has N
// leading zero bits). Difficulty escalates while an IP is bursting.
// ---------------------------------------------------------------------------

function difficultyFor(ip, { alwaysOn = false } = {}) {
  if (isBursting(ip)) {
    const s = ipState.get(ip);
    const extra = Math.min(s.recent.length - CFG.BURST_COUNT, CFG.POW_BURST_MAX_DIFFICULTY - CFG.POW_BURST_DIFFICULTY);
    return Math.min(CFG.POW_BURST_MAX_DIFFICULTY, CFG.POW_BURST_DIFFICULTY + Math.max(0, extra));
  }
  return alwaysOn ? CFG.POW_DIFFICULTY : 0;
}

function issueChallenge(ip, difficulty) {
  const nonce = crypto.randomBytes(16).toString('hex');
  powChallenges.set(nonce, { issuedAt: monoNow(), ip, used: false });
  return { nonce, difficulty };
}

function leadingZeroBits(buf) {
  let bits = 0;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    if (byte === 0) { bits += 8; continue; }
    for (let b = 7; b >= 0; b--) {
      if ((byte >> b) & 1) return bits;
      bits++;
    }
    break;
  }
  return bits;
}

// Returns { ok:true } or { ok:false, reason }.
function verifyChallenge(ip, solution, requiredDifficulty) {
  if (requiredDifficulty <= 0) return { ok: true };
  if (!solution || typeof solution.nonce !== 'string') return { ok: false, reason: 'pow_missing' };
  const rec = powChallenges.get(solution.nonce);
  if (!rec) return { ok: false, reason: 'pow_unknown' };
  if (rec.used) return { ok: false, reason: 'pow_replay' };
  if (monoNow() - rec.issuedAt > CFG.POW_TTL_MS) { powChallenges.delete(solution.nonce); return { ok: false, reason: 'pow_expired' }; }
  if (rec.ip !== ip) return { ok: false, reason: 'pow_ip_mismatch' };
  const counter = String(solution.counter == null ? '' : solution.counter);
  const hash = crypto.createHash('sha256').update(`${solution.nonce}:${counter}`).digest();
  if (leadingZeroBits(hash) < requiredDifficulty) return { ok: false, reason: 'pow_invalid' };
  rec.used = true;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Per-connection per-message-type rate limiting (token buckets on the client obj)
// ---------------------------------------------------------------------------

function allowMessage(client, type) {
  // Drop over-limit packets silently. This protects the server but does not feed
  // anti-cheat strikes, so full-auto jitter or packet bunching cannot punish legit play.
  const lim = MSG_LIMITS[type] || MSG_LIMITS.default;
  if (!client.msgBuckets) client.msgBuckets = {};
  let b = client.msgBuckets[type];
  const now = monoNow();
  if (!b) {
    b = { tokens: lim.burst, last: now };
    client.msgBuckets[type] = b;
  }
  const refill = ((now - b.last) / 1000) * lim.ratePerSec;
  if (refill > 0) {
    b.tokens = Math.min(lim.burst, b.tokens + refill);
    b.last = now;
  }
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function sweepChallenges() {
  const now = monoNow();
  for (const [nonce, rec] of powChallenges) {
    if (now - rec.issuedAt > CFG.POW_TTL_MS) powChallenges.delete(nonce);
  }
}

setInterval(sweepChallenges, 60000).unref?.();

module.exports = {
  CFG,
  extractIp,
  subnetOf,
  onConnect,
  onAuthenticated,
  onDisconnect,
  isBursting,
  difficultyFor,
  issueChallenge,
  verifyChallenge,
  allowMessage,
  totalConnections: () => totalConnections
};
