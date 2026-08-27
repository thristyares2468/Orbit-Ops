// Last updated: 27 August 2026
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const blueprint = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('Render Blueprint creates exactly one standalone Subdivision service', () => {
  assert.equal((blueprint.match(/^  - type: web$/gmu) || []).length, 1);
  assert.match(blueprint, /name: orbit-ops-subdivision/u);
  assert.match(blueprint, /runtime: node/u);
  assert.match(blueprint, /region: singapore/u);
  assert.match(blueprint, /numInstances: 1/u);
  assert.doesNotMatch(blueprint, /PUBLIC_BASE_PATH|CANOPY_CLIENT_API_KEY|orbit-ops-gateway/u);
});

test('Render service has deterministic build, health, and production secrets', () => {
  assert.match(blueprint, /buildCommand: npm ci --omit=dev/u);
  assert.match(blueprint, /startCommand: npm start/u);
  assert.match(blueprint, /healthCheckPath: \/health/u);
  for (const key of ['DATABASE_URL', 'ADMIN_TOKEN']) {
    assert.match(blueprint, new RegExp(`- key: ${key}\\n\\s+sync: false`, 'u'));
  }
  assert.match(blueprint, /- key: DEVICE_SECRET\n\s+generateValue: true/u);
});

test('standalone Render URL automatically powers lobby advertising', () => {
  assert.match(server, /process\.env\.CROSS_SERVER_PUBLIC_URL \|\|\s*process\.env\.RENDER_EXTERNAL_URL/u);
});
