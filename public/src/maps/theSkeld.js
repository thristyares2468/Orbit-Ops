import { createMapDefinition, station, task } from "./mapFactory.js";
import { SKELD_WALK_GRID } from "./skeldWalkGrid.js";

// The supplied 1200x672 Skeld image is a measuring reference only. It is never
// preloaded or rendered. Room art, floor silhouettes, corridors, fixtures and
// interactions all use this shared ruler so visual and collision geometry stay
// on the same transform.
const REFERENCE = Object.freeze({ width: 1200, height: 672, pixelsPerUnit: 8.4, originX: 635, originY: 316 });

const worldX = (pixel) => (pixel - REFERENCE.originX) / REFERENCE.pixelsPerUnit;
const worldZ = (pixel) => (pixel - REFERENCE.originY) / REFERENCE.pixelsPerUnit;
const worldSize = (pixels) => pixels / REFERENCE.pixelsPerUnit;
const referencePoint = (x, y) => Object.freeze({ x: worldX(x), z: worldZ(y) });

function relativePolygon(points, centerX, centerY) {
  return points.map(([x, y]) => Object.freeze({
    x: worldSize(x - centerX),
    z: worldSize(y - centerY)
  }));
}

function roomFromReference({
  id,
  name,
  rect,
  artOutline,
  floorOutline,
  navigationAnchor,
  assetKey,
  ...extras
}) {
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
    shape: "polygon",
    walkablePolygon: relativePolygon(floorOutline, centerX, centerY),
    artClipPolygon: relativePolygon(artOutline, centerX, centerY),
    navigationAnchor: referencePoint(...navigationAnchor),
    referenceRect: Object.freeze({ left, top, right, bottom }),
    assetKey,
    assetOnly: true,
    floorAlpha: 0,
    worldLabel: false,
    artFit: "stretch",
    artAlpha: 1,
    artPadding: 0,
    ...extras
  };
}

function corridorFromReference(id, left, top, right, bottom) {
  return Object.freeze({
    id,
    axis: right - left >= bottom - top ? "x" : "z",
    x: worldX((left + right) / 2),
    z: worldZ((top + bottom) / 2),
    width: worldSize(right - left),
    depth: worldSize(bottom - top),
    referenceRect: Object.freeze({ left, top, right, bottom })
  });
}

function route(id, from, to, points = []) {
  return Object.freeze({
    id,
    from,
    to,
    via: points.map(([x, y]) => referencePoint(x, y))
  });
}

function taskAt(id, name, roomId, x, y, kind, steps = 4, assetKey = null, sites = null) {
  const point = referencePoint(x, y);
  return {
    ...task(id, name, roomId, point.x, point.z, kind, steps, assetKey, sites),
    referencePosition: Object.freeze({ x, y })
  };
}

// One leg of an assignment that spans rooms, in reference pixels.
function siteAt(roomId, x, y, label = null) {
  const point = referencePoint(x, y);
  return { roomId, x: point.x, z: point.z, ...(label ? { label } : {}) };
}

function stationAt(id, type, roomId, x, y, refId = null, label = null, range = null) {
  const point = referencePoint(x, y);
  return {
    ...station(id, type, roomId, point.x, point.z, refId, label, range),
    referencePosition: Object.freeze({ x, y })
  };
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
    referenceRect: Object.freeze({
      left: x - width / 2,
      top: y - depth / 2,
      right: x + width / 2,
      bottom: y + depth / 2
    }),
    prop: false,
    ...extras
  };
}

const ROOMS = [
  roomFromReference({
    id: "cafeteria", name: "Cafeteria", rect: [539, 2, 826, 294],
    artOutline: [[591, 2], [752, 2], [826, 64], [826, 224], [765, 294], [609, 294], [539, 224], [539, 64]],
    floorOutline: [
      [594, 27], [749, 27], [812, 69], [812, 115], [831, 115], [831, 162], [812, 162],
      [812, 219], [761, 278], [706, 278], [706, 306], [651, 306], [651, 278], [604, 278],
      [553, 222], [553, 163], [531, 163], [531, 114], [553, 114], [553, 69]
    ],
    navigationAnchor: [679, 260], colour: 0x5b6566
  }),
  roomFromReference({
    id: "upper-engine", name: "Upper Engine", rect: [203, 82, 327, 218],
    artOutline: [[225, 82], [327, 82], [327, 218], [242, 218], [203, 184], [203, 112]],
    floorOutline: [
      [226, 91], [317, 91], [317, 113], [337, 113], [337, 167], [317, 167], [317, 207],
      [284, 207], [284, 226], [241, 226], [241, 207], [212, 207], [212, 188], [195, 188],
      [195, 112], [212, 112], [212, 104]
    ],
    navigationAnchor: [238, 191], colour: 0x4a342a
  }),
  roomFromReference({
    id: "reactor", name: "Reactor", rect: [69, 190, 219, 392],
    artOutline: [[96, 190], [190, 190], [219, 218], [219, 365], [190, 392], [96, 392], [69, 364], [69, 218]],
    floorOutline: [
      [98, 199], [189, 199], [210, 220], [210, 250], [231, 250], [231, 332], [210, 332],
      [210, 362], [188, 383], [98, 383], [78, 362], [78, 220]
    ],
    navigationAnchor: [177, 291], colour: 0x512d35
  }),
  roomFromReference({
    id: "security", name: "Security", rect: [330, 219, 419, 362],
    artOutline: [[351, 219], [399, 219], [419, 239], [419, 362], [330, 362], [330, 239]],
    floorOutline: [[350, 228], [399, 228], [411, 241], [411, 351], [323, 351], [323, 278], [336, 278], [336, 242]],
    navigationAnchor: [355, 325], colour: 0x314c42
  }),
  roomFromReference({
    id: "medbay", name: "MedBay", rect: [419, 158, 572, 350],
    artOutline: [[450, 158], [541, 158], [572, 189], [572, 318], [541, 350], [449, 350], [419, 319], [419, 188]],
    floorOutline: [
      [446, 169], [546, 169], [546, 193], [558, 193], [558, 246], [570, 260], [570, 315],
      [538, 342], [453, 342], [427, 316], [427, 191], [446, 191]
    ],
    navigationAnchor: [481, 303], colour: 0x315b60
  }),
  roomFromReference({
    id: "lower-engine", name: "Lower Engine", rect: [203, 394, 327, 537],
    artOutline: [[242, 394], [327, 394], [327, 537], [225, 537], [203, 507], [203, 426]],
    floorOutline: [
      [242, 385], [284, 385], [284, 404], [317, 404], [317, 430], [338, 430], [338, 485],
      [317, 485], [317, 525], [226, 525], [212, 510], [212, 491], [195, 491], [195, 424],
      [212, 424], [212, 404], [242, 404]
    ],
    navigationAnchor: [238, 510], colour: 0x4a342a
  }),
  roomFromReference({
    id: "electrical", name: "Electrical", rect: [437, 347, 569, 513],
    artOutline: [[437, 347], [569, 347], [569, 393], [539, 433], [539, 477], [509, 513], [437, 513]],
    floorOutline: [
      [445, 355], [560, 355], [560, 389], [543, 421], [543, 476], [526, 504], [526, 526],
      [431, 526], [431, 485], [426, 485], [426, 433], [445, 433]
    ],
    navigationAnchor: [516, 471], colour: 0x594437
  }),
  roomFromReference({
    id: "storage", name: "Storage", rect: [559, 394, 727, 620],
    artOutline: [[587, 394], [727, 394], [727, 574], [702, 620], [620, 620], [559, 574], [559, 420]],
    floorOutline: [
      [586, 402], [646, 402], [646, 384], [708, 384], [708, 402], [719, 402], [719, 443],
      [737, 443], [737, 499], [719, 499], [719, 574], [698, 610], [622, 610], [566, 573],
      [566, 561], [548, 561], [548, 511], [566, 511], [566, 426]
    ],
    navigationAnchor: [591, 556], colour: 0x443c32
  }),
  roomFromReference({
    id: "communications", name: "Communications", rect: [724, 496, 872, 626],
    artOutline: [[748, 496], [848, 496], [872, 520], [872, 601], [848, 626], [748, 626], [724, 601], [724, 520]],
    floorOutline: [
      [748, 506], [784, 506], [784, 486], [828, 486], [828, 506], [848, 506], [862, 523],
      [862, 598], [846, 616], [750, 616], [734, 598], [734, 523]
    ],
    navigationAnchor: [762, 588], colour: 0x24485b
  }),
  roomFromReference({
    id: "admin", name: "Admin", rect: [744, 317, 878, 438],
    artOutline: [[763, 317], [859, 317], [878, 336], [878, 418], [859, 438], [763, 438], [744, 418], [744, 336]],
    floorOutline: [
      [729, 344], [764, 344], [764, 324], [857, 324], [869, 338], [869, 415], [856, 429],
      [763, 429], [751, 415], [751, 380], [729, 380]
    ],
    navigationAnchor: [847, 409], colour: 0x503040
  }),
  roomFromReference({
    id: "o2", name: "O2", rect: [800, 215, 921, 313],
    artOutline: [[820, 215], [900, 215], [921, 236], [921, 292], [900, 313], [820, 313], [800, 292], [800, 236]],
    floorOutline: [[819, 222], [899, 222], [914, 238], [928, 238], [928, 294], [913, 294], [898, 305], [819, 305], [807, 290], [807, 239]],
    navigationAnchor: [874, 263], colour: 0x355b51
  }),
  roomFromReference({
    id: "weapons", name: "Weapons", rect: [858, 60, 995, 199],
    artOutline: [[880, 60], [966, 60], [995, 89], [995, 170], [966, 199], [880, 199], [858, 177], [858, 82]],
    floorOutline: [
      [882, 68], [965, 68], [987, 90], [987, 169], [968, 191], [958, 191], [958, 210],
      [916, 210], [916, 191], [880, 191], [866, 174], [866, 167], [847, 167], [847, 113], [866, 113], [866, 83]
    ],
    navigationAnchor: [950, 176], colour: 0x655342
  }),
  roomFromReference({
    id: "navigation", name: "Navigation", rect: [1090, 224, 1200, 356],
    artOutline: [[1090, 224], [1147, 224], [1200, 253], [1200, 328], [1147, 356], [1090, 356]],
    floorOutline: [
      [1081, 232], [1145, 232], [1192, 257], [1192, 323], [1145, 348], [1081, 348],
      [1081, 315], [1068, 315], [1068, 257], [1081, 257]
    ],
    navigationAnchor: [1128, 291], colour: 0x253b65
  }),
  roomFromReference({
    id: "shields", name: "Shields", rect: [873, 418, 1010, 555],
    artOutline: [[895, 418], [982, 418], [1010, 446], [1010, 527], [982, 555], [895, 555], [873, 533], [873, 440]],
    floorOutline: [
      [914, 409], [986, 409], [986, 427], [1002, 447], [1002, 525], [979, 547], [895, 547],
      [882, 532], [882, 509], [863, 509], [863, 454], [882, 454], [882, 442], [895, 427], [914, 427]
    ],
    navigationAnchor: [912, 520], colour: 0x665744
  })
];

// These are the unique physical hallway pieces traced from the reference. They
// deliberately do not start at room centres, and overlapping joins are wide
// enough for the player collider to cross without opening false routes in walls.
const SKELD_CORRIDORS = [
  corridorFromReference("port-engine-spine", 210, 205, 342, 408),
  corridorFromReference("upper-engine-cafeteria-hall", 315, 110, 560, 171),
  corridorFromReference("medbay-neck", 432, 155, 550, 203),
  corridorFromReference("lower-engine-electrical-hall", 315, 427, 454, 491),
  corridorFromReference("lower-engine-storage-bypass", 315, 500, 568, 568),
  corridorFromReference("electrical-south-neck", 426, 478, 550, 532),
  corridorFromReference("cafeteria-storage-spine", 642, 275, 717, 416),
  corridorFromReference("admin-branch", 697, 305, 780, 390),
  corridorFromReference("storage-shields-hall", 710, 440, 893, 503),
  corridorFromReference("communications-neck", 779, 484, 829, 527),
  corridorFromReference("cafeteria-weapons-hall", 811, 107, 875, 173),
  corridorFromReference("weapons-south-neck", 911, 176, 981, 263),
  corridorFromReference("o2-navigation-junction", 908, 231, 1007, 318),
  corridorFromReference("navigation-hall", 978, 245, 1103, 316),
  corridorFromReference("starboard-spine", 919, 291, 987, 455),
  corridorFromReference("shields-north-neck", 909, 406, 992, 458)
];

// Connections describe room adjacency for logs and map semantics only. Bot and
// player movement is resolved against the traced floors above.
const SKELD_ROUTES = [
  route("upper-engine-reactor", "upper-engine", "reactor", [[275, 216], [275, 289], [218, 289]]),
  route("reactor-security", "reactor", "security", [[275, 289]]),
  route("reactor-lower-engine", "reactor", "lower-engine", [[275, 289], [275, 397]]),
  route("upper-engine-cafeteria", "upper-engine", "cafeteria", [[335, 140], [542, 140]]),
  route("upper-engine-medbay", "upper-engine", "medbay", [[385, 140], [490, 140], [490, 178]]),
  route("medbay-cafeteria", "medbay", "cafeteria", [[490, 178], [542, 140]]),
  route("lower-engine-electrical", "lower-engine", "electrical", [[337, 460], [441, 460]]),
  route("lower-engine-storage", "lower-engine", "storage", [[337, 534], [558, 534]]),
  route("electrical-storage", "electrical", "storage", [[490, 516], [558, 534]]),
  route("cafeteria-storage", "cafeteria", "storage", [[680, 300], [680, 395]]),
  route("cafeteria-admin", "cafeteria", "admin", [[680, 330], [752, 330]]),
  route("admin-storage", "admin", "storage", [[718, 330], [680, 395]]),
  route("cafeteria-weapons", "cafeteria", "weapons", [[828, 140], [864, 140]]),
  route("weapons-o2", "weapons", "o2", [[946, 204], [946, 268], [915, 268]]),
  route("weapons-navigation", "weapons", "navigation", [[946, 268], [1082, 286]]),
  route("o2-navigation", "o2", "navigation", [[928, 268], [1082, 286]]),
  route("navigation-shields", "navigation", "shields", [[953, 286], [953, 430]]),
  route("storage-shields", "storage", "shields", [[730, 470], [881, 470]]),
  route("storage-communications", "storage", "communications", [[805, 470], [805, 510]]),
  route("shields-communications", "shields", "communications", [[881, 470], [805, 510]])
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
  description: "A measured single-deck reconstruction of The Skeld using the supplied room artwork.",
  // Baked from the supplied 3D model (among_us_-_map_the_skeld.glb) with an
  // orthographic camera tilted 24 degrees, so the deck reads top-down while each
  // room's far wall stays visible. groundBox is where the model's y=0 plane lands in
  // the image; it is pinned to worldBox so world coordinates sit on the art exactly.
  walkGrid: SKELD_WALK_GRID,
  deck: {
    assetKey: "skeld-deck",
    image: { width: 4096, height: 2435 },
    groundBox: { x0: 40.157, y0: 123.93, x1: 4055.843, y1: 2275.531 },
    worldBox: { x0: -71.053, z0: -40.971, x1: 70.934, z1: 40.495 },
    tiltDegrees: 24
  },
  bounds: { minX: -76, maxX: 68, minZ: -38, maxZ: 43 },
  zones: [{
    id: "skeld-outer-hull",
    x: worldX(hullCenterX),
    z: worldZ(hullCenterY),
    width: worldSize(REFERENCE.width),
    depth: worldSize(REFERENCE.height),
    walkablePolygon: relativePolygon(OUTER_HULL, hullCenterX, hullCenterY),
    colour: 0x354247,
    alpha: 1,
    stroke: 0x10191e,
    strokeAlpha: 1,
    minimap: false,
    walkable: false
  }],
  rooms: ROOMS,
  corridors: SKELD_CORRIDORS,
  connections: SKELD_ROUTES.map(({ from, to }) => [from, to]),
  corridorRoutes: SKELD_ROUTES,
  // The Skeld's assignments, each running the minigame the real task runs. Tasks
  // that genuinely span the ship list every leg in `sites` and are worked in order.
  tasks: [
    // --- common, multi-room ---
    taskAt("skeld-fix-wiring", "Fix Wiring", "electrical", 492, 439, "wiring", 1, "taskWiring", [
      siteAt("electrical", 492, 439),
      siteAt("admin", 800, 350),
      siteAt("navigation", 1100, 300)
    ]),
    taskAt("skeld-swipe-card", "Swipe Card", "admin", 790, 420, "card", 1, "taskCard"),
    taskAt("skeld-upload-data", "Download Data", "communications", 827, 580, "upload", 1, "taskUpload", [
      siteAt("communications", 827, 580, "Communications (download)"),
      siteAt("admin", 771, 342, "Admin (upload)")
    ]),
    taskAt("skeld-empty-garbage", "Empty Garbage", "cafeteria", 706, 262, "garbage", 1, "taskGarbage", [
      siteAt("cafeteria", 706, 262),
      siteAt("storage", 698, 589)
    ]),
    taskAt("skeld-fuel-engines", "Fuel Engines", "storage", 600, 500, "fuel", 1, "taskFuel", [
      siteAt("storage", 600, 500, "Storage (fill can)"),
      siteAt("upper-engine", 233, 198, "Upper Engine (pump)"),
      siteAt("storage", 600, 500, "Storage (refill)"),
      siteAt("lower-engine", 286, 507, "Lower Engine (pump)")
    ]),
    taskAt("skeld-divert-power", "Divert Power", "electrical", 543, 386, "power", 1, "taskDivertPower", [
      siteAt("electrical", 543, 386, "Electrical (divert)"),
      siteAt("weapons", 948, 201, "Weapons (accept)")
    ]),
    // --- reactor and engineering ---
    taskAt("skeld-start-reactor", "Start Reactor", "reactor", 120, 300, "reactor", 5, "taskReactor"),
    taskAt("skeld-unlock-manifolds", "Unlock Manifolds", "reactor", 195, 291, "manifolds", 1, "taskManifolds"),
    taskAt("skeld-align-engine", "Align Engine Output", "upper-engine", 233, 198, "align", 1, "taskEngineAlign"),
    // --- upper deck ---
    taskAt("skeld-clear-asteroids", "Clear Asteroids", "weapons", 948, 201, "asteroids", 1, "taskAsteroids"),
    taskAt("skeld-prime-shields", "Prime Shields", "shields", 940, 480, "shields", 1, "taskShields"),
    taskAt("skeld-chart-course", "Chart Course", "navigation", 1127, 286, "course", 1, "taskCourse"),
    taskAt("skeld-stabilize-steering", "Stabilize Steering", "navigation", 1150, 330, "steering", 1, "taskNavigation"),
    // --- maintenance and medical ---
    taskAt("skeld-submit-scan", "Submit Scan", "medbay", 470, 300, "scan", 1, "taskScan"),
    taskAt("skeld-inspect-sample", "Inspect Sample", "medbay", 520, 200, "sample", 1, "taskSample"),
    taskAt("skeld-clean-o2", "Clean O2 Filter", "o2", 860, 262, "o2filter", 1, "taskO2"),
    taskAt("skeld-calibrate-distributor", "Calibrate Distributor", "electrical", 454, 395, "calibrate", 3, "taskCalibrate")
  ],
  sabotages: [
    { id: "skeld-reactor-meltdown", name: "Reactor Meltdown", critical: true, durationMs: 20000, repairStations: ["skeld-reactor-alpha", "skeld-reactor-beta"], roomId: "reactor" },
    { id: "skeld-o2-depletion", name: "O2 Depletion", critical: true, durationMs: 50000, repairStations: ["skeld-o2-panel", "skeld-admin-o2"], roomId: "o2" },
    { id: "skeld-comms-sabotage", name: "Communications Sabotage", critical: false, durationMs: 40000, repairStations: ["skeld-comms-panel"], roomId: "communications" },
    { id: "skeld-lights-out", name: "Lights Out", critical: false, durationMs: 40000, repairStations: ["skeld-light-panel"], roomId: "electrical" }
  ],
  stations: [
    // Dead centre of the round cafeteria table, where the model paints the button.
    // The table is solid, so the reach is widened to 5.0: measured against the walk
    // grid that is what covers the ring of floor all the way round it.
    stationAt("meeting-console", "meeting", "cafeteria", 668, 134, null, null, 5),
    stationAt("skeld-cameras", "security", "security", 371, 269),
    stationAt("skeld-admin-table", "admin", "admin", 771, 342),
    // Vent positions are the vents the model itself paints on the deck, not hand
    // placed. The model has no vent geometry to read - every mesh is named
    // Object_N and the vents are baked into the floor textures - so they were
    // found in the rendered deck instead: one grille graphic, 14 instances across
    // the whole ship, exactly one in each room the Skeld puts a vent in. Every one
    // of them lands on walkable floor, which is what confirms they are floor vents
    // rather than wall panels.
    stationAt("skeld-vent-cafeteria", "maintenance", "cafeteria", 796, 175, "vent-cafeteria-admin"),
    stationAt("skeld-vent-admin", "maintenance", "admin", 755, 427, "vent-cafeteria-admin"),
    stationAt("skeld-vent-medbay", "maintenance", "medbay", 411, 282, "vent-electrical-security-medbay"),
    stationAt("skeld-vent-electrical", "maintenance", "electrical", 436, 369, "vent-electrical-security-medbay"),
    stationAt("skeld-vent-hallway", "maintenance", "shields", 938, 319, "vent-cafeteria-admin", "Hallway"),
    stationAt("skeld-vent-security", "maintenance", "security", 363, 338, "vent-electrical-security-medbay"),
    stationAt("skeld-vent-reactor-upper", "maintenance", "reactor", 114, 266, "vent-upper-engine"),
    stationAt("skeld-vent-upper-engine", "maintenance", "upper-engine", 291, 90, "vent-upper-engine"),
    stationAt("skeld-vent-reactor-lower", "maintenance", "reactor", 148, 350, "vent-lower-engine"),
    stationAt("skeld-vent-lower-engine", "maintenance", "lower-engine", 290, 523, "vent-lower-engine"),
    stationAt("skeld-vent-weapons", "maintenance", "weapons", 919, 72, "vent-weapons-navigation"),
    stationAt("skeld-vent-navigation-a", "maintenance", "navigation", 1115, 240, "vent-weapons-navigation"),
    stationAt("skeld-vent-navigation-b", "maintenance", "navigation", 1115, 335, "vent-navigation-shields"),
    stationAt("skeld-vent-shields", "maintenance", "shields", 938, 541, "vent-navigation-shields"),
    stationAt("skeld-reactor-alpha", "repair", "reactor", 116, 281, "skeld-reactor-meltdown"),
    stationAt("skeld-reactor-beta", "repair", "reactor", 195, 291, "skeld-reactor-meltdown"),
    stationAt("skeld-o2-panel", "repair", "o2", 907, 233, "skeld-o2-depletion"),
    stationAt("skeld-admin-o2", "repair", "admin", 857, 336, "skeld-o2-depletion"),
    stationAt("skeld-comms-panel", "repair", "communications", 757, 542, "skeld-comms-sabotage"),
    stationAt("skeld-light-panel", "repair", "electrical", 543, 386, "skeld-lights-out")
  ],
  spawnPoints: [
    [worldX(677), worldZ(104)], [worldX(633), worldZ(151)], [worldX(713), worldZ(151)], [worldX(677), worldZ(187)],
    [worldX(605), worldZ(151)], [worldX(749), worldZ(151)], [worldX(641), worldZ(187)], [worldX(704), worldZ(181)],
    [worldX(580), worldZ(151)], [worldX(774), worldZ(151)], [worldX(641), worldZ(260)], [worldX(713), worldZ(260)],
    [worldX(677), worldZ(260)], [worldX(641), worldZ(54)], [worldX(707), worldZ(48)], [worldX(677), worldZ(276)]
  ],
  // No authored collision rectangles: the walk grid is derived from the model with a
  // threshold just above the floor, so every solid object already blocks. The old
  // hand-traced rectangles were placed against superseded geometry and sat across
  // doorways, which is what made Reactor, both Engines and Electrical unreachable.
  collisionRects: [],
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
