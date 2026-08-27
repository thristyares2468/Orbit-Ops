'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('cross-server friend invite mailboxes are removed', () => {
  const combined = [read('server.js'), read('db.js'), read('index.html'), read('antiflood.js')].join('\n');
  for (const retired of [
    'cross_server_game_invites',
    'crossInviteData',
    'crossInviteRespond',
    'crossInviteAllFriends',
    'crossInviteConsume',
    'cross-game-invite-banner'
  ]) assert.doesNotMatch(combined, new RegExp(retired, 'u'));
});

test('room-code cross-host joining and ordinary party invites remain', () => {
  const server = read('server.js');
  const client = read('index.html');
  assert.match(server, /createCrossServerHandoff/u);
  assert.match(server, /crossServerConnect/u);
  assert.match(client, /type === 'crossServerConnect'/u);
  assert.match(server, /handlePartyInvite/u);
  assert.match(client, /type === 'partyInvited'/u);
});
