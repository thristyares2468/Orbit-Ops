'use strict';

// Owner Settings > Player Roles: set any account to user, admin, or owner.
//
// This is a different class of danger than the other owner tools. Balances
// and inventory items are player property; a role is authority over every
// other player. So the checks here are less about "does it work" and more
// about the ways a role tool specifically goes wrong: a plain admin minting
// more admins, an owner locking themselves out, or two accounts ending up
// holding the single Owner seat at once.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const db = fs.readFileSync(path.join(root, 'db.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const limits = fs.readFileSync(path.join(root, 'antiflood.js'), 'utf8');

const setRoleHandler = (() => {
  const start = server.indexOf("if (type === 'adminSetRole')");
  const end = server.indexOf("if (type === 'adminSetMowbucks')");
  assert.ok(start > 0 && end > start, 'the adminSetRole dispatch block is where the tests expect it');
  assert.ok(end - start > 800 && end - start < 4000, 'and is roughly the size of the real handler, not a stray match');
  return server.slice(start, end);
})();

const setAccountRoleFn = (() => {
  const start = db.indexOf('async function setAccountRole');
  const end = db.indexOf('async function findAccountByUsername');
  assert.ok(start > 0 && end > start);
  assert.ok(end - start > 800 && end - start < 3000);
  return db.slice(start, end);
})();

test('granting a role is owner-gated, not admin-gated', () => {
  // Every other owner tool checks isAdminUser. This one must not: an admin
  // handing out admin would have no ceiling.
  for (const type of ['adminListRoles', 'adminSetRole']) {
    const dispatch = server.match(
      new RegExp(`if \\(type === '${type}'\\) \\{\\s*\\n\\s*if \\(!isOwnerAdminUser\\(client\\)`, 'u')
    );
    assert.ok(dispatch, `${type} must be gated on isOwnerAdminUser`);
    assert.doesNotMatch(dispatch[0], /isAdminUser\(client\)/u, `${type} must not accept a plain admin`);
  }
});

test('the requested role is validated against a fixed list', () => {
  assert.match(setRoleHandler, /if \(!\['user', 'admin', 'owner'\]\.includes\(role\)\) \{/u);
  assert.match(setAccountRoleFn, /if \(!\['user', 'admin', 'owner'\]\.includes\(nextRole\)\) return \{ ok: false, reason: 'invalid' \};/u);
});

test('an owner cannot target their own account', () => {
  // This is not a courtesy message - it is what keeps the single-owner
  // invariant closed. The only legal way to stop being owner is to be
  // replaced by a transfer, which always leaves exactly one. Self-targeting
  // is the one path that could reach zero without that guarantee.
  assert.match(setRoleHandler, /if \(accountId === Number\(client\.accountId\)\) \{\s*\n\s*send\(client, 'adminToolsStatus', \{ ok: false, message: 'You cannot change your own role\.' \}\);/u);
});

test('promoting a new owner demotes the current one in the same transaction', () => {
  assert.match(setAccountRoleFn, /BEGIN[\s\S]*?FOR UPDATE[\s\S]*?UPDATE accounts SET role = 'admin' WHERE role = 'owner' AND id <> \$1[\s\S]*?UPDATE accounts SET role = \$2 WHERE id = \$1[\s\S]*?COMMIT/u);
  assert.match(setAccountRoleFn, /ROLLBACK/u, 'a failure part-way must not leave two owners or a half-applied transfer');
  // Demotion only fires for an owner promotion, never for a plain admin/user grant.
  assert.match(setAccountRoleFn, /if \(nextRole === 'owner'\) \{\s*\n\s*const demoted = await client\.query\(/u);
});

test('the previous owner is reported back, so the caller can update that session live', () => {
  assert.match(setAccountRoleFn, /previousOwnerId = demoted\.rows\[0\] \? Number\(demoted\.rows\[0\]\.id\) : null;/u);
  assert.match(setAccountRoleFn, /previousOwnerId\s*\n\s*\};/u);
});

test('a non-owner grant never touches who currently holds owner', () => {
  // Regression guard for the obvious way to break this: an unconditional
  // demotion query that runs on every call rather than only owner promotions.
  const demoteCount = (setAccountRoleFn.match(/role = 'owner'/gu) || []).length;
  assert.equal(demoteCount, 1, 'the owner-role clause should appear exactly once, inside the nextRole === \'owner\' branch');
});

test('both the account being promoted and the one stepping down are updated live', () => {
  assert.match(setRoleHandler, /const target = findClientByAccountId\(String\(accountId\)\);\s*\n\s*if \(target\) \{\s*\n\s*target\.accountRole = role;\s*\n\s*send\(target, 'accountRoleUpdated'/u);
  assert.match(setRoleHandler, /if \(result\.previousOwnerId\) \{\s*\n\s*const previousOwner = findClientByAccountId\(String\(result\.previousOwnerId\)\);\s*\n\s*if \(previousOwner\) \{\s*\n\s*previousOwner\.accountRole = 'admin';\s*\n\s*send\(previousOwner, 'accountRoleUpdated', \{ role: 'admin', isAdmin: true, isOwnerAdmin: false \}\);/u);
});

test('an unknown or missing account fails without mutating anything', () => {
  assert.match(setAccountRoleFn, /if \(!target\.rows\[0\]\) \{ await client\.query\('ROLLBACK'\); return \{ ok: false, reason: 'missing' \}; \}/u);
});

test('every role change is logged with who did it and to whom', () => {
  assert.match(setRoleHandler, /console\.log\(`\[owner-tools\] \$\{client\.username\} set account \$\{accountId\}/u);
  assert.match(setRoleHandler, /event: 'admin_set_role'/u);
});

test('both packets are rate limited, more tightly than the other owner tools', () => {
  assert.match(limits, /adminListRoles: \{ ratePerSec: [\d.]+, burst: \d+ \}/u);
  assert.match(limits, /adminSetRole: \{ ratePerSec: ([\d.]+), burst: \d+ \}/u);
  const setRoleRate = Number(limits.match(/adminSetRole: \{ ratePerSec: ([\d.]+)/u)[1]);
  const setMowbucksRate = Number(limits.match(/adminSetMowbucks: \{ ratePerSec: ([\d.]+)/u)?.[1] ?? 1);
  assert.ok(setRoleRate <= setMowbucksRate, 'privilege escalation should be throttled at least as hard as an economy edit');
});

// --- client -----------------------------------------------------------------

test('the panel button is owner-only, unlike the admin-only tools beside it', () => {
  assert.match(html, /document\.getElementById\('btn-owner-player-roles'\)\.style\.display = accountIsOwnerAdmin \? 'block' : 'none';/u);
  assert.match(html, /function showPlayerRoles\(from = 'title'\) \{\s*\n\s*if \(!accountIsOwnerAdmin\) return;/u);
  assert.match(html, /hubPanels\(\)[\s\S]*?document\.getElementById\('player-roles-menu'\)/u);
});

test('a role is never rewritten as a hidden window.confirm() dialog', () => {
  // This codebase has already been burned by this once: a player turning on
  // Chrome's "don't ask again" makes confirm() permanently return false, and
  // the button just looks broken. Promoting to Owner must warn without one.
  const playerRolesSection = html.slice(html.indexOf("// --- owner tools: player roles"), html.indexOf('function showGrantSkin'));
  assert.doesNotMatch(playerRolesSection, /confirm\(/u);
  assert.match(html, /Owner is one seat — promoting someone new steps you down to Admin\./u);
});

test('the self row is locked out with a numeric id comparison, not a strict one', () => {
  // accounts.id is BIGSERIAL, which node-postgres returns as a string; the
  // account id that reaches the client at login is never wrapped in Number().
  // A strict === here would fail to recognise the owner's own row and offer
  // them an editable control that the server would just reject.
  assert.match(html, /const isSelf = Number\(row\.accountId\) === Number\(myAccountId\);/u);
  assert.doesNotMatch(html, /row\.accountId === myAccountId/u, 'the unguarded strict comparison must not reappear');
});

test('edits are addressed by account id, read once from the list, not from a live-typed field', () => {
  assert.match(html, /sendPacket\('adminSetRole', \{ accountId: row\.accountId, role: chosen \}\);/u);
});

test('a role update on your own live session refreshes the UI without a relog', () => {
  assert.match(html, /accountIsAdmin = !!data\?\.isAdmin;\s*\n\s*accountIsOwnerAdmin = !!data\?\.isOwnerAdmin;\s*\n\s*applyAccountRoleUI\(\);/u);
});

test('applyAccountRoleUI is a single function reused by login and the live update', () => {
  // Extracted out of applyAuthOk rather than duplicated, so the two paths
  // cannot silently drift - a button visible after login but not after a
  // live promotion would be a hard bug to notice.
  const occurrences = (html.match(/applyAccountRoleUI\(\)/gu) || []).length;
  assert.ok(occurrences >= 2, 'applyAccountRoleUI should be called from more than just its own definition');
  const authOkStart = html.indexOf('function applyAuthOk(data) {');
  const authOkCall = html.indexOf('applyAccountRoleUI();', authOkStart);
  assert.ok(authOkStart > 0 && authOkCall > authOkStart && authOkCall - authOkStart < 12_000,
    'applyAuthOk should call applyAccountRoleUI() rather than repeating its body');
});
