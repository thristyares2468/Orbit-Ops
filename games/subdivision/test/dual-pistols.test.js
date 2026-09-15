const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../core');
const server = fs.readFileSync(require.resolve('../server'), 'utf8');
const source = server.match(/function isWeaponAvailableInMode\(room, weaponName\) \{[\s\S]*?\n\}/)[0];
const adminRoom = {};
const scope = {
  WEAPONS: core.WEAPONS,
  CASUAL_ONLY_WEAPONS: new Set(['Dual Berettas']),
  isAdminRoom: room => room === adminRoom,
  isCasualMode: room => !!room?.casual,
  isWeaponDisabledByAdmin: room => !!room?.disabled
};
vm.createContext(scope);
vm.runInContext(source, scope);
for (const room of [{}, {casual:true}, {settings:{gamemode:'containment'}}, null]) {
  assert.equal(scope.isWeaponAvailableInMode(room,'Dual Berettas'),false);
}
assert.equal(scope.isWeaponAvailableInMode(adminRoom,'Dual Berettas'),true);
adminRoom.disabled=true;
assert.equal(scope.isWeaponAvailableInMode(adminRoom,'Dual Berettas'),false);
assert.equal(core.WEAPONS['Dual Berettas'].mag,30);
assert.equal(core.WEAPONS['Dual Berettas'].dmg.body,21);
const glb=fs.readFileSync(require('node:path').join(__dirname,'../assets/weapons/dual_elite.glb'));
assert.equal(glb.toString('ascii',0,4),'glTF');
const json=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)));
assert.ok(json.materials.some(m=>m.name==='weapon_pist_elite.001'));
assert.ok(json.meshes.every(m=>m.primitives.every(p=>p.attributes.TEXCOORD_0!==undefined)));
console.log('Dual pistols: public/casual/Containment denied, admin enabled, disabled override enforced; supplied GLB UVs intact.');

// The pistol table is a 4:1 head:body ladder, and on every pistol but the two
// lowest-damage bullet hoses a leg hit is worth less than a chest hit. An entry
// where legs beat body makes aiming at the floor the optimal play, so pin both.
const dualDmg = core.WEAPONS['Dual Berettas'].dmg;
assert.equal(dualDmg.head, dualDmg.body * 4, 'head damage is 4x body like every other pistol');
assert.ok(dualDmg.legs < dualDmg.body, `leg damage (${dualDmg.legs}) must stay under body damage (${dualDmg.body})`);

// Each half is normalised to the viewmodel length on its own, so the split has
// to happen before anything measures or scales the template. Splitting after
// would size the pair off the full model's left-to-right span (0.55) instead of
// one pistol's barrel axis (0.263), rendering two toy guns.
const client = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const buildAt = client.indexOf('function buildWeaponAssetInstance');
assert.ok(buildAt > 0, 'buildWeaponAssetInstance still exists');
const buildBody = client.slice(buildAt, buildAt + 4000);
const splitAt = buildBody.indexOf('dualPistolPart(template, side)');
const specAt = buildBody.indexOf('const spec = WEAPON_ASSET_SPECS[weaponName]');
assert.ok(splitAt > 0 && specAt > 0, 'both the dual branch and the generic path are present');
assert.ok(splitAt < specAt, 'the dual branch runs before the generic measure/scale path');
assert.match(buildBody.slice(0, splitAt), /dualSingle/, 'the recursion into a single half is guarded by a dualSingle marker');
console.log('Dual pistols: damage rewards aiming high; the pair splits before the viewmodel measures it.');
