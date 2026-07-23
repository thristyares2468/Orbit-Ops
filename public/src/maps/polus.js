import { createMapDefinition, station, task } from "./mapFactory.js";

const POLUS_ROUTES = [
  { id: "dropship-north", from: "dropship", to: "outside-north" },
  { id: "north-electrical", from: "outside-north", to: "electrical", via: [{ x: -28, z: -20 }, { x: -28, z: -18 }] },
  { id: "electrical-security", from: "electrical", to: "security" },
  { id: "north-storage", from: "outside-north", to: "storage" },
  { id: "north-laboratory", from: "outside-north", to: "laboratory", via: [{ x: 22, z: -20 }] },
  { id: "laboratory-medbay", from: "laboratory", to: "medbay" },
  { id: "security-o2", from: "security", to: "o2" },
  { id: "electrical-o2", from: "electrical", to: "o2", via: [{ x: -47, z: -18 }] },
  { id: "o2-boiler", from: "o2", to: "boiler-room" },
  { id: "o2-communications", from: "o2", to: "communications" },
  { id: "communications-weapons", from: "communications", to: "weapons" },
  { id: "communications-office", from: "communications", to: "office" },
  { id: "storage-office", from: "storage", to: "office" },
  { id: "office-admin", from: "office", to: "admin" },
  { id: "laboratory-decontamination", from: "laboratory", to: "decontamination", via: [{ x: 36, z: 0 }] },
  { id: "admin-decontamination", from: "admin", to: "decontamination" },
  { id: "decontamination-specimen", from: "decontamination", to: "specimen-room" },
  { id: "weapons-admin", from: "weapons", to: "admin" },
  { id: "boiler-weapons", from: "boiler-room", to: "weapons" }
];

export const POLUS = createMapDefinition({
  id: "polus",
  name: "Polus",
  description: "A volcanic research outpost whose isolated buildings are linked by broad, exposed snowfields and a sealed specimen route.",
  bounds: { minX: -66, maxX: 66, minZ: -48, maxZ: 49 },
  zones: [
    { id: "polus-north-field", x: 0, z: -19, width: 108, depth: 18, shape: "octagon", pattern: "snow", colour: 0x493c68, stroke: 0x8b78ad },
    { id: "polus-west-field", x: -39, z: 8, width: 44, depth: 43, shape: "octagon", pattern: "snow", colour: 0x51436f, stroke: 0x8b78ad },
    { id: "polus-centre-field", x: -2, z: 8, width: 50, depth: 39, pattern: "snow", colour: 0x4e416c, stroke: 0x8b78ad },
    { id: "polus-east-field", x: 35, z: 2, width: 47, depth: 38, shape: "octagon", pattern: "snow", colour: 0x4d406c, stroke: 0x8b78ad },
    { id: "polus-south-field", x: 2, z: 32, width: 102, depth: 24, shape: "octagon", pattern: "snow", colour: 0x51436f, stroke: 0x8b78ad }
  ],
  rooms: [
    { id: "dropship", name: "Dropship", x: 0, z: -38, width: 18, depth: 14, shape: "octagon", colour: 0x40515a },
    { id: "outside-north", name: "Outside", x: 0, z: -23, width: 12, depth: 8, label: false, colour: 0x493f65 },
    { id: "security", name: "Security", x: -55, z: -14, width: 10, depth: 10, colour: 0x3f3b54 },
    { id: "electrical", name: "Electrical", x: -40, z: -18, width: 15, depth: 14, colour: 0x55433a },
    { id: "storage", name: "Storage", x: -10, z: -16, width: 12, depth: 9, assetKey: "polus-storage", artAlpha: 0.88, colour: 0x4d483d },
    { id: "laboratory", name: "Laboratory", x: 38, z: -20, width: 26, depth: 12, shape: "octagon", assetKey: "polus-science", artAlpha: 0.9, colour: 0x34546a },
    { id: "medbay", name: "MedBay", x: 52, z: -9, width: 10, depth: 9, colour: 0x2c5559 },
    { id: "o2", name: "O2", x: -50, z: 3, width: 12, depth: 12, assetKey: "polus-o2", artAlpha: 0.88, colour: 0x31524e },
    { id: "communications", name: "Communications", x: -30, z: 5, width: 13, depth: 10, assetKey: "polus-broadcast", artAlpha: 0.9, colour: 0x30475c },
    { id: "office", name: "Office", x: 5, z: 5, width: 27, depth: 10, colour: 0x4b3c54 },
    { id: "admin", name: "Admin", x: 10, z: 22, width: 15, depth: 13, colour: 0x453543 },
    { id: "weapons", name: "Weapons", x: -30, z: 25, width: 12, depth: 13, assetKey: "polus-weapons", artAlpha: 0.9, colour: 0x523b42 },
    { id: "boiler-room", name: "Boiler Room", x: -50, z: 25, width: 12, depth: 11, colour: 0x4d4240 },
    { id: "decontamination", name: "Decontamination", x: 36, z: 18, width: 8, depth: 12, assetKey: "polus-tunnel", artAlpha: 0.85, colour: 0x58686b },
    { id: "specimen-room", name: "Specimen Room", x: 51, z: 31, width: 14, depth: 14, shape: "octagon", assetKey: "polus-specimen", artAlpha: 0.9, colour: 0x3c4860 }
  ],
  connections: POLUS_ROUTES.map(({ from, to }) => [from, to]),
  corridorRoutes: POLUS_ROUTES,
  tasks: [
    task("polus-insert-keys", "Insert Keys", "dropship", 0, -38, "sequence"),
    task("polus-repair-drill", "Repair Drill", "laboratory", 34, -20, "sync"),
    task("polus-record-temperature", "Record Temperature", "outside-north", 2, -23, "balance"),
    task("polus-scan-boarding-pass", "Scan Boarding Pass", "office", 2, 5, "scan"),
    task("polus-reboot-wifi", "Reboot Wi-Fi", "communications", -30, 5, "sequence"),
    task("polus-open-waterways", "Open Waterways", "boiler-room", -50, 25, "route"),
    task("polus-store-artifacts", "Store Artifacts", "specimen-room", 51, 31, "classify"),
    task("polus-fuel-engines", "Fuel Engines", "storage", -10, -16, "manifest")
  ],
  sabotages: [
    { id: "polus-seismic-stabilizers", name: "Seismic Stabilizers", critical: true, durationMs: 55000, repairStations: ["polus-seismic-west", "polus-seismic-east"], roomId: "outside-north" },
    { id: "polus-comms-sabotage", name: "Communications Sabotage", critical: false, durationMs: 40000, repairStations: ["polus-comms-panel"], roomId: "communications" },
    { id: "polus-lighting-failure", name: "Lighting Failure", critical: false, durationMs: 40000, repairStations: ["polus-light-panel"], roomId: "electrical" },
    { id: "polus-door-lockdown", name: "Door Lockdown", critical: false, durationMs: 30000, repairStations: ["polus-office-override"], roomId: "office" }
  ],
  stations: [
    station("meeting-console", "meeting", "office", 5, 5),
    station("polus-cameras", "security", "security", -55, -14),
    station("polus-vent-a", "maintenance", "electrical", -40, -18, "polus-vent-b"),
    station("polus-vent-b", "maintenance", "laboratory", 40, -20, "polus-vent-a"),
    station("polus-seismic-west", "repair", "outside-north", -4, -23, "polus-seismic-stabilizers"),
    station("polus-seismic-east", "repair", "outside-north", 4, -23, "polus-seismic-stabilizers"),
    station("polus-comms-panel", "repair", "communications", -30, 5, "polus-comms-sabotage"),
    station("polus-light-panel", "repair", "electrical", -40, -18, "polus-lighting-failure"),
    station("polus-office-override", "repair", "office", 10, 5, "polus-door-lockdown")
  ],
  spawnPoints: [
    [-6, -41], [-3, -42], [3, -42], [6, -41], [-6, -35], [-3, -34], [3, -34], [6, -35],
    [-7, -38], [-4, -38], [4, -38], [7, -38], [0, -43], [0, -33], [-7, -34], [7, -42]
  ],
  collisionRects: [
    { id: "polus-office-meeting-table", kind: "table", roomId: "office", x: 5, z: 5, width: 4.8, depth: 3 },
    { id: "polus-storage-crates", kind: "cargo", roomId: "storage", x: -7, z: -16, width: 3.5, depth: 3 },
    { id: "polus-lab-bench", kind: "console", roomId: "laboratory", x: 41, z: -21, width: 4, depth: 2.6 },
    { id: "polus-west-rocks", kind: "cargo", roomId: "outside-north", x: -18, z: 12, width: 4.2, depth: 3.6 },
    { id: "polus-east-rocks", kind: "cargo", roomId: "outside-north", x: 25, z: 7, width: 4.5, depth: 3.4 }
  ],
  corridorWidth: 5,
  theme: {
    worldScale: 39,
    corridorFill: 0x46506c,
    corridorStroke: 0xa8b5dd,
    zoneFill: 0x4d406c,
    zoneStroke: 0x9a86bb,
    frame: 0xc3d1ff,
    artAlpha: 0.82
  }
});
