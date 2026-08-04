import { getMapDefinition, isWalkable } from "./shipData.js";

const DIRECTIONS = Object.freeze([
  Object.freeze([1, 0]), Object.freeze([-1, 0]), Object.freeze([0, 1]), Object.freeze([0, -1]),
  Object.freeze([1, 1]), Object.freeze([1, -1]), Object.freeze([-1, 1]), Object.freeze([-1, -1])
]);
const GRID_CACHE = new Map();

function gridKey(x, z) { return `${x}:${z}`; }

function heapPush(heap, entry) {
  heap.push(entry);
  for (let index = heap.length - 1; index > 0;) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent].score <= heap[index].score) break;
    [heap[parent], heap[index]] = [heap[index], heap[parent]];
    index = parent;
  }
}

function heapPop(heap) {
  const first = heap[0];
  const last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    for (let index = 0;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < heap.length && heap[left].score < heap[smallest].score) smallest = left;
      if (right < heap.length && heap[right].score < heap[smallest].score) smallest = right;
      if (smallest === index) break;
      [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
      index = smallest;
    }
  }
  return first;
}

export function segmentWalkable(mapId, start, end, margin, sampleStep = 0.32) {
  const distance = Math.hypot(end.x - start.x, end.z - start.z);
  const samples = Math.max(1, Math.ceil(distance / sampleStep));
  for (let index = 0; index <= samples; index += 1) {
    const ratio = index / samples;
    if (!isWalkable(
      mapId,
      start.x + (end.x - start.x) * ratio,
      start.z + (end.z - start.z) * ratio,
      margin
    )) return false;
  }
  return true;
}

function navigationGrid(mapId, map, step, margin) {
  const cacheKey = `${mapId}:${step}:${margin}`;
  if (GRID_CACHE.has(cacheKey)) return GRID_CACHE.get(cacheKey);
  const toWorld = (x, z) => ({ x: map.bounds.minX + x * step, z: map.bounds.minZ + z * step });
  const maxX = Math.ceil((map.bounds.maxX - map.bounds.minX) / step);
  const maxZ = Math.ceil((map.bounds.maxZ - map.bounds.minZ) / step);
  const walkable = new Set();
  for (let x = 0; x <= maxX; x += 1) {
    for (let z = 0; z <= maxZ; z += 1) {
      const world = toWorld(x, z);
      if (isWalkable(mapId, world.x, world.z, margin)) walkable.add(gridKey(x, z));
    }
  }
  const grid = { toWorld, maxX, maxZ, walkable, edgeWalkable: new Map() };
  GRID_CACHE.set(cacheKey, grid);
  return grid;
}

function closestWalkableNode(map, grid, point, step) {
  const baseX = Math.round((point.x - map.bounds.minX) / step);
  const baseZ = Math.round((point.z - map.bounds.minZ) / step);
  for (let radius = 0; radius <= Math.ceil(4 / step); radius += 1) {
    const candidates = [];
    for (let xOffset = -radius; xOffset <= radius; xOffset += 1) {
      for (let zOffset = -radius; zOffset <= radius; zOffset += 1) {
        if (radius && Math.max(Math.abs(xOffset), Math.abs(zOffset)) !== radius) continue;
        const x = baseX + xOffset;
        const z = baseZ + zOffset;
        if (x < 0 || z < 0 || x > grid.maxX || z > grid.maxZ || !grid.walkable.has(gridKey(x, z))) continue;
        const world = grid.toWorld(x, z);
        candidates.push({ x, z, world, distance: Math.hypot(world.x - point.x, world.z - point.z) });
      }
    }
    if (candidates.length) return candidates.sort((a, b) => a.distance - b.distance)[0];
  }
  return null;
}

function reconstructPath(nodes, cameFrom, endKey) {
  const path = [];
  for (let key = endKey; key; key = cameFrom.get(key)) path.unshift(nodes.get(key));
  return path;
}

function smoothPath(mapId, path, margin) {
  if (path.length <= 2) return path;
  const smoothed = [path[0]];
  let anchor = 0;
  while (anchor < path.length - 1) {
    let next = path.length - 1;
    while (next > anchor + 1 && !segmentWalkable(mapId, path[anchor], path[next], margin)) next -= 1;
    smoothed.push(path[next]);
    anchor = next;
  }
  return smoothed;
}

export function findWalkablePath(mapId, start, target, { step = 1, margin = 0.55 } = {}) {
  const map = getMapDefinition(mapId);
  if (!map || !start || !target) return [];
  const grid = navigationGrid(mapId, map, step, margin);
  const startNode = closestWalkableNode(map, grid, start, step);
  const targetNode = closestWalkableNode(map, grid, target, step);
  if (!startNode || !targetNode) return [];

  const startKey = gridKey(startNode.x, startNode.z);
  const targetKey = gridKey(targetNode.x, targetNode.z);
  const open = [{ key: startKey, score: Math.hypot(targetNode.x - startNode.x, targetNode.z - startNode.z) }];
  const closed = new Set();
  const nodes = new Map([[startKey, startNode.world]]);
  const gridNodes = new Map([[startKey, { x: startNode.x, z: startNode.z }]]);
  const cameFrom = new Map();
  const gScore = new Map([[startKey, 0]]);
  const fScore = new Map([[startKey, Math.hypot(targetNode.x - startNode.x, targetNode.z - startNode.z)]]);

  while (open.length) {
    const entry = heapPop(open);
    const currentKey = entry.key;
    if (closed.has(currentKey) || entry.score !== fScore.get(currentKey)) continue;
    if (currentKey === targetKey) {
      const path = reconstructPath(nodes, cameFrom, currentKey);
      return smoothPath(mapId, path, margin).map(({ x, z }) => ({ x, z }));
    }

    closed.add(currentKey);
    const current = gridNodes.get(currentKey);
    for (const [xOffset, zOffset] of DIRECTIONS) {
      const x = current.x + xOffset;
      const z = current.z + zOffset;
      if (x < 0 || z < 0 || x > grid.maxX || z > grid.maxZ) continue;
      const key = gridKey(x, z);
      if (!grid.walkable.has(key)) continue;
      const world = grid.toWorld(x, z);
      const edgeKey = currentKey < key ? `${currentKey}>${key}` : `${key}>${currentKey}`;
      if (!grid.edgeWalkable.has(edgeKey)) {
        grid.edgeWalkable.set(edgeKey, segmentWalkable(mapId, nodes.get(currentKey), world, margin));
      }
      if (!grid.edgeWalkable.get(edgeKey)) continue;
      if (xOffset && zOffset) {
        if (!grid.walkable.has(gridKey(current.x + xOffset, current.z))
          || !grid.walkable.has(gridKey(current.x, current.z + zOffset))) continue;
      }
      const tentative = (gScore.get(currentKey) ?? Infinity) + Math.hypot(xOffset, zOffset);
      if (tentative >= (gScore.get(key) ?? Infinity)) continue;
      cameFrom.set(key, currentKey);
      gScore.set(key, tentative);
      fScore.set(key, tentative + Math.hypot(targetNode.x - x, targetNode.z - z));
      nodes.set(key, world);
      gridNodes.set(key, { x, z });
      heapPush(open, { key, score: fScore.get(key) });
    }
  }
  return [];
}
