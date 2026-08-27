'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const clientAccess = require('../clientAccess');

function requestFor(protocols) {
  return { headers: { 'sec-websocket-protocol': protocols.join(', ') } };
}

test('allows ordinary clients when the Canopy credential gate is disabled', () => {
  assert.equal(clientAccess.isAuthorizedCanopyClient(requestFor([]), ''), true);
});

test('accepts the configured Canopy client credential', () => {
  const key = 'local-test-key';
  const credential = clientAccess.expectedCredentialProtocol(key);
  assert.equal(
    clientAccess.isAuthorizedCanopyClient(
      requestFor([clientAccess.CANOPY_CLIENT_PROTOCOL, credential]),
      key
    ),
    true
  );
});

test('rejects missing, malformed, and incorrect Canopy credentials', () => {
  const key = 'local-test-key';
  const credential = clientAccess.expectedCredentialProtocol(key);
  assert.equal(clientAccess.isAuthorizedCanopyClient(requestFor([]), key), false);
  assert.equal(clientAccess.isAuthorizedCanopyClient(requestFor([credential]), key), false);
  assert.equal(
    clientAccess.isAuthorizedCanopyClient(
      requestFor([clientAccess.CANOPY_CLIENT_PROTOCOL, `${credential}x`]),
      key
    ),
    false
  );
});

test('selects only the public Canopy subprotocol, never the credential', () => {
  assert.equal(
    clientAccess.selectCanopyProtocol(new Set([
      clientAccess.CANOPY_CLIENT_PROTOCOL,
      clientAccess.expectedCredentialProtocol('local-test-key')
    ])),
    clientAccess.CANOPY_CLIENT_PROTOCOL
  );
});

test('bundled client configuration is loaded before the WebSocket connection', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const configTag = index.indexOf('<script src="/client-config.js"></script>');
  const socketSetup = index.indexOf('window.JIMS_CLIENT_CONFIG?.apiKey');
  assert.ok(configTag >= 0);
  assert.ok(socketSetup > configTag);
  assert.match(index, /new WebSocket\(multiplayerUrl, socketProtocols\)/);
});
