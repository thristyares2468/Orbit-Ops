'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ROOM_CODE_ALPHABET,
  createLocalRoomCode,
  claimGlobalRoomCode,
  randomRoomCode
} = require('../roomCodes');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('generated room codes keep the existing five-character unambiguous format', () => {
  for (let index = 0; index < 100; index += 1) {
    const code = randomRoomCode();
    assert.equal(code.length, 5);
    assert.match(code, /^[A-HJ-NP-Z2-9]{5}$/);
    for (const character of code) assert.ok(ROOM_CODE_ALPHABET.includes(character));
  }
});

test('local-only allocation keeps retrying against the in-memory namespace', () => {
  const values = [
    ...Array(5).fill(0),
    ...Array(5).fill(1 / ROOM_CODE_ALPHABET.length)
  ];
  const code = createLocalRoomCode(candidate => candidate === 'AAAAA', () => values.shift());
  assert.equal(code, 'BBBBB');
});

test('global allocation skips local collisions and atomically rejected database claims', async () => {
  const candidates = ['LOCAL', 'TAKEN', 'OWNED'];
  const claims = [];
  const code = await claimGlobalRoomCode({
    isLocallyTaken: candidate => candidate === 'LOCAL',
    nextCode: () => candidates.shift(),
    claim: async candidate => {
      claims.push(candidate);
      return candidate === 'OWNED';
    },
    maxAttempts: 3
  });

  assert.equal(code, 'OWNED');
  assert.deepEqual(claims, ['TAKEN', 'OWNED']);
});

test('global allocation has a bounded failure path', async () => {
  let candidates = 0;
  let claims = 0;
  await assert.rejects(
    claimGlobalRoomCode({
      isLocallyTaken: () => false,
      nextCode: () => `FAIL${++candidates}`,
      claim: async () => { claims += 1; return false; },
      maxAttempts: 4
    }),
    error => error?.code === 'room_code_allocation_exhausted'
  );
  assert.equal(candidates, 4);
  assert.equal(claims, 4);
});

test('database claims, renewals, and cleanup are all scoped to an ownership lease', () => {
  const db = read('db.js');
  const server = read('server.js');

  assert.match(db, /async function claimActiveRoom[\s\S]*?ON CONFLICT \(room_code\)[\s\S]*?WHERE active_game_rooms\.expires_at <= now\(\)/);
  assert.match(db, /async function publishActiveRoom[\s\S]*?WHERE active_game_rooms\.lease_id = EXCLUDED\.lease_id OR active_game_rooms\.expires_at <= now\(\)/);
  assert.match(db, /DELETE FROM active_game_rooms WHERE room_code = \$1 AND instance_id = \$2 AND lease_id = \$3/);
  assert.match(db, /WHERE room_code = \$1 AND player_count > 0 AND expires_at > now\(\)/,
    'a claimed-but-not-yet-created room is not advertised to the other host');
  assert.match(server, /crossServerRoomDirectoryEnabled\(\)[\s\S]*?createCrossServerRoom\(client, settings\)/);
  assert.match(server, /rooms\.delete\(roomCode\);\s*removeRoomDirectory\(roomCode, room\)/);
});

test('the lease schema remains compatible with an older active-room writer', () => {
  const db = read('db.js');
  const activeRoomTable = db.match(/CREATE TABLE IF NOT EXISTS active_game_rooms \([\s\S]*?\n\);/)?.[0] || '';

  assert.match(activeRoomTable, /lease_id\s+TEXT[,\n]/,
    'the lease column must remain nullable while old servers omit it from INSERTs');
  assert.doesNotMatch(activeRoomTable, /lease_id\s+TEXT\s+NOT NULL/);
  assert.doesNotMatch(db, /ALTER TABLE active_game_rooms ALTER COLUMN lease_id SET NOT NULL/,
    'the expand migration must not make the legacy INSERT shape fail during a rolling deploy');
  assert.match(db, /ALTER TABLE active_game_rooms ALTER COLUMN lease_id DROP NOT NULL/,
    'a database migrated by the first lease release must be relaxed before an old writer publishes');
  assert.match(db, /INSERT INTO active_game_rooms\s*\n\s*\(room_code, instance_id, lease_id,/,
    'new writers should still claim every room with an explicit ownership lease');
});
