'use strict';

// The Breacher alternates buckshot and slug. What has to hold is that the load
// is the server's decision, that one trigger pull cannot be split across both
// loads, and that an uncorrelated hit can never be paid out as a slug.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const core = require('../core');

const ROOT = path.resolve(__dirname, '..');
// Bounding box of a GLB in the orientation the loader will see: accessor extents
// pushed through the node transforms, exactly as three.js does on load.
function glbWorldSize(file) {
  const buf = fs.readFileSync(file);
  let off = 12;
  let json = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    if (buf.toString('utf8', off + 4, off + 8).trim() === 'JSON') json = JSON.parse(buf.toString('utf8', off + 8, off + 8 + len));
    off += 8 + len;
  }
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const multiply = (a, b) => {   // column-major, a then b
    const out = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return out;
  };
  const nodeMatrix = (node) => {
    if (node.matrix) return node.matrix;
    const [tx, ty, tz] = node.translation || [0, 0, 0];
    const [sx, sy, sz] = node.scale || [1, 1, 1];
    const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
    const r = [
      1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw),
      2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw),
      2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy)
    ];
    return [
      r[0] * sx, r[1] * sx, r[2] * sx, 0,
      r[3] * sy, r[4] * sy, r[5] * sy, 0,
      r[6] * sz, r[7] * sz, r[8] * sz, 0,
      tx, ty, tz, 1
    ];
  };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const walk = (index, parent) => {
    const node = json.nodes[index];
    const world = multiply(parent, nodeMatrix(node));
    if (Number.isInteger(node.mesh)) {
      for (const prim of json.meshes[node.mesh].primitives) {
        const acc = json.accessors[prim.attributes.POSITION];
        for (let corner = 0; corner < 8; corner++) {
          const p = [corner & 1 ? acc.max[0] : acc.min[0], corner & 2 ? acc.max[1] : acc.min[1], corner & 4 ? acc.max[2] : acc.min[2]];
          for (let axis = 0; axis < 3; axis++) {
            const v = world[axis] * p[0] + world[4 + axis] * p[1] + world[8 + axis] * p[2] + world[12 + axis];
            min[axis] = Math.min(min[axis], v);
            max[axis] = Math.max(max[axis], v);
          }
        }
      }
    }
    for (const child of node.children || []) walk(child, world);
  };
  for (const root of json.scenes[json.scene || 0].nodes) walk(root, identity);
  return { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
}

const client = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('the two loads are borrowed, not copied', () => {
  const alt = core.SHOTGUN_ALT;
  assert.ok(alt, 'core must export SHOTGUN_ALT');
  assert.equal(alt.weapon, 'Breacher');
  // Borrowed by reference on purpose: a buckshot pull is always exactly a Nova
  // shot and a slug always the SSG 08's numbers, whatever those are retuned to.
  assert.equal(alt.buckshot.dmg, core.WEAPONS.Nova.dmg);
  assert.equal(alt.buckshot.pellets, core.WEAPONS.Nova.pellets);
  assert.equal(alt.slug.dmg, core.WEAPONS['SSG 08'].dmg);
  assert.equal(alt.slug.pellets, 1, 'a slug is a single projectile');
  assert.equal(core.WEAPONS.Breacher.dmg, alt.buckshot.dmg, 'the weapon table itself is the buckshot load');
});

test('the pull window separates pulls but never splits one', () => {
  const alt = core.SHOTGUN_ALT;
  const firerateMs = core.WEAPONS.Breacher.firerate * 1000;
  assert.ok(alt.pullWindowMs < firerateMs,
    'a legitimate next pull must fall outside the window, or two pulls merge into one load');
  assert.ok(alt.pullWindowMs > 50,
    'every pellet of one pull must fall inside the window, or a pull fires both loads at once');
});

test('Breacher is appended to the weapon tables without moving existing indexes', () => {
  assert.deepEqual(core.WEAPON_NAMES.slice(19, 26), ['Frag', 'Smoke', 'Flash', 'Molotov', 'Barricade', 'C4', 'Breacher']);
  assert.equal(core.weaponIndexFromName('Breacher'), 25);
  assert.equal(core.WEAPONS.Breacher.type, 'shotgun');
  assert.ok(core.WEAPON_PRICES.Breacher > 0, 'it has to be buyable');
});

test('the server owns which load a pull fires', () => {
  // Derived from time, not from anything the client sends: there is no field a
  // client could set to ask for a slug.
  assert.match(server, /function resolveShotgunLoad\(player, weapon, now\)/);
  assert.match(server, /now - player\.shotgunPull\.at > SHOTGUN_ALT\.pullWindowMs/);
  assert.match(server, /slug: player\.shotgunPull \? !player\.shotgunPull\.slug : false/,
    'the first pull of a life is buckshot');
  const resolve = server.slice(server.indexOf('function resolveShotgunLoad'));
  const body = resolve.slice(0, resolve.indexOf('\n}\n'));
  assert.doesNotMatch(body, /data\./, 'the load must not be read off the packet');
  assert.match(server, /resetShotgunLoad\(player\);/, 'a life starts on buckshot again');
});

test('a hit is worth whatever its pull was loaded with', () => {
  assert.match(server, /const load = resolveShotgunLoad\(player, weapon, now\);/);
  assert.match(server, /pellets,\n\s*load,/, 'the load is stamped on the recorded shot');
  assert.match(server, /damage = \(corr\.shot\?\.load\?\.dmg \|\| wdef\.dmg\)\[part\];/,
    'damage comes from the correlated shot, falling back to buckshot');
  // pellets drives correlateHit's allowedHits, so a slug pull must not be able
  // to pay out nine times.
  assert.match(server, /const pellets = Math\.max\(1, Number\(\(load \? load\.pellets : wdef\.pellets\) \|\| 1\)\);/);
});

test('the client keeps the weapon entry describing the next pull', () => {
  assert.match(client, /name: 'Breacher', type: 'shotgun'/);
  assert.match(client, /const BREACHER_LOADS = \{[\s\S]*?buckshot: \{[\s\S]*?slug: \{/);
  assert.match(client, /Object\.assign\(wp, BREACHER_LOADS\[breacherSlugLoaded \? 'slug' : 'buckshot'\]\)/);
  assert.match(client, /if \(wp\.name === SHOTGUN_ALT\.weapon\) advanceBreacherLoad\(\);/);
  assert.match(client, /function resetBreacherLoad\(\) \{ applyBreacherLoad\(false\); \}/);
  assert.match(client, /resetBreacherLoad\(\);\n\s*ammoState = weapons\.map/, 'a respawn re-chambers buckshot');
  // The HUD has to say which load is up, or the spread change is the only tell.
  assert.match(client, /breacherSlugLoaded \? 'SLUG' : 'BUCK'/);
  assert.match(client, /deathmatchMainWeaponIndexes = \[3, 4, 5, 6, 7, 8, 9, 10, 25\]/, 'it must be buyable');
});

test("an axis:'x' model is authored barrel-along-X, up-along-Z", () => {
  // WEAPON_ASSET_X_FP_QUATERNION is shared by every axis:'x' weapon and maps
  //   model +X -> forward, model +Z -> up, model +Y -> left.
  // A Sketchfab export usually wraps the scene in a Z-up -> Y-up display matrix,
  // which lands the gun on its side once that quaternion is applied. Stripping
  // the wrapper is what fixes it, so the shipped file has to keep these axes.
  const size = glbWorldSize(path.join(ROOT, 'assets/weapons/breacher.glb'));
  assert.ok(size.x > size.y && size.x > size.z, 'the barrel must run along X');
  assert.ok(size.z > size.y, 'the gun must be taller than it is wide, or it is rolled onto its side');
  assert.match(client, /'Breacher': \{[^}]*axis: 'x'/);
});

test('the shipped model is wired up', () => {
  const glb = path.join(ROOT, 'assets/weapons/breacher.glb');
  assert.ok(fs.existsSync(glb));
  const bytes = fs.readFileSync(glb);
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
  assert.ok(bytes.length < 512 * 1024, 'a weapon model should stay small');
  assert.match(client, /'Breacher': \{ path: '\/assets\/weapons\/breacher\.glb', axis: 'x'/);
  // Sketchfab records the CC BY author and licence in the file itself; shipping
  // the metadata is part of the attribution.
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.match(json.asset.extras.license, /CC-BY/);
  assert.ok(json.asset.extras.author, 'the author credit must survive in the shipped file');
  const notices = fs.readFileSync(path.join(ROOT, '../../THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.match(notices, /tinycomputer/, 'CC BY requires the author credit in the notices too');
  assert.match(notices, /Blender3D/);
});
