import { FACTIONS, TARGETING, WIN_KINDS, defineRole } from "./defineRole.js";

const ICON_ROOT = "/assets/town-of-us/roles";
const icon = (name) => `${ICON_ROOT}/${name}.png`;

// ---------------------------------------------------------------------------
// Crew
// ---------------------------------------------------------------------------

export const CREW_ROLES = [
  defineRole({
    id: "operations-crew",
    name: "Operations Crew",
    faction: FACTIONS.CREW,
    colour: "#74e5ff",
    objective: "Complete assignments, repair the ship, and identify every Operative.",
    ability: null
  }),
  defineRole({
    id: "engineer",
    name: "Engineer",
    faction: FACTIONS.CREW,
    colour: "#ff954f",
    objective: "Maintain critical systems and remotely resolve one sabotage.",
    ability: {
      id: "remote-repair",
      label: "Repair",
      icon: icon("engineer"),
      targeting: TARGETING.NONE,
      cooldownMs: 25_000,
      uses: 1,
      requires: ({ room }) => (room.activeSabotage ? null : "No sabotage currently needs an Engineer."),
      perform: ({ api, room, player }) => {
        api.resolveSabotage(player, { engineerFix: true });
        return { effect: "remote-repair" };
      }
    }
  }),
  defineRole({
    id: "medic",
    name: "Medic",
    faction: FACTIONS.CREW,
    colour: "#34e59a",
    objective: "Shield one nearby crewmate from the next elimination attempt.",
    ability: {
      id: "shield",
      label: "Shield",
      icon: icon("medic"),
      targeting: TARGETING.PLAYER,
      cooldownMs: 15_000,
      uses: 1,
      perform: ({ state, target }) => {
        state.shieldTargetId = target.id;
        return { effect: "shield", targetId: target.id };
      }
    }
  }),
  defineRole({
    id: "sheriff",
    name: "Sheriff",
    faction: FACTIONS.CREW,
    colour: "#ffd34e",
    objective: "Eliminate an Operative—but firing on an innocent eliminates you.",
    ability: {
      id: "sheriff-shot",
      label: "Shoot",
      icon: icon("sheriff"),
      targeting: TARGETING.PLAYER,
      cooldownMs: 22_000,
      uses: null,
      perform: ({ api, player, target }) => {
        if (target.faction === FACTIONS.OPERATIVE) {
          api.eliminate(player, target, "sheriff intervention", { ignoreFaction: true });
          return { effect: "sheriff-hit", targetId: target.id };
        }
        // Firing on the innocent kills the Sheriff instead.
        api.eliminate(player, player, "sheriff misfire", { ignoreFaction: true, ignoreProtection: true });
        return { effect: "sheriff-misfire", targetId: target.id };
      }
    }
  }),
  defineRole({
    id: "tracker",
    name: "Tracker",
    faction: FACTIONS.CREW,
    colour: "#8ce46b",
    objective: "Follow one crewmate's movement for a short window.",
    ability: {
      id: "track",
      label: "Track",
      icon: icon("tracker"),
      targeting: TARGETING.PLAYER,
      cooldownMs: 25_000,
      uses: null,
      perform: ({ state, target, now }) => {
        state.trackedTargetId = target.id;
        state.activeUntil = now + 20_000;
        return { effect: "track", targetId: target.id };
      }
    }
  }),
  // --- Town Of Us R, first wave ---
  defineRole({
    id: "detective",
    name: "Detective",
    faction: FACTIONS.CREW,
    colour: "#3f67c9",
    objective: "Examine a body to learn how recently its owner was killed.",
    ability: {
      id: "examine",
      label: "Examine",
      icon: icon("detective"),
      targeting: TARGETING.INCIDENT,
      cooldownMs: 20_000,
      uses: null,
      perform: ({ api, incident, now }) => {
        const age = Math.round((now - incident.createdAt) / 1000);
        api.reportPrivately({
          type: "forensics",
          detail: `${incident.victimName} was killed about ${age}s ago in ${incident.roomId.replaceAll("-", " ")}.`
        });
        return { effect: "examine", targetId: incident.id };
      }
    }
  }),
  defineRole({
    id: "investigator",
    name: "Investigator",
    faction: FACTIONS.CREW,
    colour: "#6fd3c4",
    objective: "Inspect a crewmate to learn whether they have blood on their hands.",
    ability: {
      id: "inspect",
      label: "Inspect",
      icon: icon("investigator"),
      targeting: TARGETING.PLAYER,
      cooldownMs: 25_000,
      uses: null,
      perform: ({ api, target }) => {
        // Deliberately not a role reveal: it reports on deeds, not identity.
        const guilty = target.matchStats.eliminations > 0;
        api.reportPrivately({
          type: "inspection",
          detail: guilty
            ? `${target.displayName} has eliminated someone this match.`
            : `${target.displayName} has not eliminated anyone.`
        });
        return { effect: "inspect", targetId: target.id };
      }
    }
  }),
  defineRole({
    id: "mayor",
    name: "Mayor",
    faction: FACTIONS.CREW,
    colour: "#e0b64f",
    objective: "Your vote counts twice once the crew knows to trust you.",
    ability: null,
    state: { voteWeight: 2 }
  }),
  defineRole({
    id: "vigilante",
    name: "Vigilante",
    faction: FACTIONS.CREW,
    colour: "#d9575f",
    objective: "Execute one suspect during a meeting—wrongly, and you fall with them.",
    ability: {
      id: "execute",
      label: "Execute",
      icon: icon("sheriff"),
      targeting: TARGETING.PLAYER,
      cooldownMs: 0,
      uses: 1,
      requires: ({ room, api }) => (api.inMeeting(room) ? null : "The Vigilante only fires during a meeting."),
      perform: ({ api, player, target }) => {
        if (target.faction === FACTIONS.CREW) {
          api.eliminate(player, player, "vigilante remorse", { ignoreFaction: true, ignoreProtection: true });
          return { effect: "vigilante-misfire", targetId: target.id };
        }
        api.eliminate(player, target, "vigilante execution", { ignoreFaction: true });
        return { effect: "vigilante-hit", targetId: target.id };
      }
    }
  })
];

// ---------------------------------------------------------------------------
// Operatives (Impostors)
// ---------------------------------------------------------------------------

export const OPERATIVE_ROLES = [
  defineRole({
    id: "signal-operative",
    name: "Signal Operative",
    faction: FACTIONS.OPERATIVE,
    colour: "#ff5f6f",
    objective: "Corrupt the mission, isolate the crew, and control the vote.",
    ability: null
  }),
  defineRole({
    id: "morphling",
    name: "Morphling",
    faction: FACTIONS.OPERATIVE,
    colour: "#ff5f6f",
    objective: "Copy a nearby player's appearance for twelve seconds.",
    ability: {
      id: "morph",
      label: "Morph",
      icon: icon("morphling"),
      targeting: TARGETING.PLAYER,
      cooldownMs: 30_000,
      uses: null,
      perform: ({ state, target, now }) => {
        state.morphTargetId = target.id;
        state.activeUntil = now + 12_000;
        return { effect: "morph", targetId: target.id };
      }
    }
  }),
  defineRole({
    id: "swooper",
    name: "Swooper",
    faction: FACTIONS.OPERATIVE,
    colour: "#ff5f6f",
    objective: "Turn invisible for eight seconds.",
    ability: {
      id: "swoop",
      label: "Swoop",
      icon: icon("swooper"),
      targeting: TARGETING.NONE,
      cooldownMs: 28_000,
      uses: null,
      perform: ({ state, now }) => {
        state.activeUntil = now + 8_000;
        return { effect: "swoop" };
      }
    }
  }),
  defineRole({
    id: "janitor",
    name: "Janitor",
    faction: FACTIONS.OPERATIVE,
    colour: "#ff5f6f",
    objective: "Clean away a body before anyone can report it.",
    ability: {
      id: "clean",
      label: "Clean",
      icon: icon("janitor"),
      targeting: TARGETING.INCIDENT,
      cooldownMs: 20_000,
      uses: null,
      perform: ({ api, incident }) => {
        api.removeIncident(incident);
        return { effect: "clean", targetId: incident.id };
      }
    }
  }),
  // --- Town Of Us R, first wave ---
  defineRole({
    id: "blackmailer",
    name: "Blackmailer",
    faction: FACTIONS.OPERATIVE,
    colour: "#ff5f6f",
    objective: "Silence one crewmate for the whole of the next meeting.",
    ability: {
      id: "blackmail",
      label: "Blackmail",
      icon: icon("janitor"),
      targeting: TARGETING.PLAYER,
      cooldownMs: 25_000,
      uses: null,
      perform: ({ state, target }) => {
        state.blackmailedId = target.id;
        return { effect: "blackmail", targetId: target.id };
      }
    },
    state: { blackmailedId: null }
  }),
  defineRole({
    id: "escapist",
    name: "Escapist",
    faction: FACTIONS.OPERATIVE,
    colour: "#ff5f6f",
    objective: "Mark a spot, then vanish back to it when the crew closes in.",
    ability: {
      id: "escape",
      label: "Escape",
      icon: icon("swooper"),
      targeting: TARGETING.NONE,
      cooldownMs: 20_000,
      uses: null,
      perform: ({ api, state, player }) => {
        if (!state.markX && state.markX !== 0) {
          state.markX = player.position.x;
          state.markZ = player.position.z;
          return { effect: "escape-mark" };
        }
        api.teleport(player, { x: state.markX, z: state.markZ });
        state.markX = null;
        state.markZ = null;
        return { effect: "escape-return" };
      }
    },
    state: { markX: null, markZ: null }
  })
];

// ---------------------------------------------------------------------------
// Neutrals
// ---------------------------------------------------------------------------

export const NEUTRAL_ROLES = [
  defineRole({
    id: "jester",
    name: "Jester",
    faction: FACTIONS.NEUTRAL,
    colour: "#ff72dd",
    objective: "Convince the crew to vote you out.",
    ability: null,
    win: { kind: WIN_KINDS.VOTED_OUT, solo: true }
  }),
  defineRole({
    id: "survivor",
    name: "Survivor",
    faction: FACTIONS.NEUTRAL,
    colour: "#d8d6a1",
    objective: "Stay alive until another faction ends the match.",
    ability: {
      id: "vest",
      label: "Vest",
      icon: icon("survivor"),
      targeting: TARGETING.NONE,
      cooldownMs: 24_000,
      uses: 2,
      perform: ({ state, now }) => {
        state.protectedUntil = now + 8_000;
        state.activeUntil = state.protectedUntil;
        return { effect: "vest" };
      }
    },
    win: { kind: WIN_KINDS.SURVIVE }
  }),
  defineRole({
    id: "guardian-angel",
    name: "Guardian Angel",
    faction: FACTIONS.NEUTRAL,
    colour: "#9defff",
    objective: "Shield the living from beyond the grave.",
    ability: {
      id: "guardian-shield",
      label: "Protect",
      icon: icon("medic"),
      targeting: TARGETING.PLAYER,
      cooldownMs: 40_000,
      uses: null,
      perform: ({ api, target, now }) => {
        api.protect(target, now + 15_000);
        return { effect: "guardian-shield", targetId: target.id };
      }
    },
    win: { kind: WIN_KINDS.SURVIVE }
  }),
  // --- Town Of Us R, first wave ---
  defineRole({
    id: "executioner",
    name: "Executioner",
    faction: FACTIONS.NEUTRAL,
    colour: "#b07d3f",
    objective: "Get your assigned target voted out—by any means.",
    ability: null,
    win: { kind: WIN_KINDS.TARGET_VOTED_OUT, solo: true },
    state: { executionerTargetId: null }
  }),
  defineRole({
    id: "amnesiac",
    name: "Amnesiac",
    faction: FACTIONS.NEUTRAL,
    colour: "#c7c7d6",
    objective: "Remember who you were by finding a body and taking its role.",
    ability: {
      id: "remember",
      label: "Remember",
      icon: icon("survivor"),
      targeting: TARGETING.INCIDENT,
      cooldownMs: 0,
      uses: 1,
      perform: ({ api, incident }) => {
        api.becomeRoleOf(incident.victimId);
        return { effect: "remember", targetId: incident.id };
      }
    },
    win: { kind: WIN_KINDS.SURVIVE }
  })
];

export const ALL_ROLES = Object.freeze([...CREW_ROLES, ...OPERATIVE_ROLES, ...NEUTRAL_ROLES]);
