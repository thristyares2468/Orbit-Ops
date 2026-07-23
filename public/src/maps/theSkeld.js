import { createMapDefinition, station, task } from "./mapFactory.js";

export const THE_SKELD = createMapDefinition({
  id: "the-skeld",
  name: "The Skeld",
  shortName: "Skeld",
  description: "A compact ship with two central hubs, paired engines, and narrow east-west routes.",
  bounds: { minX: -59, maxX: 58, minZ: -40, maxZ: 42 },
  rooms: [
    { id: "cafeteria", name: "Cafeteria", x: 0, z: -27, width: 22, depth: 17, shape: "octagon", assetKey: "skeld-cafeteria", colour: 0x546064 },
    { id: "upper-engine", name: "Upper Engine", x: -35, z: -25, width: 14, depth: 11, assetKey: "skeld-engine", colour: 0x4a342a },
    { id: "reactor", name: "Reactor", x: -51, z: -4, width: 12, depth: 19, shape: "octagon", assetKey: "skeld-reactor", colour: 0x512d35 },
    { id: "security", name: "Security", x: -26, z: -5, width: 11, depth: 10, assetKey: "skeld-security", colour: 0x3b334f },
    { id: "medbay", name: "MedBay", x: -18, z: -18, width: 13, depth: 10, assetKey: "skeld-medbay", colour: 0x1f5153 },
    { id: "lower-engine", name: "Lower Engine", x: -35, z: 19, width: 14, depth: 11, assetKey: "skeld-engine", colour: 0x4a342a },
    { id: "electrical", name: "Electrical", x: -18, z: 18, width: 12, depth: 11, assetKey: "skeld-hull", colour: 0x594437 },
    { id: "storage", name: "Storage", x: 0, z: 20, width: 19, depth: 16, shape: "octagon", assetKey: "skeld-storage", colour: 0x443c32 },
    { id: "admin", name: "Admin", x: 12, z: 2, width: 13, depth: 11, assetKey: "skeld-storage", colour: 0x503040 },
    { id: "communications", name: "Communications", x: 17, z: 33, width: 13, depth: 9, shape: "octagon", assetKey: "skeld-hull", colour: 0x24485b },
    { id: "shields", name: "Shields", x: 30, z: 17, width: 12, depth: 11, shape: "octagon", assetKey: "skeld-life-support", colour: 0x3b285e },
    { id: "o2", name: "O2", x: 24, z: -10, width: 10, depth: 9, assetKey: "skeld-life-support", colour: 0x1d4d4b },
    { id: "weapons", name: "Weapons", x: 27, z: -25, width: 13, depth: 11, assetKey: "skeld-weapons", colour: 0x2c4552 },
    { id: "navigation", name: "Navigation", x: 48, z: -5, width: 13, depth: 11, shape: "octagon", assetKey: "skeld-navigation", colour: 0x253b65 }
  ],
  connections: [
    ["cafeteria", "upper-engine"], ["cafeteria", "medbay"], ["cafeteria", "weapons"], ["cafeteria", "admin"], ["cafeteria", "storage"],
    ["upper-engine", "reactor"], ["upper-engine", "security"], ["upper-engine", "medbay"], ["reactor", "security"], ["reactor", "lower-engine"],
    ["security", "lower-engine"], ["lower-engine", "electrical"], ["lower-engine", "storage"], ["electrical", "storage"],
    ["storage", "admin"], ["storage", "communications"], ["storage", "shields"], ["admin", "o2"], ["o2", "weapons"],
    ["o2", "navigation"], ["o2", "shields"], ["weapons", "navigation"], ["navigation", "shields"], ["shields", "communications"]
  ],
  tasks: [
    task("skeld-swipe-card", "Swipe Card", "admin", 14, 2, "sequence"),
    task("skeld-align-engine", "Align Engine Output", "upper-engine", -35, -25, "balance"),
    task("skeld-calibrate-distributor", "Calibrate Distributor", "electrical", -18, 18, "sequence"),
    task("skeld-submit-scan", "Submit Scan", "medbay", -19, -18, "scan"),
    task("skeld-stabilize-steering", "Stabilize Steering", "navigation", 50, -5, "route"),
    task("skeld-clean-o2-filter", "Clean O2 Filter", "o2", 24, -10, "filter"),
    task("skeld-empty-garbage", "Empty Garbage", "storage", -3, 23, "classify"),
    task("skeld-prime-shields", "Prime Shields", "shields", 31, 17, "sync")
  ],
  sabotages: [
    { id: "skeld-reactor-meltdown", name: "Reactor Meltdown", critical: true, durationMs: 45000, repairStations: ["skeld-reactor-alpha", "skeld-reactor-beta"], roomId: "reactor" },
    { id: "skeld-o2-depletion", name: "O2 Depletion", critical: true, durationMs: 50000, repairStations: ["skeld-o2-panel", "skeld-admin-o2"], roomId: "o2" },
    { id: "skeld-comms-sabotage", name: "Communications Sabotage", critical: false, durationMs: 40000, repairStations: ["skeld-comms-panel"], roomId: "communications" },
    { id: "skeld-lights-out", name: "Lights Out", critical: false, durationMs: 40000, repairStations: ["skeld-light-panel"], roomId: "electrical" }
  ],
  stations: [
    station("meeting-console", "meeting", "cafeteria", 0, -27),
    station("skeld-cameras", "security", "security", -26, -5),
    station("skeld-vent-a", "maintenance", "upper-engine", -38, -25, "skeld-vent-b"),
    station("skeld-vent-b", "maintenance", "reactor", -51, -4, "skeld-vent-a"),
    station("skeld-vent-c", "maintenance", "navigation", 48, -5, "skeld-vent-d"),
    station("skeld-vent-d", "maintenance", "shields", 30, 17, "skeld-vent-c"),
    station("skeld-reactor-alpha", "repair", "reactor", -51, -8, "skeld-reactor-meltdown"),
    station("skeld-reactor-beta", "repair", "reactor", -51, 0, "skeld-reactor-meltdown"),
    station("skeld-o2-panel", "repair", "o2", 22, -10, "skeld-o2-depletion"),
    station("skeld-admin-o2", "repair", "admin", 14, 3, "skeld-o2-depletion"),
    station("skeld-comms-panel", "repair", "communications", 17, 33, "skeld-comms-sabotage"),
    station("skeld-light-panel", "repair", "electrical", -18, 18, "skeld-lights-out")
  ],
  spawnPoints: [
    [-5, -30], [-2.5, -30], [2.5, -30], [5, -30], [-5, -24], [-2.5, -24], [2.5, -24], [5, -24],
    [-7, -27], [-3.5, -27], [3.5, -27], [7, -27], [0, -32], [0, -22], [-7, -31], [7, -23]
  ],
  collisionRects: [
    { id: "skeld-emergency-table", kind: "table", roomId: "cafeteria", x: 0, z: -27, width: 4.5, depth: 2.8 },
    { id: "skeld-admin-table", kind: "table", roomId: "admin", x: 11, z: 2, width: 4.5, depth: 2.5 },
    { id: "skeld-med-scanner", kind: "scanner", roomId: "medbay", x: -21, z: -18, width: 3, depth: 3 },
    { id: "skeld-storage-crates", kind: "cargo", roomId: "storage", x: 3, z: 22, width: 3.4, depth: 3 }
  ],
  theme: { corridorFill: 0x142a30, corridorStroke: 0x6b8b8f, frame: 0xa6d7d9, artAlpha: 0.74 }
});

