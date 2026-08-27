// Last updated: 15 July 2026
// Golden-master parity tests for core.js extractions (Phase 1).
//
// Each extracted function is checked against an independent re-implementation of
// the server snapshot contract. Pure Node — no DB, no WebGL, no network.
// Run: `node test/core-parity.test.js`.
//
// The bar is byte-for-byte: same return values AND same mutations to the player
// delta-baseline (lastSent / dirty), across an exhaustive matrix of inputs.

const assert = require('assert');
const core = require('../core');

let passed = 0;
function check(name, cond) {
  assert.ok(cond, 'FAILED: ' + name);
  passed++;
}

// ---------------------------------------------------------------------------
// Reference snapshot encoder.
// ---------------------------------------------------------------------------
const WEAPON_NAMES = core.WEAPON_NAMES; // unchanged constant table
const SNAPSHOT_FLAGS = core.SNAPSHOT_FLAGS;
function refQ(v) { return Math.round(v * 100); }
function refQyaw(r) {
  const a = Math.atan2(Math.sin(r || 0), Math.cos(r || 0));
  return Math.round(((a + Math.PI) / (2 * Math.PI)) * 4095);
}
function refWidx(name) {
  const i = WEAPON_NAMES.indexOf(name);
  return i < 0 ? 8 : i;
}
function refBuild(room, now) {
  const arr = [];
  for (const [id, p] of room.players.entries()) {
    const x = refQ(p.position.x);
    const y = refQ(p.position.y);
    const z = refQ(p.position.z);
    const ry = refQyaw(p.rotation.y);
    const wIdx = refWidx(p.weapon);
    const protectedFlag = (p.invulnerableUntil || 0) > now ? SNAPSHOT_FLAGS.SPAWN_PROTECTED : 0;
    const flags = (p.crouching ? SNAPSHOT_FLAGS.CROUCHING : 0) |
      protectedFlag |
      (p.jumping ? SNAPSHOT_FLAGS.JUMPING : 0) |
      (p.reloading ? SNAPSHOT_FLAGS.RELOADING : 0);
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

// ---------------------------------------------------------------------------
// quantizePos / quantizeYaw / weaponIndexFromName — scalar parity
// ---------------------------------------------------------------------------
const posSamples = [0, 1, -1, 0.5, -0.5, 0.004, 0.005, -0.005, 123.456, -987.654, 20141.87, 2399943.21, 1e-9, -1e-9];
for (const v of posSamples) check('quantizePos(' + v + ')', core.quantizePos(v) === refQ(v));

const yawSamples = [0, Math.PI, -Math.PI, Math.PI / 2, -Math.PI / 2, 0.0001, 3.14159, -3.14159, 6.5, -6.5, 100, -100, NaN, undefined, null];
for (const r of yawSamples) {
  const a = core.quantizeYaw(r), b = refQyaw(r);
  check('quantizeYaw(' + r + ')', a === b || (Number.isNaN(a) && Number.isNaN(b)));
}

const nameSamples = [...WEAPON_NAMES, 'AK47', 'Knife', 'AWP', 'Molotov', 'Unknown', '', 'glock', 'aWp'];
for (const n of nameSamples) check('weaponIndexFromName(' + n + ')', core.weaponIndexFromName(n) === refWidx(n));

// ---------------------------------------------------------------------------
// buildSnapshotEntries — full matrix, comparing returns AND mutations
// ---------------------------------------------------------------------------
function mkPlayer(over) {
  return Object.assign({
    weapon: 'AK47',
    crouching: false,
    jumping: false,
    reloading: false,
    invulnerableUntil: 0,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    dirty: true,
    lastSent: { x: null, y: null, z: null, ry: null, w: null, f: null }
  }, over || {});
}

const ORIGIN_BASELINE = { x: 0, y: 0, z: 0, ry: refQyaw(0) };

function mkRoom(players) {
  const m = new Map();
  players.forEach((p, i) => m.set('p' + i, p));
  return { players: m };
}

// A spread of scenarios that exercise every branch.
function scenarios() {
  return [
    mkPlayer({ dirty: true }),                                                                    // fresh baseline
    mkPlayer({ dirty: false, weapon: 'AWP', lastSent: { ...ORIGIN_BASELINE, w: 8, f: 0 } }),      // weapon changed only
    mkPlayer({ dirty: false, crouching: true, weapon: 'AK47', lastSent: { ...ORIGIN_BASELINE, w: 8, f: 0 } }), // crouch flag changed only
    mkPlayer({ dirty: false, jumping: true, weapon: 'AK47', lastSent: { ...ORIGIN_BASELINE, w: 8, f: 0 } }), // jump flag changed only
    mkPlayer({ dirty: false, reloading: true, weapon: 'AK47', lastSent: { ...ORIGIN_BASELINE, w: 8, f: 0 } }), // reload flag changed only
    mkPlayer({ dirty: true, weapon: 'AK47', crouching: false, lastSent: { ...ORIGIN_BASELINE, w: 8, f: 0 } }), // unchanged baseline -> skipped
    mkPlayer({ dirty: false, invulnerableUntil: 5000, lastSent: { ...ORIGIN_BASELINE, w: 8, f: 0 } }), // protection flag (now<5000)
    mkPlayer({ dirty: false, invulnerableUntil: 1000, lastSent: { ...ORIGIN_BASELINE, w: 8, f: 2 } }), // protection expired (now>1000), was protected
    mkPlayer({ dirty: true, crouching: true, jumping: true, reloading: true, invulnerableUntil: 9999, weapon: 'Deagle',
               position: { x: 123.456, y: -7.005, z: 20141.874 }, rotation: { x: 0, y: 2.7, z: 0 },
               lastSent: { x: null, y: null, z: null, ry: null, w: null, f: null } }),
    mkPlayer({ dirty: false, weapon: 'WeirdGun', lastSent: { ...ORIGIN_BASELINE, w: 8, f: 0 } }), // unknown weapon -> 8, unchanged -> skipped
    mkPlayer({ dirty: false, weapon: 'Knife', position: { x: -0.005, y: 0.005, z: -123.45 },
               rotation: { x: 0, y: -Math.PI, z: 0 }, lastSent: { w: 5, f: 1 }, crouching: true })
  ];
}

const now = 3000;
const a = mkRoom(scenarios());
const b = mkRoom(scenarios());
const outCore = core.buildSnapshotEntries(a, now);
const outRef = refBuild(b, now);

check('buildSnapshotEntries returns identical arrays', JSON.stringify(outCore) === JSON.stringify(outRef));

// Compare post-call mutations player-by-player.
const ak = [...a.players.entries()];
const bk = [...b.players.entries()];
check('same player count after', ak.length === bk.length);
for (let i = 0; i < ak.length; i++) {
  const pa = ak[i][1], pb = bk[i][1];
  check('player ' + i + ' lastSent.x', pa.lastSent.x === pb.lastSent.x);
  check('player ' + i + ' lastSent.y', pa.lastSent.y === pb.lastSent.y);
  check('player ' + i + ' lastSent.z', pa.lastSent.z === pb.lastSent.z);
  check('player ' + i + ' lastSent.ry', pa.lastSent.ry === pb.lastSent.ry);
  check('player ' + i + ' lastSent.w', pa.lastSent.w === pb.lastSent.w);
  check('player ' + i + ' lastSent.f', pa.lastSent.f === pb.lastSent.f);
  check('player ' + i + ' dirty', pa.dirty === pb.dirty);
}

// Run the SAME room through twice (idempotency on a settled baseline must match too).
const out2Core = core.buildSnapshotEntries(a, now);
const out2Ref = refBuild(b, now);
check('second pass identical (settled baseline)', JSON.stringify(out2Core) === JSON.stringify(out2Ref));
check('second pass produces no entries (all settled)', out2Core.length === 0);

console.log('core-parity: ' + passed + ' assertions passed.');
