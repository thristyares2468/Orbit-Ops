'use strict';

// The M4A1 was added to fill the role the AK vacated when it was slowed from ten
// rounds per second to 4.25, and to fill it the way the FPS lineage this game
// borrows from always has: the AK hits harder and one-shots to the head, the M4
// shoots faster, spreads less and costs more. These tests pin the relationships
// rather than the raw numbers wherever a relationship is what was actually
// decided, so retuning one rifle cannot quietly erase the distinction.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const core = require('../core.js');
const skins = require('../skins.js');

const root = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const m4 = core.WEAPONS.M4A1;
const ak = core.WEAPONS.AK47;

test('the M4A1 fires at exactly the rate the AK47 used to', () => {
  // 0.1s between shots - ten rounds per second - is the AK's own value from
  // before it was slowed. Asserted as a literal because it is a restored
  // historical number, not a value derived from the AK's current one.
  assert.strictEqual(m4.firerate, 0.1);
  assert.ok(m4.firerate < ak.firerate,
    'the M4 must be the faster of the two rifles');
  assert.strictEqual(m4.firerate, core.WEAPONS.FAMAS.firerate,
    'the FAMAS kept that cadence and is the only surviving reference for it');
});

test('the M4A1 trades per-shot damage for that rate of fire', () => {
  assert.ok(m4.dmg.body < ak.dmg.body, 'the AK must still hit harder per shot');
  assert.ok(m4.dmg.body > core.WEAPONS.FAMAS.dmg.body,
    'the M4 costs more than the FAMAS and must out-damage it per shot');
  // The single most important line here. A one-shot headshot is the AK's
  // identity; a rifle that fires twice as fast must not also have it.
  assert.ok(m4.dmg.head < 100, 'the M4 must not one-shot a full-health head');
  assert.ok(ak.dmg.head >= 100, 'the AK must keep its one-shot headshot');
  // Sustained damage still favours the M4 - that is what it is buying - but it
  // must not exceed the old ten-rounds-per-second AK that was judged too strong.
  const dps = (w) => w.dmg.body / w.firerate;
  assert.ok(dps(m4) > dps(ak), 'the M4 should win a sustained body-shot trade');
  assert.ok(dps(m4) < ak.dmg.body / 0.1,
    'the M4 must stay below the pre-nerf AK it is replacing, not restore it');
});

test('the M4A1 costs more than the AK47', () => {
  assert.ok(core.WEAPON_PRICES.M4A1 > core.WEAPON_PRICES.AK47,
    'the faster, easier rifle is the more expensive one');
});

test('the M4A1 is appended to WEAPON_NAMES, not inserted', () => {
  // WEAPON_NAMES is the snapshot encoder's index order. Slotting the M4 in
  // beside the other rifles would shift every index above it and silently
  // re-label weapons already in flight.
  assert.strictEqual(core.WEAPON_NAMES.at(-1), 'M4A1');
  assert.strictEqual(core.WEAPON_NAMES.indexOf('AK47'), 8);
  assert.strictEqual(core.WEAPON_NAMES.indexOf('Knife'), 0);
  assert.strictEqual(new Set(core.WEAPON_NAMES).size, core.WEAPON_NAMES.length);
});

test('the client reads the authoritative M4A1 numbers rather than restating them', () => {
  const entry = client.match(/\{ id: 30, name: 'M4A1'[^\n]+/u)?.[0] || '';
  assert.ok(entry, 'the client weapons table should define the M4A1');
  assert.match(entry, /firerate: window\.GameCore\.WEAPONS\.M4A1\.firerate/u);
  assert.match(entry, /damage: window\.GameCore\.WEAPONS\.M4A1\.dmg\.body/u);
  assert.match(entry, /auto: true/u, 'an assault rifle is fully automatic');
  assert.doesNotMatch(entry, /firerate: 0\.1[,\s]/u,
    'a hard-coded client rate would let presentation and enforcement drift');
});

test('the M4A1 is buyable as a primary', () => {
  const indexes = client.match(/const deathmatchMainWeaponIndexes = \[([^\]]+)\]/u)?.[1] || '';
  const parsed = indexes.split(',').map((value) => Number(value.trim()));
  // The buy list holds positions in the client weapons[] array, which is built
  // in the same order as WEAPON_NAMES, so the M4A1 is its last entry.
  assert.ok(parsed.includes(core.WEAPON_NAMES.length - 1),
    'the M4A1 should appear in the primary weapon buy list');
});

test('the M4A1 has both a downloaded model and a procedural stand-in', () => {
  // m4a1.glb is 11MB. Without a stand-in the player holds nothing at all for as
  // long as that takes, which is exactly the gap the RPG and Minigun had.
  assert.ok(fs.existsSync(path.join(root, 'assets', 'weapons', 'm4a1.glb')),
    'the M4A1 GLB should be installed');
  assert.match(client, /'M4A1': \{ path: '\/assets\/weapons\/m4a1\.glb'/u);
  assert.match(client, /case 'M4A1': \{/u,
    'buildGunModel needs an M4A1 branch or the fallback is an empty pair of hands');
});

test('the M4A1 mythic skin is a real, reachable model', () => {
  const skin = skins.getItem('m4a1_vanguard');
  assert.ok(skin, 'the mythic M4A1 should be in the catalogue');
  assert.strictEqual(skin.weapon, 'M4A1');
  assert.strictEqual(skin.rarity, 'mythic');
  assert.strictEqual(skin.kind, 'model', 'it replaces the rifle rather than texturing it');
  assert.ok(fs.existsSync(path.join(root, skin.modelPath.replace(/^\//u, ''))),
    `${skin.modelPath} should exist on disk`);
  // Its source runs +X toward the stock, the opposite of the base M4A1 GLB, so
  // it needs a half turn on top of the quarter turn in the weapon's asset spec.
  // Gameplay and inventory preview normalise assetAxis 'z' separately and so
  // each need their own. Pinned because the failure is invisible to a bounds
  // check - a 180deg yaw leaves size and centre identical - and an earlier pass
  // dropped these on exactly that evidence and shipped the rifle backwards.
  assert.strictEqual(skin.assetAxis, 'z');
  assert.strictEqual(skin.gameplayYaw, Math.PI, 'the model points backwards without this');
  assert.strictEqual(skin.previewYaw, Math.PI, 'the preview points backwards without this');
});

test('the M4A1 models stay inside a sane download and draw budget', () => {
  // The mythic shipped as a 17MB, 415k-triangle CAD export. It is a viewmodel
  // drawn every frame and a file fetched under a 20s load timeout, so both the
  // byte size and the triangle count matter. The AK47 is the reference for what
  // a rifle in this game costs.
  const glbTris = (file) => {
    const buf = fs.readFileSync(file);
    let off = 12, json = null;
    while (off < buf.length) {
      const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
      off += 8;
      if (type === 0x4e4f534a) json = JSON.parse(buf.slice(off, off + len).toString('utf8'));
      off += len;
    }
    return json.meshes.reduce((total, mesh) => total + mesh.primitives.reduce((n, prim) => {
      const acc = json.accessors[prim.indices ?? prim.attributes.POSITION];
      return n + acc.count / 3;
    }, 0), 0);
  };
  const mythic = path.join(root, 'assets/skins/m4a1/vanguard.glb');
  const ak = path.join(root, 'assets/weapons/ak47.glb');
  assert.ok(fs.statSync(mythic).size < 3 * 1024 * 1024,
    `the mythic GLB is ${(fs.statSync(mythic).size / 1e6).toFixed(1)}MB; it belongs under 3MB`);
  assert.ok(glbTris(mythic) < glbTris(ak) * 2,
    `the mythic is ${glbTris(mythic)} tris against the AK's ${glbTris(ak)}`);

  // The base rifle loads alongside the skin - for the viewmodel, the buy menu,
  // dropped pickups and every other player holding one - so its download is
  // part of what equipping the mythic actually costs. It shipped as 10.7MB,
  // almost all of it lossless PNG for a model with no alpha anywhere.
  const base = path.join(root, 'assets/weapons/m4a1.glb');
  assert.ok(fs.statSync(base).size < 5 * 1024 * 1024,
    `the base M4A1 GLB is ${(fs.statSync(base).size / 1e6).toFixed(1)}MB; it belongs under 5MB`);

  // The dart is spawned per shot and several can be alive at once, so it has to
  // stay far cheaper than a weapon.
  const dart = path.join(root, 'assets/skins/m4a1/dart.glb');
  assert.ok(fs.statSync(dart).size < 512 * 1024,
    `the dart GLB is ${(fs.statSync(dart).size / 1024).toFixed(0)}KB; it belongs under 512KB`);
});

test('the inventory showroom fit survives a source authored at millimetre scale', () => {
  // The mythic GLB is authored hundreds of units long against the base rifle's
  // three. The showroom fit sizes a model by projecting it through the camera,
  // which is only meaningful while the model is in front of that camera - at
  // scale 1 this one starts behind the near plane, project() returns garbage,
  // and the refinement passes turn it into a wild zoom. It shipped that way:
  // the inspect view showed one corner of the receiver filling the frame.
  //
  // Both halves are pinned because each is invisible on its own. Neither shows
  // up on any normally scaled weapon, so nothing else in the suite covers them.
  const fit = client.slice(client.indexOf('function fitInventoryShowroomHolder'));
  const body = fit.slice(0, fit.indexOf('\n        function ', 1));

  assert.match(body, /scale \*= Math\.min\(1, cameraHeightAtModel \/ Math\.max\(size\.x, size\.y, size\.z/u,
    'the fit should bring an oversized box into frame before it measures anything');
  // Capped at 1, so every already-sane model keeps the framing it has today.
  assert.match(body, /Math\.min\(1, cameraHeightAtModel/u,
    'the pre-fit must never enlarge, or existing skins reframe');

  const pass = body.slice(body.indexOf('for (let pass'));
  assert.match(pass.slice(0, pass.indexOf('}')), /holder\.position\.set\(-center\.x \* scale/u,
    'each pass must recentre by the scaled offset, or it measures the model off-axis');
});

test('the Nerf or Nothing fires its dart from both the local and remote shot paths', () => {
  // An opponent seeing the default streak while the shooter sees darts is the
  // easy half of this to get wrong, so both spawn sites are pinned. The skin
  // carries the path itself rather than the client keying off its id, so a
  // later tracer skin needs no change here.
  const skin = skins.getItem('m4a1_vanguard');
  assert.strictEqual(skin.tracerModelPath, '/assets/skins/m4a1/dart.glb');

  assert.match(client, /const bulletMesh = buildTracerMesh\(equippedSkinItem\(wp\.name\)/u,
    'the local shot should build its tracer from the equipped skin');
  assert.match(client, /const bulletMesh = buildTracerMesh\(remoteSkinItem/u,
    'a remote shot should build its tracer from that player\'s synced skin');

  // Tracers are removed from the scene without being disposed, so every instance
  // has to share one geometry and material or firing leaks GPU memory.
  assert.match(client, /if \(template\) return template\.clone\(\)/u,
    'dart instances should be clones of a single template');
});

test('the M4A1 has its own sound, recoil and inspect entries', () => {
  // A new weapon that falls through every presentation table is playable but
  // reads as broken: silent, recoil-less and unanimated.
  for (const table of ['weaponShotSfx', 'weaponDrawSfx', 'weaponReloadSfx']) {
    const body = client.slice(client.indexOf(`const ${table} = {`));
    assert.match(body.slice(0, body.indexOf('};')), /M4A1:/u,
      `${table} should cover the M4A1`);
  }
  const patterns = client.slice(client.indexOf('const RECOIL_PATTERNS = {'));
  assert.match(patterns.slice(0, patterns.indexOf('};')), /M4A1: \[\[/u,
    'the M4 should have its own recoil pattern, not fall back to none');
});

test('the M4A1 recoil pattern is the controllable one', () => {
  // The M4's defining trait in this genre is control, so this is pinned against
  // the AK's table rather than against absolute numbers: retuning the AK should
  // force a decision about the M4 rather than silently invert the relationship.
  const read = (name) => {
    const body = client.slice(client.indexOf('const RECOIL_PATTERNS = {'));
    const row = body.slice(0, body.indexOf('};')).match(new RegExp(`${name}: (\\[\\[[^\\n]+?\\]\\]),`, 'u'))?.[1];
    assert.ok(row, `${name} should have a recoil pattern`);
    return JSON.parse(row);
  };
  const m4Pattern = read('M4A1');
  const akPattern = read('AK47');
  assert.strictEqual(m4Pattern.length, akPattern.length,
    'both rifles should carry a pattern of the same length to compare shot for shot');
  for (let shot = 0; shot < m4Pattern.length; shot += 1) {
    assert.ok(m4Pattern[shot][0] < akPattern[shot][0],
      `shot ${shot + 1} should kick less on the M4 than on the AK`);
    assert.ok(Math.abs(m4Pattern[shot][1]) <= Math.abs(akPattern[shot][1]),
      `shot ${shot + 1} should wander sideways no more on the M4 than on the AK`);
  }
  const horizontal = (pattern) => pattern.reduce((sum, [, x]) => sum + Math.abs(x), 0);
  assert.ok(horizontal(m4Pattern) < horizontal(akPattern) * 0.75,
    'the M4 should be markedly easier to hold on target horizontally, not marginally');
});
