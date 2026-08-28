'use strict';

// The offline gate mapper, tools/gate-mapper.html.
//
// The tool's whole value is that a number read in it is a number the server
// will honour. That rests on one derivation: given two clicked gate posts, the
// yaw and width that make the server's blocking box span them.
//
//   segmentIntersectsContainmentGate() maps a world offset into gate-local
//   space with  local.x = cos*dx - sin*dz,  local.z = sin*dx + cos*dz,
//   then tests |local.x| <= width/2. So width runs along whichever world
//   direction maps to local +x, which is (cos yaw, -sin yaw), and the yaw that
//   lays width along a span v is atan2(-v.z, v.x).
//
// Get that sign wrong and you get a gate rotated ninety degrees: it renders in
// the right place, reads correctly in the file, and blocks nothing. Nothing
// else in the pipeline would catch it, so it is checked here - and checked
// against the real shipped function on both sides rather than a copy, because
// a copied constant is exactly how these two drift apart.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const tool = fs.readFileSync(path.join(root, 'tools', 'gate-mapper.html'), 'utf8');

// Lift the real functions out of the real files.
function lift(source, signature, name) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${name} not found - has it been renamed?`);
  // Brace counting, not an indent guess: both functions contain nested blocks
  // that close at the same indent as the function itself, so any "closing
  // brace at column N" heuristic truncates them mid-body.
  let depth = 0;
  let end = -1;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.notEqual(end, -1, `could not find the end of ${name}`);
  return source.slice(start, end);
}

function build(name, ...sources) {
  // eslint-disable-next-line no-new-func
  return new Function(`${sources.join('\n')}\n return ${name};`)();
}

const segmentIntersectsContainmentGate = build(
  'segmentIntersectsContainmentGate',
  lift(server, 'function segmentIntersectsContainmentGate(', 'segmentIntersectsContainmentGate')
);
// gateFromPosts rounds through the tool's own helper, so that comes too - the
// 2dp it produces is what actually lands in maps.js.
const gateFromPosts = build(
  'gateFromPosts',
  lift(tool, 'function round(', 'round'),
  lift(tool, 'function gateFromPosts(', 'gateFromPosts')
);

// The tool rounds to 2dp, which is what lands in maps.js.
const NEAR = 0.02;

// Where the tool's own docs say width lies, in world space.
const spanDirection = (yaw) => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });

function postsFor(centre, yaw, width) {
  const dir = spanDirection(yaw);
  return [
    { x: centre.x - dir.x * width / 2, y: centre.y, z: centre.z - dir.z * width / 2 },
    { x: centre.x + dir.x * width / 2, y: centre.y, z: centre.z + dir.z * width / 2 }
  ];
}

test('two posts round-trip to the yaw and width that span them', () => {
  const centre = { x: 120, y: 40, z: -85 };
  for (let step = 0; step < 24; step += 1) {
    const yaw = -Math.PI + (step * Math.PI * 2) / 24;
    const width = 18 + step;
    const [a, b] = postsFor(centre, yaw, width);
    const gate = gateFromPosts(a, b);

    assert.ok(Math.abs(gate.x - centre.x) < NEAR, `centre x at yaw ${yaw}`);
    assert.ok(Math.abs(gate.z - centre.z) < NEAR, `centre z at yaw ${yaw}`);
    assert.ok(Math.abs(gate.width - width) < NEAR, `width at yaw ${yaw}`);
    // yaw is only defined up to a half turn - either end may be clicked first,
    // and a box is symmetric - so compare the span direction, not the angle.
    const want = spanDirection(yaw);
    const got = spanDirection(gate.yaw);
    const aligned = Math.abs(want.x * got.x + want.z * got.z);
    assert.ok(Math.abs(aligned - 1) < 1e-6, `span direction at yaw ${yaw}`);
  }
});

test('clicking the posts in either order describes the same barrier', () => {
  const [a, b] = postsFor({ x: 0, y: 0, z: 0 }, 0.7, 40);
  const forward = gateFromPosts(a, b);
  const backward = gateFromPosts(b, a);
  assert.equal(forward.x, backward.x);
  assert.equal(forward.z, backward.z);
  assert.equal(forward.width, backward.width);
  const cross = Math.sin(forward.yaw - backward.yaw);
  assert.ok(Math.abs(cross) < 1e-9, 'the two yaws differ by exactly half a turn');
});

test('the derived gate actually blocks the gap the posts were clicked across', () => {
  // This is the assertion the tool exists for: authored numbers, real server.
  const centre = { x: 300, y: 20, z: -120 };
  for (let step = 0; step < 16; step += 1) {
    const yaw = (step * Math.PI * 2) / 16;
    const width = 30;
    const [a, b] = postsFor(centre, yaw, width);
    const gate = { ...gateFromPosts(a, b), y: centre.y, depth: 5, height: 24, open: false };

    // Someone walking through the gap, perpendicular to the span.
    const through = spanDirection(yaw + Math.PI / 2);
    const from = { x: centre.x - through.x * 30, y: centre.y, z: centre.z - through.z * 30 };
    const to = { x: centre.x + through.x * 30, y: centre.y, z: centre.z + through.z * 30 };
    assert.equal(segmentIntersectsContainmentGate(gate, from, to, 0), true,
      `a crossing at yaw ${yaw} must be blocked`);

    // Someone walking along the wall well outside it, parallel to the span.
    const along = spanDirection(yaw);
    const offX = through.x * 40, offZ = through.z * 40;
    assert.equal(segmentIntersectsContainmentGate(gate, {
      x: centre.x + offX - along.x * 30, y: centre.y, z: centre.z + offZ - along.z * 30
    }, {
      x: centre.x + offX + along.x * 30, y: centre.y, z: centre.z + offZ + along.z * 30
    }, 0), false, `passing by at yaw ${yaw} must not be blocked`);
  }
});

test('a gate rotated by a quarter turn would NOT block - so the sign matters', () => {
  // Guards the derivation itself: if atan2's arguments were ever swapped, the
  // round-trip test above would still pass but this one would fail.
  const centre = { x: 0, y: 0, z: 0 };
  const [a, b] = postsFor(centre, 0, 24);
  const correct = { ...gateFromPosts(a, b), y: 0, depth: 5, height: 24, open: false };
  const wrong = { ...correct, yaw: correct.yaw + Math.PI / 2 };

  // Offset from the centre, because a rotated box still covers its own centre
  // line - walking dead through the middle is blocked either way. The actual
  // failure is that a quarter-turned gate only covers a 5-deep sliver of a
  // 24-wide doorway, so anyone not walking the exact centre strolls past it.
  const crossing = [{ x: 10, y: 0, z: -20 }, { x: 10, y: 0, z: 20 }];
  assert.equal(segmentIntersectsContainmentGate(correct, crossing[0], crossing[1], 0), true,
    'the correctly derived gate spans the whole doorway');
  assert.equal(segmentIntersectsContainmentGate(wrong, crossing[0], crossing[1], 0), false,
    'the quarter-turn error is silent everywhere except here');
});

test('every authored gate still spans more than the server floor', () => {
  // configureGates clamps width to 6-80. Anything authored outside that range
  // ships as a different barrier than the one that was measured.
  const maps = require('../maps.js');
  for (const [mapId, gates] of Object.entries(maps.CONTAINMENT_GATES || {})) {
    for (const gate of gates) {
      assert.ok(gate.width >= 6 && gate.width <= 80,
        `${mapId}/${gate.id} width ${gate.width} would be silently clamped`);
      assert.ok(Number.isFinite(gate.x) && Number.isFinite(gate.z) && Number.isFinite(gate.yHint),
        `${mapId}/${gate.id} has a non-finite coordinate`);
    }
  }
});

test('the tool loads maps at the same scale the game does', () => {
  // World coordinates are raw GLB coordinates times this. If the tool and the
  // game ever disagree, every number it produces is wrong by a constant factor
  // - which looks plausible and is completely broken.
  assert.match(tool, /mapRoot\.scale\.set\(def\.scale, def\.scale, def\.scale\)/u);
  assert.match(tool, /dust2: \{ label: 'Dust2', path: '\/assets\/maps\/de_dust_2_with_real_light\.glb', scale: 20 \}/u);
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(index, /path: '\/assets\/maps\/de_dust_2_with_real_light\.glb',\s*\n\s*bytes: \d+,\s*\n\s*scale: 20,/u,
    'dust2 is declared in index.html, not maps.js, so the tool repeats it - keep them equal');
  // Every other map comes from maps.js directly, so it cannot drift.
  assert.match(tool, /MAPS\[id\] = \{ label: def\.label \|\| id, path: def\.path, scale: def\.scale \|\| 22 \}/u);
});
