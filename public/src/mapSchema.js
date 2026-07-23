function finite(value) {
  return Number.isFinite(Number(value));
}

export function pointInMapRect(x, z, rect, margin = 0) {
  return x >= rect.x - rect.width / 2 + margin && x <= rect.x + rect.width / 2 - margin
    && z >= rect.z - rect.depth / 2 + margin && z <= rect.z + rect.depth / 2 - margin;
}

export function mapShapePolygon(rect, margin = 0) {
  const halfWidth = rect.width / 2 - margin;
  const halfDepth = rect.depth / 2 - margin;
  if (halfWidth <= 0 || halfDepth <= 0) return [];
  const cut = Math.min(halfWidth * 2, halfDepth * 2) * 0.18;
  return [
    { x: rect.x - halfWidth + cut, z: rect.z - halfDepth },
    { x: rect.x + halfWidth - cut, z: rect.z - halfDepth },
    { x: rect.x + halfWidth, z: rect.z - halfDepth + cut },
    { x: rect.x + halfWidth, z: rect.z + halfDepth - cut },
    { x: rect.x + halfWidth - cut, z: rect.z + halfDepth },
    { x: rect.x - halfWidth + cut, z: rect.z + halfDepth },
    { x: rect.x - halfWidth, z: rect.z + halfDepth - cut },
    { x: rect.x - halfWidth, z: rect.z - halfDepth + cut }
  ];
}

export function pointInMapShape(x, z, shape, margin = 0) {
  if (shape?.shape !== "octagon") return pointInMapRect(x, z, shape, margin);
  const polygon = mapShapePolygon(shape, margin);
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses = (a.z > z) !== (b.z > z)
      && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function pointInCollisionRect(x, z, rect, margin = 0) {
  return pointInMapRect(x, z, rect, -Math.max(0, margin));
}

export function visibleMapLayers(map) {
  const layers = Array.isArray(map?.render?.layers) ? map.render.layers : [];
  return layers
    .filter((layer) => layer?.visible !== false)
    .map((layer, index) => Object.freeze({ ...layer, order: finite(layer.order) ? Number(layer.order) : index }))
    .sort((a, b) => a.order - b.order);
}

export function buildOrthogonalCorridors(rooms, connections, width = 4) {
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const corridors = [];
  for (const [fromId, toId] of connections) {
    const from = roomById.get(fromId);
    const to = roomById.get(toId);
    if (!from || !to) continue;
    const midX = (from.x + to.x) / 2;
    const midZ = (from.z + to.z) / 2;
    corridors.push(Object.freeze({
      id: `${fromId}:${toId}:x`,
      fromRoomId: fromId,
      toRoomId: toId,
      axis: "x",
      x: midX,
      z: from.z,
      width: Math.abs(to.x - from.x) + width,
      depth: width
    }));
    corridors.push(Object.freeze({
      id: `${fromId}:${toId}:z`,
      fromRoomId: fromId,
      toRoomId: toId,
      axis: "z",
      x: to.x,
      z: midZ,
      width,
      depth: Math.abs(to.z - from.z) + width
    }));
  }
  return corridors;
}

export function validateMapDefinition(map) {
  const errors = [];
  const rooms = Array.isArray(map?.rooms) ? map.rooms : [];
  const corridors = Array.isArray(map?.corridors) ? map.corridors : [];
  const stations = Array.isArray(map?.stations) ? map.stations : [];
  const spawns = Array.isArray(map?.spawnPoints) ? map.spawnPoints : [];
  const collisionRects = Array.isArray(map?.collisionRects) ? map.collisionRects : [];
  const objectGroups = Array.isArray(map?.objectGroups) ? map.objectGroups : [];
  const renderLayers = Array.isArray(map?.render?.layers) ? map.render.layers : [];
  const roomIds = new Set();
  const stationIds = new Set();
  const collisionIds = new Set();
  const objectGroupIds = new Set();
  const renderLayerIds = new Set();

  if (!map?.id) errors.push("Map id is required.");
  if (!map?.bounds || !["minX", "maxX", "minZ", "maxZ"].every((key) => finite(map.bounds[key]))) {
    errors.push("Map bounds must be finite.");
  }
  for (const room of rooms) {
    if (!room.id || roomIds.has(room.id)) errors.push(`Duplicate or missing room id: ${room.id ?? "(missing)"}.`);
    roomIds.add(room.id);
    if (![room.x, room.z, room.width, room.depth].every(finite) || room.width <= 0 || room.depth <= 0) {
      errors.push(`Room ${room.id ?? "(missing)"} has invalid geometry.`);
    }
  }
  for (const [fromId, toId] of map?.connections ?? []) {
    if (!roomIds.has(fromId) || !roomIds.has(toId)) errors.push(`Connection ${fromId}:${toId} references an unknown room.`);
  }
  for (const station of stations) {
    if (!station.id || stationIds.has(station.id)) errors.push(`Duplicate or missing station id: ${station.id ?? "(missing)"}.`);
    stationIds.add(station.id);
    if (!roomIds.has(station.roomId)) errors.push(`Station ${station.id ?? "(missing)"} references an unknown room.`);
    if (![station.x, station.z].every(finite)) errors.push(`Station ${station.id ?? "(missing)"} has invalid coordinates.`);
  }
  for (const rect of collisionRects) {
    if (!rect.id || collisionIds.has(rect.id)) errors.push(`Duplicate or missing collision id: ${rect.id ?? "(missing)"}.`);
    collisionIds.add(rect.id);
    if (rect.roomId && !roomIds.has(rect.roomId)) errors.push(`Collision ${rect.id ?? "(missing)"} references an unknown room.`);
    if (![rect.x, rect.z, rect.width, rect.depth].every(finite) || rect.width <= 0 || rect.depth <= 0) {
      errors.push(`Collision ${rect.id ?? "(missing)"} has invalid geometry.`);
    }
  }
  for (const group of objectGroups) {
    if (!group.id || objectGroupIds.has(group.id)) errors.push(`Duplicate or missing object-group id: ${group.id ?? "(missing)"}.`);
    objectGroupIds.add(group.id);
    if (!group.kind) errors.push(`Object group ${group.id ?? "(missing)"} requires a kind.`);
    if (!Array.isArray(group.objects)) errors.push(`Object group ${group.id ?? "(missing)"} requires an objects array.`);
  }
  for (const layer of renderLayers) {
    if (!layer.id || renderLayerIds.has(layer.id)) errors.push(`Duplicate or missing render-layer id: ${layer.id ?? "(missing)"}.`);
    renderLayerIds.add(layer.id);
    if (!layer.kind) errors.push(`Render layer ${layer.id ?? "(missing)"} requires a kind.`);
    if (!finite(layer.depth)) errors.push(`Render layer ${layer.id ?? "(missing)"} requires a finite depth.`);
  }
  for (const [index, spawn] of spawns.entries()) {
    if (!Array.isArray(spawn) || spawn.length < 2 || !spawn.every(finite)) {
      errors.push(`Spawn ${index} is invalid.`);
      continue;
    }
    const [x, z] = spawn;
    const walkable = rooms.some((room) => pointInMapShape(x, z, room))
      || corridors.some((corridor) => pointInMapRect(x, z, corridor));
    if (!walkable) errors.push(`Spawn ${index} is outside walkable geometry.`);
    if (collisionRects.some((rect) => pointInCollisionRect(x, z, rect))) {
      errors.push(`Spawn ${index} overlaps collision geometry.`);
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
