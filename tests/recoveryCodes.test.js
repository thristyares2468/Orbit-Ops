import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptRecoveryCode, encryptRecoveryCode, generateRecoveryCode,
  normaliseRecoveryCode, recoveryCodeMatches
} from "../server/recoveryCodes.js";

test("a generated code is four groups of four unambiguous characters", () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = generateRecoveryCode();
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/u);
    // I, O, 0 and 1 are excluded so a code read off a screen cannot be ambiguous.
    assert.ok(!/[IO01]/u.test(code), `ambiguous character in ${code}`);
  }
});

test("generated codes differ", () => {
  const codes = new Set(Array.from({ length: 200 }, () => generateRecoveryCode()));
  assert.ok(codes.size > 190, `expected near-unique codes, got ${codes.size}/200`);
});

test("normalisation forgives spacing and case but not bad characters", () => {
  const code = generateRecoveryCode();
  const flat = code.replaceAll("-", "");
  assert.equal(normaliseRecoveryCode(flat.toLowerCase()), code);
  assert.equal(normaliseRecoveryCode(`  ${flat}  `), code);
  assert.equal(normaliseRecoveryCode(flat.split("").join(" ")), code);
  // Wrong length, and characters the alphabet never emits, are refused rather
  // than repaired - there is no safe guess at what an O was meant to be.
  assert.equal(normaliseRecoveryCode(flat.slice(0, 15)), "");
  assert.equal(normaliseRecoveryCode(`${flat}A`), "");
  assert.equal(normaliseRecoveryCode(`OOOO${flat.slice(4)}`), "");
  assert.equal(normaliseRecoveryCode(""), "");
  assert.equal(normaliseRecoveryCode(null), "");
});

test("a code round-trips through encryption", () => {
  const code = generateRecoveryCode();
  const ciphertext = encryptRecoveryCode(code);
  assert.notEqual(ciphertext, code);
  assert.ok(ciphertext.startsWith("v1."));
  assert.equal(decryptRecoveryCode(ciphertext), code);
});

test("encrypting the same code twice gives different ciphertext", () => {
  const code = generateRecoveryCode();
  assert.notEqual(encryptRecoveryCode(code), encryptRecoveryCode(code));
});

test("a tampered or foreign record decrypts to nothing rather than throwing", () => {
  const ciphertext = encryptRecoveryCode(generateRecoveryCode());
  const [version, iv, tag, payload] = ciphertext.split(".");
  const flipped = payload.startsWith("A") ? `B${payload.slice(1)}` : `A${payload.slice(1)}`;
  assert.equal(decryptRecoveryCode([version, iv, tag, flipped].join(".")), "");
  assert.equal(decryptRecoveryCode("garbage"), "");
  assert.equal(decryptRecoveryCode(""), "");
  assert.equal(decryptRecoveryCode(null), "");
  // A record written under a different secret must not decrypt under this one.
  assert.equal(decryptRecoveryCode(encryptRecoveryCode(generateRecoveryCode(), "another-secret-entirely")), "");
});

test("matching accepts the code in any transcription and rejects everything else", () => {
  const code = generateRecoveryCode();
  const ciphertext = encryptRecoveryCode(code);
  assert.ok(recoveryCodeMatches(code, ciphertext));
  assert.ok(recoveryCodeMatches(code.replaceAll("-", "").toLowerCase(), ciphertext));
  assert.ok(!recoveryCodeMatches(generateRecoveryCode(), ciphertext));
  assert.ok(!recoveryCodeMatches("", ciphertext));
  assert.ok(!recoveryCodeMatches(code, null));
  assert.ok(!recoveryCodeMatches(code, "v1.a.b.c"));
});

test("a malformed code cannot be stored", () => {
  assert.throws(() => encryptRecoveryCode("not-a-code"), /malformed/u);
});
