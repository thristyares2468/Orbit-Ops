const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const client = read('index.html');
const server = read('server.js');
const db = read('db.js');
const antiflood = read('antiflood.js');

test('settings live with the account, not just the browser', () => {
  assert.match(db, /ADD COLUMN IF NOT EXISTS settings_json JSONB/u);
  assert.match(db, /^ {2}getAccountSettings,$/mu, 'read helper is exported');
  assert.match(db, /^ {2}saveAccountSettings,$/mu, 'write helper is exported');
});

test('a settings blob cannot be used to stuff the column', () => {
  const save = db.match(/async function saveAccountSettings[\s\S]*?\n}/u)[0];
  assert.match(save, /encoded\.length > 16384/u);
  assert.match(save, /typeof settings !== 'object'/u, 'only objects are stored');
});

test('only the signed-in account can save its own settings', () => {
  const handler = server.match(/if \(type === 'saveSettings'\)[\s\S]*?\n  }/u)[0];
  // The account id comes from the authenticated connection, never from the packet.
  assert.match(handler, /client\.accountId/u);
  assert.doesNotMatch(handler, /data\.accountId/u);
  assert.match(handler, /client\.guest/u, 'guests are excluded');
  assert.match(handler, /Array\.isArray\(data\.settings\)/u, 'an array is not a settings object');
});

test('reading settings cannot break or delay the sign-in', () => {
  const sender = server.match(/function sendAccountSettings[\s\S]*?\n}/u)[0];
  // A second message, not part of authOk: bindAuthenticatedClient is synchronous
  // and a slow database read must not hold up the login.
  assert.match(sender, /\.catch\(/u, 'a failed read is swallowed');
  assert.match(sender, /readyState === 1/u, 'nothing is sent to a closed socket');
  assert.doesNotMatch(server, /await db\.getAccountSettings/u, 'never awaited inline');
});

test('the client syncs settings without flooding the socket', () => {
  const save = client.match(/function saveSettings\(\)[\s\S]*?\n        }/u)[0];
  assert.match(save, /localStorage\.setItem\('webfps_settings'/u, 'still saved locally');
  assert.match(save, /if \(!isAuthed \|\| isGuest\) return;/u, 'guests stay local');
  // saveSettings runs on every slider movement, so the send has to be debounced.
  assert.match(save, /clearTimeout\(settingsSyncTimer\)/u);
  assert.match(save, /setTimeout\(/u);
  assert.match(antiflood, /saveSettings: \{/u, 'and budgeted server-side regardless');
});

test('settings arriving from the account are applied', () => {
  assert.match(client, /type === 'accountSettings'/u);
  const apply = client.match(/function applyAccountSettings[\s\S]*?\n        }/u)[0];
  assert.match(apply, /loadSettings\(\)/u, 'reuses the existing apply-to-UI path');
  assert.match(apply, /localStorage\.setItem\('webfps_settings'/u, 'so the next load starts from them');
});
