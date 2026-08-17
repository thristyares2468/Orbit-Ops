// When a deploy lands while someone is playing, the page they are running is
// already stale - but reloading it mid-match costs them the match. So a pending
// update waits for a moment where a reload costs nothing.
//
// The safe moments are enumerated rather than the unsafe ones. An unrecognised
// phase is treated as "wait", because the failure mode of waiting too long is a
// slightly stale client, and the failure mode of reloading too eagerly is a
// player dropped out of a round they were winning. Every match passes through
// results or the menu eventually, so waiting always ends.

export const RELOAD_SAFE_PHASES = Object.freeze(["menu", "auth", "lobby", "results"]);

export function reloadIsSafe(phase) {
  return RELOAD_SAFE_PHASES.includes(phase ?? "menu");
}

export class UpdateReloader {
  constructor({ reload, notify, delayMs = 1200 } = {}) {
    this.reload = reload ?? (() => globalThis.location?.reload());
    this.notify = notify ?? (() => {});
    this.delayMs = delayMs;
    this.pending = false;
    this.announced = false;
    this.timer = null;
  }

  // A new build is live. Take it now if nothing would be lost, otherwise say so
  // once and wait.
  noteUpdate(phase) {
    this.pending = true;
    this.applyWhenSafe(phase);
  }

  applyWhenSafe(phase) {
    if (!this.pending || this.timer) return false;
    if (!reloadIsSafe(phase)) {
      if (!this.announced) {
        this.announced = true;
        this.notify("An update is ready. It will load when this match ends.");
      }
      return false;
    }
    this.notify("Update ready — reloading.");
    this.timer = setTimeout(() => this.reload(), this.delayMs);
    return true;
  }
}
