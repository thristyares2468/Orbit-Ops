import {
  buildRoutedCorridors,
  pointInCollisionRect,
  pointInMapRect,
  pointInMapShape,
  validateMapDefinition
} from "../mapSchema.js";

const DEFAULT_LAYERS = Object.freeze([
  Object.freeze({ id: "backgrounds", kind: "backgrounds", visible: true, order: 0, depth: -1000 }),
  Object.freeze({ id: "zones", kind: "zones", visible: true, order: 0.5, depth: -360 }),
  Object.freeze({ id: "corridors", kind: "corridors", visible: true, order: 1, depth: -300 }),
  Object.freeze({ id: "rooms", kind: "rooms", visible: true, order: 2, depth: -250 }),
  Object.freeze({ id: "props", kind: "props", visible: true, order: 2.5, depth: -180 }),
  Object.freeze({ id: "stations", kind: "stations", visible: true, order: 3, depth: 210 })
]);

const DECAL_LAYER = Object.freeze({ id: "decals", kind: "decals", visible: true, order: 2.2, depth: -200 });

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
  corridorRoutes,
  corridors: authoredCorridors = null,
  zones = [],
  deck = null,
  walkGrid = null,
  tasks,
  sabotages,
  stations = [],
  spawnPoints,
  collisionRects = [],
  decals = [],
  corridorWidth = 4,
  theme = {}
}) {
  const frozenRooms = freezeItems(rooms);
  const frozenConnections = Object.freeze(connections.map((connection) => Object.freeze([...connection])));
  const frozenRoutes = Object.freeze((corridorRoutes ?? connections.map(([from, to]) => ({ from, to }))).map((route, index) =>
    Object.freeze({
      id: route.id ?? `${route.from}:${route.to}:${index}`,
      from: route.from,
      to: route.to,
      width: route.width ?? corridorWidth,
      via: Object.freeze((route.via ?? []).map((point) => Object.freeze({ x: Number(point.x), z: Number(point.z) })))
    })
  ));
  // A room graph describes navigation relationships; it is not necessarily the
  // shape of the deck. Maps with traced geometry can supply their own physical
  // corridor rectangles/polygons while older maps retain the routed fallback.
  const corridors = authoredCorridors
    ? freezeItems(authoredCorridors)
    : Object.freeze(buildRoutedCorridors(frozenRooms, frozenRoutes, corridorWidth));
  const frozenZones = freezeItems(zones);
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
  const frozenDecals = freezeItems(decals);
  const worldScale = theme.worldScale ?? 60;
  const worldPadding = theme.worldPadding ?? worldScale * 6.5;
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
    zones: frozenZones,
    connections: frozenConnections,
    corridorRoutes: frozenRoutes,
    corridors,
    taskDefinitions: frozenTasks,
    sabotageDefinitions: frozenSabotages,
    collisionRects: frozenCollisions,
    walkGrid: walkGrid ? Object.freeze({ ...walkGrid }) : null,
    decals: frozenDecals,
    stations: allStations,
    spawnPoints: frozenSpawns,
    objectGroups,
    render: Object.freeze({
      worldScale,
      worldPadding,
      camera: Object.freeze({ clampToBounds: true, roundPixels: true }),
      layers: frozenDecals.length ? Object.freeze([...DEFAULT_LAYERS, DECAL_LAYER]) : DEFAULT_LAYERS,
      backgrounds: DEFAULT_BACKGROUNDS,
      deck: deck ? Object.freeze({ ...deck }) : null,
      corridor: Object.freeze({
        depth: -300,
        fill: theme.corridorFill ?? 0x0b202d,
        fillAlpha: 0.98,
        stroke: theme.corridorStroke ?? 0x2b5d6e,
        strokeAlpha: 0.68,
        accent: theme.corridorAccent ?? 0x64d8e8,
        accentAlpha: theme.corridorAccentAlpha ?? 0.16,
        radius: theme.corridorRadius ?? 18
      }),
      room: Object.freeze({
        depth: -250,
        artAlpha: theme.artAlpha ?? 0.72,
        frame: theme.frame ?? 0x7de7f5,
        frameAlpha: 0.34,
        radius: 24
      }),
      zone: Object.freeze({
        depth: -360,
        fill: theme.zoneFill ?? 0x2f344d,
        fillAlpha: theme.zoneAlpha ?? 0.92,
        stroke: theme.zoneStroke ?? theme.corridorStroke ?? 0x5d6487,
        strokeAlpha: 0.42,
        radius: 30
      }),
      prop: Object.freeze({ depth: -180 }),
      station: Object.freeze({ depth: 210, iconSize: 34 })
    })
  });
  const validation = validateMapDefinition(map);
  if (!validation.valid) throw new Error(`Invalid ${name} map: ${validation.errors.join(" ")}`);
  return map;
}

// Decoded walk-grid bitmasks, cached per map so the base64 is unpacked once.
const WALK_GRID_CACHE = new WeakMap();

function walkGridBits(grid) {
  let bits = WALK_GRID_CACHE.get(grid);
  if (bits) return bits;
  const binary = typeof atob === "function"
    ? atob(grid.bits)
    : Buffer.from(grid.bits, "base64").toString("binary");
  bits = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bits[i] = binary.charCodeAt(i);
  WALK_GRID_CACHE.set(grid, bits);
  return bits;
}

// A cell is walkable only if it and the four points a margin away all are, so a
// player is never squeezed into a wall by their own radius.
function walkGridAllows(grid, x, z, margin) {
  const bits = walkGridBits(grid);
  const stride = (grid.cols + 7) >> 3;
  const probe = (px, pz) => {
    const col = Math.floor((px - grid.originX) / grid.cell);
    const row = Math.floor((pz - grid.originZ) / grid.cell);
    if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
    return (bits[row * stride + (col >> 3)] >> (col & 7) & 1) === 1;
  };
  if (!probe(x, z)) return false;
  if (margin <= 0) return true;
  return probe(x - margin, z) && probe(x + margin, z)
    && probe(x, z - margin) && probe(x, z + margin);
}

export function mapIsWalkable(map, x, z, margin = 0.55) {
  if (!map || !Number.isFinite(x) || !Number.isFinite(z)) return false;
  // When a map carries a walk grid derived from its own art, that grid is the
  // authority on floor; the authored rects only add props on top of it.
  if (map.walkGrid) {
    if (!walkGridAllows(map.walkGrid, x, z, margin)) return false;
    return !map.collisionRects.some((rect) => pointInCollisionRect(x, z, rect, margin));
  }
  const insideFloor = map.rooms.some((room) => pointInMapShape(x, z, room, margin))
    || map.zones.some((zone) => zone.walkable !== false
      && pointInMapShape(x, z, zone, Math.min(margin, 0.25)))
    || map.corridors.some((corridor) => pointInMapShape(x, z, corridor, Math.min(margin, 0.35)));
  if (!insideFloor) return false;
  return !map.collisionRects.some((rect) => pointInCollisionRect(x, z, rect, margin));
}

export function mapRoomAt(map, x, z) {
  return map?.rooms.find((room) => pointInMapShape(x, z, room, 0)) ?? null;
}
