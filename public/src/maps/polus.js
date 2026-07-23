import { createMapDefinition, station, task } from "./mapFactory.js";

export const POLUS = createMapDefinition({
  id: "polus",
  name: "Polus",
  description: "A volcanic planetary outpost connected by exposed outdoor paths and sealed laboratory routes.",
  bounds: { minX: -62, maxX: 61, minZ: -48, maxZ: 47 },
  rooms: [
    { id: "dropship", name: "Dropship", x: 0, z: -37, width: 17, depth: 11, shape: "octagon", assetKey: "polus-dropship", colour: 0x40515a },
    { id: "outside-north", name: "Outside", x: 0, z: -21, width: 14, depth: 10, colour: 0x42546b },
    { id: "electrical", name: "Electrical", x: -38, z: -18, width: 15, depth: 13, assetKey: "polus-security", colour: 0x55433a },
    { id: "security", name: "Security", x: -20, z: -17, width: 12, depth: 10, assetKey: "polus-security", colour: 0x3f3b54 },
    { id: "o2", name: "O2", x: -43, z: 4, width: 14, depth: 12, assetKey: "polus-o2", colour: 0x31524e },
    { id: "boiler-room", name: "Boiler Room", x: -47, z: 22, width: 13, depth: 11, assetKey: "polus-planet-2", colour: 0x4d4240 },
    { id: "communications", name: "Communications", x: -25, z: 23, width: 12, depth: 10, assetKey: "polus-broadcast", colour: 0x30475c },
    { id: "weapons", name: "Weapons", x: -8, z: 30, width: 13, depth: 11, assetKey: "polus-weapons", colour: 0x523b42 },
    { id: "storage", name: "Storage", x: -8, z: 8, width: 14, depth: 12, assetKey: "polus-storage", colour: 0x4d483d },
    { id: "office", name: "Office", x: 19, z: 9, width: 15, depth: 12, assetKey: "polus-planet-1", colour: 0x4b3c54 },
    { id: "admin", name: "Admin", x: 34, z: 11, width: 12, depth: 10, assetKey: "polus-planet-3", colour: 0x453543 },
    { id: "laboratory", name: "Laboratory", x: 35, z: -22, width: 18, depth: 14, shape: "octagon", assetKey: "polus-science", colour: 0x34546a },
    { id: "medbay", name: "MedBay", x: 51, z: -13, width: 10, depth: 10, assetKey: "polus-science", colour: 0x2c5559 },
    { id: "decontamination", name: "Decontamination", x: 38, z: 28, width: 10, depth: 11, assetKey: "polus-tunnel", colour: 0x58686b },
    { id: "specimen-room", name: "Specimen Room", x: 51, z: 40, width: 15, depth: 11, shape: "octagon", assetKey: "polus-specimen", colour: 0x3c4860 }
  ],
  connections: [
    ["dropship", "outside-north"], ["outside-north", "electrical"], ["outside-north", "security"], ["outside-north", "laboratory"],
    ["electrical", "security"], ["electrical", "o2"], ["security", "storage"], ["o2", "boiler-room"], ["o2", "communications"],
    ["boiler-room", "communications"], ["communications", "weapons"], ["communications", "storage"], ["weapons", "storage"],
    ["storage", "office"], ["office", "admin"], ["office", "laboratory"], ["admin", "decontamination"],
    ["laboratory", "medbay"], ["laboratory", "decontamination"], ["decontamination", "specimen-room"]
  ],
  tasks: [
    task("polus-insert-keys", "Insert Keys", "dropship", 0, -37, "sequence"),
    task("polus-repair-drill", "Repair Drill", "laboratory", 32, -22, "sync"),
    task("polus-record-temperature", "Record Temperature", "outside-north", 2, -21, "balance"),
    task("polus-scan-boarding-pass", "Scan Boarding Pass", "office", 18, 9, "scan"),
    task("polus-reboot-wifi", "Reboot Wi-Fi", "communications", -25, 23, "sequence"),
    task("polus-open-waterways", "Open Waterways", "boiler-room", -47, 22, "route"),
    task("polus-store-artifacts", "Store Artifacts", "specimen-room", 51, 40, "classify"),
    task("polus-fuel-engines", "Fuel Engines", "storage", -8, 8, "manifest")
  ],
  sabotages: [
    { id: "polus-seismic-stabilizers", name: "Seismic Stabilizers", critical: true, durationMs: 55000, repairStations: ["polus-seismic-west", "polus-seismic-east"], roomId: "outside-north" },
    { id: "polus-comms-sabotage", name: "Communications Sabotage", critical: false, durationMs: 40000, repairStations: ["polus-comms-panel"], roomId: "communications" },
    { id: "polus-lighting-failure", name: "Lighting Failure", critical: false, durationMs: 40000, repairStations: ["polus-light-panel"], roomId: "electrical" },
    { id: "polus-door-lockdown", name: "Door Lockdown", critical: false, durationMs: 30000, repairStations: ["polus-office-override"], roomId: "office" }
  ],
  stations: [
    station("meeting-console", "meeting", "office", 19, 9),
    station("polus-cameras", "security", "security", -20, -17),
    station("polus-vent-a", "maintenance", "electrical", -38, -18, "polus-vent-b"),
    station("polus-vent-b", "maintenance", "laboratory", 35, -22, "polus-vent-a"),
    station("polus-seismic-west", "repair", "outside-north", -5, -21, "polus-seismic-stabilizers"),
    station("polus-seismic-east", "repair", "outside-north", 5, -21, "polus-seismic-stabilizers"),
    station("polus-comms-panel", "repair", "communications", -25, 23, "polus-comms-sabotage"),
    station("polus-light-panel", "repair", "electrical", -38, -18, "polus-lighting-failure"),
    station("polus-office-override", "repair", "office", 19, 9, "polus-door-lockdown")
  ],
  spawnPoints: [
    [-5, -39], [-2.5, -39], [2.5, -39], [5, -39], [-5, -35], [-2.5, -35], [2.5, -35], [5, -35],
    [-6, -37], [-3, -37], [3, -37], [6, -37], [0, -40], [0, -34], [-6, -34], [6, -40]
  ],
  collisionRects: [
    { id: "polus-office-meeting-table", kind: "table", roomId: "office", x: 19, z: 9, width: 4.4, depth: 2.8 },
    { id: "polus-storage-crates", kind: "cargo", roomId: "storage", x: -5, z: 9, width: 3.5, depth: 3 },
    { id: "polus-lab-bench", kind: "console", roomId: "laboratory", x: 38, z: -24, width: 4, depth: 2.6 }
  ],
  corridorWidth: 5,
  theme: { corridorFill: 0x34455f, corridorStroke: 0x899bc2, frame: 0xc3d1ff, artAlpha: 0.7 }
});

