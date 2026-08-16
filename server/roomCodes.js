export const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;

// How many codes to try before giving up. The space is 32^5, so a collision at
// any realistic room count is rare; the cap exists so a directory that is
// unreachable or saturated fails fast rather than spinning.
const DEFAULT_ATTEMPTS = 12;

export function randomRoomCode(random = Math.random) {
  return Array.from({ length: ROOM_CODE_LENGTH },
    () => ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)]).join("");
}

// Allocation is deliberately two gates. `isTakenLocally` is the in-process map,
// which is authoritative for this instance and free to consult. `claim` is the
// shared directory, which decides between instances and may be absent - without
// a database the local gate is the whole answer, which is what it has always
// been and is correct for a single instance.
export async function allocateRoomCode({
  isTakenLocally = () => false,
  claim = null,
  attempts = DEFAULT_ATTEMPTS,
  random = Math.random
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = randomRoomCode(random);
    if (isTakenLocally(code)) continue;
    if (!claim) return code;
    let won = false;
    try {
      won = await claim(code);
    } catch (error) {
      // A directory that is down must not take multiplayer down with it. Fall
      // back to local uniqueness, which is exactly the single-instance case.
      return code;
    }
    if (won) return code;
  }
  throw new Error("Could not allocate a room code. Try again in a moment.");
}
