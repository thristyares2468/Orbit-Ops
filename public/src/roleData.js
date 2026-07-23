const ICON_ROOT = "/assets/town-of-us/roles";

export const ROLE_DEFINITIONS = Object.freeze({
  "operations-crew": Object.freeze({
    id: "operations-crew",
    name: "Operations Crew",
    faction: "crew",
    colour: "#74e5ff",
    objective: "Complete assignments, repair the ship, and identify every Operative.",
    ability: null
  }),
  engineer: Object.freeze({
    id: "engineer",
    name: "Engineer",
    faction: "crew",
    colour: "#ff954f",
    objective: "Maintain critical systems and remotely resolve one sabotage.",
    ability: Object.freeze({
      id: "remote-repair",
      label: "Repair",
      icon: `${ICON_ROOT}/engineer.png`,
      targeting: "none",
      cooldownMs: 25_000,
      uses: 1
    })
  }),
  medic: Object.freeze({
    id: "medic",
    name: "Medic",
    faction: "crew",
    colour: "#34e59a",
    objective: "Shield one nearby crewmate from the next elimination attempt.",
    ability: Object.freeze({
      id: "shield",
      label: "Shield",
      icon: `${ICON_ROOT}/medic.png`,
      targeting: "player",
      cooldownMs: 15_000,
      uses: 1
    })
  }),
  sheriff: Object.freeze({
    id: "sheriff",
    name: "Sheriff",
    faction: "crew",
    colour: "#ffd34e",
    objective: "Eliminate an Operative—but firing on an innocent eliminates you.",
    ability: Object.freeze({
      id: "sheriff-shot",
      label: "Shoot",
      icon: `${ICON_ROOT}/sheriff.png`,
      targeting: "player",
      cooldownMs: 22_000,
      uses: null
    })
  }),
  tracker: Object.freeze({
    id: "tracker",
    name: "Tracker",
    faction: "crew",
    colour: "#7fc8ff",
    objective: "Track a nearby player and follow their signal for twenty seconds.",
    ability: Object.freeze({
      id: "track",
      label: "Track",
      icon: `${ICON_ROOT}/tracker.png`,
      targeting: "player",
      cooldownMs: 20_000,
      uses: 2
    })
  }),
  "signal-operative": Object.freeze({
    id: "signal-operative",
    name: "Signal Operative",
    faction: "operative",
    colour: "#ff5f6f",
    objective: "Corrupt the mission, isolate the crew, and control the vote.",
    ability: null
  }),
  morphling: Object.freeze({
    id: "morphling",
    name: "Morphling",
    faction: "operative",
    colour: "#ff5f6f",
    objective: "Copy a nearby player's appearance for twelve seconds.",
    ability: Object.freeze({
      id: "morph",
      label: "Morph",
      icon: `${ICON_ROOT}/morphling.png`,
      targeting: "player",
      cooldownMs: 28_000,
      uses: null
    })
  }),
  swooper: Object.freeze({
    id: "swooper",
    name: "Swooper",
    faction: "operative",
    colour: "#ff5f6f",
    objective: "Become nearly invisible for eight seconds.",
    ability: Object.freeze({
      id: "swoop",
      label: "Swoop",
      icon: `${ICON_ROOT}/swooper.png`,
      targeting: "none",
      cooldownMs: 30_000,
      uses: null
    })
  }),
  janitor: Object.freeze({
    id: "janitor",
    name: "Janitor",
    faction: "operative",
    colour: "#ff5f6f",
    objective: "Clean one nearby incident before the crew can report it.",
    ability: Object.freeze({
      id: "clean",
      label: "Clean",
      icon: `${ICON_ROOT}/janitor.png`,
      targeting: "incident",
      cooldownMs: 20_000,
      uses: 2
    })
  }),
  jester: Object.freeze({
    id: "jester",
    name: "Jester",
    faction: "neutral",
    colour: "#ff72dd",
    objective: "Convince the crew to vote you out.",
    ability: null,
    icon: `${ICON_ROOT}/jester.png`
  }),
  survivor: Object.freeze({
    id: "survivor",
    name: "Survivor",
    faction: "neutral",
    colour: "#d8d6a1",
    objective: "Stay alive until another faction ends the match.",
    ability: Object.freeze({
      id: "vest",
      label: "Vest",
      icon: `${ICON_ROOT}/survivor.png`,
      targeting: "none",
      cooldownMs: 24_000,
      uses: 2
    })
  })
});

export const CREW_ROLE_IDS = Object.freeze(["engineer", "medic", "sheriff", "tracker", "operations-crew"]);
export const OPERATIVE_ROLE_IDS = Object.freeze(["morphling", "swooper", "janitor", "signal-operative"]);
export const NEUTRAL_ROLE_IDS = Object.freeze(["jester", "survivor"]);
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
