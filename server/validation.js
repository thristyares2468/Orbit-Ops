import { DEFAULT_SETTINGS, MAX_CHAT_LENGTH, MAX_NAME_LENGTH, MIN_NAME_LENGTH } from "./constants.js";
import { MAP_IDS } from "../public/src/shipData.js";
import { DISPOSABLE_EMAIL_DOMAINS } from "./disposableEmailDomains.js";
import { normaliseRoleSettings } from "../public/src/roleSettings.js";

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function cleanText(value, maxLength) {
  return String(value ?? "").normalize("NFKC").replace(CONTROL_CHARACTERS, "").trim().slice(0, maxLength);
}

export function validateDisplayName(value) {
  const displayName = cleanText(value, MAX_NAME_LENGTH);
  if (displayName.length < MIN_NAME_LENGTH) throw new Error(`Display name must be ${MIN_NAME_LENGTH}-${MAX_NAME_LENGTH} characters.`);
  return displayName;
}

export function validateEmail(value, { allowDisposable = true } = {}) {
  const email = cleanText(value, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error("Enter a valid email address.");
  // Only registration refuses throwaway mailboxes. Sign-in and recovery must
  // still work for an account that was created before a domain joined the list.
  if (!allowDisposable) {
    const domain = email.slice(email.lastIndexOf("@") + 1);
    if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
      throw new Error("That email provider is not accepted; use a permanent address.");
    }
  }
  return email;
}

export function validatePassword(value) {
  const password = String(value ?? "");
  if (password.length < 10 || password.length > 128) throw new Error("Password must be 10-128 characters.");
  return password;
}

export function validateChat(value) {
  const message = cleanText(value, MAX_CHAT_LENGTH);
  if (!message) throw new Error("Message is empty.");
  return message;
}

export function validateRoomCode(value) {
  // Formatting characters do not count towards the six-character wire value.
  // Strip them before applying the bound so pasted codes such as "AB-C12" work.
  const code = cleanText(value, 32).toUpperCase().replace(/[^A-Z0-9]/gu, "").slice(0, 6);
  if (!/^[A-Z0-9]{5,6}$/u.test(code)) throw new Error("Enter a valid room code.");
  return code;
}

export function validateAppearance(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const colours = ["cyan", "amber", "violet", "lime", "coral", "white", "blue", "rose"];
  const symbols = ["delta", "orbit", "nova", "pulse", "vector", "quasar", "helix", "zenith"];
  return {
    colour: colours.includes(input.colour) ? input.colour : "cyan",
    visor: /^#[0-9a-f]{6}$/iu.test(input.visor) ? input.visor : "#9defff",
    symbol: symbols.includes(input.symbol) ? input.symbol : "orbit",
    number: Math.max(1, Math.min(99, Math.round(Number(input.number) || 7))),
    accessory: ["none", "antenna", "scanner", "crest"].includes(input.accessory) ? input.accessory : "none"
  };
}

export function validateSettings(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const numeric = (key) => {
    const value = Number(source[key] ?? DEFAULT_SETTINGS[key]);
    return Number.isFinite(value) ? value : DEFAULT_SETTINGS[key];
  };
  const integer = (key, min, max) => Math.max(min, Math.min(max, Math.round(numeric(key))));
  const decimal = (key, min, max) => Math.max(min, Math.min(max, numeric(key)));
  return {
    mapId: MAP_IDS.includes(source.mapId) ? source.mapId : DEFAULT_SETTINGS.mapId,
    maxPlayers: integer("maxPlayers", 4, 16),
    operativeCount: integer("operativeCount", 1, 4),
    discussionSeconds: integer("discussionSeconds", 10, 120),
    votingSeconds: integer("votingSeconds", 10, 120),
    assignmentQuantity: integer("assignmentQuantity", 3, 8),
    eliminationCooldownSeconds: integer("eliminationCooldownSeconds", 10, 60),
    eliminationRange: decimal("eliminationRange", 1.5, 3),
    sabotageCooldownSeconds: integer("sabotageCooldownSeconds", 10, 60),
    crewSpeed: decimal("crewSpeed", 0.75, 1.35),
    operativeSpeed: decimal("operativeSpeed", 0.75, 1.35),
    crewVisibility: decimal("crewVisibility", 0.5, 1.5),
    operativeVisibility: decimal("operativeVisibility", 0.75, 1.75),
    anonymousVoting: Boolean(source.anonymousVoting),
    factionReveal: Boolean(source.factionReveal),
    evidenceEnabled: source.evidenceEnabled !== false,
    emergencyMeetings: integer("emergencyMeetings", 0, 3),
    finalExtractionEnabled: source.finalExtractionEnabled !== false,
    allowSinglePlayer: Boolean(source.allowSinglePlayer),
    roleSettings: normaliseRoleSettings(source.roleSettings, DEFAULT_SETTINGS.roleSettings)
  };
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

// Postgres raises a syntax error on a malformed uuid, which would surface to the
// player as database text. Refuse it here in the game's own words instead.
export function validateUuid(value, label = "identifier") {
  const id = cleanText(value, 40).toLowerCase();
  if (!UUID_PATTERN.test(id)) throw new Error(`That ${label} is not valid.`);
  return id;
}
