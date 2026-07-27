import { createMapDefinition, station } from "./mapFactory.js";

// The supplied Lobby atlas was separated into lossless sprites. All placement
// remains in that 1225x993 source-pixel coordinate system, then converts to world
// units here. This keeps the seats, hatch, floor, props, engines, collisions, and
// interaction art on one scale instead of eyeballing each piece independently.
const SOURCE = Object.freeze({
  width: 1225,
  height: 993,
  deck: Object.freeze({ left: 357, right: 868, top: 310, bottom: 930 })
});
// Thirty-four world units keeps the lobby larger than the player view while
// preserving the reference proportions; the former 42-unit hull made seats and
// cargo read as oversized beside the supplied player model.
const SHIP_SCALE = 34 / SOURCE.width;
const DECK_CENTER_X = (SOURCE.deck.left + SOURCE.deck.right) / 2;
const DECK_CENTER_Z = (SOURCE.deck.top + SOURCE.deck.bottom) / 2;

const sourceX = (pixel) => (pixel - DECK_CENTER_X) * SHIP_SCALE;
const sourceZ = (pixel) => (pixel - DECK_CENTER_Z) * SHIP_SCALE;
const sourceSize = (pixels) => pixels * SHIP_SCALE;
const spawn = (sourceCenterX, sourceCenterZ) => Object.freeze([
  sourceX(sourceCenterX),
  sourceZ(sourceCenterZ)
]);

function collision(id, sourceCenterX, sourceCenterZ, sourceWidth, sourceDepth) {
  return {
    id,
    kind: "cargo",
    prop: false,
    roomId: "dropship-hold",
    x: sourceX(sourceCenterX),
    z: sourceZ(sourceCenterZ),
    width: sourceSize(sourceWidth),
    depth: sourceSize(sourceDepth)
  };
}

function decal(id, assetKey, sourceCenterX, sourceCenterZ, sourceWidth, sourceDepth, extras = {}) {
  return {
    id,
    assetKey,
    x: sourceX(sourceCenterX),
    z: sourceZ(sourceCenterZ),
    width: sourceSize(sourceWidth),
    depth: sourceSize(sourceDepth),
    ...extras
  };
}

export const LOBBY_DROPSHIP = createMapDefinition({
  id: "lobby-dropship",
  name: "Dropship",
  shortName: "Dropship",
  description: "The Meridian's boarding dropship, where the crew gathers before a launch.",
  bounds: { minX: -18.5, maxX: 18.5, minZ: -18, maxZ: 16 },
  rooms: [
    {
      id: "dropship-hold",
      name: "Dropship",
      x: 0,
      z: 0,
      width: sourceSize(SOURCE.deck.right - SOURCE.deck.left),
      depth: sourceSize(SOURCE.deck.bottom - SOURCE.deck.top),
      label: false,
      chrome: false,
      floorPattern: false,
      colour: 0x0a1016
    }
  ],
  connections: [],
  corridorRoutes: [],
  tasks: [],
  sabotages: [],
  stations: [{
    ...station(
      "lobby-launch",
      "launch",
      "dropship-hold",
      sourceX(486),
      sourceZ(375)
    ),
    assetKey: "lobbyLaptop",
    artWidth: sourceSize(56),
    artDepth: sourceSize(46),
    artOffsetX: sourceSize(4),
    artOffsetZ: -sourceSize(32),
    ringWidth: sourceSize(112),
    ringDepth: sourceSize(72)
  }],
  spawnPoints: [
    spawn(612.5, 650), spawn(520, 650), spawn(705, 650), spawn(405, 650), spawn(820, 650),
    spawn(612.5, 770), spawn(520, 770), spawn(705, 770), spawn(405, 770), spawn(820, 770),
    spawn(612.5, 875), spawn(520, 875), spawn(705, 875), spawn(405, 875), spawn(820, 875),
    spawn(612.5, 430)
  ],
  collisionRects: [
    collision("lobby-crate-console", 486, 375, 65, 55),
    collision("lobby-equipment-case", 697, 370, 62, 34),
    collision("lobby-crate-port", 445, 560, 88, 66),
    collision("lobby-crate-starboard", 800, 525, 92, 70)
  ],
  decals: [
    decal("lobby-hull", "lobbyDropship", SOURCE.width / 2, SOURCE.height / 2, SOURCE.width, SOURCE.height),
    // The source panel includes a tall transparent recess. It is compressed to
    // the closed front-ramp silhouette seen beneath the final row of floor tiles.
    decal("lobby-ramp", "lobbyCargoDoor", SOURCE.width / 2, 1010, 676, 220),
    // Each exhaust sprite contains a vertical pair of plumes. Two columns per
    // engine reproduce the four cyan exhaust ports on each pod.
    decal("lobby-exhaust-port-a", "lobbyExhaust", 92, 820, 98, 185),
    decal("lobby-exhaust-port-b", "lobbyExhaust", 172, 820, 98, 185),
    decal("lobby-exhaust-starboard-a", "lobbyExhaust", 1053, 820, 98, 185),
    decal("lobby-exhaust-starboard-b", "lobbyExhaust", 1133, 820, 98, 185),
    decal("lobby-crate-console-art", "lobbyCrate", 486, 345, 82, 96),
    decal("lobby-equipment-case-art", "lobbyEquipmentCase", 697, 357, 76, 52),
    decal("lobby-crate-port-art", "lobbyCrate", 445, 518, 128, 145),
    decal("lobby-crate-starboard-art", "lobbyCrate", 800, 480, 132, 145)
  ],
  theme: {
    worldScale: 42,
    worldPadding: 42 * 2,
    frame: 0x8fb8c4,
    artAlpha: 1
  }
});

export const LOBBY_MAP_ID = LOBBY_DROPSHIP.id;
