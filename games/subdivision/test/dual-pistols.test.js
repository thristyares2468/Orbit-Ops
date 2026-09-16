const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../core');
const server = fs.readFileSync(require.resolve('../server'), 'utf8');
const source = server.match(/function isWeaponAvailableInMode\(room, weaponName\) \{[\s\S]*?\n\}/)[0];
const adminRoom = {};
// The real set, read out of server.js rather than fabricated here. A stub set
// once claimed Dual Berettas was casual-only and hid the fact that the server
// genuinely still listed it - which would have blocked the weapon in
// deathmatch and TDM while every client-side gate said it was buyable.
const casualOnlySource = server.match(/const CASUAL_ONLY_WEAPONS = new Set\(\[[^\]]*\]\);/)[0];
const scope = {
  WEAPONS: core.WEAPONS,
  isAdminRoom: room => room === adminRoom,
  isCasualMode: room => !!room?.casual,
  isWeaponDisabledByAdmin: room => !!room?.disabled
};
vm.createContext(scope);
// A lexical declaration in a vm context never lands on the context object.
vm.runInContext(casualOnlySource.replace('const ', 'var '), scope);
vm.runInContext(source, scope);
assert.ok(!scope.CASUAL_ONLY_WEAPONS.has('Dual Berettas'),
  'the server must not treat the duals as casual-only');
// Open in every mode now, not just the admin room it was tuned in.
for (const room of [{}, {casual:true}, {settings:{gamemode:'containment'}}, adminRoom, null]) {
  assert.equal(scope.isWeaponAvailableInMode(room,'Dual Berettas'),true);
}
// An admin disabling it must still work everywhere.
assert.equal(scope.isWeaponAvailableInMode({disabled:true},'Dual Berettas'),false);
// The generic adminOnly gate stays covered even though no weapon uses it now.
scope.WEAPONS['__TestAdminOnly'] = { adminOnly: true };
assert.equal(scope.isWeaponAvailableInMode({},'__TestAdminOnly'),false);
assert.equal(scope.isWeaponAvailableInMode(adminRoom,'__TestAdminOnly'),true);
delete scope.WEAPONS['__TestAdminOnly'];
assert.ok(!core.WEAPONS['Dual Berettas'].adminOnly, 'the duals are no longer admin-only');
assert.equal(core.WEAPONS['Dual Berettas'].mag,24);
assert.equal(core.WEAPONS['Dual Berettas'].reserve,72);
// Three spare magazines, not a loose round count.
assert.equal(core.WEAPONS['Dual Berettas'].reserve % core.WEAPONS['Dual Berettas'].mag, 0);
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

// The muzzle flash and the viewmodel are positioned by two calls a long way
// apart in the file. They drifted apart once; a flash that starts beside the
// barrel instead of at it is the visible symptom, so pin them to one constant.
assert.match(client, /const DUAL_PISTOL_SPREAD = [\d.]+;/, 'the spread is a named constant');
assert.match(client, /dualShotSide \* DUAL_PISTOL_SPREAD - WEAPON_REST_POS\.x/, 'the muzzle flash reads it');
assert.match(client, /side \* DUAL_PISTOL_SPREAD - WEAPON_REST_POS\.x/, 'the GLB pair reads it');
// The stand-in has to land where the GLB lands, or the guns jump on load.
const standIn = client.match(/case 'Dual Berettas': \[-1, 1\]\.forEach\(side => createPistol\(\{[^}]*\}\)\)/);
assert.ok(standIn, 'the stand-in builds a pair through createPistol');
assert.match(standIn[0], /DUAL_PISTOL_SPREAD - WEAPON_REST_POS\.x/, 'the stand-in reads the same spread and recentring');
assert.equal((client.match(/\[-0\.34, 0\.34\]\.forEach/g) || []).length, 0,
    'the third-person stand-in no longer draws two pistols in a single hand holder');
console.log('Dual pistols: 24-round mags with 3 spare; flash, viewmodel and stand-in share one spread.');

// Buyable from the sidearm list in every mode, not appended only in the admin
// room. 17 is Dual Berettas (weapons[] index is id - 1, and its id is 18).
const sidearms = client.match(/const baseSidearmIndexes = \[([^\]]*)\];/);
assert.ok(sidearms, 'the sidearm list still exists');
assert.ok(sidearms[1].split(',').map(v => v.trim()).includes('17'),
  'the duals are a normal buyable sidearm');
const avail = client.slice(client.indexOf('function availableSidearmIndexes'));
assert.doesNotMatch(avail.slice(0, avail.indexOf('}') + 1), /isAdminRoom/u,
  'the sidearm list no longer gates on the admin room');
console.log('Dual pistols: open in every mode and buyable as a normal sidearm.');
