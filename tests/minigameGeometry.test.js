import assert from "node:assert/strict";
import test from "node:test";
import { distanceToPath, shuffled } from "../public/src/tasks/minigames.js";

// The Chart Course panel's own route.
const COURSE = [[28, 196], [110, 150], [186, 178], [258, 96], [330, 44]];

test("a point on the route measures as being on it", () => {
  for (const [x, y] of COURSE) {
    assert.ok(distanceToPath(COURSE, x, y).distance < 1e-9, `${x},${y} is a vertex`);
  }
  // Halfway along the first leg.
  const mid = [(28 + 110) / 2, (196 + 150) / 2];
  assert.ok(distanceToPath(COURSE, mid[0], mid[1]).distance < 1e-9);
});

test("straying is measured perpendicular to the nearest leg", () => {
  // Straight up from the first vertex. The leg runs up and to the right, so the
  // perpendicular distance is shorter than the 40 units travelled.
  const strayed = distanceToPath(COURSE, 28, 156).distance;
  assert.ok(strayed > 0 && strayed < 40, `expected a perpendicular measure, got ${strayed}`);
  // Far off the panel entirely.
  assert.ok(distanceToPath(COURSE, 390, 230).distance > 100);
});

test("the nearest segment is reported, not just the nearest vertex", () => {
  // Sitting just above the middle of the third leg (index 2).
  const [ax, ay] = COURSE[2];
  const [bx, by] = COURSE[3];
  const { segment } = distanceToPath(COURSE, (ax + bx) / 2, (ay + by) / 2 - 4);
  assert.equal(segment, 2);
});

test("a single-segment path still measures", () => {
  const line = [[0, 0], [100, 0]];
  assert.equal(distanceToPath(line, 50, 30).distance, 30);
  // Beyond the end, the distance is to the endpoint rather than to the infinite line.
  assert.equal(distanceToPath(line, 130, 0).distance, 30);
});

test("a degenerate segment does not divide by zero", () => {
  const stuck = [[10, 10], [10, 10]];
  const { distance } = distanceToPath(stuck, 10, 40);
  assert.equal(distance, 30);
  assert.ok(Number.isFinite(distance));
});

test("shuffling keeps every element exactly once", () => {
  const source = [...Array(10).keys()];
  for (let run = 0; run < 200; run++) {
    const out = shuffled(source);
    assert.equal(out.length, source.length);
    assert.deepEqual([...out].sort((a, b) => a - b), source);
  }
});

test("shuffling does not modify the array it was given", () => {
  const source = [1, 2, 3, 4, 5];
  shuffled(source);
  assert.deepEqual(source, [1, 2, 3, 4, 5]);
});

test("every position is reachable by every value", () => {
  // The point of replacing sort(() => Math.random() - 0.5): that comparator
  // leaves elements near where they started far more often than chance. Ten
  // values over 4000 shuffles should put each value in each slot roughly 400
  // times; a wide margin here still catches a shuffle that barely moves things.
  const N = 10, RUNS = 4000;
  const counts = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let run = 0; run < RUNS; run++) {
    shuffled([...Array(N).keys()]).forEach((value, slot) => { counts[value][slot] += 1; });
  }
  const expected = RUNS / N;
  for (let value = 0; value < N; value++) {
    for (let slot = 0; slot < N; slot++) {
      const seen = counts[value][slot];
      assert.ok(
        seen > expected * 0.6 && seen < expected * 1.4,
        `value ${value} landed in slot ${slot} ${seen} times, expected about ${expected}`
      );
    }
  }
});
