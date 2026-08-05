import { FACTIONS, TARGETING, WIN_KINDS } from "../public/src/roles/defineRole.js";
import { getRoleDefinition } from "../public/src/roleData.js";

// Executes a role's declared ability against a narrow API, so a role definition can
// never reach past the rules it is allowed to touch. Everything a role may do to the
// match goes through buildAbilityApi below and nothing else.

const ROLE_TARGET_RANGE = 3.2;

function distance(a, b) {
  return Math.hypot(Number(a?.x) - Number(b?.x), Number(a?.z) - Number(b?.z));
}

// Resolve whatever the ability targets, or explain why it cannot be resolved.
function resolveTarget(server, room, player, definition, payload) {
  switch (definition.ability.targeting) {
    case TARGETING.PLAYER: {
      const target = room.players.get(String(payload.targetId ?? ""));
      if (!target || !target.alive || target.id === player.id) {
        throw new Error("No valid role target is in range.");
      }
      // Guardian Angel acts from beyond the grave, so it alone ignores range.
      if (player.role !== "guardian-angel" && distance(player.position, target.position) > ROLE_TARGET_RANGE) {
        throw new Error("Move closer to your target.");
      }
      return { target };
    }
    case TARGETING.INCIDENT: {
      const incident = room.incidents.get(String(payload.incidentId ?? payload.targetId ?? ""));
      if (!incident || incident.reported) throw new Error("No incident can be reached here.");
      if (distance(player.position, incident) > ROLE_TARGET_RANGE) {
        throw new Error("Move closer to the incident.");
      }
      return { incident };
    }
    default:
      return {};
  }
}

function buildAbilityApi(server, room, player) {
  return {
    inMeeting: (current) => ["discussion", "voting", "incidentTransition"].includes(current.phase),

    eliminate: (attacker, target, category, options) =>
      server.eliminateInternal(room, attacker, target, category, options),

    resolveSabotage: (byPlayer, extra = {}) => {
      if (!room.activeSabotage) throw new Error("No sabotage is active.");
      const ended = server.publicSabotage(room.activeSabotage);
      server.clearActiveSabotage(room);
      byPlayer.matchStats.sabotagesRepaired += 1;
      server.io.to(room.code).emit("sabotageEnded", { ...ended, repairedBy: byPlayer.id, ...extra });
    },

    removeIncident: (incident) => {
      room.incidents.delete(incident.id);
      server.io.to(room.code).emit("incidentCleaned", { incidentId: incident.id });
    },

    protect: (target, until) => {
      target.roleState = target.roleState ?? {};
      target.roleState.protectedUntil = until;
      server.sendPrivateState(room, target);
    },

    teleport: (target, position) => {
      target.position = { x: position.x, z: position.z };
      target.currentRoom = server.roomIdAt(room, position) ?? target.currentRoom;
    },

    // Private findings go only to the acting player, never to the room.
    reportPrivately: (finding) => {
      if (!player.socketId) return;
      server.io.to(player.socketId).emit("roleFinding", { ...finding, at: Date.now() });
    },

    revive: (incident) => {
      const victim = room.players.get(String(incident.victimId ?? ""));
      if (!victim) throw new Error("There is nobody here to revive.");
      victim.alive = true;
      victim.eliminatedAt = null;
      victim.position = { x: incident.x, z: incident.z };
      victim.currentRoom = incident.roomId;
      room.incidents.delete(incident.id);
      server.io.to(room.code).emit("incidentCleaned", { incidentId: incident.id });
      server.io.to(room.code).emit("playerRevived", { playerId: victim.id, roomId: incident.roomId });
      server.sendPrivateState(room, victim);
    },

    // The Miner opens a new vent wherever it stands, joined to the mined network.
    digVent: (position) => {
      room.minedVents = room.minedVents ?? [];
      const vent = {
        id: `mined-${room.minedVents.length + 1}`,
        type: "maintenance",
        refId: "vent-mined",
        roomId: server.roomIdAt(room, position) ?? "cafeteria",
        x: position.x,
        z: position.z
      };
      room.minedVents.push(vent);
      server.io.to(room.code).emit("ventMined", { vent });
    },

    becomeRoleOf: (victimId) => {
      const victim = room.players.get(String(victimId ?? ""));
      if (!victim?.role) throw new Error("There is nothing to remember here.");
      player.role = victim.role;
      player.faction = victim.faction;
      player.roleState = server.freshRoleState(player.role);
      server.sendPrivateState(room, player);
    }
  };
}

export function performRoleAbility(server, room, player, payload = {}) {
  const { definition, state, now } = server.beginRoleAction(room, player);
  if (!definition.ability?.perform) throw new Error("This role ability is not implemented.");

  const context = {
    room, player, state, now,
    api: buildAbilityApi(server, room, player),
    ...resolveTarget(server, room, player, definition, payload)
  };

  // A refused ability must not spend its cooldown or a use.
  const refusal = definition.ability.requires?.(context);
  if (refusal) throw new Error(refusal);

  const outcome = definition.ability.perform(context) ?? {};
  const privateState = server.finishRoleAction(room, player, definition, state, now);
  server.io.to(room.code).emit("roleEffect", {
    playerId: player.id,
    targetId: outcome.targetId ?? null,
    effect: outcome.effect ?? definition.ability.id,
    activeUntil: state.activeUntil || null
  });
  return { ok: true, effect: outcome.effect ?? definition.ability.id, targetId: outcome.targetId ?? null, privateState };
}

// Neutral roles win on their own terms. Checked before faction parity so a Jester
// dragged out by the crew still takes the match.
export function checkSoloWin(room, { votedOutId = null } = {}) {
  for (const player of room.players.values()) {
    if (!player.role) continue;
    const definition = getRoleDefinition(player.role);
    if (definition.faction !== FACTIONS.NEUTRAL) continue;

    if (definition.win.kind === WIN_KINDS.VOTED_OUT && votedOutId === player.id) {
      return { winner: FACTIONS.NEUTRAL, reason: `${definition.id}-voted-out`, winnerIds: [player.id] };
    }
    if (definition.win.kind === WIN_KINDS.TARGET_VOTED_OUT) {
      const targetId = player.roleState?.executionerTargetId;
      if (targetId && votedOutId === targetId && player.alive) {
        return { winner: FACTIONS.NEUTRAL, reason: `${definition.id}-target-removed`, winnerIds: [player.id] };
      }
    }
    if (definition.win.check) {
      const result = definition.win.check({ room, player });
      if (result) return { winner: FACTIONS.NEUTRAL, reason: `${definition.id}-win`, winnerIds: [player.id] };
    }
  }
  return null;
}

// Roles whose victory is simply "still breathing at the end" share the win.
export function survivorWinnerIds(room) {
  return [...room.players.values()]
    .filter((player) => player.alive && player.role
      && getRoleDefinition(player.role).win.kind === WIN_KINDS.SURVIVE)
    .map((player) => player.id);
}
