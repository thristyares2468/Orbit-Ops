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

test('new equipment has an expanded selectable pattern catalog', () => {
  const catalog = skins.publicCatalog();
  for (const [weapon, ids] of Object.entries(expected)) {
    const items = catalog.items.filter((item) => item.weapon === weapon);
    assert.ok(items.length >= 10);
    for (const id of ids) assert.ok(items.some(item => item.id === id));
    for (const item of items) {
      assert.equal(item.textureApplication, item.id === 'shield_rexton' ? 'embedded' : 'pattern');
      assert.ok(item.textureMaterialNames.length > 0);
      assert.ok(fs.existsSync(path.join(subdivisionRoot, item.texturePath.replace(/^\/assets\//, 'assets/'))), item.texturePath);
      assert.ok(fs.existsSync(path.join(subdivisionRoot, item.modelPath.replace(/^\/assets\//, 'assets/'))), item.modelPath);
    }
  }
});

test('RPG skins leave rockets, sights and hardware on their authored materials', () => {
  for (const item of skins.publicCatalog().items.filter(item => item.weapon === 'RPG')) {
    const id = item.id;
    assert.ok(item.textureMaterialNames.includes('launcher'));
    for (const preserved of ['rocket', 'rocket_.001', 'aimer', 'rings', 'nut_bolts', 'trigger']) {
      assert.ok(!item.textureMaterialNames.includes(preserved), `${id} must preserve ${preserved}`);
    }
  }
});

test('Franklin uses the shipped money pattern and Rexton is a fixed photo', () => {
  assert.equal(skins.getItem('rpg_franklin').texturePath, '/assets/skins/imported/patterns/franklin.png');
  const rexton = skins.getItem('shield_rexton');
  assert.equal(rexton.displayName, 'Shield | Rexton');
  assert.equal(rexton.textureApplication, 'embedded');
  const data = fs.readFileSync(path.join(subdivisionRoot, rexton.modelPath));
  const json = JSON.parse(data.toString('utf8', 20, 20 + data.readUInt32LE(12)));
  assert.equal(json.meshes[0].primitives.length, 2, 'original shield and surface decal');
  assert.ok(json.materials.some(material => material.name === 'Rexton Photo'));
});
