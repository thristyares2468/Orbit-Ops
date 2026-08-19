import assert from "node:assert/strict";
import test from "node:test";
import { SECRET_DOOR_PRESSES, SECRET_DOOR_WINDOW_MS, SecretDoor } from "../public/src/secretDoor.js";

function door(options = {}) {
  const state = { clock: 0 };
  state.door = new SecretDoor({ now: () => state.clock, ...options });
  return state;
}

test("the hidden game takes the full run of presses to open", () => {
  const { door: secret } = door();
  for (let press = 1; press < SECRET_DOOR_PRESSES; press += 1) {
    assert.equal(secret.press(), false, `press ${press} must not open it`);
  }
  assert.equal(secret.press(), true);
});

test("opening resets the run", () => {
  const { door: secret } = door();
  for (let press = 0; press < SECRET_DOOR_PRESSES; press += 1) secret.press();
  // Coming back to the manual must not leave the door one press from opening.
  for (let press = 1; press < SECRET_DOOR_PRESSES; press += 1) assert.equal(secret.press(), false);
  assert.equal(secret.press(), true);
});

test("a run that stalls restarts rather than resuming", () => {
  const state = door();
  state.door.press();
  state.door.press();
  state.clock += SECRET_DOOR_WINDOW_MS + 1;
  assert.equal(state.door.press(), false, "a late press starts over");
  for (let press = 2; press < SECRET_DOOR_PRESSES; press += 1) assert.equal(state.door.press(), false);
  assert.equal(state.door.press(), true);
});

test("presses spread over days never accumulate", () => {
  const state = door();
  for (let day = 0; day < 5; day += 1) {
    assert.equal(state.door.press(), false, "one press a day must never open it");
    state.clock += 86_400_000;
  }
});

test("a press exactly on the window boundary still counts", () => {
  const state = door();
  for (let press = 1; press < SECRET_DOOR_PRESSES; press += 1) {
    state.door.press();
    state.clock += SECRET_DOOR_WINDOW_MS;
  }
  assert.equal(state.door.press(), true);
});

test("a run starting at timestamp zero is still timed", () => {
  // Regression: lastAt was initialised to 0 and tested for truthiness, so a run
  // whose first press landed on 0 skipped the staleness check entirely.
  const state = door();
  assert.equal(state.clock, 0);
  state.door.press();
  state.door.press();
  state.clock += SECRET_DOOR_WINDOW_MS + 1;
  assert.equal(state.door.press(), false);
});

test("reset clears a part-finished run", () => {
  const { door: secret } = door();
  secret.press();
  secret.press();
  secret.reset();
  for (let press = 1; press < SECRET_DOOR_PRESSES; press += 1) assert.equal(secret.press(), false);
  assert.equal(secret.press(), true);
});

test("the defaults are five presses inside two seconds", () => {
  assert.equal(SECRET_DOOR_PRESSES, 5);
  assert.equal(SECRET_DOOR_WINDOW_MS, 2000);
});
