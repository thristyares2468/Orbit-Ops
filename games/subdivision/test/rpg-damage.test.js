'use strict';

// The RPG fired, exploded, and did nothing - to anyone, anywhere.
//
// Two separate holes, both opened when the launcher stopped being admin-only:
//
// 1. rpgDamageFor() still began `if (!isAdminRoom(room))`, so every playerHit
//    of kind 'rpg' resolved to 0 and was dropped. The throw and burst paths had
//    their admin gates removed; this one was missed, and nothing failed loudly
//    because returning 0 damage is indistinguishable from a miss.
//
// 2. Nothing ever applied the blast to Containment zombies. The client's
//    applyLocalGrenadeDamage walks remotePlayers only - zombies are server
//    owned and no client has standing to report a hit on them - so the one
//    mode that sells the launcher was the one where it could not hurt anything.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const core = require('../core.js');
const containment = require('../containment.js');

function body(name) {
  const start = server.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} not found`);
  let depth = 0, i = server.indexOf('{', start);
  for (let j = i; j < server.length; j++) {
    if (server[j] === '{') depth++;
    else if (server[j] === '}' && --depth === 0) return server.slice(start, j + 1);
  }
  throw new Error(`${name} is unbalanced`);
}

test('RPG damage is not gated on the admin room', () => {
  // Comments mention isAdminRoom deliberately, so match on code lines only.
  const code = body('rpgDamageFor').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /isAdminRoom/u,
    'the launcher is public; gating damage on the admin room silently zeroes every hit outside it');
  assert.match(code, /room\.recentRpgBursts/u, 'the validated burst list is still what authorises damage');
});

test('the blast is resolved against Containment zombies server-side', () => {
  const burst = server.slice(server.indexOf("if (type === 'grenadeBurst')"));
  const block = burst.slice(0, burst.indexOf("if (type === 'flashHit')"));
  assert.match(block, /damageContainmentEnemiesFromBlast\(client, room, player, position\);/u);
  // Only after the trajectory check has accepted the burst.
  assert.ok(block.indexOf('recentRpgBursts.push') < block.indexOf('damageContainmentEnemiesFromBlast'),
    'the horde must not be damaged by a burst the server has not validated');
});

test('the blast falls off with distance and pays out kills', () => {
  const { radius, maxDamage } = core.GRENADE.rpg;
  const hits = [];
  const scope = {
    containment,
    GRENADE: core.GRENADE,
    broadcastRaw: (_code, json) => hits.push(JSON.parse(json).data),
    send: () => {},
    containmentClientState: () => ({})
  };
  const fn = new Function(...Object.keys(scope), `${body('damageContainmentEnemiesFromBlast')}; return damageContainmentEnemiesFromBlast;`)(...Object.values(scope));

  const enemies = new Map();
  const add = (id, x, health) => enemies.set(id, { id, x, y: 0, z: 0, health, maxHealth: health });
  add('point_blank', 0, 500);            // full damage
  add('edge', radius - 1, 500);          // nearly nothing
  add('outside', radius + 10, 500);      // untouched
  add('fodder', 20, 10);                 // dies

  // A real match, so reward/credit-cap behaviour is the shipped one.
  const match = containment.createMatch();
  containment.registerPlayer(match, 'p1');
  match.phase = containment.PHASES.ACTIVE;
  match.enemies = enemies;
  const room = { containment: match };
  fn({ roomCode: 'AAAA' }, room, { id: 'p1' }, { x: 0, y: 0, z: 0 });

  const byId = Object.fromEntries(hits.map((h) => [h.id, h]));
  assert.equal(byId.point_blank.health, 500 - maxDamage, 'a direct hit is the full figure');
  assert.ok(byId.edge.health > 500 - 5, 'the rim of the blast barely scratches');
  assert.equal(byId.outside, undefined, 'nothing outside the radius is touched');
  assert.equal(byId.fodder.killed, true);
  assert.equal(match.stats.kills, 1, 'a rocket kill counts like any other');
  assert.ok(containment.credits(match, 'p1') > 0, 'and pays out like any other');
  // An explosion has no aim point, so it must never be scored as a headshot -
  // damageEnemy doubles those.
  assert.ok(hits.every((h) => h.headshot === false));
});
