'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const db = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');

test('manual room codes route registered players to the hosting instance', () => {
  assert.match(server, /routeRemoteRoomJoin\(client, roomCode\)/);
  assert.match(server, /db\.findActiveRoom\(roomCode\)/);
  assert.match(server, /target\.searchParams\.set\('handoff', token\)/);
  assert.match(server, /for \(const \[roomCode, room\] of rooms\.entries\(\)\) publishRoomDirectory\(roomCode, room\)/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS active_game_rooms/);
});

test('friend invites use a one-time account handoff and auto-join', () => {
  assert.match(db, /CREATE TABLE IF NOT EXISTS cross_server_auth_handoffs/);
  assert.match(db, /SET consumed_at = now\(\)/);
  assert.match(server, /result = await auth\.handoff\(data, conn, CROSS_SERVER_INSTANCE_ID\)/);
  assert.match(client, /sendPacket\('authHandoff'/);
  assert.match(client, /sendPacket\('joinRoom', \{ roomCode: data\.handoffRoomCode/);
});
