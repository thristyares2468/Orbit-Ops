function publicRuntimeVent(value) {
  const id = typeof value?.id === "string" ? value.id.slice(0, 80) : "";
  const x = Number(value?.x);
  const z = Number(value?.z);
  if (!id || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  return Object.freeze({
    id,
    type: "maintenance",
    refId: typeof value.refId === "string" ? value.refId.slice(0, 80) : "vent-mined",
    roomId: typeof value.roomId === "string" ? value.roomId.slice(0, 80) : null,
    label: typeof value.label === "string" ? value.label.slice(0, 80) : "Mined vent",
    x,
    z,
    range: Number.isFinite(Number(value.range)) ? Number(value.range) : undefined
  });
}

export function normaliseVentTopology(value = {}) {
  const minedById = new Map();
  for (const candidate of Array.isArray(value?.minedVents) ? value.minedVents : []) {
    const vent = publicRuntimeVent(candidate);
    if (vent) minedById.set(vent.id, vent);
  }
  const sealedVentIds = [...new Set((Array.isArray(value?.sealedVentIds) ? value.sealedVentIds : [])
    .filter((id) => typeof id === "string" && id)
    .map((id) => id.slice(0, 80)))];
  return Object.freeze({
    minedVents: Object.freeze([...minedById.values()]),
    sealedVentIds: Object.freeze(sealedVentIds)
  });
}

export function addMinedVent(topology, candidate) {
  const current = normaliseVentTopology(topology);
  return normaliseVentTopology({
    minedVents: [...current.minedVents, candidate],
    sealedVentIds: current.sealedVentIds
  });
}

export function sealVent(topology, ventId) {
  const current = normaliseVentTopology(topology);
  return normaliseVentTopology({
    minedVents: current.minedVents,
    sealedVentIds: [...current.sealedVentIds, ventId]
  });
}

export function usableRuntimeVents(topology) {
  const current = normaliseVentTopology(topology);
  const sealed = new Set(current.sealedVentIds);
  return current.minedVents.filter(({ id }) => !sealed.has(id));
}

export function ventIsSealed(topology, ventId) {
  return normaliseVentTopology(topology).sealedVentIds.includes(ventId);
}
