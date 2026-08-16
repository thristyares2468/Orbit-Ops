import { closedDoorBarriers } from "../doorPhysics.js";
import { worldToScreen } from "./assets.js";

export class DoorOverlay {
  constructor(scene) {
    this.scene = scene;
    this.map = null;
    this.graphics = scene.add.graphics().setDepth(360);
    this.signature = "";
  }

  setMap(map) {
    this.map = map;
    this.signature = "";
    this.graphics.clear();
  }

  setSabotage(sabotage) {
    const ids = Array.isArray(sabotage?.closedDoorIds) ? [...sabotage.closedDoorIds].sort() : [];
    const signature = ids.join("|");
    if (signature === this.signature) return;
    this.signature = signature;
    this.graphics.clear();
    if (!this.map || ids.length === 0) return;
    const scale = this.map.render.worldScale;
    for (const door of closedDoorBarriers(this.map, sabotage)) {
      const point = worldToScreen(door.x, door.z, this.map);
      const width = Math.max(10, door.width * scale);
      const height = Math.max(10, door.depth * scale);
      const left = point.x - width / 2;
      const top = point.y - height / 2;
      this.graphics.fillStyle(0x192d38, 0.98);
      this.graphics.fillRoundedRect(left, top, width, height, Math.min(5, width / 4, height / 4));
      this.graphics.lineStyle(Math.max(2, 0.06 * scale), 0xffc44d, 0.95);
      this.graphics.strokeRoundedRect(left, top, width, height, Math.min(5, width / 4, height / 4));
      this.graphics.lineStyle(Math.max(1, 0.025 * scale), 0x83e8ff, 0.72);
      const vertical = height > width;
      for (let slot = 1; slot < 4; slot += 1) {
        if (vertical) {
          const y = top + height * slot / 4;
          this.graphics.lineBetween(left + 2, y, left + width - 2, y);
        } else {
          const x = left + width * slot / 4;
          this.graphics.lineBetween(x, top + 2, x, top + height - 2);
        }
      }
    }
  }

  destroy() {
    this.graphics.destroy();
  }
}
