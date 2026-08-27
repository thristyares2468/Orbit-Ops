// Last updated: 15 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Validates the GLB character rigs expected by third-person, spectate, and MVP
// presentation paths. This catches missing hand bones before runtime.
function readGlbJson(file) {
  const buffer = fs.readFileSync(file);
  assert.strictEqual(buffer.toString('utf8', 0, 4), 'glTF', `${file} is not a GLB`);
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    offset += 8;
    if (type === 0x4E4F534A) return JSON.parse(buffer.toString('utf8', offset, offset + length));
    offset += length;
  }
  throw new Error(`${file} has no JSON chunk`);
}

function names(list = []) {
  return new Set(list.map(item => item?.name).filter(Boolean));
}

const requiredBones = [
  'Bip01 R Hand',
  'Bip01 L Hand',
  'Bip01 R Forearm',
  'Bip01 L Forearm'
];

const requiredClips = [
  'idle1',
  'walk',
  'run',
  'back',
  'left',
  'right',
  'crouchrun',
  'crouch_idle',
  'jump',
  'death1',
  'death2',
  'death3',
  'crouch_die',
  'ref_aim_ak47_blend05',
  'ref_shoot_ak47_blend05',
  'ref_reload_ak47',
  'ref_aim_onehanded_blend05',
  'ref_shoot_onehanded_blend05',
  'ref_reload_onehanded',
  'ref_aim_mp5_blend05',
  'ref_shoot_mp5_blend05',
  'ref_reload_mp5',
  'ref_aim_rifle_blend05',
  'ref_shoot_rifle_blend05',
  'ref_reload_rifle',
  'ref_aim_shotgun_blend05',
  'ref_shoot_shotgun_blend05',
  'ref_reload_shotgun',
  'ref_aim_knife_blend05',
  'ref_shoot_knife_blend05',
  'ref_aim_grenade_blend05',
  'ref_shoot_grenade_blend05',
  'crouch_aim_ak47_blend05',
  'crouch_shoot_ak47_blend05',
  'crouch_reload_ak47',
  'crouch_aim_onehanded_blend05',
  'crouch_shoot_onehanded_blend05',
  'crouch_reload_onehanded',
  'crouch_aim_mp5_blend05',
  'crouch_shoot_mp5_blend05',
  'crouch_reload_mp5',
  'crouch_aim_rifle_blend05',
  'crouch_shoot_rifle_blend05',
  'crouch_reload_rifle',
  'crouch_aim_shotgun_blend05',
  'crouch_shoot_shotgun_blend05',
  'crouch_reload_shotgun',
  'crouch_aim_knife_blend05',
  'crouch_shoot_knife_blend05',
  'crouch_aim_grenade_blend05',
  'crouch_shoot_grenade_blend05'
];

let referenceClipNames = null;
for (const rel of ['assets/characters/ct/SAS.glb', 'assets/characters/t/phoenix.glb']) {
  const file = path.join(__dirname, '..', rel);
  const json = readGlbJson(file);
  const nodeNames = names(json.nodes);
  const clipNames = names(json.animations);
  assert.strictEqual(clipNames.size, 298, `${rel} should expose the full imported 298-clip set`);
  for (const anim of json.animations || []) {
    assert.ok(anim.name, `${rel} has an unnamed animation clip`);
    assert.ok(Array.isArray(anim.channels) && anim.channels.length > 0, `${rel} clip ${anim.name} has no channels`);
  }
  if (!referenceClipNames) referenceClipNames = clipNames;
  else {
    for (const clip of referenceClipNames) assert.ok(clipNames.has(clip), `${rel} missing shared clip ${clip}`);
    for (const clip of clipNames) assert.ok(referenceClipNames.has(clip), `${rel} has unexpected non-shared clip ${clip}`);
  }
  for (const bone of requiredBones) {
    assert.ok(nodeNames.has(bone), `${rel} missing skeleton bone ${bone}`);
  }
  for (const clip of requiredClips) {
    assert.ok(clipNames.has(clip), `${rel} missing animation clip ${clip}`);
  }
}

console.log('character-assets: skeleton hand sockets and animation clips verified.');
