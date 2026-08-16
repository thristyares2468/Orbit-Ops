import { randomUUID } from "node:crypto";

// Parties are in-memory and deliberately not persisted: they exist for the
// length of a sitting, and a server restart drops everyone back to the menu
// anyway. What they buy is that a group stops passing a five-character code
// around by hand.
//
// A party is identified by its leader's *account*, not by a socket, so the
// group survives one member's reconnect.

export const MAX_PARTY_SIZE = 6;

export class PartyRegistry {
  constructor({ maxSize = MAX_PARTY_SIZE } = {}) {
    this.maxSize = maxSize;
    this.parties = new Map();          // partyId -> party
    this.byAccount = new Map();        // accountId -> partyId
  }

  partyFor(accountId) {
    const id = this.byAccount.get(String(accountId ?? ""));
    return id ? this.parties.get(id) ?? null : null;
  }

  // Guests have no stable identity across a reconnect, so they cannot hold a
  // party slot. The caller turns this into a readable refusal.
  create(leader) {
    if (!leader?.accountId) throw new Error("Sign in to start a party.");
    const existing = this.partyFor(leader.accountId);
    if (existing) return existing;
    const party = {
      id: randomUUID(),
      leaderId: String(leader.accountId),
      members: new Map([[String(leader.accountId), { ...leader, accountId: String(leader.accountId) }]]),
      invites: new Map(),
      createdAt: Date.now()
    };
    this.parties.set(party.id, party);
    this.byAccount.set(party.leaderId, party.id);
    return party;
  }

  invite(leaderAccountId, target) {
    const party = this.partyFor(leaderAccountId) ?? this.create({ accountId: leaderAccountId, displayName: "Host" });
    if (party.leaderId !== String(leaderAccountId)) throw new Error("Only the party leader can invite.");
    if (!target?.accountId) throw new Error("That player cannot be invited.");
    const targetId = String(target.accountId);
    if (party.members.has(targetId)) throw new Error("They are already in your party.");
    if (party.members.size + party.invites.size >= this.maxSize) throw new Error("The party is full.");
    if (this.partyFor(targetId)) throw new Error("They are already in a party.");
    party.invites.set(targetId, { ...target, accountId: targetId, invitedAt: Date.now() });
    return party;
  }

  respond(accountId, partyId, accept) {
    const party = this.parties.get(String(partyId ?? ""));
    const id = String(accountId ?? "");
    if (!party || !party.invites.has(id)) throw new Error("That party invitation has expired.");
    const invite = party.invites.get(id);
    party.invites.delete(id);
    if (!accept) return { party, joined: false };
    if (party.members.size >= this.maxSize) throw new Error("The party is full.");
    if (this.partyFor(id)) throw new Error("Leave your current party first.");
    party.members.set(id, { ...invite, accountId: id });
    this.byAccount.set(id, party.id);
    return { party, joined: true };
  }

  leave(accountId) {
    const id = String(accountId ?? "");
    const party = this.partyFor(id);
    if (!party) return null;
    party.members.delete(id);
    party.invites.delete(id);
    this.byAccount.delete(id);
    if (party.leaderId === id) {
      // The leader leaving hands over rather than dissolving the group.
      const next = [...party.members.keys()][0];
      if (next) party.leaderId = next;
    }
    if (party.members.size === 0) {
      for (const invitedId of party.invites.keys()) this.byAccount.delete(invitedId);
      this.parties.delete(party.id);
      return null;
    }
    return party;
  }

  kick(leaderAccountId, targetAccountId) {
    const party = this.partyFor(leaderAccountId);
    if (!party) throw new Error("You are not in a party.");
    if (party.leaderId !== String(leaderAccountId)) throw new Error("Only the party leader can remove members.");
    const targetId = String(targetAccountId ?? "");
    if (targetId === party.leaderId) throw new Error("The leader cannot be removed.");
    if (!party.members.has(targetId) && !party.invites.has(targetId)) throw new Error("They are not in your party.");
    party.members.delete(targetId);
    party.invites.delete(targetId);
    this.byAccount.delete(targetId);
    return party;
  }

  // How many seats a room needs to take this whole group. Matchmaking asks this
  // before choosing a lobby so a party is never split across two rooms.
  seatsRequired(accountId) {
    return this.partyFor(accountId)?.members.size ?? 1;
  }

  publicView(party, viewerId = null) {
    if (!party) return null;
    return {
      id: party.id,
      leaderId: party.leaderId,
      isLeader: String(viewerId ?? "") === party.leaderId,
      members: [...party.members.values()].map(({ accountId, displayName }) => ({ accountId, displayName })),
      invited: [...party.invites.values()].map(({ accountId, displayName }) => ({ accountId, displayName })),
      maxSize: this.maxSize
    };
  }
}
