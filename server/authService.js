import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { isDatabaseConfigured } from "../database/database.js";
import {
  clearFailedLogins, createAccount, createSession, findAccountBySession, findAccountForLogin,
  findAccountForRecovery, getActiveAccountRestrictions, getProfile, getRecoveryCodeCiphertext,
  recordFailedLogin, replacePassword, revokeSession, setRecoveryCodeCiphertext, touchLastLogin
} from "../database/repositories/accountsRepository.js";
import { validateDisplayName, validateEmail, validatePassword } from "./validation.js";
import {
  decryptRecoveryCode, encryptRecoveryCode, generateRecoveryCode, recoveryCodeMatches
} from "./recoveryCodes.js";
import { SESSION_SECRET } from "./constants.js";

const SESSION_DAYS = 30;
// A missing account still pays the same cost-12 bcrypt comparison as an existing
// account. Keep this value fixed so login timing does not reveal registered mailboxes.
export const DUMMY_PASSWORD_HASH = "$2b$12$CSXB2zAy6Oqaf/p7BwdCuO72sFGpvnFw5HxKP/0WG0EJXMxU4Q4/2";

const DEFAULT_DEPENDENCIES = Object.freeze({
  isDatabaseConfigured,
  hashPassword: (password, rounds) => bcrypt.hash(password, rounds),
  comparePassword: (password, hash) => bcrypt.compare(password, hash),
  createAccount,
  createSession,
  findAccountBySession,
  findAccountForLogin,
  getActiveAccountRestrictions,
  getProfile,
  recordFailedLogin,
  clearFailedLogins,
  revokeSession,
  touchLastLogin,
  findAccountForRecovery,
  getRecoveryCodeCiphertext,
  setRecoveryCodeCiphertext,
  replacePassword,
  generateRecoveryCode,
  encryptRecoveryCode,
  decryptRecoveryCode,
  recoveryCodeMatches,
  randomToken: () => randomBytes(32).toString("base64url"),
  now: () => Date.now()
});

function dependencies(overrides = {}) {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

export function hashToken(token) {
  return createHmac("sha256", SESSION_SECRET).update(String(token)).digest("hex");
}

function safeAccount(account) {
  return {
    id: account.id,
    email: account.email,
    displayName: account.display_name,
    accountStatus: account.account_status,
    role: account.role,
    createdAt: account.created_at,
    lastLoginAt: account.last_login_at
  };
}

async function issueSession(account, service) {
  const token = service.randomToken();
  const expiresAt = new Date(service.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await service.createSession({ accountId: account.id, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function register(payload, overrides) {
  const service = dependencies(overrides);
  if (!service.isDatabaseConfigured()) throw new Error("Accounts are temporarily unavailable; continue as a guest.");
  const email = validateEmail(payload?.email, { allowDisposable: false });
  const displayName = validateDisplayName(payload?.displayName);
  const password = validatePassword(payload?.password);
  const passwordHash = await service.hashPassword(password, 12);
  let account;
  try {
    account = await service.createAccount({ email, displayName, passwordHash });
  } catch (error) {
    if (error.code === "23505") throw new Error("That email or display name is already registered.");
    throw error;
  }
  const session = await issueSession(account, service);
  // Issued now rather than on demand, so a player who never opens the account
  // panel still has a way back in. It is shown once here and can be re-read later.
  const recoveryCode = service.generateRecoveryCode();
  await service.setRecoveryCodeCiphertext(account.id, service.encryptRecoveryCode(recoveryCode));
  return { account: safeAccount(account), ...session, recoveryCode };
}

export async function login(payload, overrides) {
  const service = dependencies(overrides);
  if (!service.isDatabaseConfigured()) throw new Error("Accounts are temporarily unavailable; continue as a guest.");
  const email = validateEmail(payload?.email);
  const password = validatePassword(payload?.password);
  const account = await service.findAccountForLogin(email);
  const passwordMatches = await service.comparePassword(password, account?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!account) throw new Error("Email or password is incorrect.");
  if (!passwordMatches) {
    await service.recordFailedLogin(account.id);
    throw new Error("Email or password is incorrect.");
  }
  if (account.login_locked_until && new Date(account.login_locked_until).getTime() > service.now()) {
    throw new Error("Too many failed sign-in attempts. Try again later.");
  }
  if (account.account_status !== "active") throw new Error("This account cannot currently sign in.");
  const restrictions = await service.getActiveAccountRestrictions(account.id);
  if (restrictions.banned) throw new Error("This account cannot currently sign in.");
  await service.clearFailedLogins(account.id);
  await service.touchLastLogin(account.id);
  const session = await issueSession(account, service);
  return { account: safeAccount(account), ...session };
}

export async function resume(token, overrides) {
  const service = dependencies(overrides);
  if (!service.isDatabaseConfigured() || !token) return null;
  const account = await service.findAccountBySession(hashToken(token));
  return account ? { account: safeAccount(account) } : null;
}

export async function logout(token, overrides) {
  const service = dependencies(overrides);
  if (service.isDatabaseConfigured() && token) await service.revokeSession(hashToken(token));
}

export async function profile(accountId, overrides) {
  const service = dependencies(overrides);
  if (!accountId || !service.isDatabaseConfigured()) return null;
  return service.getProfile(accountId);
}

// --- account recovery ---------------------------------------------------

// Reading your own code back. Requires a live session, so it is only ever
// available to someone already signed in as that account.
export async function revealRecoveryCode(accountId, overrides) {
  const service = dependencies(overrides);
  if (!accountId || !service.isDatabaseConfigured()) throw new Error("Accounts are temporarily unavailable.");
  let ciphertext = await service.getRecoveryCodeCiphertext(accountId);
  let code = ciphertext ? service.decryptRecoveryCode(ciphertext) : "";
  if (!code) {
    // Accounts registered before recovery codes existed, or a record written
    // under a since-rotated SESSION_SECRET. Mint a fresh one rather than
    // leaving the account with no way back.
    code = service.generateRecoveryCode();
    ciphertext = service.encryptRecoveryCode(code);
    await service.setRecoveryCodeCiphertext(accountId, ciphertext);
  }
  return { recoveryCode: code };
}

export async function regenerateRecoveryCode(accountId, overrides) {
  const service = dependencies(overrides);
  if (!accountId || !service.isDatabaseConfigured()) throw new Error("Accounts are temporarily unavailable.");
  const recoveryCode = service.generateRecoveryCode();
  await service.setRecoveryCodeCiphertext(accountId, service.encryptRecoveryCode(recoveryCode));
  return { recoveryCode };
}

// Email, display name and code together. All three are required so a leaked code
// on its own is not a password reset, and every failure reads the same.
export async function resetPasswordWithRecoveryCode(payload, overrides) {
  const service = dependencies(overrides);
  if (!service.isDatabaseConfigured()) throw new Error("Accounts are temporarily unavailable; continue as a guest.");
  const email = validateEmail(payload?.email);
  const displayName = validateDisplayName(payload?.displayName);
  const password = validatePassword(payload?.newPassword);
  const refusal = new Error("The email, callsign or recovery code is not correct.");

  const account = await service.findAccountForRecovery(email, displayName);
  if (!account || account.account_status !== "active") throw refusal;
  if (!service.recoveryCodeMatches(payload?.recoveryCode, account.recovery_code_ciphertext)) throw refusal;

  const passwordHash = await service.hashPassword(password, 12);
  const replaced = await service.replacePassword(account.id, passwordHash);
  if (!replaced) throw refusal;
  // The old code is spent. Issuing a new one keeps the account recoverable and
  // means a code seen over someone's shoulder cannot be used twice.
  const recoveryCode = service.generateRecoveryCode();
  await service.setRecoveryCodeCiphertext(account.id, service.encryptRecoveryCode(recoveryCode));
  return { ok: true, recoveryCode };
}
