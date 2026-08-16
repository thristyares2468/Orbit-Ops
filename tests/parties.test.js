import assert from "node:assert/strict";
import test from "node:test";
import { PartyRegistry } from "../server/parties.js";

const member = (id) => ({ accountId: id, displayName: `Player-${id}` });

test("a guest cannot hold a party", () => {
  const parties = new PartyRegistry();
  assert.throws(() => parties.create({ accountId: null, displayName: "Guest" }), /Sign in/u);
});

test("creating twice returns the same party rather than a second one", () => {
  const parties = new PartyRegistry();
  const first = parties.create(member("a"));
  assert.equal(parties.create(member("a")).id, first.id);
});

test("an invitation has to be accepted before it takes a seat", () => {
  const parties = new PartyRegistry();
  parties.create(member("a"));
  const party = parties.invite("a", member("b"));
  assert.equal(party.members.size, 1);
  assert.equal(party.invites.size, 1);
  // Until it is accepted the invitee is in no party at all.
  assert.equal(parties.partyFor("b"), null);

  const { joined } = parties.respond("b", party.id, true);
  assert.ok(joined);
  assert.equal(party.members.size, 2);
  assert.equal(parties.partyFor("b").id, party.id);
});

test("declining leaves no trace", () => {
  const parties = new PartyRegistry();
  parties.create(member("a"));
  const party = parties.invite("a", member("b"));
  const { joined } = parties.respond("b", party.id, false);
  assert.ok(!joined);
  assert.equal(party.invites.size, 0);
  assert.equal(parties.partyFor("b"), null);
});

test("only the leader invites or removes", () => {
  const parties = new PartyRegistry();
  parties.create(member("a"));
  const party = parties.invite("a", member("b"));
  parties.respond("b", party.id, true);
  assert.throws(() => parties.invite("b", member("c")), /leader/u);
  assert.throws(() => parties.kick("b", "a"), /leader/u);
  assert.throws(() => parties.kick("a", "a"), /cannot be removed/u);
  parties.kick("a", "b");
  assert.equal(party.members.size, 1);
  assert.equal(parties.partyFor("b"), null);
});

test("a party fills up and then refuses", () => {
  const parties = new PartyRegistry({ maxSize: 3 });
  parties.create(member("a"));
  for (const id of ["b", "c"]) {
    const party = parties.invite("a", member(id));
    parties.respond(id, party.id, true);
  }
  assert.equal(parties.seatsRequired("a"), 3);
  assert.throws(() => parties.invite("a", member("d")), /full/u);
});

test("someone already in a party cannot be invited into another", () => {
  const parties = new PartyRegistry();
  parties.create(member("a"));
  parties.create(member("b"));
  assert.throws(() => parties.invite("a", member("b")), /already in a party/u);
});

test("the leader leaving hands over instead of dissolving the group", () => {
  const parties = new PartyRegistry();
  parties.create(member("a"));
  const party = parties.invite("a", member("b"));
  parties.respond("b", party.id, true);
  const remaining = parties.leave("a");
  assert.equal(remaining.leaderId, "b");
  assert.equal(remaining.members.size, 1);
  assert.equal(parties.partyFor("a"), null);
});

test("the last member leaving disposes of the party", () => {
  const parties = new PartyRegistry();
  const party = parties.create(member("a"));
  assert.equal(parties.leave("a"), null);
  assert.equal(parties.parties.get(party.id), undefined);
  assert.equal(parties.partyFor("a"), null);
});

test("seatsRequired is one for somebody with no party", () => {
  assert.equal(new PartyRegistry().seatsRequired("nobody"), 1);
  assert.equal(new PartyRegistry().seatsRequired(null), 1);
});

test("an expired invitation cannot be answered", () => {
  const parties = new PartyRegistry();
  parties.create(member("a"));
  assert.throws(() => parties.respond("b", "no-such-party", true), /expired/u);
});

test("the public view says who is looking", () => {
  const parties = new PartyRegistry();
  const party = parties.create(member("a"));
  parties.invite("a", member("b"));
  assert.equal(parties.publicView(party, "a").isLeader, true);
  assert.equal(parties.publicView(party, "b").isLeader, false);
  assert.equal(parties.publicView(party, "a").invited.length, 1);
  assert.equal(parties.publicView(null, "a"), null);
});
