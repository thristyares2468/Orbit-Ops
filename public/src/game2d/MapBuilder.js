import { MERIDIAN_MAP } from "../shipData.js";
import { visibleMapLayers } from "../mapSchema.js";
import {
  STATION_ASSET_KEYS,
  WORLD_HEIGHT,
  WORLD_SCALE,
  WORLD_WIDTH,
  worldToScreen
} from "./assets.js";

export class MapBuilder {
  constructor(scene, map = MERIDIAN_MAP) {
    this.scene = scene;
    this.map = map;
    this.layers = new Map();
    this.objectGroups = new Map((map.objectGroups ?? []).map((group) => [group.id, group]));
    this.collisionRects = [...(this.objectGroups.get("collisions")?.objects ?? map.collisionRects ?? [])];
    this.roomContainers = new Map();
    this.stationMarkers = [];
  }

  createLayer(name, depth) {
    const layer = this.scene.add.container(0, 0).setDepth(depth).setName(`map:${name}`);
    this.layers.set(name, layer);
    return layer;
  }

  build() {
    const builders = {
      backgrounds: (layer) => this.buildBackgrounds(layer),
      corridors: (layer) => this.buildCorridors(layer),
      rooms: (layer) => this.buildRooms(layer),
      stations: (layer) => this.buildStations(layer)
    };
    for (const layer of visibleMapLayers(this.map)) {
      const buildLayer = builders[layer.kind];
      if (!buildLayer) throw new Error(`Unknown Meridian render layer kind: ${layer.kind}`);
      buildLayer(layer);
    }
    return this;
  }

  buildBackgrounds(layerDefinition) {
    const layer = this.createLayer(layerDefinition.id, layerDefinition.depth);
    for (const background of [...this.map.render.backgrounds].sort((a, b) => a.depth - b.depth)) {
      const object = background.type === "tile"
        ? this.scene.add.tileSprite(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, background.assetKey)
        : this.scene.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, background.assetKey)
          .setDisplaySize(WORLD_WIDTH * background.sizeRatio, WORLD_HEIGHT * background.sizeRatio);
      object.setAlpha(background.alpha).setData("mapLayer", "background");
      layer.add(object);
    }
  }

  buildCorridors(layerDefinition) {
    const style = this.map.render.corridor;
    const layer = this.createLayer(layerDefinition.id, layerDefinition.depth ?? style.depth);
    const graphics = this.scene.add.graphics();
    for (const corridor of this.map.corridors) {
      const point = worldToScreen(corridor.x, corridor.z);
      const width = corridor.width * WORLD_SCALE;
      const height = corridor.depth * WORLD_SCALE;
      graphics.fillStyle(style.fill, style.fillAlpha);
      graphics.fillRoundedRect(point.x - width / 2, point.y - height / 2, width, height, style.radius);
      graphics.lineStyle(4, style.stroke, style.strokeAlpha);
      graphics.strokeRoundedRect(point.x - width / 2, point.y - height / 2, width, height, style.radius);
      graphics.lineStyle(2, 0x64d8e8, 0.08);
      if (corridor.axis === "x") {
        graphics.lineBetween(point.x - width / 2 + 14, point.y, point.x + width / 2 - 14, point.y);
      } else {
        graphics.lineBetween(point.x, point.y - height / 2 + 14, point.x, point.y + height / 2 - 14);
      }
    }
    graphics.setData("mapLayer", "corridors");
    layer.add(graphics);
  }

  buildRooms(layerDefinition) {
    const style = this.map.render.room;
    const layer = this.createLayer(layerDefinition.id, layerDefinition.depth ?? style.depth);
    for (const room of this.map.rooms) {
      const point = worldToScreen(room.x, room.z);
      const width = room.width * WORLD_SCALE;
      const height = room.depth * WORLD_SCALE;
      const roomContainer = this.scene.add.container(point.x, point.y).setName(`room:${room.id}`);

      const floor = this.scene.add.graphics();
      floor.fillStyle(room.colour, 0.96);
      floor.fillRoundedRect(-width / 2, -height / 2, width, height, style.radius);

      const art = this.scene.add.image(0, 0, room.assetKey ?? `room-${room.id}`)
        .setDisplaySize(width - 12, height - 12)
        .setAlpha(room.artAlpha ?? style.artAlpha)
        .setData("roomId", room.id);

      const walls = this.scene.add.graphics();
      walls.fillStyle(0x02070d, 0.18);
      walls.fillRoundedRect(-width / 2 + 6, -height / 2 + 6, width - 12, height - 12, 19);
      walls.lineStyle(5, style.frame, style.frameAlpha);
      walls.strokeRoundedRect(-width / 2, -height / 2, width, height, style.radius);
      walls.lineStyle(1, 0xd7fbff, 0.16);
      walls.strokeRoundedRect(-width / 2 + 8, -height / 2 + 8, width - 16, height - 16, 18);

      const label = this.scene.add.text(0, -height / 2 + 15, room.name.toUpperCase(), {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "13px",
        fontStyle: "bold",
        color: "#d6f9ff",
        stroke: "#031018",
        strokeThickness: 4,
        letterSpacing: 2
      }).setOrigin(0.5, 0);

      roomContainer.add([floor, art, walls, label]);
      roomContainer.setData({
        roomId: room.id,
        collider: { x: room.x, z: room.z, width: room.width, depth: room.depth }
      });
      this.roomContainers.set(room.id, roomContainer);
      layer.add(roomContainer);
    }
  }

  buildStations(layerDefinition) {
    const style = this.map.render.station;
    const layer = this.createLayer(layerDefinition.id, layerDefinition.depth ?? style.depth);
    for (const station of this.map.stations) {
      const point = worldToScreen(station.x, station.z);
      const stationContainer = this.scene.add.container(point.x, point.y).setName(`station:${station.id}`);
      const ring = this.scene.add.ellipse(0, 0, 45, 30)
        .setStrokeStyle(2, station.type === "repair" ? 0xffbd4a : 0x74e5ff, 0.72);
      const icon = this.scene.add.image(0, -4, station.assetKey ?? STATION_ASSET_KEYS[station.type] ?? "taskConsole")
        .setDisplaySize(style.iconSize, style.iconSize)
        .setAlpha(0.9);
      stationContainer.add([ring, icon]);
      stationContainer.setData({ stationId: station.id, roomId: station.roomId, stationType: station.type });
      layer.add(stationContainer);
      this.stationMarkers.push({
        id: station.id,
        roomId: station.roomId,
        container: stationContainer,
        ring,
        icon,
        seed: Math.random() * Math.PI * 2
      });
    }
  }
}
