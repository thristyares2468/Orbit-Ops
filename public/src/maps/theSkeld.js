import { createMapDefinition, station, task } from "./mapFactory.js";

const SKELD_ROUTES = [
  { id: "upper-reactor", from: "upper-engine", to: "reactor", via: [{ x: -50, z: -27 }, { x: -50, z: -3 }] },
  { id: "reactor-lower", from: "reactor", to: "lower-engine", via: [{ x: -50, z: 21 }] },
  { id: "upper-cafeteria", from: "upper-engine", to: "cafeteria" },
  { id: "upper-medbay", from: "upper-engine", to: "medbay", via: [{ x: -24, z: -27 }, { x: -24, z: -15 }] },
  { id: "medbay-cafeteria", from: "medbay", to: "cafeteria", via: [{ x: -5, z: -15 }, { x: -5, z: -28 }] },
  { id: "upper-security", from: "upper-engine", to: "security", via: [{ x: -27, z: -27 }] },
  { id: "security-lower", from: "security", to: "lower-engine", via: [{ x: -27, z: 21 }] },
  { id: "lower-electrical", from: "lower-engine", to: "electrical" },
  { id: "lower-storage", from: "lower-engine", to: "storage" },
  { id: "electrical-storage", from: "electrical", to: "storage" },
  { id: "cafeteria-storage", from: "cafeteria", to: "storage" },
  { id: "cafeteria-admin", from: "cafeteria", to: "admin", via: [{ x: 16, z: -28 }] },
  { id: "admin-storage", from: "admin", to: "storage" },
  { id: "cafeteria-weapons", from: "cafeteria", to: "weapons" },
  { id: "weapons-o2", from: "weapons", to: "o2", via: [{ x: 28, z: -26 }] },
  { id: "weapons-navigation", from: "weapons", to: "navigation", via: [{ x: 48, z: -26 }] },
  { id: "o2-navigation", from: "o2", to: "navigation" },
  { id: "navigation-shields", from: "navigation", to: "shields", via: [{ x: 48, z: 23 }] },
  { id: "o2-admin", from: "o2", to: "admin" },
  { id: "admin-shields", from: "admin", to: "shields", via: [{ x: 27, z: 5 }, { x: 27, z: 23 }] },
  { id: "storage-shields", from: "storage", to: "shields" },
  { id: "storage-communications", from: "storage", to: "communications", via: [{ x: 15, z: 24 }] },
  { id: "shields-communications", from: "shields", to: "communications", via: [{ x: 25, z: 23 }, { x: 25, z: 41 }] }
];

export const THE_SKELD = createMapDefinition({
  id: "the-skeld",
  name: "The Skeld",
  shortName: "Skeld",
  description: "The original ship layout: a central Cafeteria and Storage spine with paired engines to port and Navigation to starboard.",
  bounds: { minX: -65, maxX: 65, minZ: -45, maxZ: 47 },
  rooms: [
    { id: "cafeteria", name: "Cafeteria", x: 10, z: -28, width: 30, depth: 24, shape: "octagon", assetKey: "skeld-cafeteria", artAlpha: 0.84, colour: 0x5b6566 },
    { id: "upper-engine", name: "Upper Engine", x: -36, z: -27, width: 19, depth: 13, assetKey: "skeld-engine", artCrop: { x: 416, y: 45, width: 608, height: 305 }, artAlpha: 0.88, colour: 0x4a342a },
    { id: "reactor", name: "Reactor", x: -56, z: -3, width: 12, depth: 22, shape: "octagon", colour: 0x512d35 },
    { id: "security", name: "Security", x: -27, z: -4, width: 9, depth: 14, colour: 0x3b334f },
    { id: "medbay", name: "MedBay", x: -15, z: -15, width: 17, depth: 13, shape: "octagon", assetKey: "skeld-medbay", artCrop: { x: 0, y: 0, width: 520, height: 520 }, artAlpha: 0.88, colour: 0x1f5153 },
    { id: "lower-engine", name: "Lower Engine", x: -36, z: 21, width: 19, depth: 13, assetKey: "skeld-engine", artCrop: { x: 416, y: 632, width: 608, height: 300 }, artAlpha: 0.88, colour: 0x4a342a },
    { id: "electrical", name: "Electrical", x: -14, z: 17, width: 13, depth: 13, colour: 0x594437 },
    { id: "storage", name: "Storage", x: 7, z: 24, width: 23, depth: 22, shape: "octagon", colour: 0x443c32 },
    { id: "communications", name: "Communications", x: 15, z: 41, width: 16, depth: 9, shape: "octagon", colour: 0x24485b },
    { id: "admin", name: "Admin", x: 16, z: 5, width: 15, depth: 13, colour: 0x503040 },
    { id: "shields", name: "Shields", x: 35, z: 23, width: 13, depth: 14, shape: "octagon", colour: 0x3b285e },
    { id: "o2", name: "O2", x: 28, z: -9, width: 10, depth: 10, colour: 0x1d4d4b },
    { id: "weapons", name: "Weapons", x: 39, z: -26, width: 13, depth: 16, shape: "octagon", assetKey: "skeld-weapons", artCrop: { x: 0, y: 0, width: 550, height: 450 }, artAlpha: 0.86, colour: 0x2c4552 },
    { id: "navigation", name: "Navigation", x: 58, z: -5, width: 12, depth: 13, shape: "octagon", assetKey: "skeld-navigation", artCrop: { x: 0, y: 0, width: 344, height: 420 }, artAlpha: 0.88, colour: 0x253b65 }
  ],
  connections: SKELD_ROUTES.map(({ from, to }) => [from, to]),
  corridorRoutes: SKELD_ROUTES,
  tasks: [
    task("skeld-swipe-card", "Swipe Card", "admin", 18, 5, "sequence"),
    task("skeld-align-engine", "Align Engine Output", "upper-engine", -36, -27, "balance"),
    task("skeld-calibrate-distributor", "Calibrate Distributor", "electrical", -14, 17, "sequence"),
    task("skeld-submit-scan", "Submit Scan", "medbay", -18, -15, "scan"),
    task("skeld-stabilize-steering", "Stabilize Steering", "navigation", 59, -5, "route"),
    task("skeld-clean-o2-filter", "Clean O2 Filter", "o2", 28, -9, "filter"),
    task("skeld-empty-garbage", "Empty Garbage", "storage", 3, 28, "classify"),
    task("skeld-prime-shields", "Prime Shields", "shields", 35, 23, "sync")
  ],
  sabotages: [
    { id: "skeld-reactor-meltdown", name: "Reactor Meltdown", critical: true, durationMs: 45000, repairStations: ["skeld-reactor-alpha", "skeld-reactor-beta"], roomId: "reactor" },
    { id: "skeld-o2-depletion", name: "O2 Depletion", critical: true, durationMs: 50000, repairStations: ["skeld-o2-panel", "skeld-admin-o2"], roomId: "o2" },
    { id: "skeld-comms-sabotage", name: "Communications Sabotage", critical: false, durationMs: 40000, repairStations: ["skeld-comms-panel"], roomId: "communications" },
    { id: "skeld-lights-out", name: "Lights Out", critical: false, durationMs: 40000, repairStations: ["skeld-light-panel"], roomId: "electrical" }
  ],
  stations: [
    station("meeting-console", "meeting", "cafeteria", 10, -28),
    station("skeld-cameras", "security", "security", -27, -4),
    station("skeld-vent-a", "maintenance", "upper-engine", -40, -27, "skeld-vent-b"),
    station("skeld-vent-b", "maintenance", "reactor", -56, -3, "skeld-vent-a"),
    station("skeld-vent-c", "maintenance", "navigation", 58, -5, "skeld-vent-d"),
    station("skeld-vent-d", "maintenance", "shields", 35, 23, "skeld-vent-c"),
    station("skeld-reactor-alpha", "repair", "reactor", -56, -8, "skeld-reactor-meltdown"),
    station("skeld-reactor-beta", "repair", "reactor", -56, 2, "skeld-reactor-meltdown"),
    station("skeld-o2-panel", "repair", "o2", 26, -9, "skeld-o2-depletion"),
    station("skeld-admin-o2", "repair", "admin", 19, 5, "skeld-o2-depletion"),
    station("skeld-comms-panel", "repair", "communications", 15, 41, "skeld-comms-sabotage"),
    station("skeld-light-panel", "repair", "electrical", -14, 17, "skeld-lights-out")
  ],
  spawnPoints: [
    [4, -32], [7, -33], [13, -33], [16, -32], [4, -24], [7, -23], [13, -23], [16, -24],
    [2, -28], [6, -28], [14, -28], [18, -28], [10, -35], [10, -21], [3, -34], [17, -22]
  ],
  collisionRects: [
    { id: "skeld-emergency-table", kind: "table", roomId: "cafeteria", x: 10, z: -28, width: 5.2, depth: 3.2 },
    { id: "skeld-admin-table", kind: "table", roomId: "admin", x: 16, z: 5, width: 4.5, depth: 2.5 },
    { id: "skeld-med-scanner", kind: "scanner", roomId: "medbay", x: -18, z: -15, width: 3, depth: 3 },
    { id: "skeld-storage-crates", kind: "cargo", roomId: "storage", x: 11, z: 27, width: 3.8, depth: 3.4 }
  ],
  theme: {
    worldScale: 46,
    corridorFill: 0x142a30,
    corridorStroke: 0x6b8b8f,
    frame: 0xa6d7d9,
    artAlpha: 0.82
  }
});
