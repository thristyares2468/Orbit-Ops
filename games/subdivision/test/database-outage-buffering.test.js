'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('failed stat persistence is merged back into the next flush buffer', () => {
  assert.match(server, /function mergeStatDelta\(target, source\)/);
  assert.match(server, /catch \(e\) \{\s*mergeStatDelta\(client\.statDelta, delta\)/);
  assert.match(server, /target\.bestStreak = Math\.max/);
});

test('failed daily persistence is retained when the reporting day is unchanged', () => {
  assert.match(server, /function mergeDailyDelta\(target, source\)/);
  assert.match(server, /if \(client\.dailyDelta\?\.dateKey === delta\.dateKey\) mergeDailyDelta\(client\.dailyDelta, delta\)/);
});
