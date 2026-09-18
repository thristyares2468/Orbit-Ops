'use strict';

// The Nerf mythics are ten different guns rather than ten texture wraps, so each
// one is a GLB that has to be found, aimed and fired. What makes them checkable
// is that the assets are stored canonical - muzzle down -Z, up +Y - with every
// correction baked in, which leaves each skin's two yaws meaning exactly one
// thing: gameplayYaw cancels whatever rot the weapon's own asset spec adds, and
// previewYaw re-aims a preview path that never applies that rot. Those are
// pinned here because a wrong yaw is invisible to a bounds check
// - a 180deg turn leaves a Box3's size and centre identical - and an earlier
// pass removed one on that evidence and shipped a rifle pointing backwards.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const skins = require('../skins.js');

const root = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const DART = '/assets/skins/shared/nerf_dart.glb';

// weapon, display name, path, gameplayYaw, previewYaw. The yaws are spelled out
// per skin rather than derived, so a change to one cannot silently ride in on a
// helper's default.
const NERF = [
  ['m4a1_vanguard', 'AK47', 'AK47 | Elite Retaliator', '/assets/skins/ak47/vanguard.glb', 0, 0],
  ['glock_jolt', 'Glock', 'Glock | Jolt', '/assets/skins/glock/jolt.glb', 0, 0],
  ['mac10_retaliator', 'MAC10', 'MAC10 | Retaliator', '/assets/skins/mac10/retaliator.glb', 0, 0],
  // The one asset that could not be baked: its source uses pbrSpecularGlossiness,
  // which three r135 renders but the glTF tooling here refuses to read, so it
  // carries its quarter turn in the yaws instead.
  ['deagle_firestrike_elite', 'Deagle', 'Deagle | Firestrike Elite', '/assets/skins/deagle/firestrike.glb', Math.PI / 2, Math.PI / 2],
  ['p90_delete', 'P90', 'P90 | Delete', '/assets/skins/p90/delete.glb', 0, 0],
  ['awp_heavy_sniper', 'AWP', 'AWP | Heavy Sniper', '/assets/skins/awp/heavy_sniper.glb', 0, 0],
  // Dual Berettas' spec adds a half turn in first person; the knife's does too.
  ['dual_berettas_doublestrike', 'Dual Berettas', 'Dual Berettas | Doublestrike', '/assets/skins/dual_berettas/doublestrike.glb', Math.PI, 0],
  // The preview's knife branch turns the blade on a different axis, so this one
  // needs its own half turn there even though the guns above take none.
  ['knife_toy_nerf', 'Knife', 'Knife | Toy Knife', '/assets/skins/knife/toy/toy.glb', Math.PI, Math.PI],
  ['m4a1_g36', 'M4A1', 'M4A1 | G36', '/assets/skins/m4a1/g36.glb', -Math.PI / 2, 0],
  ['ssg08_super_soaker', 'SSG 08', 'SSG 08 | Super Soaker 50', '/assets/skins/ssg08/super_soaker.glb', 0, 0]
];

test('every Nerf mythic is a real model on the weapon it was authored for', () => {
  for (const [id, weapon, displayName, modelPath, gameplayYaw, previewYaw] of NERF) {
    const skin = skins.getItem(id);
    assert.ok(skin, `${id} should be in the catalogue`);
    assert.strictEqual(skin.weapon, weapon, `${id} is on the wrong weapon`);
    assert.strictEqual(skin.displayName, displayName, `${id} is named wrong`);
    assert.strictEqual(skin.rarity, 'mythic', `${id} should be mythic`);
    assert.strictEqual(skin.kind, 'model', `${id} replaces the gun rather than texturing it`);
    assert.strictEqual(skin.modelPath, modelPath, `${id} points at the wrong GLB`);
    assert.strictEqual(skin.assetAxis, 'z', `${id} is stored aimed down -Z`);
    assert.strictEqual(skin.gameplayYaw, gameplayYaw, `${id} would render turned in first person`);
    assert.strictEqual(skin.previewYaw, previewYaw, `${id} would render turned in the showroom`);
    assert.ok(fs.existsSync(path.join(root, modelPath.replace(/^\//u, ''))),
      `${modelPath} should exist on disk`);
  }
});

test('every Nerf mythic fires the dart rather than the default streak', () => {
  // The path rides on the skin rather than the client keying off ids, which is
  // what lets a later tracer skin need no change in index.html.
  for (const [id] of NERF) {
    assert.strictEqual(skins.getItem(id).tracerModelPath, DART, `${id} should fire the dart`);
  }
  assert.ok(fs.existsSync(path.join(root, DART.replace(/^\//u, ''))), 'the dart GLB should exist');
});

test('the Nerf mythics stay inside a viewmodel download budget', () => {
  // Each is fetched under the client's load timeout and drawn every frame, so a
  // raw CAD export is not shippable here - the first one arrived at 17MB.
  for (const [id, , , modelPath] of NERF) {
    const size = fs.statSync(path.join(root, modelPath.replace(/^\//u, ''))).size;
    assert.ok(size < 3 * 1024 * 1024, `${id} is ${(size / 1e6).toFixed(1)}MB; it belongs under 3MB`);
  }
});

test('the Doublestrike ships two pistols, because the splitter halves the model', () => {
  // dualPistolPart cuts the template at its world-X midpoint and hands one half
  // to each hand. A single pistol authored here would arrive on screen sawn in
  // two, so the GLB carries a side-by-side pair the way dual_elite.glb does.
  const glb = fs.readFileSync(path.join(root, 'assets/skins/dual_berettas/doublestrike.glb'));
  let off = 12, json = null;
  while (off < glb.length) {
    const len = glb.readUInt32LE(off), type = glb.readUInt32LE(off + 4);
    off += 8;
    if (type === 0x4e4f534a) json = JSON.parse(glb.slice(off, off + len).toString('utf8'));
    off += len;
  }
  const meshUses = json.nodes.filter((node) => node.mesh !== undefined).length;
  assert.ok(meshUses >= 2, 'the Doublestrike should carry a duplicated pistol, not a single one');
  assert.match(client, /function dualPistolPart\(template, side\)/u,
    'the splitter this pairing exists for should still be there');
});

test('the toy knife reads as its own knife type', () => {
  // knifeTypeForItem derives the type from the /knife/<type>/ segment, so the
  // file has to sit under its own folder or the inspect panel labels it wrong.
  assert.strictEqual(skins.getItem('knife_toy_nerf').knifeType, 'Toy');
});

// The offsets below were read off first-person screenshots, so the numbers
// themselves are not worth re-asserting - what is worth holding is that the
// builder still reads them. Without these two lines the skins load fine and
// simply sit under the bottom of the screen, which no other test would catch.
test('the viewmodel builder still honours a skin gameplay offset', () => {
  assert.match(client, /const skinOffset = skinItem\?\.gameplayOffset;/u,
    'buildWeaponAssetInstance should still read gameplayOffset');
  assert.match(client, /rig\.position\.y \+= Number\(skinOffset\[1\]\) \|\| 0;/u,
    'the offset should still be added to the rig position');

  const lifted = NERF.map(([id]) => skins.getItem(id)).filter((skin) => skin.gameplayOffset);
  assert.ok(lifted.length, 'some Nerf mythics sit low enough to need lifting');
  for (const skin of lifted) {
    assert.strictEqual(skin.gameplayOffset.length, 3, `${skin.id}'s offset should be x, y, z`);
    for (const value of skin.gameplayOffset) {
      assert.ok(Number.isFinite(value), `${skin.id}'s offset should be numbers`);
      assert.ok(Math.abs(value) < 2, `${skin.id}'s offset of ${value} would throw it off screen`);
    }
  }
});
