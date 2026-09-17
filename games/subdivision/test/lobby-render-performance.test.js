'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert.match(html, /const LOBBY_RENDER_INTERVAL_MS = 100;/,
  'the idle lobby should use a low-cost background render cadence');
assert.match(html, /if \(!gameStarted && !localSkinLabTest\) \{[\s\S]*?renderFrame\(\);[\s\S]*?return;[\s\S]*?\}\s*updateBotsLogic\(delta, time\);/,
  'the lobby must return before gameplay simulation and effects updates');

console.log('lobby render performance tests passed');
