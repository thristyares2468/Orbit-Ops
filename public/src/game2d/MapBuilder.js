import { visibleMapLayers } from "../mapSchema.js";
import {
  STATION_ASSET_KEYS,
  worldDetailScale,
  worldMetrics,
  worldToScreen
} from "./assets.js";

function roomShapePoints(room, width, height, inset = 0) {
  const halfWidth = width / 2 - inset;
  const halfHeight = height / 2 - inset;
  if (Array.isArray(room.walkablePolygon) && room.walkablePolygon.length >= 3) {
    const scaleX = halfWidth / (room.width / 2);
    const scaleY = halfHeight / (room.depth / 2);
    return room.walkablePolygon.map((point) => ({ x: point.x * scaleX, y: point.z * scaleY }));
  }
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
  else if (room.shape === "octagon" || Array.isArray(room.walkablePolygon)) graphics.fillPoints(roomShapePoints(room, width, height, inset), true);
  else graphics.fillRoundedRect(-width / 2 + inset, -height / 2 + inset, width - inset * 2, height - inset * 2, radius);
}

function strokeRoomShape(graphics, room, width, height, inset = 0, radius = 0) {
  if (room.shape === "ellipse") graphics.strokeEllipse(0, 0, width - inset * 2, height - inset * 2);
  else if (room.shape === "octagon" || Array.isArray(room.walkablePolygon)) graphics.strokePoints(roomShapePoints(room, width, height, inset), true);
  else graphics.strokeRoundedRect(-width / 2 + inset, -height / 2 + inset, width - inset * 2, height - inset * 2, radius);
}

function clippedRoomTexture(scene, room) {
  const crop = room.artCrop;
  const source = scene.textures.get(room.assetKey).getSourceImage();
  const sourceX = crop?.x ?? 0;
  const sourceY = crop?.y ?? 0;
  const sourceWidth = crop?.width ?? source.width;
  const sourceHeight = crop?.height ?? source.height;
  const textureKey = `${room.assetKey}:room-clip:${room.id}:${sourceX},${sourceY},${sourceWidth},${sourceHeight}`;
  if (scene.textures.exists(textureKey)) return { textureKey, sourceWidth, sourceHeight };

  const canvas = document.createElement("canvas");
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext("2d");
  context.beginPath();
  for (const [index, point] of room.walkablePolygon.entries()) {
    const x = (point.x / room.width + 0.5) * sourceWidth;
    const y = (point.z / room.depth + 0.5) * sourceHeight;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.clip();
  context.drawImage(
    source,
    sourceX, sourceY, sourceWidth, sourceHeight,
    0, 0, sourceWidth, sourceHeight
  );
  scene.textures.addCanvas(textureKey, canvas);
  return { textureKey, sourceWidth, sourceHeight };
}

function stringSeed(value) {
  return [...String(value)].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 2166136261);
}

function drawFloorPattern(graphics, room, width, height, detail) {
  const pattern = room.floorPattern ?? "panels";
  const inset = Math.max(12 * detail, Math.min(width, height) * 0.055);
  const left = -width / 2 + inset;
  const right = width / 2 - inset;
  const top = -height / 2 + inset;
  const bottom = height / 2 - inset;
  const cell = Math.max(28 * detail, Math.min(width, height) / 6);
  const line = room.gridColour ?? 0xd7fbff;
  const alpha = room.gridAlpha ?? 0.1;

  if (pattern === "checker" || pattern === "clean") {
    for (let y = top, row = 0; y < bottom; y += cell, row += 1) {
      for (let x = left, column = 0; x < right; x += cell, column += 1) {
        graphics.fillStyle((row + column) % 2 === 0 ? 0xf4f2db : 0xcbd3c5, pattern === "checker" ? 0.13 : 0.07);
        graphics.fillRect(x, y, Math.min(cell, right - x), Math.min(cell, bottom - y));
      }
    }
    graphics.lineStyle(Math.max(1, detail), line, alpha);
    for (let x = left; x <= right; x += cell) graphics.lineBetween(x, top, x, bottom);
    for (let y = top; y <= bottom; y += cell) graphics.lineBetween(left, y, right, y);
  } else if (pattern === "glass") {
    graphics.fillStyle(0x8ed9e7, 0.09);
    graphics.fillRect(left, top, right - left, bottom - top);
    graphics.lineStyle(Math.max(1, 2 * detail), 0xc8f7ff, 0.14);
    for (let x = left - height; x < right; x += cell * 1.35) {
      graphics.lineBetween(x, bottom, x + (bottom - top), top);
    }
  } else if (pattern === "wood") {
    graphics.lineStyle(Math.max(1, 2 * detail), 0xd2aa6e, 0.17);
    for (let y = top; y <= bottom; y += cell * 0.48) {
      graphics.lineBetween(left, y, right, y);
      const offset = (Math.round(y / (cell * 0.48)) % 2) * cell;
      for (let x = left + offset; x <= right; x += cell * 2) {
        graphics.lineBetween(x, y, x, Math.min(bottom, y + cell * 0.48));
      }
    }
  } else if (pattern === "carpet") {
    graphics.lineStyle(Math.max(1, detail), line, alpha);
    for (let x = left; x <= right; x += cell * 0.42) graphics.lineBetween(x, top, x, bottom);
    graphics.fillStyle(0x091018, 0.12);
    graphics.fillEllipse(0, 0, Math.max(cell, (right - left) * 0.55), Math.max(cell, (bottom - top) * 0.45));
  } else if (pattern === "hazard") {
    graphics.lineStyle(Math.max(2, 5 * detail), 0xf1b83a, 0.3);
    for (let x = left - height; x < right; x += cell * 0.9) {
      graphics.lineBetween(x, bottom, x + (bottom - top), top);
    }
  } else if (pattern === "radial") {
    graphics.lineStyle(Math.max(1, 2 * detail), line, alpha);
    const radius = Math.max(20 * detail, Math.min(right - left, bottom - top) * 0.35);
    graphics.strokeCircle(0, 0, radius);
    graphics.strokeCircle(0, 0, radius * 0.64);
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
      graphics.lineBetween(Math.cos(angle) * radius * 0.68, Math.sin(angle) * radius * 0.68, Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
  } else if (pattern === "snow") {
    const seed = stringSeed(room.id);
    graphics.fillStyle(0xeaf5ff, 0.2);
    for (let index = 0; index < 32; index += 1) {
      const x = left + (((seed + index * 83) % 997) / 997) * (right - left);
      const y = top + (((seed + index * 149) % 991) / 991) * (bottom - top);
      graphics.fillCircle(x, y, (1.5 + index % 3) * detail);
    }
  } else {
    graphics.lineStyle(Math.max(1, 2 * detail), line, alpha);
    for (let x = left; x <= right; x += cell) graphics.lineBetween(x, top, x, bottom);
    for (let y = top; y <= bottom; y += cell) graphics.lineBetween(left, y, right, y);
    graphics.fillStyle(0x02070d, 0.12);
    for (let x = left + cell / 2; x < right; x += cell) {
      for (let y = top + cell / 2; y < bottom; y += cell) graphics.fillCircle(x, y, 2 * detail);
    }
  }
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
      decals: (layer) => this.buildDecals(layer),
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
        depth: zone.depth,
        walkablePolygon: zone.walkablePolygon
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
      graphics.fillStyle(0x02070d, 0.72);
      graphics.fillRoundedRect(
        point.x - width / 2 - 8 * detail,
        point.y - height / 2 - 8 * detail,
        width + 16 * detail,
        height + 16 * detail,
        style.radius * detail
      );
      graphics.fillStyle(style.fill, style.fillAlpha);
      graphics.fillRoundedRect(point.x - width / 2, point.y - height / 2, width, height, style.radius * detail);
      graphics.lineStyle(Math.max(1, 4 * detail), style.stroke, style.strokeAlpha);
      graphics.strokeRoundedRect(point.x - width / 2, point.y - height / 2, width, height, style.radius * detail);
      graphics.lineStyle(Math.max(1, 2 * detail), style.accent ?? 0x64d8e8, style.accentAlpha ?? 0.16);
      if (corridor.axis === "x") {
        graphics.lineBetween(point.x - width / 2 + 14 * detail, point.y, point.x + width / 2 - 14 * detail, point.y);
        for (let x = point.x - width / 2 + 28 * detail; x < point.x + width / 2 - 20 * detail; x += 54 * detail) {
          graphics.lineBetween(x, point.y - height * 0.34, x, point.y + height * 0.34);
        }
      } else {
        graphics.lineBetween(point.x, point.y - height / 2 + 14 * detail, point.x, point.y + height / 2 - 14 * detail);
        for (let y = point.y - height / 2 + 28 * detail; y < point.y + height / 2 - 20 * detail; y += 54 * detail) {
          graphics.lineBetween(point.x - width * 0.34, y, point.x + width * 0.34, y);
        }
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
      fillRoomShape(floor, room, width, height, room.colour, room.floorAlpha ?? 0.96, 0, style.radius * detail);

      const proceduralFloor = this.scene.add.graphics();
      if (!room.assetOnly && room.floorPattern !== false) drawFloorPattern(proceduralFloor, room, width, height, detail);

      let art = null;
      if (room.assetKey) {
        const clipped = room.artClip !== false && Array.isArray(room.walkablePolygon)
          ? clippedRoomTexture(this.scene, room)
          : null;
        art = this.scene.add.image(0, 0, clipped?.textureKey ?? room.assetKey)
          .setAlpha(room.artAlpha ?? style.artAlpha)
          .setData("roomId", room.id);
        const source = this.scene.textures.get(room.assetKey).getSourceImage();
        const sourceWidth = clipped?.sourceWidth ?? room.artCrop?.width ?? source.width;
        const sourceHeight = clipped?.sourceHeight ?? room.artCrop?.height ?? source.height;
        if (room.artCrop && !clipped) {
          art.setCrop(room.artCrop.x, room.artCrop.y, room.artCrop.width, room.artCrop.height);
        }
        const padding = (room.artPadding ?? 12) * detail;
        const targetWidth = Math.max(1, (room.artWidth ?? room.width) * this.metrics.scale - padding);
        const targetHeight = Math.max(1, (room.artDepth ?? room.depth) * this.metrics.scale - padding);
        if (room.artFit === "stretch") {
          art.setDisplaySize(targetWidth, targetHeight);
        } else {
          const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
          art.setDisplaySize(sourceWidth * scale, sourceHeight * scale);
        }
        art.setPosition((room.artOffsetX ?? 0) * this.metrics.scale, (room.artOffsetZ ?? 0) * this.metrics.scale);
        art.setFlipX(Boolean(room.artFlipX));
        art.setFlipY(Boolean(room.artFlipY));
      }

      const walls = this.scene.add.graphics();
      if (!room.assetOnly && room.chrome !== false) {
        fillRoomShape(walls, room, width, height, 0x02070d, 0.18, 6 * detail, 19 * detail);
        walls.lineStyle(Math.max(1, 5 * detail), style.frame, style.frameAlpha);
        strokeRoomShape(walls, room, width, height, 0, style.radius * detail);
        walls.lineStyle(Math.max(1, detail), 0xd7fbff, 0.16);
        strokeRoomShape(walls, room, width, height, 8 * detail, 18 * detail);
      }

      const label = room.label === false || room.worldLabel === false
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

  buildDecals(layerDefinition) {
    const layer = this.createLayer(layerDefinition.id, layerDefinition.depth ?? -200);
    for (const decal of this.map.decals ?? []) {
      const point = worldToScreen(decal.x, decal.z, this.map);
      const image = this.scene.add.image(point.x, point.y, decal.assetKey)
        .setAlpha(decal.alpha ?? 1)
        .setFlipX(Boolean(decal.flipX));
      if (decal.crop) {
        image.setCrop(decal.crop.x, decal.crop.y, decal.crop.width, decal.crop.height);
      }
      image.setDisplaySize(decal.width * this.metrics.scale, decal.depth * this.metrics.scale);
      image.setFlipY(Boolean(decal.flipY));
      if (Number.isFinite(decal.angle)) image.setAngle(decal.angle);
      image.setData({ decalId: decal.id, mapLayer: "decals" });
      layer.add(image);
    }
  }

  buildProps(layerDefinition) {
    const detail = this.detailScale;
    const layer = this.createLayer(layerDefinition.id, layerDefinition.depth ?? this.map.render.prop.depth);
    for (const prop of this.collisionRects.filter((rect) => rect.prop !== false)) {
      const point = worldToScreen(prop.x, prop.z, this.map);
      const width = prop.width * this.metrics.scale;
      const height = prop.depth * this.metrics.scale;
      const container = this.scene.add.container(point.x, point.y).setName(`prop:${prop.id}`);
      const shadow = this.scene.add.ellipse(0, height * 0.32, width * 0.9, Math.max(16 * detail, height * 0.35), 0x020408, 0.35);
      const graphics = this.scene.add.graphics();

      if (prop.kind === "reactor" || prop.kind === "engine") {
        graphics.fillStyle(prop.kind === "reactor" ? 0x293c52 : 0x534436, 1);
        graphics.fillRoundedRect(-width / 2, -height / 2, width, height, 18 * detail);
        graphics.lineStyle(Math.max(2, 6 * detail), prop.kind === "reactor" ? 0x79ecff : 0xf0a866, 0.72);
        graphics.strokeRoundedRect(-width / 2, -height / 2, width, height, 18 * detail);
        graphics.fillStyle(prop.kind === "reactor" ? 0x8af4ff : 0xffca78, 0.34);
        graphics.fillEllipse(0, 0, width * 0.62, height * 0.78);
        graphics.lineStyle(Math.max(1, 2 * detail), 0xffffff, 0.35);
        for (let offset = -0.28; offset <= 0.28; offset += 0.28) {
          graphics.lineBetween(-width * 0.38, height * offset, width * 0.38, height * offset);
        }
      } else if (prop.kind === "table") {
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
      } else if (prop.kind === "bed" || prop.kind === "bench") {
        graphics.fillStyle(prop.kind === "bed" ? 0xc6e8ed : 0x486476, 0.98);
        graphics.fillRoundedRect(-width / 2, -height / 2, width, height, 9 * detail);
        graphics.lineStyle(Math.max(1, 4 * detail), prop.kind === "bed" ? 0xefffff : 0x8eb7c5, 0.62);
        graphics.strokeRoundedRect(-width / 2, -height / 2, width, height, 9 * detail);
        graphics.fillStyle(prop.kind === "bed" ? 0x5e9ec6 : 0x243746, 0.72);
        graphics.fillRoundedRect(-width * 0.36, -height * 0.34, width * 0.72, height * 0.28, 5 * detail);
      } else if (prop.kind === "planter") {
        graphics.fillStyle(0x29483a, 1);
        graphics.fillRoundedRect(-width / 2, -height / 2, width, height, 8 * detail);
        graphics.lineStyle(Math.max(1, 4 * detail), 0x7fbaa0, 0.55);
        graphics.strokeRoundedRect(-width / 2, -height / 2, width, height, 8 * detail);
        graphics.fillStyle(0x5fb46f, 0.82);
        for (let x = -width * 0.36; x <= width * 0.36; x += Math.max(14 * detail, width * 0.18)) {
          graphics.fillEllipse(x, -height * 0.12, width * 0.16, height * 0.62);
        }
      } else if (prop.kind === "hazard") {
        if (String(prop.id).includes("lava")) {
          graphics.fillStyle(0xc94825, 0.96);
          graphics.fillRoundedRect(-width / 2, -height / 2, width, height, height * 0.42);
          graphics.lineStyle(Math.max(2, 6 * detail), 0xffbc3d, 0.78);
          for (let y = -height * 0.28; y <= height * 0.28; y += height * 0.28) {
            graphics.lineBetween(-width * 0.42, y, width * 0.42, y + height * 0.1);
          }
        } else {
          graphics.fillStyle(0x665372, 1);
          graphics.fillEllipse(-width * 0.22, height * 0.08, width * 0.58, height * 0.72);
          graphics.fillEllipse(width * 0.2, -height * 0.1, width * 0.62, height * 0.82);
          graphics.lineStyle(Math.max(1, 4 * detail), 0xb29ac1, 0.44);
          graphics.strokeEllipse(width * 0.2, -height * 0.1, width * 0.62, height * 0.82);
        }
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
      const ringWidth = Number.isFinite(station.ringWidth)
        ? station.ringWidth * this.metrics.scale
        : 45 * detail;
      const ringDepth = Number.isFinite(station.ringDepth)
        ? station.ringDepth * this.metrics.scale
        : 30 * detail;
      const ring = this.scene.add.ellipse(0, 0, ringWidth, ringDepth)
        .setStrokeStyle(Math.max(1, 2 * detail), station.type === "repair" ? 0xffbd4a : 0x74e5ff, 0.72);
      const icon = this.scene.add.image(
        (station.artOffsetX ?? 0) * this.metrics.scale,
        Number.isFinite(station.artOffsetZ) ? station.artOffsetZ * this.metrics.scale : -4 * detail,
        station.assetKey ?? STATION_ASSET_KEYS[station.type] ?? "taskConsole"
      );
      if (Number.isFinite(station.artWidth) && Number.isFinite(station.artDepth)) {
        icon.setDisplaySize(station.artWidth * this.metrics.scale, station.artDepth * this.metrics.scale);
      } else {
        icon.setDisplaySize(style.iconSize * detail, style.iconSize * detail);
      }
      icon.setAlpha(station.artAlpha ?? 0.9);
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
