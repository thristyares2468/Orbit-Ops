// Last updated: 15 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Static regression coverage for audio throttling, first-person tuning defaults,
// inventory equip labels, and CT/T default knife handling.
const ROOT = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

assert.ok(indexHtml.includes('const SFX_PACK_VOLUME = 0.74;'), 'new imported SFX should be globally softened');
assert.ok(indexHtml.includes('const sfxCooldowns = new Map();'), 'SFX playback should have cooldown state');
assert.ok(indexHtml.includes('function reserveSfxCooldown'), 'SFX cooldown helper should exist');
assert.ok(indexHtml.includes('const ENEMY_FOOTSTEP_BOOST = 1.72;'), 'enemy footsteps should have a clear tuning boost');
assert.ok(indexHtml.includes('const TEAMMATE_FOOTSTEP_REDUCTION = 0.48;'), 'teammate footsteps should be reduced through a named tuning constant');
assert.ok(indexHtml.includes('const WALK_FOOTSTEP_MULT = 0.28;'), 'walking footsteps should be significantly quieter');
assert.ok(indexHtml.includes("cooldownKey = pos ? (options.enemy ? 'footstep:enemy' : 'footstep:remote') : 'footstep:local'"), 'footsteps should be keyed for overlap throttling');
assert.ok(indexHtml.includes('refDistance: options.enemy ? 38 : 22'), 'enemy footsteps should carry farther than teammate footsteps');
assert.ok(indexHtml.includes('cooldownMs = pos ? 85 : (options.walking ? 220 : 150)'), 'footsteps should have local/remote cooldowns');
for (const surface of ['concrete', 'wood', 'metal', 'metal_grate', 'dirt', 'grass', 'gravel', 'sand', 'tile', 'glass']) {
  const marker = surface === 'concrete' ? 'concrete: playerSfx.footstep' : `${surface}: [`;
  assert.ok(indexHtml.includes(marker), `${surface} should have a dedicated footstep sample pool`);
}
assert.match(indexHtml, /function footstepSurfaceAt[\s\S]*?intersectObjects\(mapObjects, false\)[\s\S]*?footstepSurface/, 'footsteps should identify the map material under each player');
assert.match(indexHtml, /surfacePosition: remote\.position[\s\S]*?surfacePosition: controls\.getObject\(\)\.position/, 'remote and local footsteps should both resolve their floor material');
assert.ok(indexHtml.includes("g.kind === 'molotov'"), 'molotov should get special projectile handling');
assert.ok(indexHtml.includes('g.forceDetonate = true;'), 'molotov should detonate on impact instead of bouncing');
assert.ok(indexHtml.includes('volumeScale: 0.25'), 'grenade bounce SFX should be quieter');

assert.ok(indexHtml.includes('const DEFAULT_FP_TUNE_VALUES = {'), 'first-person tuning defaults should be baked into the client');
assert.ok(indexHtml.includes("Knife: { scale: 1.5, x: 0.15, z: -0.2 }"), 'Knife first-person defaults should match the requested values');
assert.ok(indexHtml.includes("MAC10: { scale: 0.8, x: 0.15, z: 0.15 }"), 'MAC10 first-person defaults should match the requested values');
assert.ok(indexHtml.includes("AWP: { scale: 1.5, x: 0.15, y: 0.25, z: -0.15 }"), 'AWP first-person defaults should match the requested values');
assert.ok(indexHtml.includes('function fpTuneValueFor(weapon)'), 'runtime should merge baked FP defaults with admin overrides');

assert.ok(indexHtml.includes('const INVENTORY_UNEQUIP_FLASH_MS = 2000;'), 'inventory unequip flash should last two seconds');
assert.ok(indexHtml.includes("return inventoryRecentlyUnequipped(item) ? 'Unequipped' : 'Equip';"), 'idle non-equipped inventory action should say Equip');
assert.ok(indexHtml.includes('useDefaultSkin(skin.weapon, skin.id)'), 'unequipping a skin should mark that item for the temporary Unequipped label');
assert.ok(indexHtml.includes("const DEFAULT_KNIFE_ITEM_IDS_CLIENT = ['knife_default_ct_vanilla', 'knife_default_t_vanilla'];"), 'inventory should synthesize CT and T knife defaults');
assert.ok(indexHtml.includes("id: `default:${itemId}`"), 'knife defaults should use the real CT/T knife item ids instead of a generic Default Knife');
assert.ok(indexHtml.includes("if (team === 0 || team === 1) return team === 1 ? 'knife_default_t_vanilla' : 'knife_default_ct_vanilla';"), 'default knife selection should follow CT/T team defaults');

console.log('audio-inventory-tuning: SFX throttles, inventory labels, molotov impact, and FP defaults verified.');
