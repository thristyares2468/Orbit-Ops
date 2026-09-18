'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const db = fs.readFileSync(path.join(root, 'db.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const limits = fs.readFileSync(path.join(root, 'antiflood.js'), 'utf8');

test('owned case gifts are a friend-only atomic transfer', () => {
  const start = db.indexOf('async function giftOwnedCase');
  const end = db.indexOf('async function grantItemToAllActiveAccounts', start);
  const source = db.slice(start, end);
  assert.ok(source.length > 1_200, 'the owned-case gift transaction should exist');
  assert.match(source, /BEGIN[\s\S]*?FOR KEY SHARE[\s\S]*?friendships[\s\S]*?status = 'accepted'[\s\S]*?case_inventory[\s\S]*?FOR UPDATE[\s\S]*?quantity = quantity - 1[\s\S]*?ON CONFLICT \(account_id, case_id\)[\s\S]*?COMMIT/u);
  assert.match(source, /ROLLBACK/u, 'a failed transfer must leave the case with its sender');
  assert.match(server, /if \(type === 'giftOwnedCase'\) \{[\s\S]*?handleGiftOwnedCase\(client, data\);/u);
  assert.match(server, /function handleGiftOwnedCase[\s\S]*?normalizeGiftRecipientId[\s\S]*?db\.giftOwnedCase[\s\S]*?sendSkinInventory\(client\)/u);
  assert.match(limits, /giftOwnedCase: \{ ratePerSec: 0\.25, burst: 2 \}/u);
});

test('the giveaway is admin-only, active-account-only, and catalog validated', () => {
  const start = server.indexOf('function handleAdminDistributeItem');
  const end = server.indexOf('function liveDailyRows', start);
  const source = server.slice(start, end);
  assert.ok(source.length > 1_200, 'the giveaway handler should exist');
  assert.match(server, /if \(type === 'adminDistributeItem'\) \{\s*if \(!isAdminUser\(client\)\) return;/u);
  assert.match(source, /skins\.getItem\(String\(data\.itemId \|\| ''\)\.trim\(\)\)/u);
  assert.match(source, /getCustomCaseDefinitions\(\)[\s\S]*?caseDef/u);
  assert.match(source, /db\.grantItemToAllActiveAccounts/u);
  assert.match(db, /SELECT id FROM accounts WHERE status = 'active' ORDER BY id/u);
  assert.match(db, /FROM accounts WHERE status = 'active'/u);
  assert.match(limits, /adminDistributeItem: \{ ratePerSec: 0\.05, burst: 1 \}/u);
});

test('players can gift an owned case and admins have a guarded giveaway control', () => {
  assert.match(html, /id="btn-gift-owned-case"[^>]*>Gift to Friend</u);
  assert.match(html, /function openOwnedCaseGift\(\)[\s\S]*?openMarketGiftDialog\('ownedCase'/u);
  assert.match(html, /kind === 'ownedCase'[\s\S]*?sendPacket\('giftOwnedCase'/u);
  assert.match(html, /id="btn-inv-editor-giveaway"[^>]*>Give to Everyone</u);
  assert.match(html, /function sendInventoryGiveaway\(\)[\s\S]*?confirm\(`Give \$\{kind === 'case'/u);
  assert.match(html, /sendPacket\('adminDistributeItem'/u);
});
