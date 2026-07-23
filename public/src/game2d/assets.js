import { MERIDIAN_MAP } from "../shipData.js";

export const WORLD_SCALE = MERIDIAN_MAP.render.worldScale;
export const WORLD_PADDING = MERIDIAN_MAP.render.worldPadding;
export const WORLD_BOUNDS = MERIDIAN_MAP.bounds;
export const WORLD_WIDTH = (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX) * WORLD_SCALE + WORLD_PADDING * 2;
export const WORLD_HEIGHT = (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ) * WORLD_SCALE + WORLD_PADDING * 2;

export function worldToScreen(x, z) {
  return {
    x: (Number(x) - WORLD_BOUNDS.minX) * WORLD_SCALE + WORLD_PADDING,
    y: (Number(z) - WORLD_BOUNDS.minZ) * WORLD_SCALE + WORLD_PADDING
  };
}

export const PHASER_ASSETS = Object.freeze({
  stars: "/assets/art/Background/Stars-sharedassets0.assets-56.png",
  parallax1: "/assets/art/Background/Paralax1-sharedassets0.assets-115.png",
  taskConsole: "/assets/art/Tasks/Consolas_0-sharedassets0.assets-52.png",
  meetingConsole: "/assets/art/Tasks/Emergency-sharedassets0.assets-181.png",
  maintenanceConsole: "/assets/art/Tasks/panel_doors_bg-sharedassets0.assets-71.png",
  securityConsole: "/assets/art/Tasks/DoorLog-sharedassets0.assets-145.png",
  repairConsole: "/assets/art/Tasks/reactorMeltdown_handprintBase-sharedassets0.assets-124.png",
  incidentMarker: "/assets/art/Tasks/glow-sharedassets0.assets-191.png",
  "room-operations-hub": "/assets/art/Maps/Cafeteria/Cafeteria-sharedassets0.assets-210.png",
  "room-operations-bridge": "/assets/art/Maps/HQAssets-sharedassets0.assets-72.png",
  "room-navigation-control": "/assets/art/Maps/Navigation-sharedassets0.assets-160.png",
  "room-observation-ring": "/assets/art/Maps/Other/PlanetSprites2-sharedassets0.assets-200.png",
  "room-communications-array": "/assets/art/Maps/room_broadcast-sharedassets0.assets-57.png",
  "room-security-operations": "/assets/art/Maps/Security/Security-sharedassets0.assets-162.png",
  "room-medical-wing": "/assets/art/Maps/MedBay-sharedassets0.assets-110.png",
  "room-crew-quarters": "/assets/art/Maps/Lobby/Lobby-sharedassets0.assets-54.png",
  "room-mess-hall": "/assets/art/Maps/Cafeteria/cafeteriaWalls-sharedassets0.assets-152.png",
  "room-cargo-operations": "/assets/art/Maps/Storage/room_storage-sharedassets0.assets-98.png",
  "room-airlock": "/assets/art/Maps/dropshipTop-sharedassets0.assets-134.png",
  "room-engineering-bay": "/assets/art/Maps/Engine-sharedassets0.assets-147.png",
  "room-drone-operations": "/assets/art/Maps/room_weapon-sharedassets0.assets-80.png",
  "room-core-chamber": "/assets/art/Tasks/ReactorRoom-sharedassets0.assets-132.png",
  "room-atmospheric-systems": "/assets/art/Maps/room_O2-sharedassets0.assets-93.png",
  "room-research-laboratory": "/assets/art/Maps/room_science-sharedassets0.assets-90.png",
  "room-data-archive": "/assets/art/Maps/room_specimen-sharedassets0.assets-123.png"
});

export const PLAYER_FRAME_COUNTS = Object.freeze({ walk: 12, death: 42 });

export const PLAYER_MODEL_ASSETS = Object.freeze([
  Object.freeze({ key: "player-base-idle", path: "/assets/player-models/base/idle/idle.png" }),
  ...Array.from({ length: PLAYER_FRAME_COUNTS.walk }, (_, index) => Object.freeze({
    key: `player-base-walk-${String(index + 1).padStart(2, "0")}`,
    path: `/assets/player-models/base/walk/Walk${String(index + 1).padStart(4, "0")}.png`
  })),
  ...Array.from({ length: PLAYER_FRAME_COUNTS.death }, (_, index) => Object.freeze({
    key: `player-base-death-${String(index + 1).padStart(2, "0")}`,
    path: `/assets/player-models/base/death/Dead${String(index + 1).padStart(4, "0")}.png`
  }))
]);

export const PLAYER_COLOUR_PALETTES = Object.freeze({
  cyan: Object.freeze({ main: "#27bad8", shadow: "#126a83" }),
  amber: Object.freeze({ main: "#e2a238", shadow: "#875817" }),
  violet: Object.freeze({ main: "#805bd0", shadow: "#49317f" }),
  lime: Object.freeze({ main: "#54b86a", shadow: "#2b6d3a" }),
  coral: Object.freeze({ main: "#d9575f", shadow: "#812d3a" }),
  white: Object.freeze({ main: "#c8d8dd", shadow: "#70858e" }),
  blue: Object.freeze({ main: "#3f67c9", shadow: "#233b79" }),
  rose: Object.freeze({ main: "#c74f87", shadow: "#783052" })
});

function parseHexColour(value, fallback) {
  const match = /^#?([0-9a-f]{6})$/iu.exec(String(value ?? ""));
  const hex = match?.[1] ?? fallback.replace("#", "");
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16)
  ];
}

export function playerBaseFrameKey(animation, frameIndex = 0) {
  if (animation === "death") {
    return `player-base-death-${String(Math.min(PLAYER_FRAME_COUNTS.death, Math.max(1, frameIndex + 1))).padStart(2, "0")}`;
  }
  if (animation === "walk") {
    return `player-base-walk-${String((Math.max(0, frameIndex) % PLAYER_FRAME_COUNTS.walk) + 1).padStart(2, "0")}`;
  }
  return "player-base-idle";
}

export function colouredPlayerTexture(scene, baseKey, appearance = {}) {
  const paletteName = PLAYER_COLOUR_PALETTES[appearance.colour] ? appearance.colour : "cyan";
  const visorHex = /^#[0-9a-f]{6}$/iu.test(appearance.visor ?? "") ? appearance.visor.toLowerCase() : "#9defff";
  const textureKey = `${baseKey}:${paletteName}:${visorHex.slice(1)}`;
  if (scene.textures.exists(textureKey)) return textureKey;

  const source = scene.textures.get(baseKey).getSourceImage();
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const palette = PLAYER_COLOUR_PALETTES[paletteName];
  const main = parseHexColour(palette.main, "#27bad8");
  const shadow = parseHexColour(palette.shadow, "#126a83");
  const visor = parseHexColour(visorHex, "#9defff");

  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const red = pixels.data[offset];
    const green = pixels.data[offset + 1];
    const blue = pixels.data[offset + 2];
    if (pixels.data[offset + 3] === 0) continue;

    let target = null;
    let intensity = 1;
    if (red - green > 12 && red - blue > 12) {
      target = main;
      intensity = red / 255;
    } else if (blue - red > 12 && blue - green > 12) {
      target = shadow;
      intensity = blue / 255;
    } else if (green - red > 12 && green - blue > 12) {
      target = visor;
      intensity = green / 255;
    }
    if (!target) continue;
    pixels.data[offset] = Math.round(target[0] * intensity);
    pixels.data[offset + 1] = Math.round(target[1] * intensity);
    pixels.data[offset + 2] = Math.round(target[2] * intensity);
  }

  context.putImageData(pixels, 0, 0);
  scene.textures.addCanvas(textureKey, canvas);
  return textureKey;
}

export const STATION_ASSET_KEYS = Object.freeze({
  task: "taskConsole",
  meeting: "meetingConsole",
  security: "securityConsole",
  doorLogs: "securityConsole",
  maintenance: "maintenanceConsole",
  repair: "repairConsole",
  incident: "incidentMarker"
});
