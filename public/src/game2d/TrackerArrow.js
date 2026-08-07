// The Tracker's bearing to its mark.
//
// While a track is running the server sends the target's position separately from
// the player list, because the target is normally culled by vision. That is
// deliberate: the Tracker learns a direction, not a sighting. So this draws an
// arrow only while the target is off-screen - once they walk into view you can see
// them yourself and the arrow would just be clutter.
//
// It sits in world space around the player, the same as VentArrows, because the
// camera follows the player and that keeps the two prompts consistent.

const COLOUR = 0x8ce46b;   // the Tracker's own colour, from the role catalogue
const DEPTH = 455;

export class TrackerArrow {
  constructor(scene) {
    this.scene = scene;
    this.container = null;
    this.arrow = null;
    this.label = null;
    this.elapsed = 0;
  }

  ensure(scale) {
    if (this.container) return;
    this.container = this.scene.add.container(0, 0).setDepth(DEPTH);
    // The game's own arrow sprite points +X, so the rotation is the bearing itself.
    this.arrow = this.scene.add.image(0, 0, "trackerArrow")
      .setDisplaySize(46 * scale, 39 * scale)
      .setTint(COLOUR)
      .setAlpha(0.95);
    this.label = this.scene.add.text(0, 26 * scale, "", {
      fontFamily: "monospace",
      fontSize: `${Math.round(12 * scale)}px`,
      color: "#d6ffc7",
      align: "center"
    }).setOrigin(0.5, 0);
    this.container.add([this.arrow, this.label]);
  }

  // origin/target are scene coordinates; onScreen says whether the target is
  // already visible, in which case nothing is drawn.
  show(origin, target, { onScreen, name, scale = 1, distanceUnits = 0 }) {
    if (!origin || !target || onScreen) {
      this.hide();
      return;
    }
    const detail = Math.max(0.6, scale);
    this.ensure(detail);
    const angle = Math.atan2(target.y - origin.y, target.x - origin.x);
    const reach = 92 * detail;
    this.container.setVisible(true);
    this.container.setPosition(origin.x + Math.cos(angle) * reach, origin.y + Math.sin(angle) * reach);
    this.arrow.setRotation(angle);
    // The label stays upright so it reads at any bearing.
    this.label.setText(`${name} · ${Math.round(distanceUnits)}m`);
    this.label.setPosition(0, 26 * detail);
  }

  // Gentle pulse outward, so it reads as a live prompt rather than map furniture.
  update(deltaSeconds) {
    if (!this.container?.visible || !this.arrow) return;
    this.elapsed += deltaSeconds;
    this.arrow.setAlpha(0.78 + Math.sin(this.elapsed * 4) * 0.18);
  }

  hide() {
    this.container?.setVisible(false);
  }

  destroy() {
    this.container?.destroy(true);
    this.container = null;
    this.arrow = null;
    this.label = null;
  }
}
