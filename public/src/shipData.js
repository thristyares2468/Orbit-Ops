import { MIRA_HQ } from "./maps/miraHq.js";
import { mapIsWalkable, mapRoomAt } from "./maps/mapFactory.js";
import { POLUS } from "./maps/polus.js";
import { THE_AIRSHIP } from "./maps/theAirship.js";
import { THE_SKELD } from "./maps/theSkeld.js";

export const DEFAULT_MAP_ID = "the-skeld";
export const MAP_IDS = Object.freeze(["the-skeld", "mira-hq", "polus", "the-airship"]);
export const MAP_DEFINITIONS = Object.freeze({
  "the-skeld": THE_SKELD,
  "mira-hq": MIRA_HQ,
  polus: POLUS,
  "the-airship": THE_AIRSHIP
});
export const MAP_LIST = Object.freeze(MAP_IDS.map((id) => Object.freeze({
  id,
  name: MAP_DEFINITIONS[id].name,
  shortName: MAP_DEFINITIONS[id].shortName,
  description: MAP_DEFINITIONS[id].description
})));

export function getMapDefinition(mapId = DEFAULT_MAP_ID) {
  return MAP_DEFINITIONS[mapId] ?? MAP_DEFINITIONS[DEFAULT_MAP_ID];
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
  return getMapDefinition(mapId).stations.find((station) => station.id === stationId) ?? null;
}

export function distance2D(a, b) {
  return Math.hypot(Number(a?.x) - Number(b?.x), Number(a?.z) - Number(b?.z));
}
