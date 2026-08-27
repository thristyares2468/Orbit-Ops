'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const db = require('../db');

test('recognises Railway and network failures that are safe to retry', () => {
  for (const code of ['08006', '57P01', '53300', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']) {
    assert.equal(db.isTransientDatabaseError({ code }), true, code);
  }
  assert.equal(db.isTransientDatabaseError({ code: '23505' }), false, 'constraint failures are not transient');
});

test('only retries read-only statements outside row-locking transactions', () => {
  assert.equal(db.isRetryableRead('SELECT id FROM accounts WHERE id = $1'), true);
  assert.equal(db.isRetryableRead(' show server_version '), true);
  assert.equal(db.isRetryableRead('SELECT * FROM accounts FOR UPDATE'), false);
  assert.equal(db.isRetryableRead('INSERT INTO sessions (token_hash) VALUES ($1)'), false);
  assert.equal(db.isRetryableRead('UPDATE stats SET xp = xp + 1'), false);
  assert.equal(db.isRetryableRead('DELETE FROM sessions'), false);
});
