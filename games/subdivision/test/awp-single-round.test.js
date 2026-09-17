'use strict';

// The AWP loads one round. Every shot empties the magazine, so the rifle is a
// shot and then a reload - and reloadWeapon() drops the scope, which means the
// cost of a miss is the reload plus re-acquiring the target.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const awp = client.match(/\{ id: 11, name: 'AWP',[^\n]*?\},?\n/u);
assert.ok(awp, 'index.html must declare the AWP');
const stats = awp[0];

test('the AWP chambers a single round', () => {
  const mag = Number(stats.match(/mag: (\d+)/u)[1]);
  const reserve = Number(stats.match(/reserve: (\d+)/u)[1]);
  assert.equal(mag, 1, 'one round in the gun');
  // A reserve that is not a whole number of magazines leaves a partial load
  // that can never be topped up, which the reload path has no way to express.
  assert.equal(reserve % mag, 0, 'the reserve must divide into whole magazines');
  assert.ok(reserve >= 10, 'one round per load still needs a usable reserve');
});

test('firing the last round is what makes it a bolt gun', () => {
  // These are the two lines the magazine size leans on. The first makes an
  // empty gun reload instead of firing; the second drops the scope while it
  // does. With mag 1 they run after every single shot, so a change to either
  // silently rewrites how the rifle plays.
  assert.match(client, /if \(currentAmmo <= 0\) \{ reloadWeapon\(\); return; \}/u,
    'an empty chamber reloads rather than firing');
  const fn = client.slice(client.indexOf('function reloadWeapon'));
  const body = fn.slice(0, fn.indexOf('\n        function ', 1));
  assert.match(body, /if \(isZoomed\) toggleZoom\(\);/u, 'reloading drops the scope');
  // Guard rails the single round makes load-bearing: a full magazine refuses
  // the reload, so a mag of 1 that was not decremented would lock the rifle.
  assert.match(body, /currentAmmo === wp\.mag \|\| reserveAmmo === 0/u);
  assert.match(client, /currentAmmo--;/u, 'firing has to spend the round');
});
