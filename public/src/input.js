export class InputController {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.enabled = false;
    this.lastSeq = 0;
    this.lastYaw = 0;

    window.addEventListener("keydown", (event) => this.onKeyDown(event));
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.pressed.clear();
    });
  }

  onKeyDown(event) {
    // Ignore keys typed while input is off (chat, modals, menus); otherwise they
    // queue up and fire the instant control returns to the world.
    if (!this.enabled) return;
    if (!this.keys.has(event.code)) this.pressed.add(event.code);
    this.keys.add(event.code);
    if (["Tab", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
      event.preventDefault();
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.keys.clear();
    this.pressed.clear();
  }

  consume(code) {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  movement() {
    if (!this.enabled) {
      return { x: 0, z: 0, yaw: this.lastYaw, sprint: false, crouch: false, seq: ++this.lastSeq };
    }

    let x = (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0)
      - (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
    let z = (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0)
      - (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0);
    const length = Math.hypot(x, z);
    if (length > 1) {
      x /= length;
      z /= length;
    }
    if (length > 0.01) this.lastYaw = Math.atan2(x, z);

    return {
      x,
      z,
      yaw: this.lastYaw,
      sprint: this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"),
      crouch: this.keys.has("KeyC") || this.keys.has("ControlLeft"),
      seq: ++this.lastSeq
    };
  }
}
