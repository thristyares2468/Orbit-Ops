import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { isDatabaseConfigured } from "../database/database.js";
import { getActiveAccountRestrictions, updateSettings } from "../database/repositories/accountsRepository.js";
import { recordMatch } from "../database/repositories/statsRepository.js";
import {
  login, logout, profile, regenerateRecoveryCode, register, resetPasswordWithRecoveryCode,
  resume, revealRecoveryCode
} from "./authService.js";
import { PartyRegistry } from "./parties.js";
import { allocateRoomCode, randomRoomCode } from "./roomCodes.js";
import {
  claimRoomCode, releaseInstanceRoomCodes, releaseRoomCode, renewRoomCodes, sweepExpiredRoomCodes
} from "../database/repositories/roomCodeRepository.js";
import {
  createRestriction, findAccountByDisplayName, findAccountById, listRestrictions, revokeRestrictions
} from "../database/repositories/moderationRepository.js";
import {
  listFriends, listRecentPlayers, removeFriendship, requestFriendship, respondToFriendship
} from "../database/repositories/socialRepository.js";
import {
  createNews, leaderboardKinds, listLeaderboard, listNews
} from "../database/repositories/communityRepository.js";
import {
  DEFAULT_MAP_ID, LOBBY_MAP_ID, MAP_DEFINITIONS, distance2D, getMapDefinition, isWalkable, roomAt,
  stationById
} from "../public/src/shipData.js";
import { doorStepAllowed } from "../public/src/doorPhysics.js";
import { findWalkablePath, segmentWalkable } from "../public/src/mapPathfinding.js";
import { INTERACTION_RANGE, ROLE_TARGET_RANGE } from "../public/src/gameplayConstants.js";
import { advancePlayerPosition, movementAnimation, playerMovementSpeed } from "../public/src/movementPhysics.js";
import { rolePoolForFaction } from "../public/src/roleSettings.js";
import {
  ROLE_DEFINITIONS, getRoleDefinition, roleIdsForFaction
} from "../public/src/roleData.js";
import {
  BOT_SABOTAGE, DEFAULT_SETTINGS, DISCONNECT_GRACE_MS, MAX_ROOM_PLAYERS, MEETING_PHASES,
  MIN_MATCH_PLAYERS, PHASES, SERVER_VERSION, SESSION_SECRET, SNAPSHOT_RATE,
  TICK_RATE, VISION
} from "./constants.js";
import { RateLimiter } from "./rateLimits.js";
import { checkSoloWin, fireHook, performRoleAbility, survivorWinnerIds } from "./roleEngine.js";
import {
  cleanText, isPlainObject, validateAppearance, validateChat, validateDisplayName, validateUuid,
  validateRoomCode, validateSettings
} from "./validation.js";

const IP_LIMITED_AUTH_ACTIONS = new Set(["login", "register", "resumeSession"]);
// The previous room capability exists only to recover a successful resume whose
// acknowledgement was lost. It must not become a second long-lived bearer.
const REJOIN_PREVIOUS_TOKEN_GRACE_MS = 15_000;
// A station may widen its own reach; the emergency button sits on the cafeteria
// table, which nobody can stand on, so it is worked from the floor around it.
const reachOf = (station) => station?.range ?? INTERACTION_RANGE;

// Where the next leg of a multi-room assignment is, in words.
function roomLabel(map, site) {
  if (!site) return "another console";
  return site.label
    ?? map.rooms.find((room) => room.id === site.roomId)?.name
    ?? String(site.roomId ?? "").replaceAll("-", " ");
}

// Each sabotage is repaired at its own kind of panel, and the state that has to be
// shared between everyone working on it lives here rather than on any one client:
// the breakers are a single set of switches all players toggle, the reactor needs
// two scanners held in the same moment, and O2's code is one code for both keypads.
function makeRepairPanel(definition) {
  const pick = (n) => Math.floor(Math.random() * n);
  switch (definition.repairKind) {
    case "switches": {
      // One to five of the five are thrown, as the real panel does.
      const switches = [true, true, true, true, true];
      const down = 1 + pick(5);
      const order = shuffle([0, 1, 2, 3, 4]).slice(0, down);
      for (const index of order) switches[index] = false;
      return { kind: "switches", switches };
    }
    case "keypad":
      // Six digits, the same at every keypad, written on the sticky note beside it.
      return { kind: "keypad", code: Array.from({ length: 6 }, () => pick(10)).join("") };
    case "radio":
      // Where on the dial the carrier sits. Not a secret - the waveform shows it -
      // so the client gets it and the server re-checks whatever it is handed.
      return { kind: "radio", target: 0.12 + Math.random() * 0.76, tolerance: 0.045 };
    case "handprint":
      return { kind: "handprint", holds: {} };
    default:
      return { kind: "none" };
  }
}

// What a client is allowed to see of the panel. Shared broadcasts omit details
// that must be read at the console itself; the server still keeps one canonical
// puzzle so everyone working there sees the same state.
function publicRepairPanel(sabotage, { includeKeypadCode = false } = {}) {
  const panel = sabotage.panel ?? { kind: "none" };
  const now = Date.now();
  const base = { kind: panel.kind, repaired: [...sabotage.repairs] };
  if (panel.kind === "switches") return { ...base, switches: [...panel.switches] };
  if (panel.kind === "keypad") {
    return includeKeypadCode ? { ...base, code: panel.code } : base;
  }
  if (panel.kind === "radio") return { ...base, target: panel.target, tolerance: panel.tolerance };
  if (panel.kind === "handprint") {
    return {
      ...base,
      held: Object.entries(panel.holds).filter(([, until]) => until > now).map(([id]) => id),
      required: sabotage.repairStations.length
    };
  }
  return base;
}

// Whatever the minigame needs the server to decide rather than the client:
// the Simon Says pattern for the reactor, which vial is the odd one out, which
// wires pair with which. Display data, not a secret - the client has to draw it -
// but generated here so every player at that console sees the same puzzle.
function makeTaskChallenge(definition, site = 0) {
  const pick = (n) => Math.floor(Math.random() * n);
  const shuffled = (list) => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = pick(i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  switch (definition.kind) {
    case "reactor":
      // Five rounds, each one square longer than the last.
      return Array.from({ length: definition.steps }, (_, round) =>
        Array.from({ length: round + 1 }, () => pick(4)));
    case "wiring":
      // Which right-hand terminal each left-hand wire belongs to.
      return shuffled([0, 1, 2, 3]);
    case "sample":
      return [pick(6)];
    case "shields":
      return shuffled([0, 1, 2, 3, 4, 5]).slice(0, 3 + pick(3));
    case "calibrate":
      return Array.from({ length: definition.steps }, () => pick(4));
    default:
      return [site];
  }
}
function hashOpaque(value) {
  return createHmac("sha256", SESSION_SECRET).update(String(value)).digest("hex");
}

export function rateLimitKey(socket, action) {
  const clientIp = socket.data?.clientIp || socket.handshake?.address || "unknown";
  return IP_LIMITED_AUTH_ACTIONS.has(action)
    ? `ip:${clientIp}:${action}`
    : `socket:${clientIp}:${socket.id}:${action}`;
}

function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function choose(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function makeRoleState(roleId) {
  const definition = getRoleDefinition(roleId);
  return {
    usesLeft: definition.ability?.uses ?? null,
    cooldownEndsAt: 0,
    activeUntil: 0,
    protectedUntil: 0,
    targetId: null,
    trackedTargetId: null,
    shieldTargetId: null,
    morphTargetId: null,
    // Whatever extra state the role declares for itself.
    ...definition.state
  };
}

function privateRoleState(player) {
  const state = player.roleState ?? makeRoleState(player.role);
  return {
    usesLeft: state.usesLeft,
    cooldownEndsAt: state.cooldownEndsAt,
    activeUntil: state.activeUntil,
    protectedUntil: state.protectedUntil,
    trackedTargetId: state.trackedTargetId,
    shieldTargetId: state.shieldTargetId,
    morphTargetId: state.morphTargetId
  };
}

// Players stand in the shared dropship lobby until a match starts, so movement,
// collision, and interaction all resolve against the lobby map while phase is LOBBY.
function activeMapId(room) {
  return room.phase === PHASES.LOBBY ? LOBBY_MAP_ID : room.mapId;
}

function makeStats() {
  return {
    tasksCompleted: 0, sabotagesStarted: 0, sabotagesRepaired: 0,
    eliminations: 0, incidentsReported: 0, correctVotes: 0,
    incorrectVotes: 0, evidenceFound: 0
  };
}

function normaliseInput(payload) {
  const x = Number(payload?.x);
  const z = Number(payload?.z);
  const yaw = Number(payload?.yaw);
  const magnitude = Math.hypot(x, z);
  return {
    x: Number.isFinite(x) && magnitude > 0 ? x / Math.max(1, magnitude) : 0,
    z: Number.isFinite(z) && magnitude > 0 ? z / Math.max(1, magnitude) : 0,
    yaw: Number.isFinite(yaw) ? Math.atan2(Math.sin(yaw), Math.cos(yaw)) : 0,
    crouch: Boolean(payload?.crouch),
    seq: Math.max(0, Math.round(Number(payload?.seq) || 0))
  };
}

function resetClientMovementTrail(player) {
  player.lastClientMoveAt = 0;
  player.lastClientMoveSeq = -1;
  player.lastClientPosition = null;
  player.lastClientPredictionAt = 0;
}

function publicPlayer(player) {
  return {
    id: player.id,
    displayName: player.displayName,
    guest: player.guest,
    appearance: player.appearance,
    ready: player.ready,
    connected: player.connected,
    alive: player.alive,
    bot: player.bot,
    isHost: player.isHost,
    currentRoom: player.currentRoom,
    voted: Boolean(player.vote),
    spectator: !player.alive
  };
}

function snapshotPlayer(player, room, shieldedPlayerIds = new Set(), now = Date.now()) {
  const morphTarget = player.role === "morphling" && player.roleState?.activeUntil > now
    ? room.players.get(player.roleState.morphTargetId)
    : null;
  return {
    id: player.id,
    x: Number(player.position.x.toFixed(3)),
    z: Number(player.position.z.toFixed(3)),
    y: player.jumpUntil > Date.now() ? 0.45 : 0,
    yaw: Number(player.rotation.toFixed(3)),
    animation: player.animation,
    alive: player.alive,
    connected: player.connected,
    roomId: player.currentRoom,
    seq: player.lastInputSeq,
    visualAppearance: morphTarget?.appearance ?? player.appearance,
    hidden: Boolean(player.ventId) || (player.role === "swooper" && player.roleState?.activeUntil > now),
    shielded: shieldedPlayerIds.has(player.id) || player.roleState?.protectedUntil > now
  };
}

// Assign each vent exit the WASD key that reaches it, guaranteeing the keys are
// unique within the loop. A plain "nearest compass direction" is not enough: from the
// Cafeteria vent both Admin and the Hallway lie south, so one of them would have been
// unreachable by keyboard. Each exit is scored against all four directions and the
// strongest unambiguous pairing wins, so every exit always has its own key.
const VENT_KEYS = Object.freeze([
  Object.freeze({ key: "W", x: 0, z: -1 }),
  Object.freeze({ key: "S", x: 0, z: 1 }),
  Object.freeze({ key: "A", x: -1, z: 0 }),
  Object.freeze({ key: "D", x: 1, z: 0 })
]);

function assignVentKeys(from, exits) {
  const scored = [];
  for (const exit of exits) {
    const dx = Number(exit.x) - Number(from.x);
    const dz = Number(exit.z) - Number(from.z);
    const length = Math.hypot(dx, dz) || 1;
    for (const { key, x, z } of VENT_KEYS) {
      scored.push({ exitId: exit.id, key, score: (dx / length) * x + (dz / length) * z });
    }
  }
  // Strongest alignment first, each exit and each key claimed at most once.
  scored.sort((a, b) => b.score - a.score);
  const byExit = new Map();
  const usedKeys = new Set();
  for (const candidate of scored) {
    if (byExit.has(candidate.exitId) || usedKeys.has(candidate.key)) continue;
    byExit.set(candidate.exitId, candidate.key);
    usedKeys.add(candidate.key);
  }
  return byExit;
}

export class GameServer {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.socketPlayers = new Map();
    this.rateLimiter = new RateLimiter();
    this.parties = new PartyRegistry();
    // Identifies this process in the shared room-code directory. A random id per
    // boot is right: a restarted instance has no rooms, so its old claims should
    // lapse rather than be reclaimed.
    this.instanceId = process.env.ORBIT_INSTANCE_ID || `orbit-${randomUUID()}`;
    this.roomCodeLeaseSeconds = 900;
    this.roomCodeUpkeep = setInterval(() => this.renewRoomCodeLeases(), 300_000);
    this.roomCodeUpkeep.unref?.();
    this.startedAt = Date.now();
    this.lastTickAt = Date.now();
    this.loop = setInterval(() => this.tick(), 1000 / TICK_RATE);
    this.rateCleanup = setInterval(() => this.rateLimiter.cleanup(), 60_000);
    this.io.on("connection", (socket) => this.registerSocket(socket));
  }

  get connectedPlayers() {
    let count = 0;
    for (const room of this.rooms.values()) count += [...room.players.values()].filter((player) => player.connected && !player.bot).length;
    return count;
  }

  get activeRooms() {
    return [...this.rooms.values()].filter((room) => room.players.size > 0).length;
  }

  registerSocket(socket) {
    socket.data.auth = null;
    socket.emit("connected", {
      socketId: socket.id,
      serverVersion: SERVER_VERSION,
      databaseConfigured: isDatabaseConfigured(),
      serverTime: Date.now()
    });

    socket.on("guestLogin", (payload, ack) => this.guard(socket, "guestLogin", 5, 60_000, ack, async () => {
      const displayName = validateDisplayName(payload?.displayName ?? `Explorer-${Math.floor(Math.random() * 900 + 100)}`);
      socket.data.auth = {
        accountId: null, displayName, guest: true,
        role: "player",
        appearance: validateAppearance(payload?.appearance)
      };
      const result = { ok: true, guest: true, displayName, account: null };
      return result;
    }));

    socket.on("register", (payload, ack) => this.guard(socket, "register", 3, 5 * 60_000, ack, async () => {
      const result = await register(payload);
      socket.data.auth = {
        accountId: result.account.id, displayName: result.account.displayName,
        guest: false, role: result.account.role ?? "player", appearance: validateAppearance(payload?.appearance)
      };
      const response = { ok: true, ...result };
      return response;
    }));

    socket.on("login", (payload, ack) => this.guard(socket, "login", 5, 5 * 60_000, ack, async () => {
      const result = await login(payload);
      socket.data.auth = {
        accountId: result.account.id, displayName: result.account.displayName,
        guest: false, role: result.account.role ?? "player", appearance: validateAppearance(payload?.appearance)
      };
      const response = { ok: true, ...result };
      return response;
    }));

    socket.on("resumeSession", (payload, ack) => this.guard(socket, "resumeSession", 8, 60_000, ack, async () => {
      const result = await resume(payload?.token);
      if (!result) throw new Error("Your saved account session has expired.");
      socket.data.auth = {
        accountId: result.account.id, displayName: result.account.displayName,
        guest: false, role: result.account.role ?? "player", appearance: validateAppearance(payload?.appearance)
      };
      const response = { ok: true, ...result };
      return response;
    }));

    socket.on("logout", (payload, ack) => this.guard(socket, "logout", 5, 60_000, ack, async () => {
      await logout(payload?.token);
      this.leaveCurrentRoom(socket, false);
      socket.data.auth = null;
      return { ok: true };
    }));

    socket.on("requestProfile", (_payload, ack) => this.guard(socket, "profile", 10, 60_000, ack, async () => {
      this.requireAuth(socket);
      if (socket.data.auth.guest) return { ok: true, guest: true };
      return { ok: true, profile: await profile(socket.data.auth.accountId) };
    }));

    // --- account recovery -------------------------------------------------

    socket.on("revealRecoveryCode", (_payload, ack) => this.guard(socket, "revealRecoveryCode", 4, 60_000, ack, async () => {
      this.requireAuth(socket);
      if (socket.data.auth.guest) throw new Error("Guests have no account to recover.");
      return { ok: true, ...(await revealRecoveryCode(socket.data.auth.accountId)) };
    }));

    socket.on("regenerateRecoveryCode", (_payload, ack) => this.guard(socket, "regenerateRecoveryCode", 3, 5 * 60_000, ack, async () => {
      this.requireAuth(socket);
      if (socket.data.auth.guest) throw new Error("Guests have no account to recover.");
      return { ok: true, ...(await regenerateRecoveryCode(socket.data.auth.accountId)) };
    }));

    // Deliberately available without a session - it is the way back in when you
    // have none. Rate limited hard because it is an unauthenticated write.
    socket.on("resetPassword", (payload, ack) => this.guard(socket, "resetPassword", 4, 15 * 60_000, ack, async () =>
      resetPasswordWithRecoveryCode(payload)));

    // --- moderation -------------------------------------------------------

    socket.on("moderationList", (_payload, ack) => this.guard(socket, "moderationList", 10, 60_000, ack, async () => {
      await this.requireModerator(socket);
      const [bans, mutes] = await Promise.all([listRestrictions("bans"), listRestrictions("mutes")]);
      return { ok: true, bans, mutes };
    }));

    socket.on("moderationAct", (payload, ack) => this.guard(socket, "moderationAct", 20, 60_000, ack, async () => {
      const moderator = await this.requireModerator(socket);
      const action = String(payload?.action ?? "");
      if (!["ban", "unban", "mute", "unmute"].includes(action)) throw new Error("Unknown moderation action.");
      const target = await findAccountByDisplayName(validateDisplayName(payload?.displayName));
      if (!target) throw new Error("No account with that callsign.");
      if (String(target.id) === String(moderator.accountId)) throw new Error("You cannot restrict your own account.");
      if (["owner", "admin"].includes(target.role) && moderator.role !== "owner") {
        throw new Error("Only the owner can restrict another moderator.");
      }
      const table = action.endsWith("ban") ? "bans" : "mutes";
      if (["ban", "mute"].includes(action)) {
        const hours = Number(payload?.hours);
        await createRestriction(table, {
          accountId: target.id,
          reason: cleanText(payload?.reason, 500) || "No reason recorded.",
          issuedBy: moderator.accountId,
          expiresAt: Number.isFinite(hours) && hours > 0
            ? new Date(Date.now() + Math.min(hours, 24 * 365) * 3_600_000)
            : null
        });
        if (table === "bans") this.evictAccount(target.id, "You have been removed by a moderator.");
      } else {
        await revokeRestrictions(table, target.id);
      }
      const [bans, mutes] = await Promise.all([listRestrictions("bans"), listRestrictions("mutes")]);
      return { ok: true, action, displayName: target.display_name, bans, mutes };
    }));

    // --- friends ----------------------------------------------------------

    socket.on("friendList", (_payload, ack) => this.guard(socket, "friendList", 15, 60_000, ack, async () => {
      const accountId = this.requireAccount(socket);
      const [friends, recent] = await Promise.all([listFriends(accountId), listRecentPlayers(accountId)]);
      return { ok: true, friends, recent };
    }));

    socket.on("friendRequest", (payload, ack) => this.guard(socket, "friendRequest", 12, 60_000, ack, async () => {
      const accountId = this.requireAccount(socket);
      const target = await findAccountByDisplayName(validateDisplayName(payload?.displayName));
      if (!target) throw new Error("No account with that callsign.");
      if (String(target.id) === String(accountId)) throw new Error("You cannot add yourself.");
      await requestFriendship(accountId, target.id);
      this.notifyAccount(target.id, "friendActivity", { from: socket.data.auth.displayName });
      return { ok: true, friends: await listFriends(accountId) };
    }));

    socket.on("friendRespond", (payload, ack) => this.guard(socket, "friendRespond", 15, 60_000, ack, async () => {
      const accountId = this.requireAccount(socket);
      await respondToFriendship(accountId, validateUuid(payload?.friendshipId, "invitation"), Boolean(payload?.accept));
      return { ok: true, friends: await listFriends(accountId) };
    }));

    socket.on("friendRemove", (payload, ack) => this.guard(socket, "friendRemove", 15, 60_000, ack, async () => {
      const accountId = this.requireAccount(socket);
      await removeFriendship(accountId, validateUuid(payload?.friendshipId, "friendship"));
      return { ok: true, friends: await listFriends(accountId) };
    }));

    // --- party ------------------------------------------------------------

    socket.on("partyState", (_payload, ack) => this.guard(socket, "partyState", 20, 60_000, ack, async () => {
      const accountId = this.requireAccount(socket);
      return { ok: true, party: this.parties.publicView(this.parties.partyFor(accountId), accountId) };
    }));

    socket.on("partyInvite", (payload, ack) => this.guard(socket, "partyInvite", 12, 60_000, ack, async () => {
      const accountId = this.requireAccount(socket);
      const target = await findAccountByDisplayName(validateDisplayName(payload?.displayName));
      if (!target) throw new Error("No account with that callsign.");
      this.parties.create({ accountId, displayName: socket.data.auth.displayName });
      const party = this.parties.invite(accountId, { accountId: target.id, displayName: target.display_name });
      this.notifyAccount(target.id, "partyInvited", {
        partyId: party.id, from: socket.data.auth.displayName
      });
      this.broadcastParty(party);
      return { ok: true, party: this.parties.publicView(party, accountId) };
    }));

    socket.on("partyRespond", (payload, ack) => this.guard(socket, "partyRespond", 15, 60_000, ack, async () => {
      const accountId = this.requireAccount(socket);
      const { party, joined } = this.parties.respond(accountId, payload?.partyId, Boolean(payload?.accept));
      this.broadcastParty(party);
      return { ok: true, joined, party: joined ? this.parties.publicView(party, accountId) : null };
    }));

    socket.on("partyLeave", (_payload, ack) => this.guard(socket, "partyLeave", 15, 60_000, ack, async () => {
      const accountId = this.requireAccount(socket);
      const party = this.parties.leave(accountId);
      if (party) this.broadcastParty(party);
      return { ok: true, party: null };
    }));

    socket.on("partyKick", (payload, ack) => this.guard(socket, "partyKick", 12, 60_000, ack, async () => {
      const accountId = this.requireAccount(socket);
      const party = this.parties.kick(accountId, payload?.accountId);
      this.broadcastParty(party);
      return { ok: true, party: this.parties.publicView(party, accountId) };
    }));

    // --- leaderboards and news --------------------------------------------

    socket.on("leaderboard", (payload, ack) => this.guard(socket, "leaderboard", 10, 60_000, ack, async () => {
      this.requireAuth(socket);
      if (!isDatabaseConfigured()) return { ok: true, kinds: leaderboardKinds(), entries: [], unavailable: true };
      const kind = String(payload?.kind ?? "score");
      return { ok: true, kind, kinds: leaderboardKinds(), entries: await listLeaderboard(kind) };
    }));

    socket.on("newsList", (_payload, ack) => this.guard(socket, "newsList", 10, 60_000, ack, async () => {
      this.requireAuth(socket);
      if (!isDatabaseConfigured()) return { ok: true, posts: [] };
      return { ok: true, posts: await listNews() };
    }));

    socket.on("newsPost", (payload, ack) => this.guard(socket, "newsPost", 6, 60_000, ack, async () => {
      const moderator = await this.requireModerator(socket);
      const title = cleanText(payload?.title, 120);
      const body = cleanText(payload?.body, 4000);
      if (!title || !body) throw new Error("A bulletin needs a title and a body.");
      await createNews({ title, body, postedBy: moderator.accountId });
      const posts = await listNews();
      this.io.emit("newsUpdated", { posts });
      return { ok: true, posts };
    }));

    socket.on("saveSettings", (payload, ack) => this.guard(socket, "saveSettings", 12, 60_000, ack, async () => {
      this.requireAuth(socket);
      if (socket.data.auth.guest || !isDatabaseConfigured()) return { ok: true, persisted: false };
      const settings = this.validatePlayerSettings(payload);
      await updateSettings(socket.data.auth.accountId, settings);
      return { ok: true, persisted: true };
    }));

    socket.on("joinPublic", (_payload, ack) => this.guard(socket, "joinPublic", 8, 60_000, ack, async () => {
      this.requireAuth(socket);
      // Check persistent restrictions before allocating. Otherwise a banned
      // account can reconnect repeatedly and leave an unbounded trail of empty
      // rooms that no player ever joins or reaps.
      await this.requireAccountAccess(socket.data.auth.accountId);
      // A party has to land in one room together, so matchmaking looks for a
      // lobby with room for the whole group rather than for one more player.
      const seats = this.parties.seatsRequired(socket.data.auth.accountId);
      let room = [...this.rooms.values()].find((candidate) => candidate.mode === "public"
        && candidate.phase === PHASES.LOBBY
        && candidate.players.size + seats <= candidate.settings.maxPlayers);
      if (!room) room = this.createRoom("public", {}, await this.allocateSharedRoomCode());
      const result = await this.joinRoom(socket, room, { accessChecked: true });
      this.summonParty(socket, room);
      return result;
    }));

    socket.on("createRoom", (payload, ack) => this.guard(socket, "createRoom", 6, 60_000, ack, async () => {
      this.requireAuth(socket);
      await this.requireAccountAccess(socket.data.auth.accountId);
      const mode = payload?.mode === "practice" ? "practice" : "private";
      const room = this.createRoom(mode, payload?.settings, await this.allocateSharedRoomCode());
      const result = await this.joinRoom(socket, room, { accessChecked: true });
      if (mode === "practice") {
        room.practiceRoles.set(result.playerId, "operations-crew");
        this.populatePracticeBots(room, this.practicePopulationTarget(room));
        result.room = this.serialiseRoom(room);
      }
      this.broadcastRoomState(room);
      return result;
    }));

    socket.on("joinRoom", (payload, ack) => this.guard(socket, "joinRoom", 10, 60_000, ack, async () => {
      this.requireAuth(socket);
      const code = validateRoomCode(payload?.code);
      const room = this.rooms.get(code);
      if (!room) throw new Error("Room not found.");
      return this.joinRoom(socket, room);
    }));

    socket.on("resumeRoom", (payload, ack) => this.guard(socket, "resumeRoom", 10, 60_000, ack, async () => {
      this.requireAuth(socket);
      return this.resumeRoom(socket, payload?.token);
    }));

    socket.on("leaveRoom", (_payload, ack) => this.guard(socket, "leaveRoom", 10, 60_000, ack, async () => {
      this.leaveCurrentRoom(socket, false);
      return { ok: true };
    }));

    socket.on("readyState", (payload, ack) => this.withPlayer(socket, "readyState", 12, 10_000, ack, (room, player) => {
      if (room.phase !== PHASES.LOBBY) throw new Error("Ready state can only change in the lobby.");
      player.ready = Boolean(payload?.ready);
      this.broadcastRoomState(room);
      const connectedHumans = [...room.players.values()].filter((candidate) => candidate.connected && !candidate.bot);
      if (room.mode === "public" && connectedHumans.length >= MIN_MATCH_PLAYERS && connectedHumans.every((candidate) => candidate.ready)) {
        this.startMatch(room);
      }
      return { ok: true, ready: player.ready };
    }));

    socket.on("hostSettings", (payload, ack) => this.withPlayer(socket, "hostSettings", 10, 10_000, ack, (room, player) => {
      this.requireHost(room, player);
      if (room.phase !== PHASES.LOBBY) throw new Error("Match settings are locked after countdown.");
      const nextSettings = validateSettings({
        ...room.settings,
        ...payload,
        roleSettings: { ...room.settings.roleSettings, ...payload?.roleSettings }
      });
      const humanCount = [...room.players.values()].filter((candidate) => !candidate.bot).length;
      if (nextSettings.maxPlayers < humanCount) {
        throw new Error(`Max crew cannot be lower than the ${humanCount} human crew already aboard.`);
      }
      room.settings = nextSettings;
      room.mapId = room.settings.mapId;
      if (room.settings.operativeCount >= room.settings.maxPlayers) room.settings.operativeCount = Math.max(1, room.settings.maxPlayers - 1);
      if (room.mode === "practice") {
        // Raising the Operative count after creating the room must also grow
        // the simulation. Otherwise a valid settings change can launch at
        // instant parity and end before the player can move.
        this.syncPracticeBots(room);
      }
      this.broadcastRoomState(room);
      return { ok: true, settings: room.settings };
    }));

    socket.on("practiceRole", (payload, ack) => this.withPlayer(socket, "practiceRole", 6, 10_000, ack, (room, player) => {
      if (room.mode !== "practice" || room.phase !== PHASES.LOBBY) throw new Error("Role selection is only available in a practice lobby.");
      const requested = String(payload?.role);
      const role = ROLE_DEFINITIONS[requested] && requested !== "guardian-angel" ? requested : "operations-crew";
      room.practiceRoles.set(player.id, role);
      return { ok: true, role };
    }));

    socket.on("startMatch", (_payload, ack) => this.withPlayer(socket, "startMatch", 4, 10_000, ack, (room, player) => {
      this.requireHost(room, player);
      // Staff roles are deliberately narrow in Orbit Ops: they may run a small
      // private operation for moderation/testing, but do not inherit room-host
      // controls in somebody else's lobby.
      const staffTest = room.mode === "private"
        && ["moderator", "admin", "owner"].includes(socket.data.auth?.role);
      this.startMatch(room, { staffTest });
      return { ok: true };
    }));

    socket.on("returnToLobby", (_payload, ack) => this.withPlayer(socket, "returnToLobby", 4, 10_000, ack, (room, player) => {
      if (room.phase !== PHASES.RESULTS) throw new Error("The current operation has not ended.");
      this.resetRoomToLobby(room);
      return { ok: true, room: this.serialiseRoom(room) };
    }));

    socket.on("playerInput", (payload) => this.withPlayer(socket, "playerInput", 40, 1000, null, (room, player) => {
      if (![PHASES.ACTIVE, PHASES.LOBBY].includes(room.phase)) return { ok: true };
      const now = Date.now();
      const input = normaliseInput(payload);
      this.acceptClientPrediction(room, player, payload?.position, input, now);
      player.input = input;
      player.lastInputAt = now;
      return { ok: true };
    }));

    socket.on("jump", (_payload, ack) => this.withPlayer(socket, "jump", 4, 3000, ack, (room, player) => {
      if (room.phase !== PHASES.ACTIVE || !player.alive || player.jumpUntil > Date.now()) throw new Error("Cannot jump right now.");
      player.jumpUntil = Date.now() + 550;
      return { ok: true };
    }));

    socket.on("beginTask", (payload, ack) => this.withPlayer(socket, "beginTask", 8, 10_000, ack, (room, player) => this.beginTask(room, player, payload)));
    socket.on("taskAction", (payload, ack) => this.withPlayer(socket, "taskAction", 12, 5000, ack, (room, player) => this.taskAction(room, player, payload)));
    socket.on("sabotageRequest", (payload, ack) => this.withPlayer(socket, "sabotageRequest", 4, 10_000, ack, (room, player) => this.startSabotage(room, player, payload?.sabotageId, payload?.doorTargetId)));
    socket.on("repairSabotage", (payload, ack) => this.withPlayer(socket, "repairSabotage", 8, 10_000, ack, (room, player) => this.repairSabotage(room, player, payload?.stationId)));
    // The reactor's scanners have to be re-pinged while held, so this one needs a
    // far higher allowance than opening a panel does.
    socket.on("repairAction", (payload, ack) => this.withPlayer(socket, "repairAction", 90, 10_000, ack, (room, player) => this.repairAction(room, player, payload ?? {})));
    socket.on("eliminationAttempt", (payload, ack) => this.withPlayer(socket, "eliminationAttempt", 6, 10_000, ack, (room, player) => this.eliminationAttempt(room, player, payload?.targetId)));
    socket.on("roleAction", (payload, ack) => this.withPlayer(socket, "roleAction", 8, 10_000, ack, (room, player) => this.roleAction(room, player, payload)));
    socket.on("reportIncident", (payload, ack) => this.withPlayer(socket, "reportIncident", 5, 10_000, ack, (room, player) => this.reportIncident(room, player, payload?.incidentId)));
    socket.on("callMeeting", (_payload, ack) => this.withPlayer(socket, "callMeeting", 4, 30_000, ack, (room, player) => this.callMeeting(room, player)));
    socket.on("submitVote", (payload, ack) => this.withPlayer(socket, "submitVote", 6, 10_000, ack, (room, player) => this.submitVote(room, player, payload?.targetId)));
    socket.on("enterVent", (payload, ack) => this.withPlayer(socket, "enterVent", 8, 10_000, ack, (room, player) => this.enterVent(room, player, payload?.stationId)));
    socket.on("moveVent", (payload, ack) => this.withPlayer(socket, "moveVent", 20, 10_000, ack, (room, player) => this.moveVent(room, player, payload?.stationId)));
    socket.on("exitVent", (_payload, ack) => this.withPlayer(socket, "exitVent", 8, 10_000, ack, (room, player) => this.exitVent(room, player)));
    socket.on("requestSecurity", (_payload, ack) => this.withPlayer(socket, "requestSecurity", 5, 10_000, ack, (room, player) => this.requestSecurity(room, player)));
    socket.on("requestAdmin", (_payload, ack) => this.withPlayer(socket, "requestAdmin", 8, 10_000, ack, (room, player) => this.requestAdmin(room, player)));
    socket.on("chatMessage", (payload, ack) => this.withPlayer(socket, "chatMessage", 6, 10_000, ack, async (room, player) => {
      await this.requireAccountAccess(player.accountId, { chat: true });
      return this.chat(room, player, payload?.message);
    }));
    socket.on("customisePlayer", (payload, ack) => this.withPlayer(socket, "customisePlayer", 8, 10_000, ack, (room, player) => {
      if (room.phase !== PHASES.LOBBY) throw new Error("Appearance is locked during a match.");
      player.appearance = validateAppearance(payload);
      socket.data.auth.appearance = player.appearance;
      this.broadcastRoomState(room);
      return { ok: true, appearance: player.appearance };
    }));
    socket.on("ping", (payload) => socket.emit("pong", { clientTime: Number(payload?.clientTime) || Date.now(), serverTime: Date.now() }));

    socket.on("disconnect", () => this.leaveCurrentRoom(socket, true));
  }

  async guard(socket, action, limit, windowMs, ack, callback) {
    try {
      if (!this.rateLimiter.allow(rateLimitKey(socket, action), limit, windowMs)) throw new Error("Too many requests. Please wait a moment.");
      const result = await callback();
      if (typeof ack === "function") ack(result ?? { ok: true });
    } catch (error) {
      const message = cleanText(error?.message ?? "Request failed.", 180);
      if (typeof ack === "function") ack({ ok: false, error: message });
      else socket.emit("errorMessage", { action, message });
    }
  }

  withPlayer(socket, action, limit, windowMs, ack, callback) {
    return this.guard(socket, action, limit, windowMs, ack, async () => {
      const link = this.socketPlayers.get(socket.id);
      if (!link) throw new Error("Join a room first.");
      const room = this.rooms.get(link.roomCode);
      const player = room?.players.get(link.playerId);
      if (!room || !player || !player.connected) throw new Error("Player state is unavailable.");
      return callback(room, player);
    });
  }

  requireAuth(socket) {
    if (!socket.data.auth) throw new Error("Sign in or continue as a guest first.");
  }

  // An account-bound action: guests are excluded because none of these features
  // can survive a guest's identity vanishing on reconnect.
  requireAccount(socket) {
    this.requireAuth(socket);
    if (socket.data.auth.guest || !socket.data.auth.accountId) {
      throw new Error("Sign in with an account to use this.");
    }
    if (!isDatabaseConfigured()) throw new Error("Accounts are temporarily unavailable.");
    return socket.data.auth.accountId;
  }

  // Role is read from the database rather than from the socket's cached auth, so
  // a demotion takes effect immediately rather than at the next sign-in.
  async requireModerator(socket) {
    const accountId = this.requireAccount(socket);
    const account = await findAccountById(accountId);
    if (!account || !["moderator", "admin", "owner"].includes(account.role)) {
      throw new Error("Only a moderator can do that.");
    }
    return { accountId, role: account.role };
  }

  socketsForAccount(accountId) {
    const wanted = String(accountId ?? "");
    if (!wanted) return [];
    return [...this.io.sockets.sockets.values()]
      .filter((candidate) => String(candidate.data?.auth?.accountId ?? "") === wanted);
  }

  notifyAccount(accountId, event, payload) {
    for (const target of this.socketsForAccount(accountId)) target.emit(event, payload);
  }

  broadcastParty(party) {
    if (!party) return;
    for (const memberId of party.members.keys()) {
      this.notifyAccount(memberId, "partyUpdated", { party: this.parties.publicView(party, memberId) });
    }
  }

  // A freshly banned account should not keep playing until it next signs in.
  evictAccount(accountId, message) {
    for (const target of this.socketsForAccount(accountId)) {
      target.emit("errorMessage", { action: "moderation", message });
      this.leaveCurrentRoom(target, false);
      target.disconnect(true);
    }
  }

  // Pull the rest of the party into the room this socket just joined. Failures
  // are per-member and non-fatal: one member being unreachable must not undo
  // the join that already succeeded.
  summonParty(socket, room) {
    const accountId = socket.data.auth?.accountId;
    const party = accountId ? this.parties.partyFor(accountId) : null;
    if (!party) return;
    for (const memberId of party.members.keys()) {
      if (String(memberId) === String(accountId)) continue;
      for (const member of this.socketsForAccount(memberId)) {
        if (this.socketPlayers.has(member.id)) continue;
        this.joinRoom(member, room).catch((error) => {
          member.emit("errorMessage", { action: "party", message: error.message });
        });
      }
    }
  }

  requireHost(room, player) {
    if (room.hostId !== player.id) throw new Error("Only the room host can do that.");
  }

  async requireAccountAccess(accountId, { chat = false } = {}) {
    if (!accountId || !isDatabaseConfigured()) return;
    const restrictions = await getActiveAccountRestrictions(accountId);
    if (restrictions.banned) throw new Error("This account is banned from multiplayer.");
    if (chat && restrictions.muted) throw new Error("This account is muted.");
  }

  validatePlayerSettings(value = {}) {
    return {
      masterVolume: Math.max(0, Math.min(1, Number(value.masterVolume) || 0)),
      musicVolume: Math.max(0, Math.min(1, Number(value.musicVolume) || 0)),
      sfxVolume: Math.max(0, Math.min(1, Number(value.sfxVolume) || 0)),
      mouseSensitivity: Math.max(0.1, Math.min(4, Number(value.mouseSensitivity) || 1)),
      cameraDistance: Math.max(4, Math.min(14, Number(value.cameraDistance) || 8)),
      invertY: Boolean(value.invertY),
      graphicsQuality: ["low", "medium", "high"].includes(value.graphicsQuality) ? value.graphicsQuality : "medium",
      showFps: Boolean(value.showFps), showPing: value.showPing !== false,
      colourBlindMode: cleanText(value.colourBlindMode ?? "off", 20),
      reducedMotion: Boolean(value.reducedMotion), screenShake: value.screenShake !== false,
      subtitles: value.subtitles !== false,
      textSize: Math.max(0.8, Math.min(1.5, Number(value.textSize) || 1)),
      keybinds: isPlainObject(value.keybinds) ? value.keybinds : {}
    };
  }

  // `code` comes from allocateRoomCode when a socket asks for a room, so it has
  // already been claimed in the shared directory. Tests and the bot paths call
  // this without one and get local-only uniqueness, which is what a single
  // instance has always had.
  createRoom(mode, settingsInput, code = null) {
    if (!code || this.rooms.has(code)) {
      code = randomRoomCode();
      while (this.rooms.has(code)) code = randomRoomCode();
    }
    const settings = validateSettings({ ...DEFAULT_SETTINGS, ...settingsInput, allowSinglePlayer: mode === "practice" });
    const room = {
      code, mode, settings, mapId: settings.mapId, phase: PHASES.LOBBY, phaseEndsAt: null,
      hostId: null, players: new Map(), practiceRoles: new Map(),
      createdAt: Date.now(), matchStartedAt: null, matchNumber: 0, guardianAngelId: null,
      taskCompleted: 0, taskTotal: 0, incidents: new Map(), evidence: [],
      activeSabotage: null, lastSabotageAt: 0, sabotageClearedAt: 0,
      lastCriticalBroadcastAt: 0, closedDoorIds: new Set(), meeting: null,
      specialWinnerIds: new Set(),
      sealedVents: [], minedVents: [],
      doorLogs: [], maintenanceLogs: [], timers: new Set(), lastSnapshotAt: 0
    };
    this.rooms.set(code, room);
    return room;
  }

  async joinRoom(socket, room, { accessChecked = false } = {}) {
    if (!accessChecked) await this.requireAccountAccess(socket.data.auth.accountId);
    if (room.phase !== PHASES.LOBBY) throw new Error("That match is already in progress.");
    if (room.players.size >= room.settings.maxPlayers) throw new Error("That room is full.");
    this.leaveCurrentRoom(socket, false);
    const duplicate = [...room.players.values()].some((candidate) => candidate.displayName.toLocaleLowerCase() === socket.data.auth.displayName.toLocaleLowerCase());
    if (duplicate) throw new Error("That display name is already present in this room.");

    const mapId = activeMapId(room);
    const map = getMapDefinition(mapId);
    const spawn = map.spawnPoints[room.players.size % map.spawnPoints.length];
    const player = this.makePlayer({
      id: randomUUID(), socketId: socket.id, accountId: socket.data.auth.accountId,
      displayName: socket.data.auth.displayName, guest: socket.data.auth.guest,
      appearance: socket.data.auth.appearance, x: spawn[0], z: spawn[1], mapId
    });
    room.players.set(player.id, player);
    if (!room.hostId) room.hostId = player.id;
    this.syncHost(room);
    this.socketPlayers.set(socket.id, { roomCode: room.code, playerId: player.id });
    socket.join(room.code);
    const token = this.rotateRejoinToken(player);
    const result = { ok: true, room: this.serialiseRoom(room), playerId: player.id, rejoinToken: token };
    this.broadcastRoomState(room);
    return result;
  }

  makePlayer({ id, socketId, accountId = null, displayName, guest = true, appearance, x, z, mapId = DEFAULT_MAP_ID, bot = false }) {
    return {
      id, socketId, accountId, displayName, guest, appearance: validateAppearance(appearance), bot,
      connected: true, ready: bot, isHost: false, alive: true, role: null, faction: null,
      roleState: makeRoleState("operations-crew"),
      position: { x, z }, rotation: 0, currentRoom: roomAt(mapId, x, z)?.id ?? getMapDefinition(mapId).rooms[0].id,
      input: normaliseInput({}), lastInputAt: 0, lastInputSeq: 0,
      lastClientMoveAt: 0, lastClientMoveSeq: -1, lastClientPosition: null,
      lastClientPredictionAt: 0, animation: "idle",
      jumpUntil: 0, activeTask: null, tasks: [], completedTasks: new Set(), vote: null,
      lastEliminationAt: 0, lastMaintenanceAt: 0, emergencyMeetings: 0,
      disconnectedAt: null, cleanupTimer: null, rejoinTokenHash: null,
      previousRejoinTokenHash: null, previousRejoinTokenExpiresAt: 0,
      matchStats: makeStats(), eliminatedAt: null, botTarget: null, botActionAt: 0, repairStationId: null, ventId: null
    };
  }

  rotateRejoinToken(player) {
    const token = randomBytes(32).toString("base64url");
    player.previousRejoinTokenHash = player.rejoinTokenHash;
    player.previousRejoinTokenExpiresAt = player.rejoinTokenHash
      ? Date.now() + REJOIN_PREVIOUS_TOKEN_GRACE_MS
      : 0;
    player.rejoinTokenHash = hashOpaque(token);
    return token;
  }

  async resumeRoom(socket, token) {
    await this.requireAccountAccess(socket.data.auth.accountId);
    if (!token) throw new Error("No saved room session was found.");
    const tokenHash = hashOpaque(token);
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const player = [...room.players.values()].find((candidate) => {
        if (candidate.bot) return false;
        if (candidate.previousRejoinTokenHash && candidate.previousRejoinTokenExpiresAt < now) {
          candidate.previousRejoinTokenHash = null;
          candidate.previousRejoinTokenExpiresAt = 0;
        }
        return candidate.rejoinTokenHash === tokenHash
          || (candidate.previousRejoinTokenHash === tokenHash
            && candidate.previousRejoinTokenExpiresAt >= now);
      });
      if (!player) continue;
      if (player.connected) {
        if (player.socketId !== socket.id) throw new Error("That player is already connected.");
        // The server may have restored this exact socket while its ack was lost.
        // Re-ack the same capability instead of stranding a fresh page with no
        // player id or rotated token. Making the supplied generation current
        // keeps repeated retries idempotent without minting an unbounded chain.
        if (player.rejoinTokenHash !== tokenHash) {
          player.previousRejoinTokenHash = player.rejoinTokenHash;
          player.previousRejoinTokenExpiresAt = now + REJOIN_PREVIOUS_TOKEN_GRACE_MS;
          player.rejoinTokenHash = tokenHash;
        }
        const result = {
          ok: true,
          room: this.serialiseRoom(room),
          playerId: player.id,
          rejoinToken: token,
          restored: this.privatePlayerState(room, player)
        };
        this.sendPrivateState(room, player);
        this.syncHost(room);
        this.broadcastRoomState(room);
        return result;
      }
      if (player.accountId && player.accountId !== socket.data.auth.accountId) throw new Error("Room session does not match this account.");
      if (!player.accountId && player.displayName !== socket.data.auth.displayName) throw new Error("Use the same guest name to reconnect.");
      clearTimeout(player.cleanupTimer);
      player.cleanupTimer = null;
      player.socketId = socket.id;
      player.connected = true;
      player.disconnectedAt = null;
      // A reloaded browser starts its input sequence at one. Retaining the old
      // socket's high sequence makes every packet from the replacement look
      // stale and creates a permanent rubber-band loop until it catches up.
      player.input = normaliseInput({});
      player.lastInputAt = 0;
      player.lastInputSeq = 0;
      resetClientMovementTrail(player);
      this.socketPlayers.set(socket.id, { roomCode: room.code, playerId: player.id });
      socket.join(room.code);
      this.syncHost(room);
      const rejoinToken = this.rotateRejoinToken(player);
      const result = { ok: true, room: this.serialiseRoom(room), playerId: player.id, rejoinToken, restored: this.privatePlayerState(room, player) };
      this.sendPrivateState(room, player);
      this.broadcastRoomState(room);
      return result;
    }
    throw new Error("The reserved room slot has expired.");
  }

  populatePracticeBots(room, targetPlayerCount) {
    const botNames = ["Kepler", "Vega", "Sagan", "Lyra", "Pioneer", "Aster"];
    const mapId = activeMapId(room);
    const map = getMapDefinition(mapId);
    while (room.players.size < Math.min(targetPlayerCount, room.settings.maxPlayers)) {
      const index = room.players.size;
      const spawn = map.spawnPoints[index % map.spawnPoints.length];
      const player = this.makePlayer({
        id: `bot-${randomUUID()}`, socketId: null, displayName: botNames[index - 1] ?? `Drone ${index}`,
        appearance: { colour: ["amber", "violet", "lime", "coral"][index % 4], symbol: ["delta", "nova", "pulse", "vector"][index % 4], number: index + 10 },
        x: spawn[0], z: spawn[1], mapId, bot: true
      });
      room.players.set(player.id, player);
    }
  }

  syncPracticeBots(room) {
    const humans = [...room.players.values()].filter((player) => !player.bot);
    const target = Math.max(humans.length, this.practicePopulationTarget(room));
    // Reverse insertion order keeps the earliest named practice crew stable as
    // parameters grow and shrink. Human players are never removed here.
    const removableBots = [...room.players.values()].filter((player) => player.bot).reverse();
    while (room.players.size > target && removableBots.length) {
      const bot = removableBots.shift();
      clearTimeout(bot.cleanupTimer);
      room.players.delete(bot.id);
      room.practiceRoles.delete(bot.id);
    }
    this.populatePracticeBots(room, target);
  }

  practicePopulationTarget(room) {
    // Practice must not open at immediate Operative parity. With N Operatives,
    // at least 2N+1 total players leave one more non-Operative alive; four is
    // retained as the minimum so a one-Operative simulation still feels active.
    return Math.min(room.settings.maxPlayers, Math.max(4, room.settings.operativeCount * 2 + 1));
  }

  positionPlayersAtMapSpawn(room, mapId = activeMapId(room)) {
    const map = getMapDefinition(mapId);
    let index = 0;
    for (const player of room.players.values()) {
      const spawn = map.spawnPoints[index++ % map.spawnPoints.length];
      player.position = { x: spawn[0], z: spawn[1] };
      player.currentRoom = roomAt(mapId, spawn[0], spawn[1])?.id ?? map.rooms[0].id;
      player.botTarget = null;
      player.botPath = [];
      player.repairStationId = null;
      player.ventId = null;
      player.input = normaliseInput({});
      resetClientMovementTrail(player);
    }
  }

  serialiseRoom(room) {
    return {
      code: room.code, mode: room.mode, phase: room.phase, phaseEndsAt: room.phaseEndsAt,
      hostId: room.hostId, mapId: room.mapId, settings: room.settings, players: [...room.players.values()].map(publicPlayer),
      taskProgress: { completed: room.taskCompleted, total: room.taskTotal },
      activeSabotage: room.activeSabotage ? this.publicSabotage(room.activeSabotage) : null,
      // Runtime vents have to survive event loss and reconnects. The browser
      // uses this public topology to draw mined grilles and stop advertising
      // welded exits; entry and movement remain server-authoritative.
      ventTopology: {
        minedVents: (room.minedVents ?? []).map(({ id, type, refId, roomId, x, z }) => ({ id, type, refId, roomId, x, z })),
        sealedVentIds: [...(room.sealedVents ?? [])]
      },
      incidentCount: room.incidents.size,
      databaseConnected: isDatabaseConfigured()
    };
  }

  privatePlayerState(room, player) {
    return {
      id: player.id, role: player.role, faction: player.faction, alive: player.alive,
      roleState: privateRoleState(player),
      tasks: player.tasks, completedTaskIds: [...player.completedTasks],
      emergencyMeetings: Math.max(0, room.settings.emergencyMeetings - player.emergencyMeetings),
      position: player.position,
      vent: player.ventId ? this.publicVentState(room, player) : null,
      teammates: player.faction === "operative"
        ? [...room.players.values()].filter((candidate) => candidate.faction === "operative" && candidate.id !== player.id).map((candidate) => candidate.id)
        : []
    };
  }

  broadcastRoomState(room) {
    this.io.to(room.code).emit("roomState", this.serialiseRoom(room));
  }

  sendPrivateState(room, player) {
    if (player.socketId) this.io.to(player.socketId).emit("roleAssigned", this.privatePlayerState(room, player));
  }

  syncHost(room) {
    const previousHostId = room.hostId;
    const currentHost = room.players.get(room.hostId);
    if (!currentHost?.connected || currentHost.bot) {
      room.hostId = [...room.players.values()].find((player) => player.connected && !player.bot)?.id
        ?? [...room.players.values()].find((player) => player.connected)?.id ?? null;
    }
    for (const player of room.players.values()) player.isHost = player.id === room.hostId;
    if (previousHostId && previousHostId !== room.hostId) {
      this.io.to(room.code).emit("hostChanged", { previousHostId, hostId: room.hostId });
    }
  }

  leaveCurrentRoom(socket, disconnected) {
    const link = this.socketPlayers.get(socket.id);
    if (!link) return;
    this.socketPlayers.delete(socket.id);
    const room = this.rooms.get(link.roomCode);
    const player = room?.players.get(link.playerId);
    if (!room || !player) return;
    socket.leave(room.code);
    if (disconnected) {
      player.connected = false;
      player.disconnectedAt = Date.now();
      player.input = normaliseInput({});
      player.cleanupTimer = setTimeout(() => this.removePlayer(room, player.id), DISCONNECT_GRACE_MS);
      this.syncHost(room);
      this.broadcastRoomState(room);
      if (room.phase !== PHASES.LOBBY) this.checkWinConditions(room, "disconnect");
    } else {
      this.removePlayer(room, player.id);
    }
  }

  removePlayer(room, playerId) {
    const player = room.players.get(playerId);
    if (!player) return;
    clearTimeout(player.cleanupTimer);
    if (player.socketId) this.socketPlayers.delete(player.socketId);
    room.players.delete(playerId);
    room.practiceRoles.delete(playerId);
    this.syncHost(room);
    if (room.players.size === 0 || [...room.players.values()].every((candidate) => candidate.bot)) {
      this.destroyRoom(room);
      return;
    }
    this.broadcastRoomState(room);
    if (room.phase !== PHASES.LOBBY) this.checkWinConditions(room, "player-left");
  }

  // Claim a code that no instance sharing this database is already using. With
  // no database this degrades to local uniqueness rather than refusing to work.
  async allocateSharedRoomCode() {
    return allocateRoomCode({
      isTakenLocally: (candidate) => this.rooms.has(candidate),
      claim: isDatabaseConfigured()
        ? (candidate) => claimRoomCode(candidate, this.instanceId, this.roomCodeLeaseSeconds)
        : null
    });
  }

  renewRoomCodeLeases() {
    if (!isDatabaseConfigured()) return;
    const codes = [...this.rooms.keys()];
    Promise.all([
      codes.length ? renewRoomCodes(codes, this.instanceId, this.roomCodeLeaseSeconds) : Promise.resolve(0),
      sweepExpiredRoomCodes()
    ]).catch((error) => console.error("Room code lease upkeep failed:", error.message));
  }

  destroyRoom(room) {
    for (const timer of room.timers) clearTimeout(timer);
    for (const player of room.players.values()) clearTimeout(player.cleanupTimer);
    this.rooms.delete(room.code);
    // Hand the code back immediately rather than waiting for the lease to lapse.
    if (isDatabaseConfigured()) {
      releaseRoomCode(room.code, this.instanceId)
        .catch((error) => console.error("Releasing a room code failed:", error.message));
    }
  }

  startMatch(room, { staffTest = false } = {}) {
    if (room.phase !== PHASES.LOBBY) throw new Error("The match has already started.");
    const connectedHumans = [...room.players.values()].filter((player) => player.connected && !player.bot);
    const required = room.mode === "practice" || room.settings.allowSinglePlayer
      || process.env.ALLOW_SINGLE_PLAYER_TESTING === "true" || staffTest ? 1 : MIN_MATCH_PLAYERS;
    if (connectedHumans.length < required) throw new Error(`At least ${required} connected player${required === 1 ? "" : "s"} required.`);
    if (room.mode !== "practice" && connectedHumans.some((player) => !player.ready)) throw new Error("Every connected player must be ready before launch.");
    const participants = [...room.players.values()].filter((player) => player.connected || player.bot).slice(0, MAX_ROOM_PLAYERS);
    if (room.mode === "practice") {
      // Re-evaluate at launch as well as room creation so host settings changed
      // by an older client still cannot produce an immediately lost match.
      this.syncPracticeBots(room);
    } else if (participants.length < 2) {
      this.populatePracticeBots(room, this.practicePopulationTarget(room));
    }
    const activePlayers = [...room.players.values()].filter((player) => player.connected || player.bot);
    const desiredOperatives = Math.min(room.settings.operativeCount, Math.max(1, activePlayers.length - 1));
    const requestedRoleFor = (player) => {
      const roleId = room.practiceRoles.get(player.id);
      return ROLE_DEFINITIONS[roleId] ? roleId : null;
    };
    const requestedFactionFor = (player) => {
      const roleId = requestedRoleFor(player);
      return roleId ? getRoleDefinition(roleId).faction : null;
    };
    const chosenOperatives = new Set(
      activePlayers
        .filter((player) => requestedFactionFor(player) === "operative")
        .slice(0, desiredOperatives)
        .map((player) => player.id)
    );
    for (const candidate of shuffle(activePlayers.filter((player) =>
      !chosenOperatives.has(player.id) && !["crew", "neutral"].includes(requestedFactionFor(player))
    ))) {
      if (chosenOperatives.size >= desiredOperatives) break;
      chosenOperatives.add(candidate.id);
    }
    for (const candidate of shuffle(activePlayers.filter((player) =>
      !chosenOperatives.has(player.id) && requestedFactionFor(player) !== "neutral"
    ))) {
      if (chosenOperatives.size >= desiredOperatives) break;
      chosenOperatives.add(candidate.id);
    }
    const rolePools = {
      crew: shuffle(rolePoolForFaction("crew", room.settings.roleSettings)),
      operative: shuffle(rolePoolForFaction("operative", room.settings.roleSettings)),
      neutral: shuffle(rolePoolForFaction("neutral", room.settings.roleSettings))
    };
    const chosenNeutrals = new Set(
      activePlayers
        .filter((player) => !chosenOperatives.has(player.id) && requestedFactionFor(player) === "neutral")
        .slice(0, Math.max(1, Math.min(2, Math.floor(activePlayers.length / 7))))
        .map((player) => player.id)
    );
    const neutralSlots = room.mode !== "practice"
      ? Math.min(rolePools.neutral.length, 2, Math.floor(activePlayers.length / 7))
      : chosenNeutrals.size;
    for (const neutralCandidate of shuffle(activePlayers.filter((player) =>
      !chosenOperatives.has(player.id) && !chosenNeutrals.has(player.id)
    ))) {
      if (chosenNeutrals.size >= neutralSlots) break;
      chosenNeutrals.add(neutralCandidate.id);
    }
    const rolePoolIndexes = { crew: 0, operative: 0, neutral: 0 };
    const nextRoleForFaction = (faction) => {
      const configuredPool = rolePools[faction] ?? [];
      const pool = configuredPool.length ? configuredPool : roleIdsForFaction(faction);
      const fallback = faction === "operative" ? "signal-operative"
        : faction === "neutral" ? "jester" : "operations-crew";
      const roleId = pool[rolePoolIndexes[faction]] ?? fallback;
      rolePoolIndexes[faction] += 1;
      return roleId;
    };

    room.matchStartedAt = Date.now();
    room.matchNumber += 1;
    room.taskCompleted = 0;
    room.taskTotal = 0;
    room.incidents.clear();
    room.evidence = [];
    room.activeSabotage = null;
    room.closedDoorIds.clear();
    room.lastCriticalBroadcastAt = 0;
    room.meeting = null;
    room.sealedVents = [];
    room.minedVents = [];
    room.specialWinnerIds.clear();
    room.guardianAngelId = null;
    room.lastSabotageAt = Date.now();
    room.sabotageClearedAt = Date.now();
    for (const timer of room.timers) clearTimeout(timer);
    room.timers.clear();

    const map = getMapDefinition(room.mapId);
    let spawnIndex = 0;
    for (const player of activePlayers) {
      const spawn = map.spawnPoints[spawnIndex++ % map.spawnPoints.length];
      player.position = { x: spawn[0], z: spawn[1] };
      resetClientMovementTrail(player);
      player.currentRoom = roomAt(room.mapId, spawn[0], spawn[1])?.id ?? map.rooms[0].id;
      player.rotation = 0;
      player.alive = true;
      player.eliminatedAt = null;
      player.faction = chosenOperatives.has(player.id)
        ? "operative"
        : chosenNeutrals.has(player.id) ? "neutral" : "crew";
      const requestedRole = requestedRoleFor(player);
      player.role = requestedRole && getRoleDefinition(requestedRole).faction === player.faction
        ? requestedRole
        : nextRoleForFaction(player.faction);
      player.roleState = makeRoleState(player.role);
      player.ventId = null;
      player.completedTasks = new Set();
      player.activeTask = null;
      player.vote = null;
      player.matchStats = makeStats();
      // Humans can still use practice actions immediately because their
      // validation bypasses cooldowns, but training Operatives should respect
      // the configured opening delay instead of attacking at the spawn table.
      player.lastEliminationAt = Date.now();
      player.lastMaintenanceAt = 0;
      player.emergencyMeetings = 0;
      player.repairStationId = null;
      player.ventId = null;
      const assignments = shuffle(map.taskDefinitions).slice(0, room.settings.assignmentQuantity).map((task) => ({
        id: task.id, name: task.name, roomId: task.roomId, fake: player.faction !== "crew",
        // Which leg of a multi-room assignment is outstanding; the map marks that
        // one rather than the whole chain.
        site: 0, siteCount: (task.sites ?? []).length || 1
      }));
      player.tasks = assignments;
      if (player.faction === "crew") room.taskTotal += assignments.length;
    }

    // The Executioner needs someone to frame; pick a living crewmate.
    for (const player of activePlayers) {
      if (player.role !== "executioner") continue;
      const marks = activePlayers.filter((candidate) =>
        candidate.id !== player.id && candidate.faction === "crew");
      if (marks.length) player.roleState.executionerTargetId = choose(marks).id;
    }

    this.setPhase(room, PHASES.COUNTDOWN, 3_000);
    this.io.to(room.code).emit("countdown", { endsAt: room.phaseEndsAt });
    this.schedule(room, 3_000, () => {
      this.setPhase(room, PHASES.ROLE_REVEAL, 3_500);
      for (const player of activePlayers) this.sendPrivateState(room, player);
      this.schedule(room, 3_500, () => {
        this.setPhase(room, PHASES.ACTIVE, null);
        this.io.to(room.code).emit("matchStarted", {
          mapId: room.mapId, startedAt: room.matchStartedAt,
          taskProgress: { completed: 0, total: room.taskTotal }
        });
      });
    });
  }

  resetRoomToLobby(room) {
    for (const timer of room.timers) clearTimeout(timer);
    room.timers.clear();
    room.phase = PHASES.LOBBY;
    room.phaseEndsAt = null;
    room.meeting = null;
    room.activeSabotage = null;
    room.closedDoorIds.clear();
    room.lastCriticalBroadcastAt = 0;
    room.sealedVents = [];
    room.minedVents = [];
    room.specialWinnerIds.clear();
    room.guardianAngelId = null;
    room.incidents.clear();
    room.evidence = [];
    room.taskCompleted = 0;
    room.taskTotal = 0;
    const map = getMapDefinition(LOBBY_MAP_ID);
    let spawnIndex = 0;
    for (const player of room.players.values()) {
      const spawn = map.spawnPoints[spawnIndex++ % map.spawnPoints.length];
      player.position = { x: spawn[0], z: spawn[1] };
      resetClientMovementTrail(player);
      player.currentRoom = roomAt(LOBBY_MAP_ID, spawn[0], spawn[1])?.id ?? map.rooms[0].id;
      player.ready = player.bot;
      player.alive = true;
      player.role = null;
      player.faction = null;
      player.roleState = makeRoleState("operations-crew");
      player.tasks = [];
      player.completedTasks = new Set();
      player.activeTask = null;
      player.vote = null;
      player.repairStationId = null;
      player.input = normaliseInput({});
    }
    this.broadcastRoomState(room);
    this.io.to(room.code).emit("matchReset", { room: this.serialiseRoom(room) });
  }

  schedule(room, delayMs, callback) {
    const timer = setTimeout(() => {
      room.timers.delete(timer);
      if (this.rooms.get(room.code) === room) callback();
    }, delayMs);
    room.timers.add(timer);
    return timer;
  }

  setPhase(room, phase, durationMs) {
    room.phase = phase;
    room.phaseEndsAt = durationMs ? Date.now() + durationMs : null;
    this.io.to(room.code).emit("phaseChanged", { phase, endsAt: room.phaseEndsAt });
    this.broadcastRoomState(room);
  }

  beginTask(room, player, payload) {
    if (player.ventId) throw new Error("Climb out of the vent first.");
    if (room.phase !== PHASES.ACTIVE) throw new Error("Assignments are unavailable right now.");
    const map = getMapDefinition(room.mapId);
    const station = stationById(room.mapId, payload?.stationId);
    if (!station || station.type !== "task") throw new Error("Task station not found.");
    const assignment = player.tasks.find((task) => task.id === station.refId);
    if (!assignment) throw new Error("This station is not assigned to you.");
    if (player.completedTasks.has(assignment.id)) throw new Error("That assignment is already complete.");
    if (distance2D(player.position, station) > reachOf(station)) throw new Error("Move closer to the task station.");
    const definition = map.taskDefinitions.find((task) => task.id === assignment.id);
    // A task that spans the ship has to be worked in order. Turning up at the third
    // wiring panel first is refused, and told where to go instead.
    const sites = definition.sites ?? [];
    const wantedSite = assignment.site ?? 0;
    const siteIndex = station.siteIndex ?? 0;
    if (sites.length > 1 && siteIndex !== wantedSite) {
      const next = sites[wantedSite];
      throw new Error(`Not this one yet — continue in ${roomLabel(map, next)}.`);
    }
    const challenge = makeTaskChallenge(definition, wantedSite);
    player.activeTask = {
      taskId: assignment.id, stationId: station.id, siteIndex: wantedSite,
      startedAt: Date.now(), lastActionAt: 0, progress: 0, challenge
    };
    const result = {
      ok: true,
      task: {
        ...assignment, kind: definition.kind, steps: definition.steps,
        site: wantedSite, siteCount: sites.length,
        siteLabel: roomLabel(map, sites[wantedSite])
      },
      challenge
    };
    if (player.socketId) this.io.to(player.socketId).emit("taskStarted", result);
    return result;
  }

  taskAction(room, player, payload) {
    const active = player.activeTask;
    if (!active || active.taskId !== payload?.taskId) throw new Error("No matching task is active.");
    const map = getMapDefinition(room.mapId);
    const station = stationById(room.mapId, active.stationId);
    if (room.phase !== PHASES.ACTIVE || !station || distance2D(player.position, station) > reachOf(station) + 0.7) {
      player.activeTask = null;
      throw new Error("Task cancelled because the station is no longer reachable.");
    }
    const now = Date.now();
    if (now - active.lastActionAt < 250) throw new Error("Input arrived too quickly.");
    active.lastActionAt = now;
    // The minigames are drags, holds and timed clicks, so the server cannot judge
    // the gesture itself. What it does hold is the shape of the work: steps are
    // claimed one at a time and in order, a step out of sequence is refused, and
    // the rate limit still floors how fast a task can possibly be finished.
    const definition = map.taskDefinitions.find((task) => task.id === active.taskId);
    const claimed = Math.round(Number(payload?.step));
    if (!Number.isFinite(claimed) || claimed !== active.progress) {
      throw new Error("Task step out of sequence.");
    }
    active.progress += 1;

    if (active.progress >= definition.steps) {
      const sites = definition.sites ?? [];
      const assignment = player.tasks.find((task) => task.id === active.taskId);
      // Another leg to walk before the whole assignment is done.
      if (sites.length > 1 && (active.siteIndex + 1) < sites.length) {
        assignment.site = active.siteIndex + 1;
        player.activeTask = null;
        const next = sites[assignment.site];
        const result = {
          ok: true, siteComplete: true, taskId: active.taskId,
          site: assignment.site, siteCount: sites.length,
          nextLabel: roomLabel(map, next)
        };
        if (player.socketId) this.io.to(player.socketId).emit("taskSiteAdvanced", result);
        this.sendPrivateState(room, player);
        return result;
      }
      return this.completeTaskInternal(room, player, active.taskId);
    }
    const result = { ok: true, correct: true, progress: active.progress, total: definition.steps };
    if (player.socketId) this.io.to(player.socketId).emit("taskProgress", result);
    return result;
  }

  completeTaskInternal(room, player, taskId) {
    const assignment = player.tasks.find((task) => task.id === taskId);
    if (!assignment || player.completedTasks.has(taskId)) return { ok: true, completed: true };
    player.completedTasks.add(taskId);
    player.activeTask = null;
    player.matchStats.tasksCompleted += 1;
    if (!assignment.fake) room.taskCompleted += 1;
    const result = {
      ok: true, completed: true, taskId, fake: assignment.fake,
      sharedProgress: { completed: room.taskCompleted, total: room.taskTotal }
    };
    if (player.socketId) this.io.to(player.socketId).emit("taskCompleted", result);
    if (!assignment.fake) this.io.to(room.code).emit("taskProgress", result.sharedProgress);
    this.checkWinConditions(room, "task-complete");
    return result;
  }

  startSabotage(room, player, sabotageId, doorTargetId = null) {
    if (room.phase !== PHASES.ACTIVE || player.faction !== "operative") throw new Error("Your role cannot activate sabotage now.");
    const map = getMapDefinition(room.mapId);
    const definition = map.sabotageDefinitions.find((item) => item.id === sabotageId);
    if (!definition) throw new Error("Unknown sabotage system.");
    if (room.activeSabotage) throw new Error("Another sabotage is already active.");
    if (room.mode !== "practice" && Date.now() - room.lastSabotageAt < room.settings.sabotageCooldownSeconds * 1000) throw new Error("Sabotage is still recharging.");
    let doorTarget = null;
    if (definition.repairKind === "doors") {
      const selectedId = doorTargetId || (player.bot ? choose(definition.doorTargets ?? [])?.id : null);
      const allowed = definition.doorTargets?.some(({ id }) => id === selectedId);
      doorTarget = allowed ? map.doorGroups.find(({ id }) => id === selectedId) : null;
      if (!doorTarget) throw new Error("Choose a room to lock down.");
      room.closedDoorIds = new Set(doorTarget.doors.map(({ id }) => id));
    } else {
      room.closedDoorIds.clear();
    }
    room.lastSabotageAt = Date.now();
    room.lastCriticalBroadcastAt = room.lastSabotageAt;
    room.activeSabotage = {
      id: definition.id, name: definition.name, critical: definition.critical,
      startedAt: Date.now(), endsAt: Date.now() + definition.durationMs,
      repairStations: definition.repairStations, repairs: new Set(), activatedBy: player.id,
      blindsPlayers: Boolean(definition.blindsPlayers),
      jamsTelemetry: Boolean(definition.jamsTelemetry),
      doorTargetId: doorTarget?.id ?? null,
      doorTargetName: doorTarget?.name ?? null,
      closedDoorIds: [...room.closedDoorIds],
      // The shared puzzle for this outage: the breaker positions, the O2 code, the
      // dial's carrier, or the pair of scanners. Rolled once, so everyone working
      // on it is working on the same one.
      panel: makeRepairPanel(definition)
    };
    player.matchStats.sabotagesStarted += 1;
    this.io.to(room.code).emit("sabotageStarted", this.publicSabotage(room.activeSabotage));
    this.broadcastRoomState(room);
    return { ok: true, sabotage: this.publicSabotage(room.activeSabotage) };
  }

  // True while a lights sabotage is blinding the deck.
  lightsAreOut(room) {
    return Boolean(room.activeSabotage?.blindsPlayers);
  }

  // How far a player can see right now, in world units. The host's crew/operative
  // visibility settings scale it, so existing room settings still mean something.
  // Where the Tracker's mark currently is, while the track is still running. Returns
  // null for everyone else, for an expired track, and once the target is dead - a
  // body does not walk, so the trail simply stops.
  trackedTargetFor(room, player, now = Date.now()) {
    const targetId = player.roleState?.trackedTargetId;
    if (!targetId || (player.roleState?.activeUntil ?? 0) <= now) return null;
    const target = room.players.get(String(targetId));
    if (!target?.alive) return null;
    return {
      id: target.id,
      displayName: target.displayName,
      x: Number(target.position.x.toFixed(2)),
      z: Number(target.position.z.toFixed(2)),
      endsAt: player.roleState.activeUntil
    };
  }

  visionRadiusFor(room, player) {
    // Being flashed or hypnotised collapses sight harder than any sabotage.
    if ((player.roleState?.blindedUntil ?? 0) > Date.now()) return VISION.blindedRadius;
    // The Aurial reads distortion instead of light, so darkness costs it less.
    if (player.role === "aurial") return VISION.crewRadius * 0.9;
    const dark = this.lightsAreOut(room);
    const operative = player.faction === "operative";
    const base = operative
      ? (dark ? VISION.lightsOutOperativeRadius : VISION.operativeRadius)
      : (dark ? VISION.lightsOutCrewRadius : VISION.crewRadius);
    const scale = operative ? room.settings.operativeVisibility : room.settings.crewVisibility;
    return base * (Number(scale) || 1);
  }

  // Dead players spectate the whole deck, and meetings reveal everyone.
  seesEverything(room, player) {
    return !player.alive || room.phase !== PHASES.ACTIVE;
  }

  // Bot pacing measures from the moment the deck was last clear, so a repaired or
  // expired sabotage starts the next cooldown instead of chaining immediately.
  clearActiveSabotage(room) {
    room.activeSabotage = null;
    room.closedDoorIds.clear();
    room.lastCriticalBroadcastAt = 0;
    room.sabotageClearedAt = Date.now();
    for (const player of room.players.values()) {
      if (player.bot) player.repairStationId = null;
    }
  }

  // Earliest wall-clock time a bot may trigger the next sabotage. Human requests are
  // unchanged: they still go through startSabotage's own authoritative checks.
  botSabotageReadyAt(room) {
    const settingsCooldownMs = room.settings.sabotageCooldownSeconds * 1000;
    const lastClear = Math.max(room.lastSabotageAt ?? 0, room.sabotageClearedAt ?? 0);
    if (room.mode !== "practice") return lastClear + settingsCooldownMs + BOT_SABOTAGE.onlineGapMs;
    return Math.max(
      (room.matchStartedAt ?? 0) + BOT_SABOTAGE.practiceGraceMs,
      lastClear + Math.max(settingsCooldownMs, BOT_SABOTAGE.cooldownMs)
    );
  }

  publicSabotage(sabotage) {
    return {
      id: sabotage.id, name: sabotage.name, critical: sabotage.critical,
      startedAt: sabotage.startedAt, endsAt: sabotage.endsAt,
      repairedStations: [...sabotage.repairs], requiredRepairs: sabotage.repairStations.length,
      blindsPlayers: sabotage.blindsPlayers,
      jamsTelemetry: sabotage.jamsTelemetry,
      doorTargetId: sabotage.doorTargetId,
      doorTargetName: sabotage.doorTargetName,
      closedDoorIds: [...(sabotage.closedDoorIds ?? [])]
    };
  }

  // Standing at a repair station no longer fixes the outage by itself: it opens
  // that sabotage's panel. The work happens in repairAction.
  repairSabotage(room, player, stationId) {
    const { sabotage, station } = this.repairContext(room, player, stationId);
    return {
      ok: true,
      sabotage: this.publicSabotage(sabotage),
      stationId: station.id,
      stationLabel: station.label ?? roomLabel(getMapDefinition(room.mapId), station),
      // Opening a nearby keypad is the act of reading its sticky note. Room-wide
      // panel updates deliberately omit this code.
      panel: publicRepairPanel(sabotage, { includeKeypadCode: true })
    };
  }

  repairContext(room, player, stationId) {
    if (room.phase !== PHASES.ACTIVE || !player.alive || !room.activeSabotage) throw new Error("No sabotage can be repaired now.");
    const station = stationById(room.mapId, stationId);
    const sabotage = room.activeSabotage;
    if (!station || station.type !== "repair" || station.refId !== sabotage.id || !sabotage.repairStations.includes(station.id)) throw new Error("Use the correct repair station.");
    if (distance2D(player.position, station) > reachOf(station)) throw new Error("Move closer to the repair station.");
    return { sabotage, station };
  }

  // One interaction with an open panel. Returns the panel as it now stands, so
  // every player working the same outage sees the same thing.
  repairAction(room, player, payload = {}) {
    const { sabotage, station } = this.repairContext(room, player, payload.stationId);
    const panel = sabotage.panel ?? {};
    const now = Date.now();
    let solved = false;

    switch (panel.kind) {
      case "switches": {
        // Shared breakers: a toggle is a toggle, and an Operative may throw one
        // back down to slow the repair, exactly as they can in the real panel.
        const index = Math.round(Number(payload.value));
        if (!Number.isInteger(index) || index < 0 || index >= panel.switches.length) {
          throw new Error("That breaker does not exist.");
        }
        panel.switches[index] = !panel.switches[index];
        solved = panel.switches.every(Boolean);
        break;
      }
      case "keypad": {
        // Each keypad is signed off separately, both with the same code.
        if (String(payload.value ?? "") !== panel.code) {
          return {
            ok: true,
            solved: false,
            rejected: true,
            panel: publicRepairPanel(sabotage, { includeKeypadCode: true })
          };
        }
        sabotage.repairs.add(station.id);
        solved = sabotage.repairStations.every((id) => sabotage.repairs.has(id));
        break;
      }
      case "radio": {
        const dial = Number(payload.value);
        if (!Number.isFinite(dial) || dial < 0 || dial > 1) throw new Error("Dial is out of range.");
        if (Math.abs(dial - panel.target) > panel.tolerance) {
          return {
            ok: true,
            solved: false,
            rejected: true,
            panel: publicRepairPanel(sabotage, { includeKeypadCode: true })
          };
        }
        sabotage.repairs.add(station.id);
        solved = sabotage.repairStations.every((id) => sabotage.repairs.has(id));
        break;
      }
      case "handprint": {
        // A hold only counts for a moment, so both scanners have to be held at
        // once - which means two people.
        if (payload.value === "release") delete panel.holds[station.id];
        else panel.holds[station.id] = now + 900;
        solved = sabotage.repairStations.every((id) => (panel.holds[id] ?? 0) > now);
        break;
      }
      default:
        throw new Error("This panel has no repair procedure.");
    }

    if (solved) {
      player.matchStats.sabotagesRepaired += 1;
      const ended = this.publicSabotage(sabotage);
      this.clearActiveSabotage(room);
      this.io.to(room.code).emit("sabotageEnded", { ...ended, repairedBy: player.id });
      this.broadcastRoomState(room);
      return { ok: true, solved: true, panel: null };
    }
    const sharedView = publicRepairPanel(sabotage);
    const privateView = publicRepairPanel(sabotage, { includeKeypadCode: true });
    this.io.to(room.code).emit("sabotagePanel", { sabotageId: sabotage.id, panel: sharedView });
    this.io.to(room.code).emit("sabotageUpdated", this.publicSabotage(sabotage));
    return { ok: true, solved: false, panel: privateView };
  }

  roleTarget(room, player, targetId) {
    const target = room.players.get(String(targetId ?? ""));
    if (!target || !target.alive || target.id === player.id) throw new Error("No valid role target is in range.");
    if (distance2D(player.position, target.position) > ROLE_TARGET_RANGE) throw new Error("Move closer to your target.");
    return target;
  }

  beginRoleAction(room, player) {
    const definition = getRoleDefinition(player.role);
    // Most abilities need the ship live and their owner breathing. Roles that act
    // across the meeting table (Vigilante) or from the grave (Guardian Angel) say so.
    const phaseAllows = room.phase === PHASES.ACTIVE
      || (definition.capabilities.actsInMeeting && MEETING_PHASES.includes(room.phase));
    if (!phaseAllows) throw new Error("Your role ability is unavailable.");
    if (!player.alive && !definition.capabilities.actsWhileDead) {
      throw new Error("Your role ability is unavailable.");
    }
    if (!definition.ability) throw new Error("Your current role has no active ability.");
    const state = player.roleState ?? makeRoleState(player.role);
    const now = Date.now();
    if (state.cooldownEndsAt > now) {
      throw new Error(`Ability recharging for ${Math.ceil((state.cooldownEndsAt - now) / 1000)}s.`);
    }
    if (state.usesLeft !== null && state.usesLeft <= 0) throw new Error("Your role ability has no uses remaining.");
    player.roleState = state;
    return { definition, state, now };
  }

  finishRoleAction(room, player, definition, state, now) {
    if (room.mode !== "practice" && state.usesLeft !== null) state.usesLeft = Math.max(0, state.usesLeft - 1);
    state.cooldownEndsAt = now + (room.mode === "practice" ? 1_000 : definition.ability.cooldownMs);
    this.sendPrivateState(room, player);
    return this.privatePlayerState(room, player);
  }

  roleAction(room, player, payload = {}) {
    if (player.ventId) throw new Error("Climb out of the vent first.");
    if ((player.roleState?.cuffedUntil ?? 0) > Date.now()) throw new Error("You are cuffed and cannot act.");
    return performRoleAbility(this, room, player, payload);
  }

  // Helpers the role engine is allowed to call.
  roomIdAt(room, position) {
    return roomAt(activeMapId(room), position.x, position.z)?.id ?? null;
  }

  mapFor(room) {
    return getMapDefinition(activeMapId(room));
  }

  freshRoleState(roleId) {
    return makeRoleState(roleId);
  }

  consumeProtection(room, target) {
    const now = Date.now();
    if (target.roleState?.protectedUntil > now) {
      target.roleState.protectedUntil = 0;
      if (target.role === "survivor") target.roleState.activeUntil = 0;
      this.sendPrivateState(room, target);
      return { type: target.role === "survivor" ? "vest" : "guardian-shield", ownerId: target.id };
    }
    const medic = [...room.players.values()].find((candidate) =>
      candidate.alive && candidate.role === "medic" && candidate.roleState?.shieldTargetId === target.id
    );
    if (medic) {
      medic.roleState.shieldTargetId = null;
      this.sendPrivateState(room, medic);
      return { type: "medic-shield", ownerId: medic.id };
    }
    return null;
  }

  eliminationAttempt(room, attacker, targetId) {
    if (room.phase !== PHASES.ACTIVE || !attacker.alive || attacker.faction !== "operative") throw new Error("Elimination is unavailable.");
    const target = room.players.get(String(targetId));
    if (!target || !target.alive || target.faction === "operative" || target.id === attacker.id) throw new Error("Invalid elimination target.");
    if (attacker.ventId) throw new Error("Climb out of the vent first.");
    if ((attacker.roleState?.cuffedUntil ?? 0) > Date.now()) throw new Error("You are cuffed and cannot act.");
    if (target.ventId) throw new Error("That target is inside the vents.");
    if (room.mode !== "practice" && Date.now() - attacker.lastEliminationAt < room.settings.eliminationCooldownSeconds * 1000) throw new Error("Elimination is recharging.");
    if (distance2D(attacker.position, target.position) > room.settings.eliminationRange) throw new Error("Target is out of range.");
    return this.eliminateInternal(room, attacker, target, "electromagnetic suit shutdown");
  }

  // Some roles punish being touched: an alerted Veteran or a rampaging Werewolf
  // turns an incoming elimination back on the attacker.
  retaliationFor(target, now = Date.now()) {
    const state = target.roleState ?? {};
    if (target.role === "veteran" && (state.alertUntil ?? 0) > now) return "veteran alert";
    if (target.role === "werewolf" && (state.rampageUntil ?? 0) > now) return "werewolf rampage";
    return null;
  }

  eliminateInternal(room, attacker, target, category, options = {}) {
    if (!attacker.alive || !target.alive) return { ok: false };
    if (!options.ignoreFaction && (attacker.faction !== "operative" || target.faction === "operative")) return { ok: false };
    const retaliation = this.retaliationFor(target);
    if (retaliation && attacker.id !== target.id && !options.ignoreRetaliation) {
      // The attacker dies instead; the defender is untouched.
      return this.eliminateInternal(room, target, attacker, retaliation, {
        ignoreFaction: true, ignoreProtection: true, ignoreRetaliation: true
      });
    }
    if (!options.ignoreProtection) {
      const protection = this.consumeProtection(room, target);
      if (protection) {
        attacker.lastEliminationAt = Date.now();
        this.io.to(room.code).emit("shieldBlocked", {
          playerId: target.id,
          attackerId: attacker.id,
          protection: protection.type
        });
        return { ok: true, blocked: true };
      }
    }
    target.alive = false;
    target.eliminatedAt = Date.now();
    target.input = normaliseInput({});
    attacker.lastEliminationAt = Date.now();
    if (attacker.id !== target.id) attacker.matchStats.eliminations += 1;
    const incident = {
      id: randomUUID(), victimId: target.id, victimName: target.displayName,
      x: target.position.x, z: target.position.z, roomId: target.currentRoom,
      createdAt: Date.now(), category, reported: false,
      evidence: [
        { type: "energy-residue", detail: "A short-range electromagnetic discharge was detected." },
        { type: "time-window", detail: "Suit telemetry failed within the last minute." }
      ]
    };
    room.incidents.set(incident.id, incident);
    this.maybeAssignGuardianAngel(room, target);
    this.io.to(room.code).emit("playerEliminated", {
      playerId: target.id, incident: { id: incident.id, x: incident.x, z: incident.z, roomId: incident.roomId },
      effect: "suit-shutdown"
    });
    this.io.to(room.code).emit("incidentCreated", { id: incident.id, x: incident.x, z: incident.z, roomId: incident.roomId });
    this.sendPrivateState(room, target);
    fireHook(this, room, "onEliminated", { victim: target, attacker });
    this.checkWinConditions(room, "elimination");
    return { ok: true, incidentId: incident.id };
  }

  // The first fallen crew member returns as the Guardian Angel: a ghost who can
  // shield the living. Operative and neutral deaths never claim the role.
  maybeAssignGuardianAngel(room, player) {
    if (room.guardianAngelId || player.bot || player.faction !== "crew") return;
    room.guardianAngelId = player.id;
    player.role = "guardian-angel";
    player.roleState = makeRoleState("guardian-angel");
  }

  reportIncident(room, reporter, incidentId) {
    if (reporter.ventId) throw new Error("Climb out of the vent first.");
    if (room.phase !== PHASES.ACTIVE || !reporter.alive) throw new Error("You cannot report right now.");
    const incident = incidentId ? room.incidents.get(String(incidentId)) : [...room.incidents.values()].find((item) => !item.reported && distance2D(reporter.position, item) <= INTERACTION_RANGE);
    if (!incident || incident.reported) throw new Error("No unreported incident is in range.");
    if (distance2D(reporter.position, incident) > INTERACTION_RANGE) throw new Error("Move closer to the incident.");
    this.requireMeetingAvailable(room);
    incident.reported = true;
    reporter.matchStats.incidentsReported += 1;
    reporter.matchStats.evidenceFound += incident.evidence.length;
    return this.startMeeting(room, reporter, incident);
  }

  callMeeting(room, reporter) {
    if (reporter.ventId) throw new Error("Climb out of the vent first.");
    if (room.phase !== PHASES.ACTIVE || !reporter.alive) throw new Error("Emergency meeting is unavailable.");
    const station = stationById(room.mapId, "meeting-console");
    if (!station || distance2D(reporter.position, station) > reachOf(station)) throw new Error("Move to the emergency meeting button.");
    if (room.mode !== "practice" && reporter.emergencyMeetings >= room.settings.emergencyMeetings) throw new Error("You have no emergency calls remaining.");
    this.requireMeetingAvailable(room);
    reporter.emergencyMeetings += 1;
    return this.startMeeting(room, reporter, null);
  }

  startMeeting(room, reporter, incident) {
    this.requireMeetingAvailable(room);
    if (room.activeSabotage) {
      const ended = this.publicSabotage(room.activeSabotage);
      this.clearActiveSabotage(room);
      this.io.to(room.code).emit("sabotageEnded", { ...ended, cancelledByMeeting: true });
    }
    for (const player of room.players.values()) {
      player.input = normaliseInput({});
      player.ventId = null;
      player.vote = null;
      // Blackmail covers the meeting it was cast before, then lapses.
      if (player.roleState?.blackmailedId) player.roleState.pendingBlackmailClear = true;
      player.activeTask = null;
      if (player.roleState) {
        player.roleState.activeUntil = 0;
        player.roleState.protectedUntil = 0;
        player.roleState.morphTargetId = null;
      }
      this.sendPrivateState(room, player);
    }
    room.meeting = {
      id: randomUUID(), reporterId: reporter.id, incidentId: incident?.id ?? null,
      incidentRoom: incident?.roomId ?? null,
      evidence: room.settings.evidenceEnabled ? incident?.evidence ?? [] : [], votes: new Map()
    };
    this.setPhase(room, PHASES.INCIDENT, 2_500);
    this.io.to(room.code).emit("meetingStarted", {
      meetingId: room.meeting.id, reporterId: reporter.id,
      incidentRoom: room.meeting.incidentRoom, evidence: room.meeting.evidence
    });
    this.schedule(room, 2_500, () => this.startDiscussion(room));
    return { ok: true, meetingId: room.meeting.id };
  }

  requireMeetingAvailable(room) {
    if (room.activeSabotage?.critical) {
      throw new Error("Resolve the critical sabotage before calling a meeting.");
    }
  }

  startDiscussion(room) {
    if (!room.meeting) return;
    this.setPhase(room, PHASES.DISCUSSION, room.settings.discussionSeconds * 1000);
    this.io.to(room.code).emit("discussionStarted", { endsAt: room.phaseEndsAt });
    this.schedule(room, room.settings.discussionSeconds * 1000, () => this.startVoting(room));
  }

  startVoting(room) {
    if (!room.meeting) return;
    this.setPhase(room, PHASES.VOTING, room.settings.votingSeconds * 1000);
    for (const player of room.players.values()) player.vote = null;
    this.io.to(room.code).emit("votingStarted", { endsAt: room.phaseEndsAt });
    for (const bot of [...room.players.values()].filter((player) => player.bot && player.alive)) {
      this.schedule(room, 1_500 + Math.random() * 3_000, () => {
        if (room.phase !== PHASES.VOTING || !bot.alive) return;
        const choices = ["skip", ...[...room.players.values()].filter((player) => player.alive && player.id !== bot.id).map((player) => player.id)];
        bot.vote = choices[Math.floor(Math.random() * choices.length)];
        this.maybeFinishVoting(room);
      });
    }
    this.schedule(room, room.settings.votingSeconds * 1000, () => this.finishVoting(room));
  }

  submitVote(room, voter, targetId) {
    if (room.phase !== PHASES.VOTING || !room.meeting || !voter.alive) throw new Error("You cannot vote right now.");
    const choice = String(targetId ?? "skip");
    if (choice !== "skip") {
      const target = room.players.get(choice);
      if (!target || !target.alive) throw new Error("That player is not eligible.");
    }
    voter.vote = choice;
    room.meeting.votes.set(voter.id, choice);
    this.io.to(room.code).emit("voteUpdated", { voterId: voter.id });
    this.broadcastRoomState(room);
    this.maybeFinishVoting(room);
    return { ok: true, choice };
  }

  maybeFinishVoting(room) {
    const living = [...room.players.values()].filter((player) => player.alive && (player.connected || player.bot));
    if (living.length > 0 && living.every((player) => player.vote)) this.finishVoting(room);
  }

  finishVoting(room) {
    if (room.phase !== PHASES.VOTING || !room.meeting) return;
    // The Swapper exchanges two players' received votes before anything is counted.
    const swapper = [...room.players.values()].find((candidate) =>
      candidate.role === "swapper" && candidate.alive
      && candidate.roleState?.swapFirstId && candidate.roleState?.swapSecondId);
    if (swapper) {
      const { swapFirstId, swapSecondId } = swapper.roleState;
      for (const voter of room.players.values()) {
        if (voter.vote === swapFirstId) voter.vote = swapSecondId;
        else if (voter.vote === swapSecondId) voter.vote = swapFirstId;
      }
      this.io.to(room.code).emit("votesSwapped", { by: swapper.id });
      swapper.roleState.swapFirstId = null;
      swapper.roleState.swapSecondId = null;
    }

    const totals = new Map();
    for (const player of room.players.values()) {
      if (!player.alive || !player.vote) continue;
      // Roles may carry extra weight; the Mayor's vote counts twice.
      const weight = Math.max(1, Number(player.roleState?.voteWeight) || 1);
      totals.set(player.vote, (totals.get(player.vote) ?? 0) + weight);
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const tie = ranked.length > 1 && ranked[0][1] === ranked[1][1];
    const removedId = !tie && ranked[0]?.[0] !== "skip" ? ranked[0]?.[0] : null;
    const removed = removedId ? room.players.get(removedId) : null;
    const soloWin = checkSoloWin(room, { votedOutId: removedId });
    if (removed) {
      removed.alive = false;
      removed.eliminatedAt = Date.now();
      removed.input = normaliseInput({});
      if (!soloWin) this.maybeAssignGuardianAngel(room, removed);
      this.sendPrivateState(room, removed);
    }
    for (const voter of room.players.values()) {
      if (!voter.alive && voter.id !== removedId) continue;
      const voted = room.players.get(voter.vote);
      if (!voted) continue;
      if (voted.faction === "operative") voter.matchStats.correctVotes += 1;
      else voter.matchStats.incorrectVotes += 1;
    }
    const publicVotes = room.settings.anonymousVoting
      ? [...totals.entries()].map(([targetId, count]) => ({ targetId, count }))
      : [...room.players.values()].filter((player) => player.vote).map((player) => ({ voterId: player.id, targetId: player.vote }));
    this.setPhase(room, PHASES.REMOVAL, 4_000);
    this.io.to(room.code).emit("voteResult", {
      removedId: removed?.id ?? null,
      removedName: removed?.displayName ?? null,
      faction: removed && room.settings.factionReveal ? removed.faction : null,
      tie, votes: publicVotes
    });
    this.schedule(room, 4_000, () => {
      if (soloWin) {
        room.specialWinnerIds = new Set(soloWin.winnerIds);
        this.endMatch(room, soloWin.winner, soloWin.reason);
        return;
      }
      if (!this.checkWinConditions(room, "vote")) {
        room.meeting = null;
        for (const player of room.players.values()) {
          player.vote = null;
          if (player.roleState?.pendingBlackmailClear) {
            player.roleState.blackmailedId = null;
            player.roleState.pendingBlackmailClear = false;
          }
        }
        this.setPhase(room, PHASES.ACTIVE, null);
        this.io.to(room.code).emit("matchResumed", { at: Date.now() });
      }
    });
  }

  // Vents are a connected network, as in the reference: an operative climbs in,
  // travels between any vents sharing that network, and climbs back out. While
  // inside they are hidden from everyone and cannot be seen, killed or reported.
  ventById(room, stationId, mapId = activeMapId(room)) {
    return stationById(mapId, stationId)
      ?? (room.minedVents ?? []).find((vent) => vent.id === stationId)
      ?? null;
  }

  ventsInNetwork(mapId, networkId, room = null) {
    const authored = getMapDefinition(mapId).stations
      .filter((station) => station.type === "maintenance" && station.refId === networkId);
    const mined = (room?.minedVents ?? []).filter((vent) => vent.refId === networkId);
    const sealed = new Set(room?.sealedVents ?? []);
    return [...authored, ...mined].filter((vent) => !sealed.has(vent.id));
  }

  publicVentState(room, player) {
    if (!player.ventId) return { inVent: false, ventId: null, exits: [] };
    const mapId = activeMapId(room);
    const vent = this.ventById(room, player.ventId, mapId);
    const reachable = this.ventsInNetwork(mapId, vent?.refId, room)
      .filter((station) => station.id !== player.ventId);
    const keys = vent ? assignVentKeys(vent, reachable) : new Map();
    const ventExits = reachable.map((station) => ({
      id: station.id,
      roomId: station.roomId,
      // The key that reaches this exit, unique within the loop.
      direction: keys.get(station.id) ?? null,
      label: station.label ?? null,
      x: station.x,
      z: station.z
    }));
    return {
      inVent: true,
      ventId: player.ventId,
      exits: ventExits
    };
  }

  enterVent(room, player, stationId) {
    // Operatives ride the vents by faction; a Crew role may earn it by declaring
    // canVent (the Engineer does).
    const mayVent = player.faction === "operative"
      || getRoleDefinition(player.role).capabilities.canVent;
    if (room.phase !== PHASES.ACTIVE || !player.alive || !mayVent) {
      throw new Error("Your role cannot use the vent network.");
    }
    if (player.ventId) throw new Error("You are already inside the vents.");
    const vent = this.ventById(room, stationId, room.mapId);
    if (!vent || vent.type !== "maintenance") throw new Error("Vent not found.");
    if ((room.sealedVents ?? []).includes(vent.id)) throw new Error("That vent has been welded shut.");
    // Never let a player into a vent they could not climb back out of.
    if (!isWalkable(room.mapId, vent.x, vent.z, 0.55)) throw new Error("That vent is blocked.");
    if (distance2D(player.position, vent) > INTERACTION_RANGE) throw new Error("Move closer to the vent.");
    player.ventId = vent.id;
    player.position = { x: vent.x, z: vent.z };
    resetClientMovementTrail(player);
    player.currentRoom = vent.roomId;
    player.input = normaliseInput({});
    room.maintenanceLogs.push({ roomId: vent.roomId, at: Date.now() });
    room.maintenanceLogs = room.maintenanceLogs.slice(-20);
    this.sendPrivateState(room, player);
    return { ok: true, vent: this.publicVentState(room, player) };
  }

  moveVent(room, player, stationId) {
    if (room.phase !== PHASES.ACTIVE || !player.alive || !player.ventId) {
      throw new Error("You are not inside the vents.");
    }
    const from = this.ventById(room, player.ventId, room.mapId);
    const to = this.ventById(room, stationId, room.mapId);
    if (!to || to.type !== "maintenance") throw new Error("Vent not found.");
    if (!from || to.refId !== from.refId) throw new Error("That vent is on a different network.");
    if ((room.sealedVents ?? []).includes(to.id)) throw new Error("That vent has been welded shut.");
    if (to.id === from.id) throw new Error("You are already at that vent.");
    player.ventId = to.id;
    player.position = { x: to.x, z: to.z };
    resetClientMovementTrail(player);
    player.currentRoom = to.roomId;
    room.maintenanceLogs.push({ roomId: to.roomId, at: Date.now() });
    room.maintenanceLogs = room.maintenanceLogs.slice(-20);
    this.sendPrivateState(room, player);
    return { ok: true, vent: this.publicVentState(room, player) };
  }

  exitVent(room, player) {
    if (room.phase !== PHASES.ACTIVE || !player.alive) {
      throw new Error("You cannot exit the vents right now.");
    }
    if (!player.ventId) throw new Error("You are not inside the vents.");
    const vent = this.ventById(room, player.ventId, room.mapId);
    if (!vent || vent.type !== "maintenance") throw new Error("Vent not found.");
    // Climbing out on top of someone would be a free reveal; make them wait.
    const blocked = [...room.players.values()].some((candidate) =>
      candidate.id !== player.id && candidate.alive && !candidate.ventId
      && distance2D(candidate.position, vent) < 1.4);
    if (blocked) throw new Error("Someone is standing on the hatch.");
    player.ventId = null;
    player.lastMaintenanceAt = Date.now();
    this.sendPrivateState(room, player);
    this.io.to(room.code).emit("ventExited", { playerId: player.id, roomId: vent?.roomId ?? null });
    return { ok: true, position: player.position };
  }

  // Admin table: live head count per room, as in the reference. It never names
  // anyone - it is a count, which is exactly what makes it useful but deniable.
  requestAdmin(room, player) {
    if (room.phase !== PHASES.ACTIVE || !player.alive) throw new Error("Admin systems are unavailable.");
    if (player.ventId) throw new Error("Climb out of the vent first.");
    const console_ = getMapDefinition(room.mapId).stations.find((station) => station.type === "admin");
    if (!console_ || distance2D(player.position, console_) > reachOf(console_)) {
      throw new Error("Move to the admin table.");
    }
    if (this.lightsAreOut(room)) throw new Error("The admin table is dark.");
    const counts = new Map();
    for (const candidate of room.players.values()) {
      if (!candidate.alive || candidate.ventId) continue;
      counts.set(candidate.currentRoom, (counts.get(candidate.currentRoom) ?? 0) + 1);
    }
    return {
      ok: true,
      rooms: getMapDefinition(room.mapId).rooms.map((item) => ({
        id: item.id, name: item.name, count: counts.get(item.id) ?? 0
      }))
    };
  }

  requestSecurity(room, player) {
    if (room.phase !== PHASES.ACTIVE || !player.alive) throw new Error("Security systems are unavailable.");
    const consoles = getMapDefinition(room.mapId).stations.filter((station) => ["security", "doorLogs"].includes(station.type));
    if (!consoles.some((station) => distance2D(player.position, station) <= reachOf(station))) throw new Error("Move to a security console.");
    if (room.activeSabotage?.jamsTelemetry) throw new Error("Security telemetry is being jammed.");
    if (player.ventId) throw new Error("Climb out of the vent first.");
    return {
      ok: true,
      // Live feed, as in the reference: the monitor shows who is moving right now.
      motion: [...room.players.values()]
        .filter((candidate) => candidate.alive && !candidate.ventId)
        .map((candidate) => ({
          playerId: candidate.id,
          displayName: candidate.displayName,
          roomId: candidate.currentRoom,
          x: Number(candidate.position.x.toFixed(2)),
          z: Number(candidate.position.z.toFixed(2)),
          at: Date.now()
        })),
      doorLogs: room.doorLogs.slice(-12).map(({ playerId: _private, ...log }) => log),
      incidents: [...room.incidents.values()].map((incident) => ({ roomId: incident.roomId, createdAt: incident.createdAt, reported: incident.reported })),
      maintenance: room.maintenanceLogs.slice(-6)
    };
  }

  chat(room, player, messageInput) {
    const message = validateChat(messageInput);
    // A blackmailed player is silenced for the whole meeting.
    const silenced = [...room.players.values()].some((candidate) =>
      candidate.alive && candidate.role === "blackmailer"
      && candidate.roleState?.blackmailedId === player.id);
    if (silenced && [PHASES.DISCUSSION, PHASES.VOTING, PHASES.INCIDENT, PHASES.REMOVAL].includes(room.phase)) {
      throw new Error("You have been blackmailed and cannot speak this meeting.");
    }
    let channel = "lobby";
    let recipients = [...room.players.values()].filter((candidate) => candidate.connected && candidate.socketId);
    if ([PHASES.DISCUSSION, PHASES.VOTING, PHASES.INCIDENT, PHASES.REMOVAL].includes(room.phase)) {
      channel = player.alive ? "meeting" : "spectator";
      recipients = recipients.filter((candidate) => candidate.alive === player.alive);
    } else if (room.phase === PHASES.ACTIVE) {
      if (player.alive) throw new Error("Living players can only chat during meetings.");
      channel = "spectator";
      recipients = recipients.filter((candidate) => !candidate.alive);
    } else if (room.phase === PHASES.RESULTS) {
      channel = "results";
    }
    const payload = { channel, playerId: player.id, displayName: player.displayName, message, at: Date.now() };
    for (const recipient of recipients) this.io.to(recipient.socketId).emit("chatMessage", payload);
    return { ok: true };
  }

  checkWinConditions(room, reason) {
    // Roles that win on their own terms are settled before faction parity.
    if ([PHASES.ACTIVE, PHASES.REMOVAL, PHASES.DISCUSSION, PHASES.VOTING].includes(room.phase)) {
      const solo = checkSoloWin(room);
      if (solo) {
        room.specialWinnerIds = new Set(solo.winnerIds);
        this.endMatch(room, solo.winner, solo.reason);
        return true;
      }
    }
    if (![PHASES.ACTIVE, PHASES.REMOVAL, PHASES.DISCUSSION, PHASES.VOTING].includes(room.phase)) return false;
    const connectedOrBots = [...room.players.values()].filter((player) => player.connected || player.bot);
    const livingCrew = connectedOrBots.filter((player) => player.alive && player.faction === "crew").length;
    const livingOperatives = connectedOrBots.filter((player) => player.alive && player.faction === "operative").length;
    const livingSurvivors = connectedOrBots.filter((player) => player.alive && player.role === "survivor").length;
    let winner = null;
    let outcomeReason = reason;
    if (livingOperatives === 0 && livingCrew === 0 && livingSurvivors > 0) { winner = "neutral"; outcomeReason = "survivor-standing"; }
    else if (livingOperatives === 0) { winner = "crew"; outcomeReason = "all-operatives-removed"; }
    else if (livingCrew === 0 || livingOperatives >= livingCrew) { winner = "operative"; outcomeReason = "operative-parity"; }
    else if (room.taskTotal > 0 && room.taskCompleted >= room.taskTotal) { winner = "crew"; outcomeReason = "assignments-complete"; }
    if (!winner) return false;
    this.endMatch(room, winner, outcomeReason);
    return true;
  }

  endMatch(room, winner, reason) {
    if (room.phase === PHASES.RESULTS) return;
    for (const timer of room.timers) clearTimeout(timer);
    room.timers.clear();
    this.clearActiveSabotage(room);
    const endedAt = Date.now();
    const durationSeconds = Math.max(0, Math.round((endedAt - room.matchStartedAt) / 1000));
    const survivors = new Set(survivorWinnerIds(room));
    const players = [...room.players.values()].map((player) => {
      const won = room.specialWinnerIds.has(player.id) || survivors.has(player.id)
        || (winner !== "neutral" && player.faction === winner)
        || (winner !== "neutral" && player.role === "survivor" && player.alive)
        || (winner === "neutral" && reason === "survivor-standing" && player.role === "survivor" && player.alive);
      return {
        id: player.id, accountId: player.accountId, displayName: player.displayName,
        role: player.role, faction: player.faction, won,
        alive: player.alive, connected: player.connected, stats: player.matchStats,
        score: this.scorePlayer(player, won),
        survivalSeconds: player.eliminatedAt
          ? Math.max(0, Math.round((player.eliminatedAt - room.matchStartedAt) / 1000))
          : durationSeconds
      };
    });
    this.setPhase(room, PHASES.RESULTS, null);
    const results = { winner, reason, durationSeconds, players, taskProgress: { completed: room.taskCompleted, total: room.taskTotal } };
    this.io.to(room.code).emit("matchEnded", results);
    if (isDatabaseConfigured()) {
      recordMatch({
        roomCode: room.code, startedAt: new Date(room.matchStartedAt), endedAt: new Date(endedAt),
        mapId: room.mapId, winner, durationSeconds, players,
        summary: { reason, mode: room.mode, settings: room.settings, incidents: room.incidents.size }
      }).then((matchId) => this.io.to(room.code).emit("databaseSaveStatus", { saved: true, matchId }))
        .catch((error) => {
          console.error("Match persistence failed:", error.message);
          this.io.to(room.code).emit("databaseSaveStatus", { saved: false });
        });
    } else {
      this.io.to(room.code).emit("databaseSaveStatus", { saved: false, reason: "database-not-configured" });
    }
  }

  scorePlayer(player, won) {
    const stats = player.matchStats;
    return (won ? 100 : 25) + stats.tasksCompleted * 20
      + stats.sabotagesRepaired * 25 + stats.eliminations * 35
      + stats.correctVotes * 20 + stats.evidenceFound * 5;
  }

  tick() {
    const now = Date.now();
    const delta = Math.min(0.1, Math.max(0.001, (now - this.lastTickAt) / 1000));
    this.lastTickAt = now;
    for (const room of this.rooms.values()) {
      if (room.phase === PHASES.ACTIVE) this.assignSabotageRepairs(room);
      if ([PHASES.ACTIVE, PHASES.LOBBY].includes(room.phase)) {
        for (const player of room.players.values()) {
          if (!player.connected && !player.bot) continue;
          if (player.bot) {
            if (!player.alive) continue;
            if (room.phase === PHASES.ACTIVE) this.tickBot(room, player, now, delta);
            else this.tickPlayerMovement(room, player, now, delta);
            continue;
          }
          this.tickPlayerMovement(room, player, now, delta);
        }
      }
      if (room.phase === PHASES.ACTIVE && room.activeSabotage) {
        if (now >= room.activeSabotage.endsAt) {
          if (room.activeSabotage.critical) {
            this.endMatch(room, "operative", `${room.activeSabotage.id}-expired`);
          } else {
            const ended = this.publicSabotage(room.activeSabotage);
            this.clearActiveSabotage(room);
            this.io.to(room.code).emit("sabotageEnded", { ...ended, expired: true });
          }
        } else if (room.activeSabotage.critical && now - room.lastCriticalBroadcastAt >= 1000) {
          room.lastCriticalBroadcastAt = now;
          this.io.to(room.code).emit("sabotageUpdated", this.publicSabotage(room.activeSabotage));
        }
      }
      if (now - room.lastSnapshotAt >= 1000 / SNAPSHOT_RATE) {
        room.lastSnapshotAt = now;
        const members = [...room.players.values()];
        const shieldedPlayerIds = new Set(members
          .filter((player) => player.alive && player.role === "medic")
          .map((player) => player.roleState?.shieldTargetId)
          .filter(Boolean));
        const snapshots = members.map((player) => snapshotPlayer(player, room, shieldedPlayerIds, now));
        const base = {
          serverTime: now,
          phase: room.phase,
          incidents: [...room.incidents.values()].filter((incident) => !incident.reported).map((incident) => ({ id: incident.id, x: incident.x, z: incident.z, roomId: incident.roomId }))
        };
        // Sight is enforced here rather than dimmed on the client, so a tampered
        // client still cannot see crew, bodies or ghosts beyond its own radius.
        const living = snapshots.filter((snapshot) => snapshot.alive);
        for (const member of members) {
          if (!member.socketId || !member.connected) continue;
          // Ghost positions stay private to the dead: their last known body is the
          // incident marker the living can see instead.
          const visibleToMember = member.alive ? living : snapshots;
          // The Tracker's quarry is normally culled with everyone else, so its
          // position rides along separately. It is a bearing, not a sighting: the
          // target still does not appear in `players` unless it is genuinely in view.
          const tracked = this.trackedTargetFor(room, member, now);
          if (this.seesEverything(room, member)) {
            this.io.to(member.socketId).emit("worldSnapshot", { ...base, tracked, players: visibleToMember });
            continue;
          }
          const radius = this.visionRadiusFor(room, member);
          const cull = radius + VISION.cullMargin;
          this.io.to(member.socketId).emit("worldSnapshot", {
            ...base,
            tracked,
            visionRadius: Number(radius.toFixed(2)),
            lightsOut: this.lightsAreOut(room),
            blinded: (member.roleState?.blindedUntil ?? 0) > now,
            cuffed: (member.roleState?.cuffedUntil ?? 0) > now,
            players: visibleToMember.filter((snapshot) =>
              snapshot.id === member.id
              || (!snapshot.hidden && distance2D(snapshot, member.position) <= cull)),
            incidents: base.incidents.filter((incident) =>
              distance2D(incident, member.position) <= cull)
          });
        }
      }
    }
  }

  tickPlayerMovement(room, player, now, delta) {
    // Vented players ride the network, not the floor.
    if (player.ventId) return;
    const mapId = activeMapId(room);
    const input = now - player.lastInputAt < 500 ? player.input : normaliseInput({});
    const ghost = !player.alive;
    const map = getMapDefinition(mapId);
    const movementStart = player.position;
    // A fresh, validated client position already includes this interval's
    // movement. Resume server simulation only when prediction packets stop.
    if (!player.lastClientPredictionAt || now - player.lastClientPredictionAt > 75) {
      player.position = advancePlayerPosition({
        position: player.position,
        input,
        delta,
        faction: player.faction,
        settings: room.settings,
        alive: !ghost,
        isPositionValid: (x, z) => isWalkable(mapId, x, z)
          && (ghost || doorStepAllowed(map, room.activeSabotage, movementStart, { x, z })),
        bounds: map.bounds
      });
    }
    player.rotation = input.yaw;
    player.lastInputSeq = input.seq;
    player.animation = movementAnimation(input);
    const nextRoom = roomAt(mapId, player.position.x, player.position.z)?.id ?? player.currentRoom;
    if (nextRoom !== player.currentRoom) {
      if (!ghost) {
        room.doorLogs.push({ from: player.currentRoom, to: nextRoom, at: now, playerId: player.id });
        room.doorLogs = room.doorLogs.slice(-40);
      }
      player.currentRoom = nextRoom;
    }
  }

  acceptClientPrediction(room, player, proposed, input, now) {
    if (player.ventId || !proposed || ![proposed.x, proposed.z].every(Number.isFinite)) return false;
    const mapId = activeMapId(room);
    if (input.seq <= (player.lastClientMoveSeq ?? -1)) return false;
    let anchor = player.lastClientPosition ?? player.position;
    // Server-owned relocations (spawn, meeting table, vent exit) intentionally
    // invalidate the old client trail instead of letting it drag the player back.
    if (Math.hypot(anchor.x - player.position.x, anchor.z - player.position.z) > 3) {
      anchor = player.position;
      player.lastClientPosition = { ...player.position };
      player.lastClientMoveAt = 0;
    }
    const elapsed = player.lastClientMoveAt
      ? Math.max(0, Math.min(0.15, (now - player.lastClientMoveAt) / 1000))
      // A browser rendering at 60 FPS normally emits after four frames because
      // the client sends at a 50 ms cadence. That first packet is therefore
      // about 67 ms of legitimate movement, not the 50 ms a server tick uses.
      // Start with a conservative 100 ms window so ordinary input does not get
      // rejected and reconciled as a teleport before the server has an anchor.
      : 0.1;
    const speed = playerMovementSpeed(input, player.faction, room.settings, player.alive);
    const serverDistance = Math.hypot(proposed.x - player.position.x, proposed.z - player.position.z);
    const clientDistance = Math.hypot(proposed.x - anchor.x, proposed.z - anchor.z);
    // The allowance covers one input interval plus a small jitter margin. It is
    // checked against both trails: the server may be a tick apart, while the
    // accepted client trail strictly caps distance travelled over time.
    if (serverDistance > speed * elapsed + 0.65 || clientDistance > speed * elapsed + 0.08) return false;
    if (!player.alive) {
      const bounds = getMapDefinition(mapId).bounds;
      if (proposed.x < bounds.minX || proposed.x > bounds.maxX || proposed.z < bounds.minZ || proposed.z > bounds.maxZ) return false;
    } else if (!isWalkable(mapId, proposed.x, proposed.z)
      || !segmentWalkable(mapId, player.position, proposed, 0.55, 0.2)
      || !doorStepAllowed(getMapDefinition(mapId), room.activeSabotage, player.position, proposed)) {
      return false;
    }
    player.position = { x: proposed.x, z: proposed.z };
    player.lastClientPosition = { ...player.position };
    player.lastClientMoveAt = now;
    player.lastClientMoveSeq = input.seq;
    player.lastClientPredictionAt = now;
    return true;
  }

  // A bot working a repair panel goes through exactly the same actions a player
  // does, so it is bound by the same rules - including needing a second body on
  // the other hand scanner. Returns whether the outage is now over.
  botSolveRepair(room, bot, stationId) {
    const panel = room.activeSabotage?.panel;
    if (!panel) return false;
    switch (panel.kind) {
      case "switches": {
        for (let index = 0; index < panel.switches.length; index++) {
          if (panel.switches[index]) continue;
          if (this.repairAction(room, bot, { stationId, value: index })?.solved) return true;
        }
        return false;
      }
      case "keypad":
        return Boolean(this.repairAction(room, bot, { stationId, value: panel.code })?.solved);
      case "radio":
        return Boolean(this.repairAction(room, bot, { stationId, value: panel.target })?.solved);
      case "handprint":
        return Boolean(this.repairAction(room, bot, { stationId, value: "hold" })?.solved);
      default:
        return false;
    }
  }

  // Give each outstanding repair station its own crew bot. Assignment is deterministic
  // (nearest bot, ties broken by id) and one station never draws two bots, so a
  // two-station sabotage is actually resolvable.
  assignSabotageRepairs(room) {
    const sabotage = room.activeSabotage;
    const bots = [...room.players.values()].filter((player) => player.bot);
    if (!sabotage) {
      for (const bot of bots) bot.repairStationId = null;
      return;
    }
    const pending = sabotage.repairStations.filter((id) => !sabotage.repairs.has(id));
    const eligible = bots.filter((bot) => bot.alive && bot.faction === "crew");
    for (const bot of bots) {
      if (bot.repairStationId && (!pending.includes(bot.repairStationId) || !eligible.includes(bot))) {
        bot.repairStationId = null;
      }
    }
    const claimed = new Set(eligible.map((bot) => bot.repairStationId).filter(Boolean));
    for (const stationId of pending) {
      if (claimed.has(stationId)) continue;
      const station = stationById(room.mapId, stationId);
      if (!station) continue;
      const free = eligible.filter((bot) => !bot.repairStationId);
      if (!free.length) return;
      free.sort((a, b) => {
        const gap = distance2D(a.position, station) - distance2D(b.position, station);
        return gap === 0 ? a.id.localeCompare(b.id) : gap;
      });
      const responder = free[0];
      responder.repairStationId = stationId;
      responder.botTarget = null;
      claimed.add(stationId);
    }
  }

  tickBot(room, bot, now, delta) {
    if (room.phase !== PHASES.ACTIVE || !bot.alive) return;
    const map = getMapDefinition(room.mapId);
    if (bot.faction === "operative" && !room.activeSabotage && now >= this.botSabotageReadyAt(room) && Math.random() < delta * 0.12) {
      try { this.startSabotage(room, bot, map.sabotageDefinitions[Math.floor(Math.random() * map.sabotageDefinitions.length)].id); } catch { /* next tick */ }
    }
    if (bot.faction === "operative" && now - bot.lastEliminationAt > room.settings.eliminationCooldownSeconds * 1000) {
      const target = [...room.players.values()].find((player) => player.alive && player.faction === "crew" && distance2D(bot.position, player.position) <= room.settings.eliminationRange);
      if (target && Math.random() < delta * 0.35) {
        this.eliminateInternal(room, bot, target, "drone signal interruption");
        return;
      }
    }
    // A crew bot holding a repair assignment drops everything else until the station
    // is fixed or reassigned.
    const repairStation = bot.repairStationId ? stationById(room.mapId, bot.repairStationId) : null;
    if (repairStation) {
      if (bot.botTarget?.stationId !== repairStation.id) {
        bot.botTarget = {
          x: repairStation.x, z: repairStation.z, roomId: repairStation.roomId,
          stationId: repairStation.id, repairSabotageId: repairStation.refId
        };
        bot.botPath = this.buildBotPath(room.mapId, bot.currentRoom, repairStation.roomId, bot.position, repairStation);
        bot.botActionAt = now;
      }
    } else if (bot.botTarget?.repairSabotageId) {
      bot.botTarget = null;
    }
    if (!repairStation && (!bot.botTarget || now - bot.botActionAt > 30_000)) {
      const outstanding = bot.tasks.filter((task) => !bot.completedTasks.has(task.id));
      const task = outstanding[0] ?? bot.tasks[Math.floor(Math.random() * bot.tasks.length)];
      const station = stationById(room.mapId, `task:${task?.id}`) ?? map.stations[Math.floor(Math.random() * map.stations.length)];
      const fallbackSpawn = map.spawnPoints[0];
      bot.botTarget = station
        ? { x: station.x, z: station.z, roomId: station.roomId, stationId: station.id, taskId: task?.id }
        : { x: fallbackSpawn[0], z: fallbackSpawn[1], roomId: map.rooms[0].id };
      bot.botPath = this.buildBotPath(room.mapId, bot.currentRoom, bot.botTarget.roomId, bot.position, bot.botTarget);
      bot.botActionAt = now;
    }
    const waypoint = bot.botPath?.[0] ?? bot.botTarget;
    const dx = waypoint.x - bot.position.x;
    const dz = waypoint.z - bot.position.z;
    const distance = Math.hypot(dx, dz);
    // Stay close to collision-router corners before advancing. A loose radius
    // can put the bot on the wrong side of a console and make the next otherwise
    // valid segment cut through that fixture.
    if (bot.botPath?.length && distance < 0.25) {
      // Re-anchor on the validated grid point before taking the next segment.
      // Without this tiny snap, accumulated sub-step error can leave a bot on
      // the blocked side of a tight doorway even though both path segments are
      // individually collision-safe.
      bot.position = { x: waypoint.x, z: waypoint.z };
      bot.botPath.shift();
      return;
    }
    // Authored consoles and buttons can sit inside their fixture collision.
    // Use the same range as human interactions once pathfinding reaches the
    // closest clear point instead of trying to walk through the fixture.
    const targetStation = bot.botTarget?.stationId ? stationById(room.mapId, bot.botTarget.stationId) : null;
    if (!bot.botPath?.length && distance <= (targetStation ? reachOf(targetStation) : INTERACTION_RANGE)) {
      bot.animation = "interact";
      if (bot.botTarget.repairSabotageId) {
        let solved = false;
        const kind = room.activeSabotage?.panel?.kind;
        try {
          solved = this.botSolveRepair(room, bot, bot.botTarget.stationId);
        } catch {
          /* the sabotage ended or another responder finished it first */
        }
        // A hand scanner only counts while it is held, so a bot at one stays put
        // until the other is manned; otherwise it would press once and wander off
        // and the meltdown could never be stopped.
        if (solved || kind !== "handprint" || !room.activeSabotage) {
          bot.repairStationId = null;
          bot.botTarget = null;
        }
        return;
      }
      if (bot.faction === "crew" && bot.botTarget.taskId && !bot.completedTasks.has(bot.botTarget.taskId) && now - bot.botActionAt > 3_000) {
        this.completeTaskInternal(room, bot, bot.botTarget.taskId);
        bot.botTarget = null;
      } else if (now - bot.botActionAt > 4_000) {
        bot.botTarget = null;
      }
      return;
    }
    const input = { x: dx / distance, z: dz / distance, yaw: Math.atan2(dx, dz), crouch: false, seq: 0 };
    bot.input = input;
    bot.lastInputAt = now;
    this.tickPlayerMovement(room, bot, now, delta);
  }

  buildBotPath(mapId, startRoomId, targetRoomId, startPosition = null, targetPosition = null) {
    if (!startRoomId || !targetRoomId) return [];
    const map = getMapDefinition(mapId);
    const startRoom = map.rooms.find(({ id }) => id === startRoomId);
    const targetRoom = map.rooms.find(({ id }) => id === targetRoomId);
    if (!startRoom || !targetRoom) return [];
    if (startPosition && targetPosition && distance2D(startPosition, targetPosition) < 0.75) return [];
    return findWalkablePath(
      mapId,
      startPosition ?? startRoom.navigationAnchor ?? { x: startRoom.x, z: startRoom.z },
      targetPosition ?? targetRoom.navigationAnchor ?? { x: targetRoom.x, z: targetRoom.z }
    );
  }

  stop() {
    clearInterval(this.loop);
    clearInterval(this.rateCleanup);
    clearInterval(this.roomCodeUpkeep);
    if (isDatabaseConfigured()) {
      releaseInstanceRoomCodes(this.instanceId)
        .catch((error) => console.error("Releasing this instance's room codes failed:", error.message));
    }
    for (const room of this.rooms.values()) this.destroyRoom(room);
  }
}

export { MAP_DEFINITIONS };
