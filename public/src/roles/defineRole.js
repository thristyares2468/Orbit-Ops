// Role framework.
//
// Town Of Us R carries roughly sixty roles across three factions plus modifiers, so
// roles are declared as data rather than branched on by id. A role owns four things:
//
//   ability  what it can do, how often, and against what
//   win      whether it wins on its own terms instead of with a faction
//   hooks    reactions to match events (a kill, a vote, a meeting)
//   modifier flags that alter another role rather than replacing it
//
// The ability's `perform` runs on the server against a context that exposes only the
// operations a role legitimately needs, so a role can never reach past the rules.

export const FACTIONS = Object.freeze({ CREW: "crew", OPERATIVE: "operative", NEUTRAL: "neutral" });

export const TARGETING = Object.freeze({
  NONE: "none",
  PLAYER: "player",
  INCIDENT: "incident",
  SELF: "self"
});

// Neutral roles each win on their own terms; these describe when.
export const WIN_KINDS = Object.freeze({
  WITH_FACTION: "with-faction",
  VOTED_OUT: "voted-out",
  TARGET_VOTED_OUT: "target-voted-out",
  SURVIVE: "survive",
  LAST_STANDING: "last-standing"
});

function frozenAbility(ability) {
  if (!ability) return null;
  return Object.freeze({
    id: ability.id,
    label: ability.label,
    icon: ability.icon ?? null,
    targeting: ability.targeting ?? TARGETING.NONE,
    cooldownMs: ability.cooldownMs ?? 20_000,
    // null means unlimited; a number is a hard cap for the match.
    uses: ability.uses ?? null,
    // Server-side effect. Receives a context, returns { effect, targetId }.
    perform: ability.perform ?? null,
    // Optional guard run before cooldown is spent, so a refused action costs nothing.
    requires: ability.requires ?? null
  });
}

export function defineRole(role) {
  if (!role?.id) throw new Error("A role needs an id.");
  if (!Object.values(FACTIONS).includes(role.faction)) {
    throw new Error(`Role ${role.id} has an unknown faction: ${role.faction}`);
  }
  return Object.freeze({
    id: role.id,
    name: role.name,
    faction: role.faction,
    // Town Of Us groups roles inside a faction; kept for role-quota settings.
    alignment: role.alignment ?? role.faction,
    colour: role.colour ?? "#74e5ff",
    objective: role.objective ?? "",
    ability: frozenAbility(role.ability),
    win: Object.freeze({
      kind: role.win?.kind ?? WIN_KINDS.WITH_FACTION,
      // Optional predicate for roles whose victory is more than a simple kind.
      check: role.win?.check ?? null,
      // A role that wins alone ends the match for everyone else.
      solo: Boolean(role.win?.solo)
    }),
    hooks: Object.freeze({
      onEliminated: role.hooks?.onEliminated ?? null,
      onVotedOut: role.hooks?.onVotedOut ?? null,
      onMeetingStart: role.hooks?.onMeetingStart ?? null,
      onMatchStart: role.hooks?.onMatchStart ?? null
    }),
    // Extra per-player state this role needs, merged into roleState at assignment.
    state: Object.freeze({ ...(role.state ?? {}) }),
    modifier: Boolean(role.modifier)
  });
}

export function buildRegistry(roles) {
  const registry = {};
  for (const role of roles) {
    if (registry[role.id]) throw new Error(`Duplicate role id: ${role.id}`);
    registry[role.id] = role;
  }
  return Object.freeze(registry);
}

export function idsForFaction(registry, faction) {
  return Object.freeze(Object.values(registry)
    .filter((role) => role.faction === faction && !role.modifier)
    .map((role) => role.id));
}
