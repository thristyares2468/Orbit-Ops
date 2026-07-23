export class InputController {
  constructor(canvas, getSettings) {
    this.canvas = canvas;
    this.getSettings = getSettings;
    this.keys = new Set();
    this.pressed = new Set();
    this.yaw = 0;
    this.pitch = 0.35;
    this.enabled = false;
    this.pointerLocked = false;
    this.lastSeq = 0;

    window.addEventListener("keydown", (event) => this.onKeyDown(event));
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    window.addEventListener("blur", () => this.keys.clear());
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    document.addEventListener("mousemove", (event) => this.onMouseMove(event));
    this.canvas.addEventListener("click", () => {
      if (this.enabled && !this.pointerLocked) this.canvas.requestPointerLock?.();
    });
  }

  onKeyDown(event) {
    if (!this.keys.has(event.code)) this.pressed.add(event.code);
    this.keys.add(event.code);
    if (["Tab", "Space", "ArrowUp", "ArrowDown"].includes(event.code) && this.enabled) event.preventDefault();
  }

  onMouseMove(event) {
    if (!this.enabled || !this.pointerLocked) return;
    const settings = this.getSettings();
    const scale = settings.mouseSensitivity * 0.0018;
    this.yaw -= event.movementX * scale;
    const direction = settings.invertY ? -1 : 1;
    this.pitch = Math.max(-0.2, Math.min(1.05, this.pitch + event.movementY * scale * direction));
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.keys.clear();
      document.exitPointerLock?.();
    }
  }

  consume(code) {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  movement() {
    if (!this.enabled) return { x: 0, z: 0, yaw: this.yaw, sprint: false, crouch: false, seq: ++this.lastSeq };
    const forward = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    const right = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    return {
      x: forward * sin + right * cos,
      z: forward * cos - right * sin,
      yaw: this.yaw,
      sprint: this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"),
      crouch: this.keys.has("KeyC") || this.keys.has("ControlLeft"),
      seq: ++this.lastSeq
    };
  }
}
