import {
  buildOrthogonalCorridors,
  pointInCollisionRect,
  pointInMapRect,
  validateMapDefinition
} from "./mapSchema.js";

export const WORLD_BOUNDS = Object.freeze({ minX: -66, maxX: 50, minZ: -46, maxZ: 31 });

export const ROOMS = Object.freeze([
  { id: "operations-hub", name: "Operations Hub", x: 0, z: 0, width: 14, depth: 12, colour: 0x15374d },
  { id: "operations-bridge", name: "Operations Bridge", x: 0, z: -19, width: 16, depth: 10, colour: 0x17465c },
  { id: "navigation-control", name: "Navigation Control", x: 20, z: -19, width: 14, depth: 10, colour: 0x253b65 },
  { id: "observation-ring", name: "Observation Ring", x: 38, z: -19, width: 14, depth: 11, colour: 0x3b285e },
  { id: "communications-array", name: "Communications Array", x: 38, z: -2, width: 14, depth: 11, colour: 0x24485b },
  { id: "security-operations", name: "Security Operations", x: 20, z: 0, width: 13, depth: 11, colour: 0x3b334f },
  { id: "medical-wing", name: "Medical Wing", x: 20, z: 18, width: 15, depth: 11, colour: 0x1f5153 },
  { id: "crew-quarters", name: "Crew Quarters", x: 2, z: 22, width: 14, depth: 10, colour: 0x313d5c },
  { id: "mess-hall", name: "Mess Hall", x: -18, z: 22, width: 15, depth: 11, colour: 0x4c3b39 },
  { id: "cargo-operations", name: "Cargo Operations", x: -36, z: 18, width: 15, depth: 13, colour: 0x443c32 },
  { id: "airlock", name: "Airlock", x: -54, z: 18, width: 10, depth: 9, colour: 0x394b55 },
  { id: "engineering-bay", name: "Engineering Bay", x: -36, z: 0, width: 16, depth: 12, colour: 0x4a342a },
  { id: "drone-operations", name: "Drone Operations", x: -36, z: -22, width: 15, depth: 11, colour: 0x2c4552 },
  { id: "core-chamber", name: "Core Chamber", x: -18, z: -18, width: 16, depth: 13, colour: 0x512d35 },
  { id: "atmospheric-systems", name: "Atmospheric Systems", x: 0, z: -36, width: 15, depth: 10, colour: 0x1d4d4b },
  { id: "research-laboratory", name: "Research Laboratory", x: 20, z: -36, width: 15, depth: 10, colour: 0x33405d },
  { id: "data-archive", name: "Data Archive", x: 38, z: -36, width: 14, depth: 10, colour: 0x263c56 }
]);

export const CONNECTIONS = Object.freeze([
  ["operations-hub", "operations-bridge"], ["operations-bridge", "navigation-control"],
  ["navigation-control", "observation-ring"], ["observation-ring", "communications-array"],
  ["communications-array", "security-operations"], ["security-operations", "operations-hub"],
  ["security-operations", "medical-wing"], ["medical-wing", "crew-quarters"],
  ["crew-quarters", "operations-hub"], ["crew-quarters", "mess-hall"],
  ["mess-hall", "cargo-operations"], ["cargo-operations", "engineering-bay"],
  ["engineering-bay", "core-chamber"], ["core-chamber", "operations-hub"],
  ["core-chamber", "atmospheric-systems"], ["atmospheric-systems", "research-laboratory"],
  ["research-laboratory", "data-archive"], ["data-archive", "observation-ring"],
  ["engineering-bay", "drone-operations"], ["drone-operations", "core-chamber"],
  ["cargo-operations", "airlock"]
]);

export const TASK_DEFINITIONS = Object.freeze([
  { id: "orbital-frequency", name: "Orbital Frequency Alignment", roomId: "communications-array", x: 41, z: -2, kind: "frequency", steps: 4 },
  { id: "core-pressure", name: "Core Pressure Balance", roomId: "core-chamber", x: -20, z: -18, kind: "balance", steps: 4 },
  { id: "route-plotting", name: "Orbital Route Plotting", roomId: "navigation-control", x: 21, z: -19, kind: "route", steps: 4 },
  { id: "signal-reconstruction", name: "Signal Reconstruction", roomId: "data-archive", x: 39, z: -36, kind: "sequence", steps: 4 },
  { id: "sample-classification", name: "Sample Classification", roomId: "research-laboratory", x: 20, z: -36, kind: "classify", steps: 4 },
  { id: "filter-replacement", name: "Atmospheric Filter Replacement", roomId: "atmospheric-systems", x: 0, z: -36, kind: "filter", steps: 4 },
  { id: "cargo-manifest", name: "Cargo Manifest Verification", roomId: "cargo-operations", x: -37, z: 18, kind: "manifest", steps: 4 },
  { id: "engine-sync", name: "Engine Synchronisation", roomId: "engineering-bay", x: -36, z: 0, kind: "sync", steps: 4 },
  { id: "medical-diagnostic", name: "Medical Diagnostic", roomId: "medical-wing", x: 20, z: 18, kind: "scan", steps: 4 },
  { id: "drone-route", name: "Drone Route Programming", roomId: "drone-operations", x: -36, z: -22, kind: "route", steps: 4 }
]);

export const SABOTAGE_DEFINITIONS = Object.freeze([
  { id: "core-overload", name: "Core Overload", critical: true, durationMs: 45000, repairStations: ["core-alpha", "core-beta"], roomId: "core-chamber" },
  { id: "atmospheric-failure", name: "Atmospheric Failure", critical: true, durationMs: 55000, repairStations: ["atmo-north", "atmo-south"], roomId: "atmospheric-systems" },
  { id: "comms-blackout", name: "Communications Blackout", critical: false, durationMs: 40000, repairStations: ["comms-array"], roomId: "communications-array" },
  { id: "lighting-failure", name: "Lighting Failure", critical: false, durationMs: 40000, repairStations: ["lighting-panel"], roomId: "engineering-bay" },
  { id: "door-lockdown", name: "Door Lockdown", critical: false, durationMs: 25000, repairStations: ["security-override"], roomId: "security-operations" },
  { id: "security-interference", name: "Security Interference", critical: false, durationMs: 35000, repairStations: ["security-console"], roomId: "security-operations" }
]);

export const STATIONS = Object.freeze([
  ...TASK_DEFINITIONS.map((task) => ({ id: `task:${task.id}`, type: "task", refId: task.id, roomId: task.roomId, x: task.x, z: task.z })),
  { id: "meeting-console", type: "meeting", roomId: "operations-hub", x: -0.5, z: 0 },
  { id: "camera-console", type: "security", roomId: "security-operations", x: 20, z: 0 },
  { id: "door-logs", type: "doorLogs", roomId: "security-operations", x: 23, z: 1 },
  { id: "maintenance-a", type: "maintenance", refId: "maintenance-b", roomId: "engineering-bay", x: -39, z: 0 },
  { id: "maintenance-b", type: "maintenance", refId: "maintenance-a", roomId: "security-operations", x: 17, z: 0 },
  { id: "maintenance-c", type: "maintenance", refId: "maintenance-d", roomId: "cargo-operations", x: -38, z: 21 },
  { id: "maintenance-d", type: "maintenance", refId: "maintenance-c", roomId: "data-archive", x: 39, z: -34 },
  { id: "core-alpha", type: "repair", refId: "core-overload", roomId: "core-chamber", x: -22, z: -18 },
  { id: "core-beta", type: "repair", refId: "core-overload", roomId: "core-chamber", x: -14, z: -18 },
  { id: "atmo-north", type: "repair", refId: "atmospheric-failure", roomId: "atmospheric-systems", x: -3, z: -36 },
  { id: "atmo-south", type: "repair", refId: "atmospheric-failure", roomId: "atmospheric-systems", x: 3, z: -36 },
  { id: "comms-array", type: "repair", refId: "comms-blackout", roomId: "communications-array", x: 35, z: -2 },
  { id: "lighting-panel", type: "repair", refId: "lighting-failure", roomId: "engineering-bay", x: -32, z: 0 },
  { id: "security-override", type: "repair", refId: "door-lockdown", roomId: "security-operations", x: 18, z: 2 },
  { id: "security-console", type: "repair", refId: "security-interference", roomId: "security-operations", x: 22, z: -2 }
]);

export const SPAWN_POINTS = Object.freeze([
  [-3, 0], [0, -3], [3, 0], [0, 3], [-4, -3], [4, 3], [-4, 3], [4, -3],
  [-1.5, 2], [1.5, -2], [-5, 0], [5, 0], [0, 4], [0, -4], [-2.5, -2.5], [2.5, 2.5]
]);

export const COLLISION_RECTS = Object.freeze([
  { id: "operations-table", kind: "table", roomId: "operations-hub", x: 0, z: 0, width: 4.4, depth: 2.6 },
  { id: "navigation-console-bank", kind: "console", roomId: "navigation-control", x: 24.2, z: -21.5, width: 2.6, depth: 3 },
  { id: "observation-equipment", kind: "console", roomId: "observation-ring", x: 41.5, z: -21.8, width: 3, depth: 2.4 },
  { id: "medical-scanner-bed", kind: "scanner", roomId: "medical-wing", x: 16.3, z: 19.8, width: 3.2, depth: 3 },
  { id: "mess-table", kind: "table", roomId: "mess-hall", x: -18, z: 22, width: 5, depth: 3.2 },
  { id: "cargo-pallets", kind: "cargo", roomId: "cargo-operations", x: -40, z: 20.5, width: 3.4, depth: 3 },
  { id: "engineering-turbine", kind: "engine", roomId: "engineering-bay", x: -40.5, z: -2.2, width: 3.5, depth: 3.2 },
  { id: "research-bench", kind: "console", roomId: "research-laboratory", x: 23.8, z: -37.8, width: 3, depth: 2.4 },
  { id: "archive-stack", kind: "archive", roomId: "data-archive", x: 34.2, z: -38.2, width: 2.8, depth: 2.5 }
]);

export const MAP_OBJECT_GROUPS = Object.freeze([
  Object.freeze({ id: "collisions", kind: "collision", visible: false, objects: COLLISION_RECTS }),
  Object.freeze({ id: "stations", kind: "interaction", visible: false, objects: STATIONS }),
  Object.freeze({
    id: "spawns",
    kind: "spawn",
    visible: false,
    objects: Object.freeze(SPAWN_POINTS.map(([x, z], index) => Object.freeze({ id: `spawn-${index + 1}`, x, z })))
  })
]);

export function getRoom(roomId) {
  return ROOMS.find((room) => room.id === roomId) ?? null;
}

export function buildCorridors(width = 4) {
  return buildOrthogonalCorridors(ROOMS, CONNECTIONS, width);
}

export const CORRIDORS = Object.freeze(buildCorridors());

export const MERIDIAN_MAP = Object.freeze({
  id: "osv-meridian",
  name: "O.S.V. Meridian",
  schemaVersion: 1,
  bounds: WORLD_BOUNDS,
  rooms: ROOMS,
  connections: CONNECTIONS,
  corridors: CORRIDORS,
  collisionRects: COLLISION_RECTS,
  stations: STATIONS,
  spawnPoints: SPAWN_POINTS,
  objectGroups: MAP_OBJECT_GROUPS,
  render: Object.freeze({
    worldScale: 64,
    worldPadding: 320,
    camera: Object.freeze({ clampToBounds: true, roundPixels: true }),
    layers: Object.freeze([
      Object.freeze({ id: "backgrounds", kind: "backgrounds", visible: true, order: 0, depth: -1000 }),
      Object.freeze({ id: "corridors", kind: "corridors", visible: true, order: 1, depth: -300 }),
      Object.freeze({ id: "rooms", kind: "rooms", visible: true, order: 2, depth: -250 }),
      Object.freeze({ id: "stations", kind: "stations", visible: true, order: 3, depth: 210 })
    ]),
    backgrounds: Object.freeze([
      Object.freeze({ type: "tile", assetKey: "stars", alpha: 0.58, depth: -1000 }),
      Object.freeze({ type: "image", assetKey: "parallax1", alpha: 0.13, depth: -990, sizeRatio: 0.72 })
    ]),
    corridor: Object.freeze({
      depth: -300,
      fill: 0x0b202d,
      fillAlpha: 0.98,
      stroke: 0x2b5d6e,
      strokeAlpha: 0.62,
      radius: 18
    }),
    room: Object.freeze({
      depth: -250,
      artAlpha: 0.74,
      frame: 0x7de7f5,
      frameAlpha: 0.32,
      radius: 24
    }),
    station: Object.freeze({ depth: 210, iconSize: 34 })
  })
});

export const MAP_VALIDATION = validateMapDefinition(MERIDIAN_MAP);
if (!MAP_VALIDATION.valid) throw new Error(`Invalid Meridian map: ${MAP_VALIDATION.errors.join(" ")}`);

export function isWalkable(x, z, margin = 0.55) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const insideFloor = MERIDIAN_MAP.rooms.some((room) => pointInMapRect(x, z, room, margin))
    || MERIDIAN_MAP.corridors.some((corridor) => pointInMapRect(x, z, corridor, Math.min(margin, 0.35)));
  if (!insideFloor) return false;
  return !MERIDIAN_MAP.collisionRects.some((rect) => pointInCollisionRect(x, z, rect, margin));
}

export function roomAt(x, z) {
  return MERIDIAN_MAP.rooms.find((room) => pointInMapRect(x, z, room, 0)) ?? null;
}

export function stationById(stationId) {
  return MERIDIAN_MAP.stations.find((station) => station.id === stationId) ?? null;
}

export function distance2D(a, b) {
  return Math.hypot(Number(a?.x) - Number(b?.x), Number(a?.z) - Number(b?.z));
}
