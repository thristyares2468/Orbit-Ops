import { visibleMapLayers } from "../mapSchema.js";
import {
  STATION_ASSET_KEYS,
  worldDetailScale,
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
  if (room.shape === "ellipse") graphics.fillEllipse(0, 0, width - inset * 2, height - inset * 2);
  else if (room.shape === "octagon") graphics.fillPoints(roomShapePoints(width, height, inset), true);
  else graphics.fillRoundedRect(-width / 2 + inset, -height / 2 + inset, width - inset * 2, height - inset * 2, radius);
}

function strokeRoomShape(graphics, room, width, height, inset = 0, radius = 0) {
  if (room.shape === "ellipse") graphics.strokeEllipse(0, 0, width - inset * 2, height - inset * 2);
  else if (room.shape === "octagon") graphics.strokePoints(roomShapePoints(width, height, inset), true);
  else graphics.strokeRoundedRect(-width / 2 + inset, -height / 2 + inset, width - inset * 2, height - inset * 2, radius);
}

function stringSeed(value) {
  return [...String(value)].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 2166136261);
}

export class MapBuilder {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.metrics = worldMetrics(map);
    this.detailScale = worldDetailScale(map);
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
      zones: (layer) => this.buildZones(layer),
      corridors: (layer) => this.buildCorridors(layer),
      rooms: (layer) => this.buildRooms(layer),
      props: (layer) => this.buildProps(layer),
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

  buildZones(layerDefinition) {
    const style = this.map.render.zone;
    const detail = this.detailScale;
    const layer = this.createLayer(layerDefinition.id, layerDefinition.depth ?? style.depth);
    for (const zone of this.map.zones ?? []) {
      const point = worldToScreen(zone.x, zone.z, this.map);
      const width = zone.width * this.metrics.scale;
      const height = zone.depth * this.metrics.scale;
      const graphics = this.scene.add.graphics({ x: point.x, y: point.y });
      const zoneStyle = {
        shape: zone.shape,
        width: zone.width,
        depth: zone.depth
      };
      fillRoomShape(graphics, zoneStyle, width, height, zone.colour ?? style.fill, zone.alpha ?? style.fillAlpha, 0, style.radius * detail);
      graphics.lineStyle(Math.max(1, 4 * detail), zone.stroke ?? style.stroke, zone.strokeAlpha ?? style.strokeAlpha);
      strokeRoomShape(graphics, zoneStyle, width, height, 0, style.radius * detail);

      if (zone.pattern === "snow") {
        const seed = stringSeed(zone.id);
        graphics.fillStyle(0xe9f4ff, 0.22);
        for (let index = 0; index < 24; index += 1) {
          const xRatio = (((seed + index * 73) % 997) / 997) - 0.5;
          const zRatio = (((seed + index * 151) % 991) / 991) - 0.5;
          const x = xRatio * Math.max(0, width - 40 * detail);
          const y = zRatio * Math.max(0, height - 40 * detail);
          graphics.fillCircle(x, y, (2 + (index % 3)) * detail);
        }
      }
      graphics.setData("mapLayer", "zones");
      layer.add(graphics);
    }
  }

  buildCorridors(layerDefinition) {
    const style = this.map.render.corridor;
    const detail = this.detailScale;
    const layer = this.createLayer(layerDefinition.id, layerDefinition.depth ?? style.depth);
    const graphics = this.scene.add.graphics();
    for (const corridor of this.map.corridors) {
      const point = worldToScreen(corridor.x, corridor.z, this.map);
      const width = corridor.width * this.metrics.scale;
      const height = corridor.depth * this.metrics.scale;
      graphics.fillStyle(style.fill, style.fillAlpha);
      graphics.fillRoundedRect(point.x - width / 2, point.y - height / 2, width, height, style.radius * detail);
      graphics.lineStyle(Math.max(1, 4 * detail), style.stroke, style.strokeAlpha);
      graphics.strokeRoundedRect(point.x - width / 2, point.y - height / 2, width, height, style.radius * detail);
      graphics.lineStyle(Math.max(1, 2 * detail), 0x64d8e8, 0.08);
      if (corridor.axis === "x") {
        graphics.lineBetween(point.x - width / 2 + 14 * detail, point.y, point.x + width / 2 - 14 * detail, point.y);
      } else {
        graphics.lineBetween(point.x, point.y - height / 2 + 14 * detail, point.x, point.y + height / 2 - 14 * detail);
      }
    }
    graphics.setData("mapLayer", "corridors");
    layer.add(graphics);
  }

  buildRooms(layerDefinition) {
    const style = this.map.render.room;
    const detail = this.detailScale;
    const layer = this.createLayer(layerDefinition.id, layerDefinition.depth ?? style.depth);
    for (const room of this.map.rooms) {
      const point = worldToScreen(room.x, room.z, this.map);
      const width = room.width * this.metrics.scale;
      const height = room.depth * this.metrics.scale;
      const roomContainer = this.scene.add.container(point.x, point.y).setName(`room:${room.id}`);

      const floor = this.scene.add.graphics();
      fillRoomShape(floor, room, width, height, room.colour, 0.96, 0, style.radius * detail);

      const proceduralFloor = this.scene.add.graphics();
      if (!room.assetKey) {
        proceduralFloor.lineStyle(Math.max(1, 2 * detail), room.gridColour ?? 0xe9bf9e, room.gridAlpha ?? 0.08);
        for (let x = -width / 2 + 70 * detail; x < width / 2 - 40 * detail; x += 92 * detail) {
          proceduralFloor.lineBetween(x, -height / 2 + 34 * detail, x, height / 2 - 34 * detail);
        }
        for (let y = -height / 2 + 70 * detail; y < height / 2 - 40 * detail; y += 92 * detail) {
          proceduralFloor.lineBetween(-width / 2 + 34 * detail, y, width / 2 - 34 * detail, y);
        }
        proceduralFloor.fillStyle(0x10161e, 0.18);
        proceduralFloor.fillRoundedRect(-width / 2 + 28 * detail, height / 2 - 62 * detail, Math.max(50 * detail, width * 0.22), 24 * detail, 7 * detail);
        proceduralFloor.fillRoundedRect(width / 2 - Math.max(50 * detail, width * 0.18) - 28 * detail, -height / 2 + 38 * detail, Math.max(50 * detail, width * 0.18), 24 * detail, 7 * detail);
      }

      let art = null;
      if (room.assetKey) {
        art = this.scene.add.image(0, 0, room.assetKey)
          .setAlpha(room.artAlpha ?? style.artAlpha)
          .setData("roomId", room.id);
        const source = this.scene.textures.get(room.assetKey).getSourceImage();
        const sourceWidth = room.artCrop?.width ?? source.width;
        const sourceHeight = room.artCrop?.height ?? source.height;
        if (room.artCrop) {
          art.setCrop(room.artCrop.x, room.artCrop.y, room.artCrop.width, room.artCrop.height);
        }
        const scale = Math.min((width - 12 * detail) / sourceWidth, (height - 12 * detail) / sourceHeight);
        art.setDisplaySize(sourceWidth * scale, sourceHeight * scale);
        art.setFlipX(Boolean(room.artFlipX));
      }

      const walls = this.scene.add.graphics();
      fillRoomShape(walls, room, width, height, 0x02070d, 0.18, 6 * detail, 19 * detail);
      walls.lineStyle(Math.max(1, 5 * detail), style.frame, style.frameAlpha);
      strokeRoomShape(walls, room, width, height, 0, style.radius * detail);
      walls.lineStyle(Math.max(1, detail), 0xd7fbff, 0.16);
      strokeRoomShape(walls, room, width, height, 8 * detail, 18 * detail);

      const label = room.label === false
        ? null
        : this.scene.add.text(0, -height / 2 + 15 * detail, room.name.toUpperCase(), {
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: `${Math.max(10, 13 * detail)}px`,
          fontStyle: "bold",
          color: "#d6f9ff",
          stroke: "#031018",
          strokeThickness: Math.max(2, 4 * detail),
          letterSpacing: Math.max(1, 2 * detail)
        }).setOrigin(0.5, 0);

      roomContainer.add([floor, proceduralFloor, ...(art ? [art] : []), walls, ...(label ? [label] : [])]);
      roomContainer.setData({
        roomId: room.id,
        collider: { x: room.x, z: room.z, width: room.width, depth: room.depth }
      });
      this.roomContainers.set(room.id, roomContainer);
      layer.add(roomContainer);
    }
  }

  buildProps(layerDefinition) {
    const detail = this.detailScale;
    const layer = this.createLayer(layerDefinition.id, layerDefinition.depth ?? this.map.render.prop.depth);
    for (const prop of this.collisionRects) {
      const point = worldToScreen(prop.x, prop.z, this.map);
      const width = prop.width * this.metrics.scale;
      const height = prop.depth * this.metrics.scale;
      const container = this.scene.add.container(point.x, point.y).setName(`prop:${prop.id}`);
      const shadow = this.scene.add.ellipse(0, height * 0.32, width * 0.9, Math.max(16 * detail, height * 0.35), 0x020408, 0.35);
      const graphics = this.scene.add.graphics();

      if (prop.kind === "table") {
        graphics.fillStyle(0x2b5f72, 0.98);
        graphics.fillEllipse(0, 0, width, height);
        graphics.lineStyle(Math.max(1, 5 * detail), 0x89c3cf, 0.55);
        graphics.strokeEllipse(0, 0, width, height);
        graphics.fillStyle(0xbadce3, 0.2);
        graphics.fillEllipse(-width * 0.12, -height * 0.12, width * 0.55, height * 0.35);
      } else if (prop.kind === "cargo") {
        graphics.fillStyle(0x3e5a51, 1);
        graphics.fillRoundedRect(-width / 2, -height / 2, width, height, 9 * detail);
        graphics.lineStyle(Math.max(1, 5 * detail), 0x91a887, 0.6);
        graphics.strokeRoundedRect(-width / 2, -height / 2, width, height, 9 * detail);
        graphics.lineBetween(-width / 2, 0, width / 2, 0);
        graphics.lineBetween(0, -height / 2, 0, height / 2);
      } else if (prop.kind === "scanner") {
        graphics.fillStyle(0x79d9d3, 0.25);
        graphics.fillEllipse(0, 0, width, height);
        graphics.lineStyle(Math.max(1, 5 * detail), 0xaaf6ef, 0.72);
        graphics.strokeEllipse(0, 0, width, height);
        graphics.lineStyle(Math.max(1, 2 * detail), 0xe8ffff, 0.35);
        graphics.strokeEllipse(0, 0, width * 0.65, height * 0.65);
      } else if (prop.kind === "archive") {
        graphics.fillStyle(0x66523c, 1);
        graphics.fillRoundedRect(-width / 2, -height / 2, width, height, 6 * detail);
        graphics.lineStyle(Math.max(1, 4 * detail), 0xc6a977, 0.5);
        graphics.strokeRoundedRect(-width / 2, -height / 2, width, height, 6 * detail);
        for (let offset = -0.3; offset <= 0.3; offset += 0.3) {
          graphics.lineBetween(-width / 2 + 8 * detail, height * offset, width / 2 - 8 * detail, height * offset);
        }
      } else {
        graphics.fillStyle(0x263844, 1);
        graphics.fillRoundedRect(-width / 2, -height / 2, width, height, 8 * detail);
        graphics.lineStyle(Math.max(1, 4 * detail), 0x71cfe0, 0.52);
        graphics.strokeRoundedRect(-width / 2, -height / 2, width, height, 8 * detail);
        graphics.fillStyle(0x7df4de, 0.45);
        graphics.fillRoundedRect(-width * 0.3, -height * 0.18, width * 0.6, height * 0.36, 4 * detail);
      }

      container.add([shadow, graphics]);
      container.setData({ propId: prop.id, propKind: prop.kind, roomId: prop.roomId });
      layer.add(container);
    }
  }

  buildStations(layerDefinition) {
    const style = this.map.render.station;
    const detail = this.detailScale;
    const layer = this.createLayer(layerDefinition.id, layerDefinition.depth ?? style.depth);
    for (const station of this.map.stations) {
      const point = worldToScreen(station.x, station.z, this.map);
      const stationContainer = this.scene.add.container(point.x, point.y).setName(`station:${station.id}`);
      const ring = this.scene.add.ellipse(0, 0, 45 * detail, 30 * detail)
        .setStrokeStyle(Math.max(1, 2 * detail), station.type === "repair" ? 0xffbd4a : 0x74e5ff, 0.72);
      const icon = this.scene.add.image(0, -4 * detail, station.assetKey ?? STATION_ASSET_KEYS[station.type] ?? "taskConsole")
        .setDisplaySize(style.iconSize * detail, style.iconSize * detail)
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
