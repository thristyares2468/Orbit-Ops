const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('cross-server invitations use a shared durable one-time mailbox', () => {
  const db = read('db.js');
  const server = read('server.js');
  assert.match(db, /CREATE TABLE IF NOT EXISTS cross_server_game_invites/);
  assert.match(db, /function crossInviteTokenHash[\s\S]*?sha256/);
  assert.match(db, /async function createCrossServerInvites[\s\S]*?friendships/);
  assert.match(db, /async function consumeCrossServerInvite[\s\S]*?status = 'accepted'[\s\S]*?status = 'pending'/);
  assert.match(server, /CROSS_SERVER_INSTANCE_ID/);
  assert.match(server, /CROSS_SERVER_PUBLIC_URL/);
  assert.match(server, /handleCrossInviteAllFriends\(client\)/);
  assert.match(server, /setInterval\(\(\) => \{[\s\S]*?sendCrossServerInvites\(client\)[\s\S]*?15000/);
});

test('client accepts invites and uses the destination handoff', () => {
  const html = read('index.html');
  assert.match(html, /id="cross-game-invite-banner"/);
  assert.match(html, /crossInviteRespond/);
  assert.match(html, /crossInviteRedirect[\s\S]*?window\.location\.assign/);
  assert.match(html, /initialHandoffToken[\s\S]*?authHandoff/);
  assert.match(html, /handoffRoomCode[\s\S]*?joinRoom/);
});
