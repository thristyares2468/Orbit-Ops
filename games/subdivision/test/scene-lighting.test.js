// Last updated: 15 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Static check for the global fill-light tuning that prevents side-angle weapons
// from going too dark without making every map obviously brighter.
const indexHtml = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

assert.match(
  indexHtml,
  /const light = new THREE\.HemisphereLight\(0xeeeeff, 0x777788, 0\.46\)/,
  'scene hemisphere light should provide slightly stronger ambient sky fill'
);

assert.match(
  indexHtml,
  /const overheadFillLight = new THREE\.DirectionalLight\(0xf7fff2, 0\.28\); overheadFillLight\.position\.set\(0, 260, 0\); scene\.add\(overheadFillLight\);/,
  'scene should include a soft overhead fill light for all maps'
);

console.log('scene-lighting: global overhead fill lighting verified.');
