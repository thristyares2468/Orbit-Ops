// Last updated: 17 July 2026
// ============================================================================
// core.js — shared, authoritative game constants + (Phase 1+) validation logic.
//
// ONE source of truth, consumed by BOTH runtimes with NO build step:
//   • Node server  — `const core = require('./core');`
//   • Host browser — `<script src="/core.js"></script>` then `window.GameCore`
//
// Everything in here must be runtime-agnostic: NO `require`, NO DOM, NO
// `Date.now()`/`Math.random()`/`setTimeout` in the logic that ships later — the
// host browser and the Node server reach all of that through an injected `env`
// (see Phase 1). For now this file holds only the authoritative numeric tables
// that were previously duplicated between server.js and index.html.
// ============================================================================
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod; // Node
  else root.GameCore = mod;                                                  // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Bump on any change to authoritative rules/shape so stale clients can reject
  // mismatched game data before subtle desyncs happen.
  const VERSION = '10';

  // Buy-menu prices (identical on both sides today).
  const WEAPON_PRICES = {
    'Knife': 0,
    'Glock': 200,
    'USP-S': 200,
    'P2000': 200,
    'P250': 300,
    'Five-SeveN': 500,
    'Tec-9': 500,
    'CZ75-Auto': 500,
    'Dual Berettas': 400,
    'Deagle': 700,
    'R8 Revolver': 600,
    'MAC10': 1050,
    'P90': 2350,
    'Nova': 1050,
    'XM1014': 2000,
    'FAMAS': 2050,
    'AK47': 2700,
    'SSG 08': 1700,
    'AWP': 4750,
    'Breacher': 2200,
    'Shield': 900,
    // A late-run Zombies unlock. PvP loadout modes remain free to equip, while
    // Containment charges this shared price from its run-only credits.
    'RPG': 6000,
    'Minigun': 6500
  };

  // Grenade/utility prices. Server calls this UTILITY_PRICES; the client calls the
  // identical object GRENADE_PRICES. Exposed under both names to avoid churn.
  const UTILITY_PRICES = { frag: 300, smoke: 150, flash: 200, molotov: 400, barricade: 500, c4: 600 };

  // Per-life buy caps by utility kind. Anything missing here uses the caller's
  // default (2 on both sides). The barricade is deliberately capped lower: it is
  // persistent cover, not a one-shot effect.
  const UTILITY_LIFE_CAPS = { barricade: 2, c4: 1 };

  // CT (0) / T (1) → spawn-point indexes. Must stay identical on both sides.
  const TEAM_SPAWN_IDS = { 0: [0, 1, 2, 3], 1: [4, 5, 6, 7] };
  const TEAM_FULL_MAP_SPAWN_IDS = {
    0: [0, 1, 2, 3, 12, 13, 17, 18, 22, 23, 26],
    1: [8, 9, 10, 11, 14, 15, 16, 19, 20, 21, 24, 25]
  };

  // Server-authoritative grenade damage geometry (the client's GRENADE_CONFIG
  // carries extra client-only fields like fuse/throwSpeed/color; only these
  // numbers are authoritative and re-validated server-side).
  const GRENADE = {
    frag: { radius: 125, maxDamage: 125 },
    // speed and maxLifeMs are BOTH half of one pair. The server rejects a
    // rocket whose reported speed differs from this by more than 45, so the
    // client's GRENADE_CONFIG.rpg.throwSpeed/lobSpeed has to match, and its
    // fuse has to match maxLifeMs or the two ends disagree about when the
    // rocket dies. maxLifeMs is set to keep the old ~2180-unit reach at the
    // slower speed rather than shortening the weapon's range as a side effect.
    rpg: { radius: 145, maxDamage: 180, selfScale: 0.65, speed: 430, maxLifeMs: 5000 },
    smoke: { radius: 38, durationMs: 18000 },
    molotov: { radius: 82, dps: 34, tickMs: 350, durationMs: 8500 }
  };

  // Deployable barricade (Rainbow Six-style gadget). Placed on flat ground in
  // front of the player, it is solid cover that blocks movement and bullets
  // until its health runs out. Geometry is authoritative so the server can
  // validate placements and the client can render an identical panel.
  const BARRICADE = {
    width: 18.2,      // panel span, left-to-right of the placing player
    height: 16.9,     // just under standing eye height: lean out or crouch behind
    thickness: 1.82,
    health: 600,
    deployDistance: 10, // where the panel lands: straight ahead, this far out
    deployRange: 26,  // furthest the anchor point may sit from the player's eye
    minRange: 7,      // closest, so a player can never encase themselves
    spacing: 11,      // minimum distance between two deployed barricades
    maxPerRoom: 8,
    // Damage a panel takes per source. Bullets use the weapon's body damage
    // scaled by this; frag bursts apply their falloff damage scaled by this.
    bulletScale: 1,
    fragScale: 1.4
  };

  // Remote-detonated C4 charge. Deployed on the ground like the barricade, then
  // armed on a timer; only after `armDelayMs` will the detonator fire it, so the
  // thrower cannot use it as an instant grenade.
  const C4 = {
    radius: 150,
    maxDamage: 270,
    selfScale: 0.6,     // the planter takes a fraction of their own blast
    armDelayMs: 2000,
    deployDistance: 8,  // where the charge lands: straight ahead, this far out
    deployRange: 24,    // server bound on the anchor point
    minRange: 4,
    spacing: 6,         // minimum distance between two charges
    maxPerRoom: 8,
    health: 60,         // shootable: a spotted charge can be cleared
    // Collider box for the planted charge. Proportioned to the authored model
    // (which is normalised to `height`) and a little wider, so bullets aimed at
    // the visible charge always meet the box.
    width: 2.0,
    height: 3.6,
    thickness: 1.5
  };

  // Weapon index order used by the snapshot encoder (`w` field). Index 0 = Knife.
  const WEAPON_NAMES = [
    'Knife', 'Glock', 'Deagle', 'MAC10', 'P90', 'Nova', 'XM1014', 'FAMAS', 'AK47', 'SSG 08', 'AWP',
    'USP-S', 'P2000', 'P250', 'Five-SeveN', 'Tec-9', 'CZ75-Auto', 'Dual Berettas', 'R8 Revolver',
    'Frag', 'Smoke', 'Flash', 'Molotov', 'Barricade', 'C4', 'Breacher', 'Shield', 'RPG', 'Minigun'
  ];

  const SNAPSHOT_FLAGS = {
    CROUCHING: 1,
    SPAWN_PROTECTED: 2,
    JUMPING: 4,
    RELOADING: 8,
    WALKING: 16,
    SPRINTING: 32,
    SLIDING: 64
  };

  // Server-authoritative weapon table. Damage is per body part; client-supplied
  // damage is ignored entirely and recomputed from `dmg`. The client's `weapons[]`
  // array sources its per-part `armorDamage` from this table (see index.html).
  // Note: some sidearms are intentionally still present for gameplay/Casual even
  // though index.html hides them from inventory because they lack real GLB models.
  const WEAPONS = {
    'Knife':  { type: 'melee',   firerate: 0.5,   pellets: 1, range: 25,   dmg: { head: 500, body: 500, legs: 500 } },
    'Glock':  { type: 'pistol',  firerate: 0.15,  pellets: 1, range: 1000, dmg: { head: 56, body: 14, legs: 22 } },
    'Deagle': { type: 'pistol',  firerate: 0.4,   pellets: 1, range: 1000, dmg: { head: 234, body: 58, legs: 47 } },
    'USP-S':  { type: 'pistol',  firerate: 0.17,  pellets: 1, range: 1000, dmg: { head: 140, body: 35, legs: 29 } },
    'P2000':  { type: 'pistol',  firerate: 0.16,  pellets: 1, range: 1000, dmg: { head: 128, body: 32, legs: 28 } },
    'P250':   { type: 'pistol',  firerate: 0.16,  pellets: 1, range: 1000, dmg: { head: 152, body: 38, legs: 31 } },
    'Five-SeveN': { type: 'pistol', firerate: 0.15, pellets: 1, range: 1000, dmg: { head: 126, body: 31, legs: 28 } },
    'Tec-9':  { type: 'pistol',  firerate: 0.12,  pellets: 1, range: 1000, dmg: { head: 132, body: 33, legs: 28 } },
    'CZ75-Auto': { type: 'pistol', firerate: 0.085, pellets: 1, range: 1000, dmg: { head: 124, body: 31, legs: 26 } },
    'Dual Berettas': { type: 'pistol', firerate: 0.12, pellets: 1, range: 1000, mag: 24, reserve: 72, reloadTime: 3.77, dmg: { head: 84, body: 21, legs: 18 } },
    'R8 Revolver': { type: 'pistol', firerate: 0.75, pellets: 1, range: 1000, dmg: { head: 344, body: 86, legs: 70 } },
    'MAC10':  { type: 'smg',     firerate: 0.075, pellets: 1, range: 1000, dmg: { head: 66, body: 16, legs: 22 } },
    'P90':    { type: 'smg',     firerate: 0.07,  pellets: 1, range: 1000, dmg: { head: 72, body: 18, legs: 20 } },
    'Nova':   { type: 'shotgun', firerate: 0.8,   pellets: 9, range: 1000, dmg: { head: 52, body: 13, legs: 20 } },
    'XM1014': { type: 'shotgun', firerate: 0.35,  pellets: 6, range: 1000, dmg: { head: 64, body: 16, legs: 15 } },
    'FAMAS':  { type: 'rifle',   firerate: 0.1,   pellets: 1, range: 1000, dmg: { head: 84, body: 21, legs: 22 } },
    'AK47':   { type: 'rifle',   firerate: 0.1,   pellets: 1, range: 1000, dmg: { head: 111, body: 27, legs: 27 } },
    'SSG 08': { type: 'sniper',  firerate: 1.25,  pellets: 1, range: 1000, dmg: { head: 299, body: 75, legs: 66 } },
    'AWP':    { type: 'sniper',  firerate: 1.5,   pellets: 1, range: 1000, dmg: { head: 448, body: 112, legs: 86 } },
    'Frag':   { type: 'utility', firerate: 0.8,   pellets: 0, range: 0,    dmg: { head: 0, body: 0, legs: 0 } },
    'Smoke':  { type: 'utility', firerate: 0.8,   pellets: 0, range: 0,    dmg: { head: 0, body: 0, legs: 0 } },
    'Flash':  { type: 'utility', firerate: 0.8,   pellets: 0, range: 0,    dmg: { head: 0, body: 0, legs: 0 } },
    'Molotov': { type: 'utility', firerate: 0.8,  pellets: 0, range: 0,    dmg: { head: 0, body: 0, legs: 0 } },
    'Barricade': { type: 'utility', firerate: 0.8, pellets: 0, range: 0,    dmg: { head: 0, body: 0, legs: 0 } },
    'C4':      { type: 'utility', firerate: 0.8,  pellets: 0, range: 0,    dmg: { head: 0, body: 0, legs: 0 } }
  };

  // The Breacher is a shotgun that alternates between two loads: every odd
  // trigger pull is buckshot, every even one is a slug. Both tables are borrowed
  // rather than copied, so a buckshot pull is always exactly a Nova shot and a
  // slug always lands for the SSG 08's numbers, whatever those become.
  const SHOTGUN_ALT = {
    weapon: 'Breacher',
    // One pull sprays several pellets, each of which is reported as its own
    // shot. Reports this close together are the same pull; anything later is a
    // new one. Well above the pellet burst, well below the 0.85s fire rate.
    pullWindowMs: 300,
    buckshot: { pellets: WEAPONS.Nova.pellets, dmg: WEAPONS.Nova.dmg },
    slug: { pellets: 1, dmg: WEAPONS['SSG 08'].dmg }
  };
  // Handheld ballistic shield. Held instead of a gun: it cannot fire, it slows
  // the carrier down, and it soaks direct fire that arrives from the front.
  // Explosions are deliberately not blocked - utility is the counter to a shield.
  const SHIELD = {
    weapon: 'Shield',
    // Frontal cover, as the cosine of the half-angle so the server can compare it
    // straight against a dot product.
    arcCos: Math.cos((110 * Math.PI / 180) / 2),
    // A hit that the shield catches is caught outright. These were 0.85, which
    // meant 15% of every blocked round still reached the carrier - damage
    // "through the shield" from the player's side of it. The shield's cost is
    // not a leak rate, it is `capacity`: absorb 150 and the guard breaks, and
    // everything after that lands in full until the stagger ends.
    bodyBlock: 1,           // share of a blocked body/leg hit that is absorbed
    headBlock: 0,           // standing, the head sits above the shield
    crouchHeadBlock: 1,     // crouched, the carrier is behind it completely
    capacity: 150,          // absorbed damage before guard breaks
    staggerMs: 1200,        // guard-down window after capacity is exhausted
    staggerSpeedMult: 0.28,
    // The shield stays raised while its built-in Glock fires, with only a short
    // exposure window around each shot. Capacity/stagger is the main trade-off.
    fireLockoutMs: 120,
    sidearmWeapon: 'Glock',
    sidearmDamageScale: 0.85,
    sidearmFireRateScale: 1.25,
    sidearmSpreadScale: 1.35,
    sidearmMagazine: 12,
    sidearmReserve: 48,
    sidearmReloadTime: 2.5,
    // Taking the shield as your primary means giving up a long gun. The server
    // accepts damage from these types only while it is your main slot, so a
    // client cannot carry a shield loadout and fight with a rifle behind it.
    allowedWeaponTypes: ['pistol', 'melee', 'shield']
  };

  const SHIELD_GLOCK = Object.freeze({
    ...WEAPONS.Glock,
    firerate: WEAPONS.Glock.firerate * SHIELD.sidearmFireRateScale,
    dmg: Object.freeze(Object.fromEntries(Object.entries(WEAPONS.Glock.dmg)
      .map(([part, amount]) => [part, Math.max(1, Math.round(amount * SHIELD.sidearmDamageScale))])))
  });

  // Pure cover resolver shared by the live server and its regression tests.
  // `now` is injected so this remains deterministic and runtime-agnostic.
  function shieldBlockFraction(target, attackerPos, headshot, now) {
    if (!target?.position || !attackerPos) return 0;
    if (target.weapon !== SHIELD.weapon || target.loadout?.main !== SHIELD.weapon) return 0;
    if (!Number.isFinite(Number(now))) return 0;
    if (Number(target.shieldStaggeredUntil || 0) > Number(now)) return 0;
    if (Number(now) - Number(target.lastShotAt || 0) < SHIELD.fireLockoutMs) return 0;

    const dx = Number(attackerPos.x) - Number(target.position.x);
    const dz = Number(attackerPos.z) - Number(target.position.z);
    const distance = Math.hypot(dx, dz);
    if (!Number.isFinite(distance) || distance < 1e-6) return 0;

    const yaw = Number(target.rotation?.y) || 0;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const facingDot = forwardX * (dx / distance) + forwardZ * (dz / distance);
    if (facingDot < SHIELD.arcCos) return 0;
    if (headshot) return target.crouching ? SHIELD.crouchHeadBlock : SHIELD.headBlock;
    return SHIELD.bodyBlock;
  }

  // Resolve one direct hit against the guard without mutating the player. The
  // server applies the returned state, making capacity and stagger authoritative.
  function resolveShieldHit(target, attackerPos, headshot, incomingDamage, now) {
    const rawDamage = Math.max(0, Number(incomingDamage) || 0);
    const priorStaggerUntil = Number(target?.shieldStaggeredUntil || 0);
    const staggerActive = priorStaggerUntil > Number(now);
    const recoveredFromStagger = priorStaggerUntil > 0 && !staggerActive;
    const priorDamage = recoveredFromStagger
      ? 0
      : Math.max(0, Math.min(SHIELD.capacity, Number(target?.shieldDamage) || 0));
    const fraction = shieldBlockFraction(target, attackerPos, headshot, now);
    if (!fraction || !rawDamage) {
      return {
        damage: Math.round(rawDamage),
        absorbed: 0,
        shieldDamage: priorDamage,
        shieldBlocked: false,
        staggered: staggerActive,
        staggeredUntil: staggerActive ? priorStaggerUntil : 0
      };
    }

    const remaining = Math.max(0, SHIELD.capacity - priorDamage);
    const absorbed = Math.min(remaining, rawDamage * fraction);
    const shieldDamage = Math.min(SHIELD.capacity, priorDamage + absorbed);
    const staggered = shieldDamage >= SHIELD.capacity;
    return {
      damage: Math.max(0, Math.round(rawDamage - absorbed)),
      absorbed,
      shieldDamage,
      shieldBlocked: absorbed > 0,
      staggered,
      staggeredUntil: staggered ? Number(now) + SHIELD.staggerMs : 0
    };
  }
  WEAPONS.Shield = { type: 'shield', firerate: 0.5, pellets: 0, range: 0, dmg: { head: 0, body: 0, legs: 0 } };
  WEAPONS.RPG = { type: 'launcher', firerate: 1.1, pellets: 0, range: 0, dmg: { head: 0, body: 0, legs: 0 } };
  // Classic Legendary baseline: 20 damage, 12 shots/sec; requested half damage
  // and half of the 0.5 headshot bonus. Magazine-less, with a thermal lockout.
  const MINIGUN = Object.freeze({ damage: 10, headshotMultiplier: 1.25, fireInterval: 1 / 12,
    spinUp: 0.75, heatShots: 72, cooldown: 4.5, ammo: 240, speedMult: 0.64 });
  WEAPONS.Minigun = { type: 'rifle', firerate: MINIGUN.fireInterval, pellets: 1, range: 1000,
    dmg: { head: 12.5, body: 10, legs: 10 } };
  function minigunShot(state, now) {
    if (now < (state.lockedUntil || 0)) return false;
    const elapsed = Math.max(0, now - (state.lastAt ?? now));
    state.heat = Math.max(0, (state.heat || 0) - Math.max(0, elapsed - 150) * MINIGUN.heatShots / (MINIGUN.cooldown * 1000));
    state.lastAt = now;
    state.heat += 1;
    if (state.heat >= MINIGUN.heatShots) {
      state.lockedUntil = now + MINIGUN.cooldown * 1000;
      state.heat = 0;
    }
    return true;
  }

  WEAPONS.Breacher = {
    type: 'shotgun',
    firerate: 0.85,
    pellets: SHOTGUN_ALT.buckshot.pellets,
    range: 1000,
    dmg: SHOTGUN_ALT.buckshot.dmg
  };

  // ==========================================================================
  // Snapshot encoder (Phase 1). Pure: depends only on the room/player POJOs and
  // an injected `now` (ms). Mutates each player's delta-baseline (`lastSent`,
  // `dirty`) exactly as the server always has, so the host browser and the cloud
  // produce byte-identical snapshot entries. `room.players` must be a Map.
  // ==========================================================================

  // Position → centimetres (×100, rounded). Matches server.js `q`.
  function quantizePos(v) { return Math.round(v * 100); }

  // Yaw → 12-bit (0..4095), normalised to (-π, π]. Matches server.js `qyaw`.
  function quantizeYaw(r) {
    const a = Math.atan2(Math.sin(r || 0), Math.cos(r || 0));
    return Math.round(((a + Math.PI) / (2 * Math.PI)) * 4095);
  }

  // Weapon name → snapshot index. Unknown names fall back to 8 (AK47), exactly
  // as the server has always done. Matches server.js `weaponIndexFromName`.
  function weaponIndexFromName(name) {
    const i = WEAPON_NAMES.indexOf(name);
    return i < 0 ? 8 : i;
  }

  // Build the delta-encoded snapshot entries for ONE room. Returns the array of
  // changed-player entries (may be empty). The caller wraps these with the
  // sequence number + broadcast (server.js snapshotTick / host LocalSim).
  function buildSnapshotEntries(room, now) {
    const arr = [];
    for (const [id, p] of room.players.entries()) {
      const x = quantizePos(p.position.x);
      const y = quantizePos(p.position.y);
      const z = quantizePos(p.position.z);
      const ry = quantizeYaw(p.rotation.y);
      const wIdx = weaponIndexFromName(p.weapon);
      const protectedFlag = (p.invulnerableUntil || 0) > now ? SNAPSHOT_FLAGS.SPAWN_PROTECTED : 0;
      const flags = (p.crouching ? SNAPSHOT_FLAGS.CROUCHING : 0) |
        protectedFlag |
        (p.jumping ? SNAPSHOT_FLAGS.JUMPING : 0) |
        (p.reloading ? SNAPSHOT_FLAGS.RELOADING : 0) |
        (p.walking ? SNAPSHOT_FLAGS.WALKING : 0) |
        (p.sprinting ? SNAPSHOT_FLAGS.SPRINTING : 0) |
        (p.sliding ? SNAPSHOT_FLAGS.SLIDING : 0);
      const changed = p.lastSent.x !== x || p.lastSent.y !== y || p.lastSent.z !== z ||
        p.lastSent.ry !== ry || p.lastSent.w !== wIdx || p.lastSent.f !== flags;
      if (!changed) {
        p.dirty = false;
        continue;
      }
      const e = { id, x, y, z, ry };
      if (p.lastSent.w !== wIdx) e.w = wIdx;
      if (p.lastSent.f !== flags) e.f = flags;
      p.lastSent.x = x;
      p.lastSent.y = y;
      p.lastSent.z = z;
      p.lastSent.ry = ry;
      p.lastSent.w = wIdx;
      p.lastSent.f = flags;
      p.dirty = false;
      arr.push(e);
    }
    return arr;
  }

  return {
    VERSION,
    WEAPON_PRICES,
    UTILITY_PRICES,
    UTILITY_LIFE_CAPS,
    GRENADE_PRICES: UTILITY_PRICES, // alias for the client's name
    TEAM_SPAWN_IDS,
    TEAM_FULL_MAP_SPAWN_IDS,
    GRENADE,
    BARRICADE,
    C4,
    SHIELD,
    SHIELD_GLOCK,
    shieldBlockFraction,
    resolveShieldHit,
    SHOTGUN_ALT,
    WEAPON_NAMES,
    SNAPSHOT_FLAGS,
    WEAPONS,
    MINIGUN,
    minigunShot,
    // snapshot encoder
    quantizePos,
    quantizeYaw,
    weaponIndexFromName,
    buildSnapshotEntries
  };
});
