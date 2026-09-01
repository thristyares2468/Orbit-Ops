'use strict';

// The Breacher alternates buckshot and slug. What has to hold is that the load
// is the server's decision, that one trigger pull cannot be split across both
// loads, and that an uncorrelated hit can never be paid out as a slug.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const core = require('../core');

const ROOT = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('the two loads are borrowed, not copied', () => {
  const alt = core.SHOTGUN_ALT;
  assert.ok(alt, 'core must export SHOTGUN_ALT');
  assert.equal(alt.weapon, 'Breacher');
  // Borrowed by reference on purpose: a buckshot pull is always exactly a Nova
  // shot and a slug always the SSG 08's numbers, whatever those are retuned to.
  assert.equal(alt.buckshot.dmg, core.WEAPONS.Nova.dmg);
  assert.equal(alt.buckshot.pellets, core.WEAPONS.Nova.pellets);
  assert.equal(alt.slug.dmg, core.WEAPONS['SSG 08'].dmg);
  assert.equal(alt.slug.pellets, 1, 'a slug is a single projectile');
  assert.equal(core.WEAPONS.Breacher.dmg, alt.buckshot.dmg, 'the weapon table itself is the buckshot load');
});

test('the pull window separates pulls but never splits one', () => {
  const alt = core.SHOTGUN_ALT;
  const firerateMs = core.WEAPONS.Breacher.firerate * 1000;
  assert.ok(alt.pullWindowMs < firerateMs,
    'a legitimate next pull must fall outside the window, or two pulls merge into one load');
  assert.ok(alt.pullWindowMs > 50,
    'every pellet of one pull must fall inside the window, or a pull fires both loads at once');
});

test('Breacher is appended to the weapon tables without moving existing indexes', () => {
  assert.deepEqual(core.WEAPON_NAMES.slice(19, 26), ['Frag', 'Smoke', 'Flash', 'Molotov', 'Barricade', 'C4', 'Breacher']);
  assert.equal(core.weaponIndexFromName('Breacher'), 25);
  assert.equal(core.WEAPONS.Breacher.type, 'shotgun');
  assert.ok(core.WEAPON_PRICES.Breacher > 0, 'it has to be buyable');
});

test('the server owns which load a pull fires', () => {
  // Derived from time, not from anything the client sends: there is no field a
  // client could set to ask for a slug.
  assert.match(server, /function resolveShotgunLoad\(player, weapon, now\)/);
  assert.match(server, /now - player\.shotgunPull\.at > SHOTGUN_ALT\.pullWindowMs/);
  assert.match(server, /slug: player\.shotgunPull \? !player\.shotgunPull\.slug : false/,
    'the first pull of a life is buckshot');
  const resolve = server.slice(server.indexOf('function resolveShotgunLoad'));
  const body = resolve.slice(0, resolve.indexOf('\n}\n'));
  assert.doesNotMatch(body, /data\./, 'the load must not be read off the packet');
  assert.match(server, /resetShotgunLoad\(player\);/, 'a life starts on buckshot again');
});

test('a hit is worth whatever its pull was loaded with', () => {
  assert.match(server, /const load = resolveShotgunLoad\(player, weapon, now\);/);
  assert.match(server, /pellets,\n\s*load,/, 'the load is stamped on the recorded shot');
  assert.match(server, /damage = \(corr\.shot\?\.load\?\.dmg \|\| wdef\.dmg\)\[part\];/,
    'damage comes from the correlated shot, falling back to buckshot');
  // pellets drives correlateHit's allowedHits, so a slug pull must not be able
  // to pay out nine times.
  assert.match(server, /const pellets = Math\.max\(1, Number\(\(load \? load\.pellets : wdef\.pellets\) \|\| 1\)\);/);
});

test('the client keeps the weapon entry describing the next pull', () => {
  assert.match(client, /name: 'Breacher', type: 'shotgun'/);
  assert.match(client, /const BREACHER_LOADS = \{[\s\S]*?buckshot: \{[\s\S]*?slug: \{/);
  assert.match(client, /Object\.assign\(wp, BREACHER_LOADS\[breacherSlugLoaded \? 'slug' : 'buckshot'\]\)/);
  assert.match(client, /if \(wp\.name === SHOTGUN_ALT\.weapon\) advanceBreacherLoad\(\);/);
  assert.match(client, /function resetBreacherLoad\(\) \{ applyBreacherLoad\(false\); \}/);
  assert.match(client, /resetBreacherLoad\(\);\n\s*ammoState = weapons\.map/, 'a respawn re-chambers buckshot');
  // The HUD has to say which load is up, or the spread change is the only tell.
  assert.match(client, /breacherSlugLoaded \? 'SLUG' : 'BUCK'/);
  assert.match(client, /deathmatchMainWeaponIndexes = \[3, 4, 5, 6, 7, 8, 9, 10, 25\]/, 'it must be buyable');
});

test('the shipped model is wired up', () => {
  const glb = path.join(ROOT, 'assets/weapons/breacher.glb');
  assert.ok(fs.existsSync(glb));
  const bytes = fs.readFileSync(glb);
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
  assert.ok(bytes.length < 512 * 1024, 'a weapon model should stay small');
  assert.match(client, /'Breacher': \{ path: '\/assets\/weapons\/breacher\.glb', axis: 'x'/);
  // Sketchfab records the CC BY author and licence in the file itself; shipping
  // the metadata is part of the attribution.
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.match(json.asset.extras.license, /CC-BY/);
  assert.ok(json.asset.extras.author, 'the author credit must survive in the shipped file');
  const notices = fs.readFileSync(path.join(ROOT, '../../THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.match(notices, /tinycomputer/, 'CC BY requires the author credit in the notices too');
  assert.match(notices, /Blender3D/);
});
