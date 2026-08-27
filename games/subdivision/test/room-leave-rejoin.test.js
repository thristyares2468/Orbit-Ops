// Last updated: 17 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

assert.match(html, /let pendingRoomLeave = null/, 'client should track an acknowledged room leave');
assert.match(html, /pendingRoomLeave && \(type === 'joinRoom' \|\| type === 'createRoom'\)[\s\S]*?pendingRoomAction/, 'joining immediately after leaving should be queued');
assert.match(html, /reason === 'left' && pendingRoomLeave\?\.requestId === data\?\.requestId[\s\S]*?sendPendingRoomAction/, 'the matching leave acknowledgement should release the queued room action');
assert.match(html, /data\?\.roomCode && currentRoomCode && data\.roomCode !== currentRoomCode/, 'stale room removals should not tear down a newer match');
assert.match(server, /if \(type === 'leaveRoom'\)[\s\S]*?notifySelf: true, requestId/, 'explicit leaves should receive a correlated acknowledgement');
assert.match(server, /if \(!room\) \{[\s\S]*?client\.roomCode = null;[\s\S]*?roomRemoved/, 'missing rooms should still clear stale client membership');

console.log('room-leave-rejoin: acknowledged leaves, queued joins, and stale membership cleanup verified.');
