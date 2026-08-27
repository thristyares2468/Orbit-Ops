'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('a signed-in lobby session reconnects instead of becoming a fatal logout', () => {
  assert.match(index, /const canResumeAccount = !!lastSession && \(lastSession\.wasGuest \|\| !!storeGet\(AUTH_TOKEN_KEY\)\)/);
  assert.match(index, /if \(!lastRoom && !canResumeAccount && netState !== 'reconnecting'\)/);
  assert.match(index, /sendPacket\('authResume', \{ token: tok, fingerprint: deviceFingerprint, deviceToken: deviceTokenStore \}\)/);
});

test('an unauthenticated socket failure still returns to login', () => {
  assert.match(index, /handleFatalDisconnect\('Disconnected\. Please log in again\.'\)/);
});
