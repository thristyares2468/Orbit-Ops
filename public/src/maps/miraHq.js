import { createMapDefinition, station, task } from "./mapFactory.js";

const MIRA_ROUTES = [
  { id: "greenhouse-junction", from: "greenhouse", to: "junction" },
  { id: "office-greenhouse", from: "office", to: "greenhouse", via: [{ x: 14, z: -31 }, { x: 25, z: -31 }] },
  { id: "admin-greenhouse", from: "admin", to: "greenhouse", via: [{ x: 35, z: -31 }, { x: 25, z: -31 }] },
  { id: "junction-laboratory", from: "junction", to: "laboratory", via: [{ x: 4, z: -8 }, { x: 4, z: -10 }] },
  { id: "laboratory-reactor", from: "laboratory", to: "reactor" },
  { id: "laboratory-decontamination", from: "laboratory", to: "decontamination" },
  { id: "decontamination-locker", from: "decontamination", to: "locker-room" },
  { id: "locker-launchpad", from: "locker-room", to: "launchpad", via: [{ x: -18, z: 35 }, { x: -46, z: 35 }] },
  { id: "locker-communications", from: "locker-room", to: "communications" },
  { id: "communications-medbay", from: "communications", to: "medbay" },
  { id: "communications-storage", from: "communications", to: "storage" },
  { id: "junction-storage", from: "junction", to: "storage" },
  { id: "junction-cafeteria", from: "junction", to: "cafeteria", via: [{ x: 36, z: -8 }, { x: 36, z: 26 }] },
  { id: "storage-cafeteria", from: "storage", to: "cafeteria" },
  { id: "cafeteria-balcony", from: "cafeteria", to: "balcony", via: [{ x: 39, z: 26 }] },
  { id: "office-junction", from: "office", to: "junction" },
  { id: "admin-junction", from: "admin", to: "junction" }
];

export const MIRA_HQ = createMapDefinition({
  id: "mira-hq",
  name: "MIRA HQ",
  description: "A high-altitude headquarters whose long launchpad approach feeds a central Y-junction below the Greenhouse.",
  bounds: { minX: -62, maxX: 64, minZ: -48, maxZ: 48 },
  rooms: [
    { id: "greenhouse", name: "Greenhouse", x: 25, z: -38, width: 22, depth: 10, shape: "octagon", colour: 0x275544, gridColour: 0xa4ffd1 },
    { id: "office", name: "Office", x: 14, z: -25, width: 10, depth: 12, colour: 0x4b3c54 },
    { id: "admin", name: "Admin", x: 35, z: -25, width: 12, depth: 12, colour: 0x46364d },
    { id: "junction", name: "Junction", x: 24, z: -8, width: 5, depth: 5, shape: "octagon", label: false, colour: 0x334b5b },
    { id: "reactor", name: "Reactor", x: -28, z: -14, width: 14, depth: 18, shape: "octagon", colour: 0x533244 },
    { id: "laboratory", name: "Laboratory", x: -10, z: -10, width: 15, depth: 15, colour: 0x34546a },
    { id: "decontamination", name: "Decontamination", x: -18, z: 7, width: 8, depth: 18, colour: 0x596b6b },
    { id: "locker-room", name: "Locker Room", x: -5, z: 26, width: 10, depth: 14, colour: 0x384b50 },
    { id: "communications", name: "Communications", x: 10, z: 21, width: 10, depth: 12, colour: 0x3b4057 },
    { id: "medbay", name: "MedBay", x: 10, z: 36, width: 10, depth: 9, colour: 0x285159 },
    { id: "storage", name: "Storage", x: 24, z: 23, width: 9, depth: 11, colour: 0x51483b },
    { id: "cafeteria", name: "Cafeteria", x: 48, z: 26, width: 21, depth: 16, shape: "octagon", colour: 0x53606c },
    { id: "balcony", name: "Balcony", x: 39, z: 42, width: 13, depth: 7, shape: "octagon", colour: 0x315466 },
    { id: "launchpad", name: "Launchpad", x: -46, z: 29, width: 25, depth: 17, shape: "octagon", assetKey: "mira-launchpad", artAlpha: 0.9, colour: 0x37515d }
  ],
  connections: MIRA_ROUTES.map(({ from, to }) => [from, to]),
  corridorRoutes: MIRA_ROUTES,
  tasks: [
    task("mira-run-diagnostics", "Run Diagnostics", "launchpad", -48, 29, "sequence"),
    task("mira-sort-samples", "Sort Samples", "laboratory", -8, -10, "classify"),
    task("mira-start-reactor", "Start Reactor", "reactor", -28, -14, "sequence"),
    task("mira-enter-id-code", "Enter ID Code", "admin", 36, -25, "manifest"),
    task("mira-measure-weather", "Measure Weather", "balcony", 39, 42, "balance"),
    task("mira-clean-filter", "Clean O2 Filter", "greenhouse", 25, -38, "filter"),
    task("mira-buy-beverage", "Buy Beverage", "cafeteria", 44, 27, "route"),
    task("mira-divert-power", "Divert Power", "office", 14, -25, "sync")
  ],
  sabotages: [
    { id: "mira-reactor-meltdown", name: "Reactor Meltdown", critical: true, durationMs: 45000, repairStations: ["mira-reactor-alpha", "mira-reactor-beta"], roomId: "reactor" },
    { id: "mira-oxygen-failure", name: "Oxygen Failure", critical: true, durationMs: 50000, repairStations: ["mira-greenhouse-o2", "mira-admin-o2"], roomId: "greenhouse" },
    { id: "mira-comms-blackout", name: "Communications Blackout", critical: false, durationMs: 40000, repairStations: ["mira-comms-panel"], roomId: "communications" },
    { id: "mira-lighting-failure", name: "Lighting Failure", critical: false, durationMs: 40000, repairStations: ["mira-office-lights"], roomId: "office" }
  ],
  stations: [
    station("meeting-console", "meeting", "cafeteria", 48, 26),
    station("mira-door-logs", "doorLogs", "communications", 10, 21),
    station("mira-vent-a", "maintenance", "launchpad", -50, 29, "mira-vent-b"),
    station("mira-vent-b", "maintenance", "greenhouse", 25, -38, "mira-vent-a"),
    station("mira-reactor-alpha", "repair", "reactor", -31, -14, "mira-reactor-meltdown"),
    station("mira-reactor-beta", "repair", "reactor", -25, -14, "mira-reactor-meltdown"),
    station("mira-greenhouse-o2", "repair", "greenhouse", 25, -37, "mira-oxygen-failure"),
    station("mira-admin-o2", "repair", "admin", 35, -25, "mira-oxygen-failure"),
    station("mira-comms-panel", "repair", "communications", 10, 21, "mira-comms-blackout"),
    station("mira-office-lights", "repair", "office", 14, -25, "mira-lighting-failure")
  ],
  spawnPoints: [
    [42, 22], [46, 21], [50, 21], [54, 22], [42, 30], [46, 31], [50, 31], [54, 30],
    [40, 26], [44, 26], [52, 26], [56, 26], [48, 19], [48, 33], [41, 23], [55, 29]
  ],
  collisionRects: [
    { id: "mira-emergency-table", kind: "table", roomId: "cafeteria", x: 48, z: 26, width: 4.8, depth: 3 },
    { id: "mira-lab-bench", kind: "console", roomId: "laboratory", x: -7, z: -11, width: 3.5, depth: 2.4 },
    { id: "mira-office-desk", kind: "table", roomId: "office", x: 14, z: -27, width: 4, depth: 2.5 },
    { id: "mira-launch-crates", kind: "cargo", roomId: "launchpad", x: -51, z: 32, width: 3.6, depth: 3.2 }
  ],
  theme: {
    worldScale: 45,
    corridorFill: 0x203641,
    corridorStroke: 0x75b5b3,
    frame: 0x86f0d0,
    artAlpha: 0.78
  }
});
