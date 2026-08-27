// Last updated: 13 August 2026
// mapCollision.js — server-side ground raycast + line-of-sight for anti-cheat.
//
// This is a CommonJS port of the pure geometry routines from the attack tool's
// mapSpawns.mjs (Möller–Trumbore ray/triangle, a uniform XZ spatial grid, a
// downward ground raycast, and a segment/wall test). The same technique the
// cheat tool used to look legitimate is reused here to validate that players are
// actually standing on the map and not flying / no-clipping.
//
// IMPORTANT coordinate space: the client reports EYE positions after applying
// each map definition's scale. The loader receives that same scale so ground,
// LOS, spawning, and browser rendering always share one world coordinate space.

const fs = require('fs');
const path = require('path');
const { NUKE_DOORS, NUKE_LADDERS, NUKE_VENTS, MIRAGE_BREAKABLE_WINDOWS } = require('./maps');

const MAP_SCALE = 20;     // matches index.html mapScale
const GROUND_CELL = 80;   // 4 (raw, from mapSpawns) * 20
const LOS_CELL = 400;     // larger cells for the (optional, rarer) LOS test

// --- Möller–Trumbore ray-triangle intersection. Returns t (distance) or null. -
const EPSILON = 1e-7;
function rayTriangle(orig, dir, v0, v1, v2) {
  const ex0 = v1[0] - v0[0], ey0 = v1[1] - v0[1], ez0 = v1[2] - v0[2];
  const ex1 = v2[0] - v0[0], ey1 = v2[1] - v0[1], ez1 = v2[2] - v0[2];
  const px = dir[1] * ez1 - dir[2] * ey1;
  const py = dir[2] * ex1 - dir[0] * ez1;
  const pz = dir[0] * ey1 - dir[1] * ex1;
  const det = ex0 * px + ey0 * py + ez0 * pz;
  if (det > -EPSILON && det < EPSILON) return null;
  const invDet = 1 / det;
  const tx = orig[0] - v0[0], ty = orig[1] - v0[1], tz = orig[2] - v0[2];
  const u = (tx * px + ty * py + tz * pz) * invDet;
  if (u < 0 || u > 1) return null;
  const qx = ty * ez0 - tz * ey0;
  const qy = tz * ex0 - tx * ez0;
  const qz = tx * ey0 - ty * ex0;
  const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * invDet;
  if (v < 0 || u + v > 1) return null;
  const t = (ex1 * qx + ey1 * qy + ez1 * qz) * invDet;
  return t > EPSILON ? t : null;
}

function mul4x4Vec3(m, v) {
  const x = v[0], y = v[1], z = v[2];
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ];
}

function multiplyMatrices(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function getNodeWorldMatrix(node, parentMatrix) {
  return multiplyMatrices(parentMatrix, node.getMatrix());
}

function primitiveGlassPaneIds(positions, indices, panePrefix, excludedFaces = null, approvedDefinitions = null) {
  const faceCount = indices ? indices.length / 3 : positions.length / 9;
  const vertexFor = (face, vertex) => indices ? indices[face * 3 + vertex] : face * 3 + vertex;
  const vertexKey = (face, vertex) => {
    const index = vertexFor(face, vertex) * 3;
    return [positions[index], positions[index + 1], positions[index + 2]]
      .map(value => Math.round(value * 1000)).join(':');
  };
  const facesByVertex = new Map();
  for (let face = 0; face < faceCount; face++) {
    if (excludedFaces?.has(face)) continue;
    for (let vertex = 0; vertex < 3; vertex++) {
      const key = vertexKey(face, vertex);
      if (!facesByVertex.has(key)) facesByVertex.set(key, []);
      facesByVertex.get(key).push(face);
    }
  }
  const adjacent = Array.from({ length: faceCount }, () => new Set());
  for (const faces of facesByVertex.values()) {
    for (const face of faces) for (const other of faces) if (face !== other) adjacent[face].add(other);
  }
  const components = [];
  const visited = new Set();
  for (let face = 0; face < faceCount; face++) {
    if (visited.has(face) || excludedFaces?.has(face)) continue;
    const stack = [face];
    const faces = [];
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    visited.add(face);
    while (stack.length) {
      const current = stack.pop();
      faces.push(current);
      for (let vertex = 0; vertex < 3; vertex++) {
        const offset = vertexFor(current, vertex) * 3;
        for (let axis = 0; axis < 3; axis++) {
          const value = positions[offset + axis];
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        }
      }
      for (const other of adjacent[current]) {
        if (visited.has(other)) continue;
        visited.add(other);
        stack.push(other);
      }
    }
    components.push({ faces, min, max });
  }
  const boxGap = (a, b) => {
    const gaps = [0, 1, 2].map(axis => Math.max(0, a.min[axis] - b.max[axis], b.min[axis] - a.max[axis]));
    return Math.hypot(...gaps);
  };
  const paneByFace = new Map();
  const assigned = new Set();
  let paneIndex = 0;
  for (let index = 0; index < components.length; index++) {
    if (assigned.has(index)) continue;
    assigned.add(index);
    const group = [components[index]];
    let closest = -1;
    let closestGap = 0.076;
    for (let other = index + 1; other < components.length; other++) {
      if (assigned.has(other)) continue;
      const gap = boxGap(components[index], components[other]);
      if (gap < closestGap) { closest = other; closestGap = gap; }
    }
    if (closest >= 0) {
      assigned.add(closest);
      group.push(components[closest]);
    }
    const matchingDefinition = approvedDefinitions?.find(definition => group.some(component =>
      component.max.every((value, axis) => value >= definition.min[axis] - 0.02)
      && component.min.every((value, axis) => value <= definition.max[axis] + 0.02)
    ));
    if (approvedDefinitions && !matchingDefinition) continue;
    const paneId = matchingDefinition?.id || `${panePrefix}-${paneIndex++}`;
    for (const component of group) for (const face of component.faces) paneByFace.set(face, paneId);
  }
  return paneByFace;
}

// Walk the scene graph, accumulate every triangle into a flat array in world space.
function nukeDoorIdAt(point) {
  for (const door of NUKE_DOORS) {
    if (point.every((value, axis) => value >= door.min[axis] - 0.002 && value <= door.max[axis] + 0.002)) return door.id;
  }
  return null;
}

function nukeVentIdAt(point) {
  for (const vent of NUKE_VENTS) {
    if (point.every((value, axis) => value >= vent.min[axis] - 0.002 && value <= vent.max[axis] + 0.002)) return vent.id;
  }
  return null;
}

function collectTriangles(doc, mapId = '') {
  const includeNukeDoors = mapId === 'nuke';
  const triangles = [];
  const glassPaneIds = [];
  const doorIds = [];
  const ventIds = [];
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];

  function visit(node, parentMatrix) {
    const worldMatrix = getNodeWorldMatrix(node, parentMatrix);
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const posAttr = prim.getAttribute('POSITION');
        if (!posAttr) continue;
        const positions = posAttr.getArray();
        const indices = prim.getIndices();
        const idx = indices ? indices.getArray() : null;
        const triCount = idx ? idx.length / 3 : positions.length / 9;
        const material = prim.getMaterial();
        const extras = material?.getExtras?.() || {};
        const sourceTexture = String(extras.sourceTexture || material?.getName?.() || '').toLowerCase();
        const glassMaterial = String(extras.footstepSurface || '').toLowerCase() === 'glass'
          || /glass|window/.test(sourceTexture);
        const mirageDefinitions = mapId === 'mirage'
          ? MIRAGE_BREAKABLE_WINDOWS.filter(definition => definition.texture === sourceTexture)
          : null;
        const mirageBreakable = !!mirageDefinitions?.length;
        const ventMaterial = includeNukeDoors && sourceTexture === '{cstrike_oe4ven';
        const excludedDoorFaces = new Set();
        if (glassMaterial && includeNukeDoors) {
          for (let face = 0; face < triCount; face++) {
            const points = [0, 1, 2].map(vertex => {
              const sourceIndex = idx ? idx[face * 3 + vertex] : face * 3 + vertex;
              return mul4x4Vec3(worldMatrix, [positions[sourceIndex * 3], positions[sourceIndex * 3 + 1], positions[sourceIndex * 3 + 2]]);
            });
            const center = [0, 1, 2].map(axis => (points[0][axis] + points[1][axis] + points[2][axis]) / 3);
            if (nukeDoorIdAt(center)) excludedDoorFaces.add(face);
          }
        }
        const panePrefix = mapId === 'nuke'
          ? 'nuke-glass'
          : `${mapId}-breakable-${sourceTexture.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'surface'}`;
        const paneByFace = (glassMaterial || mirageBreakable)
          ? primitiveGlassPaneIds(positions, idx, panePrefix, excludedDoorFaces, mirageBreakable ? mirageDefinitions : null)
          : null;
        for (let t = 0; t < triCount; t++) {
          const i0 = idx ? idx[t * 3] : t * 3;
          const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
          const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
          const v0 = mul4x4Vec3(worldMatrix, [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]]);
          const v1 = mul4x4Vec3(worldMatrix, [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]]);
          const v2 = mul4x4Vec3(worldMatrix, [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]]);
          triangles.push(v0[0], v0[1], v0[2], v1[0], v1[1], v1[2], v2[0], v2[1], v2[2]);
          glassPaneIds.push(paneByFace?.get(t) || null);
          const center = [(v0[0] + v1[0] + v2[0]) / 3, (v0[1] + v1[1] + v2[1]) / 3, (v0[2] + v1[2] + v2[2]) / 3];
          doorIds.push(includeNukeDoors ? nukeDoorIdAt(center) : null);
          ventIds.push(ventMaterial ? nukeVentIdAt(center) : null);
        }
      }
    }
    for (const child of node.listChildren()) visit(child, worldMatrix);
  }

  for (const node of scene.listChildren()) visit(node, IDENTITY);
  return { triangles, glassPaneIds, doorIds, ventIds };
}

// Uniform 2D grid over X/Z so downward raycasts only test triangles in their cell.
function buildSpatialIndex(triangles, cellSize) {
  const triCount = triangles.length / 9;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < triangles.length; i += 9) {
    for (let v = 0; v < 3; v++) {
      const x = triangles[i + v * 3], y = triangles[i + v * 3 + 1], z = triangles[i + v * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  const cols = Math.max(1, Math.ceil((maxX - minX) / cellSize));
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / cellSize));
  const grid = new Array(cols * rows);
  for (let i = 0; i < grid.length; i++) grid[i] = [];

  for (let t = 0; t < triCount; t++) {
    const i = t * 9;
    const v0x = triangles[i], v1x = triangles[i + 3], v2x = triangles[i + 6];
    const v0z = triangles[i + 2], v1z = triangles[i + 5], v2z = triangles[i + 8];
    const tMinX = Math.min(v0x, v1x, v2x), tMaxX = Math.max(v0x, v1x, v2x);
    const tMinZ = Math.min(v0z, v1z, v2z), tMaxZ = Math.max(v0z, v1z, v2z);
    const c0 = Math.max(0, Math.floor((tMinX - minX) / cellSize));
    const c1 = Math.min(cols - 1, Math.floor((tMaxX - minX) / cellSize));
    const r0 = Math.max(0, Math.floor((tMinZ - minZ) / cellSize));
    const r1 = Math.min(rows - 1, Math.floor((tMaxZ - minZ) / cellSize));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) grid[r * cols + c].push(t);
  }
  return { grid, cols, rows, minX, minZ, maxX, maxZ, minY, maxY, cellSize };
}

function groundYAt(triangles, index, x, z, fromY = null, minNormalY = null) {
  const { grid, cols, minX, minZ, cellSize, maxY } = index;
  const c = Math.floor((x - minX) / cellSize);
  const r = Math.floor((z - minZ) / cellSize);
  if (c < 0 || r < 0 || c >= cols || r >= index.rows) return null;
  const cell = grid[r * cols + c];
  if (!cell.length) return null;
  const startY = fromY != null ? fromY : (maxY + 100);
  const orig = [x, startY, z];
  const dir = [0, -1, 0];
  let bestT = Infinity, bestY = null;
  for (const t of cell) {
    const i = t * 9;
    const v0 = [triangles[i], triangles[i + 1], triangles[i + 2]];
    const v1 = [triangles[i + 3], triangles[i + 4], triangles[i + 5]];
    const v2 = [triangles[i + 6], triangles[i + 7], triangles[i + 8]];
    if (minNormalY != null) {
      const ax = v1[0] - v0[0], ay = v1[1] - v0[1], az = v1[2] - v0[2];
      const bx = v2[0] - v0[0], by = v2[1] - v0[1], bz = v2[2] - v0[2];
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const normalLength = Math.hypot(nx, ny, nz);
      if (!normalLength || ny / normalLength <= minNormalY) continue;
    }
    const hit = rayTriangle(orig, dir, v0, v1, v2);
    if (hit !== null && hit < bestT) { bestT = hit; bestY = orig[1] + dir[1] * hit; }
  }
  return bestY;
}

// True if the segment (a)→(b) hits any triangle. Used for optional LOS checks.
function segmentBlocked(triangles, index, glassPaneIds, ignoredGlassPanes, doorIds, ignoredDoors, ventIds, ignoredVents, ax, ay, az, bx, by, bz) {
  const { grid, cols, rows, minX, minZ, cellSize } = index;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (segLen < 1e-6) return false;
  const orig = [ax, ay, az];
  const dir = [dx / segLen, dy / segLen, dz / segLen];
  const c0 = Math.max(0, Math.min(cols - 1, Math.floor((ax - minX) / cellSize)));
  const c1 = Math.max(0, Math.min(cols - 1, Math.floor((bx - minX) / cellSize)));
  const r0 = Math.max(0, Math.min(rows - 1, Math.floor((az - minZ) / cellSize)));
  const r1 = Math.max(0, Math.min(rows - 1, Math.floor((bz - minZ) / cellSize)));
  const cMin = Math.min(c0, c1), cMax = Math.max(c0, c1);
  const rMin = Math.min(r0, r1), rMax = Math.max(r0, r1);
  const seen = new Set();
  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      const cell = grid[r * cols + c];
      for (const t of cell) {
        if (seen.has(t)) continue;
        seen.add(t);
        if (glassPaneIds[t] && ignoredGlassPanes?.has?.(glassPaneIds[t])) continue;
        if (doorIds[t] && ignoredDoors?.has?.(doorIds[t])) continue;
        if (ventIds[t] && ignoredVents?.has?.(ventIds[t])) continue;
        const i = t * 9;
        const v0 = [triangles[i], triangles[i + 1], triangles[i + 2]];
        const v1 = [triangles[i + 3], triangles[i + 4], triangles[i + 5]];
        const v2 = [triangles[i + 6], triangles[i + 7], triangles[i + 8]];
        const hit = rayTriangle(orig, dir, v0, v1, v2);
        if (hit !== null && hit <= segLen * 0.9) return true;
      }
    }
  }
  return false;
}

// Loads the GLB at the same scale as the browser and returns a small ground/LOS
// API. @gltf-transform/core is ESM-only, so it is loaded dynamically.
async function loadMapCollision(glbAbsPath, mapScale = MAP_SCALE) {
  const { NodeIO } = await import('@gltf-transform/core');
  const doc = await new NodeIO().readBinary(fs.readFileSync(glbAbsPath));
  const mapId = path.basename(glbAbsPath).match(/^de_([a-z0-9_]+)\.glb$/i)?.[1]?.toLowerCase() || '';
  const collected = collectTriangles(doc, mapId);
  const tris = new Float64Array(collected.triangles.length);
  for (let i = 0; i < collected.triangles.length; i++) tris[i] = collected.triangles[i] * mapScale;
  const cellScale = mapScale / MAP_SCALE;
  const groundIndex = buildSpatialIndex(tris, GROUND_CELL * cellScale);
  const losIndex = buildSpatialIndex(tris, LOS_CELL * cellScale);
  return {
    groundY: (x, z, fromY = null) => groundYAt(tris, groundIndex, x, z, fromY),
    walkableGroundY: (x, z, fromY = null) => groundYAt(tris, groundIndex, x, z, fromY, 0.65),
    blocked: (ax, ay, az, bx, by, bz, options = {}) => segmentBlocked(
      tris,
      losIndex,
      collected.glassPaneIds,
      options.ignoredGlassPanes,
      collected.doorIds,
      options.ignoredDoors,
      collected.ventIds,
      options.ignoredVents,
      ax, ay, az, bx, by, bz
    ),
    onLadder: (x, y, z, padding = 10) => NUKE_LADDERS.some(ladder => {
      const p = Math.max(0, Number(padding) || 0);
      return x >= ladder.min[0] * mapScale - p && x <= ladder.max[0] * mapScale + p
        && y >= ladder.min[1] * mapScale - p && y <= ladder.max[1] * mapScale + p + 18
        && z >= ladder.min[2] * mapScale - p && z <= ladder.max[2] * mapScale + p;
    }),
    glassPaneIds: [...new Set(collected.glassPaneIds.filter(Boolean))],
    doorIds: [...new Set(collected.doorIds.filter(Boolean))],
    ventIds: [...new Set(collected.ventIds.filter(Boolean))],
    triCount: tris.length / 9,
    bounds: {
      minX: groundIndex.minX, maxX: groundIndex.maxX,
      minZ: groundIndex.minZ, maxZ: groundIndex.maxZ,
      minY: groundIndex.minY, maxY: groundIndex.maxY
    }
  };
}

module.exports = { loadMapCollision, MAP_SCALE };
