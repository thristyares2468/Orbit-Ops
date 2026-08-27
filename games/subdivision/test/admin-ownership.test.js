// Last updated: 24 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
const db = fs.readFileSync(path.resolve(__dirname, '..', 'db.js'), 'utf8');
const auth = fs.readFileSync(path.resolve(__dirname, '..', 'auth.js'), 'utf8');

assert.doesNotMatch(server, /OWNER_ACCOUNT_ID|Number\(client\.accountId\) === 3/, 'runtime authority must not be tied to a hardcoded account id');
assert.match(db, /role\s+TEXT NOT NULL DEFAULT 'user' CHECK \(role IN \('user', 'admin', 'owner'\)\)/, 'accounts should persist a constrained authority role');
assert.match(db, /CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_single_owner ON accounts \(role\) WHERE role = 'owner'/, 'the database should allow only one owner');
assert.match(db, /promote_c_didishi_to_owner_2026_08_11[\s\S]*?UPDATE accounts SET role = 'admin' WHERE role = 'owner'[\s\S]*?UPDATE accounts SET role = 'owner' WHERE id = \$1/, 'the requested account should receive the unique owner role through a one-time migration');
assert.match(db, /make_c_didishi_sole_admin_2026_08_11[\s\S]*?UPDATE accounts SET role = 'user' WHERE role IN \('admin', 'owner'\) AND id <> \$1[\s\S]*?UPDATE accounts SET role = 'owner' WHERE id = \$1/, 'the requested owner should be the only administrator after the one-time migration');
assert.match(db, /ALTER TABLE accounts ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'/, 'existing databases should gain the role column without granting privileges');
assert.match(db, /SELECT id, email, email_verified, username, password_hash, role, healthshot_used/, 'login account reads should include the database role');
assert.match(
  server,
  /function isOwnerAdminUser\(client\) \{[\s\S]*?accountRole\(client\) === 'owner';[\s\S]*?\}/,
  'owner authority should come from the authenticated database role'
);
assert.match(
  server,
  /function isAdminUser\(client\) \{[\s\S]*?role === 'admin' \|\| role === 'owner'/,
  'admin role should grant admin access and owner should inherit it'
);
assert.match(server, /client\.accountRole = result\.guest \? 'user' : accountRole/, 'authentication should copy the database role onto the socket');
assert.match(auth, /accountId: account\.id,[\s\S]*?username: account\.username,[\s\S]*?role: account\.role/, 'account authentication should return the persisted role');
assert.doesNotMatch(
  server,
  /ADMIN_USERNAMES|Charlie Smith|apple\.com|C\.ディディ氏/,
  'legacy username-based authority should not remain in the server'
);

console.log('admin ownership regression checks passed');
