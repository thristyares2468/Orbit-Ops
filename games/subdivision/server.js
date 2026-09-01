// Last updated: 27 August 2026
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { WebSocketServer } = WebSocket;

const db = require('./db');
const auth = require('./auth');
const antiflood = require('./antiflood');
const bans = require('./bans');
const admin = require('./admin');
const skins = require('./skins');
const clientAccess = require('./clientAccess');
const roomCodes = require('./roomCodes');
const { loadMapCollision } = require('./mapCollision');
const gameMaps = require('./maps');
const core = require('./core'); // shared authoritative tables (Phase 0) + validation logic (Phase 1+)
// Containment (co-op wave survival). Pure module: state machine, scaling curves,
// enemy stepping and match-local economy. Everything with a socket or a database
// row attached to it stays in this file.
const containment = require('./containment');
const NUKE_DOOR_BY_ID = new Map((gameMaps.NUKE_DOORS || []).map(door => [door.id, door]));
const NUKE_VENT_BY_ID = new Map((gameMaps.NUKE_VENTS || []).map(vent => [vent.id, vent]));
const mailer = require('./mailer');

// ---------------------------------------------------------------------------
// SERVER ARCHITECTURE MAP
// ---------------------------------------------------------------------------
// This file is the authoritative multiplayer runtime:
//   1. HTTP serves index.html/assets plus small admin/health endpoints.
//   2. WebSocket message handlers validate/authenticate every gameplay packet.
//   3. rooms -> players is the live match model; clients receive snapshots and
//      roomState events derived from it.
//   4. db.js is only touched on auth, admin reads, and periodic stat flushes.
//
// Important ownership rule:
//   The browser may predict/animate, but the server decides damage, score,
//   deaths, assists, room visibility, admin access, and persistent stats.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Last-resort process guards. On a single-replica game server an uncaught throw
// or unhandled rejection exits the process and drops EVERY player at once. The
// hot paths (message dispatch + timers) are individually try/caught below, so
// reaching here is rare — when it does, log and keep the match alive rather than
// crashing everyone. Clients keep their score via the 60s rejoin stash anyway.
// ---------------------------------------------------------------------------
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException (kept alive):', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (err) => {
  console.error('[fatal] unhandledRejection (kept alive):', err && err.stack ? err.stack : err);
});

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_BASE_PATH = (() => {
  const value = String(process.env.PUBLIC_BASE_PATH || '').trim();
  if (!value || value === '/') return '';
  return '/' + value.replace(/^\/+|\/+$/g, '');
})();
const CANOPY_CLIENT_API_KEY = String(process.env.CANOPY_CLIENT_API_KEY || '').trim();
const CROSS_SERVER_INSTANCE_ID = String(process.env.CROSS_SERVER_INSTANCE_ID || (PUBLIC_BASE_PATH ? 'orbit-embedded' : 'james-standalone')).trim();
const CROSS_SERVER_PUBLIC_URL = String(
  process.env.CROSS_SERVER_PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  ''
).trim().replace(/\/+$/, '');

// The WebSocket a client elsewhere should open to play on this instance. Built
// from PUBLIC_BASE_PATH rather than guessed from someone else's URL, because the
// path only this process knows is exactly what decides it: embedded behind the
// Orbit Ops gateway the socket is /tips/ws, standalone it is the bare origin.
// This has to agree with embeddedClientConfig() below.
const CROSS_SERVER_SOCKET_URL = (() => {
  if (!CROSS_SERVER_PUBLIC_URL) return '';
  try {
    const url = new URL(CROSS_SERVER_PUBLIC_URL);
    const scheme = url.protocol === 'http:' ? 'ws:' : 'wss:';
    return `${scheme}//${url.host}${PUBLIC_BASE_PATH ? `${PUBLIC_BASE_PATH}/ws` : ''}`;
  } catch {
    return '';
  }
})();
const APP_VERSION = String(
  process.env.RAILWAY_DEPLOYMENT_ID ||
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  Date.now()
);
const TICK_MS = 30;
const SNAPSHOT_MS = 33;          // 30 Hz server snapshot broadcast
const SNAPSHOT_BACKPRESSURE_BYTES = 256 * 1024;
const HEARTBEAT_MS = 10000;      // ws ping liveness + AFK sweep + periodic roomState
const REJOIN_TTL_MS = 60000;     // dropped players can rejoin with score kept for this long
const RESPAWN_PROTECTION_MS = 10000;
const SPAWN_PROTECTION_AFTER_MOVE_MS = 3000;
const SPAWN_PROTECTION_SETTLE_MS = 450;
const SPAWN_PROTECTION_MOVE_EPSILON = 6;
const DEATH_SPECTATE_MS = 2500;
const MVP_SCREEN_MS = 6250;
const ROUND_TRANSITION_MS = DEATH_SPECTATE_MS + MVP_SCREEN_MS;
const PUBLIC_MAP_VOTE_MS = 5000;
const PUBLIC_MAP_VOTE_MIN_OPTIONS = 2;
const PUBLIC_MAP_VOTE_MAX_OPTIONS = 4;
const GUEST_DEVICE_BAN_MS = 15 * 60 * 1000;
// Guests can send chat. Set GUEST_CHAT=0 to put the account requirement back
// without a redeploy - the abuse case for this one is spam, which wants a lever
// that can be pulled in the time it takes to edit an environment variable.
const GUEST_CHAT_ENABLED = String(process.env.GUEST_CHAT ?? '1').trim() !== '0';
const AFK_IDLE_MS = 180000;
const AFK_MOVE_EPSILON = 0.75;
const DEATHMATCH_ROUND_MS = 180000;
const CHAT_RETENTION = Number(process.env.CHAT_LOG_RETENTION_DAYS) || 90;
const MAP_PATH = path.join(ROOT, 'assets', 'maps', 'de_dust_2_with_real_light.glb');

// --- Server-authoritative spawning + gamemodes/economy (from origin/main) ---
const SPAWN_RESERVE_TTL_MS = 1500;   // < RESPAWN_PROTECTION_MS so reservations free before a protected player is killable
const SPAWN_YAW = Math.PI;           // single fixed facing for ALL spawns
const SPAWN_LOS_DOT = 0.3;           // enemy "looking at" threshold
const SPAWN_LOS_DISTANCE = 600;
const SPAWN_LOS_PENALTY = 250;
const SPAWN_REPEAT_PENALTY = 300;
const SPAWN_DEATHPOS_PENALTY = 200;
const SPAWN_DEATHPOS_RADIUS = 250;
const SPAWN_SPREAD_WEIGHT = 0.5;
const SPAWN_NO_ENEMY_DISTANCE = 1000;
const SPAWN_SCORE_EPSILON = 1e-6;
const SPAWN_GROUND_PROBE_UP = 28;
const MAP_DUST2 = 'dust2';
const MAP_BACKROOMS = 'backrooms';
const MAP_NUKE = 'nuke';
const BACKROOMS_ROOM_CODE = 'BACKROOMS';
const ADMIN_MAP_IDS = gameMaps.ADMIN_MAP_IDS;
const PUBLIC_MAP_IDS = gameMaps.PUBLIC_MAP_IDS || [MAP_DUST2, MAP_NUKE];
const PUBLIC_MAP_SET = new Set(PUBLIC_MAP_IDS);
const HALF_MAP_RULES = gameMaps.HALF_MAP_RULES || {};
const VALID_MAP_IDS = new Set([MAP_DUST2, MAP_BACKROOMS, ...ADMIN_MAP_IDS]);
const FULL_MAP_ONLY_IDS = new Set([MAP_BACKROOMS, 'vertigo']);
const MAP_COLLISION_PATHS = new Map([
  [MAP_DUST2, { path: MAP_PATH, scale: 20 }],
  ...ADMIN_MAP_IDS.map(id => [id, {
    path: path.join(ROOT, gameMaps.MAP_DEFS[id].collisionPath),
    scale: gameMaps.MAP_DEFS[id].scale
  }])
]);

// Eye-height coords in mapScale-20 world space (promoted from the client's customSpawnPoints).
const SPAWN_POINTS = [
  // CT spawn range: { x: 132.08, y: 20141.87, z: 23970.21 } -> { x: 72.91, y: 20141.87, z: 24017.36 }
  { id: 0, x: 132.08, y: 20141.87, z: 23970.21, halfMap: true, visZones: [0, 1] },
  { id: 1, x: 112.36, y: 20141.87, z: 23985.93, halfMap: true, visZones: [0, 1] },
  { id: 2, x: 92.63,  y: 20141.87, z: 24001.64, halfMap: true, visZones: [0] },
  { id: 3, x: 72.91,  y: 20141.87, z: 24017.36, halfMap: true, visZones: [0] },
  // T spawn on half-map range: { x: 96.96, y: 20187.35, z: 24813.54 } -> { x: 3.49, y: 20176.00, z: 24837.79 }
  { id: 4, x: 96.96,  y: 20187.35, z: 24813.54, halfMap: true, visZones: [4, 5] },
  { id: 5, x: 68.47,  y: 20183.57, z: 24821.62, halfMap: true, visZones: [4, 5] },
  { id: 6, x: 35.98,  y: 20179.78, z: 24829.71, halfMap: true, visZones: [4] },
  { id: 7, x: 3.49,   y: 20176.00, z: 24837.79, halfMap: true, visZones: [4] },
  // Original full-map T spawn range.
  { id: 8,  x: -7.71,   y: 20200.11, z: 24780.53, halfMap: false, visZones: [] },
  { id: 9,  x: -50.00,  y: 20203.29, z: 24789.53, halfMap: false, visZones: [] },
  { id: 10, x: -92.28,  y: 20206.46, z: 24802.54, halfMap: false, visZones: [] },
  { id: 11, x: -134.57, y: 20209.64, z: 24815.54, halfMap: false, visZones: [] },
  // Full-map-only points distributed across sites, routes, tunnels, mid, and long.
  // Every position is sampled from the shipped Dust2 GLB and revalidated at spawn time.
  { id: 12, x: -413.62, y: 20176.00, z: 23945.79, halfMap: false, visZones: [] }, // B site
  { id: 13, x: -512.15, y: 20184.53, z: 23931.51, halfMap: false, visZones: [] }, // B back
  { id: 14, x: -323.86, y: 20179.38, z: 23998.56, halfMap: false, visZones: [] }, // B exit
  { id: 15, x: -182.62, y: 20141.87, z: 24053.00, halfMap: false, visZones: [] }, // B route
  { id: 16, x: 166.65,  y: 20149.39, z: 24047.74, halfMap: false, visZones: [] }, // A short
  { id: 17, x: 304.80,  y: 20201.60, z: 23985.76, halfMap: false, visZones: [] }, // A site
  { id: 18, x: 414.24,  y: 20177.16, z: 24127.79, halfMap: false, visZones: [] }, // A long
  { id: 19, x: -390.47, y: 20176.00, z: 24145.94, halfMap: false, visZones: [] }, // Upper tunnels
  { id: 20, x: -283.57, y: 20184.53, z: 24271.28, halfMap: false, visZones: [] }, // Lower tunnels
  { id: 21, x: 285.00,  y: 20176.00, z: 24400.54, halfMap: false, visZones: [] }, // CT mid
  { id: 22, x: -192.34, y: 20235.73, z: 24517.95, halfMap: false, visZones: [] }, // T-side upper route
  { id: 23, x: -122.40, y: 20176.00, z: 24608.85, halfMap: false, visZones: [] }, // T approach left
  { id: 24, x: 82.21,   y: 20176.00, z: 24670.89, halfMap: false, visZones: [] }, // T approach center
  { id: 25, x: 114.47,  y: 20176.00, z: 24594.40, halfMap: false, visZones: [] }, // T mid
  { id: 26, x: 412.64,  y: 20176.00, z: 24581.93, halfMap: false, visZones: [] }  // T approach right
];
const BACKROOMS_SPAWN_POINTS = [
  { id: 0, x: -1240, y: 17.1, z: 120, halfMap: true, visZones: [] },
  { id: 1, x: -1080, y: 17.1, z: 120, halfMap: true, visZones: [] },
  { id: 2, x: -920,  y: 17.1, z: 120, halfMap: true, visZones: [] },
  { id: 3, x: -760,  y: 17.1, z: 120, halfMap: true, visZones: [] },
  { id: 4, x: -600,  y: 17.1, z: 120, halfMap: true, visZones: [] },
  { id: 5, x: -440,  y: 17.1, z: 120, halfMap: true, visZones: [] },
  { id: 6, x: -280,  y: 17.1, z: 120, halfMap: true, visZones: [] },
  { id: 7, x: -120,  y: 17.1, z: 120, halfMap: true, visZones: [] }
];
const MAP_ZONES = [
  { id: 0, xMin: -146, xMax: 110, zMin: 23900, zMax: 24160 },
  { id: 1, xMin: 110,  xMax: 340, zMin: 23900, zMax: 24160 },
  { id: 2, xMin: -146, xMax: 110, zMin: 24160, zMax: 24450 },
  { id: 3, xMin: 110,  xMax: 340, zMin: 24160, zMax: 24450 },
  { id: 4, xMin: -146, xMax: 110, zMin: 24450, zMax: 24960 },
  { id: 5, xMin: 110,  xMax: 340, zMin: 24450, zMax: 24960 }
];
const TIMED_ROUND_MS = 180000;
const START_MONEY = 200;
const CASUAL_START_MONEY = 800;
const KILL_REWARD = 50;
const BOUNTY_STREAK_THRESHOLD = 4;
const BOUNTY_KILL_SCORE_BONUS = 25;
const BOUNTY_CLAIM_SCORE_BONUS = 100;

const MONEY_CAP = 16000;
const CASUAL_MIN_TEAM_PLAYERS = 3;
const CASUAL_WARMUP_COUNTDOWN_MS = 30000;
const CASUAL_INTRO_MS = 5000;
const CASUAL_ROUND_MS = 115000;
const CASUAL_FIRST_TO = 6;
const CASUAL_HALFTIME_ROUNDS = 5;
const CASUAL_WIN_REWARD = 3250;
const CASUAL_LOSS_REWARD = 1900;
const CASUAL_PLANT_REWARD = 300;
const CASUAL_BOMB_TIMER_MS = 40000;
const CASUAL_PLANT_MS = 3200;
const CASUAL_DEFUSE_MS = 5000;
const CASUAL_INTERACT_RADIUS = 62;
const CASUAL_BUY_TIME_MS = 30000;
const CASUAL_BUY_ZONE_RADIUS = 145;
const DROPPED_ITEM_PICKUP_RADIUS = 36;
const GRENADE_PER_LIFE_CAP = 2;
// Utility kinds may cap lower than the shared default (the barricade does).
function utilityLifeCap(kind) {
  const cap = Number(UTILITY_LIFE_CAPS?.[kind]);
  return Number.isFinite(cap) ? cap : GRENADE_PER_LIFE_CAP;
}
const UTILITY_PRICES = core.UTILITY_PRICES; // shared with client (core.js)
const WEAPON_PRICES = core.WEAPON_PRICES;   // shared with client (core.js)
const CASUAL_ONLY_WEAPONS = new Set(['USP-S', 'P2000', 'P250', 'Five-SeveN', 'Tec-9', 'CZ75-Auto', 'Dual Berettas', 'R8 Revolver']);
const CASUAL_BOMB_SITES = [
  { id: 'A', label: 'A', x: 304.80, z: 23985.76, xMin: 296.27, xMax: 313.32, zMin: 23975.81, zMax: 23995.71, radius: 18 },
  { id: 'B', label: 'B', x: -413.62, z: 23945.79, xMin: -443.73, xMax: -383.50, zMin: 23925.89, zMax: 23965.69, radius: 37 }
];
const GRENADE = core.GRENADE; // authoritative grenade geometry, shared via core.js
const BARRICADE = core.BARRICADE; // deployable barricade geometry, shared via core.js
const C4 = core.C4; // remote-detonated charge geometry/timing, shared via core.js
const SHOTGUN_ALT = core.SHOTGUN_ALT; // Breacher buckshot/slug tables, shared via core.js
const UTILITY_LIFE_CAPS = core.UTILITY_LIFE_CAPS; // per-kind overrides (core.js)
const GRENADE_HIT_WINDOW_MS = 2000;
const GRENADE_RADIUS_SLACK = 45;
const MODE_CONFIG = {
  gunGame: { timed: false, teams: false },
  deathmatch: { timed: true, teams: false },
  tdm: { timed: true, teams: true },
  // Zombies: co-operative wave survival. `teams` places the squad on one side
  // so normal hit validation blocks friendly fire; `coop` selects the wave
  // runtime and its own score/economy. Untimed: a run ends when the squad is
  // wiped or extracts, not on a clock.
  containment: { timed: false, teams: true, coop: true, fullMap: true }
};
const VALID_GAMEMODES = new Set(Object.keys(MODE_CONFIG));
// Casual still has a lot of backend code below, but it is intentionally omitted
// from MODE_CONFIG right now. That keeps it hidden/disabled from normal room
// creation without deleting the partially built bomb/economy system.
// Always-open testing room. Only allow-listed admins may join (see below); every
// admin inside can live-edit its adminConfig. Code is case-insensitive (joins
// normalize to upper case).
const ADMIN_ROOM_CODE = 'JIMS-ADMIN';
const ADMIN_DUMMY_MAX = 24;
// In-game authority comes from accounts.role in Postgres. It is copied onto the
// authenticated socket so every gameplay/admin gate remains synchronous.
function accountRole(client) {
  const role = String(client?.accountRole || '').trim().toLowerCase();
  return role === 'owner' || role === 'admin' ? role : 'user';
}
function isOwnerAdminUser(client) {
  return !!client && !client.guest && accountRole(client) === 'owner';
}
function isAdminUser(client) {
  const role = accountRole(client);
  return !!client && !client.guest && (role === 'admin' || role === 'owner');
}
const PLAYER_PROFILE_ICONS = [
  '/assets/profile-icons/player-round-v3.png',
  '/assets/profile-icons/player-shield-v3.png',
  '/assets/profile-icons/player-portrait-v3.png'
];
const ADMIN_PROFILE_ICON = '/assets/profile-icons/admin-v3.png';
function profileIconForIdentity(accountId, role = 'user', fallback = '') {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (normalizedRole === 'admin' || normalizedRole === 'owner') return ADMIN_PROFILE_ICON;
  const identity = String(accountId || fallback || 'player');
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i++) {
    hash ^= identity.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return PLAYER_PROFILE_ICONS[(hash >>> 0) % PLAYER_PROFILE_ICONS.length];
}
function profileIconForClient(client) {
  return profileIconForIdentity(client?.accountId, accountRole(client), client?.deviceId || client?.id || client?.name);
}
function publicUiConfig() {
  return { experimentalMenuEnabled: true };
}
const ROUND_LOCKED_MESSAGES = new Set([
  'playerState', 'playerShoot', 'playerHit', 'glassBreak', 'ventBreak', 'doorToggle', 'throwGrenade', 'grenadeBurst',
  'flashHit', 'bombAction', 'dropItem', 'selfDamage', 'playerVoid', 'gunGameWin', 'useStim', 'playerHeal',
  'deployBarricade', 'barricadeDamage', 'deployC4', 'detonateC4', 'c4Damage'
]);
function usesUtility(room) {
  const mode = room?.settings?.gamemode;
  return mode === 'deathmatch' || mode === 'tdm';
}
// Team side spawns: CT starts on the bombsite/rotation side, T starts on the
// tunnels/long side. Keep this in sync with TEAM_SPAWN_INDEXES in index.html.
const TEAM_SPAWN_IDS = core.TEAM_SPAWN_IDS; // shared with client TEAM_SPAWN_INDEXES (core.js)
const TEAM_FULL_MAP_SPAWN_IDS = core.TEAM_FULL_MAP_SPAWN_IDS;
const BACKROOMS_TEAM_SPAWN_IDS = { 0: [0, 1, 2, 3], 1: [4, 5, 6, 7] };
const TEAM_META = {
  0: { name: 'Counter-Terrorists', short: 'CT', color: '#49a6ff' },
  1: { name: 'Terrorists', short: 'T', color: '#ffad33' }
};

const DEFAULT_ROOM_SETTINGS = {
  fullMap: false,
  gamemode: 'gunGame',
  mapId: MAP_DUST2,
  private: false,
  nextGamemode: null,
  roundEndsAt: null
};

const AUTH_TYPES = new Set([
  'authRegister',
  'authConfirmRegister',
  'authLogin',
  'authResume',
  'authHandoff',
  'authGuest',
  'authChangeUsername',
  'authChangePassword',
  'authGetRecoveryCode',
  'authAdminGetRecoveryCode',
  'authConfirmPasswordReset',
  'authRequestEmailChange',
  'authConfirmEmailChange',
  'logout'
]);
const TRADE_MIN_LEVEL = 5;

const clients = new Map();
const rooms = new Map();
const mapCollisions = new Map();
let snapshotSeq = 0;
const chatLogQueue = [];
const dailyStatsMemory = new Map();
const newsMemory = [{
  id: 'welcome',
  title: "Welcome to Orbit Ops Subdivision",
  body: 'Have fun, be respectful, and most importantly, keep that lawn clean.',
  author_name: 'Orbit Ops Subdivision',
  created_at: new Date().toISOString()
}];
const ECONOMY_TAMPER_TYPES = new Set([
  'AmountMowCoins',
  'AmountMowbucks',
  'SetMowbucks',
  'SetMowCoins',
  'GiveMowbucks',
  'GiveMowCoins',
  'GrantMowbucks',
  'GrantMowCoins',
  'GrantCases',
  'UnlockAllSkins',
  'SetInventory'
]);
let customCaseCache = null;
let customCaseCacheLoadedAt = 0;

function isAdminRoom(room) {
  return !!room && rooms.get(ADMIN_ROOM_CODE) === room;
}

function countsForLeaderboardStats(room) {
  return !!room && !isAdminRoom(room) && !isCasualWarmup(room);
}

function progressionPlayerCount(room) {
  return room?.players instanceof Map ? room.players.size : 0;
}

function countsForProgression(room) {
  // Persistent XP and daily challenge progress require a real lobby. Keep this
  // gate aligned with all award paths so private/dev-console farming cannot
  // mutate account progression with one or two clients.
  return countsForLeaderboardStats(room) && progressionPlayerCount(room) >= 3;
}

function suppressRoundProgression(room, reason = 'untrusted') {
  if (!room) return;
  room.progressionSuppressedRound = true;
  room.progressionSuppressedReason = reason;
}

function canClientProgress(client) {
  return !!client && countsForProgression(rooms.get(client.roomCode));
}

function countsForAccuracyStats(room, player) {
  if (!countsForLeaderboardStats(room) || !player) return false;
  let activeOpponents = 0;
  for (const candidate of room.players.values()) {
    if (candidate.id === player.id || candidate.waitingForNextRound || (candidate.health || 0) <= 0) continue;
    activeOpponents++;
  }
  return activeOpponents > 0;
}

// ---------------------------------------------------------------------------
// Server-authoritative weapon table (mirrors index.html weapons[] 776-788).
// Damage is per body part; client-supplied damage is ignored entirely.
// ---------------------------------------------------------------------------

const WEAPON_NAMES = core.WEAPON_NAMES; // shared snapshot weapon-index order (core.js)
const WEAPONS = core.WEAPONS;           // authoritative damage table, shared via core.js

// ---------------------------------------------------------------------------
// Anti-cheat tuning. Thresholds derive from client constants: runSpeed=75,
// jumpVelocity=120, gravity=400 (apex 120^2/2/400 = 18u), playerHeight=16.
// ---------------------------------------------------------------------------
const AC = {
  MAX_H_SPEED: 75,
  H_SPEED_TOLERANCE: 1.6,        // ~120 u/s horizontal ceiling (air-strafe + jitter)
  H_SLACK: 8,                    // flat per-tick units for one-frame jitter
  MAX_UP_SPEED: 120 * 1.5,       // 180 u/s upward ceiling
  MAX_DOWN_SPEED: 800,           // falls are legit & fast; below = teleport-down
  MAX_TELEPORT: 350,             // absolute warp larger than any lag spike (rubber-band only, no strike)
  MAX_DT_MS: 300,
  GROUND_BAND_ABOVE: 60,         // generous headroom for jumps off crates/ledges
  GROUND_BAND_BELOW: 16,
  GROUND_PROBE_UP: 8,            // cast ground ray from feet + this (avoids ceilings)
  FLY_GRACE_MS: 2500,            // must hover above the band this long (not falling) to be 'flying'
  RESPAWN_GRACE_MS: 3500,        // trust + re-anchor movement this long after spawn/respawn
  VOID_Y: -150,
  GROUND_CHECK_EVERY_MS: 150,
  FIRE_TOLERANCE: 0.85,
  CORRELATION_WINDOW_MS: 400,
  ANGLE_TOLERANCE_COS: Math.cos((30 * Math.PI) / 180),
  VIEW_TOLERANCE_COS: Math.cos((45 * Math.PI) / 180),
  CLOSE_RANGE: 60,
  DIST_FACTOR: 0.5,
  DIST_SLACK: 80,
  MELEE_RANGE: 18 * 1.4,
  GUN_RANGE: 1000 * 1.05,
  ENABLE_LOS: process.env.AC_ENABLE_LOS === '1'
};
const DUST2_DEATH_BARRIER_MARGIN = 140;
const DUST2_SPAWN_SNAP_TOLERANCE = 22;

const STRIKE_WARN = 6;
const STRIKE_KICK = 20;
const STRIKE_HALFLIFE = 60000;
const MOVEMENT_TYPES = new Set(['speedHack', 'flyUp', 'flying', 'noclip', 'teleport', 'teleportDown', 'offmap']);
const SEVERITY = {
  speedHack: 3, flyUp: 3, flying: 4, noclip: 4, teleport: 5, teleportDown: 5, offmap: 4,
  rapidFire: 2, badWeapon: 4, badPart: 4, rangeHack: 3, silentAim: 5, ghostHit: 5, msg_flood: 2
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function cacheControlFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const rel = '/' + path.relative(ROOT, filePath).replace(/\\/g, '/');
  if (ext === '.html' || ext === '.js') return 'no-store';
  if (rel.startsWith('/assets/') || /\.(glb|gltf|bin|ktx2|png|jpe?g|webp|ico)$/i.test(filePath)) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=3600';
}

function prefixedClientDocument(data, filePath) {
  if (!PUBLIC_BASE_PATH) return data;
  // maps.js builds the imported maps' GLB URLs itself, so those strings never
  // pass through the HTML rewrite below. Behind Orbit Ops' /jims-mowing/ gateway
  // an unprefixed /assets/... resolves against the Orbit origin, which does not
  // hold these files - the map 404s and the player drops into an empty scene.
  // Dust2 was unaffected only because its path is inline in index.html.
  // Only the leading-slash URL form is rewritten: collisionPath is a relative
  // filesystem path the server resolves against ROOT and must stay untouched.
  if (path.basename(filePath) === 'maps.js') {
    return Buffer.from(data.toString('utf8').replaceAll('/assets/', `${PUBLIC_BASE_PATH}/assets/`));
  }
  if (path.extname(filePath).toLowerCase() !== '.html') return data;
  let html = data.toString('utf8');
  for (const assetPath of [
    '/assets/',
    '/orbit-ops-subdivision-badge-simple.png',
    '/orbit-ops-subdivision-logo-simple.png',
    '/dust2-minimap.png',
    '/client-config.js',
    '/maps.js',
    '/core.js',
    '/sw.js'
  ]) {
    html = html.replaceAll(assetPath, `${PUBLIC_BASE_PATH}${assetPath}`);
  }
  html = html.replaceAll('/legal', `${PUBLIC_BASE_PATH}/legal`);
  if (path.basename(filePath) === 'legal.html') {
    html = html.replaceAll('href="/"', `href="${PUBLIC_BASE_PATH}/"`);
  }
  return Buffer.from(html);
}

function embeddedClientConfig() {
  const websocketPath = `${PUBLIC_BASE_PATH || ''}/ws`;
  return `window.JIMS_CLIENT_CONFIG = Object.freeze({\n` +
    `  multiplayerUrl: (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + ${JSON.stringify(websocketPath)},\n` +
    `  apiKey: '',\n` +
    `  serviceWorkerEnabled: false\n` +
    `});\n`;
}

// ---------------------------------------------------------------------------
// HTTP: admin panel first, then health, then static files.
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/admin')) {
    admin.handle(req, res, { rooms, clients, onBan: (accountId) => kickAccountSessions(accountId, 'banned') });
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }

  if (req.url && req.url.split('?')[0] === '/client-config.js' && PUBLIC_BASE_PATH) {
    const source = embeddedClientConfig();
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Content-Length': Buffer.byteLength(source),
      'Cache-Control': 'no-store'
    });
    res.end(source);
    return;
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    // A malformed percent-escape (e.g. "/%") throws "URI malformed". Reject it
    // instead of letting the throw crash the request handler (and the server).
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  const safePath = urlPath === '/'
    ? '/index.html'
    : (urlPath === '/legal' || urlPath === '/legal/' ? '/legal.html' : urlPath);
  const filePath = path.normalize(path.join(ROOT, safePath));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const body = prefixedClientDocument(data, filePath);
    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      // Explicit length so the browser can show real download progress (otherwise
      // Node falls back to chunked transfer-encoding and the loader sees 0%).
      'Content-Length': body.length,
      // index.html and core.js carry the authoritative game rules; never cache
      // them. Heavy models/textures/maps live under assets and get long-lived
      // immutable caching so repeat joins do not re-download the weapon set.
      'Cache-Control': cacheControlFor(filePath)
    });
    res.end(body);
  });
});

const wss = new WebSocketServer({
  server,
  maxPayload: 64 * 1024,
  // No compression: per-message zlib adds latency/CPU and undoes setNoDelay,
  // and snapshots are tiny anyway.
  perMessageDeflate: false,
  handleProtocols: clientAccess.selectCanopyProtocol,
  verifyClient: ({ req }, done) => {
    if (clientAccess.isAuthorizedCanopyClient(req, CANOPY_CLIENT_API_KEY)) {
      done(true);
      return;
    }
    console.warn('[access] rejected WebSocket client without valid Canopy credentials');
    done(false, 401, 'Unauthorized');
  }
});

// A server-level 'error' event (e.g. EMFILE/fd exhaustion on accept, upgrade
// failures) with no listener is thrown by Node and would crash the process,
// dropping every connected player. Log it instead.
wss.on('error', (e) => console.error('[wss] error:', e && e.message ? e.message : e));
server.on('error', (e) => console.error('[http] server error:', e && e.message ? e.message : e));

const EMAIL_AUTH_GRACE_MS = 15 * 60 * 1000;

function scheduleAuthTimeout(client, delayMs = antiflood.CFG.AUTH_GRACE_MS) {
  if (client.authTimer) clearTimeout(client.authTimer);
  client.authTimer = setTimeout(() => {
    if (!client.authed) {
      try {
        send(client, 'authError', { code: 'auth_timeout', message: 'Login timed out. Please refresh.' });
        client.ws.close();
      } catch {}
    }
  }, delayMs);
}

wss.on('connection', (ws, req) => {
  try { req.socket.setNoDelay(true); } catch {} // kill Nagle's coalescing on small frames
  const ip = antiflood.extractIp(req);
  const subnet = antiflood.subnetOf(ip);

  const admit = antiflood.onConnect(ip);
  if (!admit.ok) {
    try { ws.close(admit.code || 1013, admit.reason || 'rejected'); } catch {}
    return;
  }

  const id = crypto.randomBytes(8).toString('hex');
  const client = {
    id,
    ws,
    ip,
    subnet,
    roomCode: null,
    roomCreationPending: null,
    rejoinToken: null,
    alive: true,
    lastStateAt: 0,
    lastRtt: null,
    // auth/account
    authed: false,
    accountId: null,
    accountName: null,
    accountRole: 'user',
    guest: false,
    skinLoadout: {},
    deviceId: null,
    token: null,
    authAttempts: 0,
    authTimer: null,
    // stats
    statDelta: newStatDelta(),
    dailyDelta: newDailyDelta(),
    matchChallengeDelta: newMatchChallengeDelta(),
    killStreak: 0,
    stimCharges: 0,
    lastPlaytimeStamp: 0,
    msgBuckets: {}
  };

  clients.set(id, client);
  send(client, 'connected', { id, version: APP_VERSION });

  // Issue a PoW challenge for register (always-on difficulty; escalates under burst).
  const diff = antiflood.difficultyFor(ip, { alwaysOn: true });
  const challenge = antiflood.issueChallenge(ip, diff);
  send(client, 'authChallenge', { nonce: challenge.nonce, difficulty: challenge.difficulty, needPow: diff > 0 });

  scheduleAuthTimeout(client);

  ws.on('pong', () => { client.alive = true; });
  ws.on('message', (raw) => {
    // Isolate every packet: a throw from one client's message must never unwind
    // the process and disconnect everyone else.
    try { handleMessage(client, raw); }
    catch (e) { console.error('[msg]', client.id, e && e.message ? e.message : e); }
  });
  ws.on('close', () => removeClient(id));
  ws.on('error', () => removeClient(id));
});

// ---------------------------------------------------------------------------
// Heartbeat + AFK cleanup + periodic full room sync (existing behavior).
// ---------------------------------------------------------------------------
setInterval(() => {
  const now = Date.now();
  for (const client of clients.values()) {
    // Isolate each client: a throw while reaping one socket must not abort the
    // sweep for the rest (which would leave everyone unswept / un-pinged).
    try {
      if (!client.alive) {
        try { client.ws.terminate(); } catch {}
        removeClient(client.id);
        continue;
      }
      client.alive = false;
      try { client.ws.ping(); } catch {}
    } catch (e) { console.error('[heartbeat:client]', e && e.message ? e.message : e); }
  }

  for (const [roomCode, room] of rooms.entries()) {
    // Isolate each room: a throw in AFK cleanup / broadcast for one room must not
    // crash the timer (no handler = whole-process exit = everyone disconnected).
    try {
      for (const player of Array.from(room.players.values())) {
        if (now - (player.activeAt || player.updatedAt) > AFK_IDLE_MS) {
          const client = clients.get(player.id);
          if (client?.ws.readyState === WebSocket.OPEN) {
            send(client, 'roomRemoved', { reason: 'afk' });
            client.ws.close();
          }
          removePlayerFromRoom(player.id, 'afk', { notifySelf: false });
        }
      }
      // Expire rejoin stashes; rooms kept alive only for a pending rejoin die with them.
      if (room.pendingRejoins) {
        for (const [token, stash] of room.pendingRejoins) {
          if (stash.expiresAt <= now) room.pendingRejoins.delete(token);
        }
      }
      if (room.players.size === 0) {
        // The admin testing room is always-open: keep it (and its config) alive
        // even when empty so the join code never goes dead.
        if (roomCode === ADMIN_ROOM_CODE) { clearRoomRoundTimer(room); continue; }
        if (!room.pendingRejoins || room.pendingRejoins.size === 0) {
          clearRoomRoundTimer(room);
          rooms.delete(roomCode);
          removeRoomDirectory(roomCode, room);
        }
        continue;
      }
      sweepReservations(room, now);
      if (MODE_CONFIG[room.settings.gamemode]?.casual) updateCasualWarmup(roomCode, room, now);
      broadcastRoomState(roomCode);
    } catch (e) { console.error('[heartbeat:room]', roomCode, e && e.message ? e.message : e); }
  }
}, HEARTBEAT_MS);

// Room simulation remains local to each host, while this lightweight directory
// heartbeat lets a code entered on the other host find the correct instance.
setInterval(() => {
  for (const [roomCode, room] of rooms.entries()) publishRoomDirectory(roomCode, room);
}, 15000).unref();

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------
function handleMessage(client, raw) {
  // One dispatcher owns all WebSocket packet routing. Keep new packet types here
  // instead of adding ad-hoc ws listeners; the auth/rate-limit/room checks below
  // are the safety rail for the whole game.
  // Any inbound frame proves the socket is alive. This is the PRIMARY liveness
  // signal: browser clients cannot emit protocol pong frames on demand, and some
  // edge proxies drop WebSocket control frames (opcodes 0x9/0xA) while still
  // forwarding data frames. Relying on ws.on('pong') alone then makes the 10s
  // heartbeat sweep find every client "not alive" in the same tick and terminate
  // the whole room at once. Set before the parse so even a malformed frame counts.
  client.alive = true;

  let packet;
  try {
    packet = JSON.parse(raw.toString());
  } catch {
    return;
  }
  // JSON.parse('null'), '5', '"x"' are valid JSON but not packets. Guard the deref
  // so a single 4-byte `null` text frame can't throw on packet.type and crash the
  // whole process (it runs before any auth check — an unauth'd kill switch).
  if (!packet || typeof packet !== 'object') return;

  const type = String(packet.type || '');
  const data = (packet.data && typeof packet.data === 'object') ? packet.data : {};

  // Auth handshake messages.
  if (AUTH_TYPES.has(type)) {
    if (type === 'logout') { handleLogout(client); return; }
    if (++client.authAttempts > 40) { try { client.ws.close(); } catch {}; return; }
    handleAuth(client, type, data);
    return;
  }

  // Everything else requires a logged-in account.
  if (!client.authed) {
    send(client, 'authError', { code: 'not_authed', message: 'Please log in to play.' });
    return;
  }

  // Ban could have landed mid-session.
  const ab = client.accountId ? bans.checkAccount(client.accountId) : { banned: false };
  if (ab.banned) {
    send(client, 'authError', { code: 'banned', message: ab.reason || 'This account is banned.', reason: ab.reason });
    try { client.ws.close(); } catch {}
    return;
  }

  // Per-connection, per-type rate limiting. Over-limit messages are silently dropped
  // (which already protects the server) — we do NOT strike for this, so a fast weapon
  // or network jitter can never penalize a normal player.
  if (!antiflood.allowMessage(client, type)) return;

  if (ECONOMY_TAMPER_TYPES.has(type)) {
    handleUnauthorizedEconomyCommand(client, type, data);
    return;
  }

  // Latency probe — handled before the room lookup so it works in the lobby too.
  // Deliberately does NOT touch player.activeAt: AFK detection must only see real activity.
  if (type === 'ping') {
    const t = Number(data.t);
    const rtt = Number(data.rtt);
    if (Number.isFinite(rtt)) {
      client.lastRtt = Math.round(Math.max(0, Math.min(2000, rtt)));
      const p = rooms.get(client.roomCode)?.players.get(client.id);
      if (p) p.rtt = client.lastRtt;
    }
    send(client, 'pong', { t: Number.isFinite(t) ? t : 0, ts: Date.now() });
    return;
  }

  if (type === 'clientSecurityEvent') {
    handleClientSecurityEvent(client, data);
    return;
  }

  // --- owner tools ------------------------------------------------------
  // Both are admin-gated on the connection, never on anything the packet says,
  // and both write an audit line: adjusting someone else's balance or handing
  // out an item should never be invisible after the fact.
  if (type === 'adminListBalances') {
    if (!isAdminUser(client) || !db.isEnabled()) return;
    db.listAccountBalances({ search: data?.search, limit: data?.limit })
      .then((accounts) => send(client, 'adminBalances', { accounts }))
      .catch((error) => {
        console.error('[owner-tools] balance list failed:', error.message);
        send(client, 'adminToolsStatus', { ok: false, message: 'Could not load balances.' });
      });
    return;
  }

  if (type === 'adminSetMowbucks') {
    if (!isAdminUser(client) || !db.isEnabled()) return;
    const accountId = Number(data?.accountId);
    const amount = Number(data?.amount);
    if (!Number.isInteger(accountId) || accountId <= 0 || !Number.isFinite(amount) || amount < 0) {
      send(client, 'adminToolsStatus', { ok: false, message: 'Enter a whole amount of 0 or more.' });
      return;
    }
    db.setMowbucks(accountId, amount)
      .then((balance) => {
        console.log(`[owner-tools] ${client.username} set account ${accountId} mowbucks to ${balance}`);
        try { db.logIpEvent({ event: 'admin_set_mowbucks', accountId: client.accountId, detail: `${accountId}:${balance}` }); } catch {}
        send(client, 'adminToolsStatus', { ok: true, message: `Balance set to ${balance}.` });
        send(client, 'adminBalanceUpdated', { accountId, mowbucks: balance });
        // The player, if they are online, sees it immediately rather than at
        // their next sign-in.
        for (const other of clients.values()) {
          if (other.accountId === accountId) send(other, 'mowbucksUpdated', { mowbucks: balance });
        }
      })
      .catch((error) => {
        console.error('[owner-tools] set mowbucks failed:', error.message);
        send(client, 'adminToolsStatus', { ok: false, message: 'Could not set that balance.' });
      });
    return;
  }

  if (type === 'adminGrantSkin') {
    if (!isAdminUser(client) || !db.isEnabled()) return;
    const itemId = String(data?.itemId || '').trim();
    const username = String(data?.username || '').trim();
    if (!itemId || !username) {
      send(client, 'adminToolsStatus', { ok: false, message: 'Pick a player and a skin.' });
      return;
    }
    (async () => {
      const account = await db.findAccountByUsername(username);
      if (!account) {
        send(client, 'adminToolsStatus', { ok: false, message: 'No account with that name.' });
        return;
      }
      // The catalog is the allowlist: an id that is not a real skin never
      // reaches the inventory, whatever the packet claims.
      const item = skins.getItem(itemId);
      if (!item) {
        send(client, 'adminToolsStatus', { ok: false, message: 'That skin does not exist.' });
        return;
      }
      const granted = await db.grantSkinToAccount({
        accountId: Number(account.id),
        itemId: item.id,
        rarityTier: item.rarity || null
      });
      if (!granted) {
        send(client, 'adminToolsStatus', { ok: false, message: 'Could not grant that skin.' });
        return;
      }
      console.log(`[owner-tools] ${client.username} granted ${itemId} to ${account.username}`);
      try { db.logIpEvent({ event: 'admin_grant_skin', accountId: client.accountId, detail: `${account.id}:${itemId}` }); } catch {}
      send(client, 'adminToolsStatus', { ok: true, message: `Gave ${itemId} to ${account.username}.` });
      for (const other of clients.values()) {
        if (other.accountId === Number(account.id)) sendSkinInventory(other);
      }
    })().catch((error) => {
      console.error('[owner-tools] grant skin failed:', error.message);
      send(client, 'adminToolsStatus', { ok: false, message: 'Could not grant that skin.' });
    });
    return;
  }

  if (type === 'saveSettings') {
    // Guests have nowhere to save to: their settings stay in this browser.
    if (!client.accountId || client.guest || !db.isEnabled()) return;
    const settings = data && typeof data.settings === 'object' && !Array.isArray(data.settings)
      ? data.settings
      : null;
    if (!settings) return;
    db.saveAccountSettings(client.accountId, settings)
      .catch(error => console.error('[settings] save failed:', error.message));
    return;
  }

  if (type === 'getStats') {
    handleGetStats(client, data);
    return;
  }

  if (type === 'getDailyChallengeProgress') {
    sendDailyChallengeProgress(client);
    return;
  }


  if (type === 'getLeaderboards') {
    handleGetLeaderboards(client);
    return;
  }

  if (type === 'getSkinInventory') {
    sendSkinInventory(client);
    return;
  }

  if (type === 'getTradeUpState') {
    sendTradeUpState(client);
    return;
  }

  if (type === 'markTradeUpTutorialSeen') {
    handleTradeUpTutorialSeen(client);
    return;
  }

  if (type === 'completeTradeUp') {
    handleCompleteTradeUp(client, data);
    return;
  }

  // Skin economy/menu packets live in the lobby but still stay server-owned:
  // the client can request catalog views/actions, while db.js validates account
  // ownership, balances, listing state, and custom case persistence.
  if (type === 'getCaseEditor') {
    if (isAdminUser(client)) sendCaseEditorData(client, { force: true });
    return;
  }

  if (type === 'saveCaseDefinition') {
    if (isAdminUser(client)) handleSaveCaseDefinition(client, data);
    return;
  }

  if (type === 'deleteCaseDefinition') {
    if (isAdminUser(client)) handleDeleteCaseDefinition(client, data);
    return;
  }

  if (type === 'getDailyChallengeEditor') {
    if (isAdminUser(client)) sendDailyChallengeEditorData(client).catch(error => {
      console.error('[daily-challenge-editor]', error.message);
      send(client, 'dailyChallengeEditorNotice', { ok: false, message: 'Could not load challenges.' });
    });
    return;
  }

  if (type === 'saveDailyChallengeTemplate') {
    if (isAdminUser(client)) handleSaveDailyChallengeTemplate(client, data);
    return;
  }

  if (type === 'deleteDailyChallengeTemplate') {
    if (isAdminUser(client)) handleDeleteDailyChallengeTemplate(client, data).catch(error => {
      console.error('[daily-challenge-editor]', error.message);
      send(client, 'dailyChallengeEditorNotice', { ok: false, message: 'Could not delete that challenge.' });
    });
    return;
  }

  if (type === 'openCaseTest') {
    if (isAdminUser(client)) handleOpenCaseTest(client, data);
    return;
  }

  if (type === 'openCase') {
    handleOpenCase(client, data);
    return;
  }

  if (type === 'buyCase') {
    handleBuyCasePurchase(client, data);
    return;
  }

  if (type === 'marketList') {
    handleMarketList(client, data);
    return;
  }

  if (type === 'marketCreateListing') {
    handleMarketCreateListing(client, data);
    return;
  }

  if (type === 'marketBuyListing') {
    handleMarketBuyListing(client, data);
    return;
  }

  if (type === 'marketPlaceBid') {
    handleMarketPlaceBid(client, data);
    return;
  }

  if (type === 'marketCancelListing') {
    handleMarketCancelListing(client, data);
    return;
  }

  if (type === 'marketAdminSetPrice') {
    handleMarketAdminSetPrice(client, data);
    return;
  }

  if (type === 'mapVote') {
    handleRoomMapVote(client, data);
    return;
  }

  if (type === 'marketCreateCaseListing') {
    handleMarketCreateCaseListing(client, data);
    return;
  }

  if (type === 'marketBuyCaseListing') {
    handleMarketBuyCaseListing(client, data);
    return;
  }

  if (type === 'marketCancelCaseListing') {
    handleMarketCancelCaseListing(client, data);
    return;
  }

  if (type === 'tradeRequestCreate') {
    handleTradeRequestCreate(client, data);
    return;
  }

  if (type === 'tradeRespond') {
    handleTradeRespond(client, data);
    return;
  }

  if (type === 'getFriends') {
    sendFriendsData(client);
    return;
  }

  if (type === 'getFriendInventory') {
    sendFriendInventory(client, data);
    return;
  }

  if (type === 'getRecentPlayers') {
    sendRecentPlayersData(client);
    return;
  }

  if (type === 'friendRequest') {
    handleFriendRequest(client, data);
    return;
  }

  if (type === 'friendRespond') {
    handleFriendRespond(client, data);
    return;
  }

  if (type === 'friendRemove') {
    handleFriendRemove(client, data);
    return;
  }

  if (type === 'getParty') {
    sendPartyData(client);
    return;
  }

  if (type === 'partyInvite') {
    handlePartyInvite(client, data);
    return;
  }

  if (type === 'partyRespond') {
    handlePartyRespond(client, data);
    return;
  }

  if (type === 'partyLeave') {
    handlePartyLeave(client);
    return;
  }

  if (type === 'partyKick') {
    handlePartyKick(client, data);
    return;
  }

  if (type === 'getNews') {
    handleGetNews(client);
    return;
  }

  if (type === 'postNews') {
    if (!isAdminUser(client)) return;
    handlePostNews(client, data);
    return;
  }

  if (type === 'deleteNews') {
    if (!isAdminUser(client)) return;
    handleDeleteNews(client, data);
    return;
  }

  if (type === 'equipSkin') {
    handleEquipSkin(client, data);
    return;
  }

  if (type === 'ownerAdminList') {
    if (!isOwnerAdminUser(client)) return;
    send(client, 'ownerAdminData', buildOwnerAdminPayload());
    return;
  }

  if (type === 'ownerAdminBan') {
    if (!isOwnerAdminUser(client)) return;
    handleOwnerAdminBan(client, data);
    return;
  }

  if (type === 'ownerAdminDeleteRoom') {
    if (!isOwnerAdminUser(client)) return;
    handleOwnerAdminDeleteRoom(client, data);
    return;
  }

  if (type === 'adminBanList') {
    if (!isAdminUser(client)) return;
    buildAdminBanPayload().then(payload => send(client, 'adminBanData', payload)).catch(() => {});
    return;
  }

  if (type === 'adminBanPlayer') {
    if (!isAdminUser(client)) return;
    handleAdminBanPlayer(client, data);
    return;
  }

  if (type === 'adminUnbanPlayer') {
    if (!isAdminUser(client)) return;
    handleAdminUnbanPlayer(client, data);
    return;
  }

  if (type === 'adminResetAllXp') {
    if (!isAdminUser(client) || !db.isEnabled()) return;
    db.resetAllXp()
      .then(count => send(client, 'adminBanNotice', { ok: true, message: `XP reset for ${count} account${count === 1 ? '' : 's'}.` }))
      .catch(error => {
        console.error('[admin-reset-all-xp]', error.message);
        send(client, 'adminBanNotice', { ok: false, message: 'XP reset failed.' });
      });
    return;
  }

  if (type === 'adminClearPlayerInventory') {
    if (!isAdminUser(client)) return;
    handleAdminClearPlayerInventory(client, data);
    return;
  }

  // Per-item inventory editing. Every one of these is gated here and re-checked
  // for nothing else: the handlers assume an admin, so the gate must stay on
  // this side of the call.
  if (type === 'adminInventoryLookup') {
    if (!isAdminUser(client)) return;
    handleAdminInventoryLookup(client, data);
    return;
  }
  if (type === 'adminInventoryEdit') {
    if (!isAdminUser(client)) return;
    handleAdminInventoryEdit(client, data);
    return;
  }

  if (type === 'leaveRoom') {
    client.roomCreationPending = null;
    const requestId = typeof data.requestId === 'string' ? data.requestId.slice(0, 80) : null;
    const roomCode = client.roomCode || null;
    if (roomCode) removePlayerFromRoom(client.id, 'left', { notifySelf: true, requestId });
    else send(client, 'roomRemoved', { reason: 'left', roomCode, requestId });
    return;
  }

  if (type === 'createRoom') {
    // Room privacy is part of settings, not an access-control list. Public room
    // browsing filters private rooms out, while direct room-code joins still work.
    if (rooms.size >= antiflood.CFG.MAX_ROOMS) {
      send(client, 'roomError', { message: 'Server is at capacity. Try again later.' });
      return;
    }
    client.name = client.accountName || sanitizeName(data.name, client.name);
    // The host picks the map alongside the mode. sanitizeRoomSettings drops
    // anything outside VALID_MAP_IDS and falls back to Dust2, and it is also what
    // forces full-map scope for the maps that require it.
    const settings = sanitizeRoomSettings({ gamemode: data.gamemode, mapId: data.mapId, private: !!data.private });
    if (crossServerRoomDirectoryEnabled()) {
      createCrossServerRoom(client, settings);
    } else {
      joinRoom(client, createRoomCode(), { settings });
    }
    return;
  }

  if (type === 'listRooms') {
    send(client, 'roomList', getRoomList());
    return;
  }

  if (type === 'joinRoom') {
    client.roomCreationPending = null;
    const roomCode = String(data.roomCode || '').trim().toUpperCase();
    let room = rooms.get(roomCode);
    client.name = client.accountName || sanitizeName(data.name, client.name);

    // The admin testing room is allow-list only.
    if (roomCode === ADMIN_ROOM_CODE && !isAdminUser(client)) {
      send(client, 'roomError', { message: 'Only admins can join the admin room.' });
      return;
    }

    if (!room) {
      // The admin testing room is always joinable by its (allow-listed) admins —
      // create it on the first join instead of reporting "not found".
      if (roomCode === ADMIN_ROOM_CODE) {
        joinRoom(client, ADMIN_ROOM_CODE, { settings: sanitizeRoomSettings({ gamemode: 'deathmatch' }) });
        return;
      }
      if (roomCode === BACKROOMS_ROOM_CODE) {
        if (rooms.size >= antiflood.CFG.MAX_ROOMS) {
          send(client, 'roomError', { message: 'Server is at capacity. Try again later.' });
          return;
        }
        joinRoom(client, BACKROOMS_ROOM_CODE, {
          settings: sanitizeRoomSettings({ gamemode: 'deathmatch', mapId: MAP_BACKROOMS, fullMap: true })
        });
        return;
      }
      routeRemoteRoomJoin(client, roomCode);
      return;
    }
    if (roomCode === BACKROOMS_ROOM_CODE) {
      room.settings = sanitizeRoomSettings({ ...room.settings, mapId: MAP_BACKROOMS, fullMap: true }, room.settings);
    }
    if (client.accountId && room.banned.has(client.accountId)) {
      send(client, 'roomError', { message: 'You are banned from this room.' });
      return;
    }

    // Rejoin: a reconnecting socket presents the token from its previous roomJoined
    // to reclaim its stashed score/team within REJOIN_TTL_MS.
    const rejoinToken = typeof data.rejoinToken === 'string' && data.rejoinToken.length <= 64 ? data.rejoinToken : null;
    let rejoinStash = null;
    if (rejoinToken && room.pendingRejoins?.has(rejoinToken)) {
      rejoinStash = room.pendingRejoins.get(rejoinToken);
      room.pendingRejoins.delete(rejoinToken);
    } else if (rejoinToken) {
      // Half-open ghost: old socket hasn't closed yet, the player is still "in" the room.
      for (const pid of room.players.keys()) {
        const pc = clients.get(pid);
        if (pc && pc !== client && pc.rejoinToken === rejoinToken) {
          stashRejoinState(pc);                                         // 1. harvest live state into pendingRejoins
          pc.rejoinToken = null;                                        // 2. its close event must not re-stash
          removePlayerFromRoom(pid, 'replaced', { notifySelf: false }); // 3. room survives even if now empty (stash present)
          try { pc.ws.terminate(); } catch {}                           // 4. kill the zombie socket
          rejoinStash = room.pendingRejoins.get(rejoinToken) || null;   // 5. consume the stash
          room.pendingRejoins.delete(rejoinToken);
          break;
        }
      }
    }
    if (rejoinStash && rejoinStash.accountId && rejoinStash.accountId !== client.accountId) rejoinStash = null; // account-bound

    // A rejoiner owns its old seat + name, so it skips the full/name-taken checks.
    if (!rejoinStash) {
      const maxPlayers = maxPlayersForRoom(room);
      if (room.players.size >= maxPlayers) {
        send(client, 'roomError', { message: 'This room is full.' });
        return;
      }
      if (isNameTaken(room, client.name, client.id)) {
        send(client, 'roomError', { message: 'That username is already in this room.' });
        return;
      }
    }
    joinRoom(client, roomCode, { rejoin: rejoinStash });
    return;
  }

  const room = rooms.get(client.roomCode);
  const player = room?.players.get(client.id);
  if (!room || !player) return;

  if (type === 'chatMessage') {
    // Guests may talk. What holds the line is not the account requirement that
    // used to be here:
    //   - antiflood caps chatMessage at 2/sec with a burst of 5, per connection;
    //   - sanitizeChatMessage bounds the content;
    //   - logChat already records a null account_id alongside the name, IP and
    //     room, so a guest message is still attributable;
    //   - a guest who abuses it is bannable by device, the same lever anti-cheat
    //     already uses on them - see banGuestDeviceForViolation.
    // GUEST_CHAT=0 turns it off again without a redeploy, which matters because
    // this is the one setting most likely to need reversing in a hurry.
    if (client.guest && !GUEST_CHAT_ENABLED) {
      send(client, 'chatDenied', { message: 'Guests can read chat, but cannot send messages.' });
      return;
    }
    const message = sanitizeChatMessage(data.message);
    if (!message) return;
    player.activeAt = Date.now();
    logChat(client, player, message);
    const mode = (MODE_CONFIG[room.settings.gamemode]?.casual && data.mode === 'team') ? 'team' : 'all';
    const payload = {
      fromId: client.id,
      fromName: player.name,
      fromTeam: player.team,
      mode,
      message,
      sentAt: Date.now()
    };
    if (mode === 'team') broadcastToTeam(client.roomCode, player.team, null, 'chatMessage', payload);
    else broadcastToRoom(client.roomCode, null, 'chatMessage', payload);
    return;
  }

  if (room.roundTransitionUntil && Date.now() < room.roundTransitionUntil) {
    const transitionBuy = type === 'buyUtility' || type === 'buyWeapon' || type === 'refundPurchase';
    if (ROUND_LOCKED_MESSAGES.has(type) || (transitionBuy && !isCasualMode(room))) return;
  }

  if (type === 'playerState') { if (!player.waitingForNextRound) handlePlayerState(client, room, player, data); return; }
  if (type === 'playerShoot') { if (!player.waitingForNextRound) handlePlayerShoot(client, room, player, data); return; }
  if (type === 'playerHit') { if (!player.waitingForNextRound) handlePlayerHit(client, room, player, data); return; }
  // Containment's enemy damage. Gated on the mode so it is inert in every PvP
  // room, and validated inside the handler exactly like playerHit.
  if (type === 'containmentHit') { if (isContainment(room)) handleContainmentHit(client, room, player, data); return; }
  if (type === 'containmentBuyWeapon') { if (isContainment(room)) handleContainmentBuyWeapon(client, room, player, data); return; }
  if (type === 'containmentOpenGate') { if (isContainment(room)) handleContainmentOpenGate(client, room, player, data); return; }
  if (type === 'containmentSkipPreparation') { if (isContainment(room)) handleContainmentSkipPreparation(client, room, player); return; }
  if (type === 'containmentAdminPause') { if (isContainment(room)) handleContainmentAdminPause(client, room, data); return; }
  if (type === 'glassBreak') { if (!player.waitingForNextRound) handleGlassBreak(client, room, player, data); return; }
  if (type === 'ventBreak') { if (!player.waitingForNextRound) handleVentBreak(client, room, player, data); return; }
  if (type === 'doorToggle') { if (!player.waitingForNextRound) handleDoorToggle(client, room, player, data); return; }

  if (type === 'refundPurchase') {
    handleRefundPurchase(client, room, player, data);
    return;
  }

  if (type === 'throwGrenade') {
    if (player.waitingForNextRound) return;
    if (!usesUtility(room)) return;
    if ((player.health || 0) <= 0) return;
    player.activeAt = Date.now();
    lockBuyRefunds(player);
    clearSpawnProtection(player, Date.now(), client, 'throw');
    broadcastToRoom(client.roomCode, client.id, 'grenadeThrown', {
      id: String(data.id || '').slice(0, 16),
      kind: sanitizeGrenadeKind(data.kind),
      ownerId: client.id,
      ownerTeam: player.team,
      start: sanitizeVector(data.start, null),
      velocity: sanitizeVector(data.velocity, null)
    });
    return;
  }

  if (type === 'grenadeBurst') {
    if (player.waitingForNextRound) return;
    if (!usesUtility(room)) return;
    if ((player.health || 0) <= 0) return;
    const burstAt = Date.now();
    player.activeAt = burstAt;
    lockBuyRefunds(player);
    // A valid throw normally clears protection immediately. The burst is a
    // second authoritative utility action and safely covers any stale client.
    clearSpawnProtection(player, burstAt, client, 'utility');
    const kind = sanitizeGrenadeKind(data.kind);
    const position = sanitizeVector(data.position, null);
    // Record damaging utility bursts so damage can be server-validated against them.
    if (kind === 'frag' && position) damageBarricadesFromFrag(client.roomCode, room, position, client.id);
    if ((kind === 'frag' || kind === 'molotov') && position) {
      if (!room.recentBursts) room.recentBursts = [];
      room.recentBursts.push({ ts: Date.now(), ownerId: client.id, kind, position });
      if (room.recentBursts.length > 24) room.recentBursts.shift();
    }
    if (kind === 'flash' && position) {
      if (!room.recentFlashBursts) room.recentFlashBursts = [];
      const now = Date.now();
      room.recentFlashBursts = room.recentFlashBursts.filter(burst => now - burst.ts <= GRENADE_HIT_WINDOW_MS);
      room.recentFlashBursts.push({ ts: now, ownerId: client.id, position });
      if (room.recentFlashBursts.length > 24) room.recentFlashBursts.shift();
    }
    if (kind === 'smoke' && position) {
      extinguishActiveFiresAt(room, position, GRENADE.smoke.radius * 1.15);
      if (!room.activeSmokes) room.activeSmokes = [];
      const now = Date.now();
      room.activeSmokes = room.activeSmokes.filter(smoke => smoke.expiresAt > now);
      const duplicate = room.activeSmokes.some(smoke => distanceBetweenVectors(smoke.position, position) <= GRENADE.smoke.radius * 0.55);
      if (!duplicate) room.activeSmokes.push({
        ownerId: client.id,
        position,
        expiresAt: now + Number(GRENADE.smoke.durationMs || 18000)
      });
      if (room.activeSmokes.length > 16) room.activeSmokes.shift();
    }
    if (kind === 'molotov' && position) {
      if (!room.activeFires) room.activeFires = [];
      const now = Date.now();
      room.activeFires = room.activeFires.filter(f => f.expiresAt > now);
      const duplicate = room.activeFires.some(f => distanceBetweenVectors(f.position, position) <= GRENADE.molotov.radius * 0.65);
      if (!duplicate) room.activeFires.push({ ts: now, expiresAt: now + GRENADE.molotov.durationMs, ownerId: client.id, position, damagedAtByTarget: {} });
      if (room.activeFires.length > 16) room.activeFires.shift();
    }
    broadcastToRoom(client.roomCode, client.id, 'grenadeBurst', { id: String(data.id || '').slice(0, 16), kind, position });
    return;
  }

  if (type === 'deployBarricade') {
    if (player.waitingForNextRound) return;
    if (!usesUtility(room)) return;
    if ((player.health || 0) <= 0 || player.respawningUntil) return;
    const now = Date.now();
    player.activeAt = now;
    const deny = (message) => send(client, 'barricadeDenied', { message });
    const position = sanitizeVector(data.position, null);
    if (!position) { deny('Aim at flat ground in front of you.'); return; }
    const infiniteUtility = isAdminRoom(room) && room.adminConfig?.infiniteUtility === true;
    if (!player.utilityPurchasedThisLife) resetUtilityLife(player);
    if (!infiniteUtility && (player.barricadesDeployedThisLife || 0) >= barricadeAllowance(room, player)) {
      deny('You have no barricade to deploy.');
      return;
    }
    // Placement is re-derived here rather than trusted: the client picks the
    // spot, the server checks it is a spot the player could actually reach.
    const reach = Math.hypot(position.x - player.position.x, position.z - player.position.z);
    if (reach > BARRICADE.deployRange + 6 || reach < BARRICADE.minRange - 3) {
      deny('That is too far to place a barricade.');
      return;
    }
    if (Math.abs(Number(position.y) - (Number(player.position.y) - 18)) > 40) {
      deny('Aim at flat ground in front of you.');
      return;
    }
    const barricades = ensureRoomBarricades(room);
    if (barricades.size >= BARRICADE.maxPerRoom) { deny('Too many barricades are already deployed.'); return; }
    for (const existing of barricades.values()) {
      if (Math.hypot(existing.x - position.x, existing.z - position.z) < BARRICADE.spacing) {
        deny('That is too close to another barricade.');
        return;
      }
    }
    lockBuyRefunds(player);
    clearSpawnProtection(player, now, client, 'utility');
    room.barricadeSeq = (room.barricadeSeq || 0) + 1;
    const barricade = {
      id: `bc${room.barricadeSeq}`,
      ownerId: client.id,
      ownerTeam: player.team,
      x: Number(position.x),
      y: Number(position.y),
      z: Number(position.z),
      yaw: Number.isFinite(Number(data.yaw)) ? Number(data.yaw) : 0,
      health: BARRICADE.health,
      maxHealth: BARRICADE.health,
      placedAt: now
    };
    barricades.set(barricade.id, barricade);
    if (!infiniteUtility) player.barricadesDeployedThisLife = (player.barricadesDeployedThisLife || 0) + 1;
    broadcastToRoom(client.roomCode, null, 'barricadePlaced', publicBarricade(barricade));
    return;
  }

  if (type === 'barricadeDamage') {
    if (player.waitingForNextRound) return;
    if (!usesUtility(room)) return;
    if ((player.health || 0) <= 0 || player.respawningUntil) return;
    const now = Date.now();
    player.activeAt = now;
    const barricade = room.barricades?.get(String(data.id || '').slice(0, 32));
    if (!barricade || barricade.health <= 0) return;
    const weapon = sanitizeWeaponName(data.weapon) || player.weapon;
    const wdef = WEAPONS[weapon];
    if (!wdef || wdef.type === 'utility') return;
    const melee = wdef.type === 'melee';
    const centre = { x: barricade.x, y: barricade.y + BARRICADE.height / 2, z: barricade.z };
    if (distanceBetweenVectors(player.position, centre) > (melee ? AC.MELEE_RANGE : AC.GUN_RANGE)) return;
    // Its own token bucket: shooting cover must not spend the budget that keeps
    // player damage honest, and vice versa.
    if (!damageRateOk(player.ac, weapon, wdef, now, 'barricadeBucket')) return;
    const damage = melee ? 45 : Math.max(1, Math.round(wdef.dmg.body * BARRICADE.bulletScale));
    applyBarricadeDamage(client.roomCode, room, barricade, damage, client.id);
    return;
  }

  if (type === 'deployC4') {
    if (player.waitingForNextRound) return;
    if (!usesUtility(room)) return;
    if ((player.health || 0) <= 0 || player.respawningUntil) return;
    const now = Date.now();
    player.activeAt = now;
    const deny = (message) => send(client, 'c4Denied', { message });
    const position = sanitizeVector(data.position, null);
    if (!position) { deny('Aim at flat ground in front of you.'); return; }
    const infiniteUtility = isAdminRoom(room) && room.adminConfig?.infiniteUtility === true;
    if (!player.utilityPurchasedThisLife) resetUtilityLife(player);
    if (!infiniteUtility && (player.c4DeployedThisLife || 0) >= c4Allowance(room, player)) {
      deny('You have no charge to plant.');
      return;
    }
    const reach = Math.hypot(position.x - player.position.x, position.z - player.position.z);
    if (reach > C4.deployRange + 6 || reach < C4.minRange - 3) {
      deny('That is too far to plant a charge.');
      return;
    }
    if (Math.abs(Number(position.y) - (Number(player.position.y) - 18)) > 40) {
      deny('Aim at flat ground in front of you.');
      return;
    }
    const charges = ensureRoomC4Charges(room);
    if (charges.size >= C4.maxPerRoom) { deny('Too many charges are already planted.'); return; }
    for (const existing of charges.values()) {
      if (Math.hypot(existing.x - position.x, existing.z - position.z) < C4.spacing) {
        deny('That is too close to another charge.');
        return;
      }
    }
    lockBuyRefunds(player);
    clearSpawnProtection(player, now, client, 'utility');
    room.c4Seq = (room.c4Seq || 0) + 1;
    const charge = {
      id: `c4_${room.c4Seq}`,
      ownerId: client.id,
      ownerTeam: player.team,
      x: Number(position.x),
      y: Number(position.y),
      z: Number(position.z),
      yaw: Number.isFinite(Number(data.yaw)) ? Number(data.yaw) : 0,
      placedAt: now,
      // The arming delay is the whole point of the gadget: it is a planted
      // charge, not a grenade that happens to be triggered by hand.
      armsAt: now + C4.armDelayMs,
      health: C4.health,
      maxHealth: C4.health
    };
    charges.set(charge.id, charge);
    if (!infiniteUtility) player.c4DeployedThisLife = (player.c4DeployedThisLife || 0) + 1;
    broadcastToRoom(client.roomCode, null, 'c4Placed', publicC4Charge(charge));
    return;
  }

  if (type === 'detonateC4') {
    if (player.waitingForNextRound) return;
    if (!usesUtility(room)) return;
    if ((player.health || 0) <= 0 || player.respawningUntil) return;
    const now = Date.now();
    player.activeAt = now;
    const mine = Array.from(room.c4Charges?.values?.() || []).filter(charge => charge.ownerId === client.id);
    if (!mine.length) return;
    const armed = mine.filter(charge => now >= charge.armsAt);
    if (!armed.length) {
      send(client, 'c4Denied', { message: 'The charge is still arming.' });
      return;
    }
    lockBuyRefunds(player);
    clearSpawnProtection(player, now, client, 'utility');
    for (const charge of armed) detonateC4Charge(client.roomCode, room, charge, now);
    return;
  }

  if (type === 'c4Damage') {
    if (player.waitingForNextRound) return;
    if (!usesUtility(room)) return;
    if ((player.health || 0) <= 0 || player.respawningUntil) return;
    const now = Date.now();
    player.activeAt = now;
    const charge = room.c4Charges?.get(String(data.id || '').slice(0, 32));
    if (!charge || charge.health <= 0) return;
    const weapon = sanitizeWeaponName(data.weapon) || player.weapon;
    const wdef = WEAPONS[weapon];
    if (!wdef || wdef.type === 'utility') return;
    const melee = wdef.type === 'melee';
    const centre = { x: charge.x, y: charge.y + C4.height / 2, z: charge.z };
    if (distanceBetweenVectors(player.position, centre) > (melee ? AC.MELEE_RANGE : AC.GUN_RANGE)) return;
    if (!damageRateOk(player.ac, weapon, wdef, now, 'barricadeBucket')) return;
    charge.health = Math.max(0, charge.health - (melee ? 45 : Math.max(1, Math.round(wdef.dmg.body))));
    if (charge.health > 0) {
      broadcastToRoom(client.roomCode, null, 'c4Health', { id: charge.id, health: charge.health, byId: client.id });
      return;
    }
    // A shot-out charge is defused, not set off: destroying it must never hand
    // the shooter a free explosion where the planter wanted one.
    room.c4Charges.delete(charge.id);
    broadcastToRoom(client.roomCode, null, 'c4Removed', { id: charge.id, reason: 'destroyed', byId: client.id });
    return;
  }

  if (type === 'flashHit') {
    if (player.waitingForNextRound) return;
    if (!usesUtility(room)) return;
    const now = Date.now();
    player.activeAt = now;
    const targetId = String(data.targetId || '');
    const position = sanitizeVector(data.position, null);
    const target = room.players.get(targetId);
    if (!target || !position) return;
    const matchingBurst = (room.recentFlashBursts || []).some(burst =>
      now - burst.ts <= GRENADE_HIT_WINDOW_MS &&
      burst.ownerId === client.id &&
      distanceBetweenVectors(burst.position, position) <= GRENADE_RADIUS_SLACK
    );
    if (!matchingBurst) return;
    if (target.invulnerableUntil && target.invulnerableUntil > now) return;
    // The client evaluates LOS against the rendered map. Dust2's server collision
    // mesh uses source-map coordinates and produced false walls after map scaling.
    target.flashedUntil = Math.max(target.flashedUntil || 0, now + 4200);
    target.flashedById = client.id;
    const targetClient = clients.get(targetId);
    if (targetClient) send(targetClient, 'playerFlashed', { position, fromId: client.id });
    return;
  }

  if (type === 'buyUtility') {
    if (player.waitingForNextRound) return;
    if (!usesUtility(room)) return;
    player.activeAt = Date.now();
    const kind = sanitizeUtilityKind(data.kind);
    if (!kind) return;
    if (isGrenadeDisabledByAdmin(room, kind)) {
      send(client, 'utilityDenied', { kind, money: player.money, message: 'That utility is disabled.' });
      return;
    }
    const price = roomUtilityPrice(room, kind);
    const casual = isCasualMode(room);
    if (!player.utilityPurchasedThisLife) resetUtilityLife(player);
    const lifeCap = utilityLifeCap(kind);
    if ((player.utilityPurchasedThisLife[kind] || 0) >= lifeCap) {
      send(client, 'utilityDenied', {
        kind,
        money: player.money,
        utilityPurchasedThisLife: player.utilityPurchasedThisLife,
        message: `You can only buy ${lifeCap} ${kind} per life.`
      });
      return;
    }
    if (casual && !canPlayerBuy(room, player)) {
      send(client, 'utilityDenied', { kind, money: player.money, utilityPurchasedThisLife: player.utilityPurchasedThisLife, message: buyDeniedMessage(room, player) });
      return;
    }
    if (!Number.isFinite(price) || (casual && !isCasualWarmup(room) && player.money < price)) {
      send(client, 'utilityDenied', { kind, money: player.money, utilityPurchasedThisLife: player.utilityPurchasedThisLife, message: 'Not enough money for that utility.' });
      return;
    }
    let purchase = null;
    if (casual && !isCasualWarmup(room)) {
      addMoney(player, -price);
      purchase = recordBuyPurchase(player, { type: 'utility', kind, price });
    }
    player.utilityPurchasedThisLife[kind] = (player.utilityPurchasedThisLife[kind] || 0) + 1;
    player.dirty = true;
    send(client, 'utilityGranted', { kind, money: player.money, utilityPurchasedThisLife: player.utilityPurchasedThisLife, purchaseId: purchase?.id || null });
    return;
  }

  if (type === 'buyWeapon') {
    if (player.waitingForNextRound) return;
    if (!isBuyMode(room)) return;
    player.activeAt = Date.now();
    const weapon = sanitizeWeaponName(data.weapon);
    const slot = String(data.slot || '').slice(0, 16);
    if (!isWeaponAvailableInMode(room, weapon)) {
      send(client, 'weaponDenied', { weapon, slot, money: player.money, message: 'That weapon is only available in Casual.' });
      return;
    }
    const price = roomWeaponPrice(room, weapon);
    const casual = isCasualMode(room);
    if (casual && !canPlayerBuy(room, player)) {
      send(client, 'weaponDenied', { weapon, slot, money: player.money, message: buyDeniedMessage(room, player) });
      return;
    }
    if (!weapon || price === undefined || (casual && !isCasualWarmup(room) && player.money < price)) {
      send(client, 'weaponDenied', { weapon, slot, money: player.money, message: 'Not enough money for that weapon.' });
      return;
    }
    let purchase = null;
    const previousWeapon = player.weapon;
    if (casual && !isCasualWarmup(room)) {
      addMoney(player, -price);
      purchase = recordBuyPurchase(player, { type: 'weapon', slot, weapon, previousWeapon, price });
    }
    player.weapon = weapon;
    player.dirty = true;
    send(client, 'weaponPurchased', { weapon, slot, money: player.money, purchaseId: purchase?.id || null });
    return;
  }

  if (type === 'dropItem') {
    handleDropItem(client, room, player, data);
    return;
  }

  if (type === 'bombAction') {
    handleBombAction(client, room, player, data);
    return;
  }

  if (type === 'useHealthshot') {
    if (!usesUtility(room)) return;
    if ((player.health || 0) <= 0 || player.respawningUntil) return;
    if ((player.health || 0) >= 100 || player.healthshotHealRemaining > 0 || (player.healthshots || 0) <= 0) {
      sendHealthshotState(client, player, { healing: player.healthshotHealRemaining > 0, denied: true });
      return;
    }
    player.healthshots -= 1;
    player.healthshotHealRemaining = 60;
    player.activeAt = Date.now();
    if (client.accountId && !client.healthshotUsed) {
      client.healthshotUsed = true;
      db.markHealthshotUsed(client.accountId).catch(error => console.error('[healthshot-used]', error.message));
    }
    sendHealthshotState(client, player, { healing: true });
    return;
  }

  if (type === 'playerHeal') {
    // Charges are consumed by useHealthshot before the visible injection begins.
    // Tick packets can only spend that already-authorised 60 HP allowance.
    if (!usesUtility(room)) return;
    if ((player.health || 0) <= 0 || player.respawningUntil || player.healthshotHealRemaining <= 0) return;
    const amount = clampNumber(data.amount, 0, 6);
    if (!amount) return;
    const heal = Math.min(amount, player.healthshotHealRemaining);
    player.healthshotHealRemaining -= heal;
    player.activeAt = Date.now();
    player.health = Math.min(100, player.health + heal);
    broadcastToRoom(client.roomCode, null, 'playerHealth', { id: client.id, health: player.health });
    if (player.healthshotHealRemaining <= 0 || player.health >= 100) {
      player.healthshotHealRemaining = 0;
      sendHealthshotState(client, player, { healing: false });
    }
    return;
  }

  if (type === 'selfDamage') {
    if (player.waitingForNextRound) return;
    const now = Date.now();
    if (player.invulnerableUntil && player.invulnerableUntil > now) return;
    const amount = clampNumber(data.amount, 0, 500);
    if (!amount) return;
    player.health = Math.max(0, player.health - amount);
    broadcastToRoom(client.roomCode, null, 'playerHealth', { id: client.id, health: player.health });
    if (player.health <= 0) {
      if (MODE_CONFIG[room.settings.gamemode]?.casual && !isCasualWarmup(room)) addScore(player, -50);
      respawnPlayer(client.roomCode, player, { reason: data.reason === 'molotov' ? 'molotov' : 'frag', skipStats: isCasualWarmup(room) });
      checkCasualElimination(client.roomCode, room);
    }
    return;
  }

  if (type === 'playerVoid') {
    if (player.waitingForNextRound) return;
    const now = Date.now();
    if (player.invulnerableUntil && player.invulnerableUntil > now) return;
    const reason = data.reason === 'frag' ? 'frag' : 'void';
    respawnPlayer(client.roomCode, player, { reason, skipStats: isCasualWarmup(room) });
    checkCasualElimination(client.roomCode, room);
    return;
  }

  if (type === 'useStim') {
    if (player.waitingForNextRound || (player.health || 0) <= 0) return;
    if (room.settings.gamemode !== 'deathmatch') return;
    if ((player.stimCharges || 0) <= 0) return;
    player.stimCharges -= 1;
    player.health = 100;
    player.dirty = true;
    send(client, 'stimUsed', { health: 100, stimCharges: player.stimCharges });
    broadcastToRoom(client.roomCode, null, 'playerHealth', {
      id: client.id,
      health: player.health,
      attackerId: client.id,
      attackerName: player.name,
      attackerPosition: player.position,
      damage: 0,
      lifecycle: player.lifecycle
    });
    return;
  }

  if (type === 'gunGameWin') {
    if (room.settings.gamemode !== 'gunGame') return;

    finishGunGameRound(client.roomCode, room, player);
    return;
  }

  if (type === 'hostSettings') {
    // Host-only live settings. A privacy flip must refresh every lobby browser
    // because this room may immediately appear/disappear from the public list.
    if (room.hostId !== client.id) return;
    const settingsPatch = data.settings || data;
    const wasPrivate = !!room.settings.private;
    room.settings = sanitizeRoomSettings({
      ...room.settings,
      fullMap: settingsPatch.fullMap ?? room.settings.fullMap,
      private: settingsPatch.private ?? room.settings.private,
      nextGamemode: settingsPatch.nextGamemode ?? room.settings.nextGamemode
    }, room.settings);
    broadcastToRoom(client.roomCode, null, 'roomSettings', room.settings);
    broadcastRoomState(client.roomCode);
    if (wasPrivate !== room.settings.private) broadcastRoomList();
    return;
  }

  if (type === 'adminForceRoomSettings') {
    handleAdminForceRoomSettings(client, room, data);
    return;
  }

  if (type === 'adminConfig') {
    // Any admin in the admin room may edit it — no host restriction.
    if (client.roomCode !== ADMIN_ROOM_CODE || !isAdminUser(client)) return;
    const patch = data.settings || data;
    applyAdminConfigPatch(client.roomCode, room, patch);
    // Map switch: change the map, respawn everyone on it, and tell clients to reload.
    if (typeof patch.mapId === 'string' && VALID_MAP_IDS.has(patch.mapId) && patch.mapId !== room.settings.mapId) {
      adminSwitchMap(client.roomCode, room, patch.mapId);
    } else {
      broadcastToRoom(client.roomCode, null, 'roomSettings', room.settings);
    }
    broadcastToRoom(client.roomCode, null, 'adminConfig', room.adminConfig);
    broadcastRoomState(client.roomCode);
    return;
  }

  if (type === 'adminSummonDummy') {
    if (client.roomCode !== ADMIN_ROOM_CODE || !isAdminUser(client)) return;
    const position = sanitizeVector(data.position, player.position);
    if (!position) return;
    if (!room.adminDummies) room.adminDummies = new Map();
    while (room.adminDummies.size >= ADMIN_DUMMY_MAX) {
      const oldest = room.adminDummies.keys().next().value;
      room.adminDummies.delete(oldest);
      broadcastToRoom(client.roomCode, null, 'adminDummyHit', { id: oldest, health: 0, destroyed: true });
    }
    const dummy = {
      id: `dummy:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
      position,
      yaw: Number.isFinite(Number(data.yaw)) ? Number(data.yaw) : 0,
      health: Math.max(1, Math.min(10000, Math.round(Number(data.health) || 100))),
      maxHealth: Math.max(1, Math.min(10000, Math.round(Number(data.health) || 100))),
      immune: !!data.immune,
      team: Number(data.team) === 1 ? 1 : 0
    };
    room.adminDummies.set(dummy.id, dummy);
    broadcastToRoom(client.roomCode, null, 'adminDummySpawned', dummy);
    return;
  }

  if (type === 'adminClearDummies') {
    if (client.roomCode !== ADMIN_ROOM_CODE || !isAdminUser(client)) return;
    if (room.adminDummies) room.adminDummies.clear();
    broadcastToRoom(client.roomCode, null, 'adminDummiesCleared', {});
    return;
  }

  if (type === 'adminTool') {
    if (client.roomCode !== ADMIN_ROOM_CODE || !isAdminUser(client)) return;
    handleAdminTool(client, room, player, data);
    return;
  }

  if (type === 'adminDummyHit') {
    if (client.roomCode !== ADMIN_ROOM_CODE || !room.adminDummies) return;
    const id = String(data.id || '');
    const dummy = room.adminDummies.get(id);
    if (!dummy) return;
    if (dummy.immune) {
      broadcastToRoom(client.roomCode, null, 'adminDummyHit', { id, health: dummy.health, immune: true });
      return;
    }
    const damage = Math.max(1, Math.min(200, Number(data.damage) || 0));
    dummy.health = Math.max(0, Math.round((dummy.health || 100) - damage));
    const payload = { id, health: dummy.health };
    if (dummy.health <= 0) {
      room.adminDummies.delete(id);
      payload.destroyed = true;
    }
    broadcastToRoom(client.roomCode, null, 'adminDummyHit', payload);
    return;
  }

  if (type === 'kickPlayer' || type === 'banPlayer') {
    const targetId = String(data.targetId || '');
    if (room.hostId !== client.id || targetId === client.id || !room.players.has(targetId)) return;
    if (type === 'banPlayer') {
      const targetClient = clients.get(targetId);
      if (targetClient && targetClient.accountId) room.banned.add(targetClient.accountId);
    }
    removePlayerFromRoom(targetId, type === 'banPlayer' ? 'banned' : 'kicked');
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
async function handleAuth(client, type, data) {
  const conn = { ip: client.ip, subnet: client.subnet, powDifficulty: 0 };
  let result;
  try {
    if (type === 'authRegister') {
      conn.powDifficulty = antiflood.difficultyFor(client.ip, { alwaysOn: true });
      result = await auth.register(data, conn);
    } else if (type === 'authConfirmRegister') {
      result = await auth.confirmRegistration(data, conn);
    } else if (type === 'authLogin') {
      conn.powDifficulty = antiflood.difficultyFor(client.ip, { alwaysOn: false });
      result = await auth.login(data, conn);
    } else if (type === 'authHandoff') {
      result = await auth.handoff(data, conn, CROSS_SERVER_INSTANCE_ID);
    } else if (type === 'authGuest') {
      result = await auth.guest(data, conn);
    } else if (type === 'authConfirmPasswordReset') {
      result = await auth.confirmPasswordReset(data, conn);
    } else if (type === 'authChangeUsername') {
      if (!client.accountId || client.guest) {
        result = { ok: false, code: 'not_authed', message: 'Please log in to change your username.' };
      } else {
        result = await auth.changeUsername(client.accountId, data.username);
      }
    } else if (type === 'authChangePassword') {
      if (!client.accountId || client.guest) {
        result = { ok: false, code: 'not_authed', message: 'Please log in to change your password.' };
      } else {
        result = await auth.changePassword(client.accountId, data);
      }
    } else if (type === 'authGetRecoveryCode') {
      if (!client.accountId || client.guest) {
        result = { ok: false, code: 'not_authed', message: 'Please log in to view your recovery code.' };
      } else {
        result = await auth.getOwnRecoveryCode(client.accountId);
      }
    } else if (type === 'authAdminGetRecoveryCode') {
      if (!isAdminUser(client)) {
        result = { ok: false, code: 'not_authorized', message: 'Administrator access is required to view another account recovery code.' };
      } else {
        result = await auth.getAdminRecoveryCode(data);
      }
    } else if (type === 'authRequestEmailChange') {
      if (!client.accountId || client.guest) {
        result = { ok: false, code: 'not_authed', message: 'Please log in to change your email.' };
      } else {
        result = await auth.requestEmailChange(client.accountId, data, conn);
      }
    } else if (type === 'authConfirmEmailChange') {
      if (!client.accountId || client.guest) {
        result = { ok: false, code: 'not_authed', message: 'Please log in to change your email.' };
      } else {
        result = await auth.confirmEmailChange(client.accountId, data);
      }
    } else {
      result = await auth.resume(data, conn);
    }
  } catch (e) {
    console.error('[auth]', e.message);
    result = { ok: false, code: 'server_error', message: 'Server error, please try again.' };
  }

  if (!result.ok) {
    const payload = { code: result.code, message: result.message };
    if (result.reason) payload.reason = result.reason;
    if (result.expiresAt) payload.expiresAt = result.expiresAt;
    if (result.needPow || result.code === 'pow_failed') {
      const d = antiflood.difficultyFor(client.ip, { alwaysOn: true });
      const ch = antiflood.issueChallenge(client.ip, d);
      payload.nonce = ch.nonce;
      payload.difficulty = ch.difficulty;
      payload.needPow = d > 0;
    }
    send(client, 'authError', payload);
    return;
  }

  if (type === 'authChangeUsername') {
    applyUsernameChange(client, result.username);
    return;
  }

  if (result.pendingVerification || result.noticeOnly) {
    if (!client.authed) scheduleAuthTimeout(client, EMAIL_AUTH_GRACE_MS);
    send(client, 'authNotice', {
      ok: true,
      message: result.message || 'Check your email for the next step.',
      email: result.email || data.email || '',
      nextRecoveryCode: result.nextRecoveryCode || '',
      pendingVerification: !!result.pendingVerification
    });
    return;
  }

  if (result.accountNotice) {
    send(client, 'accountNotice', {
      ok: true,
      message: result.message || 'Account updated.',
      email: result.email || null,
      recoveryCode: result.recoveryCode || ''
    });
    return;
  }

  if (result.adminRecoveryNotice) {
    send(client, 'adminRecoveryNotice', {
      ok: true,
      message: result.message || 'Recovery code loaded.',
      username: result.username || '',
      recoveryCode: result.recoveryCode || ''
    });
    return;
  }

  bindAuthenticatedClient(client, result);
}

function applyUsernameChange(client, nextName) {
  client.accountName = nextName;
  client.name = nextName;
  const room = rooms.get(client.roomCode);
  const player = room?.players.get(client.id);
  if (player) {
    player.name = nextName;
    player.dirty = true;
    broadcastRoomState(client.roomCode);
  }
  send(client, 'usernameChanged', { username: nextName });
}

// The account's saved settings, sent just after the sign-in it belongs to.
// Deliberately a second message: reading them is a database round trip, and a
// slow or failed read must not hold up or break the login itself.
function sendAccountSettings(client, result) {
  if (!result?.accountId || result.guest || !db.isEnabled()) return;
  db.getAccountSettings(result.accountId)
    .then((settings) => {
      if (settings && client.socket && client.socket.readyState === 1) {
        send(client, 'accountSettings', { settings });
      }
    })
    .catch((error) => console.error('[settings] load failed:', error.message));
}

function bindAuthenticatedClient(client, result) {
  // Enforce one active session per account: kick any other live socket.
  if (result.accountId) {
    for (const c of clients.values()) {
      if (c !== client && c.accountId === result.accountId) {
        try { send(c, 'authError', { code: 'session_replaced', message: 'You logged in from another location.' }); c.ws.close(); } catch {}
      }
    }
  }

  const cap = antiflood.onAuthenticated(client.ip);
  if (!cap.ok) {
    send(client, 'authError', { code: 'too_many_sessions', message: 'Too many active sessions from your network.' });
    try { client.ws.close(); } catch {}
    return;
  }

  client.authed = true;
  client.accountId = result.accountId || null;
  client.accountName = result.username;
  client.accountRole = result.guest ? 'user' : accountRole({ accountRole: result.role });
  client.name = result.username;
  client.guest = !!result.guest;
  client.deviceId = result.deviceId;
  client.token = result.token || null;
  client.healthshotUsed = !!result.usedHealthshot;
  client.lastPlaytimeStamp = result.accountId ? Date.now() : 0;
  if (client.authTimer) { clearTimeout(client.authTimer); client.authTimer = null; }

  send(client, 'authOk', {
    accountId: result.accountId || null,
    username: result.username,
    token: result.token || '',
    deviceToken: result.deviceToken,
    stats: result.stats,
    guest: !!result.guest,
    usedHealthshot: !!result.usedHealthshot,
    isAdmin: isAdminUser(client),
    isOwnerAdmin: isOwnerAdminUser(client),
    skinCatalog: skins.publicCatalog(customCaseCache || []),
    uiConfig: publicUiConfig(),
    handoffRoomCode: result.handoffRoomCode || null
  });
  sendAccountSettings(client, result);
  sendSkinInventory(client);
  sendChallengeProgress(client);
  sendFriendsData(client);
  sendPartyData(client);
  refreshFriendPresence(client.accountId);
}

function safeCrossServerDestination(value) {
  const target = new URL(value);
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) throw new Error('unsafe_destination_url');
  return target;
}

// The directory is shared, so a row in it is only as trustworthy as every
// instance writing to it. Accept a socket address only if it is a WebSocket URL
// on the same host we would otherwise have redirected to.
function safeCrossServerSocket(value, redirectTarget) {
  const raw = String(value || '').trim();
  if (!raw || !redirectTarget) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return '';
    if (url.host !== redirectTarget.host) return '';
    if (url.search || url.hash) return '';
    return url.toString();
  } catch {
    return '';
  }
}

async function routeRemoteRoomJoin(client, roomCode) {
  if (!client?.accountId || client.guest || !db.isEnabled()) {
    send(client, 'roomError', { message: 'Room not found on this server. Log in to join a room hosted on the other server.' });
    return;
  }
  try {
    const remote = await db.findActiveRoom(roomCode);
    if (!remote || remote.instance_id === CROSS_SERVER_INSTANCE_ID) {
      send(client, 'roomError', { message: 'Room not found.' });
      return;
    }
    const target = safeCrossServerDestination(remote.public_url);
    const token = await db.createCrossServerHandoff({
      accountId: client.accountId,
      destinationInstance: remote.instance_id,
      roomCode
    });
    // Preferred: hand the client the socket that reaches that room so it can
    // play from the page it is already on. A room published before this column
    // existed has no socket to offer, so those still travel by redirect.
    const socketUrl = safeCrossServerSocket(remote.socket_url, target);
    if (socketUrl) {
      send(client, 'crossServerConnect', {
        socketUrl,
        handoff: token,
        roomCode,
        instanceId: remote.instance_id,
        returnUrl: `${PUBLIC_BASE_PATH || ''}/`
      });
      return;
    }
    target.searchParams.set('handoff', token);
    send(client, 'crossServerRedirect', { url: target.toString() });
  } catch (error) {
    console.error('[cross-room-route]', error.message);
    send(client, 'roomError', { message: 'Could not connect to the server hosting that room.' });
  }
}

function publishRoomDirectory(roomCode, room) {
  if (!db.isEnabled() || !CROSS_SERVER_PUBLIC_URL || !roomCode || !room || isAdminRoom(room)) return;
  db.publishActiveRoom({
    roomCode,
    instanceId: CROSS_SERVER_INSTANCE_ID,
    leaseId: room.directoryLeaseId,
    publicUrl: CROSS_SERVER_PUBLIC_URL,
    playerCount: room.players.size,
    privateRoom: !!room.settings?.private
  }).then((published) => {
    if (!published) closeRoomAfterDirectoryLeaseLoss(roomCode, room);
  }).catch(error => console.error('[room-directory-publish]', error.message));
}

function crossServerRoomDirectoryEnabled() {
  return db.isEnabled() && !!CROSS_SERVER_PUBLIC_URL;
}

function newRoomDirectoryLeaseId() {
  return crypto.randomBytes(16).toString('hex');
}

function removeRoomDirectory(roomCode, room) {
  if (!crossServerRoomDirectoryEnabled() || !roomCode || !room?.directoryLeaseId || isAdminRoom(room)) return;
  db.removeActiveRoom(roomCode, CROSS_SERVER_INSTANCE_ID, room.directoryLeaseId)
    .catch(error => console.error('[room-directory-remove]', error.message));
}

async function createCrossServerRoom(client, settings) {
  if (client.roomCreationPending) {
    send(client, 'roomError', { message: 'A room is already being created.' });
    return;
  }

  const attempt = {};
  const startingRoomCode = client.roomCode;
  const leaseId = newRoomDirectoryLeaseId();
  let roomCode = null;
  client.roomCreationPending = attempt;

  try {
    roomCode = await roomCodes.claimGlobalRoomCode({
      isLocallyTaken: code => rooms.has(code),
      claim: code => db.claimActiveRoom({
        roomCode: code,
        instanceId: CROSS_SERVER_INSTANCE_ID,
        leaseId,
        publicUrl: CROSS_SERVER_PUBLIC_URL,
        socketUrl: CROSS_SERVER_SOCKET_URL,
        privateRoom: !!settings.private
      })
    });

    // The DB round trip must not teleport a client that disconnected, joined
    // another room, or issued a newer navigation action while it was pending.
    if (clients.get(client.id) !== client || client.roomCreationPending !== attempt || client.roomCode !== startingRoomCode) {
      await db.removeActiveRoom(roomCode, CROSS_SERVER_INSTANCE_ID, leaseId);
      return;
    }
    if (rooms.size >= antiflood.CFG.MAX_ROOMS) {
      await db.removeActiveRoom(roomCode, CROSS_SERVER_INSTANCE_ID, leaseId);
      send(client, 'roomError', { message: 'Server is at capacity. Try again later.' });
      return;
    }

    joinRoom(client, roomCode, { settings, directoryLeaseId: leaseId });
    if (client.roomCode !== roomCode) {
      await db.removeActiveRoom(roomCode, CROSS_SERVER_INSTANCE_ID, leaseId);
      return;
    }
  } catch (error) {
    if (roomCode && !rooms.has(roomCode)) {
      try { await db.removeActiveRoom(roomCode, CROSS_SERVER_INSTANCE_ID, leaseId); } catch {}
    }
    console.error('[room-directory-claim]', error.message);
    if (clients.get(client.id) === client) {
      send(client, 'roomError', { message: 'Could not reserve a room code. Try again.' });
    }
  } finally {
    if (client.roomCreationPending === attempt) client.roomCreationPending = null;
  }
}

function closeRoomAfterDirectoryLeaseLoss(roomCode, room) {
  if (rooms.get(roomCode) !== room || !room.directoryLeaseId) return;
  console.error('[room-directory-lease-lost]', roomCode);
  for (const playerId of Array.from(room.players.keys())) {
    const playerClient = clients.get(playerId);
    if (playerClient) send(playerClient, 'roomError', { message: 'This room lost its cross-server reservation. Please create a new room.' });
    removePlayerFromRoom(playerId, 'directory_conflict');
  }
  clearRoomRoundTimer(room);
  clearRoomMapVote(room);
  rooms.delete(roomCode);
}

function handleLogout(client) {
  client.roomCreationPending = null;
  const accountId = client.accountId;
  const token = client.token;
  auth.logout(token);
  if (client.roomCode) removePlayerFromRoom(client.id, 'left');
  if (accountId) {
    removeFromParty(accountId);
    refreshFriendPresence(accountId);
  }
  // Flush stats while accountId is still set; keep `authed` true so the socket
  // close path (removeClient -> onDisconnect) releases the per-IP authed counter.
  flushClientStats(client);
  flushClientDailyStats(client);
  client.accountId = null;
  client.accountRole = 'user';
  client.token = null;
  send(client, 'authError', { code: 'logged_out', message: 'Logged out.' });
  try { client.ws.close(); } catch {}
}

async function getCustomCaseDefinitions({ force = false } = {}) {
  // Custom cases are shared catalog data, so cache briefly for normal menu reads.
  // Admin saves/deletes clear customCaseCache and force a fresh DB read.
  if (!db.isEnabled()) return customCaseCache || [];
  const now = Date.now();
  if (!force && customCaseCache && now - customCaseCacheLoadedAt < 30000) return customCaseCache;
  try {
    customCaseCache = skins.sanitizeCaseDefinitions(await db.getCustomCases());
    customCaseCacheLoadedAt = now;
  } catch (error) {
    console.error('[cases]', error.message);
    customCaseCache ||= [];
  }
  return customCaseCache;
}

function emptySkinPayload() {
  return { catalog: skins.publicCatalog(customCaseCache || []), inventory: [], loadouts: [], cases: [], collectionUnlocks: [] };
}

async function buildSkinInventoryPayload(client) {
  // HIGH WARNING for public rollout: inventories/case rewards are per account.
  // Never replace this with a process-global starter array or guest fallback,
  // otherwise every player will appear to share the same inventory/loadout.
  if (!client.accountId || client.guest || !db.isEnabled()) return emptySkinPayload();
  const customCases = await getCustomCaseDefinitions();
  const [inventory, loadouts, cases, collectionUnlocks] = await Promise.all([
    db.getSkinInventory(client.accountId),
    db.getSkinLoadouts(client.accountId),
    db.getCaseInventory(client.accountId),
    db.getCollectionUnlocks(client.accountId)
  ]);
  return {
    catalog: skins.publicCatalog(customCases),
    inventory,
    loadouts,
    cases,
    collectionUnlocks
  };
}

function sendSkinInventory(client, options = {}) {
  buildSkinInventoryPayload(client, options)
    .then(payload => {
      client.skinLoadout = Object.fromEntries((payload.loadouts || []).map(loadout => [loadout.weapon, {
        itemId: loadout.item_id,
        patternSeed: Number(loadout.pattern_seed || 0),
        rarityTier: loadout.rarity_tier || null,
        wearValue: Number(loadout.wear_value || 0),
        wearSeed: Number(loadout.wear_seed || 0)
      }]));
      const room = rooms.get(client.roomCode);
      const player = room?.players.get(client.id);
      if (player) {
        player.skinLoadout = { ...client.skinLoadout };
        player.dirty = true;
        broadcastToRoom(client.roomCode, client.id, 'playerSkinLoadout', { id: client.id, skinLoadout: player.skinLoadout });
      }
      send(client, 'skinInventory', payload);
    })
    .catch(err => {
      console.error('[skins]', err.message);
      send(client, 'skinInventory', emptySkinPayload());
    });
}

function sendTradeUpState(client) {
  if (!client.accountId || client.guest || !db.isEnabled()) {
    send(client, 'tradeUpState', { ok: false, tutorialSeen: true, items: [], message: 'Trade Ups are available to logged-in accounts.' });
    return;
  }
  db.getTradeUpState(client.accountId)
    .then(state => send(client, 'tradeUpState', { ok: true, ...state }))
    .catch(error => {
      console.error('[trade-up-state]', error.message);
      send(client, 'tradeUpState', { ok: false, tutorialSeen: true, items: [], message: 'Could not load Trade Up inventory.' });
    });
}

function handleTradeUpTutorialSeen(client) {
  if (!client.accountId || client.guest || !db.isEnabled()) return;
  db.markTradeUpTutorialSeen(client.accountId)
    .then(() => send(client, 'tradeUpTutorialSeen', { ok: true }))
    .catch(error => {
      console.error('[trade-up-tutorial]', error.message);
      send(client, 'tradeUpTutorialSeen', { ok: false, message: 'Could not save that preference.' });
    });
}

function handleCompleteTradeUp(client, data = {}) {
  if (!client.accountId || client.guest || !db.isEnabled()) {
    send(client, 'tradeUpResult', { ok: false, message: 'Trade Ups are unavailable.' });
    return;
  }
  const inventoryItemIds = Array.isArray(data.inventoryItemIds) ? data.inventoryItemIds : [];
  const idempotencyKey = String(data.idempotencyKey || '').trim();
  db.completeTradeUp({ accountId: client.accountId, inventoryItemIds, idempotencyKey })
    .then(result => {
      const item = skins.getItem(result.itemId) || { id: result.itemId, displayName: result.itemId, weapon: 'Skin' };
      send(client, 'tradeUpResult', {
        ok: true,
        ...result,
        item: {
          ...item,
          rarityTier: result.outputRarity,
          patternSeed: result.patternSeed,
          wearValue: result.floatValue,
          wearSeed: result.wearSeed
        }
      });
      sendSkinInventory(client);
      sendTradeUpState(client);
    })
    .catch(error => {
      console.error('[trade-up]', error.message);
      const message = {
        trade_up_bad_request_id: 'That Trade Up request expired. Please try again.',
        trade_up_wrong_count: 'Select the exact number of skins required.',
        trade_up_duplicate_item: 'The same inventory item cannot be used twice.',
        trade_up_item_missing: 'One of those skins is no longer in your inventory.',
        trade_up_item_listed: 'Remove every selected skin from the marketplace first.',
        trade_up_item_in_trade: 'One of those skins is already included in a pending trade.',
        trade_up_mixed_rarity: 'Every Trade Up input must have the same rarity.',
        trade_up_item_ineligible: 'One of those skins is not eligible for a Trade Up.',
        trade_up_collection_ineligible: 'One selected collection has no valid next-rarity skin.',
        trade_up_mythic_pool_missing: 'One selected collection has no associated Mythic knife.'
      }[error.message] || 'The Trade Up could not be completed. No skins were removed.';
      send(client, 'tradeUpResult', { ok: false, message });
      sendTradeUpState(client);
    });
}

function handleEquipSkin(client, data) {
  // Ownership rule: a socket may equip only rows fetched by
  // (account_id, inventory_id), not catalog item ids.
  if (!client.accountId || client.guest) {
    send(client, 'skinEquipResult', { ok: false, message: 'Log in to use inventory.' });
    return;
  }
  if (!db.isEnabled()) {
    send(client, 'skinEquipResult', { ok: false, message: 'Skin inventory is not available on this server.' });
    return;
  }
  (async () => {
    if (data.useDefault === true) {
      const weapon = String(data.weapon || '').trim().slice(0, 32);
      if (!skins.ITEMS.some(item => item.weapon === weapon)) {
        send(client, 'skinEquipResult', { ok: false, message: 'Invalid weapon loadout.' });
        return;
      }
      client.skinLoadout = { ...(client.skinLoadout || {}) };
      const requestedDefault = String(data.defaultItemId || '').trim();
      if (weapon === 'Knife' && skins.DEFAULT_KNIFE_ITEM_IDS.includes(requestedDefault)) {
        await db.setSkinLoadout({
          accountId: client.accountId,
          weapon: 'Knife',
          inventoryId: null,
          itemId: requestedDefault
        });
        client.skinLoadout.Knife = { itemId: requestedDefault, patternSeed: 0, rarityTier: 'common', wearValue: 0, wearSeed: 0 };
      } else {
        await db.clearSkinLoadout(client.accountId, weapon);
        delete client.skinLoadout[weapon];
      }
      publishPlayerSkinLoadout(client);
      const defaultItem = requestedDefault ? skins.getItem(requestedDefault) : null;
      send(client, 'skinEquipResult', {
        ok: true,
        message: defaultItem ? `${defaultItem.displayName} equipped.` : `${weapon} reset to default.`,
        weapon,
        item: defaultItem
      });
      sendSkinInventory(client);
      return;
    }
    const inventoryId = Number(data.inventoryId);
    if (!Number.isSafeInteger(inventoryId) || inventoryId <= 0) {
      send(client, 'skinEquipResult', { ok: false, message: 'Invalid inventory item.' });
      return;
    }
    const owned = await db.getSkinInventoryItem(client.accountId, inventoryId);
    const item = owned ? skins.getItem(owned.item_id) : null;
    if (!owned || !item) {
      send(client, 'skinEquipResult', { ok: false, message: 'You do not own that skin.' });
      return;
    }
    const requestedWeapon = String(data.weapon || item.weapon || '').trim();
    if (requestedWeapon && requestedWeapon !== item.weapon) {
      send(client, 'skinEquipResult', { ok: false, message: 'That skin does not fit this weapon.' });
      return;
    }
    const loadout = await db.setSkinLoadout({
      accountId: client.accountId,
      weapon: item.weapon,
      inventoryId: owned.id,
      itemId: item.id
    });
    client.skinLoadout = { ...(client.skinLoadout || {}), [item.weapon]: {
      itemId: item.id,
      patternSeed: Number(owned.pattern_seed || 0),
      rarityTier: owned.rarity_tier || null,
      wearValue: Number(owned.wear_value || 0),
      wearSeed: Number(owned.wear_seed || 0)
    } };
    publishPlayerSkinLoadout(client);
    send(client, 'skinEquipResult', { ok: true, loadout, item });
    sendSkinInventory(client);
  })().catch(err => {
    console.error('[equipSkin]', err.message);
    send(client, 'skinEquipResult', { ok: false, message: 'Could not equip that skin.' });
  });
}

function publishPlayerSkinLoadout(client) {
  const room = rooms.get(client.roomCode);
  const player = room?.players.get(client.id);
  if (!player) return;
  player.skinLoadout = { ...(client.skinLoadout || {}) };
  player.dirty = true;
  broadcastToRoom(client.roomCode, client.id, 'playerSkinLoadout', {
    id: client.id,
    skinLoadout: player.skinLoadout
  });
}

async function sendCaseEditorData(client, { force = false, notice = null } = {}) {
  // Admin-only case editor payload. Default cases are intentionally absent.
  if (!isAdminUser(client)) return;
  const customCases = await getCustomCaseDefinitions({ force });
  send(client, 'caseEditorData', {
    catalog: skins.publicCatalog(customCases),
    cases: customCases,
    rarities: skins.RARITIES,
    designs: skins.CASE_DESIGNS,
    notice
  });
}

async function handleSaveCaseDefinition(client, data = {}) {
  if (!isAdminUser(client)) return;
  if (!db.isEnabled()) {
    send(client, 'caseEditorNotice', { ok: false, message: 'Case editor needs the database.' });
    return;
  }
  try {
    const caseDef = skins.sanitizeCaseDefinition(data.case || data);
    if (skins.getCase(caseDef.id)) {
      send(client, 'caseEditorNotice', { ok: false, message: 'Use a new ID for custom cases. Reserved case IDs cannot be overwritten.' });
      return;
    }
    const saved = await db.upsertCustomCase({ ...caseDef, accountId: client.accountId });
    customCaseCache = null;
    send(client, 'caseEditorNotice', { ok: true, message: `${saved.displayName} saved.`, caseId: saved.id });
    await sendCaseEditorData(client, { force: true });
  } catch (error) {
    const scheduleMessages = {
      case_availability_order: 'Available Until must be after Available From.',
      case_discount_order: 'Discount Ends must be after Discount Starts.',
      case_discount_price_required: 'Set a discount price lower than the original price.',
      case_discount_window_required: 'Specific-window discounts require both start and end times.',
      case_final_discount_requires_end: 'Final-hours discounts require an availability end and duration.',
      case_final_discount_too_long: 'Final discount hours must fit inside the case availability period.',
      case_discount_outside_availability: 'The discount window must stay inside the case availability period.'
    };
    const message = scheduleMessages[error.message] || (error.message === 'mythic_requires_knife'
      ? 'Mythic can only be used for knives.'
      : (error.message === 'case_items_required' ? 'Add at least one skin to the case.' : 'Could not save that case.'));
    send(client, 'caseEditorNotice', { ok: false, message });
  }
}

async function handleDeleteCaseDefinition(client, data = {}) {
  if (!isAdminUser(client)) return;
  if (!db.isEnabled()) {
    send(client, 'caseEditorNotice', { ok: false, message: 'Case editor needs the database.' });
    return;
  }
  let caseId = '';
  try {
    caseId = skins.sanitizeCaseDefinition({ id: data.caseId || data.id, items: [{ itemId: 'ak47_ice_coaled', weight: 1 }] }).id;
  } catch {
    send(client, 'caseEditorNotice', { ok: false, message: 'Choose a valid custom case.' });
    return;
  }
  if (skins.getCase(caseId)) {
    send(client, 'caseEditorNotice', { ok: false, message: 'Reserved case IDs cannot be deleted.' });
    return;
  }
  try {
    const deleted = await db.deleteCustomCase(caseId);
    customCaseCache = null;
    send(client, 'caseEditorNotice', { ok: deleted, message: deleted ? 'Case deleted.' : 'Case not found.' });
    await sendCaseEditorData(client, { force: true });
  } catch (error) {
    const listed = error.message === 'active_case_listing' || error.code === '23503';
    send(client, 'caseEditorNotice', { ok: false, message: listed ? 'Remove active player listings before deleting this case.' : 'Could not delete that case.' });
  }
}

const DAILY_CHALLENGE_METRICS = Object.freeze([
  { id: 'kills', label: 'Kills' },
  { id: 'headshots', label: 'Headshot kills' },
  { id: 'damage', label: 'Damage dealt' },
  { id: 'utilityKills', label: 'Utility kills' },
  { id: 'wins', label: 'Games won' },
  { id: 'mapWins', label: 'Map wins' },
  { id: 'weaponKills', label: 'Weapon kills' }
]);
const DAILY_CHALLENGE_TIERS = new Set(['easy', 'medium', 'hard']);
const DAILY_CHALLENGE_METRIC_IDS = new Set(DAILY_CHALLENGE_METRICS.map(metric => metric.id));

function sanitizeDailyChallengeTemplate(input = {}) {
  const period = String(input.period || 'daily').trim().toLowerCase() === 'weekly' ? 'weekly' : 'daily';
  const tier = String(input.tier || '').trim().toLowerCase();
  const metric = String(input.metric || input.key || '').trim();
  if (!DAILY_CHALLENGE_TIERS.has(tier) || !DAILY_CHALLENGE_METRIC_IDS.has(metric)) throw new Error('invalid_challenge_type');
  const target = Math.max(1, Math.min(1000000, Math.floor(Number(input.target) || 0)));
  const xp = Math.max(0, Math.min(10000, Math.floor(Number(input.xp) || 0)));
  let weapon = metric === 'weaponKills' ? String(input.weapon || 'AUTO').trim().slice(0, 32) : '';
  if (metric === 'weaponKills' && weapon !== 'AUTO' && !WEAPONS[weapon]) throw new Error('invalid_challenge_weapon');
  const map = metric === 'mapWins' ? String(input.map || input.mapId || MAP_DUST2).trim().toLowerCase() : '';
  if (metric === 'mapWins' && !PUBLIC_MAP_SET.has(map)) throw new Error('invalid_challenge_map');
  const defaultLabels = {
    kills: 'Get {target} kills',
    headshots: 'Get {target} headshot kills',
    damage: 'Deal {target} damage',
    utilityKills: 'Get {target} utility kills',
    wins: 'Win {target} games',
    mapWins: 'Win {target} games on {map}',
    weaponKills: 'Get {target} kills with {weapon}'
  };
  const label = String(input.label || defaultLabels[metric]).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  if (!label) throw new Error('invalid_challenge_label');
  const requestedId = String(input.id || '').trim().toLowerCase();
  const id = requestedId
    ? requestedId.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64)
    : `challenge_${crypto.randomBytes(6).toString('hex')}`;
  if (!id) throw new Error('invalid_challenge_id');
  return {
    id,
    period,
    tier,
    metric,
    label,
    target,
    xp,
    weapon,
    map,
    enabled: input.enabled !== false,
    sortOrder: Math.max(0, Math.min(100000, Math.floor(Number(input.sortOrder) || 0)))
  };
}

async function sendDailyChallengeEditorData(client, notice = null) {
  if (!isAdminUser(client)) return;
  if (!db.isEnabled()) {
    send(client, 'dailyChallengeEditorNotice', { ok: false, message: 'Challenge editor needs the database.' });
    return;
  }
  const templates = await db.getDailyChallengeTemplates();
  send(client, 'dailyChallengeEditorData', {
    templates,
    metrics: DAILY_CHALLENGE_METRICS,
    weapons: ['AUTO', ...Object.keys(WEAPONS).filter(name => !['Knife', 'Frag', 'Smoke', 'Flash', 'Molotov', 'Healthshot'].includes(name))],
    maps: PUBLIC_MAP_IDS.map(id => ({ id, label: publicMapLabel(id) })),
    notice
  });
}

function refreshDailyChallengeDefinitions() {
  dailyChallengeDefinitionCache = null;
  weeklyChallengeDefinitionCache = null;
  for (const connected of clients.values()) {
    if (connected.authed) sendChallengeProgress(connected);
  }
}

async function handleSaveDailyChallengeTemplate(client, data = {}) {
  if (!isAdminUser(client)) return;
  if (!db.isEnabled()) {
    send(client, 'dailyChallengeEditorNotice', { ok: false, message: 'Challenge editor needs the database.' });
    return;
  }
  try {
    const template = sanitizeDailyChallengeTemplate(data.template || data);
    const saved = await db.upsertDailyChallengeTemplate({ ...template, accountId: client.accountId });
    refreshDailyChallengeDefinitions();
    await sendDailyChallengeEditorData(client, `${saved.label} saved.`);
  } catch (error) {
    send(client, 'dailyChallengeEditorNotice', { ok: false, message: 'Check the tier, metric, target, XP, label, and weapon.' });
  }
}

async function handleDeleteDailyChallengeTemplate(client, data = {}) {
  if (!isAdminUser(client)) return;
  if (!db.isEnabled()) {
    send(client, 'dailyChallengeEditorNotice', { ok: false, message: 'Challenge editor needs the database.' });
    return;
  }
  const id = String(data.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '').slice(0, 64);
  if (!id) {
    send(client, 'dailyChallengeEditorNotice', { ok: false, message: 'Choose a challenge to delete.' });
    return;
  }
  const deleted = await db.deleteDailyChallengeTemplate(id);
  refreshDailyChallengeDefinitions();
  await sendDailyChallengeEditorData(client, deleted ? 'Challenge deleted.' : 'Challenge not found.');
}

async function resolveCaseDefinition(caseId) {
  const id = String(caseId || skins.PROTOTYPE_CASE_ID);
  if (!id || id === skins.PROTOTYPE_CASE_ID) return null;
  const builtIn = skins.getCase(id);
  if (builtIn) return builtIn;
  return (await getCustomCaseDefinitions()).find((caseDef) => caseDef.id === id) || null;
}

function handleOpenCaseTest(client, data = {}) {
  // Test openings exercise the real secure roll and presentation without
  // consuming a case, granting an item, or advancing collection progress.
  if (!isAdminUser(client)) return;
  openCaseForClient(client, data, { consume: false, label: 'case-test' });
}

function handleOpenCase(client, data = {}) {
  openCaseForClient(client, data, { consume: true, label: 'case-open' });
}

function handleBuyCasePurchase(client, data = {}) {
  // Case buying transfers Mowbucks -> case_inventory in one DB transaction.
  // Never grant cases client-side; sendSkinInventory refreshes the account view.
  if (!client.accountId || client.guest || !db.isEnabled()) {
    send(client, 'caseBuyNotice', { ok: false, message: 'Case buying is unavailable.' });
    return;
  }
  (async () => {
    const caseDef = await resolveCaseDefinition(data.caseId);
    const availability = caseDef ? skins.caseAvailability(caseDef) : null;
    if (!caseDef || !availability?.available) {
      send(client, 'caseBuyNotice', { ok: false, message: 'Choose a valid case.' });
      return;
    }
    const price = Math.max(0, Math.floor(Number(availability.price || 0)));
    const result = await db.buyCase({ accountId: client.accountId, caseId: caseDef.id, price });
    send(client, 'caseBuyNotice', {
      ok: true,
      caseId: caseDef.id,
      quantity: Number(result.caseInventory?.quantity || 0),
      mowbucks: result.mowbucks,
      message: `${caseDef.displayName || caseDef.id} purchased.`
    });
    sendSkinInventory(client);
  })().catch((error) => {
    const message = error.message === 'not_enough_coins' ? 'Not enough Mowbucks.' : 'Could not buy that case.';
    send(client, 'caseBuyNotice', { ok: false, message });
  });
}

function openCaseForClient(client, data = {}, { consume = true, label = 'case-open' } = {}) {
  if (!client.accountId || client.guest || !db.isEnabled()) {
    send(client, 'caseRollNotice', { ok: false, message: consume ? 'Case opening is unavailable.' : 'Case testing is unavailable.' });
    return;
  }
  const now = Date.now();
  const busyUntil = Number(client.caseOpenBusyUntil || 0);
  if (busyUntil > now) {
    send(client, 'caseRollNotice', { ok: false, message: `Case opening is cooling down (${Math.ceil((busyUntil - now) / 1000)}s).` });
    return;
  }
  // Claim the per-client opening slot before resolving the case definition.
  // That lookup awaits Postgres, so setting this inside the async block left a
  // window where two rapid packets could both consume cases and award skins.
  client.caseOpenBusyUntil = Date.now() + 7000;
  (async () => {
    const randomInt = (max) => crypto.randomInt(0, Math.max(1, Number(max) || 1));
    const caseDef = !consume && data.case
      ? skins.sanitizeCaseDefinition(data.case)
      : await resolveCaseDefinition(data.caseId);
    if (data.caseId && !caseDef) {
      client.caseOpenBusyUntil = 0;
      send(client, 'caseRollNotice', { ok: false, message: consume ? 'You do not own that case.' : 'Choose a valid case draft to test.' });
      return;
    }
    if (consume && !caseDef) {
      client.caseOpenBusyUntil = 0;
      send(client, 'caseRollNotice', { ok: false, message: 'Choose a valid case to open.' });
      return;
    }
    const result = caseDef ? skins.rollCaseDefinition(caseDef, randomInt) : skins.rollPrototypeCase(randomInt);
    const animation = skins.buildCaseReel(result, randomInt, { caseDef });
    if (!result || !animation) return;
    const caseId = caseDef?.id || skins.PROTOTYPE_CASE_ID;
    const patternSeed = crypto.randomInt(1, 1001);
    const defaultReward = skins.DEFAULT_KNIFE_ITEM_IDS.includes(result.item.id);
    const wearValue = defaultReward ? 0 : crypto.randomInt(0, 1000001) / 1000000;
    const wearSeed = defaultReward ? 0 : crypto.randomInt(1, 2147483647);
    const landingFraction = (28 + randomInt(45)) / 100;
    if (!consume) {
      send(client, 'caseRollResult', {
        rollId: `test:${Date.now()}`,
        caseId,
        reel: animation.reel,
        winningIndex: animation.winningIndex,
        item: { ...result.item, rarityTier: result.tier, patternSeed, wearValue, wearSeed },
        inventoryItem: null,
        patternSeed,
        wearValue,
        wearSeed,
        landingFraction,
        tier: result.tier,
        gold: result.gold,
        test: true,
        durationMs: 6500
      });
      return;
    }
    const { opening, inventoryItem, collectionReward } = await db.awardCaseRoll({
      accountId: client.accountId,
      caseId,
      itemId: result.item.id,
      rarityTier: result.tier,
      gold: result.gold,
      reel: animation.reel,
      patternSeed,
      wearValue,
      wearSeed,
      collectionId: caseDef?.id || '',
      collectionEligible: result.item.weapon !== 'Knife',
      consume
    });
    send(client, 'caseRollResult', {
      rollId: opening.id,
      caseId: opening.case_id,
      reel: animation.reel,
      winningIndex: animation.winningIndex,
      item: { ...result.item, rarityTier: result.tier, patternSeed, wearValue, wearSeed },
      inventoryItem,
      patternSeed,
      wearValue,
      wearSeed,
      landingFraction,
      tier: result.tier,
      gold: result.gold,
      collectionReward,
      durationMs: 6500
    });
    if (collectionReward) {
      const collectionName = caseDef?.collectionName || `${caseDef?.displayName || 'Case'} Collection`;
      send(client, 'progressionUpdate', {
        amount: collectionReward.xpAwarded,
        reason: `${collectionName} discovery`,
        mowbucks: collectionReward.mowbucksAwarded,
        levelsGained: collectionReward.levelsGained,
        level: collectionReward.level,
        stats: await auth.statsPayload(client.accountId)
      });
    }
    sendSkinInventory(client);
  })().catch((error) => {
    client.caseOpenBusyUntil = 0;
    console.error(`[${label}]`, error.message);
    const message = error.message === 'case_not_owned'
      ? 'You do not have that case in your inventory.'
      : (consume ? 'Could not open that case.' : 'Could not test that case.');
    send(client, 'caseRollNotice', { ok: false, message });
  });
}

function notifyMarketAuctionSettlement(result) {
  const listing = result?.listing;
  if (!listing) return;
  const seller = findClientByAccountId(listing.seller_id);
  if (result.sold) {
    const buyer = findClientByAccountId(listing.buyer_id);
    if (buyer) {
      send(buyer, 'marketNotice', { ok: true, purchase: true, balanceChanged: true, listing, message: `You won the auction for ${listing.item_id}.` });
      sendSkinInventory(buyer);
    }
    if (seller) {
      send(seller, 'marketNotice', { ok: true, balanceChanged: true, listing, message: `Your auction sold for ${Number(listing.price || 0).toLocaleString()} Mowbucks.` });
      sendSkinInventory(seller);
    }
    return;
  }
  if (seller) {
    const message = result.reason === 'item_missing'
      ? 'An auction was cancelled because its skin was no longer available.'
      : 'Your auction ended without a bid.';
    send(seller, 'marketNotice', { ok: true, listing, message });
  }
  if (result.refundedBidderId) {
    const bidder = findClientByAccountId(result.refundedBidderId);
    if (bidder) send(bidder, 'marketNotice', { ok: true, balanceChanged: true, listing, message: 'Your auction bid was refunded because the skin was unavailable.' });
  }
}

async function settleAndNotifyMarketAuctions() {
  if (!db.isEnabled()) return [];
  const settled = await db.settleExpiredMarketAuctions({ limit: 25 });
  settled.forEach(notifyMarketAuctionSettlement);
  return settled;
}

function handleMarketList(client, data = {}) {
  if (!db.isEnabled()) {
    send(client, 'marketData', {
      listings: [], featuredListing: null, overview: { marketCap: 0, circulation: 0, casesUnboxed: 0, tradeUpsCompleted: 0, moneySupply: 0 },
      caseListings: [], soldCatalog: [], itemHistory: [], historyItemId: '', devOnly: true
    });
    return;
  }
  const historyItemId = String(data.historyItemId || '').trim();
  (async () => {
    await settleAndNotifyMarketAuctions();
    const [listings, featuredListing, overview, soldCatalog, itemHistory, caseListings] = await Promise.all([
      db.listMarketListings(data || {}),
      db.getFeaturedMarketListing(),
      db.getMarketOverview({ excludedItemIds: skins.DEFAULT_KNIFE_ITEM_IDS }),
      db.getSoldMarketCatalog({ limit: 500 }),
      historyItemId ? db.getMarketItemHistory(historyItemId) : Promise.resolve([]),
      db.listCaseMarketListings({ limit: 100 })
    ]);
    send(client, 'marketData', { listings, featuredListing, overview, soldCatalog, itemHistory, caseListings, historyItemId, devOnly: false });
  })().catch(error => {
    console.error('[market-list]', error.message);
    send(client, 'marketNotice', { ok: false, message: 'Could not load market listings.' });
  });
}

function handleMarketCreateListing(client, data = {}) {
  // Marketplace actions are deliberately thin wrappers: keep all ownership,
  // duplicate-listing, balance, and race-condition checks inside db.js.
  if (!client.accountId || !db.isEnabled()) { send(client, 'marketNotice', { ok: false, message: 'Marketplace is unavailable.' }); return; }
  const inventoryId = Number(data.inventoryId);
  const listingType = String(data.listingType || '').toLowerCase() === 'auction' ? 'auction' : 'fixed';
  const price = Math.max(listingType === 'auction' ? 1 : 0, Math.min(1000000000, Math.floor(Number(data.price) || 0)));
  const durationMinutes = [15, 60, 360, 1440].includes(Number(data.durationMinutes)) ? Number(data.durationMinutes) : 60;
  if (!Number.isSafeInteger(inventoryId) || inventoryId <= 0) { send(client, 'marketNotice', { ok: false, message: 'Choose an inventory item to list.' }); return; }
  db.getSkinInventoryItem(client.accountId, inventoryId)
    .then((owned) => {
      if (!owned) return null;
      if (skins.DEFAULT_KNIFE_ITEM_IDS.includes(String(owned.item_id))) throw new Error('default_skin_not_sellable');
      return db.createMarketListing({ accountId: client.accountId, inventoryId, price, listingType, durationMinutes });
    })
    .then(listing => {
      const message = listing ? (listing.listing_type === 'auction' ? 'Auction started.' : 'Listing created.') : 'You do not own that item.';
      send(client, 'marketNotice', { ok: !!listing, listing, message });
      sendSkinInventory(client);
      handleMarketList(client, {});
    })
    .catch(error => {
      console.error('[market-create]', error.message);
      const message = error.message === 'default_skin_not_sellable'
        ? 'Default CT and T knives cannot be sold.'
        : (error.code === '23505' ? 'That skin is already listed.' : 'Could not create listing.');
      send(client, 'marketNotice', { ok: false, message });
    });
}

function handleMarketBuyListing(client, data = {}) {
  if (!client.accountId || !db.isEnabled()) { send(client, 'marketNotice', { ok: false, message: 'Marketplace is unavailable.' }); return; }
  const listingId = Number(data.listingId || data.id);
  if (!Number.isSafeInteger(listingId) || listingId <= 0) { send(client, 'marketNotice', { ok: false, message: 'Choose a listing.' }); return; }
  db.buyMarketListing({ buyerId: client.accountId, listingId })
    .then(listing => {
      send(client, 'marketNotice', { ok: true, purchase: true, listing, message: 'Purchase complete.' });
      sendSkinInventory(client);
      handleMarketList(client, {});
      const seller = findClientByAccountId(listing.seller_id);
      if (seller) {
        const buyerName = String(listing.buyer_name || '').trim();
        send(seller, 'marketNotice', { ok: true, listing, message: buyerName ? `Your listed skin sold to ${buyerName}.` : 'Your listed skin sold.' });
        sendSkinInventory(seller);
      }
    })
    .catch(error => {
      const message = error.message === 'own_listing' ? 'You cannot buy your own listing.'
        : error.message === 'not_enough_coins' ? 'Not enough Mowbucks.'
          : error.message === 'auction_requires_bid' ? 'Place a bid on auction listings.'
          : error.message === 'seller_no_longer_owns_item' ? 'That item is no longer available.'
            : 'Could not buy that listing.';
      send(client, 'marketNotice', { ok: false, message });
    });
}

function handleMarketPlaceBid(client, data = {}) {
  if (!client.accountId || !db.isEnabled()) { send(client, 'marketNotice', { ok: false, message: 'Marketplace is unavailable.' }); return; }
  const listingId = Number(data.listingId || data.id);
  const amount = Math.max(1, Math.min(1000000000, Math.floor(Number(data.amount) || 0)));
  if (!Number.isSafeInteger(listingId) || listingId <= 0) { send(client, 'marketNotice', { ok: false, message: 'Choose an auction.' }); return; }
  db.placeMarketAuctionBid({ bidderId: client.accountId, listingId, amount })
    .then(result => {
      send(client, 'marketNotice', { ok: true, bid: true, balanceChanged: true, listing: result.listing, message: `Bid placed at ${amount.toLocaleString()} Mowbucks.` });
      if (result.previousBidderId) {
        const previousBidder = findClientByAccountId(result.previousBidderId);
        if (previousBidder) send(previousBidder, 'marketNotice', { ok: true, balanceChanged: true, listing: result.listing, message: `You were outbid on ${result.listing.item_id}. Your bid was refunded.` });
      }
      handleMarketList(client, {});
    })
    .catch(error => {
      const message = error.message === 'own_listing' ? 'You cannot bid on your own auction.'
        : error.message === 'not_enough_coins' ? 'Not enough Mowbucks for that bid.'
          : error.message === 'bid_too_low' ? `Bid at least ${Number(error.minimumBid || 1).toLocaleString()} Mowbucks.`
            : error.message === 'auction_ended' ? 'That auction has ended.'
              : error.message === 'not_an_auction' ? 'That listing is not an auction.'
                : 'Could not place that bid.';
      send(client, 'marketNotice', { ok: false, message });
    });
}

function handleMarketCancelListing(client, data = {}) {
  if (!client.accountId || !db.isEnabled()) { send(client, 'marketNotice', { ok: false, message: 'Marketplace is unavailable.' }); return; }
  const listingId = Number(data.listingId || data.id);
  if (!Number.isSafeInteger(listingId) || listingId <= 0) { send(client, 'marketNotice', { ok: false, message: 'Choose a listing.' }); return; }
  // The client asking to act as an admin is only a request. The role is read
  // from the authenticated socket, never from the packet, so a forged
  // "asAdmin: true" from an ordinary player buys nothing.
  const asAdmin = data.asAdmin === true && isAdminUser(client);
  db.cancelMarketListing({ accountId: client.accountId, listingId, asAdmin })
    .then(listing => {
      if (listing && asAdmin) {
        console.warn(`[admin-market] ${client.accountId} force-cancelled listing ${listingId} (seller ${listing.seller_id})`);
        notifyMarketSeller(listing, 'An administrator removed your listing.');
        // The refund happened inside the cancel transaction; this only makes the
        // bidder's balance on screen agree with the one in the database.
        if (listing.refunded) {
          const bidder = findClientByAccountId(listing.refunded.accountId);
          if (bidder) {
            send(bidder, 'marketNotice', { ok: true, message: `Auction cancelled by an administrator. ${listing.refunded.amount} refunded.` });
            sendSkinInventory(bidder);
          }
        }
      }
      send(client, 'marketNotice', { ok: !!listing, listing, message: listing ? (asAdmin ? 'Listing removed as admin.' : 'Listing removed.') : 'Listing not found.' });
      handleMarketList(client, {});
    })
    .catch(error => {
      console.error('[market-cancel]', error.message);
      send(client, 'marketNotice', { ok: false, message: error.message === 'auction_has_bids' ? 'Auctions cannot be cancelled after the first bid.' : 'Could not remove listing.' });
    });
}

// Reprice somebody else's listing. Admin only, and the role is read from the
// authenticated socket rather than the packet, so a forged request buys nothing.
function handleMarketAdminSetPrice(client, data = {}) {
  if (!isAdminUser(client)) return;
  if (!client.accountId || !db.isEnabled()) { send(client, 'marketNotice', { ok: false, message: 'Marketplace is unavailable.' }); return; }
  const listingId = Number(data.listingId || data.id);
  if (!Number.isSafeInteger(listingId) || listingId <= 0) { send(client, 'marketNotice', { ok: false, message: 'Choose a listing.' }); return; }
  const price = Math.max(0, Math.min(1000000000, Math.floor(Number(data.price) || 0)));
  db.setMarketListingPrice({ listingId, price })
    .then(listing => {
      if (!listing) { send(client, 'marketNotice', { ok: false, message: 'Listing not found.' }); return; }
      console.warn(`[admin-market] ${client.accountId} repriced listing ${listingId} from ${listing.previous_price} to ${listing.price} (seller ${listing.seller_id})`);
      send(client, 'marketNotice', { ok: true, listing, message: `Price changed to ${Number(listing.price).toLocaleString()} Mowbucks.` });
      // The seller is told, because the terms of their own sale just changed.
      notifyMarketSeller(listing, `An administrator changed your listing price to ${Number(listing.price).toLocaleString()} Mowbucks.`);
      handleMarketList(client, {});
    })
    .catch(error => {
      console.error('[market-set-price]', error.message);
      send(client, 'marketNotice', {
        ok: false,
        message: error.message === 'auction_has_bids'
          ? 'An auction that has taken a bid cannot be repriced.'
          : 'Could not change that price.'
      });
    });
}

// Tell the seller their listing moved, and refresh what they are looking at.
function notifyMarketSeller(listing, message) {
  const seller = findClientByAccountId(listing?.seller_id);
  if (!seller) return;
  send(seller, 'marketNotice', { ok: true, listing, message });
  sendSkinInventory(seller);
}

async function handleMarketCreateCaseListing(client, data = {}) {
  if (!client.accountId || !db.isEnabled()) { send(client, 'marketNotice', { ok: false, message: 'Marketplace is unavailable.' }); return; }
  const caseId = String(data.caseId || '').trim();
  const price = Math.max(0, Math.min(1000000000, Math.floor(Number(data.price) || 0)));
  try {
    const caseDef = await resolveCaseDefinition(caseId);
    if (!caseDef || caseDef.marketVisible !== false) {
      send(client, 'marketNotice', { ok: false, message: 'Only cases no longer sold directly can be resold.' });
      return;
    }
    const listing = await db.createCaseMarketListing({ accountId: client.accountId, caseId, price });
    send(client, 'marketNotice', { ok: true, listing, message: 'Case listed.' });
    sendSkinInventory(client);
    handleMarketList(client, {});
  } catch (error) {
    const message = error.message === 'case_not_owned' ? 'You do not own that case.' : 'Could not list that case.';
    send(client, 'marketNotice', { ok: false, message });
  }
}

function handleMarketBuyCaseListing(client, data = {}) {
  if (!client.accountId || !db.isEnabled()) { send(client, 'marketNotice', { ok: false, message: 'Marketplace is unavailable.' }); return; }
  const listingId = Number(data.listingId || data.id);
  if (!Number.isSafeInteger(listingId) || listingId <= 0) { send(client, 'marketNotice', { ok: false, message: 'Choose a case listing.' }); return; }
  db.buyCaseMarketListing({ buyerId: client.accountId, listingId })
    .then(listing => {
      send(client, 'marketNotice', { ok: true, purchase: true, listing, message: 'Case purchase complete.' });
      sendSkinInventory(client);
      handleMarketList(client, {});
      const seller = findClientByAccountId(listing.seller_id);
      if (seller) {
        send(seller, 'marketNotice', { ok: true, listing, message: 'Your listed case sold.' });
        sendSkinInventory(seller);
      }
    })
    .catch(error => {
      const message = error.message === 'own_listing' ? 'You cannot buy your own listing.'
        : error.message === 'not_enough_coins' ? 'Not enough Mowbucks.'
          : 'Could not buy that case listing.';
      send(client, 'marketNotice', { ok: false, message });
    });
}

function handleMarketCancelCaseListing(client, data = {}) {
  if (!client.accountId || !db.isEnabled()) { send(client, 'marketNotice', { ok: false, message: 'Marketplace is unavailable.' }); return; }
  const listingId = Number(data.listingId || data.id);
  if (!Number.isSafeInteger(listingId) || listingId <= 0) { send(client, 'marketNotice', { ok: false, message: 'Choose a case listing.' }); return; }
  db.cancelCaseMarketListing({ accountId: client.accountId, listingId })
    .then(listing => {
      send(client, 'marketNotice', { ok: true, listing, message: 'Case listing removed.' });
      sendSkinInventory(client);
      handleMarketList(client, {});
    })
    .catch(() => send(client, 'marketNotice', { ok: false, message: 'Could not remove that case listing.' }));
}

async function handleTradeRequestCreate(client, data = {}) {
  // Trades are friend-only at the socket layer; item/coin ownership is rechecked
  // again when the receiver accepts so stale pending offers cannot move assets.
  if (!client.accountId || !db.isEnabled()) { send(client, 'tradeNotice', { ok: false, message: 'Trading is unavailable.' }); return; }
  const toAccount = Number(data.toAccount);
  if (!Number.isSafeInteger(toAccount) || toAccount <= 0 || toAccount === Number(client.accountId)) {
    send(client, 'tradeNotice', { ok: false, message: 'Choose a friend to trade with.' });
    return;
  }
  try {
    const level = await accountLevelForTrade(client.accountId);
    if (level < TRADE_MIN_LEVEL) {
      send(client, 'tradeNotice', { ok: false, message: `Reach level ${TRADE_MIN_LEVEL} before sending trades.` });
      return;
    }
    const friends = await db.areFriends(client.accountId, toAccount);
    if (!friends) { send(client, 'tradeNotice', { ok: false, message: 'Trades are friend-only.' }); return; }
    const trade = await db.createTradeRequest({
      fromAccount: client.accountId,
      toAccount,
      offer: data.offer || {},
      request: data.request || {}
    });
    send(client, 'tradeNotice', { ok: true, trade, message: 'Trade request sent.' });
    const targetClient = findClientByAccountId(toAccount);
    if (targetClient) send(targetClient, 'tradeNotice', { ok: true, trade, message: `${client.accountName || 'A friend'} sent a trade request.` });
  } catch (error) {
    console.error('[trade-create]', error.message);
    send(client, 'tradeNotice', { ok: false, message: 'Could not create trade request.' });
  }
}

async function handleTradeRespond(client, data = {}) {
  if (!client.accountId || !db.isEnabled()) { send(client, 'tradeNotice', { ok: false, message: 'Trading is unavailable.' }); return; }
  const tradeId = Number(data.tradeId || data.id);
  const action = String(data.action || '').trim();
  if (!Number.isSafeInteger(tradeId) || tradeId <= 0 || !['accept', 'decline', 'cancel'].includes(action)) {
    send(client, 'tradeNotice', { ok: false, message: 'Choose a valid trade action.' });
    return;
  }
  try {
    if (action === 'accept') {
      const level = await accountLevelForTrade(client.accountId);
      if (level < TRADE_MIN_LEVEL) {
        send(client, 'tradeNotice', { ok: false, message: `Reach level ${TRADE_MIN_LEVEL} before accepting trades.` });
        return;
      }
    }
    const trade = await db.respondTradeRequest({ accountId: client.accountId, tradeId, action });
    send(client, 'tradeNotice', { ok: true, trade, message: action === 'accept' ? 'Trade complete.' : 'Trade updated.' });
    sendSkinInventory(client);
    const otherId = String(trade.from_account) === String(client.accountId) ? trade.to_account : trade.from_account;
    const other = findClientByAccountId(otherId);
    if (other) {
      send(other, 'tradeNotice', { ok: true, trade, message: action === 'accept' ? 'A trade completed.' : 'A trade was updated.' });
      sendSkinInventory(other);
    }
  } catch (error) {
    const message = {
      trade_item_listed: 'One of those skins is listed on the marketplace.',
      sender_item_missing: 'The sender no longer owns one of those skins.',
      receiver_item_missing: 'The receiver no longer owns one of those skins.',
      sender_coins_missing: 'The sender does not have enough Mowbucks.',
      receiver_coins_missing: 'The receiver does not have enough Mowbucks.'
    }[error.message] || 'Could not update that trade.';
    send(client, 'tradeNotice', { ok: false, message });
  }
}

function handleGetStats(client, data) {
  if (!client.accountId) {
    send(client, 'statsData', { accountId: null, username: client.name || 'Guest', stats: auth.emptyStats() });
    return;
  }
  const targetId = data.accountId ? String(data.accountId) : client.accountId;
  (async () => {
    try {
      if (targetId === client.accountId) { await flushClientStats(client); }
      const stats = await auth.statsPayload(targetId);
      let username = client.accountName;
      if (targetId !== client.accountId) {
        const acc = await db.getAccountById(targetId);
        username = acc ? acc.username : 'Player';
      }
      const canViewInventory = targetId !== client.accountId && !client.guest && db.isEnabled()
        ? await db.areFriends(client.accountId, targetId)
        : false;
      const [dailyChallengeProgress, weeklyChallengeProgress] = targetId === client.accountId
        ? await Promise.all([buildDailyChallengeProgress(client), buildWeeklyChallengeProgress(client)])
        : [null, null];
      send(client, 'statsData', { accountId: targetId, username, stats, dailyChallengeProgress, weeklyChallengeProgress, canViewInventory });
    } catch (e) {
      console.error('[getStats]', e.message);
    }
  })();
}

function normalizeDailyRow(row) {
  const kills = Number(row.kills || 0);
  const deaths = Number(row.deaths || 0);
  const shotsFired = Number(row.shots_fired ?? row.shotsFired ?? 0);
  const shotsHit = Number(row.shots_hit ?? row.shotsHit ?? 0);
  const kd = deaths > 0 ? kills / deaths : kills;
  const accuracy = shotsFired > 0 ? shotsHit / shotsFired : 0;
  const xp = Math.max(0, Number(row.xp || 0));
  return {
    username: sanitizeName(row.username, 'Player'),
    wins: Number(row.wins || 0),
    kills,
    deaths,
    bestStreak: Number(row.best_streak ?? row.bestStreak ?? 0),
    shotsFired,
    shotsHit,
    kd,
    kdLabel: deaths === 0 && kills > 0 ? 'Perfect' : kd.toFixed(2),
    accuracy,
    accuracyLabel: `${Math.round(accuracy * 100)}%`,
    xp,
    level: progressionForXpLocal(xp).level
  };
}

function mergeDailyRows(rows, extraRows) {
  const merged = new Map();
  for (const raw of [...rows, ...extraRows]) {
    const key = raw.player_key || raw.playerKey || raw.username;
    if (!key) continue;
    const existing = merged.get(key) || {
      username: raw.username || 'Player',
      wins: 0,
      kills: 0,
      deaths: 0,
      shots_fired: 0,
      shots_hit: 0,
      best_streak: 0,
      xp: 0
    };
    existing.username = raw.username || existing.username;
    existing.wins += Number(raw.wins || 0);
    existing.kills += Number(raw.kills || 0);
    existing.deaths += Number(raw.deaths || 0);
    existing.shots_fired += Number(raw.shots_fired ?? raw.shotsFired ?? 0);
    existing.shots_hit += Number(raw.shots_hit ?? raw.shotsHit ?? 0);
    existing.best_streak = Math.max(existing.best_streak || 0, Number(raw.best_streak ?? raw.bestStreak ?? 0));
    existing.xp = Math.max(existing.xp || 0, Number(raw.xp || 0));
    merged.set(key, existing);
  }
  return Array.from(merged.values()).map(normalizeDailyRow);
}

function topRows(rows, sortFn, valueFn, minFn = null) {
  return rows
    .filter(row => !minFn || minFn(row))
    .sort(sortFn)
    .map((row, idx) => ({
      rank: idx + 1,
      username: row.username,
      value: valueFn(row)
    }));
}

function buildLeaderboardPayload(rows, meta = {}) {
  const killsDesc = (a, b) => (b.kills - a.kills) || String(a.username).localeCompare(String(b.username));
  const winsDesc = (a, b) => (b.wins - a.wins) || (b.kills - a.kills) || String(a.username).localeCompare(String(b.username));
  const streakDesc = (a, b) => (b.bestStreak - a.bestStreak) || (b.kills - a.kills) || String(a.username).localeCompare(String(b.username));
  const kdDesc = (a, b) => (b.kd - a.kd) || (b.kills - a.kills) || (a.deaths - b.deaths) || String(a.username).localeCompare(String(b.username));
  const accDesc = (a, b) => (b.accuracy - a.accuracy) || (b.shotsHit - a.shotsHit) || String(a.username).localeCompare(String(b.username));
  const levelDesc = (a, b) => (b.level - a.level) || (b.xp - a.xp) || String(a.username).localeCompare(String(b.username));
  const boards = {
    wins: topRows(rows, winsDesc, row => row.wins),
    kills: topRows(rows, killsDesc, row => row.kills),
    streak: topRows(rows, streakDesc, row => row.bestStreak),
    kd: topRows(rows, kdDesc, row => row.kdLabel, row => row.kills >= 5),
    accuracy: topRows(rows, accDesc, row => `${row.accuracyLabel} (${row.shotsHit}/${row.shotsFired})`, row => row.shotsFired > 0)
  };
  if (meta.scope === 'allTime') boards.level = topRows(rows, levelDesc, row => `Level ${row.level}`);
  return {
    ...meta,
    boards
  };
}

function buildScopedLeaderboardPayload(scopes) {
  return {
    generatedAt: Date.now(),
    scopes
  };
}

function onlineClientForAccount(accountId) {
  const key = String(accountId || '');
  for (const connected of clients.values()) {
    if (connected.authed && !connected.guest && String(connected.accountId || '') === key) return connected;
  }
  return null;
}

function maxPlayersForRoom(room) {
  return MODE_CONFIG[room?.settings?.gamemode]?.casual
    ? Math.max(24, antiflood.CFG.MAX_PLAYERS_PER_ROOM)
    : antiflood.CFG.MAX_PLAYERS_PER_ROOM;
}

function publicFriendPresence(accountId, username, lastSeen = null) {
  const connected = onlineClientForAccount(accountId);
  const room = connected?.roomCode ? rooms.get(connected.roomCode) : null;
  const hiddenRoom = !room || isAdminRoom(room);
  return {
    accountId: String(accountId),
    username: username || connected?.accountName || connected?.name || 'Player',
    status: room ? 'playing' : (connected ? 'online' : 'offline'),
    modeLabel: room ? modeLabel(room.settings?.gamemode) : (connected ? 'In Lobby' : 'Offline'),
    roomCode: hiddenRoom ? null : connected.roomCode,
    joinable: !!room && !hiddenRoom && room.players.size < maxPlayersForRoom(room),
    lastSeenAt: connected ? Date.now() : (lastSeen ? new Date(lastSeen).getTime() : null)
  };
}

async function buildFriendsPayload(requester) {
  const empty = { generatedAt: Date.now(), friends: [], incoming: [], outgoing: [] };
  if (!requester?.accountId || requester.guest || !db.isEnabled()) return empty;
  const rows = await db.getFriendships(requester.accountId);
  for (const row of rows) {
    const presence = publicFriendPresence(row.other_id, row.other_username, row.other_last_seen);
    if (row.status === 'accepted') empty.friends.push(presence);
    else if (String(row.requested_by) === String(requester.accountId)) empty.outgoing.push(presence);
    else empty.incoming.push(presence);
  }
  empty.friends.sort((a, b) => (
    Number(b.status === 'playing') - Number(a.status === 'playing') ||
    Number(b.status === 'online') - Number(a.status === 'online') ||
    a.username.localeCompare(b.username)
  ));
  return empty;
}

function sendFriendsData(client) {
  buildFriendsPayload(client)
    .then(payload => send(client, 'friendsData', payload))
    .catch((error) => {
      console.error('[friends]', error.message);
      send(client, 'friendsData', { generatedAt: Date.now(), friends: [], incoming: [], outgoing: [] });
    });
}

async function sendFriendInventory(client, data = {}) {
  const accountId = String(data.accountId || '').trim();
  const unavailable = (message) => send(client, 'friendInventoryData', { ok: false, accountId, inventory: [], message });
  if (!client.accountId || client.guest || !db.isEnabled()) {
    unavailable('Friend inventories require a signed-in account.');
    return;
  }
  if (!/^\d+$/.test(accountId) || accountId === String(client.accountId)) {
    unavailable('Choose one of your friends.');
    return;
  }
  try {
    if (!await db.areFriends(client.accountId, accountId)) {
      unavailable('Only accepted friends can view this inventory.');
      return;
    }
    const inventory = (await db.getSkinInventory(accountId)).map(entry => ({
      id: entry.id,
      item_id: entry.item_id,
      pattern_seed: Number(entry.pattern_seed || 0),
      rarity_tier: entry.rarity_tier || null,
      wear_value: Number(entry.wear_value || 0),
      wear_seed: Number(entry.wear_seed || 0)
    }));
    send(client, 'friendInventoryData', { ok: true, accountId, inventory });
  } catch (error) {
    console.error('[friend-inventory]', error.message);
    unavailable('Could not load this inventory.');
  }
}

async function buildRecentPlayersPayload(requester) {
  // Friends-menu Search uses this endpoint as "recent unfriended players".
  // The DB query applies the 24h window and accepted-friend exclusion; presence
  // is added here so join buttons reflect the current room state.
  const empty = { generatedAt: Date.now(), players: [] };
  if (!requester?.accountId || requester.guest || !db.isEnabled()) return empty;
  const rows = await db.getRecentPlayerEncounters(requester.accountId, 24, 50);
  empty.players = rows.map(row => ({
    ...publicFriendPresence(row.account_id, row.username, row.last_seen),
    lastPlayedAt: row.last_seen ? new Date(row.last_seen).getTime() : null
  }));
  return empty;
}

function sendRecentPlayersData(client) {
  buildRecentPlayersPayload(client)
    .then(payload => send(client, 'recentPlayersData', payload))
    .catch((error) => {
      console.error('[recent-players]', error.message);
      send(client, 'recentPlayersData', { generatedAt: Date.now(), players: [] });
    });
}

function refreshFriendAccounts(...accountIds) {
  const seen = new Set(accountIds.map(id => String(id || '')).filter(Boolean));
  for (const accountId of seen) {
    const connected = onlineClientForAccount(accountId);
    if (connected) sendFriendsData(connected);
  }
}

function refreshFriendPresence(accountId) {
  if (!accountId || !db.isEnabled()) return;
  db.getFriendships(accountId)
    .then(rows => refreshFriendAccounts(accountId, ...rows.map(row => row.other_id)))
    .catch(error => console.error('[friend-presence]', error.message));
}

function friendActionAllowed(client) {
  if (client.accountId && !client.guest && db.isEnabled()) return true;
  send(client, 'friendNotice', { ok: false, message: 'Log in to use friends.' });
  return false;
}

function handleFriendRequest(client, data) {
  if (!friendActionAllowed(client)) return;
  const username = String(data.username || '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (username.length < 2) {
    send(client, 'friendNotice', { ok: false, message: 'Enter a valid username.' });
    return;
  }
  db.createFriendRequest(client.accountId, username).then((result) => {
    const messages = {
      sent: `Friend request sent to ${result.target?.username || username}.`,
      not_found: 'No account has that username.',
      self: 'You cannot add yourself.',
      already_friends: `You are already friends with ${result.target?.username || username}.`,
      already_sent: 'That friend request is already pending.',
      incoming_exists: 'They already sent you a request. Accept it below.'
    };
    const ok = result.state === 'sent' || result.state === 'already_friends';
    send(client, 'friendNotice', { ok, message: messages[result.state] || 'Could not send that request.' });
    refreshFriendAccounts(client.accountId, result.target?.id);
    if (result.state === 'sent') {
      const targetClient = onlineClientForAccount(result.target?.id);
      if (targetClient) send(targetClient, 'friendNotice', { ok: true, message: `${client.accountName || client.name} sent you a friend request.` });
    }
  }).catch((error) => {
    console.error('[friend-request]', error.message);
    send(client, 'friendNotice', { ok: false, message: 'Could not send that friend request.' });
  });
}

function handleFriendRespond(client, data) {
  if (!friendActionAllowed(client)) return;
  const otherId = String(data.accountId || '');
  if (!/^\d+$/.test(otherId)) return;
  const accept = data.accept === true;
  db.respondFriendRequest(client.accountId, otherId, accept).then((row) => {
    if (!row) {
      send(client, 'friendNotice', { ok: false, message: 'That friend request is no longer pending.' });
      return;
    }
    send(client, 'friendNotice', { ok: true, message: accept ? 'Friend request accepted.' : 'Friend request declined.' });
    const other = onlineClientForAccount(otherId);
    if (other) send(other, 'friendNotice', { ok: true, message: accept ? `${client.accountName || client.name} accepted your friend request.` : 'A friend request was declined.' });
    refreshFriendAccounts(client.accountId, otherId);
  }).catch((error) => {
    console.error('[friend-respond]', error.message);
    send(client, 'friendNotice', { ok: false, message: 'Could not update that friend request.' });
  });
}

function handleFriendRemove(client, data) {
  if (!friendActionAllowed(client)) return;
  const otherId = String(data.accountId || '');
  if (!/^\d+$/.test(otherId)) return;
  db.removeFriend(client.accountId, otherId).then((row) => {
    send(client, 'friendNotice', { ok: !!row, message: row ? 'Friend removed.' : 'That friendship no longer exists.' });
    refreshFriendAccounts(client.accountId, otherId);
  }).catch((error) => {
    console.error('[friend-remove]', error.message);
    send(client, 'friendNotice', { ok: false, message: 'Could not remove that friend.' });
  });
}

// ---------------------------------------------------------------------------
// Parties — invite-only groups (max 5) that stick together onto a TDM team.
// State is keyed by accountId so a party survives menu navigation; a member
// is dropped from their party when their socket disconnects.
// ---------------------------------------------------------------------------
const PARTY_MAX = 5;
const PARTY_INVITE_TTL_MS = 90000;
const parties = new Map();         // partyId -> { id, leaderId, members:[accountId], invites:Map(accountId->{fromId,fromName,expires}) }
const partyByAccount = new Map();  // accountId(string) -> partyId
let partySeq = 0;

function getPartyForClient(client) {
  if (!client?.accountId) return null;
  const pid = partyByAccount.get(String(client.accountId));
  return pid ? (parties.get(pid) || null) : null;
}

function partyMemberPresence(accountId, leaderId) {
  const connected = onlineClientForAccount(accountId);
  const room = connected?.roomCode ? rooms.get(connected.roomCode) : null;
  const hiddenRoom = room && isAdminRoom(room);
  return {
    accountId: String(accountId),
    username: connected?.accountName || connected?.name || 'Player',
    status: room ? 'playing' : (connected ? 'online' : 'offline'),
    modeLabel: room ? modeLabel(room.settings?.gamemode) : (connected ? 'In Lobby' : 'Offline'),
    roomCode: hiddenRoom ? null : (connected?.roomCode || null),
    leader: String(accountId) === String(leaderId)
  };
}

function buildPartyPayload(party) {
  if (!party) return { inParty: false, partyId: null, leaderId: null, members: [] };
  return {
    inParty: true,
    partyId: party.id,
    leaderId: String(party.leaderId),
    members: party.members.map(id => partyMemberPresence(id, party.leaderId))
  };
}

function sendPartyData(client) {
  if (client) send(client, 'partyData', buildPartyPayload(getPartyForClient(client)));
}

function broadcastPartyData(party) {
  if (!party) return;
  const payload = buildPartyPayload(party);
  for (const id of party.members) {
    const c = onlineClientForAccount(id);
    if (c) send(c, 'partyData', payload);
  }
}

// Refresh party UI for a member's group whenever their presence changes.
function touchPartyPresence(client) {
  const party = getPartyForClient(client);
  if (party) broadcastPartyData(party);
}

function pruneInvites(party) {
  const now = Date.now();
  for (const [id, inv] of party.invites) if (inv.expires <= now) party.invites.delete(id);
}

function createPartyFor(client) {
  partySeq += 1;
  const id = 'p' + partySeq;
  const party = { id, leaderId: String(client.accountId), members: [String(client.accountId)], invites: new Map() };
  parties.set(id, party);
  partyByAccount.set(String(client.accountId), id);
  return party;
}

function removeFromParty(accountId, opts = {}) {
  const myId = String(accountId || '');
  const pid = partyByAccount.get(myId);
  if (!pid) return;
  partyByAccount.delete(myId);
  const party = parties.get(pid);
  if (!party) return;
  party.members = party.members.filter(id => id !== myId);
  party.invites.delete(myId);
  if (party.members.length <= 1) {
    // A party of one isn't a party — disband and notify the lone member.
    for (const id of party.members) partyByAccount.delete(id);
    parties.delete(party.id);
    if (!opts.silent) for (const id of party.members) { const c = onlineClientForAccount(id); if (c) sendPartyData(c); }
    return;
  }
  if (String(party.leaderId) === myId) party.leaderId = party.members[0];
  if (!opts.silent) broadcastPartyData(party);
}

async function handlePartyInvite(client, data) {
  if (!client.accountId || client.guest || !db.isEnabled()) { send(client, 'partyNotice', { ok: false, message: 'Log in to use parties.' }); return; }
  const targetId = String(data.accountId || '');
  if (!/^\d+$/.test(targetId)) return;
  if (targetId === String(client.accountId)) { send(client, 'partyNotice', { ok: false, message: 'You cannot invite yourself.' }); return; }
  try {
    if (!await db.areFriends(client.accountId, targetId)) {
      send(client, 'partyNotice', { ok: false, message: 'Add them as a friend before inviting.' });
      return;
    }
    const target = onlineClientForAccount(targetId);
    if (!target) { send(client, 'partyNotice', { ok: false, message: 'That friend is offline.' }); return; }
    let party = getPartyForClient(client);
    if (party && String(party.leaderId) !== String(client.accountId)) { send(client, 'partyNotice', { ok: false, message: 'Only the party leader can invite.' }); return; }
    if (!party) party = createPartyFor(client);
    pruneInvites(party);
    if (party.members.length + party.invites.size >= PARTY_MAX) { send(client, 'partyNotice', { ok: false, message: 'Your party is full.' }); return; }
    if (party.members.includes(targetId)) { send(client, 'partyNotice', { ok: false, message: 'They are already in your party.' }); return; }
    if (partyByAccount.get(targetId)) { send(client, 'partyNotice', { ok: false, message: 'They are already in a party.' }); return; }
    const fromName = client.accountName || client.name || 'Player';
    party.invites.set(targetId, { fromId: String(client.accountId), fromName, expires: Date.now() + PARTY_INVITE_TTL_MS });
    send(target, 'partyInvited', { partyId: party.id, fromId: String(client.accountId), fromName });
    send(client, 'partyNotice', { ok: true, message: `Invite sent to ${target.accountName || target.name}.` });
    broadcastPartyData(party);
  } catch (error) {
    console.error('[party-invite]', error.message);
    send(client, 'partyNotice', { ok: false, message: 'Could not send that party invite.' });
  }
}

function handlePartyRespond(client, data) {
  if (!client.accountId || client.guest) return;
  const party = parties.get(String(data.partyId || ''));
  const myId = String(client.accountId);
  if (party) pruneInvites(party);
  if (!party || !party.invites.has(myId)) { send(client, 'partyNotice', { ok: false, message: 'That invite has expired.' }); return; }
  party.invites.delete(myId);
  if (data.accept !== true) {
    const leader = onlineClientForAccount(party.leaderId);
    if (leader) send(leader, 'partyNotice', { ok: true, message: `${client.accountName || client.name} declined the invite.` });
    broadcastPartyData(party);
    return;
  }
  if (party.members.length >= PARTY_MAX) { send(client, 'partyNotice', { ok: false, message: 'That party is now full.' }); return; }
  removeFromParty(myId, { silent: true }); // leave any existing party first
  party.members.push(myId);
  partyByAccount.set(myId, party.id);
  send(client, 'partyNotice', { ok: true, message: 'Joined the party.' });
  broadcastPartyData(party);
}

function handlePartyLeave(client) {
  if (!client.accountId) return;
  const party = getPartyForClient(client);
  if (party && party.members.length > 1) {
    const leaver = client.accountName || client.name;
    for (const id of party.members) {
      if (id === String(client.accountId)) continue;
      const c = onlineClientForAccount(id);
      if (c) send(c, 'partyNotice', { ok: true, message: `${leaver} left the party.` });
    }
  }
  removeFromParty(client.accountId);
  sendPartyData(client);
}

function handlePartyKick(client, data) {
  if (!client.accountId) return;
  const party = getPartyForClient(client);
  if (!party || String(party.leaderId) !== String(client.accountId)) return;
  const targetId = String(data.accountId || '');
  if (!/^\d+$/.test(targetId) || targetId === String(client.accountId)) return;
  if (!party.members.includes(targetId)) return;
  const target = onlineClientForAccount(targetId);
  removeFromParty(targetId);
  if (target) { send(target, 'partyNotice', { ok: true, message: 'You were removed from the party.' }); sendPartyData(target); }
}

// Same-team grouping: when a party member loads into a team mode, drop them on
// the team a party-mate is already on. If they're the first member here, normal
// balancing applies ("a new match with no one else in it").
function partyTeamForRoom(client, room, roomCode) {
  if (!client?.accountId || !MODE_CONFIG[room.settings?.gamemode]?.teams) return null;
  const party = getPartyForClient(client);
  if (!party) return null;
  for (const mate of party.members) {
    if (mate === String(client.accountId)) continue;
    const mateClient = onlineClientForAccount(mate);
    if (!mateClient || mateClient.roomCode !== roomCode) continue;
    const matePlayer = room.players.get(mateClient.id);
    if (matePlayer && (matePlayer.team === 0 || matePlayer.team === 1)) return matePlayer.team;
  }
  return null;
}

async function newsPayload() {
  if (db.isEnabled()) {
    const rows = await db.getNewsMessages(100);
    if (rows.length) return rows;
  }
  return newsMemory.slice().reverse();
}

function handleGetNews(client) {
  newsPayload()
    .then(messages => send(client, 'newsData', { messages, canPost: isAdminUser(client) }))
    .catch((error) => {
      console.error('[news]', error.message);
      send(client, 'newsData', { messages: newsMemory.slice().reverse(), canPost: isAdminUser(client) });
    });
}

async function broadcastNewsData() {
  const messages = await newsPayload();
  for (const connected of clients.values()) {
    if (connected.authed) send(connected, 'newsData', { messages, canPost: isAdminUser(connected) });
  }
  return messages;
}

function handlePostNews(client, data) {
  const title = String(data.title || '').replace(/\s+/g, ' ').trim();
  const bodyText = String(data.body || '').replace(/\s+/g, ' ').trim();
  const body = sanitizeNewsBody(data.bodyHtml || data.body || '');
  if (!title || !bodyText) {
    send(client, 'newsNotice', { ok: false, message: 'News needs both a title and a message.' });
    return;
  }
  const record = {
    id: `memory-${Date.now()}`,
    title,
    body,
    author_id: client.accountId || null,
    author_name: client.accountName || client.name || 'Admin',
    created_at: new Date().toISOString()
  };
  (async () => {
    const saved = db.isEnabled() ? await db.createNewsMessage({
      title,
      body,
      authorId: client.accountId,
      authorName: record.author_name
    }) : record;
    if (!db.isEnabled()) newsMemory.push(saved);
    await broadcastNewsData();
    send(client, 'newsNotice', { ok: true, message: 'News published.' });
  })().catch((error) => {
    console.error('[news-post]', error.message);
    send(client, 'newsNotice', { ok: false, message: 'Could not publish the news message.' });
  });
}

function sanitizeNewsBody(input) {
  let html = String(input || '').trim();
  if (!html) return '';
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\son\w+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:href|src)=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<(\/?)(strong|em)\b[^>]*>/gi, '<$1$2>')
    .replace(/<(\/?)b\b[^>]*>/gi, '<$1b>')
    .replace(/<(\/?)i\b[^>]*>/gi, '<$1i>')
    .replace(/<br\b[^>]*>/gi, '<br>')
    .replace(/<(\/?)(p|div)\b[^>]*>/gi, '<$1$2>')
    .replace(/<font\b[^>]*size=["']?([1-7])["']?[^>]*>/gi, (_match, size) => `<font size="${size}">`)
    .replace(/<\/font>/gi, '</font>')
    .replace(/<span\b[^>]*style=["'][^"']*font-size\s*:\s*(0\.\d+|1(?:\.\d+)?|2(?:\.\d+)?)em;?[^"']*["'][^>]*>/gi, (_match, size) => `<span style="font-size:${size}em">`)
    .replace(/<\/span>/gi, '</span>')
    .replace(/<(?!\/?(?:b|strong|i|em|br|p|div|font|span)(?:\s|>|\/))/gi, '&lt;');
  return html;
}

function handleDeleteNews(client, data) {
  const id = String(data?.id || '').trim().slice(0, 80);
  if (!id) {
    send(client, 'newsNotice', { ok: false, message: 'Choose a news article to delete.' });
    return;
  }
  (async () => {
    let deleted = false;
    if (db.isEnabled() && /^\d+$/.test(id)) deleted = await db.deleteNewsMessage(id);
    if (!deleted) {
      const memoryIndex = newsMemory.findIndex(message => String(message.id) === id);
      if (memoryIndex >= 0) {
        newsMemory.splice(memoryIndex, 1);
        deleted = true;
      }
    }
    if (!deleted) {
      send(client, 'newsNotice', { ok: false, message: 'News article was already gone.' });
      return;
    }
    await broadcastNewsData();
    send(client, 'newsNotice', { ok: true, message: 'News article deleted.' });
  })().catch((error) => {
    console.error('[news-delete]', error.message);
    send(client, 'newsNotice', { ok: false, message: 'Could not delete the news article.' });
  });
}

function buildOwnerAdminPayload() {
  return {
    generatedAt: Date.now(),
    uiConfig: publicUiConfig(),
    rooms: Array.from(rooms.entries())
      .filter(([roomCode]) => roomCode !== ADMIN_ROOM_CODE)
      .map(([roomCode, room]) => ({
        roomCode,
        hostId: room.hostId,
        modeLabel: modeLabel(room.settings?.gamemode),
        players: Array.from(room.players.values()).map(p => ({
          id: p.id,
          name: p.name || 'Player',
          accountId: p.accountId || null,
          guest: !p.accountId,
          deviceId: clients.get(p.id)?.deviceId || null,
          kills: p.kills || 0,
          deaths: p.deaths || 0
        }))
      }))
  };
}

async function handleOwnerAdminBan(client, data = {}) {
  const targetId = String(data.targetId || '');
  if (!targetId || targetId === client.id) return;
  const targetClient = clients.get(targetId);
  const room = targetClient?.roomCode ? rooms.get(targetClient.roomCode) : null;
  const targetPlayer = room?.players?.get(targetId) || null;
  const accountId = targetClient?.accountId || targetPlayer?.accountId || null;
  const deviceId = targetClient?.deviceId || null;
  if (!accountId && !deviceId) return;
  const reason = sanitizeChatMessage(data.reason || 'owner admin permanent ban') || 'owner admin permanent ban';
  try {
    if (accountId) {
      await bans.banAccount({ accountId, deviceId, reason, byAdmin: client.accountName || 'owner', expiresAt: null });
      kickAccountSessions(accountId, 'banned');
    } else if (deviceId) {
      await bans.banDevice({ deviceId, reason, byAdmin: client.accountName || 'owner', expiresAt: null });
      if (targetClient) removePlayerFromRoom(targetId, 'banned');
      try { targetClient?.ws?.close(); } catch {}
    }
    send(client, 'ownerAdminNotice', { ok: true, message: `Banned ${targetPlayer?.name || targetClient?.name || 'player'} permanently.` });
    send(client, 'ownerAdminData', buildOwnerAdminPayload());
  } catch (e) {
    console.error('[owner-admin-ban]', e.message);
    send(client, 'ownerAdminNotice', { ok: false, message: 'Ban failed.' });
  }
}

function handleOwnerAdminDeleteRoom(client, data = {}) {
  const roomCode = String(data.roomCode || '').trim().toUpperCase();
  if (!roomCode || roomCode === ADMIN_ROOM_CODE) return;
  const room = rooms.get(roomCode);
  if (!room) return;
  for (const playerId of Array.from(room.players.keys())) {
    removePlayerFromRoom(playerId, 'room_deleted');
  }
  clearRoomRoundTimer(room);
  rooms.delete(roomCode);
  removeRoomDirectory(roomCode, room);
  send(client, 'ownerAdminNotice', { ok: true, message: `Deleted lobby ${roomCode}.` });
  send(client, 'ownerAdminData', buildOwnerAdminPayload());
}

// ---- Admin ban manager (any admin account) --------------------------------
function onlineNameForAccount(accountId) {
  for (const c of clients.values()) {
    if (c.accountId != null && String(c.accountId) === String(accountId)) return c.accountName || c.name;
  }
  return null;
}

async function buildAdminBanPayload() {
  let bansList = [];
  if (db.isEnabled()) {
    try {
      const rows = await db.getActiveAccountBansWithNames();
      const seen = new Set();
      for (const r of rows) {
        const acct = String(r.account_id);
        if (seen.has(acct)) continue;
        seen.add(acct);
        bansList.push({
          accountId: acct,
          username: r.username || onlineNameForAccount(acct) || `#${acct}`,
          reason: r.reason || '',
          expiresAt: r.expires_at ? new Date(r.expires_at).getTime() : null
        });
      }
    } catch (e) {
      console.error('[admin-ban-list]', e.message);
    }
  } else {
    bansList = bans.listActiveAccounts().map(b => ({
      accountId: String(b.accountId),
      username: onlineNameForAccount(b.accountId) || `#${b.accountId}`,
      reason: b.reason || '',
      expiresAt: b.expiresAt || null
    }));
  }
  // Online account -> socket id (for kicking) and the list of online guests.
  const onlineByAccount = new Map();
  const onlineGuests = [];
  for (const c of clients.values()) {
    if (!c.authed) continue;
    if (c.accountId != null) onlineByAccount.set(String(c.accountId), c.id);
    else onlineGuests.push({ id: c.id, name: c.name || 'Guest', violationCount: Number(c.localViolationCount || 0) });
  }
  onlineGuests.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const bannedSet = new Set(bansList.map(b => String(b.accountId)));
  // Every registered account (online or offline) so admins can ban anyone.
  let accounts = [];
  if (db.isEnabled()) {
    try {
      const [rows, violationRows] = await Promise.all([db.listAccounts(), db.getViolationCounts()]);
      const violationCounts = new Map(violationRows.map(row => [String(row.account_id), Number(row.violation_count) || 0]));
      accounts = rows.map(r => ({
        accountId: String(r.id),
        username: r.username || `#${r.id}`,
        role: r.role || 'user',
        online: onlineByAccount.has(String(r.id)),
        banned: bannedSet.has(String(r.id)),
        violationCount: violationCounts.get(String(r.id)) || 0
      }));
    } catch (e) {
      console.error('[admin-account-list]', e.message);
    }
  } else {
    for (const accountId of onlineByAccount.keys()) {
      accounts.push({ accountId, username: onlineNameForAccount(accountId) || `#${accountId}`, online: true, banned: bannedSet.has(accountId), violationCount: 0 });
    }
  }
  accounts.sort((a, b) => (Number(b.violationCount || 0) - Number(a.violationCount || 0)) || (Number(b.online) - Number(a.online)) || String(a.username).localeCompare(String(b.username)));

  return { bans: bansList, accounts, onlineGuests };
}

function handleClientSecurityEvent(client, data = {}) {
  if (!client.accountId || client.guest || !db.isEnabled()) return;
  const now = Date.now();
  client.securityEventCount = Number(client.securityEventCount || 0);
  if (client.securityEventCount >= 40 || now - Number(client.lastSecurityEventAt || 0) < 750) return;
  const kind = ['console_command', 'runtime_eval', 'integrity_change'].includes(data.kind) ? data.kind : null;
  if (!kind) return;
  const detail = String(data.detail || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500);
  client.securityEventCount++;
  client.lastSecurityEventAt = now;
  db.logViolation(client.accountId, `client_${kind}`, detail || kind, client.deviceId)
    .catch(error => console.error('[client-security]', error.message));
}

function tamperRestrictionMinutes(data = {}) {
  const direct = data.amount ?? data.value ?? data.coins ?? data.mowcoins ?? data.mowbucks ?? data.quantity;
  const fromDirect = Number(direct);
  if (Number.isFinite(fromDirect)) return Math.max(1, Math.min(1440, Math.floor(Math.abs(fromDirect))));
  const text = JSON.stringify(data || {});
  const matches = text.match(/-?\d+(?:\.\d+)?/g) || [];
  const largest = matches.reduce((max, value) => Math.max(max, Math.abs(Number(value) || 0)), 0);
  return Math.max(1, Math.min(1440, Math.floor(largest || 1)));
}

async function handleUnauthorizedEconomyCommand(client, type, data = {}) {
  const minutes = tamperRestrictionMinutes(data);
  const expiresAt = new Date(Date.now() + minutes * 60000).toISOString();
  const reason = `unauthorized economy command: ${type}`;
  try {
    if (client.accountId) {
      await bans.banAccount({ accountId: client.accountId, deviceId: client.deviceId, reason, byAdmin: 'server', expiresAt });
      if (db.isEnabled()) await db.logViolation(client.accountId, 'unauthorized_economy_command', `${type} blocked for ${minutes}m`, client.deviceId);
    } else if (client.deviceId) {
      await bans.banDevice({ deviceId: client.deviceId, reason, byAdmin: 'server', expiresAt });
    }
  } catch (error) {
    console.error('[tamper-ban]', error.message);
  }
  send(client, 'authError', {
    code: 'banned',
    message: `Unauthorized economy command blocked. Temporary restriction: ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    reason,
    expiresAt
  });
  if (client.roomCode) removePlayerFromRoom(client.id, 'banned');
  try { client.ws.close(); } catch {}
}

const ADMIN_BAN_MAX_MS = 365 * 24 * 3600 * 1000;
async function handleAdminBanPlayer(client, data = {}) {
  // Target by online socket (online player or guest) OR by accountId (offline).
  let accountId = data.accountId ? String(data.accountId) : null;
  let deviceId = null;
  let name = null;
  let onlineTargetId = null;

  if (data.targetId) {
    const targetId = String(data.targetId);
    if (targetId === client.id) {
      send(client, 'adminBanNotice', { ok: false, message: 'You cannot ban yourself.' });
      return;
    }
    const tc = clients.get(targetId);
    if (tc) {
      onlineTargetId = targetId;
      const room = tc.roomCode ? rooms.get(tc.roomCode) : null;
      const tp = room?.players?.get(targetId) || null;
      accountId = tc.accountId || tp?.accountId || accountId;
      deviceId = tc.deviceId || null;
      name = tc.accountName || tc.name || tp?.name || null;
    }
  }

  if (accountId && String(accountId) === String(client.accountId)) {
    send(client, 'adminBanNotice', { ok: false, message: 'You cannot ban yourself.' });
    return;
  }
  if (!accountId && !deviceId) {
    send(client, 'adminBanNotice', { ok: false, message: 'That player is offline (no account/device to ban).' });
    return;
  }
  // Resolve a display name for an offline account ban.
  if (!name && accountId && db.isEnabled()) {
    try { const a = await db.getAccountById(accountId); name = a?.username || null; } catch {}
  }
  name = name || (accountId ? `#${accountId}` : 'player');

  const durationMs = Number(data.durationMs);
  const permanent = !Number.isFinite(durationMs) || durationMs <= 0;
  const expiresAt = permanent ? null : new Date(Date.now() + Math.min(durationMs, ADMIN_BAN_MAX_MS)).toISOString();
  const label = permanent ? 'permanently' : `until ${new Date(expiresAt).toUTCString()}`;
  const reason = sanitizeChatMessage(data.reason || `admin ban (${label})`) || 'admin ban';
  try {
    if (accountId) {
      await bans.banAccount({ accountId, deviceId, reason, byAdmin: client.accountName || 'admin', expiresAt });
      kickAccountSessions(accountId, 'banned'); // kicks any live sessions; no-op if offline
    } else {
      await bans.banDevice({ deviceId, reason, byAdmin: client.accountName || 'admin', expiresAt });
      if (onlineTargetId) { removePlayerFromRoom(onlineTargetId, 'banned'); try { clients.get(onlineTargetId)?.ws?.close(); } catch {} }
    }
    send(client, 'adminBanNotice', { ok: true, message: `Banned ${name} ${label}.` });
    send(client, 'adminBanData', await buildAdminBanPayload());
  } catch (e) {
    console.error('[admin-ban]', e.message);
    send(client, 'adminBanNotice', { ok: false, message: 'Ban failed.' });
  }
}

async function handleAdminUnbanPlayer(client, data = {}) {
  const accountId = String(data.accountId || '');
  if (!accountId) {
    send(client, 'adminBanNotice', { ok: false, message: 'Invalid account.' });
    return;
  }
  try {
    await bans.unban({ accountId });
    send(client, 'adminBanNotice', { ok: true, message: 'Player unbanned.' });
    send(client, 'adminBanData', await buildAdminBanPayload());
  } catch (e) {
    console.error('[admin-unban]', e.message);
    send(client, 'adminBanNotice', { ok: false, message: 'Unban failed.' });
  }
}

async function handleAdminClearPlayerInventory(client, data = {}) {
  if (!db.isEnabled()) {
    send(client, 'adminBanNotice', { ok: false, message: 'Inventory clearing needs the database.' });
    return;
  }
  const accountId = String(data.accountId || '').trim();
  if (!/^\d+$/.test(accountId)) {
    send(client, 'adminBanNotice', { ok: false, message: 'Choose a valid account.' });
    return;
  }
  try {
    const account = await db.getAccountById(accountId);
    if (!account) {
      send(client, 'adminBanNotice', { ok: false, message: 'That account no longer exists.' });
      return;
    }
    const cleared = await db.clearPlayerInventory(accountId);
    const target = findClientByAccountId(accountId);
    if (target) {
      target.skinLoadout = {};
      publishPlayerSkinLoadout(target);
      sendSkinInventory(target);
      send(target, 'marketNotice', { ok: true, message: 'An admin cleared your skin and case inventory.' });
    }
    send(client, 'adminBanNotice', {
      ok: true,
      message: `Cleared ${account.username}: ${cleared.skins} skin${cleared.skins === 1 ? '' : 's'}, ${cleared.cases} case stack${cleared.cases === 1 ? '' : 's'}.`
    });
    send(client, 'adminBanData', await buildAdminBanPayload());
  } catch (error) {
    console.error('[admin-clear-inventory]', error.message);
    send(client, 'adminBanNotice', { ok: false, message: 'Could not clear that inventory.' });
  }
}

// ---------------------------------------------------------------------------
// Admin inventory editing
//
// Per-item counterpart to handleAdminClearPlayerInventory above: add cases,
// add skins, change a skin's wear, remove either. Callers are already checked
// for admin in the dispatch; nothing below re-checks, so the gate must stay
// there.
//
// Two rules run through all of it. Ids are validated against the catalog
// rather than trusted, so a packet naming a skin or case that does not exist
// never reaches the database. And the target's own client is refreshed after
// every change, so a player watching their inventory sees the edit rather
// than a stale list they might then act on.
// ---------------------------------------------------------------------------

async function resolveAdminInventoryTarget(data = {}) {
  const username = String(data.username || '').trim();
  const accountId = String(data.accountId || '').trim();
  if (/^\d+$/.test(accountId)) return db.getAccountById(accountId);
  if (username) return db.findAccountByUsername(username);
  return null;
}

function adminInventoryFail(client, message) {
  send(client, 'adminInventoryStatus', { ok: false, message });
}

// Push the account's current state back to the admin, and to the player if
// they happen to be online.
async function sendAdminInventorySnapshot(client, account, status) {
  const snapshot = await db.adminInventorySnapshot(account.id);
  const customCases = await getCustomCaseDefinitions();
  send(client, 'adminInventoryData', {
    account: { id: Number(account.id), username: account.username },
    skins: snapshot.skins,
    cases: snapshot.cases,
    // The pickers are driven by these, so an admin can only ever choose an id
    // the server would accept anyway.
    caseCatalog: customCases.map(row => ({ id: row.id, name: row.displayName || row.id })),
    status: status || null
  });
  const target = findClientByAccountId(String(account.id));
  if (target) sendSkinInventory(target);
}

function handleAdminInventoryLookup(client, data = {}) {
  if (!db.isEnabled()) { adminInventoryFail(client, 'Inventory editing needs the database.'); return; }
  (async () => {
    const account = await resolveAdminInventoryTarget(data);
    if (!account) { adminInventoryFail(client, 'No account with that name.'); return; }
    await sendAdminInventorySnapshot(client, account);
  })().catch(error => {
    console.error('[admin-inventory] lookup failed:', error.message);
    adminInventoryFail(client, 'Could not read that inventory.');
  });
}

const ADMIN_INVENTORY_LOCK_MESSAGE = {
  listed: 'That skin is on the market. Cancel the listing first.',
  trading: 'That skin is in a pending trade. Cancel the trade first.',
  missing: 'That item is no longer in the inventory.',
  invalid: 'That is not a valid value.'
};

function handleAdminInventoryEdit(client, data = {}) {
  if (!db.isEnabled()) { adminInventoryFail(client, 'Inventory editing needs the database.'); return; }
  const action = String(data.action || '').trim();

  (async () => {
    const account = await resolveAdminInventoryTarget(data);
    if (!account) { adminInventoryFail(client, 'No account with that name.'); return; }
    const accountId = Number(account.id);
    let status = null;

    if (action === 'grantSkin') {
      // The catalog is the allowlist: an id that is not a real skin never
      // reaches the inventory, whatever the packet claims.
      const item = skins.getItem(String(data.itemId || '').trim());
      if (!item) { adminInventoryFail(client, 'That skin does not exist.'); return; }
      const wear = Number(data.wear);
      const granted = await db.grantSkinToAccount({
        accountId,
        itemId: item.id,
        rarityTier: item.rarity || null,
        wearValue: Number.isFinite(wear) ? wear : undefined
      });
      if (!granted) { adminInventoryFail(client, 'Could not grant that skin.'); return; }
      status = `Added ${item.id} to ${account.username}.`;

    } else if (action === 'grantCase') {
      const caseId = String(data.caseId || '').trim();
      const customCases = await getCustomCaseDefinitions();
      if (!customCases.some(row => row.id === caseId)) {
        adminInventoryFail(client, 'That case does not exist.');
        return;
      }
      const quantity = Math.max(1, Math.min(1000, Math.floor(Number(data.quantity) || 1)));
      const granted = await db.grantCases(accountId, caseId, quantity);
      if (!granted) { adminInventoryFail(client, 'Could not add that case.'); return; }
      status = `Added ${quantity} x ${caseId} to ${account.username}.`;

    } else if (action === 'setWear') {
      const result = await db.adminSetSkinWear({
        accountId,
        inventoryId: data.inventoryId,
        wearValue: data.wear
      });
      if (!result.ok) {
        adminInventoryFail(client, ADMIN_INVENTORY_LOCK_MESSAGE[result.reason] || 'Could not change that wear.');
        return;
      }
      status = `Set ${result.item.item_id} wear to ${Number(result.item.wear_value).toFixed(3)}.`;

    } else if (action === 'removeSkin') {
      const result = await db.adminRemoveSkinInstance({ accountId, inventoryId: data.inventoryId });
      if (!result.ok) {
        adminInventoryFail(client, ADMIN_INVENTORY_LOCK_MESSAGE[result.reason] || 'Could not remove that skin.');
        return;
      }
      // Say what else was unwound, because an admin removing an item does not
      // necessarily know it was listed or mid-trade.
      const extra = [];
      if (result.cancelledListings) extra.push(`${result.cancelledListings} listing cancelled`);
      if (result.cancelledTrades) extra.push(`${result.cancelledTrades} trade cancelled`);
      if (result.refunded) extra.push(`${result.refunded} refunded to bidders`);
      status = `Removed ${result.itemId}${extra.length ? ` (${extra.join(', ')})` : ''}.`;

    } else if (action === 'removeCase') {
      const result = await db.adminRemoveCases({
        accountId,
        caseId: data.caseId,
        quantity: data.quantity
      });
      if (!result.ok) {
        adminInventoryFail(client, ADMIN_INVENTORY_LOCK_MESSAGE[result.reason] || 'Could not remove that case.');
        return;
      }
      status = `Removed ${result.removed} x ${result.caseId}.`;

    } else {
      adminInventoryFail(client, 'Unknown inventory action.');
      return;
    }

    console.log(`[admin-inventory] ${client.username} ${action} on ${account.username}: ${status}`);
    try {
      db.logIpEvent({
        event: 'admin_inventory_edit',
        accountId: client.accountId,
        detail: `${account.id}:${action}`
      });
    } catch {}
    await sendAdminInventorySnapshot(client, account, status);
  })().catch(error => {
    console.error('[admin-inventory] edit failed:', error.message);
    adminInventoryFail(client, 'That inventory edit failed.');
  });
}

function liveDailyRows(dateKey) {
  const rows = [];
  for (const client of clients.values()) {
    if (isAdminRoom(rooms.get(client.roomCode))) continue;
    const d = client.dailyDelta;
    if (!client.accountId || client.guest || !d || d.dateKey !== dateKey || dailyDeltaIsEmpty(d)) continue;
    rows.push({
      player_key: dailyPlayerKey(client),
      username: client.name || client.accountName || 'Player',
      wins: d.wins,
      kills: d.kills,
      deaths: d.deaths,
      shots_fired: d.shotsFired,
      shots_hit: d.shotsHit,
      best_streak: d.bestStreak
    });
  }
  return rows;
}

function liveAllTimeRows() {
  const rows = [];
  for (const client of clients.values()) {
    if (isAdminRoom(rooms.get(client.roomCode))) continue;
    const d = client.statDelta;
    if (!client.accountId || !d || deltaIsEmpty(d)) continue;
    rows.push({
      player_key: dailyPlayerKey(client),
      username: client.name || client.accountName || 'Player',
      wins: d.wins,
      kills: d.kills,
      deaths: d.deaths,
      shots_fired: d.shotsFired,
      shots_hit: d.shotsHit,
      best_streak: d.bestStreak
    });
  }
  return rows;
}

function handleGetLeaderboards(client) {
  const dateKey = dailyDateKey();
  const weekStart = weeklyStartDateKey();
  (async () => {
    try {
      let dailyRows;
      let weeklyRows;
      let allTimeRows;
      if (db.isEnabled()) {
        dailyRows = mergeDailyRows(await db.getDailyStats(dateKey), liveDailyRows(dateKey));
        weeklyRows = mergeDailyRows(await db.getDailyStatsRange(weekStart, dateKey), liveDailyRows(dateKey));
        allTimeRows = mergeDailyRows(await db.getAllTimeLeaderboardStats(), liveAllTimeRows());
      } else {
        const stored = Array.from(dailyStatsMemory.values()).filter(row => row.account_id != null);
        dailyRows = mergeDailyRows(stored.filter(row => row.date_key === dateKey), []);
        weeklyRows = mergeDailyRows(stored.filter(row => row.date_key >= weekStart && row.date_key <= dateKey), []);
        allTimeRows = weeklyRows;
      }
      send(client, 'leaderboardsData', buildScopedLeaderboardPayload({
        daily: buildLeaderboardPayload(dailyRows, { scope: 'daily', dateKey }),
        weekly: buildLeaderboardPayload(weeklyRows, { scope: 'weekly', startDateKey: weekStart, endDateKey: dateKey }),
        allTime: buildLeaderboardPayload(allTimeRows, { scope: 'allTime' })
      }));
    } catch (e) {
      console.error('[leaderboards]', e.message);
      send(client, 'leaderboardsData', buildScopedLeaderboardPayload({
        daily: buildLeaderboardPayload([], { scope: 'daily', dateKey }),
        weekly: buildLeaderboardPayload([], { scope: 'weekly', startDateKey: weekStart, endDateKey: dateKey }),
        allTime: buildLeaderboardPayload([], { scope: 'allTime' })
      }));
    }
  })();
}

function kickAccountSessions(accountId, reason) {
  for (const c of clients.values()) {
    if (c.accountId && String(c.accountId) === String(accountId)) {
      try {
        send(c, 'authError', { code: reason || 'banned', message: reason === 'banned' ? 'You have been banned.' : 'Session ended.' });
        c.ws.close();
      } catch {}
    }
  }
}

// ---------------------------------------------------------------------------
// Anti-cheat: movement validation
// ---------------------------------------------------------------------------
function handlePlayerState(client, room, player, data) {
  if ((player.health || 0) <= 0 || player.respawningUntil) return;
  const now = Date.now();
  if (now - client.lastStateAt < TICK_MS) return;
  client.lastStateAt = now;

  let nextPos = sanitizeVector(data.position, player.position);
  const nextRot = sanitizeVector(data.rotation, player.rotation);
  const crouching = Boolean(data.crouching);
  const walking = Boolean(data.walking);
  const jumping = Boolean(data.jumping);
  const reloading = Boolean(data.reloading);
  let weapon = String(data.weapon || player.weapon).slice(0, 32);
  // In Containment, changing slots is allowed only after that weapon has been
  // bought with match credits. A forged playerState packet cannot equip the
  // full armoury for free.
  if (isContainment(room) && !player.containmentWeapons?.includes?.(weapon)) weapon = player.weapon;
  const ac = player.ac;
  const halfMapCorrection = correctedHalfMapPosition(room, nextPos, crouching);
  if (halfMapCorrection) {
    nextPos = halfMapCorrection;
    ac.pendingCorrection = true;
    send(client, 'positionCorrection', { position: nextPos });
  }
  if (isContainment(room) && (closedContainmentGateBlocks(room, player.position, nextPos, crouching)
    || containmentNavigationBlocked(room, player.position, nextPos, crouching ? 1.7 : 2.1))) {
    nextPos = { ...player.position };
    ac.pendingCorrection = true;
    send(client, 'positionCorrection', { position: nextPos });
  }
  const movedFromCurrent = distanceBetweenVectors(player.position, nextPos) > AFK_MOVE_EPSILON;

  if (nextPos.y < deathBarrierY(room)) {
    respawnPlayer(client.roomCode, player, { reason: 'void', skipStats: isCasualWarmup(room) });
    checkCasualElimination(client.roomCode, room);
    return;
  }

  // Grace window after spawn/respawn (covers the death cam + the teleport to spawn):
  // trust the client and continuously re-anchor, so respawning never looks like a teleport.
  if ((ac.graceUntil && now < ac.graceUntil) || !ac.lastValidPos) {
    ac.lastValidPos = nextPos;
    ac.lastStateTs = now;
    ac.airborneSince = 0;
    ac.pendingCorrection = false;
    beginSpawnProtectionMoveCountdown(client, player, nextPos, now);
    if (movedFromCurrent) {
      player.activeAt = now;
      if (shouldLockBuyRefundFromMove(player, nextPos)) lockBuyRefunds(player);
      cancelBombAction(room, player.id);
    }
    applyState(player, nextPos, nextRot, weapon, crouching, walking, jumping, reloading, now);
    tryPickupDroppedBomb(client.roomCode, room, player);
    tryPickupDroppedItem(client.roomCode, room, player);
    return;
  }

  const totalDelta = distanceBetweenVectors(ac.lastValidPos, nextPos);

  // Report-only movement checks. Admins can review violation counts, but the
  // server never rubber-bands, warns, kicks, or bans from these checks.
  let violation = null;
  if (!ac.pendingCorrection && totalDelta > AC.MAX_TELEPORT) violation = 'teleport';
  ac.pendingCorrection = false;

  if (!violation) violation = checkGroundBand(room, nextPos, crouching, ac, now);

  if (violation) {
    recordViolationSafe(client, violation, violation === 'flying' ? 'sustained-above-ground' : 'movement');
  }

  beginSpawnProtectionMoveCountdown(client, player, nextPos, now);
  if (movedFromCurrent) {
    player.activeAt = now;
    if (shouldLockBuyRefundFromMove(player, nextPos)) lockBuyRefunds(player);
    cancelBombAction(room, player.id);
  }
  ac.lastValidPos = nextPos;
  ac.lastStateTs = now;
  applyState(player, nextPos, nextRot, weapon, crouching, walking, jumping, reloading, now);
  tryPickupDroppedBomb(client.roomCode, room, player);
  tryPickupDroppedItem(client.roomCode, room, player);
}

function sendSpawnProtectionUpdate(client, player, reason) {
  if (!client) return;
  const payload = {
    id: player?.id || client.id,
    until: Number(player?.invulnerableUntil) || 0,
    reason: String(reason || 'update')
  };
  if (client.roomCode) broadcastToRoom(client.roomCode, null, 'spawnProtectionUpdated', payload);
  else send(client, 'spawnProtectionUpdated', payload);
}

function clearSpawnProtection(player, now = Date.now(), client = null, reason = 'action') {
  if (player.invulnerableUntil && player.invulnerableUntil > now) {
    player.invulnerableUntil = 0;
    player.spawnProtectionStartedAt = 0;
    player.spawnProtectionOrigin = null;
    player.dirty = true;
    sendSpawnProtectionUpdate(client, player, reason);
    return true;
  }
  return false;
}

function applySpawnProtection(player, until, origin = player?.position, now = Date.now()) {
  if (!player) return;
  player.invulnerableUntil = until;
  player.spawnProtectionStartedAt = now;
  player.spawnProtectionOrigin = origin ? { x: origin.x, y: origin.y, z: origin.z } : null;
  player.dirty = true;
}

function shouldBeginSpawnProtectionMoveCountdown(player, nextPos, now = Date.now()) {
  if (!player?.invulnerableUntil || player.invulnerableUntil <= now) return false;
  if (!player.spawnProtectionOrigin) return false;
  if (player.spawnProtectionStartedAt && now - player.spawnProtectionStartedAt < SPAWN_PROTECTION_SETTLE_MS) return false;
  return distanceBetweenVectors(player.spawnProtectionOrigin, nextPos) > SPAWN_PROTECTION_MOVE_EPSILON;
}

function beginSpawnProtectionMoveCountdown(client, player, nextPos, now = Date.now()) {
  if (!shouldBeginSpawnProtectionMoveCountdown(player, nextPos, now)) return false;
  player.invulnerableUntil = now + SPAWN_PROTECTION_AFTER_MOVE_MS;
  // Clearing the origin makes this a one-shot transition; continued movement
  // cannot keep extending the three-second protection window.
  player.spawnProtectionOrigin = null;
  player.dirty = true;
  sendSpawnProtectionUpdate(client, player, 'move');
  return true;
}

function applyState(player, pos, rot, weapon, crouching, walking, jumping, reloading, now) {
  player.position = pos;
  player.rotation = rot;
  player.weapon = weapon;
  player.crouching = crouching;
  player.walking = walking;
  player.jumping = jumping;
  player.reloading = reloading;
  player.updatedAt = now;
  player.dirty = true;
}

function checkGroundBand(room, pos, crouching, ac, now) {
  const mapCollision = getMapCollision(room);
  if (!mapCollision) return null;                 // fail-open if the active map didn't parse
  if (pos.y < deathBarrierY(room) + 20) return null; // falling into the void; client sends playerVoid
  if (getRoomMapId(room) === MAP_NUKE && mapCollision.onLadder?.(pos.x, pos.y, pos.z)) {
    ac.airborneSince = 0;
    return null;
  }
  if (now - ac.lastGroundCheckTs < AC.GROUND_CHECK_EVERY_MS) return null;
  ac.lastGroundCheckTs = now;

  const eyeHeight = crouching ? 11 : 18;
  const feetY = pos.y - eyeHeight;
  const groundY = groundYForRoom(room, pos.x, pos.z, feetY + AC.GROUND_PROBE_UP);

  // No ground data (map gap, off the edge, geometry the server can't see) -> tolerate.
  // We only ever flag the one thing we can be confident about: sustained hovering.
  if (groundY === null) { ac.airborneSince = 0; return null; }

  const above = feetY - groundY;
  if (above <= AC.GROUND_BAND_ABOVE) { ac.airborneSince = 0; return null; }

  // Above the band. Genuinely falling (jumped/walked off a box) is always fine.
  const falling = ac.lastValidPos && pos.y - ac.lastValidPos.y < -2;
  if (falling) { ac.airborneSince = 0; return null; }
  // Only 'flying' if held high & not falling for a sustained time (a jump arc is brief).
  if (!ac.airborneSince) ac.airborneSince = now;
  if (now - ac.airborneSince > AC.FLY_GRACE_MS) return 'flying';
  return null;
}

function deathBarrierY(room) {
  const mapCollision = getMapCollision(room);
  if (mapCollision?.bounds && Number.isFinite(mapCollision.bounds.minY)) {
    return mapCollision.bounds.minY - DUST2_DEATH_BARRIER_MARGIN;
  }
  return AC.VOID_Y;
}

// ---------------------------------------------------------------------------
// Anti-cheat: shooting + hits
// ---------------------------------------------------------------------------
// A Breacher pull alternates buckshot / slug. The pull is identified by time,
// not by anything the client says: one pull reports each pellet as its own shot,
// all within a couple of milliseconds, while the next pull cannot arrive for
// another fire-rate interval. So the parity advances once per pull, server-side,
// and the client has no say in which load it gets.
function resolveShotgunLoad(player, weapon, now) {
  if (weapon !== SHOTGUN_ALT.weapon) return null;
  if (!player.shotgunPull || now - player.shotgunPull.at > SHOTGUN_ALT.pullWindowMs) {
    // First pull of a life is buckshot; every pull after that flips.
    player.shotgunPull = { at: now, slug: player.shotgunPull ? !player.shotgunPull.slug : false };
  } else {
    player.shotgunPull.at = now;
  }
  return player.shotgunPull.slug ? SHOTGUN_ALT.slug : SHOTGUN_ALT.buckshot;
}

// A fresh life always starts on buckshot, so the two runtimes cannot drift apart
// permanently once a round or a death has reset them both.
function resetShotgunLoad(player) {
  if (player) player.shotgunPull = null;
}

function handlePlayerShoot(client, room, player, data) {
  if ((player.health || 0) <= 0 || player.respawningUntil) return;
  const now = Date.now();
  player.activeAt = now;
  lockBuyRefunds(player);
  clearSpawnProtection(player, now, client, 'shoot');
  cancelBombAction(room, player.id);
  const weapon = String(data.weapon || player.weapon).slice(0, 32);
  const start = sanitizeVector(data.start, null);
  const target = sanitizeVector(data.target, null);
  const wdef = WEAPONS[weapon];
  if (start && target && wdef) {
    // The load decides how many hits this shot may pay out and how hard they
    // land, so it is stamped on the shot and read back when a hit correlates.
    const load = resolveShotgunLoad(player, weapon, now);
    const pellets = Math.max(1, Number((load ? load.pellets : wdef.pellets) || 1));
    const dmg = load ? load.dmg : wdef.dmg;
    const playerPenetration = pellets === 1 && Number(dmg?.body || 0) > 40;
    player.ac.recentShots.push({
      ts: now,
      weapon,
      start,
      target,
      pellets,
      load,
      hitsUsed: 0,
      playerPenetration,
      hitTargets: new Set()
    });
    if (player.ac.recentShots.length > 24) player.ac.recentShots.shift();
  }
  const countsStats = countsForDailyStats(room, player) && countsForAccuracyStats(room, player);
  if (countsStats) recordDailyStat(client, player, { shotsFired: 1 });
  if (countsStats) client.statDelta.shotsFired += 1;
  // Visual rebroadcast only. Damage is validated server-side in playerHit, and the
  // per-connection message rate limit already caps shot spam — so there is NO firerate
  // strike here (full-auto + network jitter must never penalize normal play).
  broadcastToRoom(client.roomCode, client.id, 'playerShoot', {
    id: client.id,
    weapon,
    start,
    target
  });
}

function handleGlassBreak(client, room, player, data) {
  if (![MAP_NUKE, 'mirage'].includes(getRoomMapId(room)) || (player.health || 0) <= 0 || player.respawningUntil) return;
  const paneId = String(data.paneId || '');
  const mapCollision = getMapCollision(room);
  if (!mapCollision?.glassPaneIds?.includes(paneId)) return;
  const position = sanitizeVector(data.position, null);
  if (!position) return;
  const now = Date.now();
  const recentBullet = [...(player.ac?.recentShots || [])].reverse().find(shot =>
    now - Number(shot.ts || 0) <= 650 &&
    WEAPONS[shot.weapon]?.type !== 'melee' &&
    distanceFromSegment(position, shot.start, shot.target) <= 4
  );
  if (!recentBullet) return;
  if (!room.brokenGlassPanes) room.brokenGlassPanes = new Set();
  if (room.brokenGlassPanes.has(paneId)) return;
  room.brokenGlassPanes.add(paneId);
  broadcastToRoom(client.roomCode, client.id, 'glassBreak', { paneId, position });
}

function handleVentBreak(client, room, player, data) {
  if (getRoomMapId(room) !== MAP_NUKE || (player.health || 0) <= 0 || player.respawningUntil) return;
  const ventId = String(data.ventId || '');
  if (!NUKE_VENT_BY_ID.has(ventId)) return;
  const mapCollision = getMapCollision(room);
  if (!mapCollision?.ventIds?.includes(ventId)) return;
  const position = sanitizeVector(data.position, null);
  if (!position) return;
  const now = Date.now();
  const recentBullet = [...(player.ac?.recentShots || [])].reverse().find(shot =>
    now - Number(shot.ts || 0) <= 650
    && WEAPONS[shot.weapon]?.type !== 'melee'
    && distanceFromSegment(position, shot.start, shot.target) <= 4
  );
  if (!recentBullet) return;
  if (!room.brokenVentIds) room.brokenVentIds = new Set();
  if (room.brokenVentIds.has(ventId)) return;
  room.brokenVentIds.add(ventId);
  broadcastToRoom(client.roomCode, client.id, 'ventBreak', { ventId, position });
}

function handleDoorToggle(client, room, player, data) {
  if (getRoomMapId(room) !== MAP_NUKE || (player.health || 0) <= 0 || player.respawningUntil) return;
  const doorId = String(data.doorId || '');
  const door = NUKE_DOOR_BY_ID.get(doorId);
  const mapScale = Number(gameMaps.MAP_DEFS?.nuke?.scale || 22);
  if (!door || !Array.isArray(door.center)) return;
  const center = { x: door.center[0] * mapScale, y: door.center[1] * mapScale, z: door.center[2] * mapScale };
  if (distanceBetweenVectors(player.position, center) > 52) return;
  if (!room.openDoors) room.openDoors = new Set();
  const open = !room.openDoors.has(doorId);
  if (open) room.openDoors.add(doorId);
  else room.openDoors.delete(doorId);
  player.activeAt = Date.now();
  broadcastToRoom(client.roomCode, null, 'doorState', { doorId, open, actorId: client.id });
}

// Lenient per-weapon damage-rate cap. Drops excess hits (no strike) so rapid-fire
// can't amplify DPS, while normal full-auto + network jitter never drop.
function damageRateOk(ac, weapon, wdef, now, bucketName = 'hitBucket') {
  if (!ac[bucketName]) ac[bucketName] = {};
  const interval = wdef.type === 'melee' ? 0.3 : wdef.firerate; // seconds per shot
  const pellets = wdef.pellets || 1;
  const cap = pellets + 3;                                       // burst headroom for jitter
  const refillPerSec = pellets / Math.max(0.03, interval * 0.7); // allow ~1.4x the legit rate
  let b = ac[bucketName][weapon];
  if (!b) { b = { tokens: cap, last: now }; ac[bucketName][weapon] = b; }
  b.tokens = Math.min(cap, b.tokens + ((now - b.last) / 1000) * refillPerSec);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function handlePlayerHit(client, room, player, data) {
  // Damage is the most security-sensitive game packet. The client identifies an
  // intended target and hit context for responsiveness, but the server recomputes
  // weapon damage, validates recent grenade bursts, checks range/correlation, and
  // owns health/death/stat mutations.
  const now = Date.now();
  const progressionEligible = countsForProgression(room);
  let trustedForProgression = true;
  if ((player.health || 0) <= 0 || player.respawningUntil) return;
  player.activeAt = now;
  lockBuyRefunds(player);
  clearSpawnProtection(player, now, client, 'shoot');

  const targetId = String(data.targetId || '');
  if (!targetId || targetId === client.id) return;
  const target = room.players.get(targetId);
  if (!target) return;
  if ((target.health || 0) <= 0 || target.respawningUntil) return;
  // No friendly fire in team modes.
  if (MODE_CONFIG[room.settings.gamemode]?.teams && player.team === target.team) return;
  if (target.invulnerableUntil && target.invulnerableUntil > now) return;

  // Server-authoritative damage — client `damage` is ignored entirely.
  let damage;

  let resolvedWeapon = player.weapon;
  let killContext = {
    headshot: false,
    // These two start from client context because smoke/wall geometry is richer
    // on the browser. correlateHit() can also force wallbang for pierced players.
    // If abuse shows up, make these server-derived before trusting them for score.
    throughSmoke: false,
    wallbang: !!data.wallbang,
    noscope: !!data.noscope,
    killerFlashed: (player.flashedUntil || 0) > now,
    victimFlashed: (target.flashedUntil || 0) > now,
    airborne: !!data.airborne,
    moving: !!data.moving,
    utility: false,
    bountyKill: false,
    bountyClaimed: false
  };
  if (data.kind === 'grenade') {
    // Frag damage: must correspond to a recent burst from this player near the target.
    damage = grenadeDamageFor(room, client.id, target, now);
    if (!damage) return; // no valid recent burst / out of blast radius — silently ignore
    resolvedWeapon = 'Frag';
    killContext.utility = true;
  } else if (data.kind === 'grenadeImpact') {
    damage = data.part === 'head' ? 5 : 1;
    resolvedWeapon = sanitizeGrenadeKind(data.grenadeKind) === 'molotov' ? 'Molotov' : (sanitizeGrenadeKind(data.grenadeKind) === 'flash' ? 'Flash' : (sanitizeGrenadeKind(data.grenadeKind) === 'smoke' ? 'Smoke' : 'Frag'));
    killContext.utility = true;
    killContext.headshot = data.part === 'head';
  } else if (data.kind === 'c4') {
    // Must correspond to a recent detonation by this player, near the target.
    damage = c4DamageFor(room, client.id, target, now);
    if (!damage) return;
    resolvedWeapon = 'C4';
    killContext.utility = true;
  } else if (data.kind === 'molotov') {
    damage = molotovDamageFor(room, client.id, target, now);
    if (!damage) return;
    resolvedWeapon = 'Molotov';
    killContext.utility = true;
  } else {
    const weapon = String(data.weapon || player.weapon).slice(0, 32);
    resolvedWeapon = weapon;
    const wdef = WEAPONS[weapon];
    if (!wdef) return;                          // unknown weapon — drop, no strike
    const melee = wdef.type === 'melee';
    const corr = correlateHit(room, player, target, weapon, now, targetId, { wallbang: !!data.wallbang });
    let trustedHit = true;
    let hardRejectHit = false;
    if (!corr.ok) {
      recordViolationSafe(client, corr.reason === 'silentAim' ? 'silentAim' : 'ghostHit', `${weapon}:${targetId}`);
      trustedHit = false;
      hardRejectHit = true;
    }
    if (corr.penetratedPlayer) killContext.wallbang = true;
    if (corr.shot) killContext.throughSmoke = shotPassesThroughActiveSmoke(room, corr.shot.start, target.position, now);

    // Server-authoritative damage ignores client `damage`. Correlation/range
    // failures are hard rejections. Rate bucket misses can happen from packet
    // bunching, so they only suppress progression and admin-review the event.
    const dist = distanceBetweenVectors(player.position, target.position);
    if (dist > (melee ? AC.MELEE_RANGE : AC.GUN_RANGE)) {
      recordViolationSafe(client, 'rangeHack', `${weapon}:${Math.round(dist)}`);
      trustedHit = false;
      hardRejectHit = true;
    }
    if (!damageRateOk(player.ac, weapon, wdef, now)) {
      recordViolationSafe(client, 'rapidFire', weapon);
      trustedHit = false;
    }
    if (!trustedHit) {
      trustedForProgression = false;
      if (progressionEligible) suppressRoundProgression(room, `untrusted_hit:${weapon}`);
      if (hardRejectHit) return;
    }

    if (melee) {
      damage = Boolean(data.alt) ? 50 : 34; // heavy / light (matches client)
      if (weapon === 'Knife' && isBackstab(player.position, target)) damage *= 2;
    } else {
      const part = data.part === 'head' || data.part === 'legs' ? data.part : 'body'; // default to body
      // A Breacher hit is worth whatever the pull it came from was loaded with.
      // Falling back to the weapon table means an uncorrelated hit is buckshot,
      // never the slug.
      damage = (corr.shot?.load?.dmg || wdef.dmg)[part];
      killContext.headshot = part === 'head';
    }
  }
  if (data.wallbang) damage = Math.max(1, Math.round(damage * 0.62));

  const countsRoundStats = !isCasualWarmup(room) && trustedForProgression;
  const countsStats = countsForAccuracyStats(room, player) && trustedForProgression;
  if (countsStats) recordDailyStat(client, player, { shotsHit: 1 });
  if (countsStats) client.statDelta.shotsHit += 1;
  const appliedDamage = Math.min(Math.max(0, target.health || 0), damage);
  if (killContext.victimFlashed || killContext.throughSmoke) killContext.utility = true;
  if (countsStats && countsForProgression(room) && client.accountId && db.isEnabled() && appliedDamage > 0) {
    incrementMatchChallengeDelta(client, { damage: appliedDamage });
    client.challengeDamageSinceUpdate = Number(client.challengeDamageSinceUpdate || 0) + appliedDamage;
    const shouldRefreshChallenges = client.challengeDamageSinceUpdate >= 250;
    if (shouldRefreshChallenges) client.challengeDamageSinceUpdate = 0;
    Promise.all([
      db.incrementDailyChallengeCounters(client.accountId, dailyChallengePeriodKey(), { damage: appliedDamage }),
      db.incrementDailyChallengeCounters(client.accountId, weeklyChallengePeriodKey(), { damage: appliedDamage })
    ])
      .then(() => { if (shouldRefreshChallenges) sendChallengeProgress(client); })
      .catch(error => console.error('[daily-challenges]', error.message));
  }
  if (countsRoundStats) {
    player.roundDamageDealt = (player.roundDamageDealt || 0) + appliedDamage;
    if (appliedDamage > 0) {
      player.weaponDamage = player.weaponDamage || {};
      player.weaponDamage[resolvedWeapon] = (player.weaponDamage[resolvedWeapon] || 0) + appliedDamage;
    }
    recordDamageContribution(target, player, appliedDamage, resolvedWeapon, killContext, now);
    awardDamageScore(room, player, target, appliedDamage, resolvedWeapon, killContext);
  }
  target.health = Math.max(0, target.health - damage);
  if (target.health <= 0) setPlayerLifecycle(target, 'dead');
  broadcastToRoom(client.roomCode, null, 'playerHealth', {
    id: targetId,
    health: target.health,
    attackerId: client.id,
    attackerName: player.name,
    attackerPosition: player.position,
    damage,
    hitPart: killContext.headshot ? 'head' : (data.part === 'legs' ? 'legs' : 'body'),
    headshot: !!killContext.headshot,
    wallbang: !!killContext.wallbang,
    throughSmoke: !!killContext.throughSmoke,
    lifecycle: target.lifecycle
  });

  if (target.health <= 0) {

    const victimHadBounty = !!target.bountyActive;
    const assistsAwarded = countsRoundStats ? resolveDamageAssists(room, player, target) : [];
    if (countsRoundStats) {
      player.kills += 1;
      player.killStreak = Math.max(0, Number(player.killStreak) || 0) + 1;
      player.bountyActive = player.killStreak >= BOUNTY_STREAK_THRESHOLD;
      if (player.bountyActive) {
        killContext.domination = true;
        killContext.bountyKill = true;
      }
      if (victimHadBounty) {
        killContext.revenge = true;
        killContext.bountyClaimed = true;
      }
      const reward = killMoneyReward(resolvedWeapon, WEAPONS[resolvedWeapon], killContext);
      addMoney(player, MODE_CONFIG[room.settings.gamemode]?.casual ? reward : KILL_REWARD);
      applyKillScore(room, player, target, resolvedWeapon, killContext);
      player.weaponKills = player.weaponKills || {};
      player.weaponKills[resolvedWeapon] = (player.weaponKills[resolvedWeapon] || 0) + 1;
      player.lastKillWeapon = resolvedWeapon;
    }
    if (countsStats) {
      client.statDelta.kills += 1;
      client.killStreak += 1;
      client.statDelta.bestStreak = Math.max(client.statDelta.bestStreak || 0, client.killStreak);
      recordDailyStat(client, player, { kills: 1, bestStreak: client.killStreak });
      if (room.settings.gamemode === 'gunGame') client.statDelta.gungameKills += 1;
      else client.statDelta.deathmatchKills += 1;
      if (countsForProgression(room) && client.accountId && db.isEnabled()) {
        incrementMatchChallengeDelta(client, {
          headshots: killContext.headshot ? 1 : 0,
          utilityKills: killContext.utility ? 1 : 0,
          weapon: resolvedWeapon,
          weaponKills: 1
        });
        Promise.all([
          db.recordWeaponKill(client.accountId, dailyChallengePeriodKey(), resolvedWeapon),
          db.recordWeaponKill(client.accountId, weeklyChallengePeriodKey(), resolvedWeapon),
          db.incrementDailyChallengeCounters(client.accountId, dailyChallengePeriodKey(), {
            headshots: killContext.headshot ? 1 : 0,
            utilityKills: killContext.utility ? 1 : 0
          }),
          db.incrementDailyChallengeCounters(client.accountId, weeklyChallengePeriodKey(), {
            headshots: killContext.headshot ? 1 : 0,
            utilityKills: killContext.utility ? 1 : 0
          })
        ])
          .then(() => sendChallengeProgress(client))
          .catch(error => console.error('[weapon-kills]', error.message));
      }
    }
    if (countsRoundStats) grantHealthshotKillProgress(client, room, player);

    respawnPlayer(client.roomCode, target, {
      skipStats: !countsRoundStats,
      killerId: client.id,
      killerName: player.name,
      killerPosition: player.position,
      killerWeapon: resolvedWeapon,
      killContext,
      victimName: target.name,
      killerKills: player.kills,
      teamKills: teamKillTotals(room),
      killerScore: player.matchScore || 0,
      killerMoney: player.money,
      killerHealthshots: Math.max(0, Number(player.healthshots || 0)),
      killerHealthshotProgress: Math.max(0, Number(player.healthshotKills || 0)),
      assistsAwarded
    });
    if (countsStats) checkCasualElimination(client.roomCode, room);
  }
}

// ---------------------------------------------------------------------------
// Deployable barricades. Server-owned: it decides where a panel may go, how much
// health it has, and when it dies. Clients render and report hits, exactly like
// breakable glass, but never decide any of those three things.
// ---------------------------------------------------------------------------
function ensureRoomBarricades(room) {
  if (!room.barricades) room.barricades = new Map();
  return room.barricades;
}

function publicBarricade(barricade) {
  return {
    id: barricade.id,
    ownerId: barricade.ownerId,
    ownerTeam: barricade.ownerTeam,
    x: barricade.x,
    y: barricade.y,
    z: barricade.z,
    yaw: barricade.yaw,
    health: barricade.health,
    maxHealth: barricade.maxHealth
  };
}

function publicBarricades(room) {
  return Array.from(room?.barricades?.values?.() || []).map(publicBarricade);
}

function clearRoomBarricades(room) {
  if (!room) return;
  ensureRoomBarricades(room).clear();
}

// A panel is cover its owner paid for, so it outlives their death but not their
// exit — nothing left in the room can remove an absent player's barricade.
function removeBarricadesOwnedBy(roomCode, room, ownerId) {
  const barricades = room?.barricades;
  if (!barricades?.size) return;
  for (const [id, barricade] of Array.from(barricades.entries())) {
    if (barricade.ownerId !== ownerId) continue;
    barricades.delete(id);
    broadcastToRoom(roomCode, null, 'barricadeRemoved', { id, destroyed: false });
  }
}

// One free panel per life (the client grants it on spawn, as it does for every
// other utility kind in DM/TDM) plus anything bought this life.
function barricadeAllowance(room, player) {
  const free = usesUtility(room) && !isCasualMode(room) ? 1 : 0;
  return free + Number(player?.utilityPurchasedThisLife?.barricade || 0);
}

function applyBarricadeDamage(roomCode, room, barricade, amount, byId) {
  const damage = Math.max(1, Math.round(Number(amount) || 0));
  barricade.health = Math.max(0, barricade.health - damage);
  if (barricade.health > 0) {
    broadcastToRoom(roomCode, null, 'barricadeHealth', { id: barricade.id, health: barricade.health, byId });
    return;
  }
  room.barricades.delete(barricade.id);
  broadcastToRoom(roomCode, null, 'barricadeRemoved', {
    id: barricade.id,
    destroyed: true,
    byId,
    position: { x: barricade.x, y: barricade.y, z: barricade.z }
  });
}

// Blasts chew through panels with the same falloff they apply to players.
function damageBarricadesFromBlast(roomCode, room, position, byId, radius, maxDamage, scale) {
  const barricades = room?.barricades;
  if (!barricades?.size || !position) return;
  for (const barricade of Array.from(barricades.values())) {
    const centre = { x: barricade.x, y: barricade.y + BARRICADE.height / 2, z: barricade.z };
    const dist = distanceBetweenVectors(centre, position);
    if (dist > radius) continue;
    const falloff = Math.max(0, 1 - dist / radius);
    const damage = Math.round(maxDamage * falloff * scale);
    if (damage > 0) applyBarricadeDamage(roomCode, room, barricade, damage, byId);
  }
}

function damageBarricadesFromFrag(roomCode, room, position, byId) {
  damageBarricadesFromBlast(roomCode, room, position, byId, GRENADE.frag.radius, GRENADE.frag.maxDamage, BARRICADE.fragScale);
}

// ---------------------------------------------------------------------------
// Remote-detonated C4. Same authority split as the barricade, plus the two rules
// that make it a charge rather than a grenade: it only arms after a delay, and
// only its planter — alive, in this room — can set it off.
// ---------------------------------------------------------------------------
function ensureRoomC4Charges(room) {
  if (!room.c4Charges) room.c4Charges = new Map();
  return room.c4Charges;
}

function publicC4Charge(charge) {
  return {
    id: charge.id,
    ownerId: charge.ownerId,
    ownerTeam: charge.ownerTeam,
    x: charge.x,
    y: charge.y,
    z: charge.z,
    yaw: charge.yaw,
    armsAt: charge.armsAt,
    health: charge.health,
    maxHealth: charge.maxHealth
  };
}

function publicC4Charges(room) {
  return Array.from(room?.c4Charges?.values?.() || []).map(publicC4Charge);
}

function clearRoomC4Charges(room) {
  if (!room) return;
  ensureRoomC4Charges(room).clear();
  room.recentC4Bursts = [];
}

// An undetonated charge is dead weight once its planter is gone or down: it
// fizzles rather than lingering as a mine nobody can trigger.
function removeC4ChargesOwnedBy(roomCode, room, ownerId, reason) {
  const charges = room?.c4Charges;
  if (!charges?.size) return;
  for (const [id, charge] of Array.from(charges.entries())) {
    if (charge.ownerId !== ownerId) continue;
    charges.delete(id);
    broadcastToRoom(roomCode, null, 'c4Removed', { id, reason: reason || 'removed' });
  }
}

function c4Allowance(room, player) {
  const free = usesUtility(room) && !isCasualMode(room) ? 1 : 0;
  return free + Number(player?.utilityPurchasedThisLife?.c4 || 0);
}

// Detonating records the burst so the planter's reported hits can be validated
// against it, exactly as a frag burst is.
function detonateC4Charge(roomCode, room, charge, now) {
  room.c4Charges.delete(charge.id);
  if (!room.recentC4Bursts) room.recentC4Bursts = [];
  room.recentC4Bursts.push({ ts: now, ownerId: charge.ownerId, position: { x: charge.x, y: charge.y, z: charge.z } });
  if (room.recentC4Bursts.length > 24) room.recentC4Bursts.shift();
  const position = { x: charge.x, y: charge.y + C4.height / 2, z: charge.z };
  damageBarricadesFromBlast(roomCode, room, position, charge.ownerId, C4.radius, C4.maxDamage, 1);
  extinguishActiveFiresAt(room, position, C4.radius * 0.5);
  broadcastToRoom(roomCode, null, 'c4Detonated', { id: charge.id, ownerId: charge.ownerId, position });
}

function c4DamageFor(room, ownerId, target, now) {
  if (!room.recentC4Bursts || !room.recentC4Bursts.length) return 0;
  let best = 0;
  for (let i = room.recentC4Bursts.length - 1; i >= 0; i--) {
    const burst = room.recentC4Bursts[i];
    if (now - burst.ts > GRENADE_HIT_WINDOW_MS) break;
    if (burst.ownerId !== ownerId) continue;
    const dist = distanceBetweenVectors(burst.position, target.position);
    if (dist > C4.radius + GRENADE_RADIUS_SLACK) continue;
    const damage = Math.round(C4.maxDamage * Math.max(0, 1 - dist / C4.radius));
    if (damage > best) best = damage;
  }
  return best;
}

// Validate frag-grenade damage: there must be a recent frag burst from this player
// with the target inside the blast radius. Returns server-computed damage (or 0).
function grenadeDamageFor(room, ownerId, target, now) {
  if (!room.recentBursts || !room.recentBursts.length) return 0;
  const { radius, maxDamage } = GRENADE.frag;
  let best = 0;
  for (let i = room.recentBursts.length - 1; i >= 0; i--) {
    const b = room.recentBursts[i];
    if (now - b.ts > GRENADE_HIT_WINDOW_MS) break;
    if (b.ownerId !== ownerId) continue;
    const d = distanceBetweenVectors(b.position, target.position);
    if (d > radius + GRENADE_RADIUS_SLACK) continue;
    const dmg = Math.round(maxDamage * Math.max(0, 1 - d / radius));
    if (dmg > best) best = dmg;
  }
  return best;
}

function molotovDamageFor(room, ownerId, target, now) {

  if (!room.activeFires || !room.activeFires.length) return 0;
  const cfg = GRENADE.molotov;
  room.activeFires = room.activeFires.filter(f => f.expiresAt > now);
  if (!room.molotovDamageLocks) room.molotovDamageLocks = {};
  const lockKey = String(target.id || '');
  if (lockKey && now - Number(room.molotovDamageLocks[lockKey] || 0) < cfg.tickMs * 0.8) return 0;
  for (let i = room.activeFires.length - 1; i >= 0; i--) {
    const f = room.activeFires[i];
    if (f.ownerId !== ownerId) continue;
    // Horizontal footprint + vertical band: the fire conforms to terrain, so match on
    // ground-plane distance (mirrors the client's inFireFootprint) instead of 3D
    // distance, which would miss a target standing up/down a slope inside the radius.
    const dx = f.position.x - target.position.x, dz = f.position.z - target.position.z;
    const horiz = Math.sqrt(dx * dx + dz * dz);
    const dy = Math.abs((f.position.y || 0) - (target.position.y || 0));
    if (horiz <= cfg.radius + 20 && dy <= 22) {
      if (lockKey) room.molotovDamageLocks[lockKey] = now;
      return Math.max(1, Math.round((cfg.dps * cfg.tickMs) / 1000));
    }
  }
  return 0;
}


function extinguishActiveFiresAt(room, position, radius) {
  if (!room?.activeFires?.length || !position) return;
  const now = Date.now();
  room.activeFires = room.activeFires.filter((fire) => (
    fire.expiresAt > now && distanceBetweenVectors(fire.position, position) > radius + GRENADE.molotov.radius * 0.6
  ));
}

function shotPassesThroughActiveSmoke(room, start, end, now = Date.now()) {
  if (!start || !end || !room?.activeSmokes?.length) return false;
  room.activeSmokes = room.activeSmokes.filter(smoke => smoke.expiresAt > now);
  return room.activeSmokes.some(smoke =>
    smoke.position && distanceFromSegment(smoke.position, start, end) <= Number(GRENADE.smoke.radius || 38)
  );
}

function correlateHit(room, player, target, weapon, now, targetId, context = {}) {
  const shots = player.ac.recentShots;
  let anyRecent = false;
  for (let i = shots.length - 1; i >= 0; i--) {
    const shot = shots[i];
    if (now - shot.ts > AC.CORRELATION_WINDOW_MS) break;
    anyRecent = true;
    const allowedHits = shot.pellets * (shot.playerPenetration ? 4 : 1);
    if (shot.weapon !== weapon || shot.hitsUsed >= allowedHits || shot.hitTargets?.has(targetId)) continue;

    const aimDir = normalizeVec(subVec(shot.target, shot.start));
    const toVictim = subVec(target.position, shot.start);
    const realDist = length(toVictim);
    const victimDir = normalizeVec(toVictim);
    if (!aimDir || !victimDir) continue;

    if (realDist > AC.CLOSE_RANGE && dot(aimDir, victimDir) < AC.ANGLE_TOLERANCE_COS) continue;

    const aimDist = length(subVec(shot.target, shot.start));
    if (!shot.playerPenetration && Math.abs(aimDist - realDist) > realDist * AC.DIST_FACTOR + AC.DIST_SLACK) continue;
    if (shot.playerPenetration && realDist > AC.GUN_RANGE + AC.DIST_SLACK) continue;

    if (halfMapSegmentBlocked(room, shot.start, target.position)) continue;
    const mapCollision = getMapCollision(room);
    if (!context.wallbang && AC.ENABLE_LOS && mapCollision &&
      mapCollision.blocked(
        shot.start.x, shot.start.y, shot.start.z,
        target.position.x, target.position.y, target.position.z,
        {
          ignoredGlassPanes: room.brokenGlassPanes,
          ignoredDoors: room.openDoors,
          ignoredVents: room.brokenVentIds
        }
      )) {
      continue;
    }

    const penetratedPlayer = shot.hitsUsed > 0;
    shot.hitsUsed += 1;
    shot.hitTargets?.add(targetId);
    return { ok: true, penetratedPlayer, shot };
  }
  return { ok: false, reason: anyRecent ? 'silentAim' : 'ghostHit' };
}

// ---------------------------------------------------------------------------
// Anti-cheat reporting. Admin visibility only: no warnings, kicks, bans, or
// gameplay corrections are triggered from these reports.
// ---------------------------------------------------------------------------
function recordViolationSafe(client, type, detail) {
  const room = rooms.get(client.roomCode);
  const player = room && room.players.get(client.id);
  const now = Date.now();
  client.localViolationCount = Number(client.localViolationCount || 0) + 1;

  const ac = player?.ac;
  if (ac && MOVEMENT_TYPES.has(type)) {
    if (ac.lastViolTs[type] && now - ac.lastViolTs[type] < 250) { ac.lastViolTs[type] = now; return; }
    ac.lastViolTs[type] = now;
  }

  if (client.accountId && !client.guest) bans.recordViolation(client.accountId, type, detail || '', client.deviceId);
}

function banGuestDeviceForViolation(client, type, detail) {
  const expiresAt = new Date(Date.now() + GUEST_DEVICE_BAN_MS).toISOString();
  if (client.deviceId) {
    bans.banDevice({
      deviceId: client.deviceId,
      reason: `guest anti-cheat: ${type}${detail ? ` (${detail})` : ''}`,
      byAdmin: 'anti-cheat',
      expiresAt
    }).catch((e) => console.error('[guest-ban]', e.message));
  }
  try {
    send(client, 'authError', {
      code: 'device_blocked',
      message: 'Guest device banned for 15 minutes after anti-cheat detection.',
      expiresAt
    });
  } catch {}
}

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------
function subVec(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function length(v) { return Math.hypot(v.x, v.y, v.z); }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function normalizeVec(v) {
  const l = length(v);
  if (l < 1e-6) return null;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
function forwardFromRotation(rot) {
  const px = rot.x || 0, py = rot.y || 0;
  return { x: -Math.cos(px) * Math.sin(py), y: Math.sin(px), z: -Math.cos(px) * Math.cos(py) };
}

function isBackstab(attackerPos, target) {
  if (!attackerPos || !target?.position) return false;
  const targetForward = forwardFromRotation(target.rotation || {});
  const toAttacker = normalizeVec({
    x: attackerPos.x - target.position.x,
    y: 0,
    z: attackerPos.z - target.position.z
  });
  if (!toAttacker) return false;
  const forwardFlat = normalizeVec({ x: targetForward.x, y: 0, z: targetForward.z });
  return forwardFlat ? dot(forwardFlat, toAttacker) < -0.45 : false;
}

// ---------------------------------------------------------------------------
// Rooms / game (preserved behavior + account binding + stat hooks)
// ---------------------------------------------------------------------------
function createRoomCode() {
  return roomCodes.createLocalRoomCode(code => rooms.has(code));
}

function setPlayerLifecycle(player, lifecycle) {
  if (!player || !lifecycle || player.lifecycle === lifecycle) return;
  player.lifecycle = lifecycle;
  player.dirty = true;
}

function makePlayer(id, name) {
  return {
    id,
    name: sanitizeName(name, `Player ${id.slice(0, 4)}`),
    health: 100,
    kills: 0,
    killStreak: 0,
    bountyActive: false,
    deaths: 0,
    mvps: 0,
    team: 0,
    money: START_MONEY,

    assists: 0,
    matchScore: 0,
    objectiveScore: 0,
    roundDamageDealt: 0,
    damageContributors: {},
    utilityScoreAwards: {},
    skinLoadout: {},
    weaponKills: {},
    weaponDamage: {},
    lastKillWeapon: null,
    weapon: 'AK47',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    crouching: false,
    walking: false,
    jumping: false,
    reloading: false,
    invulnerableUntil: 0,
    spawnProtectionStartedAt: 0,
    spawnProtectionOrigin: null,
    flashedUntil: 0,
    waitingForNextRound: false,
    lifecycle: 'alive',
    hasBomb: false,
    bombAction: null,
    lastSpawnId: null,
    spawnSeq: 0,
    lastDeathPos: null,
    respawningUntil: 0,
    respawnTimer: null,
    utilityPurchasedThisLife: freshUtilityCounts(),
    healthshots: 0,
    healthshotKills: 0,
    healthshotHealRemaining: 0,
    buyHistory: [],
    buyLocked: false,
    buyOrigin: null,
    buyCounter: 0,
    activeAt: Date.now(),
    updatedAt: Date.now(),
    dirty: false,
    lastSent: { x: null, y: null, z: null, ry: null, w: null, f: null },
    ac: {
      lastValidPos: null,
      lastStateTs: 0,
      weaponLastShotAt: {},
      recentShots: [],
      pendingCorrection: false,
      strikeTotal: 0,
      lastDecayTs: Date.now(),
      warned: false,
      lastViolTs: {},
      lastGroundCheckTs: 0,
      airborneSince: 0,
      graceUntil: 0,
      hitBucket: {}
    }
  };
}

function joinRoom(client, roomCode, options = {}) {
  leaveRoom(client.id, { notifySelf: false });

  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, {
      players: new Map(),
      hostId: client.id,
      banned: new Set(),       // account ids
      settings: sanitizeRoomSettings(options.settings),
      spawnReservations: new Map(),
      pendingRejoins: new Map(), // rejoinToken -> stashed score for dropped players
      recentBursts: [],
      activeFires: [],
      activeSmokes: [],
      barricades: new Map(),
      barricadeSeq: 0,
      c4Charges: new Map(),
      c4Seq: 0,
      recentC4Bursts: [],
      brokenGlassPanes: new Set(),
      brokenVentIds: new Set(),
      openDoors: new Set(),
      directoryLeaseId: options.directoryLeaseId || newRoomDirectoryLeaseId(),
      glassResetTimer: null,
      droppedItems: new Map(),
      adminDummies: new Map(),
      dropSeq: 0,
      spawnSeq: 0,
      casual: null,
      roundTimer: null,
      mapVote: null,
      mapVoteTimer: null,
      roundStartedAt: Date.now(),
      createdAt: Date.now()
    });
    ensureRoomRound(roomCode);
  }

  const room = rooms.get(roomCode);
  room.settings = sanitizeRoomSettings(room.settings);
  if (MODE_CONFIG[room.settings.gamemode]?.casual) ensureCasualState(room);
  if (room.banned.has(client.accountId)) {
    send(client, 'roomError', { message: 'You are banned from this room.' });
    return;
  }

  const player = makePlayer(client.id, client.name);
  player.accountId = client.accountId;
  player.skinLoadout = { ...(client.skinLoadout || {}) };
  if (MODE_CONFIG[room.settings.gamemode]?.casual) player.money = CASUAL_START_MONEY;
  if (Number.isFinite(client.lastRtt)) player.rtt = client.lastRtt;
  player.team = pickBalancedTeam(room);
  const partyTeam = partyTeamForRoom(client, room, roomCode);
  if (partyTeam !== null) player.team = partyTeam;
  if (options.rejoin) {
    // Returning after a disconnect: restore score/team/loadout (fresh spawn below).
    const r = options.rejoin;
    if (r.team === 0 || r.team === 1) player.team = r.team;
    player.kills = r.kills | 0;
    player.assists = r.assists | 0;
    player.deaths = r.deaths | 0;
    player.mvps = r.mvps | 0;
    player.matchScore = r.matchScore | 0;
    player.objectiveScore = r.objectiveScore | 0;
    if (r.weaponKills && typeof r.weaponKills === 'object') player.weaponKills = { ...r.weaponKills };
    if (r.weaponDamage && typeof r.weaponDamage === 'object') player.weaponDamage = { ...r.weaponDamage };
    if (WEAPONS[r.lastKillWeapon]) player.lastKillWeapon = r.lastKillWeapon;
    if (Number.isFinite(r.money)) player.money = r.money;
    if (WEAPONS[r.weapon]) player.weapon = r.weapon;
    if (r.utilityPurchasedThisLife && typeof r.utilityPurchasedThisLife === 'object') {
      player.utilityPurchasedThisLife = { ...freshUtilityCounts(), ...r.utilityPurchasedThisLife };
    }
  }
  if (isContainment(room)) {
    // Zombies starts with a sidearm and knife; every stronger weapon must be
    // unlocked from the match-local purse. Rejoins keep anything already
    // restored by the room where possible, while a fresh seat always starts
    // from the same fair baseline.
    player.containmentWeapons = Array.isArray(options.rejoin?.containmentWeapons)
      ? options.rejoin.containmentWeapons.filter(name => WEAPONS[name])
      : ['Knife', 'Glock'];
    if (!player.containmentWeapons.includes('Knife')) player.containmentWeapons.push('Knife');
    if (!player.containmentWeapons.includes('Glock')) player.containmentWeapons.push('Glock');
    if (!player.containmentWeapons.includes(player.weapon)) player.weapon = 'Glock';
    // Zombies is one co-operative squad. Keep every participant on the same
    // side even when a reconnect restored a former PvP team assignment.
    player.team = 0;
  }
  room.players.set(client.id, player);
  if (!room.hostId) room.hostId = client.id;
  client.roomCode = roomCode;
  publishRoomDirectory(roomCode, room);
  if (!options.rejoin) client.matchChallengeDelta = newMatchChallengeDelta();
  touchPartyPresence(client);
  // Fresh token every join; it lives on the client only — player objects are
  // broadcast wholesale, so it must never sit on the player.
  client.rejoinToken = crypto.randomBytes(16).toString('hex');
  // A room that survived empty awaiting rejoins had its round timer cleared — re-arm it.
  if (room.players.size === 1) ensureRoomRound(roomCode);

  // server-authoritative spawn
  const spawn = pickSpawn(room, player);
  room.spawnSeq = (room.spawnSeq || 0) + 1;
  const spawnSeq = room.spawnSeq;
  player.position = { x: spawn.x, y: spawn.y, z: spawn.z };
  player.spawnSeq = spawnSeq;
  player.ac.lastValidPos = { x: spawn.x, y: spawn.y, z: spawn.z };
  player.ac.graceUntil = Date.now() + AC.RESPAWN_GRACE_MS; // trust movement right after joining
  applySpawnProtection(player, Date.now() + RESPAWN_PROTECTION_MS, player.position);
  resetBuySession(player, player.position);
  clearCosmeticActionState(player);
  const casualPhase = room.casual?.phase;
  const joinsLateCasual = MODE_CONFIG[room.settings.gamemode]?.casual && !options.rejoin && casualPhase && !['warmup', 'countdown'].includes(casualPhase);
  if (joinsLateCasual) {
    player.waitingForNextRound = true;
    setPlayerLifecycle(player, 'waiting');
    player.health = 0;
    player.invulnerableUntil = 0;
    player.spawnProtectionStartedAt = 0;
    player.spawnProtectionOrigin = null;
  } else {
    setPlayerLifecycle(player, 'alive');
  }

  let containmentJoinState = null;
  let containmentJoinEnemies = [];
  if (isContainment(room)) {
    const match = ensureContainment(room);
    if (options.rejoin && Number.isFinite(Number(options.rejoin.containmentCredits))) {
      containment.restorePlayer(match, player.id, options.rejoin.containmentCredits);
    } else {
      containment.registerPlayer(match, player.id);
    }
    if (match.phase === containment.PHASES.WAITING) containment.beginMatch(match, Date.now());
    containmentJoinState = containmentClientState(room, player.id);
    containmentJoinEnemies = publicContainmentEnemies(match);
  }

  // stats: count a game + start playtime clock (a rejoin is the same game, not a new one)
  if (!options.rejoin && !isAdminRoom(room)) client.statDelta.gamesPlayed += 1;
  client.lastPlaytimeStamp = Date.now();

  send(client, 'roomJoined', {
    roomCode,
    hostId: room.hostId,
    settings: room.settings,
    players: Array.from(room.players.values()),
    teamKills: teamKillTotals(room),
    spawn: { x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw, seq: spawnSeq },
    waitingForNextRound: player.waitingForNextRound,
    casual: publicCasualState(room),
    brokenGlassPanes: Array.from(room.brokenGlassPanes || []),
    brokenVentIds: Array.from(room.brokenVentIds || []),
    openDoorIds: Array.from(room.openDoors || []),
    barricades: publicBarricades(room),
    c4Charges: publicC4Charges(room),
    droppedItems: publicDroppedItems(room),
    adminDummies: publicAdminDummies(room),
    adminConfig: room.adminConfig || null,
    isAdminRoom: roomCode === ADMIN_ROOM_CODE,
    rejoinToken: client.rejoinToken,
    rejoined: !!options.rejoin,
    containment: containmentJoinState,
    containmentEnemies: containmentJoinEnemies
  });
  if (room.mapVote && room.mapVote.endsAt > Date.now()) {
    send(client, 'mapVoteStart', publicMapVotePayload(room, client.id));
  }
  broadcastToRoom(roomCode, client.id, 'playerJoined', player);
  if (player.waitingForNextRound) send(client, 'roundWait', { message: 'You will spawn next round.' });
  if (MODE_CONFIG[room.settings.gamemode]?.casual) updateCasualWarmup(roomCode, room);
  broadcastRoomState(roomCode);
  recordRoomPlayerEncounter(client, room);
  refreshFriendPresence(client.accountId);
  broadcastRoomList();
}

function recordRoomPlayerEncounter(client, room) {
  // Record only real rooms. Admin/test rooms are excluded so skin/admin testing
  // does not pollute friend suggestions for normal players.
  if (!client?.accountId || client.guest || !room || isAdminRoom(room) || !db.isEnabled()) return;
  const otherIds = Array.from(room.players.values())
    .map(player => player.accountId)
    .filter(accountId => accountId && String(accountId) !== String(client.accountId));
  if (!otherIds.length) return;
  db.recordRecentPlayerEncounters(client.accountId, otherIds)
    .catch(error => console.error('[recent-players-record]', error.message));
}

function leaveRoom(id, options = {}) {
  const client = clients.get(id);
  if (!client?.roomCode) return;
  removePlayerFromRoom(id, 'left', options);
  touchPartyPresence(client);
}

function removePlayerFromRoom(id, reason, options = {}) {
  const { notifySelf = true, requestId = null } = options;
  const client = clients.get(id);
  const roomCode = client?.roomCode;
  const room = rooms.get(roomCode);
  if (!client) return;
  if (!room) {
    client.roomCode = null;
    client.rejoinToken = null;
    if (notifySelf) send(client, 'roomRemoved', { reason, roomCode, requestId });
    return;
  }
  const player = room.players.get(id);
  if (player?.respawnTimer) {
    clearTimeout(player.respawnTimer);
    player.respawnTimer = null;
    player.respawningUntil = 0;
  }

  accruePlaytime(client);
  client.lastPlaytimeStamp = 0;

  if (MODE_CONFIG[room.settings.gamemode]?.casual && player) {
    dropBombIfCarrier(room, player);
    cancelBombAction(room, player.id);
  }
  room.players.delete(id);
  removeBarricadesOwnedBy(roomCode, room, id);
  removeC4ChargesOwnedBy(roomCode, room, id, 'left');
  if (room.mapVote?.votes.delete(id)) {
    broadcastToRoom(roomCode, id, 'mapVoteUpdate', publicMapVotePayload(room));
  }
  if (notifySelf) send(client, 'roomRemoved', { reason, roomCode, requestId });
  broadcastToRoom(roomCode, id, 'playerLeft', id);
  client.roomCode = null;
  refreshFriendPresence(client.accountId);

  if (room.players.size === 0) {
    clearRoomRoundTimer(room);
    if (roomCode === ADMIN_ROOM_CODE) {
      room.hostId = null; // always-open: keep the admin room and its config alive
    } else if (!room.pendingRejoins || room.pendingRejoins.size === 0) {
      clearRoomMapVote(room);
      rooms.delete(roomCode);
      removeRoomDirectory(roomCode, room);
    } else {
      // Keep the room alive for pending rejoins (the heartbeat sweep deletes it once
      // they expire); joinRoom() re-elects the host when someone comes back.
      room.hostId = null;
    }
    broadcastRoomList();
    return;
  }

  if (room.hostId === id) {
    room.hostId = room.players.keys().next().value;
    broadcastToRoom(roomCode, null, 'roomHost', { hostId: room.hostId });
    broadcastRoomState(roomCode);
  } else {
    publishRoomDirectory(roomCode, room);
    broadcastRoomState(roomCode);
  }
  if (MODE_CONFIG[room.settings.gamemode]?.casual) {
    updateCasualWarmup(roomCode, room);
    checkCasualElimination(roomCode, room);
    broadcastCasualState(roomCode, room);
  }
  broadcastRoomList();
}

// Stash a disconnected player's score so a quick reconnect can reclaim it. Intentional
// removals (leave/kick/ban/AFK/logout) clear roomCode via removePlayerFromRoom BEFORE
// the socket closes, so only genuine disconnects ever reach a live room from here.
function stashRejoinState(client) {
  const room = rooms.get(client.roomCode);
  const player = room?.players.get(client.id);
  if (!room || !player || !client.rejoinToken) return;
  if (!room.pendingRejoins) room.pendingRejoins = new Map();
  room.pendingRejoins.set(client.rejoinToken, {
    accountId: client.accountId || null,
    name: player.name,
    team: player.team,
    kills: player.kills,
    assists: player.assists,
    deaths: player.deaths,
    mvps: player.mvps || 0,
    matchScore: player.matchScore,
    objectiveScore: player.objectiveScore,
    weaponKills: player.weaponKills || {},
    weaponDamage: player.weaponDamage || {},
    lastKillWeapon: player.lastKillWeapon || null,
    money: player.money,
    weapon: player.weapon,
    containmentCredits: room.containment ? containment.credits(room.containment, player.id) : null,
    containmentWeapons: Array.isArray(player.containmentWeapons) ? [...player.containmentWeapons] : null,
    utilityPurchasedThisLife: player.utilityPurchasedThisLife || freshUtilityCounts(),
    lifecycle: player.lifecycle || 'alive',
    expiresAt: Date.now() + REJOIN_TTL_MS
  });
}

function removeClient(id) {
  const client = clients.get(id);
  if (!client) return;
  stashRejoinState(client);
  accruePlaytime(client);
  flushClientStats(client);
  flushClientDailyStats(client);
  if (client.accountId) removeFromParty(client.accountId);
  leaveRoom(id);
  if (client.authTimer) { clearTimeout(client.authTimer); client.authTimer = null; }
  antiflood.onDisconnect(client.ip, client.authed);
  clients.delete(id);
}

function getRoomList() {
  return Array.from(rooms.entries())
    .filter(([roomCode, room]) => roomCode !== ADMIN_ROOM_CODE && !room.settings?.private && room.players.size > 0)
    .map(([roomCode, room]) => ({
      roomCode,
      hostName: room.players.get(room.hostId)?.name || 'Host',
      players: room.players.size,
      gamemode: room.settings?.gamemode,
      mapId: room.settings?.mapId || MAP_DUST2,
      modeLabel: modeLabel(room.settings?.gamemode),
      tags: lobbyTags(room),
      private: false,
      casual: publicCasualState(room),
      createdAt: room.createdAt
    }));
}

function broadcastRoomList() {
  const payload = getRoomList();
  for (const connected of clients.values()) {
    if (connected.authed) send(connected, 'roomList', payload);
  }
}

function modeLabel(mode) {
  return ({ gunGame: 'Gun Game', deathmatch: 'Deathmatch', tdm: 'Team Deathmatch', containment: 'Zombies' })[mode] || 'Game';
}

function lobbyTags(room) {
  const tags = [];
  const mode = room?.settings?.gamemode;
  const mapId = getRoomMapId(room);
  if (mapId === MAP_BACKROOMS) tags.push('Backrooms');
  else if (gameMaps.MAP_DEFS[mapId]) tags.push(gameMaps.MAP_DEFS[mapId].label);
  if (mode === 'deathmatch' || mode === 'tdm') {
    tags.push('Fast Respawn');
    if (usesUtility(room)) tags.push('Utility');
  }
  tags.push(room?.settings?.fullMap ? 'Full Map' : 'Half Map');
  return tags;
}

function teamKillTotals(room) {
  const totals = [0, 0];
  if (!room || room.settings?.gamemode !== 'tdm') return totals;
  for (const player of room.players.values()) {
    totals[player.team === 1 ? 1 : 0] += Math.max(0, Number(player.kills || 0));
  }
  return totals;
}

function getRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;
  return {
    roomCode,
    hostId: room.hostId,
    settings: sanitizeRoomSettings(room.settings),
    players: Array.from(room.players.values()),
    teamKills: teamKillTotals(room),
    casual: publicCasualState(room),
    brokenGlassPanes: Array.from(room.brokenGlassPanes || []),
    brokenVentIds: Array.from(room.brokenVentIds || []),
    openDoorIds: Array.from(room.openDoors || []),
    barricades: publicBarricades(room),
    c4Charges: publicC4Charges(room),
    droppedItems: publicDroppedItems(room),
    adminDummies: publicAdminDummies(room),
    adminConfig: room.adminConfig || null
  };
}

function publicAdminDummies(room) {
  return Array.from(room?.adminDummies?.values?.() || []);
}

function adminMaxUtilityCounts() {
  return Object.fromEntries(Object.keys(UTILITY_PRICES).map(kind => [kind, utilityLifeCap(kind)]));
}

function adminTeleportPoint(room, action, player) {
  const spawnForTeam = (team) => {
    const points = getSpawnPoints(room);
    const ids = getTeamSpawnIds(room, team);
    return points.find(point => ids.includes(point.id)) || points[0] || null;
  };
  if (action === 'teleportCt') return spawnForTeam(0);
  if (action === 'teleportT') return spawnForTeam(1);
  const siteId = action === 'teleportA' ? 'A' : action === 'teleportB' ? 'B' : null;
  if (!siteId) return null;
  const mapId = getRoomMapId(room);
  const site = gameMaps.ADMIN_TELEPORTS?.[mapId]?.[siteId]
    || (mapId === MAP_DUST2 ? CASUAL_BOMB_SITES.find(s => s.id === siteId) : null);
  if (!site) return null;
  let y = Number(site.yHint);
  if (!Number.isFinite(y)) y = Number(player?.position?.y);
  if (!Number.isFinite(y)) y = getSpawnPoints(room)[0]?.y || 0;
  if (getMapCollision(room)) {
    const groundY = groundYForRoom(room, site.x, site.z, y);
    if (Number.isFinite(groundY)) y = groundY + SPAWN_EYE_OFFSET;
  }
  return { x: site.x, y, z: site.z, yaw: SPAWN_YAW };
}

function applyAdminTeleport(room, player, action) {
  const point = adminTeleportPoint(room, action, player);
  if (!room || !player || !point) return null;
  if (player.respawnTimer) {
    clearTimeout(player.respawnTimer);
    player.respawnTimer = null;
  }
  room.spawnSeq = (room.spawnSeq || 0) + 1;
  const spawn = {
    x: point.x,
    y: point.y,
    z: point.z,
    yaw: Number.isFinite(Number(point.yaw)) ? Number(point.yaw) : SPAWN_YAW,
    seq: room.spawnSeq
  };
  player.position = { x: spawn.x, y: spawn.y, z: spawn.z };
  player.rotation = { ...(player.rotation || {}), y: spawn.yaw };
  player.health = Math.max(1, player.health || 100);
  player.waitingForNextRound = false;
  player.respawningUntil = 0;
  clearCosmeticActionState(player);
  player.invulnerableUntil = 0;
  player.spawnProtectionStartedAt = 0;
  player.spawnProtectionOrigin = null;
  player.spawnSeq = spawn.seq;
  player.ac.lastValidPos = { x: spawn.x, y: spawn.y, z: spawn.z };
  player.ac.airborneSince = 0;
  player.ac.graceUntil = Date.now() + AC.RESPAWN_GRACE_MS;
  player.ac.pendingCorrection = false;
  player.dirty = true;
  return spawn;
}

function handleAdminTool(client, room, player, data = {}) {
  const action = String(data.action || '');
  const payload = { action, health: player.health, money: player.money };
  if (action === 'endGame') {
    const finished = finishAdminRoomGame(client.roomCode, room, player);
    if (!finished) return;
    payload.message = 'Admin test: game ended.';
  } else if (action === 'restoreSelf') {
    if (player.respawnTimer) {
      clearTimeout(player.respawnTimer);
      player.respawnTimer = null;
    }
    player.health = 100;
    player.waitingForNextRound = false;
    player.respawningUntil = 0;
    clearCosmeticActionState(player);
    player.activeAt = Date.now();
    player.dirty = true;
    payload.health = player.health;
    payload.resetAmmo = true;
    payload.message = 'Admin test: health and ammo restored.';
    broadcastToRoom(client.roomCode, null, 'playerHealth', { id: client.id, health: player.health });
  } else if (action === 'refillUtility') {
    resetUtilityLife(player);
    player.activeAt = Date.now();
    player.dirty = true;
    payload.utilityPurchasedThisLife = player.utilityPurchasedThisLife;
    payload.grenades = adminMaxUtilityCounts();
    payload.message = 'Admin test: utility refilled.';
  } else if (action === 'maxMoney') {
    player.money = MONEY_CAP;
    player.activeAt = Date.now();
    player.dirty = true;
    payload.money = player.money;
    payload.message = `Admin test: money set to $${MONEY_CAP}.`;
  } else if (action === 'clearDrops') {
    clearDroppedItems(room);
    broadcastDroppedItems(client.roomCode, room);
    payload.message = 'Admin test: dropped guns cleared.';
  } else if (['teleportCt', 'teleportT', 'teleportA', 'teleportB'].includes(action)) {
    const spawn = applyAdminTeleport(room, player, action);
    if (!spawn) return;
    payload.spawn = spawn;
    payload.health = player.health;
    payload.message = 'Admin test: teleported.';
  } else {
    return;
  }
  send(client, 'adminToolResult', payload);
  broadcastRoomState(client.roomCode);
}

function finishAdminRoomGame(roomCode, room, fallbackWinner = null) {
  if (!room || roomCode !== ADMIN_ROOM_CODE) return false;
  const mode = room.settings?.gamemode;
  if (MODE_CONFIG[mode]?.timed) {
    clearRoomRoundTimer(room);
    finishTimedRound(roomCode);
    return true;
  }
  if (mode === 'gunGame') {
    const players = Array.from(room.players.values());
    const winner = players.reduce((best, p) => {
      if (!best) return p;
      if ((p.kills || 0) !== (best.kills || 0)) return (p.kills || 0) > (best.kills || 0) ? p : best;
      return (p.roundDamageDealt || 0) > (best.roundDamageDealt || 0) ? p : best;
    }, null) || fallbackWinner;
    if (!winner) return false;
    finishGunGameRound(roomCode, room, winner);
    return true;
  }
  return false;
}

function ensureRoomRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  room.settings = sanitizeRoomSettings(room.settings);
  if (isContainment(room)) {
    const match = ensureContainment(room);
    for (const id of room.players.keys()) containment.registerPlayer(match, id);
    if (room.players.size > 0 && match.phase === containment.PHASES.WAITING) {
      containment.beginMatch(match, Date.now());
    }
    room.settings.roundEndsAt = null;
    clearRoomRoundTimer(room);
    broadcastContainment(roomCode, room);
    return;
  }
  if (roomCode === ADMIN_ROOM_CODE && ensureAdminConfig(room).infiniteRound) {
    room.settings.roundEndsAt = null;
    clearRoomRoundTimer(room);
    return;
  }
  if (MODE_CONFIG[room.settings.gamemode]?.casual) {
    ensureCasualState(room);
    updateCasualWarmup(roomCode, room);
    return;
  }
  if (MODE_CONFIG[room.settings.gamemode]?.timed) {
    if (!room.settings.roundEndsAt || room.settings.roundEndsAt <= Date.now()) {
      room.settings.roundEndsAt = Date.now() + TIMED_ROUND_MS;
    }
    scheduleTimedRoundEnd(roomCode);
  } else {
    room.settings.roundEndsAt = null;
    clearRoomRoundTimer(room);
  }
}

function scheduleTimedRoundEnd(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !MODE_CONFIG[room.settings.gamemode]?.timed) return;
  clearRoomRoundTimer(room);
  if (roomCode === ADMIN_ROOM_CODE && ensureAdminConfig(room).infiniteRound) {
    room.settings.roundEndsAt = null;
    return;
  }
  const delay = Math.max(250, room.settings.roundEndsAt - Date.now());
  room.roundTimer = setTimeout(() => finishTimedRound(roomCode), delay);
}

function clearRoomRoundTimer(room) {
  if (room?.roundTimer) clearTimeout(room.roundTimer);
  if (room) room.roundTimer = null;
}

function clearRoomMapVote(room) {
  if (room?.mapVoteTimer) clearTimeout(room.mapVoteTimer);
  if (room) {
    room.mapVoteTimer = null;
    room.mapVote = null;
  }
}

function publicMapLabel(mapId) {
  if (mapId === MAP_DUST2) return 'Dust2';
  return gameMaps.MAP_DEFS[mapId]?.label || mapId;
}

function publicMapVotePayload(room, viewerId = null) {
  const vote = room?.mapVote;
  if (!vote) return null;
  const counts = new Map(vote.options.map(mapId => [mapId, 0]));
  for (const mapId of vote.votes.values()) {
    if (counts.has(mapId)) counts.set(mapId, counts.get(mapId) + 1);
  }
  return {
    durationMs: PUBLIC_MAP_VOTE_MS,
    endsAt: vote.endsAt,
    selectedMapId: viewerId ? (vote.votes.get(viewerId) || null) : null,
    options: vote.options.map(mapId => ({ id: mapId, label: publicMapLabel(mapId), votes: counts.get(mapId) || 0 }))
  };
}

function publicMapVoteOptions() {
  const shuffled = PUBLIC_MAP_IDS.slice();
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = crypto.randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  const count = Math.min(PUBLIC_MAP_VOTE_MAX_OPTIONS, Math.max(PUBLIC_MAP_VOTE_MIN_OPTIONS, shuffled.length));
  return shuffled.slice(0, count);
}

function roomSupportsPublicMapVote(roomCode, room) {
  return roomCode !== ADMIN_ROOM_CODE
    && getRoomMapId(room) !== MAP_BACKROOMS
    && PUBLIC_MAP_SET.has(getRoomMapId(room))
    && PUBLIC_MAP_IDS.length >= PUBLIC_MAP_VOTE_MIN_OPTIONS
    && !MODE_CONFIG[room?.settings?.gamemode]?.casual;
}

function startRoomMapVote(roomCode, room, delayMs = DEATH_SPECTATE_MS) {
  if (!roomSupportsPublicMapVote(roomCode, room) || !room?.players?.size) return false;
  clearRoomMapVote(room);
  room.mapVoteTimer = setTimeout(() => {
    const liveRoom = rooms.get(roomCode);
    if (liveRoom !== room || !room.players.size) return clearRoomMapVote(room);
    room.mapVote = {
      options: publicMapVoteOptions(),
      votes: new Map(),
      endsAt: Date.now() + PUBLIC_MAP_VOTE_MS
    };
    room.mapVoteTimer = setTimeout(() => finishRoomMapVote(roomCode), PUBLIC_MAP_VOTE_MS);
    broadcastToRoom(roomCode, null, 'mapVoteStart', publicMapVotePayload(room));
  }, Math.max(0, Number(delayMs) || 0));
  return true;
}

function handleRoomMapVote(client, data = {}) {
  const room = client?.roomCode ? rooms.get(client.roomCode) : null;
  const vote = room?.mapVote;
  const mapId = String(data.mapId || '');
  if (!room || !vote || vote.endsAt <= Date.now() || !vote.options.includes(mapId) || !room.players.has(client.id)) return;
  vote.votes.set(client.id, mapId);
  broadcastToRoom(client.roomCode, null, 'mapVoteUpdate', publicMapVotePayload(room));
}

function finishRoomMapVote(roomCode) {
  const room = rooms.get(roomCode);
  const vote = room?.mapVote;
  if (!room || !vote) return;
  const finalPayload = publicMapVotePayload(room);
  const bestVotes = Math.max(...finalPayload.options.map(option => option.votes));
  const finalists = finalPayload.options.filter(option => option.votes === bestVotes);
  const winner = finalists[crypto.randomInt(finalists.length)];
  clearRoomMapVote(room);
  switchRoomMap(roomCode, room, winner.id, 'mapVoteResult', {
    winnerMapId: winner.id,
    winnerLabel: winner.label,
    options: finalPayload.options
  });
}

function finishTimedRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !MODE_CONFIG[room.settings.gamemode]?.timed) return;
  if (MODE_CONFIG[room.settings.gamemode]?.casual) {
    finishCasualTimedEvent(roomCode, room);
    return;
  }
  // Round-end touches every player + spawn scoring + broadcast and re-arms itself
  // every ~3 min. An uncaught throw here would crash the process and drop the
  // whole server on a fixed cadence — wrap the body, and guarantee the next round
  // still arms in finally so a bad round logs instead of freezing the timer.
  try {
    finishTimedRoundInner(roomCode, room);
  } catch (e) {
    console.error('[round] finishTimedRound failed for', roomCode, e && e.stack ? e.stack : e);
    const r = rooms.get(roomCode);
    if (r && MODE_CONFIG[r.settings.gamemode]?.timed) {
      r.settings.roundEndsAt = Date.now() + TIMED_ROUND_MS;
      scheduleTimedRoundEnd(roomCode);
    }
  }
}

function finishTimedRoundInner(roomCode, room) {
  const endedMode = room.settings.gamemode;
  const players = Array.from(room.players.values());
  const countsStats = countsForLeaderboardStats(room);

  let winner = null;
  let winnerTeam = null;
  const teamScores = [0, 0];
  if (MODE_CONFIG[endedMode].teams) {
    players.forEach((p) => { teamScores[p.team === 1 ? 1 : 0] += p.kills; });
    winnerTeam = teamScores[0] === teamScores[1] ? null : (teamScores[0] > teamScores[1] ? 0 : 1);
    // stats: credit a win to every player on the winning team
    if (winnerTeam !== null) {
      players.forEach((p) => {
        if (p.team === winnerTeam) {
          const c = clients.get(p.id);
          if (c && countsStats) {
            c.statDelta.wins += 1;
            c.statDelta.deathmatchWins += 1;
            recordDailyStat(c, p, { wins: 1 });
          }
        }
      });
    }
  } else {
    winner = players.reduce((best, p) => (!best || p.kills > best.kills ? p : best), null);
    if (winner) {
      const wc = clients.get(winner.id);
      if (wc && countsStats) {
        wc.statDelta.wins += 1;
        wc.statDelta.deathmatchWins += 1;
        recordDailyStat(wc, winner, { wins: 1 });
      }
    }
  }
  const mvp = selectRoundMvp(players);
  if (mvp?.id) {
    const mp = room.players.get(mvp.id);
    if (mp) {
      mp.mvps = (mp.mvps || 0) + 1;
      mp.dirty = true;
    }
    const mc = clients.get(mvp.id);
    if (mc && countsStats) mc.statDelta.mvps += 1;
  }

  if (countsStats) {
    const winnerIds = new Set();
    if (winnerTeam !== null) players.filter(p => p.team === winnerTeam).forEach(p => winnerIds.add(p.id));
    else if (winner?.id) winnerIds.add(winner.id);
    awardRoundXp(room, players, mvp, winnerIds);
  }

  players.forEach((roomPlayer) => {
    const existingMoney = Number(roomPlayer.money);
    roomPlayer.kills = 0;
    roomPlayer.assists = 0;
    roomPlayer.deaths = 0;
    roomPlayer.matchScore = 0;
    roomPlayer.health = 100;

    roomPlayer.money = MODE_CONFIG[room.settings.gamemode]?.casual
      ? CASUAL_START_MONEY
      : Math.max(0, Math.min(MONEY_CAP, Number.isFinite(existingMoney) ? existingMoney : START_MONEY));
    roomPlayer.roundDamageDealt = 0;
    roomPlayer.damageContributors = {};
    roomPlayer.utilityScoreAwards = {};
    roomPlayer.weaponKills = {};
    roomPlayer.weaponDamage = {};
    roomPlayer.lastKillWeapon = null;
    roomPlayer.waitingForNextRound = false;
    clearCosmeticActionState(roomPlayer);
    setPlayerLifecycle(roomPlayer, 'round-ended');
    resetUtilityLife(roomPlayer);
    resetHealthshotLife(roomPlayer);
    resetBuySession(roomPlayer, roomPlayer.position);
    roomPlayer.activeAt = Date.now();
    roomPlayer.dirty = true;
    roomPlayer.ac.lastValidPos = null;
  });
  // Round-reset fairness: players waiting to rejoin restart at zero too.
  if (room.pendingRejoins) {
    for (const st of room.pendingRejoins.values()) {
      const existingMoney = Number(st.money);
      st.kills = 0;
      st.assists = 0;
      st.deaths = 0;
      st.matchScore = 0;
      st.weaponKills = {};
      st.weaponDamage = {};
      st.lastKillWeapon = null;
      st.money = Math.max(0, Math.min(MONEY_CAP, Number.isFinite(existingMoney) ? existingMoney : START_MONEY));
      st.healthshots = 0;
      st.healthshotKills = 0;
      st.healthshotHealRemaining = 0;
    }
  }
  applyQueuedGamemode(roomCode);
  if (MODE_CONFIG[room.settings.gamemode]?.teams) rebalanceTeams(room);
  applyRoundMapScaling(room);
  const transitionEnd = Date.now() + ROUND_TRANSITION_MS;
  room.roundTransitionUntil = transitionEnd;
  room.roundStartedAt = transitionEnd;
  scheduleRoomBreakableGlassReset(roomCode, room, transitionEnd);
  room.activeFires = [];
  room.activeSmokes = [];
  room.recentBursts = [];
  clearRoomBarricades(room);
  clearRoomC4Charges(room);
  room.progressionSuppressedRound = false;
  room.progressionSuppressedReason = '';
  if (MODE_CONFIG[room.settings.gamemode]?.timed && !(roomCode === ADMIN_ROOM_CODE && ensureAdminConfig(room).infiniteRound)) {
    room.settings.roundEndsAt = transitionEnd + TIMED_ROUND_MS;
    scheduleTimedRoundEnd(roomCode);
  } else {
    room.settings.roundEndsAt = null;
    clearRoomRoundTimer(room);
  }

  const spawns = batchRespawn(room);
  if (MODE_CONFIG[endedMode].teams) {
    broadcastToRoom(roomCode, null, 'tdmReset', { mode: endedMode, winnerTeam, teamScores, players, settings: room.settings, spawns, mvp });
  } else {
    broadcastToRoom(roomCode, null, 'deathmatchReset', {
      winnerId: winner?.id || null,
      winnerName: winner?.name || 'No one',
      players,
      settings: room.settings,
      spawns,
      mvp
    });
  }
  startRoomMapVote(roomCode, room);
}

function finishGunGameRound(roomCode, room, winnerPlayer) {
  if (!room || room.settings?.gamemode !== 'gunGame' || !winnerPlayer) return;
  const players = Array.from(room.players.values());
  const mvp = selectRoundMvp(players) || {
    id: winnerPlayer.id,
    name: winnerPlayer.name,
    kills: winnerPlayer.kills || 0,
    deaths: winnerPlayer.deaths || 0,
    assists: winnerPlayer.assists || 0,
    damage: Math.round(winnerPlayer.roundDamageDealt || 0),
    team: winnerPlayer.team,
    topWeapon: topKillWeapon(winnerPlayer),
    topDamageWeapon: topDamageWeapon(winnerPlayer)
  };
  const countsStats = countsForLeaderboardStats(room);
  if (countsStats) awardRoundXp(room, players, mvp, new Set([winnerPlayer.id]));
  players.forEach((roomPlayer) => {
    roomPlayer.kills = 0;
    roomPlayer.assists = 0;
    roomPlayer.deaths = 0;
    roomPlayer.matchScore = 0;
    roomPlayer.health = 100;
    roomPlayer.roundDamageDealt = 0;
    roomPlayer.damageContributors = {};
    roomPlayer.utilityScoreAwards = {};
    roomPlayer.weaponKills = {};
    roomPlayer.weaponDamage = {};
    roomPlayer.lastKillWeapon = null;
    roomPlayer.waitingForNextRound = false;
    clearCosmeticActionState(roomPlayer);
    setPlayerLifecycle(roomPlayer, 'round-ended');
    resetBuySession(roomPlayer, roomPlayer.position);
    roomPlayer.activeAt = Date.now();
    roomPlayer.ac.lastValidPos = null; // re-anchor after the round reset teleports
  });
  // Round-reset fairness: players waiting to rejoin restart at zero too.
  if (room.pendingRejoins) {
    for (const st of room.pendingRejoins.values()) {
      st.kills = 0;
      st.assists = 0;
      st.deaths = 0;
      st.matchScore = 0;
      st.weaponKills = {};
      st.weaponDamage = {};
      st.lastKillWeapon = null;
    }
  }
  const winnerClient = clients.get(winnerPlayer.id);
  if (winnerClient && countsStats) {
    winnerClient.statDelta.wins += 1;
    winnerClient.statDelta.gungameWins += 1;
  }
  if (mvp?.id) {
    const mp = room.players.get(mvp.id);
    if (mp) {
      mp.mvps = (mp.mvps || 0) + 1;
      mp.dirty = true;
    }
    const mc = clients.get(mvp.id);
    if (mc && countsStats) mc.statDelta.mvps += 1;
  }
  const transitionEnd = Date.now() + ROUND_TRANSITION_MS;
  room.roundTransitionUntil = transitionEnd;
  applyQueuedGamemode(roomCode);
  if (MODE_CONFIG[room.settings.gamemode]?.teams) rebalanceTeams(room);
  applyRoundMapScaling(room);
  room.roundStartedAt = transitionEnd;
  scheduleRoomBreakableGlassReset(roomCode, room, transitionEnd);
  room.activeFires = [];
  room.activeSmokes = [];
  room.recentBursts = [];
  clearRoomBarricades(room);
  clearRoomC4Charges(room);
  room.progressionSuppressedRound = false;
  room.progressionSuppressedReason = '';
  const spawns = batchRespawn(room);
  broadcastToRoom(roomCode, null, 'gunGameReset', {
    winnerId: winnerPlayer.id,
    winnerName: winnerPlayer.name,
    players,
    settings: room.settings,
    spawns,
    mvp
  });
  startRoomMapVote(roomCode, room);
}

function selectRoundMvp(players) {
  // Score-first MVP. Kills/objectives/deaths/damage are only tie-breakers.
  // The expanded topFive is display-only for the end-round stage; only the
  // first placement increments persistent MVP stats.
  const eligible = players.filter(p => p && ((p.matchScore || 0) !== 0 || p.kills > 0 || (p.roundDamageDealt || 0) > 0));
  if (!eligible.length) return null;
  const ranked = eligible.slice().sort((a, b) =>
    ((b.matchScore || 0) - (a.matchScore || 0)) ||
    ((b.kills || 0) - (a.kills || 0)) ||
    ((b.objectiveScore || 0) - (a.objectiveScore || 0)) ||
    ((a.deaths || 0) - (b.deaths || 0)) ||
    ((b.roundDamageDealt || 0) - (a.roundDamageDealt || 0)) ||
    String(a.name).localeCompare(String(b.name))
  );
  const toPlacement = (player, place) => {
    const topWeapon = topKillWeapon(player);
    const topDamage = topDamageWeapon(player);
    const award = roundAwardForPlayer(player, place, topDamage);
    return {
      place,
      id: player.id,
      name: player.name,
      team: player.team,
      kills: player.kills || 0,
      deaths: player.deaths || 0,
      assists: player.assists || 0,
      score: player.matchScore || 0,
      objectiveScore: player.objectiveScore || 0,
      damage: Math.round(player.roundDamageDealt || 0),
      topWeapon,
      topDamageWeapon: topDamage,
      awardTitle: award.title,
      awardStat: award.stat
    };
  };
  const topFive = ranked.slice(0, 5).map((player, index) => toPlacement(player, index + 1));
  return { ...topFive[0], topThree: topFive.slice(0, 3), topFive };
}

function matchXpForPlayer(player, { won = false, mvp = false } = {}) {
  const performanceXp = Math.max(0, Math.floor(Number(player?.matchScore || 0) / 11));
  const participationXp = Math.min(1100, 90 + performanceXp + (mvp ? 70 : 0));
  return won ? participationXp * 2 : participationXp;
}

const LEVEL_BASE_XP = 350;
const LEVEL_XP_GROWTH = 1.15;

function progressionForXpLocal(rawXp) {
  const xp = Math.max(0, Math.floor(Number(rawXp) || 0));
  let remaining = xp;
  let level = 1;
  let required = LEVEL_BASE_XP;
  while (remaining >= required && level < 1000) {
    remaining -= required;
    level += 1;
    required = level <= 20 ? Math.round(LEVEL_BASE_XP * Math.pow(LEVEL_XP_GROWTH, level - 1)) : Math.round(LEVEL_BASE_XP * Math.pow(LEVEL_XP_GROWTH, 19));
  }
  return { xp, level, levelXp: remaining, nextLevelXp: required };
}

function mowbucksForLevels(beforeLevel, afterLevel) {
  let total = 0;
  for (let level = Math.max(2, beforeLevel + 1); level <= afterLevel; level += 1) {
    total += Math.min(200, 100 + ((level - 1) * 5));
  }
  return total;
}

async function accountLevelForTrade(accountId) {
  const stats = await db.getStats(accountId);
  return progressionForXpLocal(stats?.xp || 0).level;
}

async function awardXpAndMowbucks(client, amount, reason = '') {
  const beforeStats = await db.getStats(client.accountId);
  const beforeLevel = progressionForXpLocal(beforeStats?.xp || 0).level;
  const xp = await db.addXp(client.accountId, amount);
  const afterLevel = progressionForXpLocal(xp).level;
  const levelsGained = Math.max(0, afterLevel - beforeLevel);
  const mowbucks = mowbucksForLevels(beforeLevel, afterLevel);
  if (mowbucks > 0) await db.addMowbucks(client.accountId, mowbucks);
  send(client, 'progressionUpdate', { amount, reason, mowbucks, levelsGained, level: afterLevel, stats: await auth.statsPayload(client.accountId) });
}

function awardRoundXp(room, players, mvp, winnerIds = new Set()) {
  // Final round awards are the last line of defense for persistent progression.
  // The hit path suppresses tainted rounds when untrusted damage appears, but
  // this function must still short-circuit non-progression rooms.
  if (!db.isEnabled() || !countsForProgression(room)) return;
  if (room.progressionSuppressedRound) return;
  const awardKey = `${room.settings?.gamemode || 'mode'}:${room.roundStartedAt || 0}:${room.settings?.roundEndsAt || 0}`;
  if (room.lastXpAwardKey === awardKey) return;
  room.lastXpAwardKey = awardKey;
  for (const player of players) {
    const client = clients.get(player.id);
    if (!client?.accountId || client.guest) continue;
    const amount = matchXpForPlayer(player, { won: winnerIds.has(player.id), mvp: mvp?.id === player.id });
    awardXpAndMowbucks(client, amount, 'Match complete')
      .catch(error => console.error('[xp]', error.message));
  }
}

function topKillWeapon(player) {
  const kills = player?.weaponKills && typeof player.weaponKills === 'object' ? player.weaponKills : {};
  let bestWeapon = null;
  let bestKills = -1;
  for (const [weapon, count] of Object.entries(kills)) {
    if (!WEAPONS[weapon]) continue;
    const n = Number(count) || 0;
    if (n > bestKills || (n === bestKills && weapon === player.lastKillWeapon)) {
      bestWeapon = weapon;
      bestKills = n;
    }
  }
  return bestWeapon || (WEAPONS[player?.lastKillWeapon] ? player.lastKillWeapon : (WEAPONS[player?.weapon] ? player.weapon : 'AK47'));
}

function topDamageWeapon(player) {
  const damage = player?.weaponDamage && typeof player.weaponDamage === 'object' ? player.weaponDamage : {};
  let bestWeapon = null;
  let bestDamage = -1;
  for (const [weapon, amount] of Object.entries(damage)) {
    if (!WEAPONS[weapon]) continue;
    const n = Number(amount) || 0;
    const bestIsUtility = bestWeapon && WEAPONS[bestWeapon]?.type === 'grenade';
    const candidateIsUtility = WEAPONS[weapon]?.type === 'grenade';
    if (
      n > bestDamage ||
      (n === bestDamage && weapon === player.lastKillWeapon) ||
      (n === bestDamage && bestIsUtility && !candidateIsUtility)
    ) {
      bestWeapon = weapon;
      bestDamage = n;
    }
  }
  return bestWeapon || topKillWeapon(player);
}

function roundAwardForPlayer(player, place, topDamage = null) {
  const kills = player.kills || 0;
  const assists = player.assists || 0;
  const deaths = player.deaths || 0;
  const damage = Math.round(player.roundDamageDealt || 0);
  const score = player.matchScore || 0;
  const weapon = topDamage || topDamageWeapon(player);
  if (place === 1) return { title: 'Most Valuable Mower', stat: `${score} score` };
  if (weapon === 'Molotov') return { title: 'Fire Starter', stat: `${damage} burn damage` };
  if (weapon === 'Flash') return { title: 'Flash', stat: `${assists || kills} flash impact` };
  if (weapon === 'Knife') return { title: 'Ninja', stat: `${kills} knife cuts` };
  if (['AWP', 'SSG08'].includes(weapon)) return { title: 'Bullseye', stat: `${damage} sniper damage` };
  if (kills >= 4) return { title: 'Quad Killer', stat: `Most 4-kills: ${kills}` };
  if (kills >= 3) return { title: 'Trifecta', stat: `Most 3-kills: ${kills}` };
  if (assists >= 5) return { title: 'Moral Support', stat: `${assists} assists` };
  if (damage >= 1200) return { title: 'Weapons Master', stat: `${damage} damage` };
  if (deaths <= 1 && kills >= 2) return { title: 'Survivor', stat: `${deaths} deaths` };
  if (kills >= assists) return { title: 'Entry Fragger', stat: `${kills} cuts` };
  return { title: 'Tenderizer', stat: `${assists} assists` };
}

function applyQueuedGamemode(roomCode) {
  const room = rooms.get(roomCode);
  if (!room?.settings?.nextGamemode) return;
  const nextGamemode = room.settings.nextGamemode;
  const wasTeams = MODE_CONFIG[room.settings.gamemode]?.teams;
  room.settings = sanitizeRoomSettings({ ...room.settings, gamemode: nextGamemode, nextGamemode: null });
  if (MODE_CONFIG[room.settings.gamemode]?.teams && !wasTeams) rebalanceTeams(room);
  ensureRoomRound(roomCode);
}

function broadcastRoomState(roomCode) {
  const state = getRoomState(roomCode);
  if (state) broadcastToRoom(roomCode, null, 'roomState', state);
}

function resetRoomBreakableGlass(roomCode, room, broadcast = true) {
  if (!room) return;
  if (!room.brokenGlassPanes) room.brokenGlassPanes = new Set();
  room.brokenGlassPanes.clear();
  if (broadcast) broadcastToRoom(roomCode, null, 'glassReset', {});
}

function resetRoomBreakableVents(roomCode, room, broadcast = true) {
  if (!room) return;
  if (!room.brokenVentIds) room.brokenVentIds = new Set();
  room.brokenVentIds.clear();
  if (broadcast) broadcastToRoom(roomCode, null, 'ventReset', {});
}

function resetRoomDoors(roomCode, room, broadcast = true) {
  if (!room) return;
  if (!room.openDoors) room.openDoors = new Set();
  room.openDoors.clear();
  if (broadcast) broadcastToRoom(roomCode, null, 'doorReset', {});
}

function scheduleRoomBreakableGlassReset(roomCode, room, startsAt) {
  if (!room) return;
  if (room.glassResetTimer) clearTimeout(room.glassResetTimer);
  room.glassResetTimer = setTimeout(() => {
    const activeRoom = rooms.get(roomCode);
    if (!activeRoom) return;
    activeRoom.glassResetTimer = null;
    resetRoomBreakableGlass(roomCode, activeRoom, true);
    resetRoomBreakableVents(roomCode, activeRoom, true);
    resetRoomDoors(roomCode, activeRoom, true);
  }, Math.max(0, Number(startsAt || Date.now()) - Date.now()));
}

// ---------------------------------------------------------------------------
// Server-authoritative spawning (from origin/main)
// ---------------------------------------------------------------------------
function countTeam(room, team) {
  let count = 0;
  for (const p of room.players.values()) if (p.team === team) count += 1;
  return count;
}

function freshUtilityCounts() {
  return { frag: 0, smoke: 0, flash: 0, molotov: 0, barricade: 0, c4: 0 };
}

function resetUtilityLife(player) {
  if (!player) return;
  player.utilityPurchasedThisLife = freshUtilityCounts();
  // Deployed barricades outlive their owner's life; the allowance does not.
  player.barricadesDeployedThisLife = 0;
  player.c4DeployedThisLife = 0;
  resetShotgunLoad(player);
}

function resetHealthshotLife(player) {
  if (!player) return;
  // Healthshots are earned inside one active DM/TDM life cycle only; round
  // changes, deaths, and lobby exits clear both charges and partial kill credit.
  player.healthshots = 0;
  player.healthshotKills = 0;
  player.healthshotHealRemaining = 0;
}

function sendHealthshotState(client, player, extra = {}) {
  if (!client || !player) return;
  send(client, 'healthshotState', {
    id: player.id,
    healthshots: Math.max(0, Number(player.healthshots || 0)),
    progress: Math.max(0, Number(player.healthshotKills || 0)),
    healing: player.healthshotHealRemaining > 0,
    ...extra
  });
}

function grantHealthshotKillProgress(client, room, player) {
  if (!client || !room || !player || !usesUtility(room)) return;
  player.healthshotKills = Math.max(0, Number(player.healthshotKills || 0)) + 1;
  if (player.healthshotKills >= 2) {
    player.healthshotKills = 0;
    player.healthshots = Math.min(2, Math.max(0, Number(player.healthshots || 0)) + 1);
    send(client, 'healthshotAwarded', {
      id: player.id,
      healthshots: player.healthshots,
      progress: player.healthshotKills,
      healing: player.healthshotHealRemaining > 0
    });
  } else {
    sendHealthshotState(client, player);
  }
}

function clearCosmeticActionState(player) {
  if (!player) return;
  player.jumping = false;
  player.reloading = false;
}

function pickBalancedTeam(room) {
  const counts = [countTeam(room, 0), countTeam(room, 1)];
  if (counts[0] !== counts[1]) return counts[0] < counts[1] ? 0 : 1;
  return Math.random() < 0.5 ? 0 : 1;
}
function rebalanceTeams(room) {
  const teams = { 0: [], 1: [] };
  for (const p of room.players.values()) {
    if (p.team !== 0 && p.team !== 1) {
      p.team = teams[0].length <= teams[1].length ? 0 : 1;
    }
    teams[p.team].push(p);
  }
  while (Math.abs(teams[0].length - teams[1].length) > 1) {
    const from = teams[0].length > teams[1].length ? 0 : 1;
    const to = from === 0 ? 1 : 0;
    const moved = teams[from].pop();
    if (!moved) break;
    moved.team = to;
    moved.dirty = true;
    teams[to].push(moved);
  }
}

function isBuyMode(room) {
  const mode = room?.settings?.gamemode;
  return mode === 'deathmatch' || mode === 'tdm';
}

function isCasualMode(room) {
  return !!MODE_CONFIG[room?.settings?.gamemode]?.casual;
}

function isWeaponAvailableInMode(room, weaponName) {
  if (!WEAPONS[weaponName]) return false;
  if (isWeaponDisabledByAdmin(room, weaponName)) return false;
  return isCasualMode(room) || !CASUAL_ONLY_WEAPONS.has(weaponName);
}

// ---- Admin testing room: per-room config overrides --------------------------
function ensureAdminConfig(room) {
  if (!room.adminConfig) {
    room.adminConfig = {};
  }
  room.adminConfig.weaponPrices = room.adminConfig.weaponPrices || {};
  room.adminConfig.grenadePrices = room.adminConfig.grenadePrices || {};
  room.adminConfig.weaponDisabled = Array.isArray(room.adminConfig.weaponDisabled) ? room.adminConfig.weaponDisabled : [];
  room.adminConfig.grenadeDisabled = Array.isArray(room.adminConfig.grenadeDisabled) ? room.adminConfig.grenadeDisabled : [];
  room.adminConfig.infiniteAmmo = room.adminConfig.infiniteAmmo === true;
  room.adminConfig.infiniteUtility = room.adminConfig.infiniteUtility === true;
  room.adminConfig.instaReload = room.adminConfig.instaReload === true;
  room.adminConfig.infiniteRound = room.adminConfig.infiniteRound === true;
  // Admin-room-only: freeze new director arrivals without freezing the
  // existing horde or changing the current wave's pending budget.
  room.adminConfig.zombieSpawnsPaused = room.adminConfig.zombieSpawnsPaused === true;
  return room.adminConfig;
}
function roomWeaponPrice(room, weapon) {
  const o = room?.adminConfig?.weaponPrices;
  if (o && Number.isFinite(Number(o[weapon]))) return Number(o[weapon]);
  return WEAPON_PRICES[weapon];
}
function roomUtilityPrice(room, kind) {
  const o = room?.adminConfig?.grenadePrices;
  if (o && Number.isFinite(Number(o[kind]))) return Number(o[kind]);
  return UTILITY_PRICES[kind];
}
function isWeaponDisabledByAdmin(room, weapon) {
  return Array.isArray(room?.adminConfig?.weaponDisabled) && room.adminConfig.weaponDisabled.includes(weapon);
}
function isGrenadeDisabledByAdmin(room, kind) {
  return Array.isArray(room?.adminConfig?.grenadeDisabled) && room.adminConfig.grenadeDisabled.includes(kind);
}
// Apply a validated patch from any member of the admin room. Returns true if the
// gamemode changed (so the caller can re-init the round immediately).
function applyAdminConfigPatch(roomCode, room, data) {
  const cfg = ensureAdminConfig(room);
  const p = data && typeof data === 'object' ? data : {};
  let modeChanged = false;
  if (typeof p.gamemode === 'string' && VALID_GAMEMODES.has(p.gamemode) && p.gamemode !== room.settings.gamemode) {
    room.settings = sanitizeRoomSettings({ ...room.settings, nextGamemode: p.gamemode }, room.settings);
    applyQueuedGamemode(roomCode); // switch immediately — it's a test room
    modeChanged = true;
  }
  if (typeof p.fullMap === 'boolean') {
    room.settings = sanitizeRoomSettings({ ...room.settings, fullMap: p.fullMap }, room.settings);
  }
  if (typeof p.infiniteAmmo === 'boolean') {
    cfg.infiniteAmmo = p.infiniteAmmo;
  }
  if (typeof p.infiniteUtility === 'boolean') {
    cfg.infiniteUtility = p.infiniteUtility;
  }
  if (typeof p.instaReload === 'boolean') {
    cfg.instaReload = p.instaReload;
  }
  if (typeof p.infiniteRound === 'boolean') {
    cfg.infiniteRound = p.infiniteRound;
    if (cfg.infiniteRound) {
      room.settings.roundEndsAt = null;
      clearRoomRoundTimer(room);
    } else {
      ensureRoomRound(roomCode);
    }
  }
  if (typeof p.zombieSpawnsPaused === 'boolean') {
    cfg.zombieSpawnsPaused = p.zombieSpawnsPaused;
    // The admin-panel switch and the Containment HUD button are two doors onto
    // one hold. Delegating to the match keeps them from disagreeing - otherwise
    // a room could show "Active" in the panel while the director was held.
    if (isContainment(room)) {
      containment.setSpawnPaused(ensureContainment(room), cfg.zombieSpawnsPaused);
      broadcastContainment(roomCode, room);
    }
  }
  if (p.freeEverything === true) {
    for (const name of Object.keys(WEAPON_PRICES)) cfg.weaponPrices[name] = 0;
    for (const kind of Object.keys(UTILITY_PRICES)) cfg.grenadePrices[kind] = 0;
  }
  if (p.weaponPrice && typeof p.weaponPrice === 'object') {
    const name = p.weaponPrice.name;
    const price = Number(p.weaponPrice.price);
    if (WEAPONS[name] && Number.isFinite(price)) {
      cfg.weaponPrices[name] = Math.max(0, Math.min(MONEY_CAP, Math.round(price)));
    }
  }
  if (p.grenadePrice && typeof p.grenadePrice === 'object') {
    const kind = p.grenadePrice.kind;
    const price = Number(p.grenadePrice.price);
    if (UTILITY_PRICES[kind] !== undefined && Number.isFinite(price)) {
      cfg.grenadePrices[kind] = Math.max(0, Math.min(MONEY_CAP, Math.round(price)));
    }
  }
  if (p.weaponToggle && typeof p.weaponToggle === 'object' && WEAPONS[p.weaponToggle.name]) {
    const name = p.weaponToggle.name;
    cfg.weaponDisabled = cfg.weaponDisabled.filter(w => w !== name);
    if (!p.weaponToggle.enabled) cfg.weaponDisabled.push(name);
  }
  if (p.grenadeToggle && typeof p.grenadeToggle === 'object' && UTILITY_PRICES[p.grenadeToggle.kind] !== undefined) {
    const kind = p.grenadeToggle.kind;
    cfg.grenadeDisabled = cfg.grenadeDisabled.filter(k => k !== kind);
    if (!p.grenadeToggle.enabled) cfg.grenadeDisabled.push(kind);
  }
  return modeChanged;
}

// Switch a room's map: re-anchor settings, batch-respawn everyone on the new
// map's spawn points, and broadcast a reload so every client loads the result.
function switchRoomMap(roomCode, room, mapId, eventType = 'mapChanged', extra = {}) {
  if (!room || !VALID_MAP_IDS.has(mapId)) return false;
  if (room.glassResetTimer) {
    clearTimeout(room.glassResetTimer);
    room.glassResetTimer = null;
  }
  resetRoomBreakableGlass(roomCode, room, false);
  resetRoomBreakableVents(roomCode, room, false);
  resetRoomDoors(roomCode, room, false);
  room.settings = sanitizeRoomSettings({ ...room.settings, mapId }, room.settings);
  // A Containment run's gates and breach catalog are map-owned. Never carry
  // opened sectors or cached entry points into the newly selected level.
  room.containment = null;
  room.containmentSpawns = null;
  room.containmentSpawnCatalog = null;
  applyRoundMapScaling(room);
  const spawns = batchRespawn(room); // uses the new map's spawn points (settings.mapId)
  ensureRoomRound(roomCode);
  broadcastToRoom(roomCode, null, eventType, {
    ...extra,
    settings: room.settings,
    brokenGlassPanes: [],
    brokenVentIds: [],
    openDoorIds: [],
    spawns,
    players: Array.from(room.players.values()),
    casual: publicCasualState(room)
  });
  return true;
}

function adminSwitchMap(roomCode, room, mapId) {
  return switchRoomMap(roomCode, room, mapId);
}

// An admin overriding a room they do not host.
//
// Deliberately immediate rather than queued. The host's own mode control sets
// nextGamemode, which waits for the round to end - fine when you are the host
// and chose it, useless when the point is to correct a room that is stuck or
// being abused right now.
//
// The role is read from the authenticated socket, never from the packet, and
// the settings go through sanitizeRoomSettings like every other path, so an
// admin cannot conjure a mode or a map that does not exist.
function handleAdminForceRoomSettings(client, room, data = {}) {
  if (!isAdminUser(client) || !room) return;
  const roomCode = client.roomCode;
  if (!roomCode) return;

  const requestedMode = String(data.gamemode || '').trim();
  const changingMode = requestedMode
    && VALID_GAMEMODES.has(requestedMode)
    && requestedMode !== room.settings.gamemode;
  const changingMap = data.fullMap !== undefined;
  if (!changingMode && !changingMap) return;

  const wasTeams = !!MODE_CONFIG[room.settings.gamemode]?.teams;
  room.settings = sanitizeRoomSettings({
    ...room.settings,
    gamemode: changingMode ? requestedMode : room.settings.gamemode,
    // Drop any queued mode. Leaving it would let the next round quietly undo
    // the override, which reads as the force having silently failed.
    nextGamemode: null,
    fullMap: changingMap ? Boolean(data.fullMap) : room.settings.fullMap
  }, room.settings);

  // Moving into a team mode from a free-for-all leaves everyone on one side.
  if (MODE_CONFIG[room.settings.gamemode]?.teams && !wasTeams) rebalanceTeams(room);

  // A Containment run is mode-owned. Carrying its wave director, gates or breach
  // catalog into a PvP mode would leave a horde simulating in a deathmatch.
  room.containment = null;
  room.containmentSpawns = null;
  room.containmentSpawnCatalog = null;

  // Reuse the map-switch path rather than reinventing it: it rescales spawns for
  // the half/full map choice, resets glass, vents and doors, respawns everyone
  // and rebroadcasts the whole room. A forced change needs all of that, because
  // team assignment and spawn scaling both just moved under the players' feet.
  switchRoomMap(roomCode, room, room.settings.mapId, 'mapChanged', { forced: true });
  broadcastRoomList();
  console.warn(
    `[admin-room] ${client.accountId} forced ${roomCode}: mode=${room.settings.gamemode} fullMap=${room.settings.fullMap}`
  );
}

function buyDeniedMessage(room, player) {
  if (!player || (player.health || 0) <= 0 || player.waitingForNextRound) return 'You cannot buy while dead or spectating.';
  if (isCasualMode(room) && !isCasualWarmup(room) && !isCasualBuyTime(room)) return 'Buy time has ended.';
  if (!isInTeamBuyZone(room, player)) return 'You are not in a buy zone.';
  return 'You cannot buy right now.';
}

function canPlayerBuy(room, player) {
  if (!isBuyMode(room) || !player || (player.health || 0) <= 0 || player.waitingForNextRound) return false;
  if (!isCasualMode(room)) return true;
  if (!isCasualWarmup(room) && !isCasualBuyTime(room)) return false;
  return isInTeamBuyZone(room, player);
}

function resetBuySession(player, origin = player?.position) {
  if (!player) return;
  player.buyHistory = [];
  player.buyLocked = false;
  player.buyOrigin = origin ? { x: origin.x, y: origin.y, z: origin.z } : null;
  player.buyCounter = 0;
}

function lockBuyRefunds(player) {
  if (!player) return;
  player.buyLocked = true;
}

function recordBuyPurchase(player, purchase = {}) {
  if (!player || !Number.isFinite(Number(purchase.price)) || Number(purchase.price) <= 0) return null;
  if (!Array.isArray(player.buyHistory)) player.buyHistory = [];
  const id = `${Date.now().toString(36)}-${String(player.id || 'p').slice(0, 4)}-${(player.buyCounter = (player.buyCounter || 0) + 1)}`;
  const entry = { ...purchase, id, at: Date.now(), price: Math.max(0, Math.round(Number(purchase.price))) };
  player.buyHistory.push(entry);
  if (player.buyHistory.length > 8) player.buyHistory.shift();
  return entry;
}

function nextRefundId(player) {
  if (!Array.isArray(player?.buyHistory) || !player.buyHistory.length) return null;
  return player.buyHistory[player.buyHistory.length - 1].id;
}

function shouldLockBuyRefundFromMove(player, nextPos) {
  if (!player?.buyOrigin || player.buyLocked) return false;
  return distanceBetweenVectors(player.buyOrigin, nextPos) > Math.max(SPAWN_PROTECTION_MOVE_EPSILON, 8);
}

function handleRefundPurchase(client, room, player, data = {}) {
  if (!isCasualMode(room) || isCasualWarmup(room)) {
    send(client, 'refundDenied', { money: player.money, message: 'Refunds are only available during Casual buy time.', nextRefundId: nextRefundId(player) });
    return;
  }
  if (!canPlayerBuy(room, player)) {
    send(client, 'refundDenied', { money: player.money, message: buyDeniedMessage(room, player), nextRefundId: nextRefundId(player) });
    return;
  }
  if (player.buyLocked) {
    send(client, 'refundDenied', { money: player.money, message: 'Refund locked after moving, shooting, or using utility.', nextRefundId: nextRefundId(player) });
    return;
  }
  const requestedId = String(data.id || '');
  const last = Array.isArray(player.buyHistory) ? player.buyHistory[player.buyHistory.length - 1] : null;
  if (!last || (requestedId && requestedId !== last.id)) {
    send(client, 'refundDenied', { money: player.money, message: 'No refundable purchase found.', nextRefundId: nextRefundId(player) });
    return;
  }
  player.buyHistory.pop();
  addMoney(player, last.price || 0);
  if (last.type === 'weapon' && WEAPONS[last.previousWeapon]) {
    player.weapon = last.previousWeapon;
  } else if (last.type === 'utility' && player.utilityPurchasedThisLife && player.utilityPurchasedThisLife[last.kind] !== undefined) {
    player.utilityPurchasedThisLife[last.kind] = Math.max(0, (player.utilityPurchasedThisLife[last.kind] || 0) - 1);
  }
  player.dirty = true;
  send(client, 'purchaseRefunded', {
    id: last.id,
    type: last.type,
    kind: last.kind || null,
    slot: last.slot || null,
    previousWeapon: last.previousWeapon || null,
    money: player.money,
    utilityPurchasedThisLife: player.utilityPurchasedThisLife,
    nextRefundId: nextRefundId(player),
    message: 'Purchase refunded.'
  });
}

function isCasualBuyTime(room, now = Date.now()) {
  if (!isCasualMode(room)) return true;
  const st = ensureCasualState(room);
  if (['warmup', 'countdown'].includes(st.phase)) return true;
  if (st.phase === 'intro') return true;
  if (!room.roundStartedAt) return false;
  return st.phase === 'live' && now <= room.roundStartedAt + CASUAL_BUY_TIME_MS;
}

function getRoomMapId(room) {
  const id = room?.settings?.mapId;
  return VALID_MAP_IDS.has(id) ? id : MAP_DUST2;
}

function activeHalfMapRule(room) {
  if (!room?.settings || room.settings.fullMap) return null;
  return HALF_MAP_RULES[getRoomMapId(room)] || null;
}

function correctedHalfMapPosition(room, position, crouching = false) {
  const rule = activeHalfMapRule(room);
  if (!rule || !position) return null;
  const corrected = { x: position.x, y: position.y, z: position.z };
  if (rule.type === 'floor') {
    if (position.x < rule.xMin || position.x > rule.xMax || position.z < rule.zMin || position.z > rule.zMax) return null;
    const eyeHeight = crouching ? 11 : 18;
    if (position.y - eyeHeight >= rule.top - 0.25) return null;
    corrected.y = rule.top + eyeHeight + 0.1;
    return corrected;
  }
  if (rule.type === 'wallX') {
    if (position.y < rule.yMin || position.y > rule.yMax || position.z < rule.zMin || position.z > rule.zMax) return null;
    const clearance = Number(rule.thickness || 0) / 2 + 3;
    if (rule.keep === 'less') {
      const limit = rule.x - clearance;
      if (position.x <= limit) return null;
      corrected.x = limit;
      return corrected;
    }
    const limit = rule.x + clearance;
    if (position.x >= limit) return null;
    corrected.x = limit;
    return corrected;
  }
  return null;
}

function halfMapSegmentBlocked(room, start, end) {
  const rule = activeHalfMapRule(room);
  if (!rule || !start || !end) return false;
  const axis = rule.type === 'floor' ? 'y' : 'x';
  const plane = rule.type === 'floor' ? rule.top : rule.x;
  const delta = Number(end[axis]) - Number(start[axis]);
  if (Math.abs(delta) < 1e-9) return false;
  const t = (plane - Number(start[axis])) / delta;
  if (t < 0 || t > 1) return false;
  const hit = {
    x: Number(start.x) + (Number(end.x) - Number(start.x)) * t,
    y: Number(start.y) + (Number(end.y) - Number(start.y)) * t,
    z: Number(start.z) + (Number(end.z) - Number(start.z)) * t
  };
  if (rule.type === 'floor') {
    return hit.x >= rule.xMin && hit.x <= rule.xMax && hit.z >= rule.zMin && hit.z <= rule.zMax;
  }
  return hit.y >= rule.yMin && hit.y <= rule.yMax && hit.z >= rule.zMin && hit.z <= rule.zMax;
}

function getMapCollision(roomOrMapId) {
  const mapId = typeof roomOrMapId === 'string' ? roomOrMapId : getRoomMapId(roomOrMapId);
  return mapCollisions.get(mapId) || null;
}

function groundYForRoom(room, x, z, fromY = null) {
  const mapCollision = getMapCollision(room);
  if (!mapCollision) return null;
  if (ADMIN_MAP_IDS.includes(getRoomMapId(room)) && mapCollision.walkableGroundY) {
    return mapCollision.walkableGroundY(x, z, fromY);
  }
  return mapCollision.groundY(x, z, fromY);
}

function isBackroomsRoom(room) {
  return getRoomMapId(room) === MAP_BACKROOMS;
}

function getSpawnPoints(room) {
  const mapId = getRoomMapId(room);
  return gameMaps.SPAWN_SETS[mapId]?.points
    || (mapId === MAP_BACKROOMS ? BACKROOMS_SPAWN_POINTS : SPAWN_POINTS);
}

function getTeamSpawnIds(room, team) {
  const mapId = getRoomMapId(room);
  const ids = gameMaps.SPAWN_SETS[mapId]?.teams
    || (mapId === MAP_BACKROOMS
      ? BACKROOMS_TEAM_SPAWN_IDS
      : (room?.settings?.fullMap ? TEAM_FULL_MAP_SPAWN_IDS : TEAM_SPAWN_IDS));
  return ids[team === 1 ? 1 : 0] || [];
}

function isInTeamBuyZone(room, player) {
  if (!player?.position) return false;
  const spawnPoints = getSpawnPoints(room);
  let ids;
  if (MODE_CONFIG[room?.settings?.gamemode]?.teams) ids = getTeamSpawnIds(room, player.team);
  else ids = spawnPoints.map(p => p.id);
  return spawnPoints.some(point => ids.includes(point.id) && distanceBetweenVectors(point, player.position) <= CASUAL_BUY_ZONE_RADIUS);
}

function addMoney(player, amount) {
  if (!player || !Number.isFinite(Number(amount))) return;
  player.money = Math.max(0, Math.min(MONEY_CAP, Math.round((player.money || 0) + Number(amount))));
  player.dirty = true;
}

function addScore(player, amount) {
  if (!player || !Number.isFinite(Number(amount)) || !amount) return;
  player.matchScore = Math.round((player.matchScore || 0) + Number(amount));
  player.dirty = true;
}

function scaledUtilityDamageScore(damage, min = 10, max = 25) {
  const normalized = Math.max(0, Math.min(1, Number(damage || 0) / 100));
  return Math.round(min + (max - min) * normalized);
}

function addCumulativeUtilityScore(target, key, player, damage, min, max) {
  // Utility damage can tick repeatedly (molotov/flashed damage). Store cumulative
  // damage per target/source key and only award the delta toward the capped score
  // band, so one fire cannot farm +25 every tick.
  if (!target.utilityScoreAwards || typeof target.utilityScoreAwards !== 'object') target.utilityScoreAwards = {};
  const previous = target.utilityScoreAwards[key] || { damage: 0, score: 0 };
  const totalDamage = previous.damage + damage;
  const totalScore = scaledUtilityDamageScore(totalDamage, min, max);
  addScore(player, Math.max(0, totalScore - previous.score));
  target.utilityScoreAwards[key] = { damage: totalDamage, score: totalScore };
}

function utilityScoreBonus(weaponName) {
  if (weaponName === 'Molotov') return 35;
  if (weaponName === 'Frag') return 45;
  if (weaponName === 'Flash') return 30;
  return 0;
}

function recordDamageContribution(target, attacker, damage, weaponName, context, now) {
  if (!target || !attacker || attacker.id === target.id || damage <= 0) return;
  if (!target.damageContributors || typeof target.damageContributors !== 'object') target.damageContributors = {};
  const previous = target.damageContributors[attacker.id] || {
    attackerId: attacker.id,
    damage: 0,
    lastHitAt: 0,
    utilityWeapons: []
  };
  previous.damage += damage;
  previous.lastHitAt = now;
  previous.weaponName = weaponName;
  previous.headshot = previous.headshot || !!context.headshot;
  previous.wallbang = previous.wallbang || !!context.wallbang;
  previous.throughSmoke = previous.throughSmoke || !!context.throughSmoke;
  if (context.utility && !previous.utilityWeapons.includes(weaponName)) previous.utilityWeapons.push(weaponName);
  target.damageContributors[attacker.id] = previous;
}

function awardDamageScore(room, attacker, target, damage, weaponName, context) {
  if (!attacker || !target || damage <= 0) return;
  if (weaponName === 'Molotov' || weaponName === 'Frag') {
    addCumulativeUtilityScore(target, `damage:${attacker.id}:${weaponName}`, attacker, damage, 10, 25);
  }
  const now = Date.now();
  const flashOwnerId = target.flashedById;
  if ((target.flashedUntil || 0) > now && flashOwnerId) {
    const flashOwner = room.players.get(flashOwnerId);
    if (flashOwner) {
      addCumulativeUtilityScore(target, `flash:${flashOwnerId}:${target.flashedUntil}`, flashOwner, damage, 10, 20);
    }
  }
}

function resolveDamageAssists(room, killer, victim) {
  // Assist policy: top two non-killer contributors by damage, tie-broken by
  // recency; if second and third are still indistinguishable, include the third.
  const ledger = victim?.damageContributors && typeof victim.damageContributors === 'object'
    ? Object.values(victim.damageContributors)
    : [];
  const ranked = ledger
    .filter(entry => entry.attackerId !== killer.id && entry.damage > 0 && room.players.has(entry.attackerId))
    .sort((a, b) => (b.damage - a.damage) || (b.lastHitAt - a.lastHitAt) || String(a.attackerId).localeCompare(String(b.attackerId)));
  const selected = ranked.slice(0, 2);
  if (ranked.length > 2 && selected.length === 2) {
    const second = selected[1];
    const third = ranked[2];
    if (third.damage === second.damage && third.lastHitAt === second.lastHitAt) selected.push(third);
  }
  const awarded = [];
  for (const entry of selected) {
    const assister = room.players.get(entry.attackerId);
    if (!assister) continue;
    assister.assists = (assister.assists || 0) + 1;
    let score = 50;
    for (const utilityWeapon of entry.utilityWeapons || []) score += utilityScoreBonus(utilityWeapon);
    addScore(assister, score);
    const assisterClient = clients.get(assister.id);
    if (assisterClient && countsForLeaderboardStats(room)) assisterClient.statDelta.assists += 1;
    awarded.push({
      id: assister.id,
      name: assister.name,
      assists: assister.assists,
      score: assister.matchScore || 0
    });
  }
  victim.damageContributors = {};
  return awarded;
}

function killMoneyReward(weaponName, weaponDef, context = {}) {
  if (context.utility || weaponName === 'Frag' || weaponName === 'Molotov') return 300;
  if (weaponDef?.type === 'melee' || weaponName === 'Knife') return 1500;
  if (weaponDef?.type === 'smg') return 600;
  if (weaponDef?.type === 'shotgun') return 900;
  return 300;
}

function applyKillScore(room, killer, victim, weaponName, context) {
  // Required scoring model lives here. MVP sorting is score-first, so modifiers
  // are intentionally part of matchScore rather than only cosmetic feed badges.
  let score = 100;
  if (context.headshot) score += 25;
  if (context.wallbang) score += 35;
  if (context.throughSmoke) score += 40;
  if (context.victimFlashed) score += 30;
  if (context.bountyKill) score += BOUNTY_KILL_SCORE_BONUS;
  if (context.bountyClaimed) score += BOUNTY_CLAIM_SCORE_BONUS;
  score += utilityScoreBonus(weaponName);
  addScore(killer, score);
}

function isDroppableWeapon(weaponName) {
  const def = WEAPONS[weaponName];
  return !!def && !['melee', 'utility'].includes(def.type);
}

function publicDroppedItems(room) {
  if (!room?.droppedItems) return [];
  return Array.from(room.droppedItems.values()).map(item => ({
    id: item.id,
    type: item.type,
    weapon: item.weapon,
    position: item.position,
    ammo: item.ammo || null
  }));
}

function broadcastDroppedItems(roomCode, room) {
  if (!roomCode || !room) return;
  broadcastToRoom(roomCode, null, 'droppedItems', publicDroppedItems(room));
}

function clearDroppedItems(room) {
  if (!room) return;
  if (!room.droppedItems) room.droppedItems = new Map();
  room.droppedItems.clear();
}

function droppedPositionForPlayer(player, data = {}) {
  const base = sanitizeVector(data.position, player.position) || player.position || { x: 0, y: 0, z: 0 };
  const yaw = Number(player.rotation?.y || 0);
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  return {
    x: base.x + fx * 28,
    y: base.y - 14,
    z: base.z + fz * 28
  };
}

function createDroppedWeapon(room, player, weaponName, data = {}) {
  if (!room || !isDroppableWeapon(weaponName)) return null;
  if (!room.droppedItems) room.droppedItems = new Map();
  room.dropSeq = (room.dropSeq || 0) + 1;
  const id = `drop_${room.dropSeq}_${crypto.randomBytes(3).toString('hex')}`;
  const item = {
    id,
    type: 'weapon',
    weapon: weaponName,
    ownerId: player?.id || null,
    position: droppedPositionForPlayer(player || {}, data),
    ammo: data.ammo && typeof data.ammo === 'object' ? {
      mag: clampNumber(data.ammo.mag, 0, 999),
      reserve: clampNumber(data.ammo.reserve, 0, 999)
    } : null,
    createdAt: Date.now()
  };
  room.droppedItems.set(id, item);
  return item;
}

function dropCasualDeathWeapon(room, player) {
  if (!isCasualLive(room) || !player || !isDroppableWeapon(player.weapon)) return null;
  const item = createDroppedWeapon(room, player, player.weapon);
  if (item) player.weapon = 'Knife';
  return item;
}

function handleDropItem(client, room, player, data) {
  if (!isCasualLive(room) || !player || player.waitingForNextRound || (player.health || 0) <= 0 || player.bombAction) return;
  player.activeAt = Date.now();
  if (data.kind === 'bomb') {
    const hadBomb = !!player.hasBomb;
    dropBombIfCarrier(room, player);
    if (hadBomb) {
      broadcastCasualState(client.roomCode, room);
      send(client, 'itemDropped', { kind: 'bomb' });
    }
    return;
  }
  const weapon = sanitizeWeaponName(data.weapon) || player.weapon;
  if (!isDroppableWeapon(weapon) || weapon !== player.weapon) {
    send(client, 'dropDenied', { message: 'That item cannot be dropped.' });
    return;
  }
  const item = createDroppedWeapon(room, player, weapon, data);
  if (!item) return;
  player.weapon = 'Knife';
  player.dirty = true;
  send(client, 'itemDropped', { item, replacement: 'Knife' });
  broadcastDroppedItems(client.roomCode, room);
}

function tryPickupDroppedItem(roomCode, room, player) {
  if (!isCasualLive(room) || player.waitingForNextRound || (player.health || 0) <= 0 || !room?.droppedItems?.size) return;
  for (const item of room.droppedItems.values()) {
    if (item.type !== 'weapon' || !isDroppableWeapon(item.weapon)) continue;
    if (distanceBetweenVectors(player.position, item.position) > DROPPED_ITEM_PICKUP_RADIUS) continue;
    room.droppedItems.delete(item.id);
    player.weapon = item.weapon;
    player.dirty = true;
    const client = clients.get(player.id);
    if (client) send(client, 'weaponPickedUp', { item });
    broadcastDroppedItems(roomCode, room);
    return;
  }
}

function ensureCasualState(room) {
  if (!room.casual) {
    room.casual = {
      phase: 'warmup',
      warmupEndsAt: null,
      roundNumber: 0,
      halfSwitched: false,
      score: [0, 0],
      roundWinner: null,
      roundReason: null,
      nextRoundStartsAt: null,
      bomb: newCasualBombState()
    };
  }
  return room.casual;
}

function newCasualBombState() {
  return {
    carrierId: null,
    droppedPosition: null,
    planted: false,
    position: null,
    site: null,
    planterId: null,
    plantedAt: null,
    explodesAt: null,
    action: null
  };
}

function publicBombState(bomb) {
  if (!bomb) return null;
  return {
    carrierId: bomb.carrierId || null,
    droppedPosition: bomb.droppedPosition || null,
    planted: !!bomb.planted,
    position: bomb.position || null,
    site: bomb.site || null,
    planterId: bomb.planterId || null,
    plantedAt: bomb.plantedAt || null,
    explodesAt: bomb.explodesAt || null,
    action: bomb.action ? {
      playerId: bomb.action.playerId,
      type: bomb.action.type,
      site: bomb.action.site || null,
      startedAt: bomb.action.startedAt,
      completesAt: bomb.action.completesAt
    } : null
  };
}

function publicCasualState(room) {
  if (!MODE_CONFIG[room?.settings?.gamemode]?.casual) return null;
  const st = ensureCasualState(room);
  return {
    phase: st.phase,
    warmupEndsAt: st.warmupEndsAt,
    roundNumber: st.roundNumber,
    halfSwitched: !!st.halfSwitched,
    score: st.score.slice(0, 2),
    roundWinner: st.roundWinner,
    roundReason: st.roundReason,
    nextRoundStartsAt: st.nextRoundStartsAt,
    roundStartedAt: room.roundStartedAt || null,
    buyEndsAt: room.roundStartedAt ? room.roundStartedAt + CASUAL_BUY_TIME_MS : null,
    buyPhaseEndsAt: st.phase === 'intro' ? room.roundStartedAt : null,
    buyZoneRadius: CASUAL_BUY_ZONE_RADIUS,
    minTeamPlayers: CASUAL_MIN_TEAM_PLAYERS,
    counts: casualTeamCounts(room),
    bomb: publicBombState(st.bomb),
    bombSites: publicBombSites(),
    buyZones: publicBuyZones(room)
  };
}

function publicBombSites() {
  return CASUAL_BOMB_SITES.map(site => ({ ...site }));
}

// Buy zones are circular areas centred on each team's spawn points (the same
// geometry isInTeamBuyZone() enforces). Sent to clients purely for display.
function publicBuyZones(room) {
  const zones = [];
  const spawnPoints = getSpawnPoints(room);
  for (const team of [0, 1]) {
    const ids = getTeamSpawnIds(room, team);
    for (const pt of spawnPoints) {
      if (ids.includes(pt.id)) zones.push({ x: pt.x, z: pt.z, radius: CASUAL_BUY_ZONE_RADIUS, team });
    }
  }
  return zones;
}

function casualTeamCounts(room) {
  return { ct: countTeam(room, 0), t: countTeam(room, 1) };
}

function casualHasEnoughPlayers(room) {
  const c = casualTeamCounts(room);
  return c.ct >= CASUAL_MIN_TEAM_PLAYERS && c.t >= CASUAL_MIN_TEAM_PLAYERS;
}

function isCasualWarmup(room) {
  return MODE_CONFIG[room?.settings?.gamemode]?.casual && ['warmup', 'countdown'].includes(ensureCasualState(room).phase);
}

function isCasualLive(room) {
  return MODE_CONFIG[room?.settings?.gamemode]?.casual && ensureCasualState(room).phase === 'live';
}

function resetCasualMatch(room) {
  const st = ensureCasualState(room);
  st.phase = 'warmup';
  st.warmupEndsAt = null;
  st.roundNumber = 0;
  st.halfSwitched = false;
  st.score = [0, 0];
  st.roundWinner = null;
  st.roundReason = null;
  st.nextRoundStartsAt = null;
  st.bomb = newCasualBombState();
  for (const p of room.players.values()) {
    p.kills = 0;
    p.killStreak = 0;
    p.bountyActive = false;
    p.assists = 0;
    p.deaths = 0;
    p.matchScore = 0;
    p.objectiveScore = 0;
    p.roundDamageDealt = 0;
    p.damageContributors = {};
    p.utilityScoreAwards = {};
    p.weaponKills = {};
    p.weaponDamage = {};
    p.lastKillWeapon = null;
    p.mvps = 0;
    const connected = clients.get(p.id);
    if (connected) connected.killStreak = 0;
    p.money = CASUAL_START_MONEY;
    p.hasBomb = false;
    p.waitingForNextRound = false;
    setPlayerLifecycle(p, 'alive');
    resetUtilityLife(p);
    resetBuySession(p, p.position);
    p.dirty = true;
  }
}

function updateCasualWarmup(roomCode, room, now = Date.now()) {
  if (!MODE_CONFIG[room?.settings?.gamemode]?.casual) return;
  const st = ensureCasualState(room);
  if (!['warmup', 'countdown'].includes(st.phase)) return;
  const enough = casualHasEnoughPlayers(room);
  if (!enough) {
    const changed = st.phase !== 'warmup' || st.warmupEndsAt || room.settings.roundEndsAt;
    st.phase = 'warmup';
    st.warmupEndsAt = null;
    st.roundWinner = null;
    st.roundReason = null;
    room.settings.roundEndsAt = null;
    clearRoomRoundTimer(room);
    if (changed) broadcastCasualState(roomCode, room);
    return;
  }
  if (st.phase === 'warmup') {
    st.phase = 'countdown';
    st.warmupEndsAt = now + CASUAL_WARMUP_COUNTDOWN_MS;
    room.settings.roundEndsAt = st.warmupEndsAt;
    scheduleTimedRoundEnd(roomCode);
    broadcastCasualState(roomCode, room);
  }
}

function finishCasualTimedEvent(roomCode, room) {
  const st = ensureCasualState(room);
  if (st.phase === 'countdown') {
    startCasualMatch(roomCode);
    return;
  }
  if (st.phase !== 'live') return;
  if (st.bomb?.planted) {
    const planter = room.players.get(st.bomb.planterId);
    if (planter) {
      addScore(planter, 75);
      planter.objectiveScore = (planter.objectiveScore || 0) + 75;
    }
    finishCasualRound(roomCode, room, 1, 'bomb_exploded');
  } else {
    finishCasualRound(roomCode, room, 0, 'time');
  }
}

function startCasualMatch(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !MODE_CONFIG[room.settings.gamemode]?.casual) return;
  ensureCasualState(room);
  if (!casualHasEnoughPlayers(room)) {
    updateCasualWarmup(roomCode, room);
    return;
  }
  resetCasualMatch(room);
  startCasualRound(roomCode);
}

function switchCasualSides(room) {
  for (const p of room.players.values()) {
    p.team = p.team === 1 ? 0 : 1;
    p.money = CASUAL_START_MONEY;
    p.dirty = true;
  }
}

function startCasualRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !MODE_CONFIG[room.settings.gamemode]?.casual) return;
  const st = ensureCasualState(room);
  clearRoomRoundTimer(room);
  const introRound = st.roundNumber === 0 || (st.roundNumber === CASUAL_HALFTIME_ROUNDS && !st.halfSwitched);
  if (st.roundNumber >= CASUAL_HALFTIME_ROUNDS && !st.halfSwitched) {
    switchCasualSides(room);
    st.halfSwitched = true;
  }
  rebalanceTeams(room);
  const now = Date.now();
  const liveAt = introRound ? now + CASUAL_INTRO_MS : now;
  st.phase = introRound ? 'intro' : 'live';
  st.roundNumber += 1;
  st.roundWinner = null;
  st.roundReason = null;
  st.nextRoundStartsAt = null;
  st.bomb = newCasualBombState();
  room.roundTransitionUntil = introRound ? liveAt : 0;
  room.roundStartedAt = liveAt;
  room.settings.fullMap = true;
  room.settings.roundEndsAt = liveAt + CASUAL_ROUND_MS;
  room.activeFires = [];
  room.activeSmokes = [];
  room.recentBursts = [];
  clearRoomBarricades(room);
  clearRoomC4Charges(room);
  room.progressionSuppressedRound = false;
  room.progressionSuppressedReason = '';
  clearDroppedItems(room);
  for (const p of room.players.values()) {
    p.roundDamageDealt = 0;
    p.weaponKills = {};
    p.weaponDamage = {};
    p.lastKillWeapon = null;
    p.hasBomb = false;
    p.bombAction = null;
    resetUtilityLife(p);
    p.dirty = true;
  }
  const spawns = batchRespawn(room);
  assignCasualBomb(room);
  if (introRound) {
    room.roundTimer = setTimeout(() => {
      const r = rooms.get(roomCode);
      if (!r || !MODE_CONFIG[r.settings.gamemode]?.casual) return;
      ensureCasualState(r).phase = 'live';
      r.roundTransitionUntil = 0;
      scheduleTimedRoundEnd(roomCode);
      broadcastCasualState(roomCode, r);
    }, CASUAL_INTRO_MS);
  } else {
    scheduleTimedRoundEnd(roomCode);
  }
  const players = Array.from(room.players.values());
  broadcastToRoom(roomCode, null, 'casualRoundStart', {
    players,
    settings: room.settings,
    brokenGlassPanes: Array.from(room.brokenGlassPanes || []),
    brokenVentIds: Array.from(room.brokenVentIds || []),
    openDoorIds: Array.from(room.openDoors || []),
    spawns,
    casual: publicCasualState(room),
    droppedItems: publicDroppedItems(room)
  });
  broadcastDroppedItems(roomCode, room);
  broadcastRoomState(roomCode);
}

function finishCasualRound(roomCode, room, winnerTeam, reason) {
  const st = ensureCasualState(room);
  if (st.phase !== 'live') return;
  const countsStats = countsForLeaderboardStats(room);
  clearRoomRoundTimer(room);
  cancelBombAction(room);
  st.phase = 'roundEnd';
  st.roundWinner = winnerTeam;
  st.roundReason = reason;
  if (winnerTeam === 0 || winnerTeam === 1) st.score[winnerTeam] = (st.score[winnerTeam] || 0) + 1;
  awardCasualEconomy(room, winnerTeam, reason);

  let mvp = selectRoundMvp(Array.from(room.players.values()));
  if (mvp?.id) {
    const p = room.players.get(mvp.id);
    addScore(p, 50);
    mvp = selectRoundMvp(Array.from(room.players.values())) || mvp;
    const mp = room.players.get(mvp.id);
    if (mp) {
      mp.mvps = (mp.mvps || 0) + 1;
      mp.dirty = true;
    }
    const mc = clients.get(mvp.id);
    if (mc && countsStats) mc.statDelta.mvps += 1;
  }

  const matchOver = winnerTeam === 0 || winnerTeam === 1 ? st.score[winnerTeam] >= CASUAL_FIRST_TO : false;
  const transitionEnd = Date.now() + ROUND_TRANSITION_MS;
  room.roundTransitionUntil = transitionEnd;
  scheduleRoomBreakableGlassReset(roomCode, room, transitionEnd);
  for (const p of room.players.values()) setPlayerLifecycle(p, 'round-ended');
  room.activeFires = [];
  room.activeSmokes = [];
  room.recentBursts = [];
  clearRoomBarricades(room);
  clearRoomC4Charges(room);
  room.progressionSuppressedRound = false;
  room.progressionSuppressedReason = '';
  st.nextRoundStartsAt = transitionEnd;
  if (matchOver) {
    st.phase = 'matchEnd';
    for (const p of room.players.values()) {
      if (p.team === winnerTeam) {
        const c = clients.get(p.id);
        if (c && countsStats) {
          c.statDelta.wins += 1;
          c.statDelta.deathmatchWins += 1;
          recordDailyStat(c, p, { wins: 1 });
        }
      }
    }
    room.roundTimer = setTimeout(() => {
      const r = rooms.get(roomCode);
      if (!r) return;
      resetCasualMatch(r);
      updateCasualWarmup(roomCode, r);
      broadcastRoomState(roomCode);
    }, ROUND_TRANSITION_MS);
  } else {
    room.roundTimer = setTimeout(() => startCasualRound(roomCode), ROUND_TRANSITION_MS);
  }

  broadcastToRoom(roomCode, null, 'tdmReset', {
    mode: 'casual',
    winnerTeam,
    teamScores: st.score.slice(0, 2),
    players: Array.from(room.players.values()),
    settings: room.settings,
    spawns: {},
    mvp,
    casual: publicCasualState(room)
  });
}

function awardCasualEconomy(room, winnerTeam, reason) {
  for (const p of room.players.values()) {
    if (p.team === winnerTeam) addMoney(p, CASUAL_WIN_REWARD);
    else addMoney(p, CASUAL_LOSS_REWARD + (reason === 'defused' && p.team === 1 ? 800 : 0));
  }
}

function assignCasualBomb(room) {
  const st = ensureCasualState(room);
  st.bomb = newCasualBombState();
  for (const p of room.players.values()) p.hasBomb = false;
  const terrorists = Array.from(room.players.values()).filter(p => p.team === 1 && !p.waitingForNextRound);
  if (!terrorists.length) return;
  terrorists.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const carrier = terrorists[st.roundNumber % terrorists.length];
  carrier.hasBomb = true;
  carrier.dirty = true;
  st.bomb.carrierId = carrier.id;
}

function dropBombIfCarrier(room, player) {
  const st = room?.casual;
  if (!st?.bomb || st.bomb.carrierId !== player.id) return;
  st.bomb.carrierId = null;
  st.bomb.droppedPosition = { x: player.position.x, y: player.position.y, z: player.position.z };
  player.hasBomb = false;
  player.dirty = true;
}

function tryPickupDroppedBomb(roomCode, room, player) {
  if (!isCasualLive(room) || player.team !== 1 || player.waitingForNextRound || (player.health || 0) <= 0) return;
  const bomb = room.casual.bomb;
  if (!bomb || bomb.planted || bomb.carrierId || !bomb.droppedPosition) return;
  if (distanceBetweenVectors(player.position, bomb.droppedPosition) > CASUAL_INTERACT_RADIUS) return;
  bomb.carrierId = player.id;
  bomb.droppedPosition = null;
  player.hasBomb = true;
  player.dirty = true;
  broadcastCasualState(roomCode, room);
}

function bombSiteForPosition(position) {
  if (!position) return null;
  return CASUAL_BOMB_SITES.find(site => pointInsideBombSite(position, site)) || null;
}

function pointInsideBombSite(position, site) {
  if (!position || !site) return false;
  const x = Number(position.x || 0);
  const z = Number(position.z || 0);
  if (Number.isFinite(site.xMin) && Number.isFinite(site.xMax) && Number.isFinite(site.zMin) && Number.isFinite(site.zMax)) {
    return x >= site.xMin && x <= site.xMax && z >= site.zMin && z <= site.zMax;
  }
  return Math.hypot(x - site.x, z - site.z) <= site.radius;
}

function handleBombAction(client, room, player, data) {
  if (!isCasualLive(room) || player.waitingForNextRound || (player.health || 0) <= 0) return;
  if (data.action === 'stop') {
    cancelBombAction(room, player.id);
    return;
  }
  const st = ensureCasualState(room);
  const bomb = st.bomb;
  if (bomb.action) return;
  if (player.team === 1 && bomb.carrierId === player.id && !bomb.planted) {
    const site = bombSiteForPosition(player.position);
    if (!site) {
      send(client, 'bombActionState', { active: false, denied: true, message: 'Move to a bomb site to plant.' });
      return;
    }
    beginBombAction(client.roomCode, room, player, 'plant', site);
    return;
  }
  if (player.team === 0 && bomb.planted && bomb.position && distanceBetweenVectors(player.position, bomb.position) <= CASUAL_INTERACT_RADIUS) {
    beginBombAction(client.roomCode, room, player, 'defuse', { id: bomb.site || 'bomb' });
  }
}

function beginBombAction(roomCode, room, player, type, site) {
  const now = Date.now();
  const duration = type === 'plant' ? CASUAL_PLANT_MS : CASUAL_DEFUSE_MS;
  const token = crypto.randomBytes(8).toString('hex');
  const action = {
    token,
    playerId: player.id,
    type,
    site: site?.id || null,
    startedAt: now,
    completesAt: now + duration,
    timer: null
  };
  room.casual.bomb.action = action;
  player.bombAction = { type, completesAt: action.completesAt };
  const client = clients.get(player.id);
  if (client) send(client, 'bombActionState', { active: true, type, site: action.site, completesAt: action.completesAt });
  broadcastCasualState(roomCode, room);
  action.timer = setTimeout(() => completeBombAction(room, action.token), duration);
}

function cancelBombAction(room, playerId = null) {
  const action = room?.casual?.bomb?.action;
  if (!action) return;
  if (playerId && action.playerId !== playerId) return;
  if (action.timer) clearTimeout(action.timer);
  const p = room.players.get(action.playerId);
  if (p) p.bombAction = null;
  room.casual.bomb.action = null;
  const client = clients.get(action.playerId);
  if (client) send(client, 'bombActionState', { active: false, cancelled: true });
  if (client?.roomCode) broadcastCasualState(client.roomCode, room);
}

function completeBombAction(room, token) {
  const action = room?.casual?.bomb?.action;
  if (!action || action.token !== token) return;
  const player = room.players.get(action.playerId);
  if (!player || player.waitingForNextRound || (player.health || 0) <= 0) {
    cancelBombAction(room);
    return;
  }
  const roomCode = clients.get(player.id)?.roomCode;
  const bomb = room.casual.bomb;
  if (action.type === 'plant') {
    const site = bombSiteForPosition(player.position);
    if (!site || bomb.carrierId !== player.id || bomb.planted) {
      cancelBombAction(room);
      return;
    }
    cancelBombAction(room);
    bomb.carrierId = null;
    bomb.droppedPosition = null;
    bomb.planted = true;
    bomb.position = { x: player.position.x, y: player.position.y, z: player.position.z };
    bomb.site = site.id;
    bomb.planterId = player.id;
    bomb.plantedAt = Date.now();
    bomb.explodesAt = bomb.plantedAt + CASUAL_BOMB_TIMER_MS;
    player.hasBomb = false;
    player.objectiveScore = (player.objectiveScore || 0) + 75;
    addScore(player, 75);
    addMoney(player, CASUAL_PLANT_REWARD);
    room.settings.roundEndsAt = bomb.explodesAt;
    if (roomCode) scheduleTimedRoundEnd(roomCode);
    if (roomCode) broadcastCasualState(roomCode, room);
    return;
  }
  if (action.type === 'defuse') {
    if (!bomb.planted || !bomb.position || distanceBetweenVectors(player.position, bomb.position) > CASUAL_INTERACT_RADIUS) {
      cancelBombAction(room);
      return;
    }
    cancelBombAction(room);
    player.objectiveScore = (player.objectiveScore || 0) + 100;
    addScore(player, 100);
    if (roomCode) finishCasualRound(roomCode, room, 0, 'defused');
  }
}

function checkCasualElimination(roomCode, room) {
  if (!isCasualLive(room)) return;
  let aliveCT = 0;
  let aliveT = 0;
  for (const p of room.players.values()) {
    if (p.waitingForNextRound || (p.health || 0) <= 0) continue;
    if (p.team === 1) aliveT += 1;
    else aliveCT += 1;
  }
  const planted = !!room.casual?.bomb?.planted;
  if (aliveCT <= 0) finishCasualRound(roomCode, room, 1, planted ? 'bomb_secured' : 'elimination');
  else if (!planted && aliveT <= 0) finishCasualRound(roomCode, room, 0, 'elimination');
}

function broadcastCasualState(roomCode, room) {
  if (!roomCode || !room || !MODE_CONFIG[room.settings.gamemode]?.casual) return;
  broadcastToRoom(roomCode, null, 'casualState', publicCasualState(room));
}

function sanitizeGrenadeKind(value) {
  return value === 'smoke' || value === 'flash' || value === 'molotov' ? value : 'frag';

}
// Buy-menu utility kinds. Wider than sanitizeGrenadeKind because the barricade
// is bought like a grenade but never thrown, so the throw/burst paths must keep
// rejecting it. Returns '' for anything unknown.
function sanitizeUtilityKind(value) {
  const kind = String(value || '');
  return UTILITY_PRICES[kind] !== undefined ? kind : '';
}
function sanitizeWeaponName(value) {
  const name = String(value || '').slice(0, 32);
  return WEAPONS[name] ? name : '';
}
function sweepReservations(room, now) {
  if (!room.spawnReservations) return;
  for (const [id, expiresAt] of room.spawnReservations) if (expiresAt <= now) room.spawnReservations.delete(id);
}
function isReserved(room, id, now) {
  const expiresAt = room.spawnReservations.get(id);
  return expiresAt !== undefined && expiresAt > now;
}
function reserveSpawn(room, id, now) {
  room.spawnReservations.set(id, now + SPAWN_RESERVE_TTL_MS);
}
function zoneOf(position) {
  if (!position) return -1;
  for (const z of MAP_ZONES) {
    if (position.x >= z.xMin && position.x <= z.xMax && position.z >= z.zMin && position.z <= z.zMax) return z.id;
  }
  return -1;
}
function scoreSpawnPoint(room, point, player, now, batchChosen) {
  let nearestEnemy = Infinity;
  for (const p of room.players.values()) {
    if (p.id === player.id) continue;
    if ((p.health || 0) <= 0) continue;
    if ((p.invulnerableUntil || 0) > now) continue;
    nearestEnemy = Math.min(nearestEnemy, distanceBetweenVectors(point, p.position));
  }
  let score = nearestEnemy === Infinity ? SPAWN_NO_ENEMY_DISTANCE : nearestEnemy;
  if (point.id === player.lastSpawnId) score -= SPAWN_REPEAT_PENALTY;
  if (player.lastDeathPos) {
    const d = distanceBetweenVectors(point, player.lastDeathPos);
    if (d < SPAWN_DEATHPOS_RADIUS) score -= SPAWN_DEATHPOS_PENALTY * (1 - d / SPAWN_DEATHPOS_RADIUS);
  }
  for (const p of room.players.values()) {
    if (p.id === player.id) continue;
    if ((p.health || 0) <= 0) continue;
    if ((p.invulnerableUntil || 0) > now) continue;
    if (Array.isArray(point.visZones) && point.visZones.length && !point.visZones.includes(zoneOf(p.position))) continue;
    const dx = point.x - p.position.x, dz = point.z - p.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > SPAWN_LOS_DISTANCE || dist < 0.001) continue;
    const yaw = (p.rotation && p.rotation.y) || 0;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if ((fx * dx + fz * dz) / dist > SPAWN_LOS_DOT) { score -= SPAWN_LOS_PENALTY; break; }
  }
  if (batchChosen.length) {
    let minBatch = Infinity;
    for (const c of batchChosen) minBatch = Math.min(minBatch, distanceBetweenVectors(point, c));
    if (minBatch !== Infinity) score += SPAWN_SPREAD_WEIGHT * minBatch;
  }
  return { score, nearestEnemy: nearestEnemy === Infinity ? SPAWN_NO_ENEMY_DISTANCE : nearestEnemy };
}
const SPAWN_EYE_OFFSET = 18; // matches the browser's standing camera/collider eye height
// Snap a spawn point's Y onto the real collision floor. Returns null when there is
// no floor under (x,z) — i.e. the point would drop the player off/under the map.
// Fail-open (returns the authored y) when there's no collision mesh (e.g. backrooms,
// whose mesh isn't the loaded one).
function spawnGroundEyeY(room, pt) {
  const mapCollision = getMapCollision(room);
  if (!mapCollision) return pt.y;
  const g = groundYForRoom(room, pt.x, pt.z, pt.y + SPAWN_GROUND_PROBE_UP);
  if (g == null) return null;
  const eyeY = g + SPAWN_EYE_OFFSET;
  // A few full-map T spawn points sit on stacked Dust2 geometry. The generic
  // ground ray can hit the wrong vertical layer there, so keep the authored
  // spawn height when the snap would move it a long way up/down.
  if (getRoomMapId(room) === MAP_DUST2 && pt.id >= 8 && Math.abs(eyeY - pt.y) > DUST2_SPAWN_SNAP_TOLERANCE) return pt.y;
  return eyeY;
}
function pickSpawn(room, player, { batchChosen = [] } = {}) {
  if (isContainment(room)) {
    const authored = containmentLayout(room)?.start;
    if (authored) {
      // Everyone begins in the same authored staging room. A compact 4x4
      // formation covers the normal 16-player room cap without overlapping
      // cameras or turning the fixed start back into random PvP spawning.
      const formation = [-7.5, -2.5, 2.5, 7.5]
        .flatMap(localZ => [-7.5, -2.5, 2.5, 7.5].map(localX => [localX, localZ]));
      const playerIndex = Math.max(0, Array.from(room.players.keys()).indexOf(player.id));
      const slot = batchChosen.length || playerIndex;
      const [localX, localZ] = formation[slot % formation.length];
      const yaw = Number(authored.yaw) || 0;
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      const x = Number(authored.x) + localX * cos - localZ * sin;
      const z = Number(authored.z) + localX * sin + localZ * cos;
      const hint = Number(authored.yHint) || 0;
      const ground = groundYForRoom(room, x, z, hint + SPAWN_GROUND_PROBE_UP);
      const y = Number.isFinite(ground) ? ground + SPAWN_EYE_OFFSET : hint + SPAWN_EYE_OFFSET;
      player.lastSpawnId = `containment:${authored.id || 'staging'}`;
      return { x, y, z, yaw, id: player.lastSpawnId };
    }
  }
  const now = Date.now();
  sweepReservations(room, now);
  const spawnPoints = getSpawnPoints(room);
  const fullMap = !!(room.settings && room.settings.fullMap);
  const grounded = (pt) => spawnGroundEyeY(room, pt) != null;
  // Prefer the mode's point set, but only points that actually sit over solid ground
  // (so a mis-placed full-map point can never spawn the player under the map).
  let eligible = spawnPoints.filter((pt) => (fullMap ? !pt.halfOnly : pt.halfMap) && grounded(pt));
  if (!eligible.length) eligible = spawnPoints.filter(grounded);   // any valid-ground point
  if (!eligible.length) eligible = spawnPoints;                    // last resort (no collision data)
  if (MODE_CONFIG[room.settings.gamemode]?.teams) {
    const teamIds = getTeamSpawnIds(room, player.team);
    const teamEligible = eligible.filter((pt) => teamIds.includes(pt.id));
    if (teamEligible.length) eligible = teamEligible;
  }
  const free = eligible.filter((pt) => !isReserved(room, pt.id, now) && !batchChosen.some((c) => c.id === pt.id));
  const pool = free.length ? free : eligible;
  let best = null, bestScore = -Infinity, bestNear = -Infinity, tiedBest = 0;
  for (const pt of pool) {
    const { score, nearestEnemy } = scoreSpawnPoint(room, pt, player, now, batchChosen);
    const betterScore = score > bestScore + SPAWN_SCORE_EPSILON;
    const tiedScore = Math.abs(score - bestScore) <= SPAWN_SCORE_EPSILON;
    const betterNear = tiedScore && nearestEnemy > bestNear + SPAWN_SCORE_EPSILON;
    const tiedNear = tiedScore && Math.abs(nearestEnemy - bestNear) <= SPAWN_SCORE_EPSILON;
    if (betterScore || betterNear) {
      best = pt; bestScore = score; bestNear = nearestEnemy; tiedBest = 1;
    } else if (tiedNear) {
      tiedBest += 1;
      if (Math.random() < 1 / tiedBest) best = pt;
    }
  }
  if (!best) best = pool[0] || spawnPoints[0];
  reserveSpawn(room, best.id, now);
  player.lastSpawnId = best.id;
  const eyeY = spawnGroundEyeY(room, best);
  const yaw = Number.isFinite(Number(best.yaw)) ? Number(best.yaw) : SPAWN_YAW;
  return { x: best.x, y: eyeY != null ? eyeY : best.y, z: best.z, yaw, id: best.id };
}
// Batch-respawn everyone (round reset). Returns an id->spawn map for the client.
function batchRespawn(room) {
  if (!room) return {};
  room.spawnReservations.clear();
  room.spawnSeq = (room.spawnSeq || 0) + 1;
  const seq = room.spawnSeq;
  const batchChosen = [];
  const spawns = {};
  const protectionStart = Math.max(Date.now(), room.roundTransitionUntil || 0);
  for (const p of Array.from(room.players.values())) {
    if (p.respawnTimer) {
      clearTimeout(p.respawnTimer);
      p.respawnTimer = null;
    }
    p.respawningUntil = 0;
    p.waitingForNextRound = false;
    clearCosmeticActionState(p);
    setPlayerLifecycle(p, 'spawning');
    const s = pickSpawn(room, p, { batchChosen });
    batchChosen.push({ id: s.id, x: s.x, y: s.y, z: s.z });
    p.position = { x: s.x, y: s.y, z: s.z };
    p.spawnSeq = seq;
    p.health = 100;
    p.killStreak = 0;
    p.bountyActive = false;
    const connected = clients.get(p.id);
    if (connected) connected.killStreak = 0;
    p.damageContributors = {};
    p.utilityScoreAwards = {};
    resetUtilityLife(p);
    resetBuySession(p, { x: s.x, y: s.y, z: s.z });
    applySpawnProtection(p, protectionStart + RESPAWN_PROTECTION_MS, { x: s.x, y: s.y, z: s.z }, protectionStart);
    p.ac.lastValidPos = { x: s.x, y: s.y, z: s.z };
    p.ac.airborneSince = 0;
    p.ac.graceUntil = Date.now() + AC.RESPAWN_GRACE_MS;
    setPlayerLifecycle(p, 'alive');
    p.dirty = true;
    spawns[p.id] = { x: s.x, y: s.y, z: s.z, yaw: s.yaw, seq };
  }
  return spawns;
}

function respawnPlayer(roomCode, player, data = {}) {
  const room = rooms.get(roomCode);
  if (player.respawningUntil) return;
  player.damageContributors = {};
  player.utilityScoreAwards = {};
  player.flashedById = null;
  player.flashedUntil = 0;
  player.lastDeathPos = { x: player.position.x, y: player.position.y, z: player.position.z };
  const countDeath = !data.skipStats;
  const countLeaderboardDeath = countDeath && countsForLeaderboardStats(room);
  if (countDeath) player.deaths += 1;
  player.activeAt = Date.now();
  player.health = 0;
  player.killStreak = 0;
  player.bountyActive = false;

  clearCosmeticActionState(player);
  removeC4ChargesOwnedBy(roomCode, room, player.id, 'owner-died');
  player.stimCharges = 0;
  resetHealthshotLife(player);
  player.invulnerableUntil = Date.now() + DEATH_SPECTATE_MS + RESPAWN_PROTECTION_MS;
  setPlayerLifecycle(player, 'dead');

  const vc = clients.get(player.id);
  if (vc && countLeaderboardDeath) {
    vc.statDelta.deaths += 1;
    recordDailyStat(vc, player, { deaths: 1 });
    vc.killStreak = 0;
    vc.stimCharges = 0;
    sendHealthshotState(vc, player, { healing: false });
  }
  if (countDeath) addScore(player, -25);

  const immediate = data.reason === 'void';
  const holdForNextRound = room && isCasualLive(room) && !immediate;
  if (holdForNextRound) {
    dropCasualDeathWeapon(room, player);
    dropBombIfCarrier(room, player);
    cancelBombAction(room, player.id);
    player.waitingForNextRound = true;
    setPlayerLifecycle(player, 'waiting');
    player.invulnerableUntil = 0;
    player.spawnProtectionStartedAt = 0;
    player.spawnProtectionOrigin = null;
    player.respawningUntil = 0;
    player.respawnTimer = null;
    player.dirty = true;
    broadcastToRoom(roomCode, null, 'playerRespawn', {
      id: player.id,
      health: player.health,
      deaths: player.deaths,
      spawn: null,
      respawnAt: null,
      waitingForNextRound: true,
      lifecycle: player.lifecycle,
      ...data
    });
    broadcastCasualState(roomCode, room);
    broadcastDroppedItems(roomCode, room);
    return;
  }

  const spawn = room ? pickSpawn(room, player) : null;
  if (room && spawn) {
    room.spawnSeq = (room.spawnSeq || 0) + 1;
    spawn.seq = room.spawnSeq;
  }

  broadcastToRoom(roomCode, null, 'playerRespawn', {
    id: player.id,
    health: player.health,
    deaths: player.deaths,
    spawn,
    respawnAt: immediate ? Date.now() : Date.now() + DEATH_SPECTATE_MS,
    lifecycle: immediate ? 'spawning' : 'spectating',
    ...data
  });

  const finish = () => finishRespawn(roomCode, player, spawn);
  if (immediate) finish();
  else {
    player.respawningUntil = Date.now() + DEATH_SPECTATE_MS;
    setPlayerLifecycle(player, 'spectating');
    player.respawnTimer = setTimeout(finish, DEATH_SPECTATE_MS);
  }
}

function finishRespawn(roomCode, player, spawn) {
  const room = rooms.get(roomCode);
  if (!room || !room.players.has(player.id)) return;
  player.respawningUntil = 0;
  player.respawnTimer = null;
  player.waitingForNextRound = false;
  player.health = 100;
  clearCosmeticActionState(player);
  resetUtilityLife(player);
  setPlayerLifecycle(player, 'spawning');
  if (spawn) {
    player.position = { x: spawn.x, y: spawn.y, z: spawn.z };
    player.ac.lastValidPos = { x: spawn.x, y: spawn.y, z: spawn.z };
  } else {
    player.ac.lastValidPos = null;
  }
  if (room && !spawn?.seq) room.spawnSeq = (room.spawnSeq || 0) + 1;
  const spawnSeq = spawn?.seq || (room ? room.spawnSeq : 0);
  player.spawnSeq = spawnSeq;
  applySpawnProtection(player, Date.now() + RESPAWN_PROTECTION_MS, spawn ? { x: spawn.x, y: spawn.y, z: spawn.z } : player.position);
  resetBuySession(player, spawn ? { x: spawn.x, y: spawn.y, z: spawn.z } : player.position);
  player.ac.airborneSince = 0;
  player.ac.graceUntil = Date.now() + AC.RESPAWN_GRACE_MS;
  setPlayerLifecycle(player, 'alive');
  player.dirty = true;
  broadcastToRoom(roomCode, null, 'playerSpawned', {
    id: player.id,
    health: player.health,
    deaths: player.deaths,
    lifecycle: player.lifecycle,
    spawnProtectionUntil: player.invulnerableUntil,
    spawn: spawn ? { ...spawn, seq: spawnSeq } : spawn
  });
}

function isNameTaken(room, name, exceptId) {
  const normalized = normalizeName(name);
  return Array.from(room.players.values()).some((player) => (
    player.id !== exceptId && normalizeName(player.name) === normalized
  ));
}

function broadcastToRoom(roomCode, exceptId, type, data) {
  const room = rooms.get(roomCode);
  if (!room) return;
  for (const id of room.players.keys()) {
    if (id === exceptId) continue;
    const client = clients.get(id);
    if (client) send(client, type, data);
  }
}

function broadcastToTeam(roomCode, team, exceptId, type, data) {
  const room = rooms.get(roomCode);
  if (!room) return;
  for (const [id, player] of room.players.entries()) {
    if (id === exceptId || player.team !== team) continue;
    const client = clients.get(id);
    if (client) send(client, type, data);
  }
}

function findClientByAccountId(accountId) {
  const wanted = String(accountId || '');
  for (const client of clients.values()) {
    if (String(client.accountId || '') === wanted) return client;
  }
  return null;
}

function broadcastRaw(roomCode, str) {
  const room = rooms.get(roomCode);
  if (!room) return;
  for (const id of room.players.keys()) {
    const client = clients.get(id);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      if (client.ws.bufferedAmount > SNAPSHOT_BACKPRESSURE_BYTES) continue;
      try { client.ws.send(str); } catch {}
    }
  }
}

function send(client, type, data) {
  if (!client || client.ws.readyState !== WebSocket.OPEN) return;
  // Guard the send like broadcastRaw does — a throw here would otherwise unwind
  // through every broadcast/timer caller and crash the process for all players.
  try { client.ws.send(JSON.stringify({ type, data })); } catch {}
}

// ---------------------------------------------------------------------------
// Snapshot tick — batched, quantized, delta state to each room.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Containment (co-op wave survival)
// ---------------------------------------------------------------------------
// The rules live in containment.js. Everything here is the wiring: rooms,
// sockets, and routing enemy damage through the same authority the PvP path
// uses. No decision below is taken from a packet.

const CONTAINMENT_TICK_MS = 100;   // 10 Hz director; enemy motion rides the snapshot
const CONTAINMENT_ENEMY_MS = 100;
const CONTAINMENT_WEAPON_PRICES = Object.freeze({ ...WEAPON_PRICES, Knife: 0, Glock: 0 });

function isContainment(room) {
  return !!MODE_CONFIG[room?.settings?.gamemode]?.coop;
}

// Created lazily so a room only pays for it when the mode is actually selected.
function ensureContainment(room) {
  if (!isContainment(room)) return null;
  if (!room.containment) {
    room.containment = containment.createMatch({
      now: Date.now(),
      endless: room.settings?.containmentEndless !== false,
      waveLimit: room.settings?.containmentWaveLimit || 0,
      startingWave: room.settings?.containmentStartWave || 0,
      tuning: { teamScaling: room.settings?.containmentTeamScaling ?? 1 }
    });
    containment.configureGates(room.containment, containmentGateDefinitions(room));
  }
  return room.containment;
}

function containmentGateDefinitions(room) {
  const authored = gameMaps.CONTAINMENT_GATES?.[getRoomMapId(room)] || [];
  const start = containmentLayout(room)?.start;
  return authored.map((gate) => {
    const hint = Number(gate.yHint) || 0;
    const ground = groundYForRoom(room, gate.x, gate.z, hint + 30);
    const distance = start ? Math.hypot(Number(gate.x) - Number(start.x), Number(gate.z) - Number(start.z)) : 0;
    // Costs rise in clear 250-credit steps as a barrier gets farther from the
    // authored staging spawn. This keeps cheap nearby exits useful early while
    // long-map shortcuts become meaningful wave-progression purchases.
    const price = gate.unbuyable ? 0 : Math.max(750, Math.min(3000, 500 + Math.ceil(distance / 160) * 250));
    return {
      ...gate,
      y: (Number.isFinite(ground) ? ground : hint) + SPAWN_EYE_OFFSET,
      depth: Number(gate.depth) || 5,
      height: Number(gate.height) || 24,
      price
    };
  });
}

function containmentLayout(room) {
  return gameMaps.CONTAINMENT_LAYOUTS?.[getRoomMapId(room)] || null;
}

function segmentIntersectsContainmentGate(gate, start, end, padding = 0) {
  if (!gate || gate.open || !start || !end) return false;
  const yaw = Number(gate.yaw) || 0;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const local = point => {
    const dx = Number(point.x) - Number(gate.x);
    const dz = Number(point.z) - Number(gate.z);
    return { x: cos * dx - sin * dz, z: sin * dx + cos * dz };
  };
  const a = local(start), b = local(end);
  const halfX = Math.max(3, Number(gate.width) || 14) / 2 + padding;
  const halfZ = Math.max(1, Number(gate.depth) || 5) / 2 + padding;
  let low = 0, high = 1;
  for (const [origin, delta, extent] of [[a.x, b.x - a.x, halfX], [a.z, b.z - a.z, halfZ]]) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < -extent || origin > extent) return false;
      continue;
    }
    const t1 = (-extent - origin) / delta;
    const t2 = (extent - origin) / delta;
    low = Math.max(low, Math.min(t1, t2));
    high = Math.min(high, Math.max(t1, t2));
    if (low > high) return false;
  }
  return true;
}

function closedContainmentGateBlocks(room, start, end, crouching = false, padding = 3) {
  const gates = room?.containment?.gates?.values?.();
  if (!gates) return false;
  const eyeHeight = crouching ? 11 : 18;
  const feet = Math.min(Number(start?.y) || 0, Number(end?.y) || 0) - eyeHeight;
  for (const gate of gates) {
    const base = (Number(gate.y) || 0) - 18;
    if (feet > base + (Number(gate.height) || 24) + 2 || feet + eyeHeight < base - 2) continue;
    if (segmentIntersectsContainmentGate(gate, start, end, padding)) return true;
  }
  return false;
}

function publicContainmentEnemies(match) {
  return Array.from(match?.enemies?.values?.() || []).map(enemy => ({
    id: enemy.id, kind: enemy.kind, x: enemy.x, y: enemy.y, z: enemy.z,
    health: enemy.health, maxHealth: enemy.maxHealth
  }));
}

function containmentClientState(room, playerId) {
  const eligibleIds = containmentEligiblePlayerIds(room);
  return {
    ...containment.hudState(room.containment, playerId),
    weaponPrices: CONTAINMENT_WEAPON_PRICES,
    gates: containment.publicGates(room.containment),
    ownedWeapons: [...(room.players.get(playerId)?.containmentWeapons || ['Knife', 'Glock'])],
    preparationVote: containment.preparationVoteState(room.containment, eligibleIds, playerId)
  };
}

function containmentEligiblePlayerIds(room) {
  return Array.from(room.players.entries())
    .filter(([, player]) => (player.health || 0) > 0 && !player.waitingForNextRound)
    .map(([id]) => id);
}

// The live player picture the director needs. Downed players count as present
// but not alive, which is what makes a team wipe distinguishable from an empty
// room - see the matching test.
function containmentPlayerView(room) {
  const players = [];
  let alive = 0;
  for (const [id, player] of room.players.entries()) {
    const isAlive = (player.health || 0) > 0 && !player.respawningUntil;
    if (isAlive) alive += 1;
    players.push({ id, x: player.position.x, y: player.position.y, z: player.position.z, alive: isAlive });
  }
  return { players, alivePlayers: alive, totalPlayers: room.players.size };
}

// Where enemies may enter. The initial staging section owns one breach; each
// purchased gate adds its sector's breach to this live list. This makes a gate
// change the encounter footprint instead of merely removing a visual wall.
// Unknown/custom maps still fall back to their regular spawn catalog.
function containmentSpawnPoints(room) {
  const mapId = getRoomMapId(room);
  const layout = containmentLayout(room);
  if (layout?.breaches?.length) {
    if (room.containmentSpawnCatalog?.mapId !== mapId) {
      room.containmentSpawnCatalog = {
        mapId,
        points: layout.breaches.map((point) => {
          const hint = Number(point.yHint) || 0;
          const ground = groundYForRoom(room, point.x, point.z, hint + 30);
          return {
            ...point,
            x: Number(point.x) || 0,
            y: Number.isFinite(ground) ? ground + SPAWN_EYE_OFFSET : hint + SPAWN_EYE_OFFSET,
            z: Number(point.z) || 0
          };
        })
      };
    }
    return room.containmentSpawnCatalog.points.filter((point) => {
      if (!point.requiresGate) return true;
      return room.containment?.gates?.get?.(String(point.requiresGate))?.open === true;
    });
  }
  if (room.containmentSpawns) return room.containmentSpawns;
  const points = getSpawnPoints(room).filter(point => room.settings?.fullMap ? !point.halfOnly : point.halfMap !== false);
  room.containmentSpawns = points.map((point, index) => ({
    id: `breach-${index}`,
    x: Number(point.x ?? point[0] ?? 0),
    y: Number(point.y ?? point[1] ?? 0),
    z: Number(point.z ?? point[2] ?? 0)
  }));
  return room.containmentSpawns;
}

function spreadContainmentSpawn(room, point, enemies) {
  if (!point) return null;
  const occupied = Array.from(enemies?.values?.() || []);
  const clearance = 5.5;
  const candidateAt = (radius, angle) => {
    const x = Number(point.x) + Math.cos(angle) * radius;
    const z = Number(point.z) + Math.sin(angle) * radius;
    const ground = groundYForRoom(room, x, z, Number(point.y) + 12);
    if (!Number.isFinite(ground)) return null;
    const candidate = { ...point, x, y: ground + SPAWN_EYE_OFFSET, z };
    if (containmentNavigationBlocked(room, point, candidate, 1.7)) return null;
    const nearest = occupied.reduce((best, enemy) => (
      Math.min(best, Math.hypot(enemy.x - x, enemy.z - z))
    ), Infinity);
    return { candidate, nearest };
  };
  // A golden-angle sequence spreads repeated spawns without forming visible
  // rows. Random rotation means separate waves do not reuse the same footprints.
  const rotation = Math.random() * Math.PI * 2;
  let best = null;
  for (let sample = 0; sample < 32; sample += 1) {
    const radius = 3.5 + (sample % 6) * 2.25;
    const result = candidateAt(radius, rotation + sample * 2.399963229728653);
    if (!result) continue;
    if (result.nearest >= clearance) return result.candidate;
    if (!best || result.nearest > best.nearest) best = result;
  }
  // A very crowded or narrow breach may not offer full clearance. Choose the
  // safest valid sample instead of stacking the overflow at one exact point.
  return best?.candidate || { ...point };
}

function broadcastContainment(roomCode, room) {
  for (const [id, player] of room.players.entries()) {
    const client = clients.get(player.clientId || id);
    if (client) send(client, 'containmentState', containmentClientState(room, id));
  }
}

function containmentTick() {
  const now = Date.now();
  for (const [roomCode, room] of rooms.entries()) {
    if (!isContainment(room)) continue;
    const match = ensureContainment(room);
    if (!match || match.phase === containment.PHASES.WAITING) continue;

    const view = containmentPlayerView(room);
    const events = containment.step(match, now, view);

    for (const event of events) {
      if (event.type === 'spawnDue') {
        // The spawn budget stays pending, so resuming continues this wave
        // naturally. Existing enemies remain active for live testing.
        if (roomCode === ADMIN_ROOM_CODE && ensureAdminConfig(room).zombieSpawnsPaused) continue;
        const point = containment.pickSpawn(containmentSpawnPoints(room), view.players, {
          // Real line of sight, from the map's own collision mesh - the module
          // knows nothing about geometry and asks for this.
          isVisible: (spawn, player) => !segmentBlockedForRoom(room, spawn, player),
          pick: (n) => Math.floor(Math.random() * n)
        });
        if (point) {
          const spawn = spreadContainmentSpawn(room, point, match.enemies);
          const enemy = containment.createEnemy(match, event.budget, spawn, now);
          broadcastRaw(roomCode, JSON.stringify({ type: 'containmentSpawn', data: {
            id: enemy.id, kind: enemy.kind, x: enemy.x, y: enemy.y, z: enemy.z, health: enemy.maxHealth
          } }));
        }
        continue;
      }
      if (event.type === 'waveCleared') {
        // The whole squad shares the clear reward. Anyone downed during the
        // wave returns at the staging spawn for the preparation phase.
        for (const [id, player] of room.players.entries()) {
          containment.grant(match, id, event.reward);
        }
        respawnContainmentPlayers(roomCode, room);
      }
      broadcastRaw(roomCode, JSON.stringify({ type: 'containmentEvent', data: event }));
    }
    if (events.length) broadcastContainment(roomCode, room);
  }
}

function respawnContainmentPlayers(roomCode, room) {
  const downed = Array.from(room.players.values())
    .filter((player) => (player.health || 0) <= 0 || player.waitingForNextRound);
  if (!downed.length) return;
  const batchChosen = [];
  for (const player of downed) {
    if (player.respawnTimer) {
      clearTimeout(player.respawnTimer);
      player.respawnTimer = null;
    }
    player.respawningUntil = 0;
    const spawn = pickSpawn(room, player, { batchChosen });
    room.spawnSeq = (room.spawnSeq || 0) + 1;
    spawn.seq = room.spawnSeq;
    batchChosen.push({ id: spawn.id, x: spawn.x, y: spawn.y, z: spawn.z });
    finishRespawn(roomCode, player, spawn);
  }
}

function containmentNavigationBlocked(room, from, to, radius = 2) {
  if (!from || !to) return true;
  if (halfMapSegmentBlocked(room, from, to) || closedContainmentGateBlocks(room, from, to, false, radius)) return true;
  const collision = getMapCollision(room);
  if (!collision || typeof collision.blocked !== 'function') return false;
  const dx = Number(to.x) - Number(from.x);
  const dz = Number(to.z) - Number(from.z);
  const length = Math.hypot(dx, dz);
  const nx = length > 0.001 ? -dz / length : 0;
  const nz = length > 0.001 ? dx / length : 0;
  const offsets = radius > 0 ? [-radius, 0, radius] : [0];
  try {
    for (const offset of offsets) {
      // Two body-height probes stop the horde walking through waist-high props
      // while avoiding the floor triangles beneath their feet.
      for (const belowEye of [13, 6]) {
        if (collision.blocked(
          Number(from.x) + nx * offset, Number(from.y) - belowEye, Number(from.z) + nz * offset,
          Number(to.x) + nx * offset, Number(to.y) - belowEye, Number(to.z) + nz * offset,
          {
            ignoredGlassPanes: room.brokenGlassPanes,
            ignoredDoors: room.openDoors,
            ignoredVents: room.brokenVentIds
          }
        )) return true;
      }
    }
  } catch {
    return true;
  }
  return false;
}

function containmentNavigationPoint(room, x, z, from) {
  const sourceY = Number(from?.y) || SPAWN_EYE_OFFSET;
  const ground = groundYForRoom(room, x, z, sourceY + 10);
  if (!Number.isFinite(ground)) return null;
  const y = ground + SPAWN_EYE_OFFSET;
  // A grid edge may climb stairs or a ramp, but it may not teleport between
  // stacked floors or jump onto scenery.
  if (Math.abs(y - sourceY) > 8.5) return null;
  return { x, y, z };
}

function containmentRouteWaypoint(room, enemy, target, now) {
  if (!target) return null;
  const directBlocked = containmentNavigationBlocked(room, enemy, target, 2.1);
  if (!directBlocked) {
    enemy.navPath = [];
    return target;
  }

  const targetMoved = !Number.isFinite(enemy.navTargetX)
    || Math.hypot(target.x - enemy.navTargetX, target.z - enemy.navTargetZ) > 12;
  const needsPlan = enemy.navTargetId !== target.id || targetMoved
    || !Array.isArray(enemy.navPath) || enemy.navPath.length === 0
    || now - (enemy.navPlannedAt || 0) > 900;
  if (needsPlan) {
    enemy.navPath = containment.findPath(enemy, target, {
      gridSize: 10,
      maxVisited: 1500,
      resolvePoint: (x, z, from) => containmentNavigationPoint(room, x, z, from),
      isBlocked: (from, to) => containmentNavigationBlocked(room, from, to, 2.1)
    });
    enemy.navTargetId = target.id;
    enemy.navTargetX = target.x;
    enemy.navTargetZ = target.z;
    enemy.navPlannedAt = now;
  }
  while (enemy.navPath?.length && Math.hypot(enemy.navPath[0].x - enemy.x, enemy.navPath[0].z - enemy.z) < 3.2) {
    enemy.navPath.shift();
  }
  return enemy.navPath?.[0] || null;
}

function separatedContainmentWaypoint(enemy, waypoint, enemies, now) {
  if (!waypoint) return null;
  // Do not steer the attack target itself sideways. Separation is useful on
  // the approach, but close to a player it must not distort melee range.
  if (Math.hypot(waypoint.x - enemy.x, waypoint.z - enemy.z) < 10) return waypoint;
  let repelX = 0, repelZ = 0;
  for (const other of enemies.values()) {
    if (other === enemy) continue;
    const dx = enemy.x - other.x;
    const dz = enemy.z - other.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.001 || distance >= 7.5) continue;
    const strength = (7.5 - distance) / 7.5;
    repelX += (dx / distance) * strength * 4;
    repelZ += (dz / distance) * strength * 4;
  }
  const dx = waypoint.x - enemy.x;
  const dz = waypoint.z - enemy.z;
  const distance = Math.hypot(dx, dz) || 1;
  const weave = Math.sin(now * 0.0017 + (enemy.steeringPhase || 0)) * 0.8;
  return {
    ...waypoint,
    x: waypoint.x + repelX + (-dz / distance) * weave,
    z: waypoint.z + repelZ + (dx / distance) * weave
  };
}

// Enemy motion and attacks. Separate from the director so the pacing of the two
// can differ without one starving the other.
function containmentEnemyTick() {
  const now = Date.now();
  const delta = CONTAINMENT_ENEMY_MS / 1000;
  for (const [roomCode, room] of rooms.entries()) {
    if (!isContainment(room) || !room.containment) continue;
    const match = room.containment;
    if (match.phase !== containment.PHASES.ACTIVE || match.enemies.size === 0) continue;

    const view = containmentPlayerView(room);
    const assignments = new Map();
    const moved = [];

    for (const enemy of match.enemies.values()) {
      const targetId = containment.chooseTarget(enemy, view.players, {
        assignments, enemyCount: match.enemies.size
      });
      enemy.targetId = targetId;
      if (targetId) assignments.set(targetId, (assignments.get(targetId) || 0) + 1);
      const target = view.players.find((p) => p.id === targetId) || null;
      const before = { x: enemy.x, y: enemy.y, z: enemy.z };
      const routeWaypoint = containmentRouteWaypoint(room, enemy, target, now);
      const waypoint = separatedContainmentWaypoint(enemy, routeWaypoint || target, match.enemies, now);
      const chasingPlayerDirectly = routeWaypoint === target;
      const result = containment.stepEnemy(
        enemy,
        waypoint ? { ...waypoint, id: chasingPlayerDirectly ? targetId : null } : null,
        delta,
        now,
        match.tuning
      );

      // Keep the horde on the authored map. Try the full stride first, then
      // slide along either axis; if every route is blocked the existing stuck
      // recovery moves it back to a player spawn after four seconds.
      if (result.moved && containmentNavigationBlocked(room, before, enemy, 2.1)) {
        const desired = { x: enemy.x, y: enemy.y, z: enemy.z };
        const slideX = { x: desired.x, y: before.y, z: before.z };
        const slideZ = { x: before.x, y: before.y, z: desired.z };
        if (!containmentNavigationBlocked(room, before, slideX, 2.1)) {
          enemy.x = slideX.x; enemy.z = slideX.z;
        } else if (!containmentNavigationBlocked(room, before, slideZ, 2.1)) {
          enemy.x = slideZ.x; enemy.z = slideZ.z;
        } else {
          enemy.x = before.x; enemy.z = before.z;
          if (!enemy.stuckSince) enemy.stuckSince = now;
          result.moved = false;
        }
      }
      if (result.moved) {
        const ground = groundYForRoom(room, enemy.x, enemy.z, enemy.y);
        if (Number.isFinite(ground)) enemy.y = ground + 18;
      }

      if (result.attacked) {
        // Damage a player through the server's own health path. The amount comes
        // from the enemy record the server built, never from anything a client
        // said, and the mode has no friendly fire to consider.
        const victim = room.players.get(result.targetId);
        if (victim && (victim.health || 0) > 0) applyContainmentDamage(roomCode, room, victim, result.damage, enemy.id);
      }
      if (result.moved) moved.push(enemy);

      // Wedged against geometry for too long: put it back at a breach point
      // rather than leave it grinding into a wall for the rest of the wave.
      if (enemy.stuckSince && now - enemy.stuckSince > 4_000) {
        const point = containment.pickSpawn(containmentSpawnPoints(room), view.players, {
          isVisible: () => false, pick: (n) => Math.floor(Math.random() * n)
        });
        const recovery = spreadContainmentSpawn(room, point, match.enemies);
        if (recovery) { enemy.x = recovery.x; enemy.y = recovery.y; enemy.z = recovery.z; }
        enemy.stuckSince = 0;
      }
    }

    if (moved.length) {
      broadcastRaw(roomCode, JSON.stringify({ type: 'containmentEnemies', data: {
        ts: now,
        e: moved.map((enemy) => ({
          id: enemy.id,
          x: core.quantizePos(enemy.x),
          y: core.quantizePos(enemy.y),
          z: core.quantizePos(enemy.z)
        }))
      } }));
    }
  }
}

// Line of sight between a spawn point and a player, using the map's own mesh.
// Returns true when something is in the way, which is what makes an unseen
// breach point preferable to a watched one.
function segmentBlockedForRoom(room, from, to) {
  const collision = getMapCollision(room);
  if (!collision || typeof collision.blocked !== 'function') return false;
  try {
    return halfMapSegmentBlocked(room, from, to)
      || closedContainmentGateBlocks(room, from, to, false, 0)
      || collision.blocked(
        from.x, from.y || 0, from.z,
        to.x, to.y || 0, to.z,
        {
          ignoredGlassPanes: room.brokenGlassPanes,
          ignoredDoors: room.openDoors,
          ignoredVents: room.brokenVentIds
        }
      );
  } catch {
    return true;
  }
}

function applyContainmentDamage(roomCode, room, victim, amount, attackerId = null) {
  const damage = Math.max(0, Math.floor(Number(amount) || 0));
  if (!damage) return;
  victim.health = Math.max(0, (victim.health || 0) - damage);
  victim.dirty = true;
  broadcastRaw(roomCode, JSON.stringify({ type: 'containmentPlayerHit', data: {
    id: victim.id, health: victim.health, damage, enemyId: attackerId
  } }));
  if (victim.health <= 0) {
    setPlayerLifecycle(victim, 'waiting');
    victim.waitingForNextRound = true;
    broadcastRaw(roomCode, JSON.stringify({ type: 'containmentDown', data: { id: victim.id } }));
  }
}

// A player's bullet landing on an enemy. The client says WHICH enemy it hit;
// the server decides whether that is plausible and how much it is worth, in the
// same spirit as handlePlayerHit above.
function handleContainmentHit(client, room, player, data = {}) {
  const match = room.containment;
  if (!match || match.phase !== containment.PHASES.ACTIVE) return;
  if ((player.health || 0) <= 0) return;

  const enemy = match.enemies.get(String(data.enemyId || ''));
  if (!enemy) return;

  // Server-side weapon damage. The client's number is ignored entirely.
  const weapon = core.WEAPONS?.[player.weapon];
  const base = Math.max(1, Math.floor(Number(weapon?.damage) || 25));
  const headshot = data.headshot === true;

  // Plausibility: the shot has to have come from somewhere near the player.
  const reach = Math.hypot(enemy.x - player.position.x, enemy.z - player.position.z);
  if (reach > 220) return;

  const result = containment.damageEnemy(match, enemy.id, base, { headshot });
  if (!result) return;

  broadcastRaw(client.roomCode, JSON.stringify({ type: 'containmentEnemyHit', data: {
    id: enemy.id, health: result.enemy.health, headshot, killed: result.killed
  } }));

  if (result.killed) {
    match.stats.kills += 1;
    if (headshot) match.stats.headshots += 1;
    const reward = containment.rewardFor('kill', match, { headshot });
    containment.grant(match, player.id, reward);
    send(client, 'containmentState', containmentClientState(room, player.id));
  }
}

function handleContainmentBuyWeapon(client, room, player, data = {}) {
  const match = ensureContainment(room);
  if (!match || containment.TERMINAL_PHASES.has(match.phase) || (player.health || 0) <= 0) return;
  const weapon = sanitizeWeaponName(data.weapon);
  const slot = String(data.slot || '').slice(0, 16);
  if (!['main', 'sidearm', 'knife'].includes(slot) || !weapon || !isWeaponAvailableInMode(room, weapon)) {
    send(client, 'weaponDenied', { weapon, slot, credits: containment.credits(match, player.id), containment: true, message: 'That weapon is unavailable.' });
    return;
  }
  const price = CONTAINMENT_WEAPON_PRICES[weapon];
  if (!Array.isArray(player.containmentWeapons)) player.containmentWeapons = ['Knife', 'Glock'];
  const alreadyOwned = player.containmentWeapons.includes(weapon);
  const decision = alreadyOwned
    ? { ok: true, remaining: containment.credits(match, player.id), cost: 0 }
    : containment.purchase(match, player.id, `weapon:${weapon}`, price);
  if (!decision.ok) {
    send(client, 'weaponDenied', { weapon, slot, credits: containment.credits(match, player.id), containment: true, message: decision.reason === 'insufficient' ? 'Not enough credits.' : 'That weapon is unavailable.' });
    return;
  }
  if (!player.containmentWeapons.includes(weapon)) player.containmentWeapons.push(weapon);
  player.weapon = weapon;
  player.dirty = true;
  send(client, 'weaponPurchased', { weapon, slot, credits: decision.remaining, containment: true });
  send(client, 'containmentState', containmentClientState(room, player.id));
}

function handleContainmentOpenGate(client, room, player, data = {}) {
  const match = ensureContainment(room);
  if (!match || containment.TERMINAL_PHASES.has(match.phase) || (player.health || 0) <= 0) return;
  const gate = match.gates.get(String(data.gateId || ''));
  if (!gate || gate.open) return;
  if (Math.hypot(player.position.x - gate.x, player.position.z - gate.z) > 30) {
    send(client, 'containmentNotice', { message: 'Move closer to the gate.' });
    return;
  }
  const decision = containment.openGate(match, player.id, gate.id);
  if (!decision.ok) {
    send(client, 'containmentNotice', { message: decision.reason === 'insufficient' ? `You need ${gate.price} credits.` : 'Gate unavailable.' });
    return;
  }
  broadcastRaw(client.roomCode, JSON.stringify({ type: 'containmentGateOpened', data: { gate: { ...gate }, openedBy: player.id } }));
  broadcastContainment(client.roomCode, room);
}

function handleContainmentSkipPreparation(client, room, player) {
  const match = ensureContainment(room);
  if (!match || match.phase !== containment.PHASES.PREPARATION) return;
  if ((player.health || 0) <= 0 || player.waitingForNextRound) return;
  const decision = containment.voteToSkipPreparation(match, player.id, containmentEligiblePlayerIds(room), Date.now());
  if (!decision.ok) {
    if (decision.reason === 'already-voted') send(client, 'containmentNotice', { message: 'You have already voted to skip preparation.' });
    return;
  }
  broadcastContainment(client.roomCode, room);
}

// Admin hold on the wave director. Used to walk a map and read coordinates
// without a horde in the way - the same job tools/gate-mapper.html does
// offline, for when the layout has to be checked against a live room.
//
// Deliberately narrow: it suppresses new spawns and nothing else. Enemies
// already on the map keep chasing, damage is unchanged, and no reward, gate or
// purse is touched, so an admin cannot pause their way out of a losing wave.
function handleContainmentAdminPause(client, room, data = {}) {
  if (!isAdminUser(client)) return;
  const match = ensureContainment(room);
  if (!match) return;
  const decision = containment.setSpawnPaused(match, data.paused === true);
  if (!decision.changed) return;
  // Mirrored back so the admin panel's own switch reads the same state.
  if (room.adminConfig) room.adminConfig.zombieSpawnsPaused = decision.spawnPaused;
  broadcastContainment(client.roomCode, room);
}

// Snapshot encoder lives in core.js so all runtimes build byte-identical snapshots.
function snapshotTick() {
  const now = Date.now();
  for (const [roomCode, room] of rooms.entries()) {
    const arr = core.buildSnapshotEntries(room, now);
    if (arr.length) {
      broadcastRaw(roomCode, JSON.stringify({ type: 'snapshot', data: { t: ++snapshotSeq, ts: now, p: arr } }));
    }
  }
}

// ---------------------------------------------------------------------------
// Stats accumulation + flush (never on the hot path)
// ---------------------------------------------------------------------------
function newStatDelta() {
  return {
    kills: 0, deaths: 0, assists: 0, wins: 0, gamesPlayed: 0, playtimeSecs: 0,
    bestStreak: 0, gungameKills: 0, gungameWins: 0, deathmatchKills: 0, deathmatchWins: 0,
    mvps: 0, shotsFired: 0, shotsHit: 0
  };
}

function dailyDateKey(date = new Date()) {
  return new Date(date.getTime() + (10 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function dailyChallengePeriodKey(date = new Date()) {
  const brisbane = new Date(date.getTime() + (10 * 60 * 60 * 1000));
  const dateKey = brisbane.toISOString().slice(0, 10);
  return `day:${dateKey}:${brisbane.getUTCHours() < 12 ? 'am' : 'pm'}`;
}

function weeklyStartDateKey(date = new Date()) {
  const aest = new Date(date.getTime() + (10 * 60 * 60 * 1000));
  const monday = new Date(Date.UTC(aest.getUTCFullYear(), aest.getUTCMonth(), aest.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function weeklyChallengePeriodKey(date = new Date()) {
  return `week:${weeklyStartDateKey(date)}`;
}

function previousDateKey(dateKey) {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function newDailyDelta() {
  return {
    dateKey: dailyDateKey(),
    wins: 0,
    kills: 0,
    deaths: 0,
    shotsFired: 0,
    shotsHit: 0,
    bestStreak: 0
  };
}

function newMatchChallengeDelta() {
  return { periodKey: dailyChallengePeriodKey(), kills: 0, wins: 0, damage: 0, headshots: 0, utilityKills: 0, weaponKills: {}, mapWins: {} };
}

function incrementMatchChallengeDelta(client, delta = {}) {
  if (!client) return;
  const periodKey = dailyChallengePeriodKey();
  if (!client.matchChallengeDelta || client.matchChallengeDelta.periodKey !== periodKey) {
    client.matchChallengeDelta = newMatchChallengeDelta();
  }
  const match = client.matchChallengeDelta;
  for (const key of ['kills', 'wins', 'damage', 'headshots', 'utilityKills']) {
    match[key] += Math.max(0, Number(delta[key] || 0));
  }
  if (delta.weapon && Number(delta.weaponKills) > 0) {
    match.weaponKills[delta.weapon] = Number(match.weaponKills[delta.weapon] || 0) + Number(delta.weaponKills);
  }
  if (delta.map && Number(delta.mapWins) > 0) {
    match.mapWins[delta.map] = Number(match.mapWins[delta.map] || 0) + Number(delta.mapWins);
  }
}

function dailyPlayerKey(client) {
  if (client?.accountId) return `account:${client.accountId}`;
  return `guest:${client?.deviceId || client?.id || 'unknown'}`;
}

function deltaIsEmpty(d) {
  return !(d.kills || d.deaths || d.assists || d.wins || d.gamesPlayed || d.playtimeSecs ||
    d.bestStreak || d.gungameKills || d.gungameWins || d.deathmatchKills || d.deathmatchWins ||
    d.mvps || d.shotsFired || d.shotsHit);
}

function dailyDeltaIsEmpty(d) {
  return !(d?.wins || d?.kills || d?.deaths || d?.shotsFired || d?.shotsHit || d?.bestStreak);
}

function countsForDailyStats(room, player) {
  if (!room || !player || player.waitingForNextRound || (player.health || 0) <= 0) return false;
  return countsForProgression(room);
}

function recordDailyStat(client, player, delta = {}) {
  if (!client || !player || !client.accountId || client.guest) return;
  if (!canClientProgress(client)) return;
  const dateKey = dailyDateKey();
  if (!client.dailyDelta || client.dailyDelta.dateKey !== dateKey) {
    flushClientDailyStats(client);
    client.dailyDelta = newDailyDelta();
  }
  const d = client.dailyDelta;
  d.wins += Number(delta.wins || 0);
  d.kills += Number(delta.kills || 0);
  d.deaths += Number(delta.deaths || 0);
  d.shotsFired += Number(delta.shotsFired || 0);
  d.shotsHit += Number(delta.shotsHit || 0);
  d.bestStreak = Math.max(d.bestStreak || 0, Number(delta.bestStreak || 0));
  const roomMapId = client.roomCode ? getRoomMapId(rooms.get(client.roomCode)) : '';
  incrementMatchChallengeDelta(client, {
    kills: delta.kills,
    wins: delta.wins,
    map: roomMapId,
    mapWins: Number(delta.wins || 0)
  });

  if (!db.isEnabled()) {
    const key = `${dateKey}:${dailyPlayerKey(client)}`;
    const existing = dailyStatsMemory.get(key) || {
      date_key: dateKey,
      player_key: dailyPlayerKey(client),
      account_id: client.accountId || null,
      username: player.name || client.name || client.accountName || 'Player',
      wins: 0,
      kills: 0,
      deaths: 0,
      shots_fired: 0,
      shots_hit: 0,
      best_streak: 0
    };
    existing.username = player.name || existing.username;
    existing.wins += Number(delta.wins || 0);
    existing.kills += Number(delta.kills || 0);
    existing.deaths += Number(delta.deaths || 0);
    existing.shots_fired += Number(delta.shotsFired || 0);
    existing.shots_hit += Number(delta.shotsHit || 0);
    existing.best_streak = Math.max(existing.best_streak || 0, Number(delta.bestStreak || 0));
    dailyStatsMemory.set(key, existing);
  }
  if (delta.kills || delta.wins) {
    if (db.isEnabled() && canClientProgress(client)) {
      const counters = {
        kills: Number(delta.kills || 0),
        wins: Number(delta.wins || 0),
        ...(roomMapId && Number(delta.wins || 0) > 0 ? { [`mapWins:${roomMapId}`]: Number(delta.wins || 0) } : {})
      };
      Promise.all([
        db.incrementDailyChallengeCounters(client.accountId, dailyChallengePeriodKey(), counters),
        db.incrementDailyChallengeCounters(client.accountId, weeklyChallengePeriodKey(), counters)
      ])
        .then(() => sendChallengeProgress(client))
        .catch(error => console.error('[weekly-challenges]', error.message));
    } else {
      sendChallengeProgress(client);
    }
  }
}

let dailyChallengeDefinitionCache = null;
let weeklyChallengeDefinitionCache = null;

const FALLBACK_DAILY_CHALLENGE_TEMPLATES = Object.freeze([
  { id: 'fallback_easy_kills', tier: 'easy', metric: 'kills', label: 'Get {target} kills', target: 10, xp: 100, enabled: true },
  { id: 'fallback_medium_damage', tier: 'medium', metric: 'damage', label: 'Deal {target} damage', target: 4000, xp: 300, enabled: true },
  { id: 'fallback_hard_weapon', tier: 'hard', metric: 'weaponKills', label: 'Get {target} kills with {weapon}', target: 25, xp: 450, weapon: 'AUTO', enabled: true }
]);

const FALLBACK_WEEKLY_CHALLENGE_TEMPLATES = Object.freeze([
  { id: 'fallback_weekly_easy_kills', period: 'weekly', tier: 'easy', metric: 'kills', label: 'Get {target} kills', target: 50, xp: 500, enabled: true },
  { id: 'fallback_weekly_medium_wins', period: 'weekly', tier: 'medium', metric: 'wins', label: 'Win {target} games', target: 8, xp: 1200, enabled: true },
  { id: 'fallback_weekly_hard_weapon', period: 'weekly', tier: 'hard', metric: 'weaponKills', label: 'Get {target} kills with {weapon}', target: 100, xp: 2000, weapon: 'AUTO', enabled: true }
]);

function dailyChallengeDateSeed(dateKey) {
  return [...dateKey].reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) >>> 0, 0);
}

async function adaptiveDailyChallengeWeapon(dateKey) {
  const guns = ['AK47', 'AWP', 'FAMAS', 'SSG 08', 'P90', 'XM1014', 'MAC10', 'Nova', 'Deagle', 'Glock']
    .filter(name => WEAPONS[name]);
  let totals = [];
  if (db.isEnabled()) {
    try { totals = await db.getGlobalWeaponKills(); } catch (error) { console.error('[daily-challenges]', error.message); }
  }
  const killMap = new Map(totals.map(row => [row.weapon, Number(row.kills) || 0]));
  const ranked = guns.slice().sort((a, b) => (killMap.get(b) || 0) - (killMap.get(a) || 0) || a.localeCompare(b));
  return ranked[dailyChallengeDateSeed(dateKey) % Math.max(1, ranked.length)] || 'AK47';
}

function renderDailyChallengeTemplate(template, adaptiveWeapon) {
  const weapon = template.metric === 'weaponKills' ? (template.weapon && template.weapon !== 'AUTO' ? template.weapon : adaptiveWeapon) : '';
  const target = Math.max(1, Number(template.target) || 1);
  const label = String(template.label || '')
    .replaceAll('{target}', target.toLocaleString())
    .replaceAll('{weapon}', weapon)
    .replaceAll('{map}', publicMapLabel(template.map || MAP_DUST2));
  return { id: template.id, tier: template.tier, key: template.metric, weapon, map: template.map || '', label, target, xp: Math.max(0, Number(template.xp) || 0) };
}

async function dailyChallengeDefinitions(dateKey) {
  if (dailyChallengeDefinitionCache?.dateKey === dateKey) return dailyChallengeDefinitionCache.challenges;
  let templates = FALLBACK_DAILY_CHALLENGE_TEMPLATES;
  if (db.isEnabled()) {
    try { templates = await db.getDailyChallengeTemplates({ enabledOnly: true, period: 'daily' }); } catch (error) { console.error('[daily-challenges]', error.message); }
  }
  const dateSeed = dailyChallengeDateSeed(dateKey);
  const selected = ['easy', 'medium', 'hard'].map((tier, index) => {
    const pool = templates.filter(template => template.enabled !== false && template.tier === tier);
    return pool.length ? pool[(dateSeed + index * 104729) % pool.length] : null;
  }).filter(Boolean);
  const adaptiveWeapon = selected.some(template => template.metric === 'weaponKills' && (!template.weapon || template.weapon === 'AUTO'))
    ? await adaptiveDailyChallengeWeapon(dateKey)
    : 'AK47';
  const challenges = selected.map(template => renderDailyChallengeTemplate(template, adaptiveWeapon));
  dailyChallengeDefinitionCache = { dateKey, challenges };
  return challenges;
}

async function weeklyChallengeDefinitions(periodKey) {
  if (weeklyChallengeDefinitionCache?.periodKey === periodKey) return weeklyChallengeDefinitionCache.challenges;
  if (db.isEnabled()) {
    try {
      const persisted = await db.getWeeklyChallengeRotation(periodKey);
      if (Array.isArray(persisted) && persisted.length) {
        weeklyChallengeDefinitionCache = { periodKey, challenges: persisted };
        return persisted;
      }
    } catch (error) {
      console.error('[weekly-challenges] unable to load persisted rotation:', error.message);
    }
  }
  let templates = FALLBACK_WEEKLY_CHALLENGE_TEMPLATES;
  if (db.isEnabled()) {
    try { templates = await db.getDailyChallengeTemplates({ enabledOnly: true, period: 'weekly' }); } catch (error) { console.error('[weekly-challenges]', error.message); }
  }
  const periodSeed = dailyChallengeDateSeed(`${periodKey}:weekly`);
  const selected = ['easy', 'medium', 'hard'].map((tier, index) => {
    const pool = templates.filter(template => template.enabled !== false && template.tier === tier);
    return pool.length ? pool[(periodSeed + index * 130363) % pool.length] : null;
  }).filter(Boolean);
  const adaptiveWeapon = selected.some(template => template.metric === 'weaponKills' && (!template.weapon || template.weapon === 'AUTO'))
    ? await adaptiveDailyChallengeWeapon(periodKey)
    : 'AK47';
  let challenges = selected.map(template => ({
    ...renderDailyChallengeTemplate(template, adaptiveWeapon),
    rewardCase: template.tier === 'hard'
  }));
  if (db.isEnabled() && challenges.length) {
    try {
      challenges = await db.saveWeeklyChallengeRotation(periodKey, challenges);
    } catch (error) {
      console.error('[weekly-challenges] unable to persist rotation:', error.message);
    }
  }
  weeklyChallengeDefinitionCache = { periodKey, challenges };
  return challenges;
}

async function randomMarketplaceChallengeCase() {
  const available = (await getCustomCaseDefinitions({ force: true }))
    .filter(caseDef => skins.caseAvailability(caseDef).available);
  return available.length ? available[crypto.randomInt(0, available.length)] : null;
}

async function claimChallengeReward(client, periodKey, challenge, claimed, reason, { caseReward = null } = {}) {
  const result = await db.claimDailyChallenge(client.accountId, periodKey, challenge.tier, challenge.xp, {
    caseRewardId: caseReward?.id || ''
  });
  // Another concurrent progress refresh may have inserted this claim while this
  // request was awaiting Postgres. A conflict means the reward is already owned,
  // so keep this response authoritative instead of sending a stale unclaimed row.
  if (!result.claimed) {
    claimed.add(challenge.tier);
    return false;
  }
  claimed.add(challenge.tier);
  const beforeLevel = progressionForXpLocal(result.previousXp || 0).level;
  const afterLevel = progressionForXpLocal(result.xp || 0).level;
  const levelsGained = Math.max(0, afterLevel - beforeLevel);
  const mowbucks = mowbucksForLevels(beforeLevel, afterLevel);
  if (mowbucks > 0) await db.addMowbucks(client.accountId, mowbucks);
  send(client, 'progressionUpdate', {
    amount: challenge.xp,
    reason,
    mowbucks,
    levelsGained,
    level: afterLevel,
    caseReward: caseReward ? { caseId: caseReward.id, displayName: caseReward.displayName } : null,
    stats: await auth.statsPayload(client.accountId)
  });
  if (caseReward) sendSkinInventory(client);
  return true;
}

async function buildDailyChallengeProgress(client) {
  const periodKey = dailyChallengePeriodKey();
  const challenges = await dailyChallengeDefinitions(periodKey);
  const empty = { dateKey: periodKey, challenges: challenges.map(challenge => ({ ...challenge, progress: 0, matchProgress: 0, claimed: false })) };
  if (!client || !client.accountId || client.guest) return empty;
  const counters = db.isEnabled() ? await db.getDailyChallengeCounters(client.accountId, periodKey) : {};
  const claimed = new Set(db.isEnabled() ? await db.getDailyChallengeClaims(client.accountId, periodKey) : []);
  const weaponProgress = new Map();
  if (db.isEnabled()) {
    for (const weapon of new Set(challenges.filter(challenge => challenge.key === 'weaponKills' && challenge.weapon).map(challenge => challenge.weapon))) {
      weaponProgress.set(weapon, await db.getDailyWeaponKills(client.accountId, periodKey, weapon));
    }
  }
  const canClaimXp = canClientProgress(client);
  const match = client.matchChallengeDelta?.periodKey === periodKey ? client.matchChallengeDelta : newMatchChallengeDelta();
  const rendered = [];
  for (const challenge of challenges) {
    const progress = Number(challenge.key === 'weaponKills' ? weaponProgress.get(challenge.weapon)
      : (challenge.key === 'mapWins' ? counters[`mapWins:${challenge.map}`] : counters[challenge.key])) || 0;
    const matchProgress = Number(challenge.key === 'weaponKills' ? match.weaponKills?.[challenge.weapon]
      : (challenge.key === 'mapWins' ? match.mapWins?.[challenge.map] : match[challenge.key])) || 0;
    if (progress >= challenge.target && !claimed.has(challenge.tier) && db.isEnabled() && canClaimXp) {
      await claimChallengeReward(client, periodKey, challenge, claimed, 'Challenge complete');
    }
    rendered.push({ ...challenge, progress, matchProgress, claimed: claimed.has(challenge.tier) });
  }
  return { dateKey: periodKey, challenges: rendered };
}

async function buildWeeklyChallengeProgress(client) {
  const periodKey = weeklyChallengePeriodKey();
  const startDateKey = periodKey.slice('week:'.length);
  const challenges = await weeklyChallengeDefinitions(periodKey);
  const empty = { periodKey, startDateKey, challenges: challenges.map(challenge => ({ ...challenge, progress: 0, matchProgress: 0, claimed: false })) };
  if (!client || !client.accountId || client.guest || !db.isEnabled()) return empty;
  const counters = await db.getDailyChallengeCounters(client.accountId, periodKey);
  const claimed = new Set(await db.getDailyChallengeClaims(client.accountId, periodKey));
  const weaponProgress = new Map();
  for (const weapon of new Set(challenges.filter(challenge => challenge.key === 'weaponKills' && challenge.weapon).map(challenge => challenge.weapon))) {
    weaponProgress.set(weapon, await db.getDailyWeaponKills(client.accountId, periodKey, weapon));
  }
  const canClaimXp = canClientProgress(client);
  const match = client.matchChallengeDelta || newMatchChallengeDelta();
  const rendered = [];
  for (const challenge of challenges) {
    const progress = Number(challenge.key === 'weaponKills' ? weaponProgress.get(challenge.weapon)
      : (challenge.key === 'mapWins' ? counters[`mapWins:${challenge.map}`] : counters[challenge.key])) || 0;
    const matchProgress = Number(challenge.key === 'weaponKills' ? match.weaponKills?.[challenge.weapon]
      : (challenge.key === 'mapWins' ? match.mapWins?.[challenge.map] : match[challenge.key])) || 0;
    let rewardPending = false;
    if (progress >= challenge.target && !claimed.has(challenge.tier) && canClaimXp) {
      const caseReward = challenge.tier === 'hard' ? await randomMarketplaceChallengeCase() : null;
      if (challenge.tier !== 'hard' || caseReward) {
        await claimChallengeReward(client, periodKey, challenge, claimed, 'Weekly challenge complete', { caseReward });
      } else {
        rewardPending = true;
      }
    }
    rendered.push({ ...challenge, progress, matchProgress, rewardPending, claimed: claimed.has(challenge.tier) });
  }
  return { periodKey, startDateKey, challenges: rendered };
}

function sendDailyChallengeProgress(client) {
  if (!client || !client.authed) return;
  buildDailyChallengeProgress(client)
    .then(progress => send(client, 'dailyChallengeProgress', progress))
    .catch(error => console.error('[daily-challenges]', error.message));
}

function sendWeeklyChallengeProgress(client) {
  if (!client || !client.authed) return;
  buildWeeklyChallengeProgress(client)
    .then(progress => send(client, 'weeklyChallengeProgress', progress))
    .catch(error => console.error('[weekly-challenges]', error.message));
}

function sendChallengeProgress(client) {
  sendDailyChallengeProgress(client);
  sendWeeklyChallengeProgress(client);
}

function accruePlaytime(client) {
  if (client && client.lastPlaytimeStamp) {
    const now = Date.now();
    const secs = Math.floor((now - client.lastPlaytimeStamp) / 1000);
    if (secs > 0) client.statDelta.playtimeSecs += secs;
    client.lastPlaytimeStamp = now;
  }
}

function mergeStatDelta(target, source) {
  if (!target || !source) return target;
  for (const key of ['kills', 'deaths', 'assists', 'wins', 'gamesPlayed', 'playtimeSecs',
    'gungameKills', 'gungameWins', 'deathmatchKills', 'deathmatchWins', 'mvps', 'shotsFired', 'shotsHit']) {
    target[key] = Number(target[key] || 0) + Number(source[key] || 0);
  }
  target.bestStreak = Math.max(Number(target.bestStreak || 0), Number(source.bestStreak || 0));
  return target;
}

function mergeDailyDelta(target, source) {
  if (!target || !source || target.dateKey !== source.dateKey) return target;
  for (const key of ['wins', 'kills', 'deaths', 'shotsFired', 'shotsHit']) {
    target[key] = Number(target[key] || 0) + Number(source[key] || 0);
  }
  target.bestStreak = Math.max(Number(target.bestStreak || 0), Number(source.bestStreak || 0));
  return target;
}

async function flushClientStats(client) {
  if (!client || !client.accountId || !db.isEnabled()) return;
  if (deltaIsEmpty(client.statDelta)) return;
  const delta = client.statDelta;
  client.statDelta = newStatDelta();
  try {
    await db.flushStat(client.accountId, delta);
  } catch (e) {
    mergeStatDelta(client.statDelta, delta);
    console.error('[stats] flush failed:', e.message);
  }
}

async function flushClientDailyStats(client) {
  if (!client || !client.accountId || client.guest || !db.isEnabled() || !client.dailyDelta || dailyDeltaIsEmpty(client.dailyDelta)) return;
  const delta = client.dailyDelta;
  client.dailyDelta = newDailyDelta();
  try {
    await db.recordDailyStats({
      dateKey: delta.dateKey,
      playerKey: dailyPlayerKey(client),
      accountId: client.accountId || null,
      username: client.name || client.accountName || 'Player',
      wins: delta.wins,
      kills: delta.kills,
      deaths: delta.deaths,
      shotsFired: delta.shotsFired,
      shotsHit: delta.shotsHit,
      bestStreak: delta.bestStreak
    });
  } catch (e) {
    if (client.dailyDelta?.dateKey === delta.dateKey) mergeDailyDelta(client.dailyDelta, delta);
    console.error('[daily-stats] flush failed:', e.message);
  }
}

function flushAllStats() {
  if (!db.isEnabled()) return;
  for (const client of clients.values()) {
    if (client.authed) accruePlaytime(client);
    flushClientStats(client);
    flushClientDailyStats(client);
  }
}

// ---------------------------------------------------------------------------
// Chat logging
// ---------------------------------------------------------------------------
function logChat(client, player, message) {
  console.log(`[CHAT] ts=${new Date().toISOString()} room=${client.roomCode} acct=${client.accountId || '-'} ip=${client.ip} name=${JSON.stringify(player.name)} msg=${JSON.stringify(message)}`);
  if (db.isEnabled()) {
    chatLogQueue.push({
      account_id: client.accountId || null,
      name: player.name,
      room_code: client.roomCode,
      message,
      ip: client.ip,
      ts: new Date()
    });
    if (chatLogQueue.length > 5000) chatLogQueue.splice(0, chatLogQueue.length - 5000);
  }
}

async function flushChatLogs() {
  if (!db.isEnabled() || chatLogQueue.length === 0) return;
  const batch = chatLogQueue.splice(0, chatLogQueue.length);
  try {
    await db.insertChatLogs(batch);
  } catch (e) {
    console.error('[chat] flush failed:', e.message);
    // re-queue (bounded)
    chatLogQueue.unshift(...batch.slice(-2000));
  }
}

// ---------------------------------------------------------------------------
// Sanitizers (preserved)
// ---------------------------------------------------------------------------
function sanitizeVector(value, fallback) {
  if (!value || typeof value !== 'object') return fallback;
  return {
    x: clampNumber(value.x, -100000, 100000),
    y: clampNumber(value.y, -100000, 100000),
    z: clampNumber(value.z, -100000, 100000)
  };
}

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(min, Math.min(max, num));
}

function distanceBetweenVectors(a, b) {
  if (!a || !b) return Infinity;
  const dx = Number(a.x || 0) - Number(b.x || 0);
  const dy = Number(a.y || 0) - Number(b.y || 0);
  const dz = Number(a.z || 0) - Number(b.z || 0);
  return Math.hypot(dx, dy, dz);
}

function distanceFromSegment(point, start, end) {
  if (!point || !start || !end) return Infinity;
  const segment = subVec(end, start);
  const lengthSq = dot(segment, segment);
  if (lengthSq <= 1e-9) return distanceBetweenVectors(point, start);
  const offset = subVec(point, start);
  const t = Math.max(0, Math.min(1, dot(offset, segment) / lengthSq));
  return distanceBetweenVectors(point, {
    x: start.x + segment.x * t,
    y: start.y + segment.y * t,
    z: start.z + segment.z * t
  });
}

function sanitizeName(value, fallback) {
  const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 20);
  return name || fallback || 'Player';
}

function sanitizeChatMessage(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

function sanitizeRoomSettings(value, fallback = DEFAULT_ROOM_SETTINGS) {
  const source = value && typeof value === 'object' ? value : {};
  const base = fallback && typeof fallback === 'object' ? fallback : DEFAULT_ROOM_SETTINGS;
  const mapId = VALID_MAP_IDS.has(source.mapId) ? source.mapId : (VALID_MAP_IDS.has(base.mapId) ? base.mapId : MAP_DUST2);
  let gamemode = source.gamemode === 'casual' ? 'deathmatch' : (VALID_GAMEMODES.has(source.gamemode) ? source.gamemode : (VALID_GAMEMODES.has(base.gamemode) ? base.gamemode : 'gunGame'));
  let nextGamemode = VALID_GAMEMODES.has(source.nextGamemode) ? source.nextGamemode : null;
  if (source.nextGamemode === 'casual') nextGamemode = null;
  const forcedFullMap = FULL_MAP_ONLY_IDS.has(mapId) || !!MODE_CONFIG[gamemode]?.fullMap;
  return {
    fullMap: forcedFullMap || Boolean(source.fullMap ?? base.fullMap),
    gamemode,
    mapId,
    private: Boolean(source.private ?? base.private),
    nextGamemode: nextGamemode === gamemode ? null : nextGamemode,
    roundEndsAt: Number.isFinite(Number(source.roundEndsAt ?? base.roundEndsAt)) ? Number(source.roundEndsAt ?? base.roundEndsAt) : null,
    // Containment host options. Clamped at the boundary so nothing downstream
    // has to decide whether a lobby setting can be trusted.
    containmentEndless: Boolean(source.containmentEndless ?? base.containmentEndless ?? true),
    containmentWaveLimit: Math.max(0, Math.min(100, Math.floor(Number(source.containmentWaveLimit ?? base.containmentWaveLimit) || 0))),
    containmentStartWave: Math.max(0, Math.min(50, Math.floor(Number(source.containmentStartWave ?? base.containmentStartWave) || 0))),
    // How much a bigger team is asked to carry. 1 keeps every player working as
    // hard as a solo run; 0 is the softer "more bodies, same toughness" curve.
    containmentTeamScaling: Math.max(0, Math.min(1.5, Number(source.containmentTeamScaling ?? base.containmentTeamScaling ?? 1) || 0))
  };
}

function applyRoundMapScaling(room) {
  if (!room?.settings) return false;
  const shouldFull = FULL_MAP_ONLY_IDS.has(getRoomMapId(room)) || !!MODE_CONFIG[room.settings.gamemode]?.fullMap || room.players.size > 7;
  if (room.settings.fullMap === shouldFull) return false;
  room.settings = sanitizeRoomSettings({ ...room.settings, fullMap: shouldFull }, room.settings);
  return true;
}

function isValidName(value) {
  const name = sanitizeName(value, '');
  return name.length >= 2 && name.length <= 20;
}

function normalizeName(value) {
  return sanitizeName(value, '').toLowerCase();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async () => {
  if (process.env.NODE_ENV === 'production') {
    const missing = [];
    if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
    if (!process.env.ADMIN_TOKEN) missing.push('ADMIN_TOKEN');
    if (!process.env.DEVICE_SECRET) missing.push('DEVICE_SECRET');
    if (missing.length) {
      console.error('Missing required environment variables: ' + missing.join(', '));
      process.exit(1);
    }
  }

  const mailStatus = mailer.providerStatus();
  if (mailStatus.configured) {
    console.log(`[mail] ${mailStatus.provider} ready: ${mailStatus.from}`);
  } else {
    console.warn(`[mail] not configured: ${mailStatus.reason}`);
  }

  // Parse one map at a time to keep startup memory predictable on the small
  // production instance; each finished collision remains available by map id.
  for (const [mapId, source] of MAP_COLLISION_PATHS.entries()) {
    try {
      const collision = await loadMapCollision(source.path, source.scale);
      mapCollisions.set(mapId, collision);
      console.log(`[ac] ${mapId} collision ready: ${collision.triCount} tris`, collision.bounds);
    } catch (e) {
      console.error(`[ac] ${mapId} map load failed — its ground/LOS checks are disabled:`, e.message);
    }
  }

  if (db.isEnabled()) {
    try {
      await db.initDb();
      bans.startRefreshLoop(30000);
    } catch (e) {
      console.error('[db] init failed:', e.message);
      if (process.env.NODE_ENV === 'production') process.exit(1);
    }
  } else {
    console.warn('[db] DATABASE_URL not set — accounts/persistence disabled. Set DATABASE_URL to enable play.');
  }

  bans.setAutoBanHandler((accountId) => kickAccountSessions(accountId, 'banned'));

  // Wrap every periodic callback: a bare setInterval body that throws is an
  // uncaughtException, which (on a single replica) drops all players at once.
  const safeInterval = (label, fn, ms) => setInterval(() => {
    try { fn(); } catch (e) { console.error('[' + label + ']', e && e.message ? e.message : e); }
  }, ms);
  safeInterval('snapshotTick', snapshotTick, SNAPSHOT_MS);
  safeInterval('containmentTick', containmentTick, CONTAINMENT_TICK_MS);
  safeInterval('containmentEnemyTick', containmentEnemyTick, CONTAINMENT_ENEMY_MS);
  safeInterval('flushAllStats', flushAllStats, 60000);
  safeInterval('flushChatLogs', flushChatLogs, 2000);
  safeInterval('marketAuctionSettlement', () => { settleAndNotifyMarketAuctions().catch(error => console.error('[market-auction-settlement]', error.message)); }, 3000);
  safeInterval('sweepRetention', () => { if (db.isEnabled()) db.sweepRetention(CHAT_RETENTION).catch(() => {}); }, 6 * 3600 * 1000);

  server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
})();
