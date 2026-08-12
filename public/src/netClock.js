// Estimates the server's clock and decides how far behind it to render other
// players, so remote crew slide smoothly instead of stepping once per snapshot.
//
// The approach is lifted from the FPS server in this workspace
// (fpsshooterserver/index.html, `netClock`), which solves exactly this problem
// against a much faster-moving game. Two ideas do the work:
//
//   baseline  the rolling MINIMUM of (arrival - serverTime). That difference is
//             the clock offset plus the one-way delay, so its minimum is the
//             best estimate of the offset alone. It creeps upward slowly so a
//             single early packet cannot pin it too low forever.
//
//   delay     how far into the past we render. Sized from measured jitter
//             rather than fixed, so a steady connection gets a short delay and
//             a jittery one gets a longer buffer instead of stutter. It grows
//             quickly when the network worsens and relaxes slowly, because
//             popping forward is far more visible than easing back.

const BASELINE_CREEP_MS_PER_S = 2;
const JITTER_HALFLIFE_MS = 3000;
const DELAY_GROW_MS_PER_S = 240;
const DELAY_SHRINK_MS_PER_S = 20;
const DELAY_MIN_MS = 45;
const DELAY_MAX_MS = 250;

export class NetClock {
  // snapshotIntervalMs must match the server's snapshot period.
  constructor(snapshotIntervalMs = 50) {
    this.snapshotIntervalMs = snapshotIntervalMs;
    this.baseline = null;
    this.lastObservedAt = 0;
    this.jitterPeak = 0;
    this.delay = 1.5 * snapshotIntervalMs + 20;
    this.delayTarget = this.delay;
  }

  // Called for every snapshot that carries a server timestamp.
  observe(serverTime, arrival = performance.now()) {
    if (!Number.isFinite(serverTime)) return;
    const difference = arrival - serverTime;
    const elapsed = this.lastObservedAt ? arrival - this.lastObservedAt : 0;
    this.lastObservedAt = arrival;
    if (this.baseline === null) {
      this.baseline = difference;
      return;
    }
    this.baseline += BASELINE_CREEP_MS_PER_S * elapsed / 1000;
    if (difference < this.baseline) this.baseline = difference;
    const jitter = Math.min(400, Math.max(0, difference - this.baseline));
    this.jitterPeak = Math.max(jitter, this.jitterPeak * Math.pow(0.5, elapsed / JITTER_HALFLIFE_MS));
    this.delayTarget = Math.min(DELAY_MAX_MS, Math.max(DELAY_MIN_MS,
      Math.ceil(1.5 * this.snapshotIntervalMs + this.jitterPeak + 8)));
  }

  // Ease the live delay toward its target: fast when it must grow, gentle when
  // it may shrink.
  tick(deltaSeconds) {
    if (this.delay < this.delayTarget) {
      this.delay = Math.min(this.delayTarget, this.delay + DELAY_GROW_MS_PER_S * deltaSeconds);
    } else {
      this.delay = Math.max(this.delayTarget, this.delay - DELAY_SHRINK_MS_PER_S * deltaSeconds);
    }
  }

  estimatedServerNow(perfNow = performance.now()) {
    return this.baseline === null ? perfNow : perfNow - this.baseline;
  }

  // The point on the server's timeline that remote players should be drawn at.
  renderServerTime(perfNow = performance.now()) {
    return this.estimatedServerNow(perfNow) - this.delay;
  }

  reset() {
    this.baseline = null;
    this.lastObservedAt = 0;
    this.jitterPeak = 0;
  }
}
