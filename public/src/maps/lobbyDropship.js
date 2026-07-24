import { createMapDefinition, station } from "./mapFactory.js";

// The supplied Lobby sheet is 1225x993 once its drawn components are separated.
// SHIP_SCALE converts those source pixels to world units, so every decal and
// collider below can be authored directly against the artwork.
const SHIP_SCALE = 42 / 1225;
const SHIP_WIDTH = 1225 * SHIP_SCALE;
const SHIP_DEPTH = 993 * SHIP_SCALE;

// Interior deck measured from the artwork. The x range follows the hull's narrow
// lower section so nobody can walk into the wall art at the bottom of the deck.
const DECK_WIDTH = (868 - 357) * SHIP_SCALE;
const DECK_DEPTH = (930 - 310) * SHIP_SCALE;
// Deck centre relative to the sprite centre, so the hull sits around the floor.
const SHIP_OFFSET_Z = -((310 + 930) / 2 - 993 / 2) * SHIP_SCALE;

function crate(id, x, z) {
  return { id, kind: "cargo", prop: false, roomId: "dropship-hold", x, z, width: 2.4, depth: 2.4 };
}

function crateDecal(id, x, z) {
  return { id, assetKey: "lobbyCrate", x, z: z - 0.45, width: 2.9, depth: 3.9 };
}

export const LOBBY_DROPSHIP = createMapDefinition({
  id: "lobby-dropship",
  name: "Dropship",
  shortName: "Dropship",
  description: "The Meridian's boarding dropship, where the crew gathers before a launch.",
  bounds: { minX: -22, maxX: 22, minZ: -22, maxZ: 20 },
  rooms: [
    {
      id: "dropship-hold",
      name: "Dropship",
      x: 0,
      z: 0,
      width: DECK_WIDTH,
      depth: DECK_DEPTH,
      label: false,
      chrome: false,
      colour: 0x0a1016
    }
  ],
  connections: [],
  corridorRoutes: [],
  tasks: [],
  sabotages: [],
  stations: [station("lobby-launch", "launch", "dropship-hold", -5.4, -3)],
  spawnPoints: [
    [-6, -6], [-3, -6], [0, -6], [3, -6], [6, -6],
    [-7.5, 1.5], [-4.5, 1.5], [-1.5, 1.5], [1.5, 1.5], [4.5, 1.5], [7.5, 1.5],
    [-6, 5], [-3, 5], [0, 5], [3, 5], [6, 5]
  ],
  collisionRects: [
    crate("lobby-crate-console", -5.4, -3),
    crate("lobby-crate-starboard", 5.4, -1.2),
    crate("lobby-crate-aft", -2.4, 8)
  ],
  decals: [
    { id: "lobby-hull", assetKey: "lobbyDropship", x: 0, z: SHIP_OFFSET_Z, width: SHIP_WIDTH, depth: SHIP_DEPTH },
    { id: "lobby-ramp", assetKey: "lobbyCargoDoor", x: 0, z: 15.4, width: 15, depth: 8.5 },
    { id: "lobby-exhaust-port-a", assetKey: "lobbyExhaust", x: -17.6, z: 12.4, width: 1.9, depth: 3.6, alpha: 0.85 },
    { id: "lobby-exhaust-port-b", assetKey: "lobbyExhaust", x: -15.4, z: 12.4, width: 1.9, depth: 3.6, alpha: 0.85 },
    { id: "lobby-exhaust-starboard-a", assetKey: "lobbyExhaust", x: 15.4, z: 12.4, width: 1.9, depth: 3.6, alpha: 0.85 },
    { id: "lobby-exhaust-starboard-b", assetKey: "lobbyExhaust", x: 17.6, z: 12.4, width: 1.9, depth: 3.6, alpha: 0.85 },
    crateDecal("lobby-crate-console-art", -5.4, -3),
    crateDecal("lobby-crate-starboard-art", 5.4, -1.2),
    crateDecal("lobby-crate-aft-art", -2.4, 8)
  ],
  theme: {
    worldScale: 42,
    worldPadding: 42 * 2,
    frame: 0x8fb8c4,
    artAlpha: 1
  }
});

export const LOBBY_MAP_ID = LOBBY_DROPSHIP.id;
