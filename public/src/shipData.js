import { LOBBY_DROPSHIP, LOBBY_MAP_ID } from "./maps/lobbyDropship.js";
import { mapIsWalkable, mapRoomAt, mapStationById } from "./maps/mapFactory.js";
import { THE_SKELD } from "./maps/theSkeld.js";

export const DEFAULT_MAP_ID = "the-skeld";
export const MAP_IDS = Object.freeze(["the-skeld"]);
export const MAP_DEFINITIONS = Object.freeze({
  "the-skeld": THE_SKELD
});
export const MAP_LIST = Object.freeze(MAP_IDS.map((id) => Object.freeze({
  id,
  name: MAP_DEFINITIONS[id].name,
  shortName: MAP_DEFINITIONS[id].shortName,
  description: MAP_DEFINITIONS[id].description
})));

// The dropship lobby is a real map for movement, collision, and rendering, but it is
// deliberately absent from MAP_IDS/MAP_LIST so it never appears as a playable selection.
const ALL_MAP_DEFINITIONS = Object.freeze({ ...MAP_DEFINITIONS, [LOBBY_MAP_ID]: LOBBY_DROPSHIP });

export { LOBBY_MAP_ID };

export function getMapDefinition(mapId = DEFAULT_MAP_ID) {
  return ALL_MAP_DEFINITIONS[mapId] ?? ALL_MAP_DEFINITIONS[DEFAULT_MAP_ID];
}

export function getMapList() {
  return MAP_LIST;
}

export function isWalkable(mapId, x, z, margin = 0.55) {
  return mapIsWalkable(getMapDefinition(mapId), x, z, margin);
}

export function roomAt(mapId, x, z) {
  return mapRoomAt(getMapDefinition(mapId), x, z);
}

export function stationById(mapId, stationId) {
  return mapStationById(getMapDefinition(mapId), stationId);
}

export function distance2D(a, b) {
  return Math.hypot(Number(a?.x) - Number(b?.x), Number(a?.z) - Number(b?.z));
}
