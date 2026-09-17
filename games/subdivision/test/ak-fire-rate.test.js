'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const core = require('../core.js');

const client = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

test('AK47 uses the Heavy Assault Rifle cadence', () => {
  const expectedRoundsPerSecond = 4.25;
  const interval = core.WEAPONS.AK47.firerate;
  assert.ok(Math.abs(interval - 1 / expectedRoundsPerSecond) < 1e-12);
  assert.ok(Math.abs(1 / interval - expectedRoundsPerSecond) < 1e-12);
  assert.ok(interval > core.WEAPONS.FAMAS.firerate * 2,
    'the AK should feel substantially heavier and slower than the FAMAS');
});

test('the browser reads the authoritative AK47 fire interval', () => {
  const entry = client.match(/\{ id: 9, name: 'AK47'[^\n]+/u)?.[0] || '';
  assert.match(entry, /firerate: window\.GameCore\.WEAPONS\.AK47\.firerate/u);
  assert.doesNotMatch(entry, /firerate: 0\.1/u,
    'a hard-coded client rate would let presentation and server enforcement drift');
});
