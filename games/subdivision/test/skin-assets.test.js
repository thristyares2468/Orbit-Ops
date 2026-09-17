// Last updated: 15 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ITEMS, RARITIES } = require('../skins');
const IMPORTED_SKINS = require('../skins_imported');

// Asset integrity check for the skin catalog. This catches missing textures/GLBs
// and generated imported skin rows before the browser tries to render them.
const ROOT = path.resolve(__dirname, '..');

function localPath(assetPath) {
  return path.join(ROOT, String(assetPath || '').replace(/^\//, ''));
}

function readGlbJson(file) {
  const buffer = fs.readFileSync(file);
  assert.strictEqual(buffer.toString('utf8', 0, 4), 'glTF', `${file} is not a GLB`);
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    offset += 8;
    if (type === 0x4E4F534A) return JSON.parse(buffer.toString('utf8', offset, offset + length).trim());
    offset += length;
  }
  throw new Error(`${file} has no JSON chunk`);
}

for (const item of ITEMS) {
  if (item.texturePath) assert.ok(fs.existsSync(localPath(item.texturePath)), `${item.id} missing texturePath ${item.texturePath}`);
  if (item.modelPath) assert.ok(fs.existsSync(localPath(item.modelPath)), `${item.id} missing modelPath ${item.modelPath}`);
  if (item.baseModelPath) assert.ok(fs.existsSync(localPath(item.baseModelPath)), `${item.id} missing baseModelPath ${item.baseModelPath}`);
  if (item.overlayTexturePath) assert.ok(fs.existsSync(localPath(item.overlayTexturePath)), `${item.id} missing overlayTexturePath ${item.overlayTexturePath}`);
}

const runtimeSkinModelJson = new Map();
for (const item of ITEMS.filter(candidate => ['pattern', 'overlay'].includes(candidate.textureApplication))) {
  const glb = runtimeSkinModelJson.get(item.modelPath) || readGlbJson(localPath(item.modelPath));
  runtimeSkinModelJson.set(item.modelPath, glb);
  const materialNames = (glb.materials || []).map(material => String(material.name || ''));
  const targets = (item.textureMaterialNames || []).map(String);
  const targetIndexes = materialNames
    .map((name, index) => targets.some(target => target.toLowerCase() === name.toLowerCase()) ? index : -1)
    .filter(index => index >= 0);
  assert.ok(targetIndexes.length > 0, `${item.id} artwork target missing from ${item.modelPath}`);
  for (const mesh of glb.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      if (targetIndexes.includes(primitive.material)) {
        assert.notStrictEqual(primitive.attributes?.TEXCOORD_0, undefined, `${item.id} target mesh has no UV coordinates`);
      }
    }
  }
}

const RARITY_IDS = new Set(RARITIES.map(rarity => rarity.id));

const akSkins = ITEMS.filter(item => item.weapon === 'AK47' && item.kind === 'skin');
assert.ok(akSkins.length >= 22, 'AK47 skin catalog should include the validated pack minus knife-only finishes');
assert.ok(!akSkins.some(item => item.id === 'ak47_cartel'), 'legacy Cartel AK skin should not ship in the replacement pack');
assert.ok(!akSkins.some(item => item.modelPath?.includes('ice-coaled')), 'legacy hyphenated AK Ice Coaled GLB should not ship');
assert.ok(!fs.existsSync(localPath('/assets/skins/ak47/ice-coaled.glb')), 'legacy hyphenated AK Ice Coaled GLB file should be removed');

const awpSkins = ITEMS.filter(item => item.weapon === 'AWP' && item.kind === 'skin');
assert.ok(awpSkins.length >= 25, 'AWP skin catalog should include the supplied pack plus imported metadata skins');
assert.ok(awpSkins.some(item => item.id === 'awp_bingle'), 'AWP Bingle should ship as a supplied prim2 skin');
assert.ok(awpSkins.some(item => item.id === 'awp_jog'), 'AWP Jog should ship as a supplied prim2 skin');
assert.ok(awpSkins.some(item => item.id === 'awp_sovereign_flame' && item.textureApplication === 'overlay'), 'AWP Sovereign Flame should ship on the supplied prim2 material');
// This used to assert the opposite - that firearm skins carried NO catalog
// rarity, so that a case drop was the only thing that could classify one. The
// rule was well meant but the data never matched it: 262 of the 263 non-knife
// skins already declared an authored tier, and enrichCatalogItem threw every
// one away. The cost was silent: normalizeRarity(null) is 'common', so any case
// entry saved without a hand-picked rarity turned into a Common drop, AWP
// Dragon Lore included.
//
// What that rule was really protecting is kept below: a case entry that sets a
// rarity still overrides the catalog, so case assignment remains authoritative
// wherever it is actually used.
assert.ok(ITEMS.every(item => RARITY_IDS.has(item.rarity)),
  'every catalog skin should carry a valid rarity');
// Mythic is no longer "knife", it is "authored as Mythic in the catalogue" -
// the M4A1 Vanguard is the one firearm on that list. What still has to hold is
// that the list is short and deliberate rather than open to every firearm.
assert.deepStrictEqual(
  ITEMS.filter(item => item.weapon !== 'Knife' && item.rarity === 'mythic').map(item => item.id).sort(),
  ['m4a1_vanguard'],
  'mythic should stay an authored allowlist');
assert.ok(ITEMS.filter(item => item.weapon === 'Knife').every(item => item.rarity === 'mythic'),
  'every knife, including defaults, should be Mythic');
const dualBerettasSkins = ITEMS.filter(item => item.weapon === 'Dual Berettas' && item.kind === 'skin');
assert.strictEqual(dualBerettasSkins.length, 10, 'the dual pistols should ship with ten original finishes');
assert.deepStrictEqual(
  Object.fromEntries(['common', 'rare', 'epic', 'legendary'].map(rarity => [rarity, dualBerettasSkins.filter(item => item.rarity === rarity).length])),
  { common: 2, rare: 3, epic: 3, legendary: 2 },
  'the dual-pistol collection should span the full non-Mythic rarity ladder'
);
for (const item of dualBerettasSkins) {
  assert.strictEqual(item.modelPath, '/assets/weapons/dual_elite.glb', `${item.id} should reuse the supplied dual-pistol model`);
  assert.strictEqual(item.fixedRarity, true, `${item.id} should retain its authored rarity in the catalog`);
  assert.strictEqual(item.textureApplication, 'overlay', `${item.id} should preserve its authored fixed artwork`);
  assert.deepStrictEqual(item.textureMaterialNames, ['weapon_pist_elite.001'], `${item.id} should target the supplied pistol material`);
  const png = fs.readFileSync(localPath(item.texturePath));
  assert.deepStrictEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47], `${item.id} texture should be a PNG`);
}
const m4a1PatternSkins = ITEMS.filter(item => item.weapon === 'M4A1' && item.kind === 'skin');
assert.strictEqual(m4a1PatternSkins.length, 10, 'the M4A1 should ship with ten reusable pattern finishes');
assert.deepStrictEqual(
  Object.fromEntries(['common', 'rare', 'epic', 'legendary'].map(rarity => [rarity, m4a1PatternSkins.filter(item => item.rarity === rarity).length])),
  { common: 3, rare: 3, epic: 2, legendary: 2 },
  'the M4A1 patterns should follow the requested rarity distribution'
);
for (const item of m4a1PatternSkins) {
  assert.strictEqual(item.modelPath, '/assets/weapons/m4a1.glb', `${item.id} should reuse the base M4A1 model`);
  assert.strictEqual(item.textureApplication, 'pattern', `${item.id} should use the shared pattern pipeline`);
  assert.deepStrictEqual(item.textureMaterialNames, ['Body1'], `${item.id} should paint only the M4A1 body`);
  assert.match(item.texturePath, /^\/assets\/skins\/imported\/patterns\/.+\.png$/, `${item.id} should use a shared imported pattern`);
}
assert.ok(ITEMS.some(item => item.id === 'm4a1_vanguard' && item.rarity === 'mythic' && item.kind === 'model'), 'the authored M4A1 Vanguard should remain untouched');
assert.ok(!ITEMS.some(item => item.weapon !== 'Knife' && item.weapon !== 'M4A1' && /\|\s*(Gamma Energy|Fade|Dual Energy)$/i.test(item.displayName)), 'the formerly knife-only finishes should only be shared with the M4A1');
assert.ok(ITEMS.some(item => item.id === 'ak47_case_hardened' && item.overlayTexturePath?.endsWith('ak47_wooden_overlay.png')), 'AK Case Hardened should use the supplied wooden overlay');
assert.ok(ITEMS.some(item => item.id === 'knife_karambit_case_hardened' && item.overlayTexturePath?.endsWith('karambit_handle_overlay.png')), 'knife patterns should expose their supplied handle overlay');
for (const [id, type, texture] of [
  ['knife_karambit_vortex_fang', 'Karambit', 'arsenal_vortex_fang.png'],
  ['knife_bowie_solar_reaver', 'Bowie', 'arsenal_solar_reaver.png']
]) {
  const knife = ITEMS.find(item => item.id === id);
  assert.ok(knife, `${id} should be selectable by the case editor`);
  assert.strictEqual(knife.rarity, 'mythic', `${id} should be a case special item`);
  assert.strictEqual(knife.knifeType, type, `${id} should retain its distinct knife type`);
  assert.strictEqual(knife.textureType, 'pattern', `${id} should use its generated pattern texture`);
  assert.ok(knife.texturePath.endsWith(texture), `${id} should load its own generated texture`);
}
for (const maskPath of ['/assets/skins/wear/grunge-mask.png', '/assets/skins/wear/cracked-mask.png']) {
  const png = fs.readFileSync(localPath(maskPath));
  assert.strictEqual(png[25], 0, `${maskPath} must be stored as grayscale mask data, never colored artwork`);
}
assert.ok(IMPORTED_SKINS.length >= 450, 'Weapons.zip metadata import should register the large generated skin catalog');
assert.ok(IMPORTED_SKINS.some(item => item.textureApplication === 'pattern' && item.patternZoom), 'pattern imports should preserve pattern zoom metadata');
assert.ok(IMPORTED_SKINS.some(item => item.weapon === 'Knife' && item.rarity === 'mythic'), 'imported knife skins should remain Mythic-only');

const PRIM_EXPECTATIONS = {
  ak47_prim1: { materialNames: ['ak47.003'] },
  ak47_prim2: { materialNames: ['weapon_rif_ak47.003'] },
  awp_prim1: { materialNames: ['awp'] },
  awp_prim2: { materialNames: ['weapon_snip_awp'] }
};

const EXPECTED_SKIN_SOURCE = {
  ak47_ice_coaled: 'ak47_prim1',
  ak47_nightwish: 'ak47_prim1',
  ak47_anubis: 'ak47_prim1',
  ak47_asiimov: 'ak47_prim1',
  ak47_crossfade: 'ak47_prim2',
  ak47_inheritence: 'ak47_prim2',
  ak47_phantom_disruptor: 'ak47_prim1',
  ak47_point_disarray: 'ak47_prim1',
  ak47_the_empress: 'ak47_prim1',
  ak47_wild_lotus: 'ak47_prim1',
  awp_asiimov: 'awp_prim1',
  awp_crakow: 'awp_prim2',
  awp_bingle: 'awp_prim2',
  awp_desert_hydra: 'awp_prim1',
  awp_dragon_lore: 'awp_prim1',
  awp_gungnir: 'awp_prim1',
  awp_jog: 'awp_prim2',
  awp_neo_noir: 'awp_prim1',
  awp_oni_taiji: 'awp_prim1',
  awp_the_prince: 'awp_prim1',
  awp_wildfire: 'awp_prim1'
};

const EXPECTED_MODEL_BASENAME = {
  ak47_ice_coaled: 'ice_coaled',
  ak47_nightwish: 'nightwish_akwrap',
  ak47_anubis: 'anubis_akwrap',
  ak47_asiimov: 'asiimov_akwrap',
  ak47_crossfade: 'crossfade_akwrap',
  ak47_inheritence: 'inheritence_akwrap',
  ak47_phantom_disruptor: 'phantom_disruptor_akwrap',
  ak47_point_disarray: 'point_disarray_akwrap',
  ak47_the_empress: 'the_empress_akwrap',
  ak47_wild_lotus: 'wild_lotus_akwrap',
  awp_asiimov: 'asiimov',
  awp_crakow: 'crakow',
  awp_bingle: 'bingle',
  awp_desert_hydra: 'desert_hydra',
  awp_dragon_lore: 'dragon_lore',
  awp_gungnir: 'gungnir',
  awp_jog: 'jog',
  awp_neo_noir: 'neo_noir',
  awp_oni_taiji: 'oni_taiji',
  awp_the_prince: 'the_prince',
  awp_wildfire: 'wildfire'
};

function sourceModelName(item) {
  return path.basename(item.baseModelPath, '.glb');
}

function assertEmbeddedWrapSkin(item) {
  assert.strictEqual(path.basename(item.modelPath, '.glb'), EXPECTED_MODEL_BASENAME[item.id], `${item.id} should use the expected cache-safe model URL`);
  assert.strictEqual(sourceModelName(item), EXPECTED_SKIN_SOURCE[item.id], `${item.id} should build from the supplied metadata prim`);
  const expected = PRIM_EXPECTATIONS[sourceModelName(item)];
  assert.ok(expected, `${item.id} should build from a prim-specific source model`);
  assert.strictEqual(item.textureApplication, 'embedded', `${item.id} should use its generated overlay GLB without runtime repainting`);
  assert.deepStrictEqual(item.textureMaterialNames, expected.materialNames, `${item.id} should name the exact ${item.weapon} material layer to skin`);

  const baseGlb = readGlbJson(localPath(item.baseModelPath));
  const glb = readGlbJson(localPath(item.modelPath));
  assert.deepStrictEqual(
    (glb.materials || []).map(material => material.name),
    (baseGlb.materials || []).map(material => material.name),
    `${item.id} should preserve the material set from ${item.baseModelPath}`
  );
  const primitiveCount = (glb.meshes || []).reduce((sum, mesh) => sum + (mesh.primitives?.length || 0), 0);
  const basePrimitiveCount = (baseGlb.meshes || []).reduce((sum, mesh) => sum + (mesh.primitives?.length || 0), 0);
  assert.strictEqual(primitiveCount, basePrimitiveCount, `${item.id} should include the same mesh primitives as ${item.baseModelPath}`);
  const expectedImage = `${path.basename(item.texturePath, path.extname(item.texturePath))}_base_color`;
  const imageIndexes = (glb.images || [])
    .map((image, index) => image.name === expectedImage ? index : -1)
    .filter(index => index >= 0);
  assert.strictEqual(imageIndexes.length, 1, `${item.id} should embed one ${expectedImage} image`);
  const image = glb.images[imageIndexes[0]];
  assert.strictEqual(image.mimeType, 'image/png', `${item.id} embedded skin image should stay PNG`);
  const sourceSize = fs.statSync(localPath(item.texturePath)).size;
  const embeddedSize = glb.bufferViews?.[image.bufferView]?.byteLength;
  assert.strictEqual(embeddedSize, sourceSize, `${item.id} should embed the exact source PNG bytes`);

  for (const materialName of expected.materialNames) {
    const targetedMaterial = glb.materials.find(material => material.name === materialName);
    assert.ok(targetedMaterial, `${item.id} missing targeted material ${materialName}`);
    const textureIndex = targetedMaterial.pbrMetallicRoughness?.baseColorTexture?.index;
    const imageIndex = glb.textures?.[textureIndex]?.source;
    assert.ok(imageIndexes.includes(imageIndex), `${item.id} should apply the skin image to ${materialName}`);
  }

  const baseColorMaterials = (glb.materials || [])
    .filter(material => material.pbrMetallicRoughness?.baseColorTexture)
    .map(material => material.name);
  assert.deepStrictEqual(baseColorMaterials, expected.materialNames, `${item.id} should not keep an old untargeted weapon base texture`);
}

const validatedAkSkins = akSkins.filter(item => EXPECTED_SKIN_SOURCE[item.id]);
const validatedAwpSkins = awpSkins.filter(item => EXPECTED_SKIN_SOURCE[item.id]);

for (const item of validatedAkSkins) {
  assertEmbeddedWrapSkin(item);
}

for (const item of validatedAkSkins.filter(item => item.id !== 'ak47_ice_coaled')) {
  const oldPath = item.texturePath.replace(/\.png$/, '.glb');
  assert.ok(!fs.existsSync(localPath(oldPath)), `${item.id} should not keep stale immutable AK GLB URL ${oldPath}`);
  assert.ok(item.modelPath.endsWith('_akwrap.glb'), `${item.id} should use an AK cache-busted GLB URL`);
}

for (const item of validatedAwpSkins) {
  assertEmbeddedWrapSkin(item);
}

const awpPrim1 = readGlbJson(localPath('/assets/weapons/awp_prim1.glb'));
assert.deepStrictEqual((awpPrim1.materials || []).map(material => material.name), ['awp', 'shared_scope'], 'awp_prim1 should keep the source layer split from the AWP pack');
const awpPrim2 = readGlbJson(localPath('/assets/weapons/awp_prim2.glb'));
assert.deepStrictEqual((awpPrim2.materials || []).map(material => material.name), ['shared_scope', 'weapon_snip_awp'], 'awp_prim2 should keep the source layer split from the AWP pack');
const ak47Prim1 = readGlbJson(localPath('/assets/weapons/ak47_prim1.glb'));
assert.deepStrictEqual((ak47Prim1.materials || []).map(material => material.name), ['ak47.003', 'sticker_gaps.003'], 'ak47_prim1 should keep the source layer split from the AK pack');
const p90Artwork = ITEMS.find(item => item.id === 'p90_asiimov');
assert.ok(p90Artwork?.modelPath.endsWith('/p90_prim1.glb') && p90Artwork.textureMaterialNames.includes('smg_p90'), 'P90 Asiimov should target the dedicated smg_p90 artwork prim');
const deagleArtwork = ITEMS.find(item => item.id === 'deagle_code_red');
assert.ok(deagleArtwork?.modelPath.endsWith('/deagle_prim1.glb') && deagleArtwork.textureMaterialNames.includes('pist_deagle'), 'Deagle Code Red should target the dedicated pist_deagle artwork prim');
const ak47Prim2 = readGlbJson(localPath('/assets/weapons/ak47_prim2.glb'));
assert.deepStrictEqual((ak47Prim2.materials || []).map(material => material.name), ['sticker_gaps.003', 'weapon_rif_ak47.003'], 'ak47_prim2 should keep the source layer split from the AK pack');

const indexHtml = fs.readFileSync(localPath('/index.html'), 'utf8');
assert.match(indexHtml, /'AWP': \{ path: '\/assets\/weapons\/awp\.glb',[^}]*defaultMaterialNames: \['weapon_snip_awp', 'shared_scope'\]/, 'default AWP should retain its authored green body and scope without the overlapping grey body prim');
assert.match(indexHtml, /'AK47': \{ path: '\/assets\/weapons\/ak47\.glb',[^}]*defaultMaterialNames: \['ak47\.003', 'sticker_gaps\.003'\]/, 'default AK should keep one complete body prim instead of rendering overlapping bodies');
assert.match(indexHtml, /function applyDefaultWeaponMaterialSelection\(model, spec, skinItem = null\)[\s\S]*?rejectedMeshes[\s\S]*?removeFromParent\(\)/, 'default combined models should remove alternate prims so invisible meshes cannot distort framing');
assert.match(indexHtml, /function loadSkinTexture\(item\)[\s\S]*?texture\.wrapS = THREE\.RepeatWrapping;[\s\S]*?texture\.wrapT = THREE\.RepeatWrapping;[\s\S]*?if \(item\?\.textureApplication === 'pattern'\)/, 'all authored replacement artwork and overlays should repeat like the source glTF sampler');
assert.match(indexHtml, /function skinPatternZoom\(item\)[\s\S]*?configured \* 0\.25/, 'Case Hardened should use the closer quarter-repeat crop');
// The point of this constant is that it changes: it is the only cache buster for
// assets served immutable for a year, so pinning today's literal here would mean
// no corrected model could ever reach a browser that had the old one. What has to
// hold is that weapon assets are versioned at all, and that the version is
// declared before startup requests the first model (asserted below).
assert.match(indexHtml, /const WEAPON_ASSET_CACHE_VERSION = '[^']+'/, 'weapon assets must be cache-busted by a version constant');
assert.ok(indexHtml.indexOf('const WEAPON_ASSET_CACHE_VERSION') < indexHtml.indexOf('init();'), 'weapon cache version must exist before startup requests the default AK asset');
assert.match(
  indexHtml,
  /const \[template, reflectionTexture, skinTexture, wearTextures, overlayTexture\] = await Promise\.all\([\s\S]*?item\?\.textureApplication === 'embedded'\s*\?\s*Promise\.resolve\(null\)\s*:\s*\(loadSkinTexture\(item\)/,
  'inventory thumbnails should load concurrently without repainting embedded AK/AWP skin GLBs across every material'
);
assert.match(
  indexHtml,
  /function applySkinTexture\(model, item\)\s*{\s*if \(!item\) return;\s*if \(item\.textureApplication === 'embedded'\)\s*{\s*applyEmbeddedSkinWear/,
  'embedded skin GLBs should preserve their artwork while receiving wear layers'
);
assert.ok(
  indexHtml.includes('function applyResolvedSkinTexture(model, item, texture, wearTextures, overlayTexture = null)'),
  'runtime should share one targeted layered skin texture path'
);
assert.ok(
  indexHtml.includes('if (skinTexture && wearTextures) applyResolvedSkinTexture(rig, item, skinTexture, wearTextures, overlayTexture);'),
  'inventory thumbnails should apply the same wear and overlay layers as live previews'
);
assert.ok(
  indexHtml.includes('jims-skin-thumbnails-v24'),
  'thumbnail cache should be bumped after default AWP and wear stability fixes'
);

const renderQaHtml = fs.readFileSync(localPath('/test/skin-render-qa.html'), 'utf8');
for (const item of [...validatedAkSkins, ...validatedAwpSkins]) {
  assert.ok(renderQaHtml.includes(item.modelPath), `render QA should include ${item.modelPath}`);
}
const renderQaAssetPaths = renderQaHtml.match(/\/assets\/skins\/(?:ak47|awp)\/[^']+\.glb/g) || [];
assert.strictEqual(new Set(renderQaAssetPaths).size, validatedAkSkins.length + validatedAwpSkins.length, 'render QA should list every regenerated AK/AWP skin exactly once');
assert.match(renderQaHtml, /const minimumVisiblePixels = equipmentWeapon \? 100 : 250/, 'render QA should retain the strict threshold while allowing narrow equipment profiles');

console.log('skin-assets: prim-source embedded weapon skins verified.');
