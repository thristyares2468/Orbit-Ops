// Arrows around the vent you are riding, one per exit, pointing the way that exit
// lies and labelled with the key that takes you there.
//
// The server already decides which W/A/S/D key reaches each exit and sends it as
// exit.direction, so the arrow points along that key's axis rather than at the exit's
// true bearing. That keeps the picture honest: two exits can genuinely lie in the same
// compass direction, and what the player needs to know is which key to press.

const KEY_VECTORS = Object.freeze({
  W: Object.freeze({ x: 0, y: -1 }),
  S: Object.freeze({ x: 0, y: 1 }),
  A: Object.freeze({ x: -1, y: 0 }),
  D: Object.freeze({ x: 1, y: 0 })
});

const COLOUR = 0x74e5ff;
const DEPTH = 460;

export class VentArrows {
  constructor(scene) {
    this.scene = scene;
    this.container = null;
    this.arrows = [];
    this.elapsed = 0;
  }

  // exits: [{ id, direction, label, roomId }] from the server's vent state.
  show(centre, exits, detailScale = 1) {
    this.hide();
    if (!centre || !Array.isArray(exits) || exits.length === 0) return;

    const scale = Math.max(0.6, detailScale);
    const reach = 74 * scale;      // clear of the player sprite sitting in the vent
    const size = 16 * scale;       // arrow head half-height

    this.container = this.scene.add.container(centre.x, centre.y).setDepth(DEPTH);
    for (const exit of exits) {
      const vector = KEY_VECTORS[exit.direction];
      if (!vector) continue;

      const group = this.scene.add.container(vector.x * reach, vector.y * reach);
      const angle = Math.atan2(vector.y, vector.x);

      // One polygon per arrow rather than a triangle plus a separate shaft: drawn as
      // two pieces they never quite lined up and read as an L.
      const body = size * 0.30;   // half-thickness of the tail
      const tail = size * 1.5;    // how far the tail runs back from the tip
      const arrow = this.scene.add.graphics();
      arrow.fillStyle(COLOUR, 0.95);
      arrow.beginPath();
      arrow.moveTo(size * 1.15, 0);        // tip
      arrow.lineTo(0, -size * 0.95);       // upper barb
      arrow.lineTo(0, -body);
      arrow.lineTo(-tail, -body);          // tail
      arrow.lineTo(-tail, body);
      arrow.lineTo(0, body);
      arrow.lineTo(0, size * 0.95);        // lower barb
      arrow.closePath();
      arrow.fillPath();
      arrow.setRotation(angle);

      const caption = `${exit.direction}  ${exit.label ?? titleCase(exit.roomId)}`;
      const text = this.scene.add.text(0, 0, caption, {
        fontFamily: "monospace",
        fontSize: `${Math.round(13 * scale)}px`,
        color: "#bff2ff",
        align: "center"
      });
      // Put each label on the far side of its own arrow. Stacking every label below
      // the arrow made a horizontal arrow's caption collide with the vertical one.
      const gap = size * 1.5;
      if (vector.x > 0) text.setOrigin(0, 0.5).setPosition(gap, 0);
      else if (vector.x < 0) text.setOrigin(1, 0.5).setPosition(-gap, 0);
      else if (vector.y > 0) text.setOrigin(0.5, 0).setPosition(0, gap);
      else text.setOrigin(0.5, 1).setPosition(0, -gap);

      group.add([arrow, text]);
      this.container.add(group);
      this.arrows.push({ group, vector });
    }
  }

  // Gentle outward pulse so the arrows read as a prompt rather than map furniture.
  update(deltaSeconds) {
    if (!this.container || !this.arrows.length) return;
    this.elapsed += deltaSeconds;
    const pulse = Math.sin(this.elapsed * 3.4) * 3;
    for (const { group, vector } of this.arrows) {
      group.setPosition(
        group.x + vector.x * pulse * 0.02,
        group.y + vector.y * pulse * 0.02
      );
    }
  }

  moveTo(centre) {
    if (this.container && centre) this.container.setPosition(centre.x, centre.y);
  }

  hide() {
    this.container?.destroy(true);
    this.container = null;
    this.arrows = [];
    this.elapsed = 0;
  }

  destroy() {
    this.hide();
  }
}

function titleCase(value) {
  return String(value ?? "").replaceAll("-", " ").replace(/\b\w/gu, (c) => c.toUpperCase());
}
