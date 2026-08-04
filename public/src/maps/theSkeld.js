import { createMapDefinition, station, task } from "./mapFactory.js";

// Room transforms and corridor routes are traced from the supplied in-game Skeld
// minimap (Gui/map-sharedassets0.assets-125.png), so the deck matches the reference
// layout rather than an approximation.
const SKELD_ROUTES = [
  { id: "upper-engine-reactor", from: "upper-engine", to: "reactor", width: 4.0, via: [{ x: -45.77, z: -1.21 }] },
  { id: "reactor-lower-engine", from: "reactor", to: "lower-engine", width: 6.0, via: [{ x: -45.84, z: -1.21 }] },
  { id: "upper-engine-cafeteria", from: "upper-engine", to: "cafeteria", width: 6.0, via: [] },
  { id: "upper-engine-security", from: "upper-engine", to: "security", width: 4.0, via: [{ x: -45.77, z: -2.28 }] },
  { id: "security-lower-engine", from: "security", to: "lower-engine", width: 4.0, via: [{ x: -45.84, z: -2.28 }] },
  { id: "medbay-cafeteria", from: "medbay", to: "cafeteria", width: 6.0, via: [{ x: -20.77, z: -19.97 }] },
  { id: "upper-engine-medbay", from: "upper-engine", to: "medbay", width: 6.0, via: [{ x: -21.31, z: -19.7 }, { x: -21.31, z: -7.24 }] },
  { id: "lower-engine-electrical", from: "lower-engine", to: "electrical", width: 4.6, via: [{ x: -30.42, z: 18.23 }, { x: -30.42, z: 25.93 }, { x: -22.38, z: 25.93 }, { x: -22.38, z: 13.07 }] },
  { id: "electrical-storage", from: "electrical", to: "storage", width: 4.0, via: [{ x: -21.85, z: 25.93 }, { x: -6.84, z: 25.93 }, { x: -6.84, z: 22.98 }] },
  { id: "lower-engine-storage", from: "lower-engine", to: "storage", width: 4.3, via: [{ x: -30.42, z: 18.23 }, { x: -30.42, z: 25.93 }, { x: -6.84, z: 25.93 }, { x: -6.84, z: 22.98 }] },
  { id: "cafeteria-storage", from: "cafeteria", to: "storage", width: 6.0, via: [{ x: 4.82, z: 10.92 }, { x: 0.47, z: 10.92 }] },
  { id: "cafeteria-admin", from: "cafeteria", to: "admin", width: 4.6, via: [{ x: 15.14, z: 5.03 }, { x: 15.14, z: 8.18 }] },
  { id: "admin-storage", from: "admin", to: "storage", width: 4.6, via: [{ x: 15.14, z: 5.03 }, { x: 4.42, z: 5.03 }, { x: 4.42, z: 10.92 }, { x: 0.47, z: 10.92 }] },
  { id: "cafeteria-weapons", from: "cafeteria", to: "weapons", width: 6.0, via: [] },
  { id: "weapons-o2", from: "weapons", to: "o2", width: 5.1, via: [] },
  { id: "weapons-navigation", from: "weapons", to: "navigation", width: 4.6, via: [{ x: 43.02, z: -6.77 }, { x: 43.02, z: -3.28 }] },
  { id: "o2-navigation", from: "o2", to: "navigation", width: 4.6, via: [{ x: 43.02, z: -6.3 }, { x: 43.02, z: -3.28 }] },
  { id: "navigation-shields", from: "navigation", to: "shields", width: 4.6, via: [{ x: 43.02, z: 1.27 }, { x: 35.45, z: 1.27 }] },
  { id: "storage-shields", from: "storage", to: "shields", width: 6.0, via: [] },
  { id: "storage-communications", from: "storage", to: "communications", width: 4.6, via: [{ x: 22.11, z: 21.11 }, { x: 22.11, z: 27.54 }, { x: 19.1, z: 27.54 }] },
  { id: "shields-communications", from: "shields", to: "communications", width: 4.6, via: [{ x: 22.11, z: 27.54 }, { x: 19.1, z: 27.54 }] },
];

const hull = (...points) => points.map(([x, z]) => ({ x, z }));

export const THE_SKELD = createMapDefinition({
  id: "the-skeld",
  name: "The Skeld",
  shortName: "Skeld",
  description: "The original ship layout: a central Cafeteria and Storage spine with paired engines to port and Navigation to starboard.",
  bounds: { minX: -68, maxX: 67, minZ: -39, maxZ: 39 },
  rooms: [
    {
      id: "cafeteria", name: "Cafeteria", x: 4.82, z: -19.97, width: 34.18, depth: 34.04, shape: "octagon",
      walkablePolygon: hull([-10.8, -17], [11, -17], [17, -11], [17, 10], [10.5, 17], [-9, 17], [-17, 10], [-17, -9]),
      assetKey: "skeld-cafeteria", assetOnly: true, worldLabel: false, artFit: "stretch", artAlpha: 1, artPadding: 0, colour: 0x5b6566
    },
    {
      id: "upper-engine", name: "Upper Engine", x: -45.77, z: -19.7, width: 19, depth: 20.4, shape: "octagon",
      walkablePolygon: hull([-8.9, -9.5], [8.9, -9.5], [9.3, -6.2], [9.3, 8.3], [6.2, 10], [-5.9, 10], [-9.3, 6.5], [-9.3, -6.5]),
      assetKey: "skeld-upper-engine", assetOnly: true, worldLabel: false, artFit: "stretch", artAlpha: 1, artPadding: 0, colour: 0x4a342a
    },
    {
      id: "reactor", name: "Reactor", x: -58.5, z: -1.21, width: 16.5, depth: 25, shape: "octagon",
      walkablePolygon: hull([-5.8, -12.5], [5.8, -12.5], [8.25, -9], [8.25, 9], [5.8, 12.5], [-5.8, 12.5], [-8.25, 9], [-8.25, -9]),
      assetKey: "skeld-reactor", assetOnly: true, worldLabel: false, artFit: "stretch", artAlpha: 1, artPadding: 0, colour: 0x512d35
    },
    {
      id: "security", name: "Security", x: -33.64, z: -2.28, width: 10.3, depth: 20, shape: "octagon",
      walkablePolygon: hull([-4.7, -10], [3.8, -10], [5.15, -8.4], [5.15, 8.7], [3.8, 10], [-4.7, 10]),
      assetKey: "skeld-security", assetOnly: true, worldLabel: false, artFit: "stretch", artAlpha: 1, artPadding: 0, colour: 0x3b334f
    },
    {
      id: "medbay", name: "MedBay", x: -18.16, z: -7.24, width: 20, depth: 18.2, shape: "octagon",
      walkablePolygon: hull([-8.4, -9.1], [8.4, -9.1], [10, -6.7], [10, 6.7], [7.5, 9.1], [-7.6, 9.1], [-10, 6.5], [-10, -6.5]),
      assetKey: "skeld-medbay", artCrop: { x: 0, y: 0, width: 520, height: 520 }, assetOnly: true, worldLabel: false, artFit: "stretch", artAlpha: 1, artPadding: 0, colour: 0x1f5153
    },
    {
      id: "lower-engine", name: "Lower Engine", x: -45.84, z: 18.23, width: 19, depth: 20.4, shape: "octagon",
      walkablePolygon: hull([-5.9, -10], [6.2, -10], [9.3, -8.3], [9.3, 6.5], [8.9, 9.5], [-8.9, 9.5], [-9.3, 6.5], [-9.3, -6.5]),
      assetKey: "skeld-lower-engine", assetOnly: true, worldLabel: false, artFit: "stretch", artAlpha: 1, artPadding: 0, colour: 0x4a342a
    },
    {
      id: "electrical", name: "Electrical", x: -16.82, z: 13.07, width: 16, depth: 21, shape: "octagon",
      walkablePolygon: hull([-8, -10.5], [8, -10.5], [8, -5.5], [5.4, -1.8], [5.4, 4.2], [1.2, 10.5], [-8, 10.5]),
      assetKey: "skeld-electrical", assetOnly: true, worldLabel: false, artFit: "stretch", artAlpha: 1, artPadding: 0, colour: 0x594437
    },
    {
      id: "storage", name: "Storage", x: 0.47, z: 22.98, width: 20.5, depth: 30, shape: "octagon",
      walkablePolygon: hull([-7.5, -15], [10.25, -15], [10.25, 11], [7.2, 15], [-6.4, 15], [-10.25, 10.8], [-10.25, -11]),
      assetKey: "skeld-storage", assetOnly: true, worldLabel: false, artFit: "stretch", artAlpha: 1, artPadding: 0, colour: 0x443c32
    },
    {
      id: "communications", name: "Communications", x: 19.1, z: 31.09, width: 17, depth: 13, shape: "octagon",
      walkablePolygon: hull([-7.2, -6.5], [7.2, -6.5], [8.5, -5], [8.5, 5], [7, 6.5], [-7, 6.5], [-8.5, 5], [-8.5, -5]),
      assetKey: "skeld-communications", assetOnly: true, worldLabel: false, artFit: "stretch", artAlpha: 1, artPadding: 0, colour: 0x24485b
    },
    {
      id: "admin", name: "Admin", x: 20.51, z: 8.18, width: 18, depth: 15.5, shape: "octagon",
      walkablePolygon: hull([-8.2, -7.75], [6.4, -7.75], [9, -5.4], [9, 5.8], [7, 7.75], [-8.2, 7.75], [-9, 6], [-9, -6]),
      assetKey: "skeld-admin", assetOnly: true, worldLabel: false, artFit: "stretch", artAlpha: 1, artPadding: 0, colour: 0x503040
    },
    {
      id: "shields", name: "Shields", x: 35.45, z: 21.11, width: 16.3, depth: 17, shape: "octagon",
      walkablePolygon: hull([-5.5, -8.5], [4.2, -8.5], [8.15, -5.2], [8.15, 4.8], [4.8, 8.5], [-5.2, 8.5], [-8.15, 5], [-8.15, -5]),
      assetKey: "skeld-shields", assetOnly: true, worldLabel: false, artFit: "stretch", artAlpha: 1, artPadding: 0, colour: 0x3b285e
    },
    {
      id: "o2", name: "O2", x: 24.93, z: -6.3, width: 11.2, depth: 10.1, shape: "octagon",
      walkablePolygon: hull([-4.4, -5.05], [4.5, -5.05], [5.6, -3.7], [5.6, 3.7], [4.3, 5.05], [-4.4, 5.05], [-5.6, 3.5], [-5.6, -3.4]),
      assetKey: "skeld-o2", assetOnly: true, worldLabel: false, artFit: "stretch", artAlpha: 1, artPadding: 0, colour: 0x1d4d4b
    },
    {
      id: "weapons", name: "Weapons", x: 35.45, z: -21.91, width: 16.5, depth: 15.6, shape: "octagon",
      walkablePolygon: hull([-5.4, -7.8], [4.8, -7.8], [8.25, -4.6], [8.25, 4.3], [4.7, 7.8], [-4.7, 7.8], [-8.25, 4.5], [-8.25, -4.2]),
      assetKey: "skeld-weapons", assetOnly: true, worldLabel: false, artFit: "stretch", artAlpha: 1, artPadding: 0, colour: 0x2c4552
    },
    {
      id: "navigation", name: "Navigation", x: 59.1, z: -3.28, width: 13.5, depth: 16.5, shape: "octagon",
      // The six points are traced from the clean 344x420 Navigation crop. Keeping
      // its 0.818 aspect ratio stops the console room being squeezed into a strip.
      walkablePolygon: hull([-5.38, -8.25], [1.57, -8.25], [6.75, -4.71], [6.75, 4.91], [1.14, 8.25], [-5.38, 8.25]),
      assetKey: "skeld-navigation", artCrop: { x: 0, y: 0, width: 344, height: 420 }, assetOnly: true, worldLabel: false, artFit: "stretch", artAlpha: 1, artPadding: 0, colour: 0x253b65
    },
  ],
  connections: SKELD_ROUTES.map(({ from, to }) => [from, to]),
  corridorRoutes: SKELD_ROUTES,
  tasks: [
    task("skeld-swipe-card", "Swipe Card", "admin", 16.01, 11.38, "sequence"),
    task("skeld-align-engine", "Align Engine Output", "upper-engine", -51.4, -15.1, "balance"),
    task("skeld-calibrate-distributor", "Calibrate Distributor", "electrical", -16.82, 13.07, "sequence"),
    task("skeld-submit-scan", "Submit Scan", "medbay", -14.66, -7.24, "scan"),
    task("skeld-stabilize-steering", "Stabilize Steering", "navigation", 59.84, -3.28, "route"),
    task("skeld-clean-o2-filter", "Clean O2 Filter", "o2", 24.93, -6.3, "filter"),
    task("skeld-empty-garbage", "Empty Garbage", "storage", -4.03, 25.48, "classify"),
    task("skeld-prime-shields", "Prime Shields", "shields", 39.3, 26, "sync"),
  ],
  sabotages: [
    { id: "skeld-reactor-meltdown", name: "Reactor Meltdown", critical: true, durationMs: 45000, repairStations: ["skeld-reactor-alpha", "skeld-reactor-beta"], roomId: "reactor" },
    { id: "skeld-o2-depletion", name: "O2 Depletion", critical: true, durationMs: 50000, repairStations: ["skeld-o2-panel", "skeld-admin-o2"], roomId: "o2" },
    { id: "skeld-comms-sabotage", name: "Communications Sabotage", critical: false, durationMs: 40000, repairStations: ["skeld-comms-panel"], roomId: "communications" },
    { id: "skeld-lights-out", name: "Lights Out", critical: false, durationMs: 40000, repairStations: ["skeld-light-panel"], roomId: "electrical" }
  ],
  stations: [
    station("meeting-console", "meeting", "cafeteria", 4.82, -19.97),
    station("skeld-cameras", "security", "security", -33.64, -2.28),
    // Vent network per the supplied reference: reactor<->engines, medbay<->electrical<->security,
    // cafeteria<->admin, weapons<->navigation<->shields (as paired hops).
    station("skeld-vent-cafeteria", "maintenance", "cafeteria", 12, -26, "skeld-vent-admin"),
    station("skeld-vent-admin", "maintenance", "admin", 24.5, 8.18, "skeld-vent-cafeteria"),
    station("skeld-vent-medbay", "maintenance", "medbay", -18.16, -3, "skeld-vent-electrical-a"),
    station("skeld-vent-electrical-a", "maintenance", "electrical", -19, 9.5, "skeld-vent-medbay"),
    station("skeld-vent-electrical-b", "maintenance", "electrical", -14, 16.5, "skeld-vent-security"),
    station("skeld-vent-security", "maintenance", "security", -33.64, 2, "skeld-vent-electrical-b"),
    station("skeld-vent-reactor-upper", "maintenance", "reactor", -58.5, -8, "skeld-vent-upper-engine"),
    station("skeld-vent-upper-engine", "maintenance", "upper-engine", -49, -19.7, "skeld-vent-reactor-upper"),
    station("skeld-vent-reactor-lower", "maintenance", "reactor", -58.5, 6, "skeld-vent-lower-engine"),
    station("skeld-vent-lower-engine", "maintenance", "lower-engine", -49, 18.23, "skeld-vent-reactor-lower"),
    station("skeld-vent-weapons", "maintenance", "weapons", 35.45, -17, "skeld-vent-navigation-a"),
    station("skeld-vent-navigation-a", "maintenance", "navigation", 59.84, -7, "skeld-vent-weapons"),
    station("skeld-vent-navigation-b", "maintenance", "navigation", 59.84, 0.5, "skeld-vent-shields"),
    station("skeld-vent-shields", "maintenance", "shields", 35.45, 27.5, "skeld-vent-navigation-b"),
    station("skeld-reactor-alpha", "repair", "reactor", -53.3, -4.8, "skeld-reactor-meltdown"),
    station("skeld-reactor-beta", "repair", "reactor", -53.3, 3, "skeld-reactor-meltdown"),
    station("skeld-o2-panel", "repair", "o2", 24.93, -10.2, "skeld-o2-depletion"),
    station("skeld-admin-o2", "repair", "admin", 25.01, 4.98, "skeld-o2-depletion"),
    station("skeld-comms-panel", "repair", "communications", 19.1, 31.09, "skeld-comms-sabotage"),
    station("skeld-light-panel", "repair", "electrical", -12.32, 13.07, "skeld-lights-out"),
  ],
  spawnPoints: [
    [16.82, -19.97], [13.6, -16.33], [14.5, -8.5], [8.46, -11.19],
    [4.82, -7.97], [1.18, -11.19], [-4.8, -8.5], [-3.96, -16.33],
    [-7.18, -19.97], [-3.96, -23.61], [-4.8, -31.5], [1.18, -28.75],
    [4.82, -31.97], [8.46, -28.75], [14.5, -31.5], [13.6, -23.61]
  ],
  collisionRects: [
    { id: "skeld-cafeteria-table-nw", kind: "table", roomId: "cafeteria", x: -4.4, z: -28.4, width: 5.5, depth: 3.3, prop: false },
    { id: "skeld-cafeteria-table-ne", kind: "table", roomId: "cafeteria", x: 14.1, z: -28.4, width: 5.5, depth: 3.3, prop: false },
    { id: "skeld-emergency-table", kind: "table", roomId: "cafeteria", x: 4.82, z: -19.97, width: 5.5, depth: 3.4, prop: false },
    { id: "skeld-cafeteria-table-sw", kind: "table", roomId: "cafeteria", x: -4.4, z: -11.6, width: 5.5, depth: 3.3, prop: false },
    { id: "skeld-cafeteria-table-se", kind: "table", roomId: "cafeteria", x: 14.1, z: -11.6, width: 5.5, depth: 3.3, prop: false },
    { id: "skeld-upper-engine-core", kind: "engine", shape: "ellipse", roomId: "upper-engine", x: -45.8, z: -19.7, width: 10.2, depth: 8.2, prop: false },
    { id: "skeld-upper-engine-console", kind: "console", roomId: "upper-engine", x: -51.4, z: -15.1, width: 3.4, depth: 4.1, prop: false },
    { id: "skeld-lower-engine-core", kind: "engine", shape: "ellipse", roomId: "lower-engine", x: -45.8, z: 18.2, width: 10.2, depth: 8.2, prop: false },
    { id: "skeld-lower-engine-console", kind: "console", roomId: "lower-engine", x: -51.4, z: 13.6, width: 3.4, depth: 4.1, prop: false },
    { id: "skeld-reactor-core", kind: "reactor", shape: "ellipse", roomId: "reactor", x: -58.5, z: -1.2, width: 7.4, depth: 7.4, prop: false },
    { id: "skeld-reactor-tubes-nw", kind: "reactor", roomId: "reactor", x: -62.4, z: -8.2, width: 2.2, depth: 4.5, prop: false },
    { id: "skeld-reactor-tubes-ne", kind: "reactor", roomId: "reactor", x: -54.6, z: -8.2, width: 2.2, depth: 4.5, prop: false },
    { id: "skeld-reactor-tubes-sw", kind: "reactor", roomId: "reactor", x: -62.4, z: 5.8, width: 2.2, depth: 4.5, prop: false },
    { id: "skeld-reactor-tubes-se", kind: "reactor", roomId: "reactor", x: -54.6, z: 5.8, width: 2.2, depth: 4.5, prop: false },
    { id: "skeld-security-console", kind: "console", roomId: "security", x: -33.6, z: -6.3, width: 6.4, depth: 3.3, prop: false },
    { id: "skeld-security-side-desk", kind: "console", roomId: "security", x: -30.8, z: 1.9, width: 2.6, depth: 5.2, prop: false },
    { id: "skeld-med-scanner", kind: "scanner", roomId: "medbay", x: -14.2, z: -1.9, width: 3.2, depth: 3.2, prop: false },
    { id: "skeld-med-bed-west-north", kind: "bed", roomId: "medbay", x: -23.4, z: -10.7, width: 2.8, depth: 4.7, prop: false },
    { id: "skeld-med-bed-east-north", kind: "bed", roomId: "medbay", x: -13.4, z: -10.7, width: 2.8, depth: 4.7, prop: false },
    { id: "skeld-med-bed-west-south", kind: "bed", roomId: "medbay", x: -23.4, z: -4.1, width: 2.8, depth: 4.7, prop: false },
    { id: "skeld-med-bed-east-south", kind: "bed", roomId: "medbay", x: -13.4, z: -4.1, width: 2.8, depth: 4.7, prop: false },
    { id: "skeld-electrical-cabinets", kind: "console", roomId: "electrical", x: -16.8, z: 4.6, width: 9.1, depth: 2.5, prop: false },
    { id: "skeld-electrical-side-panel", kind: "console", roomId: "electrical", x: -11.9, z: 11.2, width: 2.4, depth: 4.4, prop: false },
    { id: "skeld-storage-crates-main", kind: "cargo", roomId: "storage", x: 2.1, z: 22.8, width: 5.8, depth: 4.8, prop: false },
    { id: "skeld-storage-crate-nw", kind: "cargo", roomId: "storage", x: -1.9, z: 19.6, width: 3, depth: 3, prop: false },
    { id: "skeld-storage-crate-se", kind: "cargo", roomId: "storage", x: 5.4, z: 26.2, width: 3, depth: 3, prop: false },
    { id: "skeld-admin-table", kind: "table", shape: "ellipse", roomId: "admin", x: 20.51, z: 8.18, width: 7.6, depth: 4.4, prop: false },
    { id: "skeld-admin-console-bank", kind: "console", roomId: "admin", x: 20.5, z: 2.6, width: 8.2, depth: 2.1, prop: false },
    { id: "skeld-o2-canisters", kind: "console", roomId: "o2", x: 24.9, z: -3.7, width: 6.1, depth: 2.8, prop: false },
    { id: "skeld-o2-filter-bank", kind: "console", roomId: "o2", x: 27.5, z: -8.4, width: 2.3, depth: 2.5, prop: false },
    { id: "skeld-weapons-platform", kind: "console", shape: "ellipse", roomId: "weapons", x: 35.45, z: -21.91, width: 5.8, depth: 5.1, prop: false },
    { id: "skeld-navigation-console", kind: "console", roomId: "navigation", x: 62.4, z: -3.1, width: 4.2, depth: 8.2, prop: false },
    { id: "skeld-navigation-north-console", kind: "console", roomId: "navigation", x: 59.3, z: -9.4, width: 3.8, depth: 2.2, prop: false },
    { id: "skeld-shields-platform", kind: "console", shape: "ellipse", roomId: "shields", x: 35.45, z: 21.11, width: 6.2, depth: 6.2, prop: false },
    { id: "skeld-shields-south-console", kind: "console", roomId: "shields", x: 39.3, z: 26, width: 3.3, depth: 2.2, prop: false },
    { id: "skeld-comms-desk", kind: "console", roomId: "communications", x: 19.1, z: 32.6, width: 7.2, depth: 3.3, prop: false },
    { id: "skeld-comms-equipment", kind: "console", roomId: "communications", x: 13.6, z: 28, width: 2.5, depth: 3.2, prop: false }
  ],
  theme: {
    worldScale: 42,
    corridorFill: 0x142a30,
    corridorStroke: 0x6b8b8f,
    corridorAccent: 0x7adfec,
    frame: 0xa6d7d9,
    artAlpha: 0.82
  }
});
