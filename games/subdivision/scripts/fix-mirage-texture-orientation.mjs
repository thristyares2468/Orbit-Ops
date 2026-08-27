// Last updated: 13 August 2026
// Convert the imported GoldSrc V axis to glTF's texture convention once.
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';

const filename = new URL('../assets/maps/de_mirage.glb', import.meta.url);
const io = new NodeIO();
const document = await io.readBinary(fs.readFileSync(filename));
const asset = document.getRoot().getAsset();
if (asset.extras?.mirageUvOrientation === 'goldsrc-v-fixed') {
  console.log('Mirage texture orientation is already fixed.');
  process.exit(0);
}

let accessors = 0;
for (const mesh of document.getRoot().listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    const uv = primitive.getAttribute('TEXCOORD_0');
    if (!uv) continue;
    const values = uv.getArray();
    for (let index = 1; index < values.length; index += 2) values[index] = -values[index];
    uv.setArray(values);
    accessors += 1;
  }
}
asset.extras = { ...(asset.extras || {}), mirageUvOrientation: 'goldsrc-v-fixed' };
fs.writeFileSync(filename, await io.writeBinary(document));
console.log(`Fixed ${accessors} Mirage texture-coordinate accessors.`);
