import {
  PLAYER_FRAME_COUNTS,
  colouredPlayerTexture,
  playerBaseFrameKey
} from "./assets.js";

export class CharacterSprite {
  constructor(scene, player, isLocal = false) {
    this.scene = scene;
    this.player = player;
    this.isLocal = isLocal;
    this.target = { x: 0, y: 0 };
    this.lastTargetX = 0;
    // Timestamped positions on the server's timeline. update() plays other crew
    // back from this slightly in the past and slides between two real samples,
    // rather than chasing whatever arrived last - which is what made everyone
    // else move in 10-per-second steps. The local player is excluded: it is
    // predicted, so it must stay on the newest position.
    this.samples = [];
    this.animation = "idle";
    this.phase = Math.random() * Math.PI * 2;
    this.deathStartedAt = player.alive === false ? Number.NEGATIVE_INFINITY : null;
    this.currentAppearance = player.appearance;
    this.currentAppearanceSignature = "";
    this.currentBaseKey = playerBaseFrameKey("idle");
    this.currentTextureKey = "";

    this.shadow = scene.add.ellipse(0, 11, 42, 18, 0x02060c, 0.18);
    this.body = scene.add.image(0, 0, this.currentBaseKey)
      .setDisplaySize(58, 76)
      .setOrigin(0.5, 0.74);
    this.applyAppearance(player.appearance);
    this.bodyBaseScale = { x: this.body.scaleX, y: this.body.scaleY };
    this.localRing = scene.add.ellipse(0, 8, 60, 35)
      .setStrokeStyle(3, 0x8be9ff, 0.9)
      .setVisible(isLocal);
    this.shieldRing = scene.add.ellipse(0, 4, 66, 82)
      .setStrokeStyle(3, 0x55ffc0, 0.9)
      .setVisible(false);
    this.trackedRing = scene.add.ellipse(0, 4, 74, 90)
      .setStrokeStyle(3, 0xffd34e, 0.95)
      .setVisible(false);
    this.nameplate = scene.add.text(0, -58, player.displayName ?? "Explorer", {
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: "15px",
      fontStyle: "bold",
      color: "#e8fbff",
      stroke: "#031018",
      strokeThickness: 5,
      align: "center"
    }).setOrigin(0.5).setVisible(!isLocal);

    this.container = scene.add.container(0, 0, [
      this.shadow,
      this.localRing,
      this.shieldRing,
      this.trackedRing,
      this.body,
      this.nameplate
    ]);
    this.container.setDepth(500);
    this.seen = true;
  }

  applyAppearance(appearance = this.player.appearance) {
    const signature = `${appearance?.colour ?? "cyan"}:${appearance?.visor ?? "#9defff"}`;
    if (signature === this.currentAppearanceSignature) return;
    this.currentAppearance = appearance;
    this.currentAppearanceSignature = signature;
    this.currentTextureKey = "";
    this.setModelFrame(this.currentBaseKey);
  }

  setModelFrame(baseKey) {
    const textureKey = colouredPlayerTexture(this.scene, baseKey, this.currentAppearance);
    if (textureKey === this.currentTextureKey) return;
    this.currentBaseKey = baseKey;
    this.currentTextureKey = textureKey;
    this.body.setTexture(textureKey).setDisplaySize(58, 76);
    this.bodyBaseScale = { x: this.body.scaleX, y: this.body.scaleY };
  }

  applySnapshot(snapshot, immediate = false, serverTime = null) {
    // A fresh snapshot always re-shows the sprite: vanished (ejected) players stay
    // hidden for the living only because the living stop receiving their updates.
    this.container.setVisible(true);
    const next = this.scene.mapPoint(snapshot.x, snapshot.z);
    this.lastTargetX = this.target.x;
    this.target = next;
    if (!this.isLocal && Number.isFinite(serverTime)) {
      const previous = this.samples[this.samples.length - 1];
      // A long gap means a vent hop, a respawn or a stall - slide across the map
      // in those cases and the sprite skates. Drop the history and snap instead.
      if (previous && serverTime - previous.t > 1500) this.samples.length = 0;
      this.samples.push({ t: serverTime, x: next.x, y: next.y });
      if (this.samples.length > 12) this.samples.shift();
    }
    if (immediate) this.samples.length = 0;
    this.animation = snapshot.animation ?? "idle";
    const wasAlive = this.player.alive !== false;
    this.player.alive = snapshot.alive !== false;
    if (wasAlive && !this.player.alive) this.deathStartedAt = performance.now();
    else if (this.player.alive) this.deathStartedAt = null;
    this.applyAppearance(snapshot.visualAppearance ?? this.player.appearance);
    const hiddenAlpha = this.isLocal ? 0.32 : 0.04;
    this.body.setAlpha(snapshot.hidden ? hiddenAlpha : this.player.alive ? 1 : 0.38);
    this.shadow.setAlpha(snapshot.hidden ? 0.05 : this.player.alive ? 0.58 : 0.2);
    this.nameplate.setAlpha(snapshot.hidden ? 0 : this.player.alive ? 1 : 0.5);
    this.shieldRing.setVisible(Boolean(snapshot.shielded));
    if (Math.abs(this.target.x - this.lastTargetX) > 0.3) {
      this.body.setFlipX(this.target.x < this.lastTargetX);
    }
    if (immediate || !Number.isFinite(this.container.x)) {
      this.container.setPosition(next.x, next.y);
    }
  }

  // Out of sight: hidden entirely rather than dimmed, so nothing leaks through the dark.
  setSeen(seen) {
    if (this.seen === seen) return;
    this.seen = seen;
    this.container.setVisible(seen || this.isLocal);
  }

  setTracked(tracked) {
    this.trackedRing.setVisible(Boolean(tracked));
  }

  markDead(vanish = false) {
    if (this.player.alive === false) return;
    this.player.alive = false;
    this.deathStartedAt = vanish ? Number.NEGATIVE_INFINITY : performance.now();
    if (vanish) this.container.setVisible(false);
  }

  // Where this sprite should be drawn on the server's timeline. Returns null for
  // the local player and whenever there is not enough history to interpolate,
  // and the caller falls back to easing toward the newest position.
  sampleAt(renderTime) {
    const buffer = this.samples;
    if (this.isLocal || !buffer.length || !Number.isFinite(renderTime)) return null;
    let before = null;
    let after = null;
    for (let index = 0; index < buffer.length; index++) {
      if (buffer[index].t <= renderTime) {
        before = buffer[index];
        after = buffer[index + 1] ?? null;
      }
    }
    // Render time can sit before everything we hold, just after joining or after
    // the buffer was cleared. Hold the oldest sample; jumping to the newest would
    // pop the sprite forward and then drag it back as the buffer fills.
    if (!before) {
      before = buffer[0];
      after = buffer[1] ?? null;
    }
    if (before && after && after.t > before.t) {
      const ratio = Math.min(1, Math.max(0, (renderTime - before.t) / (after.t - before.t)));
      return {
        x: before.x + (after.x - before.x) * ratio,
        y: before.y + (after.y - before.y) * ratio
      };
    }
    // Render time has run past the newest sample - the next one is late. Carry
    // the last known velocity for a short way so the sprite keeps moving instead
    // of freezing, but cap it: when samples bunch up under lag the implied speed
    // can be enormous and would fling the sprite across the deck.
    const last = buffer[buffer.length - 1];
    const previous = buffer[buffer.length - 2];
    if (last && previous && renderTime > last.t) {
      const span = last.t - previous.t;
      const ahead = Math.min(120, renderTime - last.t);
      const factor = span > 0 ? ahead / span : 0;
      let dx = (last.x - previous.x) * factor;
      let dy = (last.y - previous.y) * factor;
      const distance = Math.hypot(dx, dy);
      const cap = 60;
      if (distance > cap) {
        dx *= cap / distance;
        dy *= cap / distance;
      }
      return { x: last.x + dx, y: last.y + dy };
    }
    return last ? { x: last.x, y: last.y } : null;
  }

  update(deltaSeconds, reducedMotion = false, ghostView = false, renderTime = null) {
    const sampled = this.sampleAt(renderTime);
    if (sampled) {
      this.container.x = sampled.x;
      this.container.y = sampled.y;
    } else {
      const interpolation = 1 - Math.exp(-14 * deltaSeconds);
      this.container.x += (this.target.x - this.container.x) * interpolation;
      this.container.y += (this.target.y - this.container.y) * interpolation;
    }
    this.container.setDepth(500 + Math.round(this.container.y));

    const moving = ["walk", "crouch"].includes(this.animation);
    if (!this.player.alive && ghostView) {
      // Fellow ghosts drift: translucent idle model, gentle hover, no ground shadow.
      this.setModelFrame(playerBaseFrameKey("idle"));
      this.phase += deltaSeconds * 4;
      this.body.y = (reducedMotion ? 0 : Math.sin(this.phase) * 3) - 6;
      this.body.setAlpha(0.5);
      this.shadow.setAlpha(0.04);
      this.nameplate.setAlpha(0.6);
      this.localRing.setVisible(this.isLocal);
      this.localRing.setAlpha(0.5);
      return;
    }
    if (!this.player.alive) {
      const elapsed = this.deathStartedAt === Number.NEGATIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : Math.max(0, performance.now() - (this.deathStartedAt ?? performance.now()));
      const frame = Math.min(PLAYER_FRAME_COUNTS.death - 1, Math.floor(elapsed / 33));
      this.setModelFrame(playerBaseFrameKey("death", frame));
      this.body.y = 0;
      this.shadow.setAlpha(0.08);
      this.localRing.setVisible(false);
      return;
    }

    // Walking now happens at the old sprint speed, so it carries the old sprint
    // cadence; only the deliberate crouch reads as slow.
    const amplitude = reducedMotion || !moving ? 0 : this.animation === "crouch" ? 2 : 3.5;
    const speed = this.animation === "crouch" ? 9 : 14;
    this.phase += deltaSeconds * speed;
    const frame = Math.floor(this.phase / (Math.PI * 2) * PLAYER_FRAME_COUNTS.walk);
    this.setModelFrame(playerBaseFrameKey(moving ? "walk" : "idle", frame));
    this.body.y = Math.sin(this.phase) * amplitude;
    const stretch = moving && !reducedMotion ? 1 + Math.cos(this.phase * 2) * 0.025 : 1;
    this.body.setScale(this.bodyBaseScale.x, this.bodyBaseScale.y * stretch);
    this.localRing.setAlpha(0.62 + Math.sin(this.phase * 0.65) * 0.16);
    this.shieldRing.setAlpha(0.65 + Math.sin(this.phase * 0.8) * 0.18);
    this.trackedRing.setAlpha(0.7 + Math.sin(this.phase * 1.1) * 0.2);
  }

  destroy() {
    this.container.destroy(true);
  }
}
