// Last updated: 15 July 2026
// fingerprint.js — device identity for anti-multi-account / ban evasion.
//
// A device token is a server-signed, stateless persistent id stored in the
// browser's localStorage. The HMAC means clients can't forge another device's
// token, and we can verify it without a DB hit. The fingerprint is a weak
// secondary signal (browser/screen/timezone/canvas hash) used to catch a banned
// user who clears localStorage. NEITHER is ever used to ban an IP/network — only
// the account + the specific device.

const crypto = require('crypto');

const DEVICE_SECRET = process.env.DEVICE_SECRET || '';

function hmac(data) {
  return crypto.createHmac('sha256', DEVICE_SECRET).update(data).digest();
}

// Mint a fresh device token: base64url(deviceId) + "." + first-16-bytes-of-HMAC.
function mintDeviceToken() {
  const deviceId = crypto.randomBytes(16).toString('hex');
  const sig = hmac(deviceId).subarray(0, 16).toString('base64url');
  return { deviceId, deviceToken: `${Buffer.from(deviceId).toString('base64url')}.${sig}` };
}

// Verify a presented device token; returns the deviceId or null.
function verifyDeviceToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [idPart, sig] = token.split('.');
  let deviceId;
  try {
    deviceId = Buffer.from(idPart, 'base64url').toString();
  } catch {
    return null;
  }
  if (!/^[0-9a-f]{32}$/.test(deviceId)) return null;
  const expected = hmac(deviceId).subarray(0, 16).toString('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return deviceId;
}

// Normalize/validate a client-supplied fingerprint hash (hex sha256 string).
function sanitizeFingerprint(fp) {
  if (typeof fp !== 'string') return '';
  const clean = fp.trim().toLowerCase();
  return /^[0-9a-f]{16,128}$/.test(clean) ? clean : '';
}

function isConfigured() {
  return Boolean(DEVICE_SECRET);
}

module.exports = { mintDeviceToken, verifyDeviceToken, sanitizeFingerprint, isConfigured };
