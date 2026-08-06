// Picks which vent exit a WASD press should hop to, given where the player is
// currently vented and the direction they pressed. Pure and DOM-free so it can be
// unit tested directly, and reused by the client's key handling.
//
// A vent loop only ever offers one or two exits (the Skeld's biggest loop has two),
// so "navigate with WASD" means: press the direction the exit you want lies in. The
// exit whose bearing from the current vent is closest to the pressed direction wins,
// as long as it clears a minimum alignment - otherwise a lone exit sitting off to the
// side would fire on every unrelated key press.

const MIN_ALIGNMENT = 0.35; // cos(~70 degrees): loose enough for diagonal corridors

export function pickVentExit(currentPosition, exits, direction) {
  if (!currentPosition || !direction || !Array.isArray(exits) || exits.length === 0) return null;
  const dirLength = Math.hypot(direction.x, direction.z);
  if (dirLength < 1e-6) return null;
  const dx = direction.x / dirLength;
  const dz = direction.z / dirLength;

  let best = null;
  let bestScore = -Infinity;
  for (const exit of exits) {
    const ex = exit.x - currentPosition.x;
    const ez = exit.z - currentPosition.z;
    const exitLength = Math.hypot(ex, ez);
    // The current vent and an exit should never coincide, but guard against it
    // rather than divide by zero if map data is ever malformed.
    if (exitLength < 1e-6) continue;
    const score = (ex / exitLength) * dx + (ez / exitLength) * dz;
    if (score > bestScore) {
      bestScore = score;
      best = exit;
    }
  }
  return bestScore >= MIN_ALIGNMENT ? best : null;
}

// WASD -> world-space direction, matching InputController.movement()'s convention
// (x: D minus A, z: S minus W).
export const VENT_DIRECTION_KEYS = Object.freeze([
  Object.freeze({ code: "KeyW", x: 0, z: -1 }),
  Object.freeze({ code: "KeyS", x: 0, z: 1 }),
  Object.freeze({ code: "KeyA", x: -1, z: 0 }),
  Object.freeze({ code: "KeyD", x: 1, z: 0 })
]);
