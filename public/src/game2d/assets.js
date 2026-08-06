import { getMapDefinition } from "../shipData.js";

export function worldMetrics(map = getMapDefinition()) {
  const scale = map.render.worldScale;
  const padding = map.render.worldPadding;
  return Object.freeze({
    scale,
    padding,
    bounds: map.bounds,
    width: (map.bounds.maxX - map.bounds.minX) * scale + padding * 2,
    height: (map.bounds.maxZ - map.bounds.minZ) * scale + padding * 2
  });
}

export function worldDetailScale(map = getMapDefinition()) {
  return worldMetrics(map).scale / 46;
}

export function worldToScreen(x, z, map = getMapDefinition()) {
  const metrics = worldMetrics(map);
  return {
    x: (Number(x) - metrics.bounds.minX) * metrics.scale + metrics.padding,
    y: (Number(z) - metrics.bounds.minZ) * metrics.scale + metrics.padding
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
  taskLights: "/assets/art/Tasks/SwitchesPanel-sharedassets0.assets-100.png",
  taskWiring: "/assets/art/Tasks/WiresPanel-sharedassets0.assets-174.png",
  taskNavigation: "/assets/art/Tasks/nav_stabilize_base-sharedassets0.assets-167.png",
  taskWifi: "/assets/art/Tasks/Wifi-sharedassets0.assets-91.png",
  taskGarbage: "/assets/art/Tasks/EmptyGarbage-sharedassets0.assets-63.png",
  taskDivertPower: "/assets/art/Tasks/electricity_Divert_Base-sharedassets0.assets-205.png",
  taskEngineAlign: "/assets/art/Tasks/engineAlign_base-sharedassets0.assets-85.png",
  taskFuel: "/assets/art/Tasks/EngineFuel-sharedassets0.assets-94.png",
  taskAsteroids: "/assets/art/Tasks/Weapons-sharedassets0.assets-173.png",
  adminConsole: "/assets/art/Tasks/CardSlide-sharedassets0.assets-169.png",
  vitalsConsole: "/assets/art/Tasks/Vitals-sharedassets0.assets-78.png",
  lobbyDropship: "/assets/lobby/dropship.png",
  lobbyCargoDoor: "/assets/lobby/cargo-door.png",
  lobbyCrate: "/assets/lobby/crate.png",
  lobbyEquipmentCase: "/assets/lobby/equipment-case.svg",
  lobbyLaptop: "/assets/lobby/laptop.png",
  lobbyExhaust: "/assets/lobby/exhaust.png",
  "skeld-deck": "/assets/maps/skeld-deck.png"
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
  admin: "adminConsole",
  vitals: "vitalsConsole",
  maintenance: "maintenanceConsole",
  repair: "repairConsole",
  incident: "incidentMarker",
  launch: "lobbyLaptop"
});
