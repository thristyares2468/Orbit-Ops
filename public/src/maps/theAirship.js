import { createMapDefinition, station, task } from "./mapFactory.js";

const AIRSHIP_ROUTES = [
  { id: "cockpit-communications", from: "cockpit", to: "communications" },
  { id: "communications-engine", from: "communications", to: "engine-room" },
  { id: "cockpit-vault", from: "cockpit", to: "vault", via: [{ x: -65, z: -5 }, { x: -65, z: -25 }] },
  { id: "vault-brig", from: "vault", to: "brig" },
  { id: "brig-gap", from: "brig", to: "gap-room" },
  { id: "gap-meeting", from: "gap-room", to: "meeting-room" },
  { id: "gap-records", from: "gap-room", to: "records" },
  { id: "records-lounge", from: "records", to: "lounge" },
  { id: "lounge-showers", from: "lounge", to: "showers" },
  { id: "showers-cargo", from: "showers", to: "cargo-bay" },
  { id: "records-main", from: "records", to: "main-hall", via: [{ x: 35, z: -7 }, { x: 7, z: -7 }] },
  { id: "gap-main", from: "gap-room", to: "main-hall" },
  { id: "engine-main", from: "engine-room", to: "main-hall" },
  { id: "engine-armory", from: "engine-room", to: "armory" },
  { id: "armory-kitchen", from: "armory", to: "kitchen" },
  { id: "kitchen-viewing", from: "kitchen", to: "viewing-deck", via: [{ x: -45, z: 36 }, { x: -45, z: 46 }] },
  { id: "armory-viewing", from: "armory", to: "viewing-deck", via: [{ x: -55, z: 18 }] },
  { id: "armory-security", from: "armory", to: "security", via: [{ x: -20, z: 18 }, { x: 5, z: 18 }] },
  { id: "medical-main", from: "medical", to: "main-hall" },
  { id: "medical-security", from: "medical", to: "security" },
  { id: "main-showers", from: "main-hall", to: "showers", via: [{ x: 35, z: 3 }, { x: 35, z: -5 }, { x: 75, z: -5 }] },
  { id: "security-electrical", from: "security", to: "electrical" },
  { id: "electrical-cargo", from: "electrical", to: "cargo-bay" }
];

export const THE_AIRSHIP = createMapDefinition({
  id: "the-airship",
  name: "The Airship",
  shortName: "Airship",
  description: "A sprawling multi-deck airship with a western flight wing, central Gap Room, eastern records wing, and a deep cargo route.",
  bounds: { minX: -90, maxX: 90, minZ: -57, maxZ: 57 },
  rooms: [
    { id: "cockpit", name: "Cockpit", x: -77, z: -5, width: 18, depth: 15, shape: "octagon", colour: 0x31516c, gridColour: 0x8bd2ff },
    { id: "communications", name: "Communications", x: -57, z: 1, width: 10, depth: 8, colour: 0x344657 },
    { id: "vault", name: "Vault", x: -49, z: -32, width: 24, depth: 20, shape: "ellipse", colour: 0x665737, gridColour: 0xffdc87 },
    { id: "brig", name: "Brig", x: -25, z: -22, width: 12, depth: 10, colour: 0x643b4c },
    { id: "meeting-room", name: "Meeting Room", x: 0, z: -46, width: 25, depth: 10, colour: 0x43566d },
    { id: "gap-room", name: "Gap Room", x: 0, z: -24, width: 31, depth: 16, shape: "octagon", colour: 0x4d4056 },
    { id: "records", name: "Records", x: 35, z: -22, width: 20, depth: 18, shape: "ellipse", colour: 0x466d76, gridColour: 0xa9e6df },
    { id: "lounge", name: "Lounge", x: 59, z: -12, width: 18, depth: 14, shape: "octagon", colour: 0x4a3f50 },
    { id: "showers", name: "Showers", x: 75, z: -5, width: 15, depth: 15, colour: 0x3e5360 },
    { id: "cargo-bay", name: "Cargo Bay", x: 73, z: 26, width: 23, depth: 22, shape: "octagon", colour: 0x4c493f },
    { id: "main-hall", name: "Main Hall", x: 7, z: 3, width: 28, depth: 16, shape: "octagon", colour: 0x5a4050 },
    { id: "engine-room", name: "Engine Room", x: -29, z: 3, width: 24, depth: 15, shape: "octagon", colour: 0x564137 },
    { id: "armory", name: "Armory", x: -50, z: 18, width: 18, depth: 13, colour: 0x51403d },
    { id: "kitchen", name: "Kitchen", x: -31, z: 36, width: 18, depth: 14, colour: 0x4b4d42 },
    { id: "viewing-deck", name: "Viewing Deck", x: -55, z: 46, width: 19, depth: 8, shape: "octagon", colour: 0x344d5b },
    { id: "security", name: "Security", x: 5, z: 28, width: 14, depth: 10, colour: 0x3b3a53 },
    { id: "electrical", name: "Electrical", x: 28, z: 35, width: 18, depth: 17, shape: "octagon", colour: 0x594438 },
    { id: "medical", name: "Medical", x: 2, z: 16, width: 13, depth: 10, colour: 0x31545b }
  ],
  connections: AIRSHIP_ROUTES.map(({ from, to }) => [from, to]),
  corridorRoutes: AIRSHIP_ROUTES,
  tasks: [
    task("airship-steer", "Steer Airship", "cockpit", -77, -5, "route"),
    task("airship-dress-mannequin", "Dress Mannequin", "vault", -49, -32, "classify"),
    task("airship-put-away-pistols", "Put Away Pistols", "armory", -50, 18, "sequence"),
    task("airship-make-burger", "Make Burger", "kitchen", -31, 36, "manifest"),
    task("airship-reset-breakers", "Reset Breakers", "electrical", 28, 35, "sequence"),
    task("airship-decontaminate", "Decontaminate", "main-hall", 7, 3, "scan"),
    task("airship-sort-records", "Sort Records", "records", 35, -22, "classify"),
    task("airship-polish-ruby", "Polish Ruby", "cargo-bay", 73, 26, "filter")
  ],
  sabotages: [
    { id: "airship-avert-crash", name: "Avert Crash Course", critical: true, durationMs: 55000, repairStations: ["airship-gap-left", "airship-gap-right"], roomId: "gap-room" },
    { id: "airship-comms-sabotage", name: "Communications Sabotage", critical: false, durationMs: 40000, repairStations: ["airship-comms-panel"], roomId: "communications" },
    { id: "airship-lights-out", name: "Lights Out", critical: false, durationMs: 40000, repairStations: ["airship-light-panel"], roomId: "electrical" },
    { id: "airship-door-lockdown", name: "Door Lockdown", critical: false, durationMs: 30000, repairStations: ["airship-security-override"], roomId: "security" }
  ],
  stations: [
    station("meeting-console", "meeting", "meeting-room", 0, -46),
    station("airship-cameras", "security", "security", 5, 28),
    station("airship-vent-a", "maintenance", "cockpit", -77, -5, "airship-vent-b"),
    station("airship-vent-b", "maintenance", "cargo-bay", 73, 26, "airship-vent-a"),
    station("airship-gap-left", "repair", "gap-room", -6, -24, "airship-avert-crash"),
    station("airship-gap-right", "repair", "gap-room", 6, -24, "airship-avert-crash"),
    station("airship-comms-panel", "repair", "communications", -57, 1, "airship-comms-sabotage"),
    station("airship-light-panel", "repair", "electrical", 28, 35, "airship-lights-out"),
    station("airship-security-override", "repair", "security", 5, 28, "airship-door-lockdown")
  ],
  spawnPoints: [
    [-10, -48], [-7, -48], [7, -48], [10, -48], [-10, -44], [-7, -44], [7, -44], [10, -44],
    [-10, -46], [-7, -46], [7, -46], [10, -46], [-5, -43], [0, -43], [5, -43], [5, -49]
  ],
  collisionRects: [
    { id: "airship-meeting-table", kind: "table", roomId: "meeting-room", x: 0, z: -46, width: 7.2, depth: 3.1 },
    { id: "airship-main-hall-console", kind: "console", roomId: "main-hall", x: 7, z: 3, width: 3.6, depth: 3.6 },
    { id: "airship-record-stacks", kind: "archive", roomId: "records", x: 38, z: -22, width: 4, depth: 3.4 },
    { id: "airship-record-stacks-west", kind: "archive", roomId: "records", x: 32, z: -22, width: 3.4, depth: 3 },
    { id: "airship-cargo-crates", kind: "cargo", roomId: "cargo-bay", x: 77, z: 29, width: 5, depth: 4 },
    { id: "airship-vault-ruby", kind: "scanner", roomId: "vault", x: -49, z: -32, width: 3.5, depth: 3.5 },
    { id: "airship-engine-bank", kind: "console", roomId: "engine-room", x: -32, z: 3, width: 5.5, depth: 3.2 },
    { id: "airship-kitchen-island", kind: "table", roomId: "kitchen", x: -31, z: 36, width: 5, depth: 2.8 }
  ],
  corridorWidth: 5,
  theme: {
    worldScale: 36,
    corridorFill: 0x4c3340,
    corridorStroke: 0xa2765e,
    frame: 0xe0ad87,
    artAlpha: 0
  }
});
