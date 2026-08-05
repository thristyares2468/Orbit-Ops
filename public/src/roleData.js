import { buildRegistry, idsForFaction } from "./roles/defineRole.js";
import { ALL_ROLES, CREW_ROLES, NEUTRAL_ROLES, OPERATIVE_ROLES } from "./roles/catalogue.js";

// Roles are declared in ./roles/catalogue.js. This module stays the stable public
// surface the rest of the game imports from.
export const ROLE_DEFINITIONS = buildRegistry(ALL_ROLES);

export const CREW_ROLE_IDS = Object.freeze(CREW_ROLES.map((role) => role.id));
export const OPERATIVE_ROLE_IDS = Object.freeze(OPERATIVE_ROLES.map((role) => role.id));
export const NEUTRAL_ROLE_IDS = Object.freeze(NEUTRAL_ROLES.map((role) => role.id));
export const PRACTICE_ROLE_IDS = Object.freeze([
  ...CREW_ROLE_IDS,
  ...OPERATIVE_ROLE_IDS,
  ...NEUTRAL_ROLE_IDS
]);

export function getRoleDefinition(roleId) {
  return ROLE_DEFINITIONS[roleId] ?? ROLE_DEFINITIONS["operations-crew"];
}

export function roleIdsForFaction(faction) {
  if (faction === "operative") return OPERATIVE_ROLE_IDS;
  if (faction === "neutral") return NEUTRAL_ROLE_IDS;
  return CREW_ROLE_IDS;
}

export { idsForFaction };
