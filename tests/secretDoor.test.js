import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { SECRET_DOOR_PRESSES, SECRET_DOOR_WINDOW_MS, SecretDoor, codeOpensDoor } from "../public/src/secretDoor.js";

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

test("the access code opens the door, and nothing else does", () => {
  assert.equal(codeOpensDoor("OOSD"), true);
  // Case and surrounding space are forgiven; a player typing it should not be
  // punished for their keyboard.
  assert.equal(codeOpensDoor("oosd"), true);
  assert.equal(codeOpensDoor("  oOsD  "), true);

  for (const wrong of ["", "   ", "OOS", "OOSDX", "OO SD", "DSOO", "ORBIT", "SUBDIVISION"]) {
    assert.equal(codeOpensDoor(wrong), false, `${JSON.stringify(wrong)} must not open it`);
  }
  assert.equal(codeOpensDoor(null), false);
  assert.equal(codeOpensDoor(undefined), false);
});

test("the code is not sitting in the source as plain text", () => {
  // Obscurity, not security - the server route is the real gate. This only stops
  // the answer being found by searching the bundle for likely strings.
  const source = new URL("../public/src/secretDoor.js", import.meta.url);
  return readFile(source, "utf8").then((text) => {
    assert.doesNotMatch(text, /"OOSD"|'OOSD'|`OOSD`/u);
  });
});

test("the prompt leaves no trace in the page source", async () => {
  const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const ui = await readFile(new URL("../public/src/ui.js", import.meta.url), "utf8");
  // Built at runtime, so reading the document reveals neither the prompt nor
  // where a correct answer leads.
  assert.doesNotMatch(index, /access.code/iu);
  assert.doesNotMatch(index, /jims-launch/u);
  assert.match(ui, /openAccessCodePrompt\(\)/u);
  // A wrong answer goes home rather than explaining itself. Comments are stripped
  // first: the check is about what the player is shown, not what the code says.
  const prompt = ui.match(/openAccessCodePrompt\(\) \{[\s\S]*?\n  \}/u)[0]
    .replace(/^\s*\/\/.*$/gmu, "");
  assert.doesNotMatch(prompt, /wrong|incorrect|invalid|try again/iu);
  assert.match(prompt, /showScreen\(/u);
});
