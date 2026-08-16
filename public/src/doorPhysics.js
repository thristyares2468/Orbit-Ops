function insideBarrier(point, door, margin) {
  return point.x >= door.x - door.width / 2 - margin
    && point.x <= door.x + door.width / 2 + margin
    && point.z >= door.z - door.depth / 2 - margin
    && point.z <= door.z + door.depth / 2 + margin;
}

function segmentIntersectsBarrier(from, to, door, margin) {
  const minX = door.x - door.width / 2 - margin;
  const maxX = door.x + door.width / 2 + margin;
  const minZ = door.z - door.depth / 2 - margin;
  const maxZ = door.z + door.depth / 2 + margin;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  let low = 0;
  let high = 1;
  for (const [origin, delta, min, max] of [[from.x, dx, minX, maxX], [from.z, dz, minZ, maxZ]]) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < min || origin > max) return false;
      continue;
    }
    const first = (min - origin) / delta;
    const second = (max - origin) / delta;
    low = Math.max(low, Math.min(first, second));
    high = Math.min(high, Math.max(first, second));
    if (low > high) return false;
  }
  return true;
}

export function doorById(map, doorId) {
  return map?.doorIndex?.get?.(doorId)
    ?? map?.doorGroups?.flatMap((group) => group.doors ?? []).find((door) => door.id === doorId)
    ?? null;
}

export function closedDoorBarriers(map, sabotage) {
  if (!map || !Array.isArray(sabotage?.closedDoorIds)) return [];
  return sabotage.closedDoorIds.map((id) => doorById(map, id)).filter(Boolean);
}

// A door that closes on top of a player must let them step clear. Every other
// path that enters or crosses the expanded shutter rectangle is rejected.
export function doorStepAllowed(map, sabotage, from, to, margin = 0.55) {
  if (!from || !to) return true;
  for (const door of closedDoorBarriers(map, sabotage)) {
    if (insideBarrier(from, door, margin)) continue;
    if (insideBarrier(to, door, margin) || segmentIntersectsBarrier(from, to, door, margin)) return false;
  }
  return true;
}
