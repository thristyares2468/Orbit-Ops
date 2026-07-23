export const SERVER_VERSION = "1.0.0";
export const SESSION_SECRET = process.env.SESSION_SECRET || "orbit-ops-local-development-secret-change-me";
if (process.env.NODE_ENV === "production" && SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 characters in production.");
}
export const TICK_RATE = 20;
export const SNAPSHOT_RATE = 10;
export const DISCONNECT_GRACE_MS = 45_000;
export const MAX_CHAT_LENGTH = 280;
export const MAX_NAME_LENGTH = 22;
export const MIN_NAME_LENGTH = 2;
export const MAX_ROOM_PLAYERS = 16;
export const MIN_MATCH_PLAYERS = 4;
export const PLAYER_SPEED = Object.freeze({ walk: 5.25, sprint: 7.25, crouch: 2.6 });

export const DEFAULT_SETTINGS = Object.freeze({
  mapId: "the-skeld",
  maxPlayers: 12,
  operativeCount: 2,
  discussionSeconds: 35,
  votingSeconds: 30,
  assignmentQuantity: 5,
  eliminationCooldownSeconds: 25,
  eliminationRange: 2.35,
  sabotageCooldownSeconds: 24,
  crewSpeed: 1,
  operativeSpeed: 1.04,
  crewVisibility: 1,
  operativeVisibility: 1.2,
  anonymousVoting: false,
  factionReveal: false,
  evidenceEnabled: true,
  emergencyMeetings: 1,
  finalExtractionEnabled: true,
  allowSinglePlayer: false
});

export const PHASES = Object.freeze({
  LOBBY: "lobby",
  COUNTDOWN: "countdown",
  ROLE_REVEAL: "roleReveal",
  ACTIVE: "active",
  INCIDENT: "incidentTransition",
  DISCUSSION: "discussion",
  VOTING: "voting",
  REMOVAL: "removal",
  RESULTS: "results"
});
