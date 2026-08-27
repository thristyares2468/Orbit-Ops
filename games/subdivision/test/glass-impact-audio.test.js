// Last updated: 17 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SAMPLE_PATHS = [
  'assets/audio/weapons/fx/glass/glass_hit_01.mp3',
  'assets/audio/weapons/fx/glass/glass_hit_02.mp3',
  'assets/audio/weapons/fx/glass/glass_hit_03.mp3'
];

for (const relativePath of SAMPLE_PATHS) {
  const absolutePath = path.join(ROOT, relativePath);
  assert.ok(fs.existsSync(absolutePath), `${relativePath} should exist`);
  assert.ok(fs.statSync(absolutePath).size > 30000, `${relativePath} should contain the supplied audio sample`);
  assert.ok(html.includes(`/${relativePath}`), `${relativePath} should be included in the glass impact pool`);
}

assert.match(
  html,
  /function isGlassBulletHit\(hit\)[\s\S]*?isGlassMapMaterial\(materialForRaycastHit\(hit\)\)/,
  'bullet impacts should classify glass from the exact raycast material'
);
assert.match(
  html,
  /function soundImpact\(pos, hit = null\)[\s\S]*?isGlassBulletHit\(hit\)[\s\S]*?playSfxSample\(bulletSfx\.glass[\s\S]*?cooldownKey: 'bullet:glass'/,
  'glass impacts should randomly play the supplied spatial sample pool instead of a generic ricochet'
);
assert.match(
  html,
  /penetratedSurfaceHits\.forEach\(hit => handleBulletSurfaceImpact\(hit, \{ penetrated: true \}\)\)/,
  'glass wallbang entry points should still trigger their material-aware impact audio'
);
assert.match(
  html,
  /function playRemoteShot[\s\S]*?bulletSurfaceHitAlongSegment\(start, target\)[\s\S]*?soundImpact\(surfaceHit\?\.point \|\| target, surfaceHit\)/,
  'remote bullets should resolve their map surface and play glass impact audio at the pane'
);

console.log('glass-impact-audio: supplied sample pool, local wallbangs, and remote glass hits verified.');
