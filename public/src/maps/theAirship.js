import { createMapDefinition, station, task } from "./mapFactory.js";

export const THE_AIRSHIP = createMapDefinition({
  id: "the-airship",
  name: "The Airship",
  shortName: "Airship",
  description: "A very large airship with long cross-deck routes, a central gap, ladders, and separated spawn wings.",
  bounds: { minX: -78, maxX: 78, minZ: -52, maxZ: 52 },
  rooms: [
    { id: "cockpit", name: "Cockpit", x: -66, z: -10, width: 15, depth: 13, shape: "octagon", colour: 0x394959 },
    { id: "viewing-deck", name: "Viewing Deck", x: -65, z: 32, width: 14, depth: 10, shape: "octagon", colour: 0x344d5b },
    { id: "communications", name: "Communications", x: -47, z: 21, width: 12, depth: 10, colour: 0x344657 },
    { id: "engine-room", name: "Engine Room", x: -45, z: -7, width: 18, depth: 14, shape: "octagon", colour: 0x564137 },
    { id: "vault", name: "Vault", x: -40, z: -32, width: 16, depth: 13, shape: "octagon", colour: 0x594d36 },
    { id: "brig", name: "Brig", x: -24, z: -19, width: 12, depth: 10, colour: 0x4d4549 },
    { id: "armory", name: "Armory", x: -27, z: 17, width: 15, depth: 12, colour: 0x51403d },
    { id: "kitchen", name: "Kitchen", x: -25, z: 37, width: 15, depth: 11, colour: 0x4b4d42 },
    { id: "security", name: "Security", x: -5, z: 31, width: 11, depth: 10, colour: 0x3b3a53 },
    { id: "electrical", name: "Electrical", x: 9, z: 35, width: 15, depth: 13, shape: "octagon", colour: 0x594438 },
    { id: "medical", name: "Medical", x: -2, z: 15, width: 13, depth: 10, colour: 0x31545b },
    { id: "main-hall", name: "Main Hall", x: 0, z: 0, width: 18, depth: 15, shape: "octagon", colour: 0x4a4c59 },
    { id: "gap-room", name: "Gap Room", x: 20, z: -18, width: 18, depth: 13, shape: "octagon", colour: 0x384b58 },
    { id: "meeting-room", name: "Meeting Room", x: 25, z: -39, width: 17, depth: 12, shape: "octagon", colour: 0x4d4758 },
    { id: "records", name: "Records", x: 41, z: -5, width: 16, depth: 13, shape: "octagon", colour: 0x51483d },
    { id: "showers", name: "Showers", x: 37, z: 18, width: 15, depth: 12, colour: 0x3e5360 },
    { id: "lounge", name: "Lounge", x: 61, z: 9, width: 14, depth: 12, shape: "octagon", colour: 0x4a3f50 },
    { id: "cargo-bay", name: "Cargo Bay", x: 59, z: 36, width: 20, depth: 16, shape: "octagon", colour: 0x4c493f }
  ],
  connections: [
    ["cockpit", "engine-room"], ["cockpit", "communications"], ["viewing-deck", "communications"], ["viewing-deck", "kitchen"],
    ["communications", "engine-room"], ["communications", "armory"], ["engine-room", "vault"], ["engine-room", "brig"],
    ["vault", "brig"], ["brig", "main-hall"], ["armory", "kitchen"], ["armory", "security"], ["armory", "medical"],
    ["kitchen", "security"], ["security", "electrical"], ["security", "medical"], ["medical", "main-hall"], ["medical", "showers"],
    ["main-hall", "gap-room"], ["main-hall", "records"], ["main-hall", "showers"], ["gap-room", "meeting-room"],
    ["gap-room", "records"], ["records", "showers"], ["records", "lounge"], ["showers", "cargo-bay"], ["lounge", "cargo-bay"]
  ],
  tasks: [
    task("airship-steer", "Steer Airship", "cockpit", -66, -10, "route"),
    task("airship-dress-mannequin", "Dress Mannequin", "vault", -40, -32, "classify"),
    task("airship-put-away-pistols", "Put Away Pistols", "armory", -27, 17, "sequence"),
    task("airship-make-burger", "Make Burger", "kitchen", -25, 37, "manifest"),
    task("airship-reset-breakers", "Reset Breakers", "electrical", 9, 35, "sequence"),
    task("airship-decontaminate", "Decontaminate", "main-hall", 0, 0, "scan"),
    task("airship-sort-records", "Sort Records", "records", 41, -5, "classify"),
    task("airship-polish-ruby", "Polish Ruby", "cargo-bay", 59, 36, "filter")
  ],
  sabotages: [
    { id: "airship-avert-crash", name: "Avert Crash Course", critical: true, durationMs: 55000, repairStations: ["airship-gap-left", "airship-gap-right"], roomId: "gap-room" },
    { id: "airship-comms-sabotage", name: "Communications Sabotage", critical: false, durationMs: 40000, repairStations: ["airship-comms-panel"], roomId: "communications" },
    { id: "airship-lights-out", name: "Lights Out", critical: false, durationMs: 40000, repairStations: ["airship-light-panel"], roomId: "electrical" },
    { id: "airship-door-lockdown", name: "Door Lockdown", critical: false, durationMs: 30000, repairStations: ["airship-security-override"], roomId: "security" }
  ],
  stations: [
    station("meeting-console", "meeting", "meeting-room", 25, -39),
    station("airship-cameras", "security", "security", -5, 31),
    station("airship-vent-a", "maintenance", "cockpit", -66, -10, "airship-vent-b"),
    station("airship-vent-b", "maintenance", "cargo-bay", 59, 36, "airship-vent-a"),
    station("airship-gap-left", "repair", "gap-room", 16, -18, "airship-avert-crash"),
    station("airship-gap-right", "repair", "gap-room", 24, -18, "airship-avert-crash"),
    station("airship-comms-panel", "repair", "communications", -47, 21, "airship-comms-sabotage"),
    station("airship-light-panel", "repair", "electrical", 9, 35, "airship-lights-out"),
    station("airship-security-override", "repair", "security", -5, 31, "airship-door-lockdown")
  ],
  spawnPoints: [
    [-6, -2], [-3, -3], [0, -4], [3, -3], [6, -2], [-6, 3], [-3, 4], [0, 5],
    [3, 4], [6, 3], [-7, 0], [-3.5, 0], [3.5, 0], [7, 0], [0, -6], [0, 6]
  ],
  collisionRects: [
    { id: "airship-meeting-table", kind: "table", roomId: "meeting-room", x: 25, z: -39, width: 4.5, depth: 2.8 },
    { id: "airship-main-hall-fountain", kind: "console", roomId: "main-hall", x: 0, z: 0, width: 3.6, depth: 3.6 },
    { id: "airship-record-stacks", kind: "archive", roomId: "records", x: 44, z: -5, width: 3.5, depth: 3 },
    { id: "airship-cargo-crates", kind: "cargo", roomId: "cargo-bay", x: 62, z: 38, width: 4, depth: 3.5 }
  ],
  corridorWidth: 5,
  theme: { worldScale: 54, corridorFill: 0x28313a, corridorStroke: 0xa2765e, frame: 0xe0ad87, artAlpha: 0 }
});

