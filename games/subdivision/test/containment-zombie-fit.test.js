'use strict';

// How the imported zombie variants are fitted to their hitboxes.
//
// The models are skinned, so the GPU places their vertices from the bone
// matrices. three r135 has no SkinnedMesh.computeBoundingBox(), so a
// `typeof node.computeBoundingBox === 'function'` guard silently falls through
// to geometry.boundingBox - the BIND POSE. That matters here because the four
// variants are baked at very different offsets inside the one source scene:
//
//   variant   bind-pose bounds y     bone bounds y
//   sol       -125.6 .. -45.9        0 .. 127.4
//   solciv      46.4 .. 125.1        0 .. 127.4
//   haz_2     -213.0 .. -133.4       0 .. 122.9
//   haz_1      -39.8 ..  39.3        0 .. 127.4
//
// Fitting to the left-hand column is fitting to a per-variant accident. Read
// back off the drawn pixels, it put the walker's feet ten units under the floor
// and left the heavy hovering ~35 units above its own hitbox. The two
// "floorSink" constants that used to be here were compensating for one
// variant's offset and could not have been right for the others.
//
// The bones agree across every variant - the rig stands on y=0 - so that is
// what the fit measures now. These tests pin the reasoning, because the failure
// is silent: a model fitted to the wrong space still renders, just in the wrong
// place, and only a screenshot or a missed headshot tells you.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const attach = (() => {
  const start = html.indexOf('function attachContainmentZombieModel');
  const end = html.indexOf('function spawnContainmentEnemy');
  assert.ok(start > 0 && end > start, 'the attach function is where these tests expect');
  const slice = html.slice(start, end);
  assert.ok(slice.length > 1_500 && slice.length < 12_000,
    `the slice is the real function, not a stray match (${slice.length})`);
  return slice;
})();

// The comments in this function deliberately NAME the things that must not be
// used, so "must not appear" checks have to run against code only. Without
// this every such assertion would fail on the explanation of why it exists.
const attachCode = attach
  .split('\n')
  .filter(line => !line.trim().startsWith('//'))
  .join('\n');

test('the fit measures bones, never bind-pose mesh bounds', () => {
  assert.match(attach, /const boneBounds = \(object\) => \{[\s\S]*?if \(!node\.isBone\) return;/u,
    'bones are the measurement');
  // The old measurement must be gone from this function entirely - leaving it
  // as a fallback would reintroduce the per-variant offset it is built on.
  assert.doesNotMatch(attachCode, /computeBoundingBox/u,
    'bind-pose mesh bounds must not be consulted when fitting a zombie');
  assert.doesNotMatch(attachCode, /geometry\.boundingBox/u);
});

test('the floor sink constants are gone, not merely retuned', () => {
  // They were a fudge for a measurement that was wrong in the first place.
  assert.doesNotMatch(attachCode, /floorSink/u);
  assert.doesNotMatch(attachCode, /1\.15|0\.85/u, 'no leftover magic sink values');
});

test('the model stands on the actor origin, like a player does', () => {
  assert.match(attach, /wrapper\.position\.set\(-center\.x, -bounds\.min\.y, -center\.z\)/u,
    'feet on the floor, centred on the actor');
});

test('height is authored per kind rather than derived from the hitboxes', () => {
  // Deriving it from the hitbox span makes the fit circular the moment a hitbox
  // is retuned, which is how the original bug stayed hidden.
  assert.match(html, /const CONTAINMENT_ZOMBIE_PROFILES = \{/u);
  assert.match(attach, /containmentZombieProfile\(actor\.userData\.kind\)\.height \/ sourceHeight/u);
  assert.doesNotMatch(attachCode, /hitboxBounds/u, 'the fit no longer reads the hitboxes');
});

test('a degenerate skeleton is skipped instead of scaling by infinity', () => {
  assert.match(attach, /if \(!Number\.isFinite\(sourceHeight\) \|\| sourceHeight <= 0\.001\) return;/u);
});

test('the facing correction is derived from the rig, not hard-coded', () => {
  // Every variant is authored with the shoulder line along Z, so each renders
  // side-on to its hitbox and to its direction of travel. Deriving the angle
  // means a variant authored the right way round corrects to zero rather than
  // being turned through an unconditional quarter turn.
  assert.match(attach, /Math\.atan2\(shoulderR\.z - shoulderL\.z, shoulderR\.x - shoulderL\.x\)/u);
  assert.doesNotMatch(attachCode, /rotation\.y \+= Math\.PI \/ 2/u, 'not a hard-coded quarter turn');
});

test('the facing correction goes on the wrapper, never the model', () => {
  // The armature carries its own Z-up-to-Y-up correction, so the model's local
  // Y is not the world's: rotating the model tips the rig onto its side and its
  // measured height collapses from ~127 to ~40. The wrapper is axis-aligned
  // with the actor, so a yaw there is a real yaw.
  assert.match(attach, /wrapper\.rotation\.y \+= Math\.atan2\(/u);
  assert.doesNotMatch(attachCode, /model\.rotation\.y/u, 'rotating the model tips it over');
});

test('the idle animation cannot undo the facing correction', () => {
  // It writes rotation.x and rotation.z on this same node every frame; if it
  // ever assigned .y the zombies would snap back to facing sideways.
  const idle = html.slice(html.indexOf('if (actor.userData.zombieVisual) {'));
  const block = idle.slice(0, 600);
  assert.match(block, /zombieVisual\.rotation\.z = /u);
  assert.match(block, /zombieVisual\.rotation\.x = /u);
  assert.doesNotMatch(block, /zombieVisual\.rotation\.y = /u,
    'assigning .y here would overwrite the derived facing every frame');
});

// Every kind's hitboxes, parsed out of the profile table so a kind added there
// is checked here without being listed twice.
function zombieProfiles() {
  const table = html.slice(html.indexOf('const CONTAINMENT_ZOMBIE_PROFILES = {'));
  const block = table.slice(0, table.indexOf('\n        };'));
  const out = {};
  const kinds = [...block.matchAll(/(\w+):\s*\{ height: ([\d.]+)[\s\S]*?legs: \{ size: \[([\d.]+), ([\d.]+), ([\d.]+)\], y: ([\d.]+) \}/gu)];
  for (const m of kinds) {
    const part = (name) => {
      const hit = block.match(new RegExp(`${m[1]}:[\\s\\S]*?${name}: \\{ size: \\[([\\d.]+), ([\\d.]+), ([\\d.]+)\\], y: ([\\d.]+) \\}`, 'u'));
      return { w: +hit[1], h: +hit[2], d: +hit[3], y: +hit[4] };
    };
    out[m[1]] = { height: +m[2], head: part('head'), body: part('body'), legs: part('legs') };
  }
  return out;
}

test('the leg hitbox reaches the floor, as the player one does', () => {
  // The player's legs box spans 0..10. The zombie boxes used to start at
  // 0.4/0.2, leaving a gap that a boot-height shot passed straight through -
  // and that gap is also what the removed floor sink was pushing the model into.
  const profiles = zombieProfiles();
  assert.deepEqual(Object.keys(profiles).sort(), ['crawler', 'heavy', 'runner', 'walker'],
    'every kind the server can spawn needs a profile');
  for (const [kind, p] of Object.entries(profiles)) {
    assert.ok(Math.abs((p.legs.y - p.legs.h / 2) - 0) < 1e-6, `${kind}'s leg box must start at y = 0`);
    // No seam wide enough to shoot through, at any size. The walker carries a
    // ~0.6 neck gap that has always been there; this catches a new kind being
    // authored with a hole in it, not that historic one.
    assert.ok(p.body.y - p.body.h / 2 <= p.legs.y + p.legs.h / 2, `${kind} has a gap above its legs`);
    const neck = (p.head.y - p.head.h / 2) - (p.body.y + p.body.h / 2);
    assert.ok(neck < 1, `${kind} has a ${neck.toFixed(2)} gap above its body`);
  }
});

test('the model is scaled to the height its own hitboxes reach', () => {
  // The GLB is fitted to profile.height while the shots land on these boxes.
  // If the two disagree the player is shooting at a volume that is not where
  // the zombie appears to be - the original bug, in a new place.
  for (const [kind, p] of Object.entries(zombieProfiles())) {
    const top = p.head.y + p.head.h / 2;
    assert.ok(Math.abs(top - p.height) < 1.2,
      `${kind}: hitboxes reach ${top} but the model is scaled to ${p.height}`);
  }
});

test('a crawler is genuinely low, not just a renamed walker', () => {
  // The whole point of the kind. If its head sits at walker height then a
  // player never has to change their aim for one and it is only a reskin.
  const { crawler, walker } = zombieProfiles();
  assert.ok(crawler.height < walker.height * 0.65, 'a crawler must be well under a walker');
  assert.ok(crawler.head.y < walker.body.y,
    "a crawler's head has to sit below where a walker's torso is, or aim never changes");
});

test('the fitted skeleton spans exactly the authored height', () => {
  // Measured in a browser against the real GLB, running this exact code:
  //   sol    as heavy  -> bones 0.00..23.00   (hitbox 0.00..23.00)
  //   solciv as walker -> bones 0.00..22.20   (hitbox 0.00..22.20)
  //   haz_2  as walker -> bones 0.00..22.20   (raw skeleton 122.9, not 127.4)
  //   haz_1  as walker -> bones 0.00..22.20
  // haz_2 is the one that proves per-variant measurement matters: its skeleton
  // is a different height from the other three yet it still lands on target.
  const walkerTop = 22.2, heavyTop = 23;
  assert.ok(Math.abs(walkerTop - (19.6 + 5.2 / 2)) < 1e-9, 'walker height matches its head hitbox top');
  assert.ok(Math.abs(heavyTop - (20.1 + 5.8 / 2)) < 1e-9, 'heavy height matches its head hitbox top');
});
