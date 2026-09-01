// Minimal OBJ -> GLB converter (no dependencies).
// Handles v / vt / vn / f with n-gon fan triangulation, one material.
//
// The client only loads binary glTF, so an OBJ has to be converted before it can
// ship. This is how assets/weapons/shield.glb was produced from the supplied
// shield.obj (which came with no .mtl, hence the authored material):
//
//   node -e "require('./scripts/obj2glb').convert('shield.obj', 'assets/weapons/shield.glb', {
//     name: 'Shield', baseColorFactor: [0.30, 0.35, 0.41, 1],
//     metallicFactor: 0.55, roughnessFactor: 0.42, doubleSided: true
//   })"
const fs = require('fs');

function convert(objPath, outPath, material = {}) {
  const positions = [], uvs = [], normals = [], tris = [];
  for (const raw of fs.readFileSync(objPath, 'utf8').split(/\r?\n/)) {
    const p = raw.trim().split(/\s+/);
    if (p[0] === 'v') positions.push([+p[1], +p[2], +p[3]]);
    else if (p[0] === 'vt') uvs.push([+p[1], +p[2]]);
    else if (p[0] === 'vn') normals.push([+p[1], +p[2], +p[3]]);
    else if (p[0] === 'f') {
      const corners = p.slice(1).map((token) => {
        const [v, vt, vn] = token.split('/');
        return { v: +v - 1, vt: vt ? +vt - 1 : -1, vn: vn ? +vn - 1 : -1 };
      });
      // Fan triangulation. Every face in this model is a convex ring or cap.
      for (let i = 1; i < corners.length - 1; i++) tris.push([corners[0], corners[i], corners[i + 1]]);
    }
  }
  const hasUv = uvs.length > 0, hasNormal = normals.length > 0;
  const seen = new Map(), outPos = [], outUv = [], outNrm = [], indices = [];
  for (const tri of tris) {
    for (const c of tri) {
      const key = `${c.v}/${c.vt}/${c.vn}`;
      let index = seen.get(key);
      if (index === undefined) {
        index = outPos.length / 3;
        seen.set(key, index);
        outPos.push(...positions[c.v]);
        if (hasUv) outUv.push(...(c.vt >= 0 ? uvs[c.vt] : [0, 0]));
        if (hasNormal) outNrm.push(...(c.vn >= 0 ? normals[c.vn] : [0, 1, 0]));
      }
      indices.push(index);
    }
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < outPos.length; i += 3) {
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], outPos[i + a]); max[a] = Math.max(max[a], outPos[i + a]); }
  }
  const pad4 = (n) => (n + 3) & ~3;
  const chunks = [], views = [], accessors = [];
  let offset = 0;
  const addView = (buffer, target) => {
    views.push({ buffer: 0, byteOffset: offset, byteLength: buffer.length, ...(target ? { target } : {}) });
    chunks.push(buffer, Buffer.alloc(pad4(buffer.length) - buffer.length));
    offset += pad4(buffer.length);
    return views.length - 1;
  };
  const floatBuffer = (arr) => Buffer.from(Float32Array.from(arr).buffer);
  accessors.push({ bufferView: addView(floatBuffer(outPos), 34962), componentType: 5126, count: outPos.length / 3, type: 'VEC3', min, max });
  if (hasNormal) accessors.push({ bufferView: addView(floatBuffer(outNrm), 34962), componentType: 5126, count: outNrm.length / 3, type: 'VEC3' });
  if (hasUv) accessors.push({ bufferView: addView(floatBuffer(outUv), 34962), componentType: 5126, count: outUv.length / 2, type: 'VEC2' });
  const indexBuffer = Buffer.from(Uint32Array.from(indices).buffer);
  const indexAccessor = accessors.push({ bufferView: addView(indexBuffer, 34963), componentType: 5125, count: indices.length, type: 'SCALAR' }) - 1;
  const attributes = { POSITION: 0 };
  let next = 1;
  if (hasNormal) attributes.NORMAL = next++;
  if (hasUv) attributes.TEXCOORD_0 = next++;
  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: '2.0', generator: 'orbit-ops obj2glb', ...(material.extras ? { extras: material.extras } : {}) },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: material.name || 'model' }],
    meshes: [{ name: material.name || 'model', primitives: [{ attributes, indices: indexAccessor, material: 0, mode: 4 }] }],
    materials: [{
      name: material.name || 'material',
      doubleSided: material.doubleSided !== false,
      pbrMetallicRoughness: {
        baseColorFactor: material.baseColorFactor || [0.6, 0.6, 0.6, 1],
        metallicFactor: material.metallicFactor ?? 0.5,
        roughnessFactor: material.roughnessFactor ?? 0.5
      }
    }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors
  };
  const jsonChunk = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadded = Buffer.concat([jsonChunk, Buffer.alloc(pad4(jsonChunk.length) - jsonChunk.length, 0x20)]);
  const total = 12 + 8 + jsonPadded.length + 8 + bin.length;
  const out = Buffer.alloc(total);
  out.write('glTF', 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonPadded.length, 12); out.write('JSON', 16); jsonPadded.copy(out, 20);
  const at = 20 + jsonPadded.length;
  out.writeUInt32LE(bin.length, at); out.write('BIN\0', at + 4); bin.copy(out, at + 8);
  fs.writeFileSync(outPath, out);
  return { vertices: outPos.length / 3, triangles: indices.length / 3, bytes: total, min, max };
}
module.exports = { convert };
