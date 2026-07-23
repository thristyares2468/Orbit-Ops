import {
  buildOrthogonalCorridors,
  pointInCollisionRect,
  pointInMapRect,
  pointInMapShape,
  validateMapDefinition
} from "../mapSchema.js";

const DEFAULT_LAYERS = Object.freeze([
  Object.freeze({ id: "backgrounds", kind: "backgrounds", visible: true, order: 0, depth: -1000 }),
  Object.freeze({ id: "corridors", kind: "corridors", visible: true, order: 1, depth: -300 }),
  Object.freeze({ id: "rooms", kind: "rooms", visible: true, order: 2, depth: -250 }),
  Object.freeze({ id: "stations", kind: "stations", visible: true, order: 3, depth: 210 })
]);

const DEFAULT_BACKGROUNDS = Object.freeze([
  Object.freeze({ type: "tile", assetKey: "stars", alpha: 0.58, depth: -1000 }),
  Object.freeze({ type: "image", assetKey: "parallax1", alpha: 0.11, depth: -990, sizeRatio: 0.72 })
]);

function freezeItems(values = []) {
  return Object.freeze(values.map((value) => Object.freeze(value)));
}

export function task(id, name, roomId, x, z, kind, steps = 4) {
  return { id, name, roomId, x, z, kind, steps };
}

export function station(id, type, roomId, x, z, refId = null) {
  return { id, type, roomId, x, z, ...(refId ? { refId } : {}) };
}

export function createMapDefinition({
  id,
  name,
  shortName = name,
  description,
  bounds,
  rooms,
  connections,
  tasks,
  sabotages,
  stations = [],
  spawnPoints,
  collisionRects = [],
  corridorWidth = 4,
  theme = {}
}) {
  const frozenRooms = freezeItems(rooms);
  const frozenConnections = Object.freeze(connections.map((connection) => Object.freeze([...connection])));
  const corridors = Object.freeze(buildOrthogonalCorridors(frozenRooms, frozenConnections, corridorWidth));
  const frozenTasks = freezeItems(tasks);
  const frozenSabotages = freezeItems(sabotages);
  const allStations = freezeItems([
    ...frozenTasks.map((definition) => ({
      id: `task:${definition.id}`,
      type: "task",
      refId: definition.id,
      roomId: definition.roomId,
      x: definition.x,
      z: definition.z
    })),
    ...stations
  ]);
  const frozenSpawns = Object.freeze(spawnPoints.map((spawn) => Object.freeze([...spawn])));
  const frozenCollisions = freezeItems(collisionRects);
  const objectGroups = Object.freeze([
    Object.freeze({ id: "collisions", kind: "collision", visible: false, objects: frozenCollisions }),
    Object.freeze({ id: "stations", kind: "interaction", visible: false, objects: allStations }),
    Object.freeze({
      id: "spawns",
      kind: "spawn",
      visible: false,
      objects: freezeItems(frozenSpawns.map(([x, z], index) => ({ id: `spawn-${index + 1}`, x, z })))
    })
  ]);
  const map = Object.freeze({
    id,
    name,
    shortName,
    description,
    schemaVersion: 2,
    bounds: Object.freeze(bounds),
    rooms: frozenRooms,
    connections: frozenConnections,
    corridors,
    taskDefinitions: frozenTasks,
    sabotageDefinitions: frozenSabotages,
    collisionRects: frozenCollisions,
    stations: allStations,
    spawnPoints: frozenSpawns,
    objectGroups,
    render: Object.freeze({
      worldScale: theme.worldScale ?? 60,
      worldPadding: theme.worldPadding ?? 300,
      camera: Object.freeze({ clampToBounds: true, roundPixels: true }),
      layers: DEFAULT_LAYERS,
      backgrounds: DEFAULT_BACKGROUNDS,
      corridor: Object.freeze({
        depth: -300,
        fill: theme.corridorFill ?? 0x0b202d,
        fillAlpha: 0.98,
        stroke: theme.corridorStroke ?? 0x2b5d6e,
        strokeAlpha: 0.68,
        radius: 18
      }),
      room: Object.freeze({
        depth: -250,
        artAlpha: theme.artAlpha ?? 0.72,
        frame: theme.frame ?? 0x7de7f5,
        frameAlpha: 0.34,
        radius: 24
      }),
      station: Object.freeze({ depth: 210, iconSize: 34 })
    })
  });
  const validation = validateMapDefinition(map);
  if (!validation.valid) throw new Error(`Invalid ${name} map: ${validation.errors.join(" ")}`);
  return map;
}

export function mapIsWalkable(map, x, z, margin = 0.55) {
  if (!map || !Number.isFinite(x) || !Number.isFinite(z)) return false;
  const insideFloor = map.rooms.some((room) => pointInMapShape(x, z, room, margin))
    || map.corridors.some((corridor) => pointInMapRect(x, z, corridor, Math.min(margin, 0.35)));
  if (!insideFloor) return false;
  return !map.collisionRects.some((rect) => pointInCollisionRect(x, z, rect, margin));
}

export function mapRoomAt(map, x, z) {
  return map?.rooms.find((room) => pointInMapShape(x, z, room, 0)) ?? null;
}

