'use strict';

// The deployable barricade spans core.js (shared geometry), server.js (placement
// authority + health) and index.html (preview, mesh, hit reporting). Nothing here
// needs a browser: the shared table is required directly, and the two runtimes are
// checked against the rules they must not lose in a merge.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const core = require('../core');

const ROOT = path.resolve(__dirname, '..');
// Bounds of a GLB two ways: from the real vertices, and the way three's
// Box3.setFromObject() does it - each geometry's bounding-box corners pushed
// through matrixWorld, which over-estimates any rotated node.
function glbBounds(file) {
  const buf = fs.readFileSync(file);
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.toString('utf8', off + 4, off + 8).trim();
    const body = buf.slice(off + 8, off + 8 + len);
    if (type === 'JSON') json = JSON.parse(body.toString('utf8'));
    else bin = body;
    off += 8 + len;
  }
  const multiply = (a, b) => {
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
    return [r[0] * sx, r[1] * sx, r[2] * sx, 0, r[3] * sy, r[4] * sy, r[5] * sy, 0, r[6] * sz, r[7] * sz, r[8] * sz, 0, tx, ty, tz, 1];
  };
  const exact = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
  const corner = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
  const push = (target, world, point) => {
    for (let a = 0; a < 3; a++) {
      const v = world[a] * point[0] + world[4 + a] * point[1] + world[8 + a] * point[2] + world[12 + a];
      target[0][a] = Math.min(target[0][a], v);
      target[1][a] = Math.max(target[1][a], v);
    }
  };
  const walk = (index, parent) => {
    const node = json.nodes[index];
    const world = multiply(parent, nodeMatrix(node));
    if (Number.isInteger(node.mesh)) {
      for (const prim of json.meshes[node.mesh].primitives) {
        const acc = json.accessors[prim.attributes.POSITION];
        const view = json.bufferViews[acc.bufferView];
        const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
        const stride = view.byteStride || 12;
        for (let v = 0; v < acc.count; v++) {
          const o = start + v * stride;
          push(exact, world, [bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)]);
        }
        for (let c = 0; c < 8; c++) {
          push(corner, world, [c & 1 ? acc.max[0] : acc.min[0], c & 2 ? acc.max[1] : acc.min[1], c & 4 ? acc.max[2] : acc.min[2]]);
        }
      }
    }
    for (const child of node.children || []) walk(child, world);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const root of json.scenes[json.scene || 0].nodes) walk(root, identity);
  const size = (b) => ({ x: b[1][0] - b[0][0], y: b[1][1] - b[0][1], z: b[1][2] - b[0][2] });
  return { exact: size(exact), corner: size(corner) };
}
const client = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('core carries one authoritative barricade table', () => {
  const barricade = core.BARRICADE;
  assert.ok(barricade, 'core must export BARRICADE');
  assert.ok(barricade.width > 0 && barricade.height > 0 && barricade.thickness > 0);
  // Tall enough to stop a step-up and to crouch behind, short enough to shoot over.
  assert.ok(barricade.height > 7, 'a barricade must not be steppable');
  assert.ok(barricade.height < 18, 'a barricade must not be a full wall');
  assert.ok(barricade.deployDistance >= barricade.minRange, 'the fixed deploy spot must clear the minimum range');
  assert.ok(barricade.deployDistance <= barricade.deployRange, 'the fixed deploy spot must sit inside the server bound');
  assert.ok(barricade.spacing > barricade.deployDistance - barricade.minRange, 'spacing must stop panels being chained');
  assert.ok(barricade.health >= 100, 'a barricade must survive more than one bullet');
});

test('the barricade is a priced utility kind with its own life cap', () => {
  assert.equal(typeof core.UTILITY_PRICES.barricade, 'number');
  assert.ok(core.UTILITY_PRICES.barricade > 0);
  assert.equal(core.UTILITY_LIFE_CAPS.barricade, 1, 'persistent cover is capped tighter than a grenade');
});

test('Barricade is appended to the weapon tables without moving existing indexes', () => {
  // The snapshot encoder sends this index over the wire; renumbering it would
  // silently repaint every remote player's weapon.
  assert.deepEqual(core.WEAPON_NAMES.slice(19, 24), ['Frag', 'Smoke', 'Flash', 'Molotov', 'Barricade']);
  assert.equal(core.weaponIndexFromName('Barricade'), 23);
  assert.equal(core.WEAPONS.Barricade.type, 'utility');
  assert.equal(core.WEAPONS.Barricade.dmg.body, 0, 'the deployable itself never deals damage');
});

test('the client exposes the barricade as a utility slot', () => {
  assert.match(client, /const GRENADE_KINDS = \[[^\]]*'barricade'/, 'HUD, buy menu and rebuy all iterate GRENADE_KINDS');
  assert.match(client, /grenadeWeaponIndex = \{[^}]*barricade: 23/);
  assert.match(client, /name: 'Barricade', type: 'grenade', kind: 'barricade'/, 'typed as utility so ammo/reload rules already apply');
  assert.match(client, /utilityBarricade: 'Digit8'/, 'the barricade needs its own bindable key');
  assert.match(client, /\['barricade', 'utilityBarricade', 'Barricade'\]/, 'the utility HUD lists it with its bind');
});

test('a deployed panel is solid cover on the client', () => {
  // Pushing the panel into both lists is what gives it bullet blocking, player
  // collision and grenade bounces for free.
  assert.match(client, /objects\.push\(body\);\s*\n\s*mapObjects\.push\(body\);/);
  assert.match(client, /isBarricadePanel/, 'the panel is tagged so penetration can exclude it');
  assert.match(
    client,
    /function isWallbangSurface\(hitOrObj\)[\s\S]{0,400}?isBarricadePanel[^\n]*return false;/,
    'bullets must not pass through a live barricade'
  );
  assert.match(client, /barricadeId;\s*\n\s*if \(barricadeId\) \{\s*\n\s*reportBarricadeHit/, 'bullet impacts report to the server');
});

test('the deployed panel wears the authored model, fitted to its collider', () => {
  const glb = path.join(ROOT, 'assets/weapons/barricade.glb');
  assert.ok(fs.existsSync(glb), 'the barricade model must ship with the client');
  const bytes = fs.readFileSync(glb);
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF', 'models are binary glTF');
  assert.ok(bytes.length < 1024 * 1024);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  // Blender left both materials on the glTF defaults (metallic 1), which renders
  // as near-black in three.js with no environment map.
  for (const material of json.materials) {
    assert.equal(material.pbrMetallicRoughness?.metallicFactor, 0, `${material.name} must not ship fully metallic`);
  }
  assert.match(client, /'Barricade': \{ path: '\/assets\/weapons\/barricade\.glb'/);
  // Fitted per-axis to the collider, so what is drawn is what stops bullets.
  assert.match(client, /BARRICADE\.width \/ \(size\.x \|\| 1\)[\s\S]{0,120}BARRICADE\.height \/ \(size\.y \|\| 1\)[\s\S]{0,120}BARRICADE\.thickness \/ \(size\.z \|\| 1\)/);
  // The collider stays raycastable once the model covers it, and the shared
  // asset must survive the panel being removed.
  assert.match(client, /body\.material\.opacity = 0;/);
  assert.match(client, /model\.userData\.isSharedAsset = true;/);
  assert.match(client, /if \(child\.userData\?\.isSharedAsset\) continue;/);
  // What you carry is the folded panel, which only exists procedurally. Order,
  // not adjacency: other weapons guard the same call.
  const build = client.slice(client.indexOf('function buildGunModel'));
  const guard = build.indexOf("wp.kind === 'barricade'");
  const attach = build.indexOf('attachWeaponAsset(');
  assert.ok(guard > 0 && attach > guard, 'the carried barricade must keep its procedural model');
});

test('the panel is fitted from real vertices, not a corner estimate', () => {
  // The panel's wings are rotated nodes, so the corner estimate three's
  // Box3.setFromObject() produces is four times the real depth. Fitting to that
  // number shrank the model to a quarter of the collider's thickness, which is
  // what made the hitbox stand out past the model in game.
  const bounds = glbBounds(path.join(ROOT, 'assets/weapons/barricade.glb'));
  assert.ok(bounds.corner.z > bounds.exact.z * 2,
    'this model is exactly the shape that defeats a corner estimate; if that stops being true the guard below still has to hold');
  const fitted = {
    x: bounds.exact.x * (core.BARRICADE.width / bounds.exact.x),
    y: bounds.exact.y * (core.BARRICADE.height / bounds.exact.y),
    z: bounds.exact.z * (core.BARRICADE.thickness / bounds.exact.z)
  };
  assert.ok(Math.abs(fitted.x - core.BARRICADE.width) < 1e-6);
  assert.ok(Math.abs(fitted.y - core.BARRICADE.height) < 1e-6);
  assert.ok(Math.abs(fitted.z - core.BARRICADE.thickness) < 1e-6);
  // And the client has to measure that way: the same fit against the corner
  // estimate would leave the panel this much thinner than what stops bullets.
  const wrongThickness = bounds.exact.z * (core.BARRICADE.thickness / bounds.corner.z);
  assert.ok(wrongThickness < core.BARRICADE.thickness / 2, 'sanity: the wrong measurement really is badly wrong');
  assert.match(client, /function preciseModelBounds\(model\)/);
  // Scoped to the deployables: buildWeaponAssetInstance() measures the loose way
  // too, but every weapon's fp.length was hand-tuned against that behaviour, so
  // it is not this change's to alter.
  for (const fn of ['attachDeployedBarricadeModel', 'attachPlantedC4Model']) {
    const start = client.indexOf(`function ${fn}`);
    assert.ok(start > 0, `${fn} must exist`);
    const body = client.slice(start, client.indexOf('\n        }', start));
    assert.match(body, /const box = preciseModelBounds\(model\);/, `${fn} must measure the real vertices`);
    assert.doesNotMatch(body, /Box3\(\)\.setFromObject/, `${fn} must not fit from a corner estimate`);
  }
});

test('the client never places a panel on its own authority', () => {
  const deploy = client.slice(client.indexOf('function attemptDeployBarricade'));
  const body = deploy.slice(0, deploy.indexOf('\n        }\n'));
  assert.match(body, /sendPacket\('deployBarricade'/);
  assert.doesNotMatch(body, /spawnBarricade\(/, 'the panel appears only from the server broadcast');
  assert.match(client, /type === 'barricadePlaced'[\s\S]{0,160}spawnBarricade\(data\)/);
  assert.match(client, /type === 'barricadeRemoved'[\s\S]{0,160}removeBarricadeById/);
});

test('the barricade is deployed, never thrown', () => {
  assert.match(client, /if \(wp\.kind === 'barricade'\) \{ attemptDeployBarricade\(\); return; \}/);
  assert.match(client, /function throwGrenadeWithCharge[\s\S]{0,300}?if \(kind === 'barricade'[^\n]*\) return;/);
  assert.match(server, /function sanitizeGrenadeKind[\s\S]{0,200}?'molotov' \? value : 'frag'/,
    'the throw/burst paths must keep rejecting the barricade kind');
});

test('the server owns placement, health and cleanup', () => {
  assert.match(server, /ROUND_LOCKED_MESSAGES = new Set\(\[[\s\S]*?'deployBarricade', 'barricadeDamage'/);
  assert.match(server, /type === 'deployBarricade'/);
  assert.match(server, /type === 'barricadeDamage'/);
  assert.match(server, /barricadesDeployedThisLife \|\| 0\) >= barricadeAllowance\(room, player\)/, 'the allowance is checked server-side');
  assert.match(server, /const damage = melee \? 45 : Math\.max\(1, Math\.round\(wdef\.dmg\.body \* BARRICADE\.bulletScale\)\)/,
    'client-reported damage is never trusted');
  assert.match(server, /damageRateOk\(player\.ac, weapon, wdef, now, 'barricadeBucket'\)/, 'panel fire has its own rate bucket');
  assert.match(server, /if \(kind === 'frag' && position\) damageBarricadesFromFrag/);
  assert.match(server, /removeBarricadesOwnedBy\(roomCode, room, id\)/, 'a leaving player takes their panels with them');
  // Every round reset that clears fire and smoke must clear panels too.
  const resets = server.match(/room\.recentBursts = \[\];\n\s*clearRoomBarricades\(room\);/g) || [];
  assert.equal(resets.length, 4, 'all four round resets clear deployed barricades');
  assert.match(server, /barricades: publicBarricades\(room\)/, 'late joiners receive the live panels');
});

test('placement yaw turns the panel face toward the player', () => {
  // Mirrors the client: rotation.y = atan2(-fx, -fz) must send the panel's local
  // -Z (its wide face) away from the player, so its width blocks the view.
  const rotateY = (v, angle) => ({
    x: v.x * Math.cos(angle) + v.z * Math.sin(angle),
    z: -v.x * Math.sin(angle) + v.z * Math.cos(angle)
  });
  for (const heading of [0, 0.4, 1.9, -2.7, Math.PI]) {
    const forward = { x: Math.sin(heading), z: Math.cos(heading) };
    const yaw = Math.atan2(-forward.x, -forward.z);
    const face = rotateY({ x: 0, z: -1 }, yaw);   // panel front
    const span = rotateY({ x: 1, z: 0 }, yaw);    // panel width
    assert.ok(Math.abs(face.x - forward.x) < 1e-9 && Math.abs(face.z - forward.z) < 1e-9,
      'the panel front points where the player is looking');
    assert.ok(Math.abs(span.x * forward.x + span.z * forward.z) < 1e-9,
      'the width sits across the line of sight');
  }
});
