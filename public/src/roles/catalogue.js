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
    objective: "Maintain critical systems, ride the vents, and remotely resolve one sabotage.",
    // The Engineer is the one Crew role that shares the Operatives' vent network.
    capabilities: { canVent: true },
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
    // It fires across the meeting table, so it acts outside the active phase and
    // without walking up to anyone.
    capabilities: { actsInMeeting: true, ignoresAbilityRange: true },
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
  }),
  defineRole({
    id: "aurial",
    name: "Aurial",
    faction: FACTIONS.CREW,
    colour: "#c58cff",
    objective: "Read the distortion an Operative leaves in the air.",
    ability: {
      id: "sense", label: "Sense", icon: icon("investigator"),
      targeting: TARGETING.NONE, cooldownMs: 20_000, uses: null,
      perform: ({ api, room, player }) => {
        const nearest = [...room.players.values()]
          .filter((c) => c.alive && c.id !== player.id && c.faction === FACTIONS.OPERATIVE)
          .map((c) => Math.hypot(c.position.x - player.position.x, c.position.z - player.position.z))
          .sort((a, b) => a - b)[0];
        api.reportPrivately({
          type: "distortion",
          detail: nearest === undefined
            ? "The air is still. No Operative draws breath."
            : nearest < 12 ? "The air is screaming. One is very close."
            : nearest < 30 ? "A tremor. Something moves a few rooms away."
            : "A faint ripple, far off."
        });
        return { effect: "sense" };
      }
    }
  }),
  defineRole({
    id: "seer",
    name: "Seer",
    faction: FACTIONS.CREW,
    colour: "#ffe08a",
    objective: "Look into someone and see which side they stand on.",
    ability: {
      id: "reveal", label: "Reveal", icon: icon("investigator"),
      targeting: TARGETING.PLAYER, cooldownMs: 30_000, uses: null,
      perform: ({ api, target }) => {
        // Alignment only - never the role itself.
        api.reportPrivately({
          type: "vision",
          detail: target.faction === FACTIONS.CREW
            ? `${target.displayName} shines clean.`
            : `${target.displayName} is shrouded.`
        });
        return { effect: "reveal", targetId: target.id };
      }
    }
  }),
  defineRole({
    id: "mystic",
    name: "Mystic",
    faction: FACTIONS.CREW,
    colour: "#9ad8ff",
    objective: "Feel it the moment a soul leaves the ship.",
    ability: null,
    hooks: {
      onEliminated: ({ api, victim }) => {
        api.reportPrivately({
          type: "premonition",
          detail: `A soul just left us, somewhere near ${victim.currentRoom.replaceAll("-", " ")}.`
        });
      }
    }
  }),
  defineRole({
    id: "cleric",
    name: "Cleric",
    faction: FACTIONS.CREW,
    colour: "#7fe3c0",
    objective: "Raise a barrier that turns aside the next blow.",
    ability: {
      id: "barrier", label: "Barrier", icon: icon("medic"),
      targeting: TARGETING.PLAYER, cooldownMs: 30_000, uses: null,
      perform: ({ api, target, now }) => {
        api.protect(target, now + 20_000);
        return { effect: "barrier", targetId: target.id };
      }
    }
  }),
  defineRole({
    id: "deputy",
    name: "Deputy",
    faction: FACTIONS.CREW,
    colour: "#c9a06a",
    objective: "Cuff a suspect so they cannot act.",
    ability: {
      id: "cuff", label: "Cuff", icon: icon("sheriff"),
      targeting: TARGETING.PLAYER, cooldownMs: 30_000, uses: 2,
      perform: ({ api, target, now }) => {
        target.roleState = target.roleState ?? {};
        target.roleState.cuffedUntil = now + 20_000;
        api.notify(target);
        return { effect: "cuff", targetId: target.id };
      }
    }
  }),
  defineRole({
    id: "warden",
    name: "Warden",
    faction: FACTIONS.CREW,
    colour: "#8aa6c9",
    objective: "Fortify someone; you will know the instant they are struck.",
    ability: {
      id: "fortify", label: "Fortify", icon: icon("engineer"),
      targeting: TARGETING.PLAYER, cooldownMs: 25_000, uses: null,
      perform: ({ state, target }) => {
        state.fortifiedId = target.id;
        return { effect: "fortify", targetId: target.id };
      }
    },
    state: { fortifiedId: null },
    hooks: {
      onEliminated: ({ api, victim, player }) => {
        if (player.roleState?.fortifiedId !== victim.id) return;
        api.reportPrivately({
          type: "breach",
          detail: `Your fortification on ${victim.displayName} was broken.`
        });
      }
    }
  }),
  defineRole({
    id: "politician",
    name: "Politician",
    faction: FACTIONS.CREW,
    colour: "#e2b56a",
    objective: "Campaign hard enough and the room votes your way.",
    ability: {
      id: "campaign", label: "Campaign", icon: icon("tracker"),
      targeting: TARGETING.PLAYER, cooldownMs: 25_000, uses: null,
      perform: ({ state, target }) => {
        state.campaigned = state.campaigned ?? [];
        if (!state.campaigned.includes(target.id)) state.campaigned.push(target.id);
        // Each successful campaign adds weight to the Politician's own vote.
        state.voteWeight = 1 + state.campaigned.length;
        return { effect: "campaign", targetId: target.id };
      }
    },
    state: { campaigned: [], voteWeight: 1 }
  }),
  defineRole({
    id: "imitator",
    name: "Imitator",
    faction: FACTIONS.CREW,
    colour: "#a8c8e8",
    objective: "Take up the role of someone the ship has already lost.",
    ability: {
      id: "imitate", label: "Imitate", icon: icon("morphling"),
      targeting: TARGETING.INCIDENT, cooldownMs: 0, uses: 1,
      perform: ({ api, incident }) => {
        api.becomeRoleOf(incident.victimId);
        return { effect: "imitate", targetId: incident.id };
      }
    }
  }),
  defineRole({
    id: "jailor",
    name: "Jailor",
    faction: FACTIONS.CREW,
    colour: "#93a4b8",
    objective: "Hold a suspect for the meeting, and execute if you must.",
    ability: {
      id: "jail", label: "Jail", icon: icon("sheriff"),
      targeting: TARGETING.PLAYER, cooldownMs: 30_000, uses: null,
      perform: ({ state, target }) => {
        state.jailedId = target.id;
        return { effect: "jail", targetId: target.id };
      }
    },
    state: { jailedId: null }
  }),
  defineRole({
    id: "lookout",
    name: "Lookout",
    faction: FACTIONS.CREW,
    colour: "#7fd4ff",
    objective: "Watch a crewmate and learn who came near them.",
    ability: {
      id: "watch", label: "Watch", icon: icon("tracker"),
      targeting: TARGETING.PLAYER, cooldownMs: 25_000, uses: null,
      perform: ({ api, room, target }) => {
        const nearby = [...room.players.values()].filter((candidate) =>
          candidate.alive && candidate.id !== target.id
          && Math.hypot(candidate.position.x - target.position.x, candidate.position.z - target.position.z) < 8);
        api.reportPrivately({
          type: "lookout",
          detail: nearby.length
            ? `Near ${target.displayName}: ${nearby.map((c) => c.displayName).join(", ")}.`
            : `${target.displayName} is alone.`
        });
        return { effect: "watch", targetId: target.id };
      }
    }
  }),
  defineRole({
    id: "snitch",
    name: "Snitch",
    faction: FACTIONS.CREW,
    colour: "#ffd98a",
    objective: "Finish your assignments and the Operatives light up.",
    ability: null
  }),
  defineRole({
    id: "spy",
    name: "Spy",
    faction: FACTIONS.CREW,
    colour: "#a0e7c8",
    objective: "Read the deck the way the Operatives do.",
    ability: {
      id: "spy-sweep", label: "Sweep", icon: icon("investigator"),
      targeting: TARGETING.NONE, cooldownMs: 30_000, uses: null,
      perform: ({ api, room, player }) => {
        const others = [...room.players.values()].filter((c) => c.alive && c.id !== player.id);
        api.reportPrivately({
          type: "sweep",
          detail: `${others.filter((c) => c.ventId).length} of ${others.length} are inside the vents right now.`
        });
        return { effect: "spy-sweep" };
      }
    }
  }),
  defineRole({
    id: "trapper",
    name: "Trapper",
    faction: FACTIONS.CREW,
    colour: "#8fb98f",
    objective: "Lay a trap and learn who walks into it.",
    ability: {
      id: "trap", label: "Trap", icon: icon("engineer"),
      targeting: TARGETING.NONE, cooldownMs: 25_000, uses: 3,
      perform: ({ state, player }) => {
        state.traps = state.traps ?? [];
        state.traps.push({ x: player.position.x, z: player.position.z });
        return { effect: "trap" };
      }
    },
    state: { traps: [] }
  }),
  defineRole({
    id: "transporter",
    name: "Transporter",
    faction: FACTIONS.CREW,
    colour: "#b7f7ff",
    objective: "Swap two players' positions and watch the chaos.",
    ability: {
      id: "transport", label: "Transport", icon: icon("tracker"),
      targeting: TARGETING.PLAYER, cooldownMs: 30_000, uses: null,
      perform: ({ api, state, target, room }) => {
        if (!state.transportFirstId) {
          state.transportFirstId = target.id;
          return { effect: "transport-armed", targetId: target.id };
        }
        const first = room.players.get(state.transportFirstId);
        state.transportFirstId = null;
        if (!first || !first.alive) return { effect: "transport-failed", targetId: target.id };
        const spot = { ...first.position };
        api.teleport(first, target.position);
        api.teleport(target, spot);
        return { effect: "transport", targetId: target.id };
      }
    },
    state: { transportFirstId: null }
  }),
  defineRole({
    id: "prosecutor",
    name: "Prosecutor",
    faction: FACTIONS.CREW,
    colour: "#d8a657",
    objective: "Bring one case to trial that nobody can vote down.",
    ability: {
      id: "prosecute", label: "Prosecute", icon: icon("sheriff"),
      targeting: TARGETING.PLAYER, cooldownMs: 0, uses: 1,
      requires: ({ room, api }) => (api.inMeeting(room) ? null : "The Prosecutor only acts during a meeting."),
      perform: ({ api, player, target }) => {
        api.eliminate(player, target, "prosecution", { ignoreFaction: true, ignoreProtection: true });
        return { effect: "prosecute", targetId: target.id };
      }
    }
  }),
  defineRole({
    id: "oracle",
    name: "Oracle",
    faction: FACTIONS.CREW,
    colour: "#c9a7ff",
    objective: "Bless a crewmate; if you fall, the deck learns what they are.",
    ability: {
      id: "bless", label: "Bless", icon: icon("medic"),
      targeting: TARGETING.PLAYER, cooldownMs: 30_000, uses: null,
      perform: ({ state, target }) => {
        state.blessedId = target.id;
        return { effect: "bless", targetId: target.id };
      }
    },
    state: { blessedId: null }
  }),
  defineRole({
    id: "hunter",
    name: "Hunter",
    faction: FACTIONS.CREW,
    colour: "#a3703f",
    objective: "Stalk your quarry and strike when you are certain.",
    ability: {
      id: "hunt", label: "Hunt", icon: icon("sheriff"),
      targeting: TARGETING.PLAYER, cooldownMs: 35_000, uses: 1,
      perform: ({ api, player, target }) => {
        if (target.faction === FACTIONS.CREW) {
          api.eliminate(player, player, "hunter remorse", { ignoreFaction: true, ignoreProtection: true });
          return { effect: "hunt-misfire", targetId: target.id };
        }
        api.eliminate(player, target, "hunted down", { ignoreFaction: true });
        return { effect: "hunt-hit", targetId: target.id };
      }
    }
  }),
  defineRole({
    id: "plumber",
    name: "Plumber",
    faction: FACTIONS.CREW,
    colour: "#6da3c0",
    objective: "Seal a vent so nobody can use it again.",
    ability: {
      id: "seal", label: "Seal", icon: icon("engineer"),
      targeting: TARGETING.NONE, cooldownMs: 30_000, uses: 2,
      perform: ({ api, player }) => {
        api.sealNearestVent(player.position);
        return { effect: "seal" };
      }
    }
  }),
  defineRole({
    id: "altruist",
    name: "Altruist",
    faction: FACTIONS.CREW,
    colour: "#ff8fa3",
    objective: "Revive a body at the cost of your own life.",
    ability: {
      id: "revive",
      label: "Revive",
      icon: icon("medic"),
      targeting: TARGETING.INCIDENT,
      cooldownMs: 0,
      uses: 1,
      perform: ({ api, player, incident }) => {
        api.revive(incident);
        // The revival is paid for with the Altruist's own life.
        api.eliminate(player, player, "altruist sacrifice", { ignoreFaction: true, ignoreProtection: true });
        return { effect: "revive", targetId: incident.id };
      }
    }
  }),
  defineRole({
    id: "medium",
    name: "Medium",
    faction: FACTIONS.CREW,
    colour: "#b08fe0",
    objective: "Ask the dead what they saw.",
    ability: {
      id: "commune",
      label: "Commune",
      icon: icon("tracker"),
      targeting: TARGETING.NONE,
      cooldownMs: 30_000,
      uses: null,
      perform: ({ api, room }) => {
        const ghosts = [...room.players.values()].filter((candidate) => !candidate.alive);
        api.reportPrivately({
          type: "seance",
          detail: ghosts.length
            ? `${ghosts.length} soul${ghosts.length === 1 ? "" : "s"} aboard. Last seen in ${ghosts.at(-1).currentRoom.replaceAll("-", " ")}.`
            : "No souls answer. Nobody has died yet."
        });
        return { effect: "commune" };
      }
    }
  }),
  defineRole({
    id: "veteran",
    name: "Veteran",
    faction: FACTIONS.CREW,
    colour: "#c9a227",
    objective: "Go on alert—anyone who touches you dies.",
    ability: {
      id: "alert",
      label: "Alert",
      icon: icon("sheriff"),
      targeting: TARGETING.NONE,
      cooldownMs: 35_000,
      uses: 3,
      perform: ({ state, now }) => {
        state.alertUntil = now + 10_000;
        state.activeUntil = state.alertUntil;
        return { effect: "alert" };
      }
    },
    state: { alertUntil: 0 }
  }),
  defineRole({
    id: "swapper",
    name: "Swapper",
    faction: FACTIONS.CREW,
    colour: "#59c9a5",
    objective: "Swap two players' votes before the count.",
    ability: {
      id: "swap-votes",
      label: "Swap",
      icon: icon("tracker"),
      targeting: TARGETING.PLAYER,
      cooldownMs: 0,
      uses: 1,
      requires: ({ room, api }) => (api.inMeeting(room) ? null : "The Swapper only works during a meeting."),
      perform: ({ state, target }) => {
        // Two picks: first names one side of the swap, second completes it.
        if (!state.swapFirstId) {
          state.swapFirstId = target.id;
          return { effect: "swap-armed", targetId: target.id };
        }
        state.swapSecondId = target.id;
        return { effect: "swap-set", targetId: target.id };
      }
    },
    state: { swapFirstId: null, swapSecondId: null }
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
  }),
  defineRole({
    id: "eclipsal",
    name: "Eclipsal",
    faction: FACTIONS.OPERATIVE,
    colour: "#ff5f6f",
    objective: "Draw the dark in around you and hunt inside it.",
    ability: {
      id: "eclipse", label: "Eclipse", icon: icon("swooper"),
      targeting: TARGETING.NONE, cooldownMs: 35_000, uses: null,
      perform: ({ api, room, player, now }) => {
        for (const candidate of room.players.values()) {
          if (!candidate.alive || candidate.id === player.id) continue;
          if (candidate.faction === FACTIONS.OPERATIVE) continue;
          if (Math.hypot(candidate.position.x - player.position.x, candidate.position.z - player.position.z) > 18) continue;
          candidate.roleState = candidate.roleState ?? {};
          candidate.roleState.blindedUntil = now + 10_000;
          api.notify(candidate);
        }
        return { effect: "eclipse" };
      }
    }
  }),
  defineRole({
    id: "grenadier",
    name: "Grenadier",
    faction: FACTIONS.OPERATIVE,
    colour: "#ff5f6f",
    objective: "Blind everyone nearby and walk away clean.",
    ability: {
      id: "flash", label: "Flash", icon: icon("swooper"),
      targeting: TARGETING.NONE, cooldownMs: 30_000, uses: null,
      perform: ({ api, room, player, now }) => {
        for (const candidate of room.players.values()) {
          if (!candidate.alive || candidate.id === player.id) continue;
          if (Math.hypot(candidate.position.x - player.position.x, candidate.position.z - player.position.z) > 10) continue;
          candidate.roleState = candidate.roleState ?? {};
          candidate.roleState.blindedUntil = now + 8_000;
          api.notify(candidate);
        }
        return { effect: "flash" };
      }
    }
  }),
  defineRole({
    id: "bomber",
    name: "Bomber",
    faction: FACTIONS.OPERATIVE,
    colour: "#ff5f6f",
    objective: "Plant a charge and be somewhere else when it goes off.",
    ability: {
      id: "plant", label: "Plant", icon: icon("janitor"),
      targeting: TARGETING.NONE, cooldownMs: 35_000, uses: null,
      perform: ({ state, player, now }) => {
        state.bomb = { x: player.position.x, z: player.position.z, at: now + 6_000 };
        return { effect: "plant" };
      }
    },
    state: { bomb: null }
  }),
  defineRole({
    id: "hypnotist",
    name: "Hypnotist",
    faction: FACTIONS.OPERATIVE,
    colour: "#ff5f6f",
    objective: "Cloud a crewmate's sight until they cannot trust it.",
    ability: {
      id: "hypnotise", label: "Hypnotise", icon: icon("morphling"),
      targeting: TARGETING.PLAYER, cooldownMs: 28_000, uses: null,
      perform: ({ api, target, now }) => {
        target.roleState = target.roleState ?? {};
        target.roleState.blindedUntil = now + 12_000;
        api.notify(target);
        return { effect: "hypnotise", targetId: target.id };
      }
    }
  }),
  defineRole({
    id: "warlock",
    name: "Warlock",
    faction: FACTIONS.OPERATIVE,
    colour: "#ff5f6f",
    objective: "Curse a crewmate; whoever they touch next dies with them.",
    ability: {
      id: "curse", label: "Curse", icon: icon("morphling"),
      targeting: TARGETING.PLAYER, cooldownMs: 30_000, uses: null,
      perform: ({ state, target }) => {
        state.cursedId = target.id;
        return { effect: "curse", targetId: target.id };
      }
    },
    state: { cursedId: null }
  }),
  defineRole({
    id: "traitor",
    name: "Traitor",
    faction: FACTIONS.OPERATIVE,
    colour: "#ff5f6f",
    objective: "You were crew until the last Operative fell.",
    ability: null
  }),
  defineRole({
    id: "venerer",
    name: "Venerer",
    faction: FACTIONS.OPERATIVE,
    colour: "#ff5f6f",
    objective: "Take a trophy from each kill and grow harder to catch.",
    ability: {
      id: "quarry", label: "Quarry", icon: icon("swooper"),
      targeting: TARGETING.NONE, cooldownMs: 25_000, uses: null,
      perform: ({ state, player, now }) => {
        state.activeUntil = now + 6_000 + Math.min(6_000, player.matchStats.eliminations * 2_000);
        return { effect: "quarry" };
      }
    }
  }),
  defineRole({
    id: "miner",
    name: "Miner",
    faction: FACTIONS.OPERATIVE,
    colour: "#ff5f6f",
    objective: "Dig your own vents wherever you stand.",
    ability: {
      id: "mine",
      label: "Mine",
      icon: icon("janitor"),
      targeting: TARGETING.NONE,
      cooldownMs: 25_000,
      uses: null,
      perform: ({ api, player }) => {
        api.digVent(player.position);
        return { effect: "mine" };
      }
    }
  }),
  defineRole({
    id: "undertaker",
    name: "Undertaker",
    faction: FACTIONS.OPERATIVE,
    colour: "#ff5f6f",
    objective: "Drag a body somewhere it will not be found.",
    ability: {
      id: "drag",
      label: "Drag",
      icon: icon("janitor"),
      targeting: TARGETING.INCIDENT,
      cooldownMs: 15_000,
      uses: null,
      perform: ({ state, incident }) => {
        // Toggle: grab a body, or drop the one already being dragged.
        if (state.draggingId === incident.id) {
          state.draggingId = null;
          return { effect: "drop", targetId: incident.id };
        }
        state.draggingId = incident.id;
        return { effect: "drag", targetId: incident.id };
      }
    },
    state: { draggingId: null }
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
    // It is already dead and has no body to walk to a target with, so it acts from
    // the grave and at any distance.
    capabilities: { actsWhileDead: true, ignoresAbilityRange: true },
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
  }),
  defineRole({
    id: "haunter",
    name: "Haunter",
    faction: FACTIONS.NEUTRAL,
    colour: "#b9a7ff",
    objective: "From the other side, finish what you started.",
    ability: null,
    win: {
      kind: WIN_KINDS.SURVIVE,
      solo: true,
      check: ({ player }) => !player.alive && player.tasks.length > 0
        && player.tasks.every((task) => player.completedTasks.has(task.id))
    }
  }),
  defineRole({
    id: "glitch",
    name: "The Glitch",
    faction: FACTIONS.NEUTRAL,
    colour: "#38e07b",
    objective: "Mimic, hack and outlast everyone aboard.",
    ability: {
      id: "mimic", label: "Mimic", icon: icon("morphling"),
      targeting: TARGETING.PLAYER, cooldownMs: 25_000, uses: null,
      perform: ({ state, target, now }) => {
        state.morphTargetId = target.id;
        state.activeUntil = now + 10_000;
        return { effect: "mimic", targetId: target.id };
      }
    },
    win: { kind: WIN_KINDS.LAST_STANDING, solo: true }
  }),
  defineRole({
    id: "juggernaut",
    name: "Juggernaut",
    faction: FACTIONS.NEUTRAL,
    colour: "#b5473c",
    objective: "Every kill makes the next one come faster.",
    ability: {
      id: "juggernaut-strike", label: "Strike", icon: icon("sheriff"),
      targeting: TARGETING.PLAYER, cooldownMs: 30_000, uses: null,
      perform: ({ api, player, target }) => {
        api.eliminate(player, target, "juggernaut strike", { ignoreFaction: true });
        return { effect: "juggernaut-strike", targetId: target.id };
      }
    },
    win: { kind: WIN_KINDS.LAST_STANDING, solo: true }
  }),
  defineRole({
    id: "plaguebearer",
    name: "Plaguebearer",
    faction: FACTIONS.NEUTRAL,
    colour: "#9fbf6a",
    objective: "Infect everyone aboard, and become Pestilence.",
    ability: {
      id: "infect", label: "Infect", icon: icon("survivor"),
      targeting: TARGETING.PLAYER, cooldownMs: 12_000, uses: null,
      perform: ({ state, player, target, room }) => {
        state.infected = state.infected ?? [];
        if (!state.infected.includes(target.id)) state.infected.push(target.id);
        const living = [...room.players.values()].filter((c) => c.alive && c.id !== player.id);
        if (living.every((c) => state.infected.includes(c.id))) {
          player.role = "pestilence";
          return { effect: "become-pestilence", targetId: target.id };
        }
        return { effect: "infect", targetId: target.id };
      }
    },
    win: { kind: WIN_KINDS.LAST_STANDING, solo: true },
    state: { infected: [] }
  }),
  defineRole({
    id: "pestilence",
    name: "Pestilence",
    faction: FACTIONS.NEUTRAL,
    colour: "#6f8f3f",
    objective: "Nothing can stop you now. Finish it.",
    ability: {
      id: "pestilence-strike", label: "Strike", icon: icon("sheriff"),
      targeting: TARGETING.PLAYER, cooldownMs: 20_000, uses: null,
      perform: ({ api, player, target }) => {
        api.eliminate(player, target, "pestilence", { ignoreFaction: true, ignoreProtection: true });
        return { effect: "pestilence-strike", targetId: target.id };
      }
    },
    win: { kind: WIN_KINDS.LAST_STANDING, solo: true }
  }),
  defineRole({
    id: "doomsayer",
    name: "Doomsayer",
    faction: FACTIONS.NEUTRAL,
    colour: "#c77dff",
    objective: "Name what everyone is, and win the moment you are right enough.",
    ability: {
      id: "observe", label: "Observe", icon: icon("investigator"),
      targeting: TARGETING.PLAYER, cooldownMs: 20_000, uses: null,
      perform: ({ api, state, target }) => {
        state.observed = state.observed ?? [];
        if (!state.observed.includes(target.id)) state.observed.push(target.id);
        api.reportPrivately({
          type: "omen",
          detail: `${target.displayName} reads as ${target.faction}.`
        });
        return { effect: "observe", targetId: target.id };
      }
    },
    win: { kind: WIN_KINDS.SURVIVE, solo: true },
    state: { observed: [] }
  }),
  defineRole({
    id: "mercenary",
    name: "Mercenary",
    faction: FACTIONS.NEUTRAL,
    colour: "#d4a373",
    objective: "Take a contract, keep them breathing, get paid.",
    ability: {
      id: "guard", label: "Guard", icon: icon("medic"),
      targeting: TARGETING.PLAYER, cooldownMs: 30_000, uses: null,
      perform: ({ api, state, target, now }) => {
        state.contractId = target.id;
        api.protect(target, now + 12_000);
        return { effect: "guard", targetId: target.id };
      }
    },
    win: { kind: WIN_KINDS.SURVIVE },
    state: { contractId: null }
  }),
  defineRole({
    id: "soul-collector",
    name: "Soul Collector",
    faction: FACTIONS.NEUTRAL,
    colour: "#8e7dbe",
    objective: "Reap the souls of the fallen until the tally is yours.",
    ability: {
      id: "reap", label: "Reap", icon: icon("survivor"),
      targeting: TARGETING.INCIDENT, cooldownMs: 10_000, uses: null,
      perform: ({ api, state, incident }) => {
        state.souls = (state.souls ?? 0) + 1;
        api.removeIncident(incident);
        return { effect: "reap", targetId: incident.id };
      }
    },
    win: { kind: WIN_KINDS.SURVIVE, solo: true },
    state: { souls: 0 }
  }),
  defineRole({
    id: "arsonist",
    name: "Arsonist",
    faction: FACTIONS.NEUTRAL,
    colour: "#ff8c42",
    objective: "Douse every living soul, then light the deck.",
    ability: {
      id: "douse",
      label: "Douse",
      icon: icon("survivor"),
      targeting: TARGETING.PLAYER,
      cooldownMs: 15_000,
      uses: null,
      perform: ({ api, state, player, target, room }) => {
        state.doused = state.doused ?? [];
        if (!state.doused.includes(target.id)) state.doused.push(target.id);
        const living = [...room.players.values()]
          .filter((candidate) => candidate.alive && candidate.id !== player.id);
        // With everyone soaked, the next use is the ignition.
        if (living.every((candidate) => state.doused.includes(candidate.id))) {
          for (const candidate of living) {
            api.eliminate(player, candidate, "arsonist ignition", { ignoreFaction: true, ignoreProtection: true });
          }
          return { effect: "ignite", targetId: target.id };
        }
        return { effect: "douse", targetId: target.id };
      }
    },
    win: { kind: WIN_KINDS.LAST_STANDING, solo: true },
    state: { doused: [] }
  }),
  defineRole({
    id: "vampire",
    name: "Vampire",
    faction: FACTIONS.NEUTRAL,
    colour: "#a3243b",
    objective: "Bite the crew until nobody is left to stop you.",
    ability: {
      id: "bite",
      label: "Bite",
      icon: icon("sheriff"),
      targeting: TARGETING.PLAYER,
      cooldownMs: 25_000,
      uses: null,
      perform: ({ api, player, target }) => {
        api.eliminate(player, target, "vampire bite", { ignoreFaction: true });
        return { effect: "bite", targetId: target.id };
      }
    },
    win: { kind: WIN_KINDS.LAST_STANDING, solo: true }
  }),
  defineRole({
    id: "werewolf",
    name: "Werewolf",
    faction: FACTIONS.NEUTRAL,
    colour: "#7a5c3e",
    objective: "Rampage, and tear apart anything within reach.",
    ability: {
      id: "rampage",
      label: "Rampage",
      icon: icon("swooper"),
      targeting: TARGETING.NONE,
      cooldownMs: 30_000,
      uses: null,
      perform: ({ state, now }) => {
        state.rampageUntil = now + 12_000;
        state.activeUntil = state.rampageUntil;
        return { effect: "rampage" };
      }
    },
    win: { kind: WIN_KINDS.LAST_STANDING, solo: true },
    state: { rampageUntil: 0 }
  }),
  defineRole({
    id: "phantom",
    name: "Phantom",
    faction: FACTIONS.NEUTRAL,
    colour: "#9d8df1",
    objective: "Finish your assignments unseen, after death.",
    ability: null,
    win: {
      kind: WIN_KINDS.SURVIVE,
      solo: true,
      // The Phantom's victory is finishing every assignment, dead or alive.
      check: ({ player }) => player.tasks.length > 0
        && player.tasks.every((task) => player.completedTasks.has(task.id))
    }
  })
];

export const ALL_ROLES = Object.freeze([...CREW_ROLES, ...OPERATIVE_ROLES, ...NEUTRAL_ROLES]);
