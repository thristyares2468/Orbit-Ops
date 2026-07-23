import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { isDatabaseConfigured } from "../database/database.js";
import {
  createAccount, createSession, findAccountBySession, findAccountForLogin,
  getProfile, revokeSession, touchLastLogin
} from "../database/repositories/accountsRepository.js";
import { validateDisplayName, validateEmail, validatePassword } from "./validation.js";
import { SESSION_SECRET } from "./constants.js";

const SESSION_DAYS = 30;

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

async function issueSession(account) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await createSession({ accountId: account.id, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function register(payload) {
  if (!isDatabaseConfigured()) throw new Error("Accounts are temporarily unavailable; continue as a guest.");
  const email = validateEmail(payload?.email);
  const displayName = validateDisplayName(payload?.displayName);
  const password = validatePassword(payload?.password);
  const passwordHash = await bcrypt.hash(password, 12);
  let account;
  try {
    account = await createAccount({ email, displayName, passwordHash });
  } catch (error) {
    if (error.code === "23505") throw new Error("That email or display name is already registered.");
    throw error;
  }
  const session = await issueSession(account);
  return { account: safeAccount(account), ...session };
}

export async function login(payload) {
  if (!isDatabaseConfigured()) throw new Error("Accounts are temporarily unavailable; continue as a guest.");
  const email = validateEmail(payload?.email);
  const password = validatePassword(payload?.password);
  const account = await findAccountForLogin(email);
  if (!account || !(await bcrypt.compare(password, account.password_hash))) throw new Error("Email or password is incorrect.");
  if (account.account_status !== "active") throw new Error("This account cannot currently sign in.");
  await touchLastLogin(account.id);
  const session = await issueSession(account);
  return { account: safeAccount(account), ...session };
}

export async function resume(token) {
  if (!isDatabaseConfigured() || !token) return null;
  const account = await findAccountBySession(hashToken(token));
  return account ? { account: safeAccount(account) } : null;
}

export async function logout(token) {
  if (isDatabaseConfigured() && token) await revokeSession(hashToken(token));
}

export async function profile(accountId) {
  if (!accountId || !isDatabaseConfigured()) return null;
  return getProfile(accountId);
}
