import { visibleMapLayers } from "../mapSchema.js";
import {
  STATION_ASSET_KEYS,
  worldMetrics,
  worldToScreen
} from "./assets.js";

function roomShapePoints(width, height, inset = 0) {
  const halfWidth = width / 2 - inset;
  const halfHeight = height / 2 - inset;
  const cut = Math.min(halfWidth * 2, halfHeight * 2) * 0.18;
  return [
    { x: -halfWidth + cut, y: -halfHeight },
    { x: halfWidth - cut, y: -halfHeight },
    { x: halfWidth, y: -halfHeight + cut },
    { x: halfWidth, y: halfHeight - cut },
    { x: halfWidth - cut, y: halfHeight },
    { x: -halfWidth + cut, y: halfHeight },
    { x: -halfWidth, y: halfHeight - cut },
    { x: -halfWidth, y: -halfHeight + cut }
  ];
}

function fillRoomShape(graphics, room, width, height, colour, alpha, inset = 0, radius = 0) {
  graphics.fillStyle(colour, alpha);
  if (room.shape === "octagon") graphics.fillPoints(roomShapePoints(width, height, inset), true);
  else graphics.fillRoundedRect(-width / 2 + inset, -height / 2 + inset, width - inset * 2, height - inset * 2, radius);
}

function strokeRoomShape(graphics, room, width, height, inset = 0, radius = 0) {
  if (room.shape === "octagon") graphics.strokePoints(roomShapePoints(width, height, inset), true);
  else graphics.strokeRoundedRect(-width / 2 + inset, -height / 2 + inset, width - inset * 2, height - inset * 2, radius);
}

export class MapBuilder {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.metrics = worldMetrics(map);
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
      if (!buildLayer) throw new Error(`Unknown map render layer kind: ${layer.kind}`);
      buildLayer(layer);
    }
    return this;
  }

  buildBackgrounds(layerDefinition) {
    const layer = this.createLayer(layerDefinition.id, layerDefinition.depth);
    for (const background of [...this.map.render.backgrounds].sort((a, b) => a.depth - b.depth)) {
      const object = background.type === "tile"
        ? this.scene.add.tileSprite(this.metrics.width / 2, this.metrics.height / 2, this.metrics.width, this.metrics.height, background.assetKey)
        : this.scene.add.image(this.metrics.width / 2, this.metrics.height / 2, background.assetKey)
          .setDisplaySize(this.metrics.width * background.sizeRatio, this.metrics.height * background.sizeRatio);
      object.setAlpha(background.alpha).setData("mapLayer", "background");
      layer.add(object);
    }
  }

  buildCorridors(layerDefinition) {
    const style = this.map.render.corridor;
    const layer = this.createLayer(layerDefinition.id, layerDefinition.depth ?? style.depth);
    const graphics = this.scene.add.graphics();
    for (const corridor of this.map.corridors) {
      const point = worldToScreen(corridor.x, corridor.z, this.map);
      const width = corridor.width * this.metrics.scale;
      const height = corridor.depth * this.metrics.scale;
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
      const point = worldToScreen(room.x, room.z, this.map);
      const width = room.width * this.metrics.scale;
      const height = room.depth * this.metrics.scale;
      const roomContainer = this.scene.add.container(point.x, point.y).setName(`room:${room.id}`);

      const floor = this.scene.add.graphics();
      fillRoomShape(floor, room, width, height, room.colour, 0.96, 0, style.radius);

      const proceduralFloor = this.scene.add.graphics();
      if (!room.assetKey) {
        proceduralFloor.lineStyle(2, 0xe9bf9e, 0.08);
        for (let x = -width / 2 + 70; x < width / 2 - 40; x += 92) {
          proceduralFloor.lineBetween(x, -height / 2 + 34, x, height / 2 - 34);
        }
        for (let y = -height / 2 + 70; y < height / 2 - 40; y += 92) {
          proceduralFloor.lineBetween(-width / 2 + 34, y, width / 2 - 34, y);
        }
        proceduralFloor.fillStyle(0x10161e, 0.18);
        proceduralFloor.fillRoundedRect(-width / 2 + 28, height / 2 - 62, Math.max(50, width * 0.22), 24, 7);
        proceduralFloor.fillRoundedRect(width / 2 - Math.max(50, width * 0.18) - 28, -height / 2 + 38, Math.max(50, width * 0.18), 24, 7);
      }

      const art = room.assetKey
        ? this.scene.add.image(0, 0, room.assetKey)
          .setDisplaySize(width - 12, height - 12)
          .setAlpha(room.artAlpha ?? style.artAlpha)
          .setData("roomId", room.id)
        : null;

      const walls = this.scene.add.graphics();
      fillRoomShape(walls, room, width, height, 0x02070d, 0.18, 6, 19);
      walls.lineStyle(5, style.frame, style.frameAlpha);
      strokeRoomShape(walls, room, width, height, 0, style.radius);
      walls.lineStyle(1, 0xd7fbff, 0.16);
      strokeRoomShape(walls, room, width, height, 8, 18);

      const label = this.scene.add.text(0, -height / 2 + 15, room.name.toUpperCase(), {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "13px",
        fontStyle: "bold",
        color: "#d6f9ff",
        stroke: "#031018",
        strokeThickness: 4,
        letterSpacing: 2
      }).setOrigin(0.5, 0);

      roomContainer.add([floor, proceduralFloor, ...(art ? [art] : []), walls, label]);
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
      const point = worldToScreen(station.x, station.z, this.map);
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

  destroy() {
    for (const layer of this.layers.values()) layer.destroy(true);
    this.layers.clear();
    this.roomContainers.clear();
    this.stationMarkers = [];
  }
}
