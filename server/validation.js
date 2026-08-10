import { DEFAULT_SETTINGS, MAX_CHAT_LENGTH, MAX_NAME_LENGTH, MIN_NAME_LENGTH } from "./constants.js";
import { MAP_IDS } from "../public/src/shipData.js";
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

export function validateEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error("Enter a valid email address.");
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
  const code = cleanText(value, 6).toUpperCase().replace(/[^A-Z0-9]/gu, "");
  if (!/^[A-Z0-9]{5,6}$/u.test(code)) throw new Error("Enter a valid room code.");
  return code;
}

export function validateAppearance(value = {}) {
  const colours = ["cyan", "amber", "violet", "lime", "coral", "white", "blue", "rose"];
  const symbols = ["delta", "orbit", "nova", "pulse", "vector", "quasar", "helix", "zenith"];
  return {
    colour: colours.includes(value.colour) ? value.colour : "cyan",
    visor: /^#[0-9a-f]{6}$/iu.test(value.visor) ? value.visor : "#9defff",
    symbol: symbols.includes(value.symbol) ? value.symbol : "orbit",
    number: Math.max(1, Math.min(99, Math.round(Number(value.number) || 7))),
    accessory: ["none", "antenna", "scanner", "crest"].includes(value.accessory) ? value.accessory : "none"
  };
}

export function validateSettings(input = {}) {
  const integer = (key, min, max) => Math.max(min, Math.min(max, Math.round(Number(input[key] ?? DEFAULT_SETTINGS[key]))));
  const decimal = (key, min, max) => Math.max(min, Math.min(max, Number(input[key] ?? DEFAULT_SETTINGS[key])));
  return {
    mapId: MAP_IDS.includes(input.mapId) ? input.mapId : DEFAULT_SETTINGS.mapId,
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
    anonymousVoting: Boolean(input.anonymousVoting),
    factionReveal: Boolean(input.factionReveal),
    evidenceEnabled: input.evidenceEnabled !== false,
    emergencyMeetings: integer("emergencyMeetings", 0, 3),
    finalExtractionEnabled: input.finalExtractionEnabled !== false,
    allowSinglePlayer: Boolean(input.allowSinglePlayer),
    roleSettings: normaliseRoleSettings(input.roleSettings, DEFAULT_SETTINGS.roleSettings)
  };
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
