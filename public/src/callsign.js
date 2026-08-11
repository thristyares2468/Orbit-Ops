// The callsign a guest starts with.
//
// The field used to be hard-coded to "Explorer-071", so every guest arrived under
// the same name and a lobby of guests was a wall of identical callsigns. The shape
// is kept - one word, a dash, three digits - so it still reads like a crew
// designation; only the word and the number are drawn fresh each visit.
//
// Every result is well inside the 2-22 characters validateDisplayName allows: the
// longest word here is 8 characters, so the longest callsign is 12.

const WORDS = Object.freeze([
  // crew roles aboard a survey ship
  "Explorer", "Drifter", "Voyager", "Ranger", "Scout", "Pilot", "Rigger",
  "Welder", "Loader", "Cutter", "Marshal", "Courier", "Runner", "Keeper",
  // the sky the Meridian is flying through
  "Comet", "Nova", "Quasar", "Pulsar", "Nebula", "Meteor", "Aurora", "Zenith",
  "Vega", "Rigel", "Altair", "Lyra", "Corvus", "Draco", "Orion", "Atlas",
  // hardware and signals
  "Beacon", "Vector", "Lumen", "Ember", "Cinder", "Tether", "Ballast", "Piston"
]);

// crypto when it is there, Math.random otherwise: this only needs to look varied,
// not to be unguessable.
function pick(count) {
  const source = globalThis.crypto;
  if (source?.getRandomValues) {
    const buffer = new Uint32Array(1);
    source.getRandomValues(buffer);
    return buffer[0] % count;
  }
  return Math.floor(Math.random() * count);
}

export function randomCallsign() {
  return `${WORDS[pick(WORDS.length)]}-${String(pick(1000)).padStart(3, "0")}`;
}
