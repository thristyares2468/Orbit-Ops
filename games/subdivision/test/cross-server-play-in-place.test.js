const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const server = read('server.js');
const client = read('index.html');
const db = read('db.js');

test('a room advertises the socket that reaches it', () => {
  assert.match(db, /socket_url\s+TEXT/u, 'the directory stores a socket address');
  assert.match(db, /ADD COLUMN IF NOT EXISTS socket_url TEXT/u, 'and adds it to an existing table');
  assert.match(db, /SELECT room_code, instance_id, public_url, socket_url/u, 'and hands it back on lookup');
  assert.match(server, /socketUrl: CROSS_SERVER_SOCKET_URL/u, 'the publisher fills it in');
});

test('each deployment derives its own socket from the path only it knows', () => {
  // Embedded behind the Orbit Ops gateway the socket is <base>/ws; standalone it
  // is the bare origin. This must agree with embeddedClientConfig().
  assert.match(server, /PUBLIC_BASE_PATH \? `\$\{PUBLIC_BASE_PATH\}\/ws` : ''/u);
  assert.match(server, /const websocketPath = `\$\{PUBLIC_BASE_PATH \|\| ''\}\/ws`/u);
});

test('a directory row is only trusted on the host we would have redirected to', () => {
  const guard = server.match(/function safeCrossServerSocket[\s\S]*?\n}/u);
  assert.ok(guard, 'the guard exists');
  assert.match(guard[0], /protocol !== 'wss:' && url\.protocol !== 'ws:'/u, 'only WebSocket schemes');
  assert.match(guard[0], /url\.host !== redirectTarget\.host/u, 'same host as the redirect target');
  assert.match(guard[0], /url\.search \|\| url\.hash/u, 'no smuggled query or fragment');
});

test('a joinable remote room connects in place, and only falls back to redirecting', () => {
  const route = server.match(/async function routeRemoteRoomJoin[\s\S]*?\n}/u)[0];
  assert.match(route, /crossServerConnect/u, 'offers a connection');
  assert.ok(
    route.indexOf('crossServerConnect') < route.indexOf('crossServerRedirect'),
    'the redirect is the fallback, not the default'
  );
  assert.match(route, /crossServerRedirect/u, 'a row with no socket can still be reached');
});

test('the client moves its socket instead of navigating away', () => {
  assert.match(client, /function switchGameServer\(/u);
  const swap = client.match(/function switchGameServer[\s\S]*?\n        }/u)[0];
  assert.match(swap, /multiplayerUrl: target\.toString\(\)/u, 'rewrites the endpoint');
  assert.match(swap, /connectMultiplayer\(\)/u, 'and reconnects, which re-reads it');
  assert.match(swap, /intentionalClose = true/u, 'our own close must not trigger reconnect backoff');
  assert.match(swap, /location\.protocol === 'https:' && target\.protocol !== 'wss:'/u, 'never downgrades');
});

test('assets keep coming from the server that sent the page', () => {
  // The prefix must be fixed at load. Reading it from the live config would break
  // every asset the moment the socket moves to the other deployment.
  assert.match(client, /const EMBEDDED_ASSET_PREFIX = \(\(\) => \{/u);
  const resolver = client.match(/function embeddedAssetPath[\s\S]*?\n        }/u)[0];
  assert.doesNotMatch(resolver, /JIMS_CLIENT_CONFIG/u, 'the resolver must not read the live socket');
  assert.match(resolver, /EMBEDDED_ASSET_PREFIX/u);
});

test('the handoff can be re-issued for a server we move to', () => {
  assert.match(client, /let pendingHandoffToken = initialHandoffToken/u);
  const auth = client.match(/if \(pendingHandoffToken && !isAuthed && !triedHandoff\)[\s\S]*?\n            }/u)[0];
  assert.match(auth, /pendingHandoffToken = ''/u, 'a one-time token is not replayed on reconnect');
});

test('leaving a cross-server room brings the player home', () => {
  assert.match(client, /function returnToHomeServer\(/u);
  const leave = client.match(/function leaveGameToMenu[\s\S]*?const leavingRoomCode[\s\S]*?\n            }/u)[0];
  assert.match(leave, /crossServerSession/u, 'the way back is actually wired, not just defined');
});
