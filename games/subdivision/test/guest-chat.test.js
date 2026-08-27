'use strict';

// Guests can send chat.
//
// This loosened a deliberate restriction, so what these tests are really about
// is the things that replaced it. The account requirement was never the only
// thing standing between a guest and a spam flood - it was just the most
// visible - and if any of the four below is removed later, this file should be
// the thing that objects.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const antiflood = fs.readFileSync(path.join(root, 'antiflood.js'), 'utf8');

test('a guest is no longer refused for being a guest', () => {
  // The guard remains, but only as the off-switch below.
  assert.match(server, /if \(client\.guest && !GUEST_CHAT_ENABLED\) \{/u);
  assert.doesNotMatch(server, /if \(client\.guest\) \{\s*\n\s*send\(client, 'chatDenied'/u);
});

test('there is an off-switch that does not need a redeploy', () => {
  // Spam is the abuse case here, and it wants a lever that can be pulled in the
  // time it takes to edit an environment variable.
  assert.match(server, /const GUEST_CHAT_ENABLED = String\(process\.env\.GUEST_CHAT \?\? '1'\)\.trim\(\) !== '0';/u);
});

test('guest chat is on by default', () => {
  const read = (value) => String(value ?? '1').trim() !== '0';
  assert.equal(read(undefined), true, 'unset means on');
  assert.equal(read('1'), true);
  assert.equal(read(''), true, 'an empty value is not an opt-out');
  assert.equal(read('0'), false);
  assert.equal(read(' 0 '), false, 'whitespace does not defeat the switch');
});

// --- what replaced the account requirement ---------------------------------

test('chat is still rate limited, and tightly', () => {
  const limit = /chatMessage: \{ ratePerSec: (\d+(?:\.\d+)?), burst: (\d+) \}/u.exec(antiflood);
  assert.ok(limit, 'chatMessage has its own bucket');
  assert.ok(Number(limit[1]) <= 3, `${limit[1]}/sec is too generous for an unauthenticated sender`);
  assert.ok(Number(limit[2]) <= 8, `a burst of ${limit[2]} is too generous`);
  assert.match(server, /if \(!antiflood\.allowMessage\(client, type\)\) return;/u, 'and the limiter actually runs');
});

test('content is still bounded', () => {
  assert.match(server, /const message = sanitizeChatMessage\(data\.message\);\s*\n\s*if \(!message\) return;/u);
});

test('a guest message is still attributable', () => {
  // No account to point at, so the name, IP, room and device have to carry it.
  assert.match(server, /logChat\(client, player, message\);/u);
  assert.match(server, /account_id: client\.accountId \|\| null,/u, 'a null account must not break the log');
  assert.match(server, /ip: client\.ip,/u);
});

test('a guest who abuses it is still bannable', () => {
  // Device banning is the lever anti-cheat already uses on guests; bans by
  // account id do nothing to someone who never made one.
  assert.match(server, /function banGuestDeviceForViolation\(client, type, detail\) \{/u);
  assert.match(server, /bans\.banDevice\(\{/u);
});

// --- the client ------------------------------------------------------------

test('the client no longer refuses before a packet is sent', () => {
  assert.doesNotMatch(client, /Guests can read chat/u, 'no leftover copy saying otherwise');
  assert.doesNotMatch(client, /guests cannot send/u);
  assert.doesNotMatch(client, /chatInput\.readOnly = isGuest;/u, 'the input is writable');
});

test('but the client still obeys the server if the switch is off', () => {
  // The server remains the authority. Turning GUEST_CHAT off must still land
  // somewhere the player can see, rather than silently swallowing their message.
  assert.match(client, /type === 'chatDenied'/u);
  assert.match(client, /flashToast\(data\.message \|\| 'You cannot send chat messages\.'\)/u);
});
