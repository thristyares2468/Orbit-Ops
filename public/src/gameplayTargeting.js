export function nearestLivingTarget(players, snapshots, selfId, maximumRange) {
  const range = Number(maximumRange);
  if (!Number.isFinite(range) || range <= 0) return null;
  const local = snapshots.get(selfId);
  if (!local) return null;
  let nearest = null;
  let best = Number.POSITIVE_INFINITY;
  for (const player of players ?? []) {
    if (player.id === selfId || !player.alive) continue;
    const snapshot = snapshots.get(player.id);
    if (!snapshot || snapshot.alive === false) continue;
    const distance = Math.hypot(local.x - snapshot.x, local.z - snapshot.z);
    if (distance <= range && distance < best) {
      nearest = player;
      best = distance;
    }
  }
  return nearest;
}

export function nearestRoleTarget({
  targeting, local, incidents = [], players = [], snapshots, selfId, maximumRange
}) {
  const reach = Number(maximumRange);
  if (!local || !Number.isFinite(reach) || reach <= 0) return null;
  const candidates = targeting === "incident"
    ? incidents.map((incident) => ({ value: incident, position: incident }))
    : targeting === "player"
      ? players
        .filter((player) => player.id !== selfId)
        .map((player) => ({ value: player, position: snapshots?.get?.(player.id) }))
        .filter(({ position }) => position && position.alive !== false)
      : [];
  let nearest = null;
  let best = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const gap = Math.hypot(local.x - candidate.position.x, local.z - candidate.position.z);
    if (gap <= reach && gap < best) {
      nearest = candidate.value;
      best = gap;
    }
  }
  return nearest;
}
