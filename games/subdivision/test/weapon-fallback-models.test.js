'use strict';

// Every weapon needs a procedural stand-in for the gap before its GLB arrives.
//
// attachWeaponAsset() loads asynchronously and only calls clearObjectChildren()
// once the model resolves, so whatever buildGunModel() put in weaponGroup is
// what the player holds until then. A weapon with no case in that switch holds
// literally nothing - and the failure is invisible in code review, because the
// switch simply falls through and the GLB does eventually turn up.
//
// It bit exactly the two weapons where it hurt most: RPG (17MB) and Minigun
// (8.5MB) are the heaviest assets in the game, so they had the longest empty
// hands, and both were added after the original set.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function section(startMarker, endMarker, min, max) {
  const start = html.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} not found`);
  const end = html.indexOf(endMarker, start);
  assert.ok(end > start, `${endMarker} not found after ${startMarker}`);
  const slice = html.slice(start, end);
  assert.ok(slice.length > min && slice.length < max,
    `the ${startMarker} slice is the real function, not a stray match (${slice.length})`);
  return slice;
}

// Names straight out of the loadout table, so a weapon added there is covered
// by this test automatically rather than needing to be listed here too.
const weaponNames = [...new Set(
  [...html.matchAll(/\{ id: \d+, name: '([^']+)', type: '/gu)].map((m) => m[1])
)];

test('the weapon table was actually found', () => {
  assert.ok(weaponNames.length >= 25, `expected the full weapon table, got ${weaponNames.length}`);
  for (const expected of ['AK47', 'Glock', 'FAMAS', 'Deagle', 'RPG', 'Minigun']) {
    assert.ok(weaponNames.includes(expected), `${expected} should be in the loadout table`);
  }
});

test('every weapon has a first-person fallback model', () => {
  const build = section('function buildGunModel(', 'function showLoadingScreen', 3_000, 30_000);
  const cases = new Set([...build.matchAll(/case '([^']+)'/gu)].map((m) => m[1]));
  const missing = weaponNames.filter((name) => !cases.has(name));
  assert.deepEqual(missing, [],
    `these weapons would be held as empty hands until their GLB loads: ${missing.join(', ')}`);
});

test('the heavy launchers have their own third-person silhouette', () => {
  // Everything else falls through to a generic rifle/pistol/shotgun shape,
  // which is fine for a rifle and wrong for these two: a teammate would appear
  // to be carrying an AK until the largest asset in the game finished loading.
  const build = section('function buildThirdPersonWeaponModel(', '\n        function spawnPlayerTarget', 2_000, 12_000);
  for (const name of ['RPG', 'Minigun']) {
    assert.match(build, new RegExp(`weaponName === '${name}'`, 'u'),
      `${name} needs a third-person stand-in of its own`);
  }
  // And they must still hand over to the real asset once it arrives.
  const rpg = build.slice(build.indexOf("weaponName === 'RPG'"));
  assert.match(rpg.slice(0, 900), /attachWeaponAsset\(parent, weaponName, 'thirdPerson', skinItem\);/u,
    'the stand-in must not replace the GLB permanently');
});

test('the fallback is what fills the gap, so the asset must not clear it early', () => {
  // clearObjectChildren has to happen inside the resolve callback. Hoisted out,
  // the stand-in would be wiped the moment loading started and the hands would
  // be empty again - the very thing these models exist to prevent.
  const attach = section('function attachWeaponAsset(', 'function syncHeldRpgRocket', 300, 2_500);
  const resolveBody = attach.slice(attach.indexOf('promise.then('));
  assert.match(resolveBody, /clearObjectChildren\(parent\);/u,
    'the swap happens only once the model has resolved');
  const beforeThen = attach.slice(0, attach.indexOf('promise.then('));
  assert.doesNotMatch(beforeThen, /clearObjectChildren/u,
    'nothing may clear the stand-in before the GLB is ready');
});
