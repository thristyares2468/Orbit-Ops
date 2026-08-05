// Darkness beyond the player's sight radius, as in the reference clone.
//
// Deliberately built from one runtime-generated radial-gradient texture plus four
// solid rectangles rather than shaders or geometry masks: it behaves identically on
// WebGL and Canvas, needs no Phaser version-specific mask API, and costs one draw
// call per frame.

const TEXTURE_KEY = "vision-falloff";
// Texture resolution. The gradient is scaled to the live radius each frame, so this
// only bounds how smooth the falloff edge looks.
const TEXTURE_SIZE = 512;

function ensureFalloffTexture(scene) {
  if (scene.textures.exists(TEXTURE_KEY)) return;
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const context = canvas.getContext("2d");
  const centre = TEXTURE_SIZE / 2;
  const gradient = context.createRadialGradient(centre, centre, 0, centre, centre, centre);
  // Clear at the centre, opaque black at the rim, with a soft shoulder so the edge of
  // sight reads as a fade rather than a hard circle.
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.62, "rgba(0,0,0,0)");
  gradient.addColorStop(0.78, "rgba(0,0,0,0.55)");
  gradient.addColorStop(0.92, "rgba(0,0,0,0.92)");
  gradient.addColorStop(1, "rgba(0,0,0,1)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  scene.textures.addCanvas(TEXTURE_KEY, canvas);
}

export class VisionOverlay {
  constructor(scene, depth = 460) {
    this.scene = scene;
    this.enabled = false;
    this.radiusPx = 0;
    this.targetRadiusPx = 0;
    ensureFalloffTexture(scene);

    this.falloff = scene.add.image(0, 0, TEXTURE_KEY)
      .setDepth(depth)
      .setScrollFactor(1)
      .setVisible(false);
    // Four bands fill everything outside the gradient square. Without them the
    // gradient's own bounds would read as a lit rectangle on a large map.
    this.bands = ["top", "bottom", "left", "right"].map(() =>
      scene.add.rectangle(0, 0, 10, 10, 0x000000, 1)
        .setDepth(depth)
        .setOrigin(0, 0)
        .setScrollFactor(1)
        .setVisible(false));
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.falloff.setVisible(enabled);
    for (const band of this.bands) band.setVisible(enabled);
  }

  // radiusPx is the lit radius in screen pixels; it is eased so a lights sabotage
  // closes in rather than snapping.
  update(centre, radiusPx, deltaSeconds = 0.016, darkness = 1) {
    if (!this.enabled || !centre) return;
    this.targetRadiusPx = radiusPx;
    if (this.radiusPx === 0) this.radiusPx = radiusPx;
    const ease = 1 - Math.exp(-6 * deltaSeconds);
    this.radiusPx += (this.targetRadiusPx - this.radiusPx) * ease;

    // The clear centre of the texture is 62% of its half-width, so scale up to put
    // the requested radius at the start of the falloff shoulder.
    const displaySize = (this.radiusPx / 0.62) * 2;
    this.falloff.setPosition(centre.x, centre.y);
    this.falloff.setDisplaySize(displaySize, displaySize);
    this.falloff.setAlpha(darkness);

    const half = displaySize / 2;
    const left = centre.x - half;
    const right = centre.x + half;
    const top = centre.y - half;
    const bottom = centre.y + half;
    const camera = this.scene.cameras.main;
    // Cover the whole world beyond the gradient square, in world coordinates.
    const worldLeft = camera.getBounds().x - 2000;
    const worldTop = camera.getBounds().y - 2000;
    const worldRight = worldLeft + camera.getBounds().width + 4000;
    const worldBottom = worldTop + camera.getBounds().height + 4000;

    // Overlap the bands a little into the gradient square. The texture is fully
    // opaque at its rim, so overlapping is invisible, while butting them up exactly
    // leaves hairline seams of lit floor from sub-pixel rounding.
    const seam = 2;
    const [bandTop, bandBottom, bandLeft, bandRight] = this.bands;
    bandTop.setPosition(worldLeft, worldTop)
      .setSize(worldRight - worldLeft, Math.max(0, top - worldTop) + seam);
    bandBottom.setPosition(worldLeft, bottom - seam)
      .setSize(worldRight - worldLeft, Math.max(0, worldBottom - bottom) + seam);
    bandLeft.setPosition(worldLeft, top - seam)
      .setSize(Math.max(0, left - worldLeft) + seam, Math.max(0, bottom - top) + seam * 2);
    bandRight.setPosition(right - seam, top - seam)
      .setSize(Math.max(0, worldRight - right) + seam, Math.max(0, bottom - top) + seam * 2);
    for (const band of this.bands) band.setFillStyle(0x000000, darkness);
  }

  destroy() {
    this.falloff.destroy();
    for (const band of this.bands) band.destroy();
    this.bands = [];
  }
}
