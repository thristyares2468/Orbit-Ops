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
  discussionSeconds: 30,
  votingSeconds: 30,
  assignmentQuantity: 5,
  eliminationCooldownSeconds: 15,
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

// Sight is limited to a radius around each player, as in the reference clone: the deck
// is dark beyond it and a lights sabotage collapses the crew's radius. Radii are world
// units. Ghosts and meetings ignore all of this and see everything.
export const VISION = Object.freeze({
  crewRadius: 14,
  operativeRadius: 16.8,
  lightsOutCrewRadius: 5,
  lightsOutOperativeRadius: 14,
  blindedRadius: 3,
  // Culling margin so a player entering your radius is already interpolating smoothly.
  cullMargin: 4
});

// Practice bots paced this way so a new player gets an opening window to explore, and
// so a repaired or expired sabotage never chains straight into the next one.
export const BOT_SABOTAGE = Object.freeze({
  practiceGraceMs: 75_000,
  cooldownMs: 52_000,
  onlineGapMs: 5_000
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
