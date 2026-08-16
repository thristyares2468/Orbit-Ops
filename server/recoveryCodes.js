import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { SESSION_SECRET } from "./constants.js";

// A recovery code is the only way back into an account whose password is gone,
// because Orbit Ops sends no mail. It is therefore stored reversibly: the player
// can read it back while signed in, and an owner can read it out to help them.
//
// That decision is the whole security model here, so it is worth being explicit:
// a database dump alone is not enough to use these, but a dump plus SESSION_SECRET
// is. Rotating SESSION_SECRET invalidates every stored code (and every session),
// which is the intended blast radius.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GROUPS = 4;
const GROUP_LENGTH = 4;
const KEY_SALT = "orbit-ops.recovery-code.v1";
const ALGORITHM = "aes-256-gcm";

let cachedKey = null;
function encryptionKey(secret = SESSION_SECRET) {
  // scrypt is deliberate: SESSION_SECRET is a human-supplied string, not key material.
  if (!cachedKey || cachedKey.secret !== secret) {
    cachedKey = { secret, key: scryptSync(String(secret), KEY_SALT, 32) };
  }
  return cachedKey.key;
}

// Reject ambiguous characters at generation time rather than trying to guess what
// a player meant when they read a 0 as an O off a screenshot.
export function generateRecoveryCode(randomSource = randomBytes) {
  const bytes = randomSource(GROUPS * GROUP_LENGTH);
  const characters = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]);
  return Array.from({ length: GROUPS }, (_, group) =>
    characters.slice(group * GROUP_LENGTH, (group + 1) * GROUP_LENGTH).join("")).join("-");
}

// What a player types is never quite what was printed: case, spacing and dashes
// all vary. Those are forgiven. I, O, 0 and 1 are not in the alphabet at all, so
// one appearing means the code was mis-transcribed - and there is no safe guess
// at what it should have been, so it is refused rather than repaired.
export function normaliseRecoveryCode(value) {
  const raw = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/gu, "");
  if (raw.length !== GROUPS * GROUP_LENGTH) return "";
  if (![...raw].every((character) => ALPHABET.includes(character))) return "";
  return Array.from({ length: GROUPS }, (_, group) =>
    raw.slice(group * GROUP_LENGTH, (group + 1) * GROUP_LENGTH)).join("-");
}

export function encryptRecoveryCode(code, secret = SESSION_SECRET) {
  const normalised = normaliseRecoveryCode(code);
  if (!normalised) throw new Error("Recovery code is malformed.");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(normalised, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptRecoveryCode(ciphertext, secret = SESSION_SECRET) {
  const [version, iv, tag, payload] = String(ciphertext ?? "").split(".");
  if (version !== "v1" || !iv || !tag || !payload) return "";
  try {
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plain = Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    // A wrong key or a tampered record is indistinguishable from no code at all,
    // which is what the caller should treat it as.
    return "";
  }
}

export function recoveryCodeMatches(supplied, ciphertext, secret = SESSION_SECRET) {
  const expected = decryptRecoveryCode(ciphertext, secret);
  const offered = normaliseRecoveryCode(supplied);
  if (!expected || !offered) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(offered);
  return a.length === b.length && timingSafeEqual(a, b);
}
