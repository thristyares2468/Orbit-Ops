// Maps a WASD key press to the vent exit it should hop to.
//
// The server assigns each exit on a loop its own W/A/S/D key (see assignVentKeys in
// gameServer.js) and sends it as exit.direction. Keys are unique within a loop, so
// this side is a plain lookup rather than a geometric guess - which matters because
// two exits can genuinely lie in the same compass direction (from the Cafeteria vent
// both Admin and the Hallway are south), and any nearest-direction scheme would leave
// one of them unreachable by keyboard.

export const VENT_DIRECTION_KEYS = Object.freeze([
  Object.freeze({ code: "KeyW", direction: "W" }),
  Object.freeze({ code: "KeyS", direction: "S" }),
  Object.freeze({ code: "KeyA", direction: "A" }),
  Object.freeze({ code: "KeyD", direction: "D" })
]);

export function ventExitForDirection(exits, direction) {
  if (!Array.isArray(exits) || !direction) return null;
  return exits.find((exit) => exit?.direction === direction) ?? null;
}
