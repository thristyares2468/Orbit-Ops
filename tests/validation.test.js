import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, MAX_CHAT_LENGTH, MAX_NAME_LENGTH } from "../server/constants.js";
import {
  cleanText,
  isPlainObject,
  validateAppearance,
  validateChat,
  validateDisplayName,
  validateEmail,
  validatePassword,
  validateRoomCode,
  validateSettings
} from "../server/validation.js";

test("text validators normalise, bound and reject unusable values", () => {
  assert.equal(cleanText("  \u212B\u0007 crew  ", 20), "Å crew");
  assert.equal(validateDisplayName("AB"), "AB");
  assert.equal(validateDisplayName("x".repeat(MAX_NAME_LENGTH + 5)), "x".repeat(MAX_NAME_LENGTH));
  assert.throws(() => validateDisplayName("x"), /2-22 characters/u);

  assert.equal(validateEmail("  CAPTAIN@EXAMPLE.COM "), "captain@example.com");
  assert.throws(() => validateEmail("captain.example.com"), /valid email/u);
  assert.equal(validatePassword("x".repeat(10)).length, 10);
  assert.equal(validatePassword("x".repeat(128)).length, 128);
  assert.throws(() => validatePassword("x".repeat(9)), /10-128/u);
  assert.throws(() => validatePassword("x".repeat(129)), /10-128/u);

  assert.equal(validateChat("  hello\u0001 there  "), "hello there");
  assert.equal(validateChat("x".repeat(MAX_CHAT_LENGTH + 5)).length, MAX_CHAT_LENGTH);
  assert.throws(() => validateChat(" \u0007 "), /empty/u);
  assert.equal(validateRoomCode(" a-b c12 "), "ABC12");
  assert.throws(() => validateRoomCode("A-12"), /valid room code/u);
});

test("appearance validation accepts only supported values and safely handles malformed payloads", () => {
  assert.deepEqual(validateAppearance({
    colour: "rose", visor: "#A0b1C2", symbol: "helix", number: 101, accessory: "scanner"
  }), {
    colour: "rose", visor: "#A0b1C2", symbol: "helix", number: 99, accessory: "scanner"
  });
  assert.deepEqual(validateAppearance({
    colour: "black", visor: "green", symbol: "unknown", number: -3, accessory: "hat"
  }), {
    colour: "cyan", visor: "#9defff", symbol: "orbit", number: 1, accessory: "none"
  });
  assert.deepEqual(validateAppearance(null), {
    colour: "cyan", visor: "#9defff", symbol: "orbit", number: 7, accessory: "none"
  });
});

test("settings validation clamps every numeric boundary and preserves boolean semantics", () => {
  const low = validateSettings({
    mapId: "removed-map",
    maxPlayers: -1,
    operativeCount: -1,
    discussionSeconds: -1,
    votingSeconds: -1,
    assignmentQuantity: -1,
    eliminationCooldownSeconds: -1,
    eliminationRange: -1,
    sabotageCooldownSeconds: -1,
    crewSpeed: -1,
    operativeSpeed: -1,
    crewVisibility: -1,
    operativeVisibility: -1,
    emergencyMeetings: -1,
    anonymousVoting: 1,
    factionReveal: "yes",
    evidenceEnabled: false,
    finalExtractionEnabled: false,
    allowSinglePlayer: true
  });
  assert.deepEqual({
    mapId: low.mapId,
    maxPlayers: low.maxPlayers,
    operativeCount: low.operativeCount,
    discussionSeconds: low.discussionSeconds,
    votingSeconds: low.votingSeconds,
    assignmentQuantity: low.assignmentQuantity,
    eliminationCooldownSeconds: low.eliminationCooldownSeconds,
    eliminationRange: low.eliminationRange,
    sabotageCooldownSeconds: low.sabotageCooldownSeconds,
    crewSpeed: low.crewSpeed,
    operativeSpeed: low.operativeSpeed,
    crewVisibility: low.crewVisibility,
    operativeVisibility: low.operativeVisibility,
    emergencyMeetings: low.emergencyMeetings
  }, {
    mapId: "the-skeld",
    maxPlayers: 4,
    operativeCount: 1,
    discussionSeconds: 10,
    votingSeconds: 10,
    assignmentQuantity: 3,
    eliminationCooldownSeconds: 10,
    eliminationRange: 1.5,
    sabotageCooldownSeconds: 10,
    crewSpeed: 0.75,
    operativeSpeed: 0.75,
    crewVisibility: 0.5,
    operativeVisibility: 0.75,
    emergencyMeetings: 0
  });
  assert.equal(low.anonymousVoting, true);
  assert.equal(low.factionReveal, true);
  assert.equal(low.evidenceEnabled, false);
  assert.equal(low.finalExtractionEnabled, false);
  assert.equal(low.allowSinglePlayer, true);

  const high = validateSettings(Object.fromEntries([
    "maxPlayers", "operativeCount", "discussionSeconds", "votingSeconds", "assignmentQuantity",
    "eliminationCooldownSeconds", "eliminationRange", "sabotageCooldownSeconds", "crewSpeed",
    "operativeSpeed", "crewVisibility", "operativeVisibility", "emergencyMeetings"
  ].map((key) => [key, 9_999])));
  assert.deepEqual({
    maxPlayers: high.maxPlayers,
    operativeCount: high.operativeCount,
    discussionSeconds: high.discussionSeconds,
    votingSeconds: high.votingSeconds,
    assignmentQuantity: high.assignmentQuantity,
    eliminationCooldownSeconds: high.eliminationCooldownSeconds,
    eliminationRange: high.eliminationRange,
    sabotageCooldownSeconds: high.sabotageCooldownSeconds,
    crewSpeed: high.crewSpeed,
    operativeSpeed: high.operativeSpeed,
    crewVisibility: high.crewVisibility,
    operativeVisibility: high.operativeVisibility,
    emergencyMeetings: high.emergencyMeetings
  }, {
    maxPlayers: 16,
    operativeCount: 4,
    discussionSeconds: 120,
    votingSeconds: 120,
    assignmentQuantity: 8,
    eliminationCooldownSeconds: 60,
    eliminationRange: 3,
    sabotageCooldownSeconds: 60,
    crewSpeed: 1.35,
    operativeSpeed: 1.35,
    crewVisibility: 1.5,
    operativeVisibility: 1.75,
    emergencyMeetings: 3
  });

  const malformed = validateSettings({
    crewSpeed: "not-a-number", maxPlayers: Number.NaN, operativeSpeed: Number.POSITIVE_INFINITY
  });
  assert.equal(malformed.crewSpeed, DEFAULT_SETTINGS.crewSpeed);
  assert.equal(malformed.maxPlayers, DEFAULT_SETTINGS.maxPlayers);
  assert.equal(malformed.operativeSpeed, DEFAULT_SETTINGS.operativeSpeed);
  assert.deepEqual(validateSettings(null), validateSettings({}));
});

test("plain-object detection excludes null, arrays and class instances", () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject(Object.create(null)), false);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject(new Date()), false);
});
