// Last updated: 17 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const maps = require(path.join(ROOT, 'maps'));

const EXPECTED = [
  'bcrate02', 'bcrate08', 'crate02', 'crate02b', 'crate08', 'crate08b',
  'crate10', 'crate12', 'crate13', 'crate23', 'crate25', 'crate09b',
  '-1cstrike_fj2dk', '{fence', '{cufence', '{eastline2', '{eastwndwn2',
  '{ladder3a', '{out_net1', '{vine1', '{woodrail', 'cstrike_oe2vent',
  'cxdrd', 'cxstairsd', 'cxstairse', 'cxwllbooksa', 'cxwoodm',
  'eastcratelgtp', 'eastcratelgtp2', 'eastcratesm', 'eastdoor1',
  'eastwdwdj0', 'eastwndwn0', 'eastwndwn0b', 'eastwndwn0c',
  'eastwndwn1b', 'eastwndwntall', 'eastwood01', 'eastwood02', '{fence2',
  '{grate4a', '{rustyrungs', 't_crate07', 't_crate08', 't_crate09',
  't_crate10', 't_door09', 't_door10', 't_wall26', 't_wood01',
  't_wood02', '{culaundrya', '{culaundryb', '{ikfencea', '{ikfencec',
  '{razor2', '64crate0', '64crate1', 'bcrate09a', 'bcrate09c',
  'bigcrate0', 'bigcrate2', '{gate', 'eastwndwn1'
];

const listMatch = html.match(/const WALLBANG_TEXTURE_NAMES = new Set\(\[([\s\S]*?)\]\);/);
assert.ok(listMatch, 'the client should define an explicit imported-map wallbang texture allowlist');
const configured = new Set(
  [...listMatch[1].matchAll(/'([^']+)'/g)].map(match => match[1].toLowerCase())
);
assert.deepStrictEqual([...configured].sort(), [...new Set(EXPECTED)].sort(), 'the wallbang allowlist should match the requested unique texture names');
assert.match(
  html,
  /function wallbangTextureNameForHit[\s\S]*?material\?\.userData\?\.sourceTexture[\s\S]*?WALLBANG_TEXTURE_NAMES\.has\(value\)/,
  'wallbang checks should prefer the original imported BSP texture name'
);
assert.match(
  html,
  /function isWallbangSurface[\s\S]*?wallbangTextureNameForHit\(hit\)[\s\S]*?isPenetrableSurfaceColor/,
  'the explicit imported texture allowlist should run before legacy color/name fallbacks'
);
assert.match(
  html,
  /function handleBulletSurfaceImpact\(hit, \{ penetrated = false \} = \{\}\) \{[\s\S]*?const paneId = hit\.object\?\.userData\?\.breakableGlassPaneId;[\s\S]*?breakGlassPane\(paneId,[\s\S]*?queueLocalGlassBreak\(paneId, hit\.point\);[\s\S]*?addBulletDecal\(hit\);/,
  'breakable glass should shatter instead of leaving a floating decal while ordinary impacts retain their marks'
);
assert.match(
  html,
  /const penetratedSurfaceHits = \[\][\s\S]*?penetratedSurfaceHits\.push\(hit\)[\s\S]*?penetratedSurfaceHits\.forEach\(hit => handleBulletSurfaceImpact\(hit, \{ penetrated: true \}\)\)/,
  'penetrated wallbang surfaces should continue through the shared material-aware impact path'
);

(async () => {
  const { NodeIO } = await import('@gltf-transform/core');
  const shippedMaterials = new Set();
  for (const mapId of maps.ADMIN_MAP_IDS) {
    const glbPath = path.join(ROOT, maps.MAP_DEFS[mapId].collisionPath);
    const document = await new NodeIO().readBinary(fs.readFileSync(glbPath));
    for (const material of document.getRoot().listMaterials()) {
      const extras = material.getExtras() || {};
      shippedMaterials.add(String(extras.sourceTexture || material.getName()).toLowerCase());
    }
  }
  const missing = EXPECTED.filter(name => !shippedMaterials.has(name));
  assert.deepStrictEqual(missing, [], 'every requested wallbang texture should exist in the shipped imported maps');
  console.log(`imported-map-wallbang-textures: ${configured.size} exact texture names verified across four shipped maps.`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
