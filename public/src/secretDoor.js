// The Ghosts card in the field manual is the way into the hidden game. It used
// to be a link, so a single click opened it and hovering showed the destination
// in the status bar - the card announced itself. It is now an ordinary card,
// indistinguishable from the four beside it, and the way through is pressing the
// word Ghosts repeatedly.
//
// Runs are timed rather than cumulative: each press has to follow the last
// closely, so a click today and two next week do not add up. A run that stalls
// simply restarts, which is what someone jabbing at it expects.

export const SECRET_DOOR_PRESSES = 5;
// Long enough to be unhurried, short enough that a stray click does not linger.
export const SECRET_DOOR_WINDOW_MS = 2000;

export class SecretDoor {
  constructor({ presses = SECRET_DOOR_PRESSES, windowMs = SECRET_DOOR_WINDOW_MS, now = () => Date.now() } = {}) {
    this.presses = Math.max(1, presses);
    this.windowMs = windowMs;
    this.now = now;
    this.count = 0;
    // null rather than 0: a press really can land on timestamp 0 under an
    // injected clock, and testing truthiness would skip the staleness check.
    this.lastAt = null;
  }

  // True when this press is the one that opens it. The caller lets the click
  // through on true and swallows it otherwise.
  press() {
    const at = this.now();
    if (this.lastAt !== null && at - this.lastAt > this.windowMs) this.count = 0;
    this.lastAt = at;
    this.count += 1;
    if (this.count < this.presses) return false;
    // Opening resets the run, so returning to the manual does not leave the door
    // one press from opening again.
    this.count = 0;
    this.lastAt = null;
    return true;
  }

  reset() {
    this.count = 0;
    this.lastAt = null;
  }
}
