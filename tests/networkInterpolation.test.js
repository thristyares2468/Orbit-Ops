import assert from "node:assert/strict";
import test from "node:test";
import { CharacterSprite } from "../public/src/game2d/CharacterSprite.js";
import { NetClock } from "../public/src/netClock.js";

test("NetClock estimates server time and grows its interpolation buffer with jitter", () => {
  const clock = new NetClock(50);
  assert.equal(clock.delay, 95);
  clock.observe(1_000, 1_100);
  assert.equal(clock.baseline, 100);
  assert.equal(clock.estimatedServerNow(1_500), 1_400);
  assert.equal(clock.renderServerTime(1_500), 1_305);

  clock.observe(1_050, 1_250);
  assert.ok(clock.delayTarget > clock.delay);
  const target = clock.delayTarget;
  clock.tick(0.25);
  assert.equal(clock.delay, 155, "growth is capped at 240ms per second");
  clock.tick(1);
  assert.equal(clock.delay, target);

  clock.reset();
  assert.equal(clock.baseline, null);
  assert.equal(clock.lastObservedAt, 0);
  assert.equal(clock.jitterPeak, 0);
  assert.equal(clock.estimatedServerNow(2_000), 2_000);
});

test("NetClock ignores invalid server timestamps and caps extreme jitter", () => {
  const clock = new NetClock(50);
  clock.observe(Number.NaN, 1_000);
  assert.equal(clock.baseline, null);
  clock.observe(0, 100);
  clock.observe(50, 10_000);
  assert.equal(clock.delayTarget, 250);
});

function spriteWithSamples(samples, isLocal = false) {
  const sprite = Object.create(CharacterSprite.prototype);
  sprite.samples = samples;
  sprite.isLocal = isLocal;
  return sprite;
}

test("CharacterSprite samples positions on the server timeline", () => {
  const sprite = spriteWithSamples([
    { t: 100, x: 10, y: 20 },
    { t: 200, x: 30, y: 50 },
    { t: 300, x: 50, y: 80 }
  ]);
  assert.deepEqual(sprite.sampleAt(50), { x: 10, y: 20 }, "rendering before the buffer holds the oldest sample");
  assert.deepEqual(sprite.sampleAt(150), { x: 20, y: 35 });
  assert.deepEqual(sprite.sampleAt(300), { x: 50, y: 80 });
  assert.deepEqual(spriteWithSamples(sprite.samples, true).sampleAt(150), null);
  assert.deepEqual(spriteWithSamples([]).sampleAt(150), null);
  assert.deepEqual(sprite.sampleAt(Number.NaN), null);
});

test("CharacterSprite extrapolation is time- and distance-bounded", () => {
  const steady = spriteWithSamples([
    { t: 100, x: 0, y: 0 },
    { t: 200, x: 10, y: 0 }
  ]);
  assert.deepEqual(steady.sampleAt(250), { x: 15, y: 0 });
  assert.deepEqual(steady.sampleAt(1_000), { x: 22, y: 0 }, "extrapolation never runs more than 120ms ahead");

  const burst = spriteWithSamples([
    { t: 100, x: 0, y: 0 },
    { t: 101, x: 100, y: 0 }
  ]);
  assert.deepEqual(burst.sampleAt(221), { x: 160, y: 0 }, "implied velocity is capped to sixty pixels");
});
