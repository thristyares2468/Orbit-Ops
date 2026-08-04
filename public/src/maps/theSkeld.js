import { createMapDefinition, station, task } from "./mapFactory.js";

// Every transform in this file is authored in the 1200x672 coordinate space of
// the supplied Skeld reference. The reference is never loaded by the game; it is
// only a common ruler for artwork, floors, props, interactions, and collision.
const REFERENCE = Object.freeze({ width: 1200, height: 672, pixelsPerUnit: 8.4, originX: 635, originY: 316 });

const worldX = (pixel) => (pixel - REFERENCE.originX) / REFERENCE.pixelsPerUnit;
const worldZ = (pixel) => (pixel - REFERENCE.originY) / REFERENCE.pixelsPerUnit;
const worldSize = (pixels) => pixels / REFERENCE.pixelsPerUnit;
const referencePoint = (x, y) => Object.freeze({ x: worldX(x), z: worldZ(y) });

function roomFromReference({ id, name, rect, outline, assetKey, ...extras }) {
  const [left, top, right, bottom] = rect;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  return {
    id,
    name,
    x: worldX(centerX),
    z: worldZ(centerY),
    width: worldSize(right - left),
    depth: worldSize(bottom - top),
    shape: "octagon",
    walkablePolygon: outline.map(([x, y]) => ({
      x: worldSize(x - centerX),
      z: worldSize(y - centerY)
    })),
    referenceRect: Object.freeze({ left, top, right, bottom }),
    assetKey,
    assetOnly: true,
    worldLabel: false,
    artFit: "stretch",
    artAlpha: 1,
    artPadding: 0,
    ...extras
  };
}

function route(id, from, to, widthPixels, points = []) {
  return { id, from, to, width: worldSize(widthPixels), via: points.map(([x, y]) => referencePoint(x, y)) };
}

function taskAt(id, name, roomId, x, y, kind, steps = 4) {
  const point = referencePoint(x, y);
  return task(id, name, roomId, point.x, point.z, kind, steps);
}

function stationAt(id, type, roomId, x, y, refId = null) {
  const point = referencePoint(x, y);
  return station(id, type, roomId, point.x, point.z, refId);
}

function collisionAt(id, kind, roomId, x, y, width, depth, extras = {}) {
  const point = referencePoint(x, y);
  return {
    id,
    kind,
    roomId,
    x: point.x,
    z: point.z,
    width: worldSize(width),
    depth: worldSize(depth),
    prop: false,
    ...extras
  };
}

const ROOMS = [
  roomFromReference({
    id: "cafeteria", name: "Cafeteria", rect: [539, 2, 826, 294],
    outline: [[591, 2], [752, 2], [826, 64], [826, 224], [765, 294], [609, 294], [539, 224], [539, 64]],
    assetKey: "skeld-cafeteria", colour: 0x5b6566
  }),
  roomFromReference({
    id: "upper-engine", name: "Upper Engine", rect: [203, 82, 327, 218],
    outline: [[225, 82], [327, 82], [327, 218], [242, 218], [203, 184], [203, 112]],
    assetKey: "skeld-upper-engine", colour: 0x4a342a
  }),
  roomFromReference({
    id: "reactor", name: "Reactor", rect: [69, 190, 219, 392],
    outline: [[96, 190], [190, 190], [219, 218], [219, 365], [190, 392], [96, 392], [69, 364], [69, 218]],
    assetKey: "skeld-reactor", colour: 0x512d35
  }),
  roomFromReference({
    id: "security", name: "Security", rect: [330, 219, 419, 362],
    outline: [[351, 219], [399, 219], [419, 239], [419, 362], [330, 362], [330, 239]],
    assetKey: "skeld-security", colour: 0x314c42
  }),
  roomFromReference({
    id: "medbay", name: "MedBay", rect: [419, 158, 572, 350],
    outline: [[450, 158], [541, 158], [572, 189], [572, 318], [541, 350], [449, 350], [419, 319], [419, 188]],
    assetKey: "skeld-medbay", artCrop: { x: 0, y: 0, width: 520, height: 520 }, colour: 0x315b60
  }),
  roomFromReference({
    id: "lower-engine", name: "Lower Engine", rect: [203, 394, 327, 537],
    outline: [[242, 394], [327, 394], [327, 537], [225, 537], [203, 507], [203, 426]],
    assetKey: "skeld-lower-engine", colour: 0x4a342a
  }),
  roomFromReference({
    id: "electrical", name: "Electrical", rect: [437, 347, 569, 513],
    outline: [[437, 347], [569, 347], [569, 393], [539, 433], [539, 477], [509, 513], [437, 513]],
    assetKey: "skeld-electrical", colour: 0x594437
  }),
  roomFromReference({
    id: "storage", name: "Storage", rect: [559, 394, 727, 620],
    outline: [[587, 394], [727, 394], [727, 574], [702, 620], [620, 620], [559, 574], [559, 420]],
    assetKey: "skeld-storage", colour: 0x443c32
  }),
  roomFromReference({
    id: "communications", name: "Communications", rect: [724, 496, 872, 626],
    outline: [[748, 496], [848, 496], [872, 520], [872, 601], [848, 626], [748, 626], [724, 601], [724, 520]],
    assetKey: "skeld-communications", colour: 0x24485b
  }),
  roomFromReference({
    id: "admin", name: "Admin", rect: [744, 317, 878, 438],
    outline: [[763, 317], [859, 317], [878, 336], [878, 418], [859, 438], [763, 438], [744, 418], [744, 336]],
    assetKey: "skeld-admin", colour: 0x503040
  }),
  roomFromReference({
    id: "o2", name: "O2", rect: [800, 215, 921, 313],
    outline: [[820, 215], [900, 215], [921, 236], [921, 292], [900, 313], [820, 313], [800, 292], [800, 236]],
    assetKey: "skeld-o2", colour: 0x355b51
  }),
  roomFromReference({
    id: "weapons", name: "Weapons", rect: [858, 60, 995, 199],
    outline: [[880, 60], [966, 60], [995, 89], [995, 170], [966, 199], [880, 199], [858, 177], [858, 82]],
    assetKey: "skeld-weapons", colour: 0x655342
  }),
  roomFromReference({
    id: "navigation", name: "Navigation", rect: [1090, 224, 1200, 356],
    outline: [[1090, 224], [1147, 224], [1200, 253], [1200, 328], [1147, 356], [1090, 356]],
    assetKey: "skeld-navigation", artCrop: { x: 0, y: 0, width: 344, height: 420 }, colour: 0x253b65
  }),
  roomFromReference({
    id: "shields", name: "Shields", rect: [873, 418, 1010, 555],
    outline: [[895, 418], [982, 418], [1010, 446], [1010, 527], [982, 555], [895, 555], [873, 533], [873, 440]],
    assetKey: "skeld-shields", colour: 0x665744
  })
];

// Routes follow the actual orthogonal deck joins visible between the room crops.
// Shared junctions intentionally reuse the same pixels so corridors do not drift.
const SKELD_ROUTES = [
  route("upper-engine-reactor", "upper-engine", "reactor", 30, [[277, 150], [277, 290]]),
  route("reactor-security", "reactor", "security", 30, [[277, 290]]),
  route("reactor-lower-engine", "reactor", "lower-engine", 30, [[277, 290], [277, 465]]),
  route("upper-engine-cafeteria", "upper-engine", "cafeteria", 32, [[480, 150], [480, 136]]),
  route("upper-engine-medbay", "upper-engine", "medbay", 32, [[480, 150], [480, 254]]),
  route("medbay-cafeteria", "medbay", "cafeteria", 32, [[480, 136]]),
  route("lower-engine-electrical", "lower-engine", "electrical", 30, [[365, 465], [365, 486], [503, 486]]),
  route("lower-engine-storage", "lower-engine", "storage", 30, [[365, 465], [365, 548], [643, 548]]),
  route("electrical-storage", "electrical", "storage", 30, [[545, 486], [643, 486]]),
  route("cafeteria-storage", "cafeteria", "storage", 32, [[680, 340], [643, 340]]),
  route("cafeteria-admin", "cafeteria", "admin", 30, [[680, 340], [811, 340]]),
  route("admin-storage", "admin", "storage", 30, [[680, 378], [680, 430], [643, 430]]),
  route("cafeteria-weapons", "cafeteria", "weapons", 32, [[925, 130]]),
  route("weapons-o2", "weapons", "o2", 30, [[925, 264], [860, 264]]),
  route("weapons-navigation", "weapons", "navigation", 30, [[948, 130], [948, 270], [1145, 270]]),
  route("o2-navigation", "o2", "navigation", 30, [[948, 264], [1145, 264]]),
  route("navigation-shields", "navigation", "shields", 30, [[948, 290], [948, 486]]),
  route("storage-shields", "storage", "shields", 32, [[940, 463]]),
  route("storage-communications", "storage", "communications", 30, [[727, 535], [798, 535]]),
  route("shields-communications", "shields", "communications", 30, [[873, 518], [798, 518]])
];

const OUTER_HULL = [[365, 0], [752, 0], [802, 27], [940, 60], [1015, 104], [1035, 164], [1090, 224],
  [1200, 248], [1200, 338], [1090, 356], [1038, 414], [1010, 557], [927, 620], [845, 650],
  [741, 672], [480, 672], [358, 636], [207, 589], [171, 551], [121, 534], [92, 457], [78, 418],
  [40, 384], [0, 320], [48, 211], [86, 164], [119, 112], [204, 80], [265, 35]];

const hullCenterX = REFERENCE.width / 2;
const hullCenterY = REFERENCE.height / 2;

export const THE_SKELD = createMapDefinition({
  id: "the-skeld",
  name: "The Skeld",
  shortName: "Skeld",
  description: "A faithful single-deck reconstruction of The Skeld, built from the supplied room artwork and reference geometry.",
  bounds: { minX: -76, maxX: 68, minZ: -38, maxZ: 43 },
  zones: [{
    id: "skeld-outer-hull",
    x: worldX(hullCenterX),
    z: worldZ(hullCenterY),
    width: worldSize(REFERENCE.width),
    depth: worldSize(REFERENCE.height),
    walkablePolygon: OUTER_HULL.map(([x, y]) => ({ x: worldSize(x - hullCenterX), z: worldSize(y - hullCenterY) })),
    colour: 0x354247,
    alpha: 1,
    stroke: 0x10191e,
    strokeAlpha: 1,
    minimap: false,
    walkable: false
  }],
  rooms: ROOMS,
  connections: SKELD_ROUTES.map(({ from, to }) => [from, to]),
  corridorRoutes: SKELD_ROUTES,
  tasks: [
    taskAt("skeld-swipe-card", "Swipe Card", "admin", 770, 350, "sequence"),
    taskAt("skeld-align-engine", "Align Engine Output", "upper-engine", 218, 151, "balance"),
    taskAt("skeld-calibrate-distributor", "Calibrate Distributor", "electrical", 462, 395, "sequence"),
    taskAt("skeld-submit-scan", "Submit Scan", "medbay", 512, 307, "scan"),
    taskAt("skeld-stabilize-steering", "Stabilize Steering", "navigation", 1162, 290, "route"),
    taskAt("skeld-clean-o2-filter", "Clean O2 Filter", "o2", 888, 235, "filter"),
    taskAt("skeld-empty-garbage", "Empty Garbage", "storage", 704, 597, "classify"),
    taskAt("skeld-prime-shields", "Prime Shields", "shields", 981, 521, "sync")
  ],
  sabotages: [
    { id: "skeld-reactor-meltdown", name: "Reactor Meltdown", critical: true, durationMs: 45000, repairStations: ["skeld-reactor-alpha", "skeld-reactor-beta"], roomId: "reactor" },
    { id: "skeld-o2-depletion", name: "O2 Depletion", critical: true, durationMs: 50000, repairStations: ["skeld-o2-panel", "skeld-admin-o2"], roomId: "o2" },
    { id: "skeld-comms-sabotage", name: "Communications Sabotage", critical: false, durationMs: 40000, repairStations: ["skeld-comms-panel"], roomId: "communications" },
    { id: "skeld-lights-out", name: "Lights Out", critical: false, durationMs: 40000, repairStations: ["skeld-light-panel"], roomId: "electrical" }
  ],
  stations: [
    stationAt("meeting-console", "meeting", "cafeteria", 677, 151),
    stationAt("skeld-cameras", "security", "security", 371, 243),
    stationAt("skeld-vent-cafeteria", "maintenance", "cafeteria", 807, 183, "skeld-vent-admin"),
    stationAt("skeld-vent-admin", "maintenance", "admin", 762, 418, "skeld-vent-cafeteria"),
    stationAt("skeld-vent-medbay", "maintenance", "medbay", 431, 319, "skeld-vent-electrical-a"),
    stationAt("skeld-vent-electrical-a", "maintenance", "electrical", 455, 486, "skeld-vent-medbay"),
    stationAt("skeld-vent-electrical-b", "maintenance", "electrical", 548, 365, "skeld-vent-security"),
    stationAt("skeld-vent-security", "maintenance", "security", 400, 342, "skeld-vent-electrical-b"),
    stationAt("skeld-vent-reactor-upper", "maintenance", "reactor", 190, 218, "skeld-vent-upper-engine"),
    stationAt("skeld-vent-upper-engine", "maintenance", "upper-engine", 221, 195, "skeld-vent-reactor-upper"),
    stationAt("skeld-vent-reactor-lower", "maintenance", "reactor", 190, 364, "skeld-vent-lower-engine"),
    stationAt("skeld-vent-lower-engine", "maintenance", "lower-engine", 221, 424, "skeld-vent-reactor-lower"),
    stationAt("skeld-vent-weapons", "maintenance", "weapons", 977, 178, "skeld-vent-navigation-a"),
    stationAt("skeld-vent-navigation-a", "maintenance", "navigation", 1104, 246, "skeld-vent-weapons"),
    stationAt("skeld-vent-navigation-b", "maintenance", "navigation", 1104, 332, "skeld-vent-shields"),
    stationAt("skeld-vent-shields", "maintenance", "shields", 941, 538, "skeld-vent-navigation-b"),
    stationAt("skeld-reactor-alpha", "repair", "reactor", 95, 251, "skeld-reactor-meltdown"),
    stationAt("skeld-reactor-beta", "repair", "reactor", 95, 331, "skeld-reactor-meltdown"),
    stationAt("skeld-o2-panel", "repair", "o2", 860, 225, "skeld-o2-depletion"),
    stationAt("skeld-admin-o2", "repair", "admin", 858, 337, "skeld-o2-depletion"),
    stationAt("skeld-comms-panel", "repair", "communications", 850, 554, "skeld-comms-sabotage"),
    stationAt("skeld-light-panel", "repair", "electrical", 554, 383, "skeld-lights-out")
  ],
  spawnPoints: [
    [worldX(677), worldZ(116)], [worldX(641), worldZ(151)], [worldX(713), worldZ(151)], [worldX(677), worldZ(187)],
    [worldX(605), worldZ(151)], [worldX(749), worldZ(151)], [worldX(641), worldZ(187)], [worldX(713), worldZ(187)],
    [worldX(580), worldZ(151)], [worldX(774), worldZ(151)], [worldX(641), worldZ(260)], [worldX(713), worldZ(260)],
    [worldX(677), worldZ(260)], [worldX(641), worldZ(54)], [worldX(713), worldZ(54)], [worldX(677), worldZ(284)]
  ],
  collisionRects: [
    collisionAt("skeld-cafeteria-table-nw", "table", "cafeteria", 614, 89, 63, 49, { shape: "ellipse" }),
    collisionAt("skeld-cafeteria-table-ne", "table", "cafeteria", 744, 89, 63, 49, { shape: "ellipse" }),
    // The emergency table's visual rim is wider than its solid centre. Keeping
    // this inset lets a player stand at the rim and reach the button.
    collisionAt("skeld-emergency-table", "table", "cafeteria", 677, 151, 44, 34, { shape: "ellipse" }),
    collisionAt("skeld-cafeteria-table-sw", "table", "cafeteria", 612, 222, 63, 49, { shape: "ellipse" }),
    collisionAt("skeld-cafeteria-table-se", "table", "cafeteria", 738, 222, 63, 49, { shape: "ellipse" }),
    collisionAt("skeld-upper-engine-core", "engine", "upper-engine", 276, 150, 70, 78, { shape: "ellipse" }),
    collisionAt("skeld-upper-engine-console", "console", "upper-engine", 219, 151, 23, 38),
    collisionAt("skeld-lower-engine-core", "engine", "lower-engine", 276, 465, 70, 78, { shape: "ellipse" }),
    collisionAt("skeld-lower-engine-console", "console", "lower-engine", 219, 465, 23, 38),
    collisionAt("skeld-reactor-core", "reactor", "reactor", 144, 290, 55, 116, { shape: "ellipse" }),
    collisionAt("skeld-reactor-panel-north", "console", "reactor", 101, 214, 42, 25),
    collisionAt("skeld-reactor-panel-south", "console", "reactor", 101, 366, 42, 25),
    collisionAt("skeld-security-console", "console", "security", 371, 244, 60, 25),
    collisionAt("skeld-security-desk", "console", "security", 394, 315, 29, 54),
    collisionAt("skeld-med-bed-west-north", "bed", "medbay", 455, 198, 25, 47),
    collisionAt("skeld-med-bed-east-north", "bed", "medbay", 523, 198, 25, 47),
    collisionAt("skeld-med-bed-west-south", "bed", "medbay", 455, 265, 25, 47),
    collisionAt("skeld-med-bed-east-south", "bed", "medbay", 523, 265, 25, 47),
    collisionAt("skeld-med-scanner", "scanner", "medbay", 512, 307, 39, 34, { shape: "ellipse" }),
    collisionAt("skeld-electrical-cabinets", "console", "electrical", 502, 365, 105, 27),
    collisionAt("skeld-electrical-panel", "console", "electrical", 458, 421, 28, 57),
    collisionAt("skeld-storage-crates-main", "cargo", "storage", 649, 489, 70, 68, { prop: true }),
    collisionAt("skeld-storage-crate-west", "cargo", "storage", 610, 470, 28, 28, { prop: true }),
    collisionAt("skeld-storage-crate-east", "cargo", "storage", 687, 522, 31, 31, { prop: true }),
    collisionAt("skeld-admin-table", "table", "admin", 811, 385, 72, 48, { shape: "ellipse" }),
    collisionAt("skeld-admin-console-bank", "console", "admin", 811, 335, 94, 21),
    collisionAt("skeld-o2-canisters", "console", "o2", 850, 285, 68, 25),
    collisionAt("skeld-o2-filter-bank", "console", "o2", 888, 231, 29, 24),
    collisionAt("skeld-weapons-platform", "console", "weapons", 925, 130, 68, 61, { shape: "ellipse" }),
    collisionAt("skeld-navigation-console", "console", "navigation", 1170, 290, 39, 80),
    collisionAt("skeld-navigation-north-console", "console", "navigation", 1139, 241, 43, 21),
    collisionAt("skeld-shields-platform", "console", "shields", 941, 486, 63, 63, { shape: "ellipse" }),
    collisionAt("skeld-shields-south-console", "console", "shields", 981, 521, 27, 22),
    collisionAt("skeld-comms-desk", "console", "communications", 799, 571, 74, 31),
    collisionAt("skeld-comms-equipment", "console", "communications", 744, 533, 25, 40)
  ],
  theme: {
    worldScale: 40,
    corridorFill: 0x526d76,
    corridorStroke: 0x10191e,
    corridorAccent: 0xb9f6ff,
    corridorAccentAlpha: 0.24,
    corridorRadius: 4,
    zoneFill: 0x354247,
    zoneStroke: 0x10191e,
    frame: 0x9fc9cf,
    artAlpha: 1
  }
});
