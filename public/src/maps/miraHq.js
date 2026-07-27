import { createMapDefinition, station, task } from "./mapFactory.js";

// Room transforms and corridor routes are traced from the supplied in-game MIRA HQ
// minimap (Gui/map_HQ-sharedassets0.assets-83.png). The Y-junction and the
// Decontamination passage are corridors on that reference, not rooms.
const MIRA_ROUTES = [
  { id: "greenhouse-office", from: "greenhouse", to: "office", width: 6.0, via: [] },
  { id: "greenhouse-admin", from: "greenhouse", to: "admin", width: 6.0, via: [] },
  { id: "greenhouse-locker-room", from: "greenhouse", to: "locker-room", width: 5.7, via: [{ x: 22.51, z: 1.93 }, { x: 18.48, z: 5.96 }, { x: 13.78, z: 10.0 }, { x: 10.42, z: 21.42 }] },
  { id: "greenhouse-storage", from: "greenhouse", to: "storage", width: 4.7, via: [{ x: 34.61, z: 3.95 }, { x: 38.64, z: 7.98 }, { x: 43.34, z: 11.34 }, { x: 44.02, z: 17.39 }, { x: 33.35, z: 17.39 }] },
  { id: "reactor-decontamination", from: "reactor", to: "decontamination", width: 4.7, via: [{ x: -9.74, z: 1.93 }] },
  { id: "laboratory-decontamination", from: "laboratory", to: "decontamination", width: 5.0, via: [{ x: -2.35, z: -9.49 }, { x: -7.56, z: -9.49 }] },
  { id: "decontamination-locker-room", from: "decontamination", to: "locker-room", width: 6.0, via: [] },
  { id: "locker-room-launchpad", from: "locker-room", to: "launchpad", width: 5.4, via: [{ x: 1.01, z: 28.14 }, { x: -13.1, z: 28.14 }, { x: -13.1, z: 38.22 }, { x: -45.86, z: 38.22 }] },
  { id: "locker-room-communications", from: "locker-room", to: "communications", width: 6.0, via: [] },
  { id: "locker-room-medbay", from: "locker-room", to: "medbay", width: 6.0, via: [{ x: 10.42, z: 22.09 }, { x: 10.42, z: 33.85 }] },
  { id: "storage-cafeteria", from: "storage", to: "cafeteria", width: 6.0, via: [] },
  { id: "cafeteria-balcony", from: "cafeteria", to: "balcony", width: 5.7, via: [] },
];

export const MIRA_HQ = createMapDefinition({
  id: "mira-hq",
  name: "MIRA HQ",
  description: "A high-altitude headquarters whose long launchpad approach feeds a central Y-junction below the Greenhouse.",
  bounds: { minX: -64, maxX: 64, minZ: -47, maxZ: 47 },
  rooms: [
    { id: "greenhouse", name: "Greenhouse", x: 27.97, z: -39.82, width: 30.91, depth: 11.42, shape: "octagon", assetKey: "mira-greenhouse", artAlpha: 0.96, artPadding: 2, floorPattern: "glass", colour: 0x275544, gridColour: 0xa4ffd1 },
    { id: "office", name: "Office", x: 18.23, z: -26.12, width: 11.42, depth: 15.29, assetKey: "mira-office", artAlpha: 0.96, artPadding: 2, floorPattern: "wood", gridColour: 0xd8b77e, colour: 0x4b3c54 },
    { id: "admin", name: "Admin", x: 37.55, z: -26.12, width: 11.76, depth: 15.29, assetKey: "mira-admin", artAlpha: 0.96, artPadding: 2, floorPattern: "clean", colour: 0x46364d },
    { id: "reactor", name: "Reactor", x: -19.82, z: -7.31, width: 14.95, depth: 21.34, assetKey: "mira-reactor", artCrop: { x: 0, y: 0, width: 500, height: 730 }, artAlpha: 0.96, artPadding: 2, floorPattern: "radial", gridColour: 0xffd46b, colour: 0x533244 },
    { id: "laboratory", name: "Laboratory", x: 2.69, z: -5.12, width: 14.95, depth: 16.97, assetKey: "mira-laboratory", artCrop: { x: 736, y: 150, width: 489, height: 580 }, artAlpha: 0.96, artPadding: 2, floorPattern: "clean", colour: 0x34546a },
    { id: "decontamination", name: "Decontamination", x: -7.56, z: 9.91, width: 11.26, depth: 44.69, assetKey: "mira-decontamination", artCrop: { x: 500, y: 700, width: 240, height: 780 }, artAlpha: 0.96, artPadding: 1, artFit: "stretch", floorPattern: "hazard", gridColour: 0xf0d05c, colour: 0x596b6b },
    { id: "locker-room", name: "Locker Room", x: 2.86, z: 24.28, width: 20, depth: 9.5, assetKey: "mira-locker-room", artAlpha: 0.96, artPadding: 2, artFit: "stretch", floorPattern: "clean", colour: 0x384b50 },
    { id: "communications", name: "Communications", x: 20.41, z: 20.75, width: 10.75, depth: 11.26, floorPattern: "carpet", gridColour: 0xa894d9, colour: 0x3b4057 },
    { id: "medbay", name: "MedBay", x: 20.41, z: 33.85, width: 10.75, depth: 13.61, assetKey: "mira-medbay", artAlpha: 0.96, artPadding: 2, artFit: "stretch", floorPattern: "clean", colour: 0x285159 },
    { id: "storage", name: "Storage", x: 33.35, z: 22.09, width: 9.41, depth: 13.94, assetKey: "mira-storage", artAlpha: 0.96, artPadding: 2, artFit: "stretch", floorPattern: "panels", gridColour: 0xe4c879, colour: 0x51483b },
    { id: "cafeteria", name: "Cafeteria", x: 50.9, z: 24.11, width: 24.36, depth: 18.5, assetKey: "mira-cafeteria", artCrop: { x: 328, y: 35, width: 810, height: 755 }, artAlpha: 0.96, artPadding: 2, floorPattern: "clean", colour: 0x53606c },
    { id: "balcony", name: "Balcony", x: 45.86, z: 40.82, width: 34.44, depth: 9.41, shape: "octagon", assetKey: "mira-balcony", artCrop: { x: 0, y: 780, width: 1144, height: 297 }, artAlpha: 0.96, artPadding: 1, floorPattern: "glass", gridColour: 0x8edfff, colour: 0x315466 },
    { id: "launchpad", name: "Launchpad", x: -45.86, z: 21.25, width: 34.44, depth: 24.36, assetKey: "mira-launchpad", artAlpha: 0.94, artPadding: 2, artFit: "stretch", floorPattern: "radial", colour: 0x37515d },
  ],
  connections: MIRA_ROUTES.map(({ from, to }) => [from, to]),
  corridorRoutes: MIRA_ROUTES,
  tasks: [
    task("mira-run-diagnostics", "Run Diagnostics", "launchpad", -39.86, 21.25, "sequence"),
    task("mira-sort-samples", "Sort Samples", "laboratory", 6.19, -2.12, "classify"),
    task("mira-start-reactor", "Start Reactor", "reactor", -19.82, -2.31, "sequence"),
    task("mira-enter-id-code", "Enter ID Code", "admin", 37.55, -22.62, "manifest"),
    task("mira-measure-weather", "Measure Weather", "balcony", 53.86, 40.82, "balance"),
    task("mira-clean-filter", "Clean O2 Filter", "greenhouse", 19.97, -39.82, "filter"),
    task("mira-buy-beverage", "Buy Beverage", "cafeteria", 44.9, 27.11, "route"),
    task("mira-divert-power", "Divert Power", "office", 18.23, -22.62, "sync"),
  ],
  sabotages: [
    { id: "mira-reactor-meltdown", name: "Reactor Meltdown", critical: true, durationMs: 45000, repairStations: ["mira-reactor-alpha", "mira-reactor-beta"], roomId: "reactor" },
    { id: "mira-oxygen-failure", name: "Oxygen Failure", critical: true, durationMs: 50000, repairStations: ["mira-greenhouse-o2", "mira-admin-o2"], roomId: "greenhouse" },
    { id: "mira-comms-blackout", name: "Communications Blackout", critical: false, durationMs: 40000, repairStations: ["mira-comms-panel"], roomId: "communications" },
    { id: "mira-lighting-failure", name: "Lighting Failure", critical: false, durationMs: 40000, repairStations: ["mira-office-lights"], roomId: "office" }
  ],
  stations: [
    station("meeting-console", "meeting", "cafeteria", 50.9, 24.11),
    station("mira-door-logs", "doorLogs", "communications", 20.41, 20.75),
    // MIRA HQ's vents are one connected network in the reference; approximated as paired hops.
    station("mira-vent-launchpad", "maintenance", "launchpad", -55.9, 27, "mira-vent-greenhouse"),
    station("mira-vent-greenhouse", "maintenance", "greenhouse", 36, -39.82, "mira-vent-launchpad"),
    station("mira-vent-reactor", "maintenance", "reactor", -19.82, -2, "mira-vent-laboratory"),
    station("mira-vent-laboratory", "maintenance", "laboratory", 2.69, -1, "mira-vent-reactor"),
    station("mira-vent-admin", "maintenance", "admin", 37.55, -22, "mira-vent-office"),
    station("mira-vent-office", "maintenance", "office", 18.23, -22, "mira-vent-admin"),
    station("mira-vent-cafeteria", "maintenance", "cafeteria", 56, 27, "mira-vent-balcony"),
    station("mira-vent-balcony", "maintenance", "balcony", 52, 40.82, "mira-vent-cafeteria"),
    station("mira-vent-medbay", "maintenance", "medbay", 20.41, 37, "mira-vent-locker"),
    station("mira-vent-locker", "maintenance", "locker-room", 2.86, 29, "mira-vent-medbay"),
    station("mira-reactor-alpha", "repair", "reactor", -23.82, -12.31, "mira-reactor-meltdown"),
    station("mira-reactor-beta", "repair", "reactor", -15.82, -12.31, "mira-reactor-meltdown"),
    station("mira-greenhouse-o2", "repair", "greenhouse", 27.97, -39.82, "mira-oxygen-failure"),
    station("mira-admin-o2", "repair", "admin", 37.55, -29.62, "mira-oxygen-failure"),
    station("mira-comms-panel", "repair", "communications", 20.41, 23.75, "mira-comms-blackout"),
    station("mira-office-lights", "repair", "office", 18.23, -29.62, "mira-lighting-failure"),
  ],
  spawnPoints: [
    [60.88, 24.11], [61, 26.4], [58.5, 28.9], [54.5, 28.9],
    [50.9, 28.9], [47.3, 28.9], [43.3, 28.9], [40.8, 26.4],
    [40.92, 24.11], [40.8, 21.8], [43.3, 19.3], [47.3, 19.3],
    [50.9, 19.3], [54.5, 19.3], [58.5, 19.3], [61, 21.8]
  ],
  decals: [
    { id: "mira-cafeteria-table-west-art", assetKey: "mira-cafeteria-table", crop: { x: 78, y: 920, width: 155, height: 335 }, x: 43.5, z: 24.1, width: 3.7, depth: 7.2, alpha: 0.98 },
    { id: "mira-cafeteria-table-east-art", assetKey: "mira-cafeteria-table", crop: { x: 78, y: 920, width: 155, height: 335 }, x: 58.3, z: 24.1, width: 3.7, depth: 7.2, alpha: 0.98 }
  ],
  collisionRects: [
    { id: "mira-greenhouse-rack-west", kind: "planter", roomId: "greenhouse", x: 27, z: -40.4, width: 4, depth: 3.1, prop: false },
    { id: "mira-greenhouse-rack-east", kind: "planter", roomId: "greenhouse", x: 32, z: -40.4, width: 4, depth: 3.1, prop: false },
    { id: "mira-office-desk-west", kind: "table", roomId: "office", x: 16.6, z: -27.1, width: 3.3, depth: 5.8 },
    { id: "mira-office-desk-east", kind: "table", roomId: "office", x: 20.3, z: -27.1, width: 3.3, depth: 5.8 },
    { id: "mira-admin-table", kind: "table", roomId: "admin", x: 37.6, z: -26.1, width: 7.4, depth: 6.5, prop: false },
    { id: "mira-reactor-core", kind: "reactor", roomId: "reactor", x: -19.8, z: -7.3, width: 7.2, depth: 9.4 },
    { id: "mira-lab-bench", kind: "console", roomId: "laboratory", x: 3.6, z: -5.1, width: 7.4, depth: 3.1, prop: false },
    { id: "mira-locker-benches", kind: "bench", roomId: "locker-room", x: 2.9, z: 24.8, width: 3.2, depth: 8.6 },
    { id: "mira-comms-console", kind: "console", roomId: "communications", x: 20.4, z: 20.2, width: 5.8, depth: 3.1 },
    { id: "mira-med-scanner", kind: "scanner", roomId: "medbay", x: 20.4, z: 35.4, width: 3.2, depth: 3.2, prop: false },
    { id: "mira-med-beds", kind: "bed", roomId: "medbay", x: 20.4, z: 31.1, width: 6.5, depth: 2.8, prop: false },
    { id: "mira-storage-shelves", kind: "cargo", roomId: "storage", x: 33.4, z: 22.1, width: 5.2, depth: 6.4, prop: false },
    { id: "mira-cafeteria-table-west", kind: "table", roomId: "cafeteria", x: 43.5, z: 24.1, width: 3.7, depth: 7.2, prop: false },
    { id: "mira-cafeteria-table-east", kind: "table", roomId: "cafeteria", x: 58.3, z: 24.1, width: 3.7, depth: 7.2, prop: false },
    { id: "mira-balcony-dish", kind: "console", roomId: "balcony", x: 37.5, z: 40.8, width: 6.3, depth: 5.1 },
    { id: "mira-launchpad-craft", kind: "engine", roomId: "launchpad", x: -49.4, z: 20.5, width: 16.2, depth: 12.2, prop: false },
    { id: "mira-launch-crates", kind: "cargo", roomId: "launchpad", x: -38.4, z: 27.3, width: 7.1, depth: 6.5, prop: false }
  ],
  theme: {
    worldScale: 41,
    corridorFill: 0x203641,
    corridorStroke: 0x75b5b3,
    corridorAccent: 0xf4d34f,
    frame: 0x86f0d0,
    artAlpha: 0.78
  }
});
