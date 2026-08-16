import assert from "node:assert/strict";
import test from "node:test";
import { ROOM_ALPHABET, ROOM_CODE_LENGTH, allocateRoomCode, randomRoomCode } from "../server/roomCodes.js";

test("a generated code is five characters from the unambiguous alphabet", () => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const code = randomRoomCode();
    assert.equal(code.length, ROOM_CODE_LENGTH);
    assert.ok([...code].every((character) => ROOM_ALPHABET.includes(character)), code);
    // I, O, 0 and 1 stay out so a code read aloud is not ambiguous.
    assert.ok(!/[IO01]/u.test(code), code);
  }
});

test("without a directory, local uniqueness is the whole answer", async () => {
  // random() fixed at 0 always proposes the first letter of the alphabet, so the
  // only way out of the loop is the local gate releasing after the first attempt.
  const taken = new Set([ROOM_ALPHABET[0].repeat(ROOM_CODE_LENGTH)]);
  let attempts = 0;
  const code = await allocateRoomCode({
    isTakenLocally: (candidate) => { attempts += 1; return attempts === 1 && taken.has(candidate); },
    random: () => 0,
    claim: null
  });
  assert.equal(code, ROOM_ALPHABET[0].repeat(ROOM_CODE_LENGTH));
  assert.equal(attempts, 2, "the taken code should have been skipped exactly once");
});

test("a code another instance holds is skipped", async () => {
  const heldElsewhere = new Set();
  let issued = 0;
  const code = await allocateRoomCode({
    isTakenLocally: () => false,
    // The first two claims lose the race, the third wins.
    claim: async (candidate) => {
      issued += 1;
      if (issued < 3) { heldElsewhere.add(candidate); return false; }
      return true;
    }
  });
  assert.equal(issued, 3);
  assert.ok(!heldElsewhere.has(code));
});

test("a locally used code is never even offered to the directory", async () => {
  const offered = [];
  const local = new Set(["QQQQQ"]);
  let first = true;
  await allocateRoomCode({
    isTakenLocally: (candidate) => local.has(candidate),
    random: () => {
      // Return "QQQQQ" once, then anything else.
      if (first) { first = false; return ROOM_ALPHABET.indexOf("Q") / ROOM_ALPHABET.length; }
      return 0;
    },
    claim: async (candidate) => { offered.push(candidate); return true; }
  });
  assert.ok(!offered.includes("QQQQQ"));
});

test("a directory that is down falls back rather than failing the room", async () => {
  const code = await allocateRoomCode({
    isTakenLocally: () => false,
    claim: async () => { throw new Error("connection refused"); }
  });
  // Losing the directory degrades to single-instance behaviour, which is what
  // this deployment has anyway; it must not stop anyone creating a room.
  assert.equal(code.length, ROOM_CODE_LENGTH);
});

test("a saturated directory gives up instead of spinning", async () => {
  await assert.rejects(
    allocateRoomCode({ isTakenLocally: () => false, claim: async () => false, attempts: 4 }),
    /Could not allocate a room code/u
  );
});

test("every attempt is exhausted before giving up", async () => {
  let tries = 0;
  await assert.rejects(allocateRoomCode({
    isTakenLocally: () => false,
    claim: async () => { tries += 1; return false; },
    attempts: 7
  }));
  assert.equal(tries, 7);
});
