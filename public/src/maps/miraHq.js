import { createMapDefinition, station, task } from "./mapFactory.js";

export const MIRA_HQ = createMapDefinition({
  id: "mira-hq",
  name: "MIRA HQ",
  description: "A high-altitude headquarters built around a three-way central junction and a linked vent network.",
  bounds: { minX: -60, maxX: 57, minZ: -45, maxZ: 45 },
  rooms: [
    { id: "launchpad", name: "Launchpad", x: -48, z: 29, width: 17, depth: 15, shape: "octagon", assetKey: "mira-launchpad", colour: 0x37515d },
    { id: "medbay", name: "MedBay", x: -35, z: 14, width: 12, depth: 10, assetKey: "mira-hq-2", colour: 0x285159 },
    { id: "communications", name: "Communications", x: -35, z: 31, width: 12, depth: 10, assetKey: "mira-hq-1", colour: 0x3b4057 },
    { id: "locker-room", name: "Locker Room", x: -19, z: 22, width: 13, depth: 11, assetKey: "mira-hq-2", colour: 0x384b50 },
    { id: "decontamination", name: "Decontamination", x: -20, z: 4, width: 9, depth: 12, assetKey: "mira-walls", colour: 0x596b6b },
    { id: "reactor", name: "Reactor", x: -39, z: -11, width: 14, depth: 14, shape: "octagon", assetKey: "mira-hq-3", colour: 0x533244 },
    { id: "laboratory", name: "Laboratory", x: -17, z: -15, width: 15, depth: 12, assetKey: "mira-lab", colour: 0x34546a },
    { id: "hallway", name: "Hallway", x: 0, z: 4, width: 11, depth: 11, shape: "octagon", assetKey: "mira-walls", colour: 0x334b5b },
    { id: "storage", name: "Storage", x: 0, z: 23, width: 11, depth: 10, assetKey: "mira-hq-1", colour: 0x51483b },
    { id: "office", name: "Office", x: 16, z: -5, width: 12, depth: 10, assetKey: "mira-hq-2", colour: 0x4b3c54 },
    { id: "admin", name: "Admin", x: 31, z: -5, width: 12, depth: 10, assetKey: "mira-lab", colour: 0x46364d },
    { id: "greenhouse", name: "Greenhouse", x: 45, z: -22, width: 17, depth: 14, shape: "octagon", assetKey: "mira-lab", colour: 0x275544 },
    { id: "cafeteria", name: "Cafeteria", x: 28, z: 21, width: 18, depth: 14, shape: "octagon", assetKey: "mira-hq-3", colour: 0x53606c },
    { id: "balcony", name: "Balcony", x: 48, z: 29, width: 13, depth: 10, shape: "octagon", assetKey: "mira-hq-1", colour: 0x315466 }
  ],
  connections: [
    ["launchpad", "medbay"], ["launchpad", "communications"], ["medbay", "locker-room"], ["communications", "locker-room"],
    ["locker-room", "decontamination"], ["locker-room", "hallway"], ["decontamination", "reactor"], ["decontamination", "laboratory"],
    ["reactor", "laboratory"], ["laboratory", "hallway"], ["hallway", "storage"], ["hallway", "office"], ["hallway", "cafeteria"],
    ["office", "admin"], ["admin", "greenhouse"], ["cafeteria", "admin"], ["cafeteria", "balcony"], ["greenhouse", "balcony"]
  ],
  tasks: [
    task("mira-run-diagnostics", "Run Diagnostics", "launchpad", -49, 29, "sequence"),
    task("mira-sort-samples", "Sort Samples", "laboratory", -17, -15, "classify"),
    task("mira-start-reactor", "Start Reactor", "reactor", -39, -11, "sequence"),
    task("mira-enter-id-code", "Enter ID Code", "admin", 32, -5, "manifest"),
    task("mira-measure-weather", "Measure Weather", "balcony", 49, 29, "balance"),
    task("mira-clean-filter", "Clean O2 Filter", "greenhouse", 45, -22, "filter"),
    task("mira-buy-beverage", "Buy Beverage", "cafeteria", 25, 22, "route"),
    task("mira-divert-power", "Divert Power", "office", 16, -5, "sync")
  ],
  sabotages: [
    { id: "mira-reactor-meltdown", name: "Reactor Meltdown", critical: true, durationMs: 45000, repairStations: ["mira-reactor-alpha", "mira-reactor-beta"], roomId: "reactor" },
    { id: "mira-oxygen-failure", name: "Oxygen Failure", critical: true, durationMs: 50000, repairStations: ["mira-greenhouse-o2", "mira-admin-o2"], roomId: "greenhouse" },
    { id: "mira-comms-blackout", name: "Communications Blackout", critical: false, durationMs: 40000, repairStations: ["mira-comms-panel"], roomId: "communications" },
    { id: "mira-lighting-failure", name: "Lighting Failure", critical: false, durationMs: 40000, repairStations: ["mira-office-lights"], roomId: "office" }
  ],
  stations: [
    station("meeting-console", "meeting", "cafeteria", 28, 21),
    station("mira-door-logs", "doorLogs", "communications", -35, 31),
    station("mira-vent-a", "maintenance", "launchpad", -48, 29, "mira-vent-b"),
    station("mira-vent-b", "maintenance", "greenhouse", 45, -22, "mira-vent-a"),
    station("mira-reactor-alpha", "repair", "reactor", -42, -11, "mira-reactor-meltdown"),
    station("mira-reactor-beta", "repair", "reactor", -36, -11, "mira-reactor-meltdown"),
    station("mira-greenhouse-o2", "repair", "greenhouse", 45, -20, "mira-oxygen-failure"),
    station("mira-admin-o2", "repair", "admin", 31, -5, "mira-oxygen-failure"),
    station("mira-comms-panel", "repair", "communications", -35, 31, "mira-comms-blackout"),
    station("mira-office-lights", "repair", "office", 16, -5, "mira-lighting-failure")
  ],
  spawnPoints: [
    [24, 18], [28, 17], [32, 18], [24, 24], [28, 25], [32, 24], [21, 21], [35, 21],
    [24, 20], [32, 22], [22, 19], [34, 23], [26, 24], [30, 18], [23, 23], [33, 19]
  ],
  collisionRects: [
    { id: "mira-emergency-table", kind: "table", roomId: "cafeteria", x: 28, z: 21, width: 4.4, depth: 2.8 },
    { id: "mira-lab-bench", kind: "console", roomId: "laboratory", x: -14, z: -16, width: 3.5, depth: 2.4 },
    { id: "mira-office-desk", kind: "table", roomId: "office", x: 16, z: -7, width: 4, depth: 2.5 }
  ],
  theme: { corridorFill: 0x203641, corridorStroke: 0x75b5b3, frame: 0x86f0d0, artAlpha: 0.71 }
});
