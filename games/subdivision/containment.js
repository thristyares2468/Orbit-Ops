'use strict';

// Containment - co-operative wave survival.
//
// WHY THIS IS A SEPARATE MODULE
//   server.js is 8,000 lines and already carries every PvP mode. Containment is
//   a large system with its own state machine, economy and enemy simulation, and
//   folding it in there would make both harder to reason about. Everything here
//   is pure: no sockets, no database, no timers, no imports. Time is passed in.
//   That is what makes the wave director, the scaling curves and the economy
//   testable without standing up a server, which matters because these are the
//   parts where a quiet arithmetic mistake turns into an exploit.
//
// WHAT LIVES HERE vs IN server.js
//   Here:      wave state, scaling, spawn selection, enemy stepping, economy.
//   server.js: sockets, room wiring, the authoritative damage path, persistence.
//
// AUTHORITY
//   Every function that grants something - currency, a wave advance, a purchase -
//   takes the state it is allowed to read and returns a decision. None of them
//   trust a number that came from a client. The caller is responsible for never
//   passing client-supplied damage, price or reward values straight through.

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

// The order matters: `waiting` is pre-match, `defeat` and `extracted` are
// terminal. Everything else cycles.
const PHASES = Object.freeze({
  WAITING: 'waiting',
  PREPARATION: 'preparation',
  ACTIVE: 'active',
  CLEARED: 'cleared',
  EXTRACTION: 'extraction',
  DEFEAT: 'defeat',
  EXTRACTED: 'extracted'
});

const TERMINAL_PHASES = Object.freeze(new Set([PHASES.DEFEAT, PHASES.EXTRACTED]));

// Tuning lives in one frozen object so a host setting can override a copy of it
// without any function reaching for a module-level constant.
const DEFAULT_TUNING = Object.freeze({
  // Wave pacing.
  preparationMs: 20_000,
  firstPreparationMs: 30_000,   // a moment longer before the first wave
  clearedMs: 4_000,             // the beat between the last kill and preparation

  // Enemy budget. Deliberately gentle early: wave 1 should read as a warm-up,
  // not a scramble. The growth is quadratic-ish so the curve bites by wave 10.
  baseCount: 6,
  countPerWave: 2.2,
  countPerWaveSquared: 0.16,
  countPerExtraPlayer: 0.55,    // a share of the base per additional player

  // How hard a full team has it, relative to a solo player.
  //
  // Counting bodies alone does not even out. Four players bring four times the
  // damage but, at 0.55 a head, only 2.65x the enemies - so a full lobby was
  // about a third easier per person than playing alone, and the mode got easier
  // the more people joined. The health multiplier below is derived so that
  //
  //     countMultiplier * healthMultiplier = players ^ teamScaling
  //
  // which at 1 makes the total enemy health pool rise in step with the number of
  // guns pointed at it. 0 restores the old behaviour (more bodies, softer each);
  // anything between is a difficulty dial a host can move.
  //
  // Split between count and health on purpose. Four times the bodies would hit
  // the concurrency cap and quadruple both the simulation and the snapshot, and
  // a screen with that many enemies stops being readable. Raising health for
  // some of it keeps the pool honest at a fraction of the cost.
  teamScaling: 1,
  maxConcurrent: 26,            // alive at once; the rest queue behind them
  maxCount: 180,                // absolute per-wave ceiling

  // Enemy stats. Health compounds; speed and damage are capped so a late wave is
  // dense rather than impossible.
  baseHealth: 100,
  healthGrowth: 1.11,
  healthLinear: 12,
  maxHealth: 4_000,
  // Players walk at 35 u/s and sprint at 75 u/s. The old 3.15 u/s horde
  // barely moved on these full-scale maps; this keeps early zombies kiteable
  // while making later waves an actual pursuit.
  baseSpeed: 20,
  speedPerWave: 0.65,
  maxSpeed: 42,
  baseDamage: 12,
  damagePerWave: 0.8,
  maxDamage: 38,
  attackCooldownMs: 1100,
  attackRange: 1.75,

  // Economy. Kept small per kill so the interesting decision is when to spend,
  // not whether you can afford everything at once.
  killReward: 60,
  headshotBonus: 30,
  assistReward: 20,
  reviveReward: 120,
  repairReward: 15,
  waveClearReward: ateWaveClearReward(),
  startingCredits: 500,
  creditCap: 500_000,

  // Spawning.
  minSpawnDistance: 12,         // never materialise closer than this to a player
  preferOutOfSightDistance: 8,  // a visible spawn must be at least this far
  spawnIntervalMs: 700,
  bossEveryWaves: 8
});

// A small helper so the wave-clear reward is a function of the wave rather than
// a flat number, without making the tuning object hold a closure.
function ateWaveClearReward() {
  return 250;
}

// ---------------------------------------------------------------------------
// Scaling
// ---------------------------------------------------------------------------

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function toWave(wave) {
  const n = Math.floor(Number(wave) || 0);
  return n < 1 ? 1 : n;
}

function toPlayerCount(players) {
  const n = Math.floor(Number(players) || 0);
  return clamp(n, 1, 4);
}

// How many enemies a wave is worth, how tough each one is, and how fast they
// come. Pure arithmetic on (wave, players) so a test can walk the whole curve.
function waveBudget(wave, players, tuning = DEFAULT_TUNING) {
  const t = { ...DEFAULT_TUNING, ...tuning };
  const w = toWave(wave);
  const p = toPlayerCount(players);

  const raw = t.baseCount
    + t.countPerWave * (w - 1)
    + t.countPerWaveSquared * (w - 1) * (w - 1);
  // Extra players add a share of the wave, not a whole multiple of it: four
  // players should feel busier than one, not four times as long.
  const countMultiplier = 1 + t.countPerExtraPlayer * (p - 1);
  const scaling = clamp(Number(t.teamScaling) || 0, 0, 2);
  const targetPool = Math.pow(p, scaling);
  const teamHealthFactor = Math.max(1, targetPool / countMultiplier);

  // The ceilings are per-solo-player limits: they exist to keep one screen
  // readable and one simulation cheap. A four-player run can legitimately carry
  // more of both, so each is scaled by the same factor as the thing it caps.
  // Left fixed, they bind somewhere past wave 25 and the mode silently gets
  // easier the deeper a full team goes - exactly backwards.
  const countCeiling = Math.round(t.maxCount * countMultiplier);
  const healthCeiling = Math.round(t.maxHealth * teamHealthFactor);

  const desiredCount = Math.round(raw * countMultiplier);
  const count = clamp(desiredCount, 1, countCeiling);

  // Once the count ceiling does bind, the bodies stop arriving but the guns do
  // not. Whatever the cap swallowed is handed to health instead, so the pool
  // keeps rising after the count flattens.
  const capShortfall = count > 0 ? desiredCount / count : 1;
  const healthMultiplier = Math.max(1, teamHealthFactor * capShortfall);

  const health = clamp(
    Math.round(
      (t.baseHealth * Math.pow(t.healthGrowth, w - 1) + t.healthLinear * (w - 1)) * healthMultiplier
    ),
    1,
    healthCeiling
  );
  const speed = clamp(t.baseSpeed + t.speedPerWave * (w - 1), 0.1, t.maxSpeed);
  const damage = clamp(Math.round(t.baseDamage + t.damagePerWave * (w - 1)), 1, t.maxDamage);

  return {
    wave: w,
    players: p,
    count,
    concurrent: Math.min(count, t.maxConcurrent),
    health,
    speed: Math.round(speed * 1000) / 1000,
    damage,
    boss: w % t.bossEveryWaves === 0,
    spawnIntervalMs: Math.max(120, Math.round(t.spawnIntervalMs - (w - 1) * 18))
  };
}

// ---------------------------------------------------------------------------
// Match state
// ---------------------------------------------------------------------------

function createMatch(options = {}) {
  const tuning = { ...DEFAULT_TUNING, ...(options.tuning || {}) };
  return {
    phase: PHASES.WAITING,
    wave: Math.max(0, Math.floor(Number(options.startingWave) || 0)),
    phaseEndsAt: 0,
    endless: options.endless !== false,
    waveLimit: Math.max(0, Math.floor(Number(options.waveLimit) || 0)),
    tuning,
    // Enemies still to be released this wave, and the ones alive right now.
    pending: 0,
    enemies: new Map(),
    nextEnemyId: 1,
    lastSpawnAt: 0,
    // Per-player credit purses, keyed by player id. Match-local and never
    // written to the account: this currency must not touch the PvP economy.
    credits: new Map(),
    // Server-authored sector gates. They are match-local just like credits:
    // opening one affects this run only and is never persisted to an account.
    gates: new Map(),
    // One vote per eligible, living player during preparation. This is match
    // state rather than a client-side countdown shortcut, so every player sees
    // the same threshold and a forged vote cannot advance a wave by itself.
    preparationVotes: new Set(),
    // An admin hold on the wave director, used to walk a map without a horde
    // (see tools/gate-mapper.html for the offline equivalent). It suppresses
    // new spawns only - enemies already on the map keep simulating, so pausing
    // is never a way to freeze an inconvenient wave mid-fight.
    spawnPaused: false,
    stats: { kills: 0, headshots: 0, revives: 0, wavesCleared: 0 },
    startedAt: Number(options.now) || 0
  };
}

// Registering a player is the only way the starting purse is created. Keeping
// it here avoids a server reconnect accidentally granting the starting amount
// twice and keeps all writes to the Containment purse inside this module.
function registerPlayer(match, playerId) {
  const id = String(playerId || '');
  if (!id) return 0;
  if (!match.credits.has(id)) {
    match.credits.set(id, clamp(Math.floor(Number(match.tuning.startingCredits) || 0), 0, match.tuning.creditCap));
  }
  return credits(match, id);
}

function restorePlayer(match, playerId, savedCredits) {
  const id = String(playerId || '');
  if (!id) return 0;
  const value = clamp(Math.floor(Number(savedCredits) || 0), 0, match.tuning.creditCap);
  match.credits.set(id, value);
  return value;
}

function configureGates(match, definitions = []) {
  if (!(match.gates instanceof Map)) match.gates = new Map();
  if (match.gates.size) return match.gates;
  for (const row of Array.isArray(definitions) ? definitions : []) {
    const id = String(row?.id || '');
    const price = Math.max(0, Math.floor(Number(row?.price) || 0));
    if (!id || !Number.isFinite(Number(row?.x)) || !Number.isFinite(Number(row?.z))) continue;
    const unbuyable = row.unbuyable === true;
    match.gates.set(id, {
      id,
      label: String(row?.label || 'Sector gate').slice(0, 48),
      section: String(row?.section || row?.label || 'Sector').slice(0, 48),
      x: Number(row.x), y: Number(row.y) || 0, z: Number(row.z),
      yaw: Number(row.yaw) || 0,
      width: clamp(Number(row.width) || 14, 6, unbuyable ? 160 : 80),
      depth: clamp(Number(row.depth) || 5, 2, 14),
      height: clamp(Number(row.height) || 24, 8, 40),
      price,
      hidden: row.hidden === true,
      unbuyable,
      open: row.open === true
    });
  }
  return match.gates;
}

function publicGates(match) {
  return Array.from(match?.gates?.values?.() || []).map((gate) => ({ ...gate }));
}

function openGate(match, playerId, gateId) {
  const gate = match?.gates?.get?.(String(gateId || ''));
  if (!gate) return { ok: false, reason: 'unknown' };
  if (gate.unbuyable) return { ok: false, reason: 'sealed', gate };
  if (gate.open) return { ok: false, reason: 'open', gate };
  const decision = purchase(match, playerId, `gate:${gate.id}`, gate.price);
  if (!decision.ok) return { ...decision, gate };
  gate.open = true;
  return { ...decision, gate };
}

// Begin the run. Separate from createMatch so a lobby can sit in `waiting` with
// a configured match before anyone has spawned.
function beginMatch(match, now) {
  if (match.phase !== PHASES.WAITING) return match;
  match.preparationVotes.clear();
  match.phase = PHASES.PREPARATION;
  match.phaseEndsAt = now + match.tuning.firstPreparationMs;
  match.startedAt = now;
  return match;
}

// The wave director. Called every tick with the current clock and the live
// player picture; returns the events the caller should act on.
//
// It never reads a clock itself and never mutates players - the caller owns
// both, so the same function drives a real match and a test at whatever speed.
function step(match, now, context = {}) {
  const events = [];
  if (TERMINAL_PHASES.has(match.phase)) return events;

  const alivePlayers = Math.max(0, Math.floor(Number(context.alivePlayers) || 0));
  const totalPlayers = Math.max(alivePlayers, Math.floor(Number(context.totalPlayers) || 0));

  // A team wipe ends the run from any non-terminal phase. Checked first so no
  // other transition can fire on the tick the last player goes down.
  if (totalPlayers > 0 && alivePlayers === 0 && match.phase !== PHASES.WAITING) {
    match.phase = PHASES.DEFEAT;
    match.phaseEndsAt = now;
    events.push({ type: 'defeat', wave: match.wave });
    return events;
  }

  switch (match.phase) {
    case PHASES.PREPARATION: {
      if (now < match.phaseEndsAt) break;
      // Held rather than skipped: the countdown has already expired, so
      // clearing the pause starts the wave on the very next tick.
      if (match.spawnPaused) break;
      match.preparationVotes.clear();
      match.wave = toWave(match.wave + 1);
      const budget = waveBudget(match.wave, totalPlayers || 1, match.tuning);
      match.pending = budget.count;
      match.lastSpawnAt = 0;
      match.phase = PHASES.ACTIVE;
      match.phaseEndsAt = 0;
      events.push({ type: 'waveStarted', wave: match.wave, budget });
      break;
    }

    case PHASES.ACTIVE: {
      // Release queued enemies up to the concurrent cap, paced by the interval.
      const budget = waveBudget(match.wave, totalPlayers || 1, match.tuning);
      if (match.pending > 0
        && !match.spawnPaused
        && match.enemies.size < budget.concurrent
        && now - match.lastSpawnAt >= budget.spawnIntervalMs) {
        match.lastSpawnAt = now;
        events.push({ type: 'spawnDue', wave: match.wave, budget });
      }
      if (match.pending === 0 && match.enemies.size === 0) {
        match.phase = PHASES.CLEARED;
        match.phaseEndsAt = now + match.tuning.clearedMs;
        match.stats.wavesCleared += 1;
        events.push({ type: 'waveCleared', wave: match.wave, reward: match.tuning.waveClearReward });
      }
      break;
    }

    case PHASES.CLEARED: {
      if (now < match.phaseEndsAt) break;
      // A finite run hands over to extraction rather than just stopping.
      if (!match.endless && match.waveLimit > 0 && match.wave >= match.waveLimit) {
        match.phase = PHASES.EXTRACTION;
        match.phaseEndsAt = now;
        events.push({ type: 'extractionOpen', wave: match.wave });
        break;
      }
      match.phase = PHASES.PREPARATION;
      match.preparationVotes.clear();
      match.phaseEndsAt = now + match.tuning.preparationMs;
      events.push({ type: 'preparation', wave: match.wave + 1, endsAt: match.phaseEndsAt });
      break;
    }

    default:
      break;
  }
  return events;
}

function normalizedEligibleIds(eligiblePlayerIds) {
  return [...new Set((Array.isArray(eligiblePlayerIds) ? eligiblePlayerIds : [])
    .map(id => String(id || ''))
    .filter(Boolean))];
}

function preparationVoteState(match, eligiblePlayerIds, playerId) {
  const eligible = normalizedEligibleIds(eligiblePlayerIds);
  const eligibleSet = new Set(eligible);
  const votes = Array.from(match?.preparationVotes || []).filter(id => eligibleSet.has(id));
  const id = String(playerId || '');
  return {
    available: match?.phase === PHASES.PREPARATION && eligible.length > 0,
    votes: votes.length,
    required: eligible.length ? Math.floor(eligible.length / 2) + 1 : 0,
    eligible: eligible.length,
    voted: votes.includes(id)
  };
}

// A successful vote only makes the existing preparation phase expire now. The
// normal director tick still starts the wave and emits its usual event, so
// there is no parallel, socket-driven wave-start code path to keep in sync.
// The admin hold. Returns whether it changed, so the caller can skip a
// broadcast when a second click repeats the state already in flight.
function setSpawnPaused(match, paused) {
  if (!match) return { ok: false, changed: false, spawnPaused: false };
  const next = paused === true;
  const changed = !!match.spawnPaused !== next;
  match.spawnPaused = next;
  return { ok: true, changed, spawnPaused: next };
}

function voteToSkipPreparation(match, playerId, eligiblePlayerIds, now) {
  const id = String(playerId || '');
  const state = preparationVoteState(match, eligiblePlayerIds, id);
  if (!state.available || !id) return { ok: false, reason: 'unavailable', ...state };
  if (!normalizedEligibleIds(eligiblePlayerIds).includes(id)) return { ok: false, reason: 'ineligible', ...state };
  if (state.voted) return { ok: false, reason: 'already-voted', ...state };
  match.preparationVotes.add(id);
  const next = preparationVoteState(match, eligiblePlayerIds, id);
  const skipped = next.votes >= next.required;
  if (skipped) match.phaseEndsAt = Math.min(Number(match.phaseEndsAt) || now, now);
  return { ok: true, skipped, ...next };
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function createEnemy(match, budget, spawn, now) {
  const id = `z${match.nextEnemyId++}`;
  const serial = match.nextEnemyId - 1;
  const enemy = {
    id,
    kind: budget.boss ? 'heavy' : 'walker',
    x: spawn.x, y: spawn.y, z: spawn.z,
    health: budget.boss ? budget.health * 6 : budget.health,
    maxHealth: budget.boss ? budget.health * 6 : budget.health,
    speed: budget.boss ? budget.speed * 0.72 : budget.speed,
    damage: budget.boss ? Math.round(budget.damage * 1.8) : budget.damage,
    targetId: null,
    lastAttackAt: 0,
    spawnedAt: now,
    // Small deterministic differences stop a whole wave occupying one exact
    // line while keeping movement server-authoritative and reproducible.
    movementScale: 0.92 + ((serial * 37) % 17) / 100,
    steeringPhase: ((serial * 2.399963229728653) % (Math.PI * 2)),
    navPath: [],
    navTargetId: null,
    navTargetX: null,
    navTargetZ: null,
    navPlannedAt: 0,
    // Set when the enemy has not moved for a while; the caller uses it to
    // teleport a stuck enemy back to a spawn rather than leaving it wedged.
    stuckSince: 0,
    lastX: spawn.x, lastZ: spawn.z
  };
  match.enemies.set(id, enemy);
  if (match.pending > 0) match.pending -= 1;
  return enemy;
}

// Spread the horde. Every enemy chasing the closest player turns a four-player
// match into one player being eaten while three watch, so a player already
// carrying their share is skipped unless nobody else is reachable.
function chooseTarget(enemy, players, options = {}) {
  const list = Array.isArray(players) ? players.filter((p) => p && p.alive !== false) : [];
  if (!list.length) return null;

  const counts = options.assignments instanceof Map ? options.assignments : new Map();
  const share = Math.max(1, Math.ceil(list.length ? (options.enemyCount || list.length) / list.length : 1));

  let best = null;
  let bestScore = Infinity;
  for (const player of list) {
    const dx = player.x - enemy.x;
    const dz = player.z - enemy.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const load = counts.get(player.id) || 0;
    // Distance decides, but an over-subscribed player is pushed down the list.
    const score = distance + Math.max(0, load - share) * 14;
    if (score < bestScore) {
      bestScore = score;
      best = player;
    }
  }
  return best ? best.id : null;
}

// One enemy, one tick. Returns what happened so the caller can apply damage
// through the same authoritative path a player bullet uses.
function stepEnemy(enemy, target, deltaSeconds, now, tuning = DEFAULT_TUNING) {
  const t = { ...DEFAULT_TUNING, ...tuning };
  if (!target) return { moved: false, attacked: false };

  const dx = target.x - enemy.x;
  const dz = target.z - enemy.z;
  const distance = Math.sqrt(dx * dx + dz * dz);

  if (distance <= t.attackRange) {
    if (now - enemy.lastAttackAt >= t.attackCooldownMs) {
      enemy.lastAttackAt = now;
      return { moved: false, attacked: true, damage: enemy.damage, targetId: target.id };
    }
    return { moved: false, attacked: false };
  }

  const stride = enemy.speed * (Number(enemy.movementScale) || 1) * Math.max(0, deltaSeconds);
  if (stride <= 0 || distance <= 0) return { moved: false, attacked: false };
  const ratio = Math.min(1, stride / distance);
  enemy.x += dx * ratio;
  enemy.z += dz * ratio;

  // Stuck detection: geometry the caller refuses to let us through shows up as
  // position barely changing while a target is still far away.
  const drift = Math.hypot(enemy.x - enemy.lastX, enemy.z - enemy.lastZ);
  if (drift < stride * 0.25) {
    if (!enemy.stuckSince) enemy.stuckSince = now;
  } else {
    enemy.stuckSince = 0;
  }
  enemy.lastX = enemy.x;
  enemy.lastZ = enemy.z;

  return { moved: true, attacked: false, distance };
}

// A compact grid A* used by the authoritative server when a wall blocks the
// straight chase. The map-specific collision and ground queries are injected,
// keeping this module pure and making the planner independently testable.
function findPath(start, goal, options = {}) {
  if (!start || !goal) return [];
  const gridSize = clamp(Number(options.gridSize) || 10, 4, 32);
  const maxVisited = clamp(Math.floor(Number(options.maxVisited) || 1200), 32, 5000);
  const directDistance = Math.hypot(goal.x - start.x, goal.z - start.z);
  const maxDistance = Math.max(gridSize * 8, Number(options.maxDistance) || directDistance + gridSize * 14);
  const resolvePoint = typeof options.resolvePoint === 'function'
    ? options.resolvePoint
    : (x, z, from) => ({ x, y: Number(from?.y) || Number(start.y) || 0, z });
  const isBlocked = typeof options.isBlocked === 'function' ? options.isBlocked : () => false;

  const resolvedGoal = resolvePoint(Number(goal.x), Number(goal.z), start) || goal;
  if (!isBlocked(start, resolvedGoal)) return [{ ...resolvedGoal }];

  const keyOf = (ix, iz) => `${ix}:${iz}`;
  const nodes = new Map();
  const closed = new Set();
  const open = [];
  const startNode = {
    ix: 0, iz: 0, x: Number(start.x), y: Number(start.y) || 0, z: Number(start.z),
    g: 0, f: directDistance, parent: null
  };
  nodes.set(keyOf(0, 0), startNode);
  open.push(startNode);
  const directions = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]
  ];
  let reached = null;
  let visited = 0;

  while (open.length && visited < maxVisited) {
    let bestIndex = 0;
    for (let i = 1; i < open.length; i += 1) if (open[i].f < open[bestIndex].f) bestIndex = i;
    const current = open.splice(bestIndex, 1)[0];
    const currentKey = keyOf(current.ix, current.iz);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    visited += 1;

    if (Math.hypot(resolvedGoal.x - current.x, resolvedGoal.z - current.z) <= gridSize * 1.6
      && !isBlocked(current, resolvedGoal)) {
      reached = { ...resolvedGoal, parent: current };
      break;
    }

    for (const [dx, dz, stepCost] of directions) {
      const ix = current.ix + dx;
      const iz = current.iz + dz;
      if (Math.hypot(ix * gridSize, iz * gridSize) > maxDistance) continue;
      const key = keyOf(ix, iz);
      if (closed.has(key)) continue;
      const point = resolvePoint(start.x + ix * gridSize, start.z + iz * gridSize, current);
      if (!point || isBlocked(current, point)) continue;
      const verticalCost = Math.abs((Number(point.y) || 0) - current.y) * 0.35;
      const g = current.g + stepCost * gridSize + verticalCost;
      const previous = nodes.get(key);
      if (previous && previous.g <= g) continue;
      const node = {
        ix, iz, x: Number(point.x), y: Number(point.y) || 0, z: Number(point.z),
        g,
        f: g + Math.hypot(resolvedGoal.x - point.x, resolvedGoal.z - point.z),
        parent: current
      };
      nodes.set(key, node);
      open.push(node);
    }
  }

  if (!reached) return [];
  const reversed = [];
  for (let node = reached; node?.parent; node = node.parent) reversed.push({ x: node.x, y: node.y, z: node.z });
  reversed.reverse();

  // Visibility simplification removes grid zig-zags and gives the shortest
  // collision-safe set of waypoints the sampled route can support.
  const simplified = [];
  let anchor = start;
  for (let index = 0; index < reversed.length;) {
    let furthest = index;
    for (let candidate = reversed.length - 1; candidate > index; candidate -= 1) {
      if (!isBlocked(anchor, reversed[candidate])) { furthest = candidate; break; }
    }
    simplified.push(reversed[furthest]);
    anchor = reversed[furthest];
    index = furthest + 1;
  }
  return simplified;
}

// Damage is applied here so health can never go negative or be revived by a
// second hit landing on an already-dead enemy.
function damageEnemy(match, enemyId, amount, options = {}) {
  const enemy = match.enemies.get(String(enemyId));
  if (!enemy || enemy.health <= 0) return null;
  const headshot = options.headshot === true;
  const raw = Math.max(0, Math.floor(Number(amount) || 0));
  if (raw <= 0) return null;
  const dealt = headshot ? Math.round(raw * 2) : raw;
  const applied = Math.min(enemy.health, dealt);
  enemy.health -= applied;

  const killed = enemy.health <= 0;
  if (killed) match.enemies.delete(enemy.id);
  return { enemy, applied, killed, headshot, overkill: dealt - applied };
}

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

// Match-local credits. Never persisted, never converted, never touched by the
// account balance - Containment must not be a way to farm the PvP economy.
function credits(match, playerId) {
  return match.credits.get(String(playerId)) || 0;
}

function grant(match, playerId, amount) {
  const id = String(playerId);
  const value = Math.floor(Number(amount) || 0);
  if (!id || value <= 0) return credits(match, id);
  const next = clamp(credits(match, id) + value, 0, match.tuning.creditCap);
  match.credits.set(id, next);
  return next;
}

// What an event is worth. A single table so a reward can never be invented at
// the call site, and so the numbers can be walked in a test.
function rewardFor(event, match, options = {}) {
  const t = match?.tuning || DEFAULT_TUNING;
  switch (event) {
    case 'kill': return t.killReward + (options.headshot ? t.headshotBonus : 0);
    case 'assist': return t.assistReward;
    case 'revive': return t.reviveReward;
    case 'repair': return t.repairReward;
    case 'waveClear': return t.waveClearReward;
    default: return 0;
  }
}

// A purchase. Returns a decision rather than performing it, and refuses on any
// doubt: unknown item, bad price, insufficient funds. The caller passes the
// server's own price - never one that arrived in a packet.
function purchase(match, playerId, item, price) {
  // Validate BEFORE any `|| 0` fallback. `Number(NaN) || 0` is 0, so coercing
  // first would turn an unparseable price into a free purchase - which is
  // exactly the shape of exploit this function exists to prevent.
  const raw = Number(price);
  if (!item || !Number.isFinite(raw)) return { ok: false, reason: 'invalid' };
  const cost = Math.floor(raw);
  if (cost < 0) return { ok: false, reason: 'invalid' };
  const held = credits(match, playerId);
  if (held < cost) return { ok: false, reason: 'insufficient', held, cost };
  const remaining = held - cost;
  match.credits.set(String(playerId), remaining);
  return { ok: true, item, cost, remaining };
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

// Pick where an enemy comes from.
//
// Two rules, in order: never inside the minimum distance, and prefer somewhere
// nobody is looking. `isVisible` is injected so the caller can use the real
// map's line-of-sight check without this module knowing anything about geometry.
function pickSpawn(points, players, options = {}) {
  const t = { ...DEFAULT_TUNING, ...(options.tuning || {}) };
  const list = Array.isArray(points) ? points.filter(Boolean) : [];
  if (!list.length) return null;
  const live = Array.isArray(players) ? players.filter((p) => p && p.alive !== false) : [];
  if (!live.length) return list[0];

  const isVisible = typeof options.isVisible === 'function' ? options.isVisible : () => false;
  let fallback = null;
  let fallbackDistance = -Infinity;
  const candidates = [];

  for (const point of list) {
    let nearest = Infinity;
    for (const player of live) {
      const distance = Math.hypot(point.x - player.x, point.z - player.z);
      if (distance < nearest) nearest = distance;
    }
    // The furthest point is kept aside: if every candidate is too close, a
    // spawn still has to happen somewhere, and far is the least bad option.
    if (nearest > fallbackDistance) { fallbackDistance = nearest; fallback = point; }
    if (nearest < t.minSpawnDistance) continue;

    const seen = live.some((player) => isVisible(point, player));
    // Being seen is not disqualifying, only expensive - a wave should not stall
    // because players are covering every door.
    candidates.push({ point, nearest, penalty: seen ? (nearest < t.preferOutOfSightDistance ? 1e6 : 40) : 0 });
  }

  if (!candidates.length) return fallback;
  candidates.sort((a, b) => (a.penalty - b.penalty) || (b.nearest - a.nearest));
  // Among the acceptable ones, vary it so enemies do not file through one door.
  const best = candidates.filter((c) => c.penalty === candidates[0].penalty);
  const index = typeof options.pick === 'function'
    ? clamp(Math.floor(options.pick(best.length)), 0, best.length - 1)
    : 0;
  return best[index].point;
}

// ---------------------------------------------------------------------------
// View for the client
// ---------------------------------------------------------------------------

// What the HUD needs, and nothing more. Enemy positions travel in the snapshot
// lane, not here, so this stays cheap enough to send on every phase change.
function hudState(match, playerId) {
  return {
    phase: match.phase,
    wave: match.wave,
    remaining: match.pending + match.enemies.size,
    alive: match.enemies.size,
    credits: credits(match, playerId),
    phaseEndsAt: match.phaseEndsAt,
    endless: match.endless,
    waveLimit: match.waveLimit,
    spawnPaused: !!match.spawnPaused,
    stats: { ...match.stats }
  };
}

module.exports = {
  PHASES,
  TERMINAL_PHASES,
  DEFAULT_TUNING,
  waveBudget,
  createMatch,
  registerPlayer,
  restorePlayer,
  configureGates,
  publicGates,
  openGate,
  preparationVoteState,
  voteToSkipPreparation,
  setSpawnPaused,
  beginMatch,
  step,
  createEnemy,
  chooseTarget,
  stepEnemy,
  findPath,
  damageEnemy,
  credits,
  grant,
  rewardFor,
  purchase,
  pickSpawn,
  hudState
};
