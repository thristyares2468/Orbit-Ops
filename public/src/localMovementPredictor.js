import { advancePlayerPosition, movementAnimation } from "./movementPhysics.js";

const copyPosition = (value) => ({ x: Number(value.x), z: Number(value.z) });

export class LocalMovementPredictor {
  constructor({ snapDistance = 0.9, maxHistory = 96 } = {}) {
    this.snapDistance = snapDistance;
    this.maxHistory = maxHistory;
    this.position = null;
    this.history = [];
    this.lastAcknowledgedSeq = -1;
    this.lastAuthoritative = null;
  }

  clear() {
    this.position = null;
    this.history = [];
    this.lastAcknowledgedSeq = -1;
    this.lastAuthoritative = null;
  }

  reset(snapshot) {
    this.position = copyPosition(snapshot);
    this.lastAuthoritative = copyPosition(snapshot);
    this.history = [];
    this.lastAcknowledgedSeq = Math.max(-1, Number(snapshot?.seq) || 0);
    return this.position;
  }

  advance(context) {
    if (!this.position) return null;
    this.position = advancePlayerPosition({ ...context, position: this.position });
    return this.position;
  }

  recordInput(seq) {
    if (!this.position) return;
    this.history.push({ seq: Number(seq), position: copyPosition(this.position) });
    if (this.history.length > this.maxHistory) this.history.splice(0, this.history.length - this.maxHistory);
  }

  reconcile(snapshot, { force = false } = {}) {
    if (!this.position || force) {
      this.reset(snapshot);
      return { position: this.position, snapped: true, error: 0 };
    }
    const sequence = Math.max(0, Number(snapshot?.seq) || 0);
    if (sequence < this.lastAcknowledgedSeq) {
      return { position: this.position, snapped: false, error: 0 };
    }
    const anchor = this.history.find((entry) => entry.seq === sequence);
    const serverPosition = copyPosition(snapshot);
    const authoritativeShift = this.lastAuthoritative
      ? Math.hypot(
        serverPosition.x - this.lastAuthoritative.x,
        serverPosition.z - this.lastAuthoritative.z
      )
      : 0;
    this.lastAuthoritative = serverPosition;
    this.lastAcknowledgedSeq = sequence;
    if (!anchor) {
      // A spawn, meeting relocation, or rejected burst may arrive without a
      // retained input anchor. Large authoritative jumps still have to win.
      if (authoritativeShift > this.snapDistance) {
        this.reset(snapshot);
        return { position: this.position, snapped: true, error: authoritativeShift };
      }
      return { position: this.position, snapped: false, error: 0 };
    }

    const correction = {
      x: serverPosition.x - anchor.position.x,
      z: serverPosition.z - anchor.position.z
    };
    const error = Math.hypot(correction.x, correction.z);
    if (error > this.snapDistance) {
      this.reset(snapshot);
      return { position: this.position, snapped: true, error };
    }

    // Preserve motion produced by inputs the server has not acknowledged yet,
    // shifting that whole tail by the small authoritative correction.
    this.position = {
      x: this.position.x + correction.x,
      z: this.position.z + correction.z
    };
    this.history = this.history
      .filter((entry) => entry.seq > sequence)
      .map((entry) => ({
        ...entry,
        position: {
          x: entry.position.x + correction.x,
          z: entry.position.z + correction.z
        }
      }));
    return { position: this.position, snapped: false, error };
  }

  renderSnapshot(base, input = null) {
    if (!this.position) return base;
    return {
      ...base,
      x: this.position.x,
      z: this.position.z,
      yaw: input?.yaw ?? base?.yaw ?? 0,
      animation: input ? movementAnimation(input) : base?.animation
    };
  }
}
