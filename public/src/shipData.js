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
  { id: "meeting-console", type: "meeting", roomId: "operations-bridge", x: 0, z: -19 },
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

export function getRoom(roomId) {
  return ROOMS.find((room) => room.id === roomId) ?? null;
}

export function buildCorridors(width = 4) {
  const corridors = [];
  for (const [fromId, toId] of CONNECTIONS) {
    const from = getRoom(fromId);
    const to = getRoom(toId);
    if (!from || !to) continue;
    const midX = (from.x + to.x) / 2;
    corridors.push({
      id: `${fromId}:${toId}:x`, x: midX, z: from.z,
      width: Math.abs(to.x - from.x) + width, depth: width
    });
    const midZ = (from.z + to.z) / 2;
    corridors.push({
      id: `${fromId}:${toId}:z`, x: to.x, z: midZ,
      width, depth: Math.abs(to.z - from.z) + width
    });
  }
  return corridors;
}

export const CORRIDORS = Object.freeze(buildCorridors());

function pointInRect(x, z, rect, margin = 0) {
  return x >= rect.x - rect.width / 2 + margin && x <= rect.x + rect.width / 2 - margin
    && z >= rect.z - rect.depth / 2 + margin && z <= rect.z + rect.depth / 2 - margin;
}

export function isWalkable(x, z, margin = 0.55) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (ROOMS.some((room) => pointInRect(x, z, room, margin))) return true;
  return CORRIDORS.some((corridor) => pointInRect(x, z, corridor, Math.min(margin, 0.35)));
}

export function roomAt(x, z) {
  return ROOMS.find((room) => pointInRect(x, z, room, 0)) ?? null;
}

export function stationById(stationId) {
  return STATIONS.find((station) => station.id === stationId) ?? null;
}

export function distance2D(a, b) {
  return Math.hypot(Number(a?.x) - Number(b?.x), Number(a?.z) - Number(b?.z));
}
