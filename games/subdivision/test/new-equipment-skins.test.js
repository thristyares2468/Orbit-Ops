'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const subdivisionRoot = path.resolve(__dirname, '..');
const skins = require('../skins');

const expected = {
  Shield: ['shield_aurora_aegis', 'shield_crimson_bulwark'],
  Breacher: ['breacher_ember_entry', 'breacher_night_entry'],
  RPG: ['rpg_orbital_energy', 'rpg_launch_control']
};

test('new equipment has two selectable pattern skins each', () => {
  const catalog = skins.publicCatalog();
  for (const [weapon, ids] of Object.entries(expected)) {
    const items = catalog.items.filter((item) => item.weapon === weapon);
    assert.deepEqual(items.map((item) => item.id).sort(), ids.sort());
    for (const item of items) {
      assert.equal(item.textureApplication, 'pattern');
      assert.ok(item.textureMaterialNames.length > 0);
      assert.ok(fs.existsSync(path.join(subdivisionRoot, item.texturePath.replace(/^\/assets\//, 'assets/'))), item.texturePath);
      assert.ok(fs.existsSync(path.join(subdivisionRoot, item.modelPath.replace(/^\/assets\//, 'assets/'))), item.modelPath);
    }
  }
});

test('RPG skins leave rockets, sights and hardware on their authored materials', () => {
  for (const id of expected.RPG) {
    const item = skins.getItem(id);
    assert.ok(item.textureMaterialNames.includes('launcher'));
    for (const preserved of ['rocket', 'rocket_.001', 'aimer', 'rings', 'nut_bolts', 'trigger']) {
      assert.ok(!item.textureMaterialNames.includes(preserved), `${id} must preserve ${preserved}`);
    }
  }
});
