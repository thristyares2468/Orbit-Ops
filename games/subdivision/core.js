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
  const VERSION = '8';

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
    'RPG': 6000
  };

  // Grenade/utility prices. Server calls this UTILITY_PRICES; the client calls the
  // identical object GRENADE_PRICES. Exposed under both names to avoid churn.
  const UTILITY_PRICES = { frag: 300, smoke: 150, flash: 200, molotov: 400, barricade: 500, c4: 600 };

  // Per-life buy caps by utility kind. Anything missing here uses the caller's
  // default (2 on both sides). The barricade is deliberately capped lower: it is
  // persistent cover, not a one-shot effect.
  const UTILITY_LIFE_CAPS = { barricade: 1, c4: 1 };

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
    rpg: { radius: 145, maxDamage: 180, selfScale: 0.65, speed: 520, maxLifeMs: 4200 },
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
    health: 260,
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
    'Frag', 'Smoke', 'Flash', 'Molotov', 'Barricade', 'C4', 'Breacher', 'Shield', 'RPG'
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
    'Knife':  { type: 'melee',   firerate: 0.5,   pellets: 1, range: 18,   dmg: { head: 50, body: 50, legs: 50 } },
    'Glock':  { type: 'pistol',  firerate: 0.15,  pellets: 1, range: 1000, dmg: { head: 56, body: 14, legs: 22 } },
    'Deagle': { type: 'pistol',  firerate: 0.4,   pellets: 1, range: 1000, dmg: { head: 234, body: 58, legs: 47 } },
    'USP-S':  { type: 'pistol',  firerate: 0.17,  pellets: 1, range: 1000, dmg: { head: 140, body: 35, legs: 29 } },
    'P2000':  { type: 'pistol',  firerate: 0.16,  pellets: 1, range: 1000, dmg: { head: 128, body: 32, legs: 28 } },
    'P250':   { type: 'pistol',  firerate: 0.16,  pellets: 1, range: 1000, dmg: { head: 152, body: 38, legs: 31 } },
    'Five-SeveN': { type: 'pistol', firerate: 0.15, pellets: 1, range: 1000, dmg: { head: 126, body: 31, legs: 28 } },
    'Tec-9':  { type: 'pistol',  firerate: 0.12,  pellets: 1, range: 1000, dmg: { head: 132, body: 33, legs: 28 } },
    'CZ75-Auto': { type: 'pistol', firerate: 0.085, pellets: 1, range: 1000, dmg: { head: 124, body: 31, legs: 26 } },
    'Dual Berettas': { type: 'pistol', firerate: 0.12, pellets: 1, range: 1000, dmg: { head: 104, body: 26, legs: 22 } },
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
    bodyBlock: 0.85,        // share of a blocked body/leg hit that is absorbed
    headBlock: 0,           // standing, the head sits above the shield
    crouchHeadBlock: 0.85,  // crouched, the carrier is behind it completely
    // No protection immediately after firing: it is the rule that makes the
    // shield a choice rather than an accessory, and it also means a client that
    // claims to hold one while shooting gets nothing for it.
    fireLockoutMs: 700,
    // Taking the shield as your primary means giving up a long gun. The server
    // accepts damage from these types only while it is your main slot, so a
    // client cannot carry a shield loadout and fight with a rifle behind it.
    allowedWeaponTypes: ['pistol', 'melee', 'shield']
  };
  WEAPONS.Shield = { type: 'shield', firerate: 0.5, pellets: 0, range: 0, dmg: { head: 0, body: 0, legs: 0 } };
  WEAPONS.RPG = { type: 'launcher', firerate: 1.1, pellets: 0, range: 0, dmg: { head: 0, body: 0, legs: 0 } };

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
    SHOTGUN_ALT,
    WEAPON_NAMES,
    SNAPSHOT_FLAGS,
    WEAPONS,
    // snapshot encoder
    quantizePos,
    quantizeYaw,
    weaponIndexFromName,
    buildSnapshotEntries
  };
});
