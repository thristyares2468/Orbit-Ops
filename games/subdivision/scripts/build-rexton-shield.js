// Bake the supplied photo onto a surface-following decal, not the shield UV atlas.
const fs = require('node:fs');
const path = require('node:path');
const { readGlb, writeGlb } = require('./build-skin-glbs');
const root = path.resolve(__dirname, '..');
const { json, bin } = readGlb(path.join(root, 'assets/weapons/shield.glb'));
let output = Buffer.from(bin);
function append(data) {
  output = Buffer.concat([output, Buffer.alloc((4 - output.length % 4) % 4)]);
  const view = json.bufferViews.length;
  json.bufferViews.push({ buffer: 0, byteOffset: output.length, byteLength: data.length });
  output = Buffer.concat([output, data]);
  return view;
}
function read(index, components) {
  const a = json.accessors[index], v = json.bufferViews[a.bufferView];
  const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : 2;
  return Array.from({ length: a.count }, (_, i) => Array.from({ length: components }, (_, k) => {
    const offset = (v.byteOffset || 0) + (a.byteOffset || 0) + i * (v.byteStride || components * size) + k * size;
    return a.componentType === 5126 ? bin.readFloatLE(offset) : size === 4 ? bin.readUInt32LE(offset) : bin.readUInt16LE(offset);
  }));
}
function clip(poly, axis, bound, sign) {
  const result = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const insideA = sign * (a[axis] - bound) >= 0, insideB = sign * (b[axis] - bound) >= 0;
    if (insideA) result.push(a);
    if (insideA !== insideB) {
      const t = (bound - a[axis]) / (b[axis] - a[axis]);
      result.push(a.map((value, k) => value + (b[k] - value) * t));
    }
  }
  return result;
}
const positions = [], normals = [], uvs = [];
// 380x250 source photo, centred below the viewing window.
const left = -1.15, right = 1.15, bottom = 0.65, top = bottom + 2.3 * 250 / 380;
for (const primitive of json.meshes[0].primitives) {
  const p = read(primitive.attributes.POSITION, 3), n = read(primitive.attributes.NORMAL, 3);
  const indices = read(primitive.indices, 1).flat();
  for (let i = 0; i < indices.length; i += 3) {
    const ids = indices.slice(i, i + 3);
    if (ids.reduce((sum, id) => sum + n[id][2], 0) / 3 > -0.3) continue;
    let polygon = ids.map(id => [...p[id], ...n[id]]);
    for (const [axis, bound, sign] of [[0,left,1],[0,right,-1],[1,bottom,1],[1,top,-1]]) polygon = clip(polygon, axis, bound, sign);
    for (let k = 1; k + 1 < polygon.length; k++) {
      for (const v of [polygon[0], polygon[k], polygon[k + 1]]) {
        positions.push(v[0] + v[3] * 0.003, v[1] + v[4] * 0.003, v[2] + v[5] * 0.003);
        normals.push(...v.slice(3));
        uvs.push((right - v[0]) / (right - left), (top - v[1]) / (top - bottom));
      }
    }
  }
}
if (!positions.length) throw new Error('No front-facing shield surface found');
function accessor(values, type, size) {
  const data = Buffer.from(new Float32Array(values).buffer);
  const index = json.accessors.length;
  const row = { bufferView: append(data), componentType: 5126, count: values.length / size, type };
  if (type === 'VEC3') {
    row.min = Array.from({length: size}, (_, k) => Math.min(...values.filter((_, i) => i % size === k)));
    row.max = Array.from({length: size}, (_, k) => Math.max(...values.filter((_, i) => i % size === k)));
  }
  json.accessors.push(row);
  return index;
}
json.images ||= [];
json.textures ||= [];
const imageIndex = json.images.length;
json.images.push({ bufferView: append(fs.readFileSync(path.join(root, 'assets/skins/shield/rexton.png'))), mimeType: 'image/png' });
const textureIndex = json.textures.length;
json.textures.push({ source: imageIndex });
const material = json.materials.length;
json.materials.push({ name: 'Rexton Photo', pbrMetallicRoughness: { baseColorTexture: { index: textureIndex }, metallicFactor: 0, roughnessFactor: 0.75 } });
json.meshes[0].primitives.push({ attributes: { POSITION: accessor(positions, 'VEC3', 3), NORMAL: accessor(normals, 'VEC3', 3), TEXCOORD_0: accessor(uvs, 'VEC2', 2) }, material, mode: 4 });
json.buffers[0].byteLength = output.length;
writeGlb(path.join(root, 'assets/skins/shield/rexton.glb'), json, output);
console.log(`Built Rexton shield: ${positions.length / 9} decal triangles`);
