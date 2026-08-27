'use strict';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 5;
const DEFAULT_GLOBAL_CLAIM_ATTEMPTS = 16;

function randomRoomCode(random = Math.random) {
  let code = '';
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

// Local-only deployments keep the original behavior: the in-memory room map is
// the complete namespace, so keep drawing until a free code is found.
function createLocalRoomCode(isLocallyTaken, random = Math.random) {
  let code;
  do {
    code = randomRoomCode(random);
  } while (isLocallyTaken(code));
  return code;
}

// Cross-server deployments must reserve the code in shared Postgres before a
// local room becomes visible. `claim` is expected to be one atomic INSERT / ON
// CONFLICT statement and returns true only for the process that owns the lease.
async function claimGlobalRoomCode({
  isLocallyTaken,
  claim,
  nextCode = randomRoomCode,
  maxAttempts = DEFAULT_GLOBAL_CLAIM_ATTEMPTS
}) {
  const attempts = Number.isInteger(maxAttempts) && maxAttempts > 0
    ? maxAttempts
    : DEFAULT_GLOBAL_CLAIM_ATTEMPTS;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = nextCode();
    if (isLocallyTaken(code)) continue;
    if (await claim(code)) return code;
  }

  const error = new Error('Could not reserve a globally unique room code.');
  error.code = 'room_code_allocation_exhausted';
  throw error;
}

module.exports = {
  DEFAULT_GLOBAL_CLAIM_ATTEMPTS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  randomRoomCode,
  createLocalRoomCode,
  claimGlobalRoomCode
};
