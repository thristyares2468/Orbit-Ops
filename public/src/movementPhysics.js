// Shared movement arithmetic for the browser predictor and authoritative server.
// Keeping the speed and slide rules here prevents the client from feeling fast
// locally and then being corrected simply because the two simulations disagree.
export const PLAYER_SPEED = Object.freeze({ walk: 7.25, crouch: 2.6 });

export function playerMovementSpeed(input, faction, settings, alive = true) {
  const base = input?.crouch ? PLAYER_SPEED.crouch : PLAYER_SPEED.walk;
  const factionScale = faction === "operative"
    ? Number(settings?.operativeSpeed ?? 1)
    : Number(settings?.crewSpeed ?? 1);
  return base * factionScale * (alive === false ? 1.2 : 1);
}

export function movementAnimation(input) {
  if (input?.crouch) return "crouch";
  return Math.hypot(Number(input?.x) || 0, Number(input?.z) || 0) < 0.05 ? "idle" : "walk";
}

export function advancePlayerPosition({
  position,
  input,
  delta,
  faction,
  settings,
  alive = true,
  isPositionValid,
  bounds
}) {
  const speed = playerMovementSpeed(input, faction, settings, alive);
  const next = {
    x: Number(position.x) + (Number(input?.x) || 0) * speed * delta,
    z: Number(position.z) + (Number(input?.z) || 0) * speed * delta
  };
  if (alive === false) {
    return {
      x: Math.max(bounds.minX, Math.min(bounds.maxX, next.x)),
      z: Math.max(bounds.minZ, Math.min(bounds.maxZ, next.z))
    };
  }
  if (isPositionValid(next.x, next.z)) return next;
  const slideX = { x: next.x, z: Number(position.z) };
  if (isPositionValid(slideX.x, slideX.z)) return slideX;
  const slideZ = { x: Number(position.x), z: next.z };
  if (isPositionValid(slideZ.x, slideZ.z)) return slideZ;
  return { x: Number(position.x), z: Number(position.z) };
}
