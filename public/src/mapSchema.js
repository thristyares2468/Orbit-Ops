function finite(value) {
  return Number.isFinite(Number(value));
}

export function pointInMapRect(x, z, rect, margin = 0) {
  return x >= rect.x - rect.width / 2 + margin && x <= rect.x + rect.width / 2 - margin
    && z >= rect.z - rect.depth / 2 + margin && z <= rect.z + rect.depth / 2 - margin;
}

export function pointInMapEllipse(x, z, ellipse, margin = 0) {
  const radiusX = ellipse.width / 2 - margin;
  const radiusZ = ellipse.depth / 2 - margin;
  if (radiusX <= 0 || radiusZ <= 0) return false;
  const dx = (x - ellipse.x) / radiusX;
  const dz = (z - ellipse.z) / radiusZ;
  return dx * dx + dz * dz <= 1;
}

export function mapShapePolygon(rect, margin = 0) {
  const halfWidth = rect.width / 2 - margin;
  const halfDepth = rect.depth / 2 - margin;
  if (halfWidth <= 0 || halfDepth <= 0) return [];
  if (Array.isArray(rect.walkablePolygon) && rect.walkablePolygon.length >= 3) {
    const scaleX = halfWidth / (rect.width / 2);
    const scaleZ = halfDepth / (rect.depth / 2);
    return rect.walkablePolygon.map((point) => ({
      x: rect.x + Number(point.x) * scaleX,
      z: rect.z + Number(point.z) * scaleZ
    }));
  }
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
  if (shape?.shape === "ellipse") return pointInMapEllipse(x, z, shape, margin);
  if (shape?.shape !== "octagon" && !Array.isArray(shape?.walkablePolygon)) return pointInMapRect(x, z, shape, margin);
  const polygon = mapShapePolygon(shape, margin);
  if (polygon.length < 3) return false;
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
  if (rect?.shape === "ellipse") return pointInMapEllipse(x, z, rect, -Math.max(0, margin));
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

export function buildRoutedCorridors(rooms, routes, defaultWidth = 4) {
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const corridors = [];
  for (const [routeIndex, route] of routes.entries()) {
    const from = roomById.get(route.from);
    const to = roomById.get(route.to);
    if (!from || !to) continue;
    const width = Number(route.width) > 0 ? Number(route.width) : defaultWidth;
    const requestedPoints = [
      { x: from.x, z: from.z },
      ...(route.via ?? []).map((point) => ({ x: Number(point.x), z: Number(point.z) })),
      { x: to.x, z: to.z }
    ];
    const points = [requestedPoints[0]];
    for (const next of requestedPoints.slice(1)) {
      const previous = points.at(-1);
      if (previous.x !== next.x && previous.z !== next.z) {
        points.push({ x: next.x, z: previous.z });
      }
      points.push(next);
    }
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      if (start.x === end.x && start.z === end.z) continue;
      const axis = start.z === end.z ? "x" : "z";
      corridors.push(Object.freeze({
        id: `${route.id ?? `${route.from}:${route.to}:${routeIndex}`}:${index}`,
        routeId: route.id ?? `${route.from}:${route.to}`,
        fromRoomId: route.from,
        toRoomId: route.to,
        axis,
        x: (start.x + end.x) / 2,
        z: (start.z + end.z) / 2,
        width: axis === "x" ? Math.abs(end.x - start.x) + width : width,
        depth: axis === "z" ? Math.abs(end.z - start.z) + width : width
      }));
    }
  }
  return corridors;
}

export function validateMapDefinition(map) {
  const errors = [];
  const rooms = Array.isArray(map?.rooms) ? map.rooms : [];
  const corridors = Array.isArray(map?.corridors) ? map.corridors : [];
  const corridorRoutes = Array.isArray(map?.corridorRoutes) ? map.corridorRoutes : [];
  const stations = Array.isArray(map?.stations) ? map.stations : [];
  const spawns = Array.isArray(map?.spawnPoints) ? map.spawnPoints : [];
  const collisionRects = Array.isArray(map?.collisionRects) ? map.collisionRects : [];
  const decals = Array.isArray(map?.decals) ? map.decals : [];
  const zones = Array.isArray(map?.zones) ? map.zones : [];
  const objectGroups = Array.isArray(map?.objectGroups) ? map.objectGroups : [];
  const renderLayers = Array.isArray(map?.render?.layers) ? map.render.layers : [];
  const roomIds = new Set();
  const stationIds = new Set();
  const collisionIds = new Set();
  const decalIds = new Set();
  const zoneIds = new Set();
  const objectGroupIds = new Set();
  const renderLayerIds = new Set();
  const routeIds = new Set();

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
    if (room.artCrop
      && (![room.artCrop.x, room.artCrop.y, room.artCrop.width, room.artCrop.height].every(finite)
        || room.artCrop.width <= 0 || room.artCrop.height <= 0)) {
      errors.push(`Room ${room.id ?? "(missing)"} has an invalid art crop.`);
    }
    if (room.walkablePolygon
      && (!Array.isArray(room.walkablePolygon)
        || room.walkablePolygon.length < 3
        || room.walkablePolygon.some((point) => ![point?.x, point?.z].every(finite)))) {
      errors.push(`Room ${room.id ?? "(missing)"} has an invalid walkable polygon.`);
    }
  }
  for (const zone of zones) {
    if (!zone.id || zoneIds.has(zone.id)) errors.push(`Duplicate or missing zone id: ${zone.id ?? "(missing)"}.`);
    zoneIds.add(zone.id);
    if (![zone.x, zone.z, zone.width, zone.depth].every(finite) || zone.width <= 0 || zone.depth <= 0) {
      errors.push(`Zone ${zone.id ?? "(missing)"} has invalid geometry.`);
    }
  }
  for (const [fromId, toId] of map?.connections ?? []) {
    if (!roomIds.has(fromId) || !roomIds.has(toId)) errors.push(`Connection ${fromId}:${toId} references an unknown room.`);
  }
  for (const route of corridorRoutes) {
    if (!route.id || routeIds.has(route.id)) errors.push(`Duplicate or missing route id: ${route.id ?? "(missing)"}.`);
    routeIds.add(route.id);
    if (!roomIds.has(route.from) || !roomIds.has(route.to)) {
      errors.push(`Route ${route.id ?? "(missing)"} references an unknown room.`);
    }
    if (!Array.isArray(route.via) || route.via.some((point) => ![point.x, point.z].every(finite))) {
      errors.push(`Route ${route.id ?? "(missing)"} has invalid waypoints.`);
    }
  }
  for (const station of stations) {
    if (!station.id || stationIds.has(station.id)) errors.push(`Duplicate or missing station id: ${station.id ?? "(missing)"}.`);
    stationIds.add(station.id);
    if (!roomIds.has(station.roomId)) errors.push(`Station ${station.id ?? "(missing)"} references an unknown room.`);
    if (![station.x, station.z].every(finite)) errors.push(`Station ${station.id ?? "(missing)"} has invalid coordinates.`);
    for (const key of ["artWidth", "artDepth", "ringWidth", "ringDepth"]) {
      if (key in station && (!finite(station[key]) || Number(station[key]) <= 0)) {
        errors.push(`Station ${station.id ?? "(missing)"} has invalid ${key}.`);
      }
    }
    for (const key of ["artOffsetX", "artOffsetZ", "artAlpha"]) {
      if (key in station && !finite(station[key])) {
        errors.push(`Station ${station.id ?? "(missing)"} has invalid ${key}.`);
      }
    }
  }
  for (const rect of collisionRects) {
    if (!rect.id || collisionIds.has(rect.id)) errors.push(`Duplicate or missing collision id: ${rect.id ?? "(missing)"}.`);
    collisionIds.add(rect.id);
    if (rect.roomId && !roomIds.has(rect.roomId)) errors.push(`Collision ${rect.id ?? "(missing)"} references an unknown room.`);
    if (![rect.x, rect.z, rect.width, rect.depth].every(finite) || rect.width <= 0 || rect.depth <= 0) {
      errors.push(`Collision ${rect.id ?? "(missing)"} has invalid geometry.`);
    }
  }
  for (const decal of decals) {
    if (!decal.id || decalIds.has(decal.id)) errors.push(`Duplicate or missing decal id: ${decal.id ?? "(missing)"}.`);
    decalIds.add(decal.id);
    if (!decal.assetKey) errors.push(`Decal ${decal.id ?? "(missing)"} requires an assetKey.`);
    if (![decal.x, decal.z, decal.width, decal.depth].every(finite) || decal.width <= 0 || decal.depth <= 0) {
      errors.push(`Decal ${decal.id ?? "(missing)"} has invalid geometry.`);
    }
    if (decal.crop
      && (![decal.crop.x, decal.crop.y, decal.crop.width, decal.crop.height].every(finite)
        || decal.crop.width <= 0 || decal.crop.height <= 0)) {
      errors.push(`Decal ${decal.id ?? "(missing)"} has an invalid crop.`);
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
      || zones.some((zone) => pointInMapShape(x, z, zone))
      || corridors.some((corridor) => pointInMapRect(x, z, corridor));
    if (!walkable) errors.push(`Spawn ${index} is outside walkable geometry.`);
    if (collisionRects.some((rect) => pointInCollisionRect(x, z, rect))) {
      errors.push(`Spawn ${index} overlaps collision geometry.`);
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
