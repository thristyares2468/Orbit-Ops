import {
  CREW_ROLE_IDS,
  NEUTRAL_ROLE_IDS,
  OPERATIVE_ROLE_IDS,
  PRACTICE_ROLE_IDS
} from "./roleData.js";

export const MAX_ROLE_COUNT = 4;

export const DEFAULT_ROLE_SETTINGS = Object.freeze(Object.fromEntries(
  PRACTICE_ROLE_IDS.map((roleId) => [roleId, Object.freeze({ count: 1, chance: 100 })])
));

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

export function normaliseRoleSettings(input = {}, fallback = DEFAULT_ROLE_SETTINGS) {
  return Object.fromEntries(PRACTICE_ROLE_IDS.map((roleId) => {
    const previous = fallback?.[roleId] ?? DEFAULT_ROLE_SETTINGS[roleId];
    const candidate = input?.[roleId] ?? previous;
    return [roleId, {
      count: clampInteger(candidate?.count, 0, MAX_ROLE_COUNT, previous.count),
      chance: clampInteger(candidate?.chance, 0, 100, previous.chance)
    }];
  }));
}

export function enabledRoleCount(settings) {
  const roleSettings = normaliseRoleSettings(settings);
  return PRACTICE_ROLE_IDS.filter((roleId) => {
    const rule = roleSettings[roleId];
    return rule.count > 0 && rule.chance > 0;
  }).length;
}

export function rolePoolForFaction(faction, settings, random = Math.random) {
  const roleIds = faction === "operative"
    ? OPERATIVE_ROLE_IDS
    : faction === "neutral" ? NEUTRAL_ROLE_IDS : CREW_ROLE_IDS;
  const roleSettings = normaliseRoleSettings(settings);
  const pool = [];
  for (const roleId of roleIds) {
    const rule = roleSettings[roleId];
    for (let copy = 0; copy < rule.count; copy += 1) {
      if (random() * 100 < rule.chance) pool.push(roleId);
    }
  }
  return pool;
}
