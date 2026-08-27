#!/usr/bin/env node
// Last updated: 3 August 2026
// Converts a GoldSrc BSP v30 map into the GLB coordinate/scale contract used by
// the browser game. Embedded textures and explicitly supplied WAD3 archives are
// preserved; only genuinely unavailable textures receive semantic fallbacks.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BSP_VERSION = 30;
const GLB_IMPORT_SCALE = 1 / 80; // Client map scale x20 => 0.25 GoldSrc units.
const LUMP = {
  ENTITIES: 0,
  PLANES: 1,
  TEXTURES: 2,
  VERTICES: 3,
  TEXINFO: 6,
  FACES: 7,
  LIGHTING: 8,
  EDGES: 12,
  SURFEDGES: 13
};
const INVISIBLE_TEXTURE = /^(?:aaatrigger|clip|hint|origin|skip|sky|null|trigger|bevel)/i;
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let value = i;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  crcTable[i] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return chunk;
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    scanlines[row] = 0;
    rgba.copy(scanlines, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function dilateTransparentRgb(rgba, width, height, passes = 2) {
  let source = Buffer.from(rgba);
  for (let pass = 0; pass < passes; pass++) {
    const next = Buffer.from(source);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        if (source[at + 3] !== 0) continue;
        let red = 0; let green = 0; let blue = 0; let count = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if ((!ox && !oy) || x + ox < 0 || x + ox >= width || y + oy < 0 || y + oy >= height) continue;
            const neighbor = ((y + oy) * width + x + ox) * 4;
            if (source[neighbor + 3] === 0) continue;
            red += source[neighbor]; green += source[neighbor + 1]; blue += source[neighbor + 2]; count++;
          }
        }
        if (!count) continue;
        next[at] = Math.round(red / count);
        next[at + 1] = Math.round(green / count);
        next[at + 2] = Math.round(blue / count);
      }
    }
    source = next;
  }
  return source;
}

function readName(buffer, offset, length) {
  const bytes = buffer.subarray(offset, offset + length);
  const zero = bytes.indexOf(0);
  return bytes.subarray(0, zero < 0 ? bytes.length : zero).toString('latin1').replace(/[^\x20-\x7e]/g, '').trim();
}

function readLumps(buffer) {
  const version = buffer.readInt32LE(0);
  if (version !== BSP_VERSION) throw new Error(`Expected GoldSrc BSP v${BSP_VERSION}, received v${version}`);
  return Array.from({ length: 15 }, (_, index) => ({
    offset: buffer.readInt32LE(4 + index * 8),
    length: buffer.readInt32LE(8 + index * 8)
  }));
}

function readEntities(buffer, lump) {
  const source = buffer.subarray(lump.offset, lump.offset + lump.length).toString('latin1');
  return [...source.matchAll(/\{([\s\S]*?)\}/g)].map((match) => Object.fromEntries(
    [...match[1].matchAll(/"([^"]*)"\s+"([^"]*)"/g)].map((pair) => [pair[1], pair[2]])
  ));
}

function decodeMipTexture(buffer, offset, source, limit = buffer.length) {
  if (offset < 0 || offset + 40 > limit) return null;
  const name = readName(buffer, offset, 16);
  const width = buffer.readUInt32LE(offset + 16);
  const height = buffer.readUInt32LE(offset + 20);
  const mipOffsets = Array.from({ length: 4 }, (_, index) => buffer.readUInt32LE(offset + 24 + index * 4));
  if (!name || !width || !height || !mipOffsets[0]) return null;
  const pixelCount = width * height;
  const pixelOffset = offset + mipOffsets[0];
  const paletteOffset = offset + mipOffsets[3] + Math.max(1, pixelCount >> 6);
  if (pixelOffset + pixelCount > limit || paletteOffset + 2 > limit) return null;
  const paletteSize = Math.min(256, buffer.readUInt16LE(paletteOffset));
  const palette = buffer.subarray(paletteOffset + 2, paletteOffset + 2 + paletteSize * 3);
  if (!paletteSize || palette.length < paletteSize * 3) return null;

  const pixels = buffer.subarray(pixelOffset, pixelOffset + pixelCount);
  const rgba = Buffer.alloc(pixelCount * 4);
  const masked = name.startsWith('{');
  for (let index = 0; index < pixels.length; index++) {
    const paletteIndex = Math.min(paletteSize - 1, pixels[index]);
    rgba[index * 4] = palette[paletteIndex * 3] || 0;
    rgba[index * 4 + 1] = palette[paletteIndex * 3 + 1] || 0;
    rgba[index * 4 + 2] = palette[paletteIndex * 3 + 2] || 0;
    rgba[index * 4 + 3] = masked && pixels[index] === 255 ? 0 : 255;
  }
  return { name, width, height, rgba, rgbaWidth: width, rgbaHeight: height, source };
}

function readTextures(buffer, lump) {
  const count = buffer.readInt32LE(lump.offset);
  return Array.from({ length: count }, (_, index) => {
    const relative = buffer.readInt32LE(lump.offset + 4 + index * 4);
    if (relative < 0) return { name: `missing_${index}`, width: 64, height: 64, rgba: null, source: 'external' };
    const offset = lump.offset + relative;
    const name = readName(buffer, offset, 16) || `texture_${index}`;
    const width = Math.max(1, buffer.readUInt32LE(offset + 16));
    const height = Math.max(1, buffer.readUInt32LE(offset + 20));
    return decodeMipTexture(buffer, offset, 'embedded', lump.offset + lump.length)
      || { name, width, height, rgba: null, source: 'external' };
  });
}

function readWadTextures(wadPaths = []) {
  const textures = new Map();
  for (const wadPath of wadPaths) {
    const buffer = fs.readFileSync(wadPath);
    const magic = buffer.subarray(0, 4).toString('ascii');
    if (magic !== 'WAD3') throw new Error(`${wadPath} is ${magic || 'not a WAD'}, expected WAD3`);
    const count = buffer.readInt32LE(4);
    const directoryOffset = buffer.readInt32LE(8);
    for (let index = 0; index < count; index++) {
      const entry = directoryOffset + index * 32;
      if (entry < 0 || entry + 32 > buffer.length) continue;
      const fileOffset = buffer.readInt32LE(entry);
      const diskSize = buffer.readInt32LE(entry + 4);
      const type = buffer[entry + 12];
      const compressed = buffer[entry + 13] !== 0;
      if (compressed || (type !== 0x43 && type !== 0x40) || fileOffset < 0 || diskSize <= 0) continue;
      const texture = decodeMipTexture(
        buffer,
        fileOffset,
        `wad:${path.basename(wadPath)}`,
        Math.min(buffer.length, fileOffset + diskSize)
      );
      if (texture && !textures.has(texture.name.toLowerCase())) textures.set(texture.name.toLowerCase(), texture);
    }
  }
  return textures;
}

function resolveExternalTextures(textures, wadPaths) {
  const wadTextures = readWadTextures(wadPaths);
  return textures.map((texture) => {
    if (texture.rgba) return texture;
    const resolved = wadTextures.get(texture.name.toLowerCase());
    return resolved ? { ...resolved, name: texture.name } : proceduralFallbackTexture(texture);
  });
}

function readPlanes(buffer, lump) {
  const planes = [];
  for (let offset = lump.offset; offset + 20 <= lump.offset + lump.length; offset += 20) {
    planes.push({
      normal: [buffer.readFloatLE(offset), buffer.readFloatLE(offset + 4), buffer.readFloatLE(offset + 8)],
      distance: buffer.readFloatLE(offset + 12)
    });
  }
  return planes;
}

function readVertices(buffer, lump) {
  const vertices = [];
  for (let offset = lump.offset; offset + 12 <= lump.offset + lump.length; offset += 12) {
    vertices.push([buffer.readFloatLE(offset), buffer.readFloatLE(offset + 4), buffer.readFloatLE(offset + 8)]);
  }
  return vertices;
}

function readTexInfo(buffer, lump) {
  const rows = [];
  for (let offset = lump.offset; offset + 40 <= lump.offset + lump.length; offset += 40) {
    rows.push({
      s: [buffer.readFloatLE(offset), buffer.readFloatLE(offset + 4), buffer.readFloatLE(offset + 8), buffer.readFloatLE(offset + 12)],
      t: [buffer.readFloatLE(offset + 16), buffer.readFloatLE(offset + 20), buffer.readFloatLE(offset + 24), buffer.readFloatLE(offset + 28)],
      texture: buffer.readInt32LE(offset + 32),
      flags: buffer.readInt32LE(offset + 36)
    });
  }
  return rows;
}

function readFaces(buffer, lump) {
  const faces = [];
  for (let offset = lump.offset; offset + 20 <= lump.offset + lump.length; offset += 20) {
    faces.push({
      plane: buffer.readUInt16LE(offset),
      side: buffer.readUInt16LE(offset + 2),
      firstEdge: buffer.readInt32LE(offset + 4),
      edgeCount: buffer.readUInt16LE(offset + 8),
      texInfo: buffer.readUInt16LE(offset + 10),
      styles: [buffer[offset + 12], buffer[offset + 13], buffer[offset + 14], buffer[offset + 15]],
      lightOffset: buffer.readInt32LE(offset + 16)
    });
  }
  return faces;
}

function readEdges(buffer, lump) {
  const edges = [];
  for (let offset = lump.offset; offset + 4 <= lump.offset + lump.length; offset += 4) {
    edges.push([buffer.readUInt16LE(offset), buffer.readUInt16LE(offset + 2)]);
  }
  return edges;
}

function readSurfEdges(buffer, lump) {
  const edges = [];
  for (let offset = lump.offset; offset + 4 <= lump.offset + lump.length; offset += 4) edges.push(buffer.readInt32LE(offset));
  return edges;
}

function transformPosition(vertex) {
  return [vertex[0] * GLB_IMPORT_SCALE, vertex[2] * GLB_IMPORT_SCALE, -vertex[1] * GLB_IMPORT_SCALE];
}

function transformNormal(normal) {
  const transformed = [normal[0], normal[2], -normal[1]];
  const length = Math.hypot(...transformed) || 1;
  return transformed.map((value) => value / length);
}

function normalForTriangle(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0]
  ];
  const length = Math.hypot(...normal) || 1;
  return normal.map((value) => value / length);
}

function lightColor(buffer, lightingLump, face, sourceVertices, texInfo) {
  if (face.lightOffset < 0 || face.styles[0] === 255) return [1, 1, 1];
  let minS = Infinity; let maxS = -Infinity; let minT = Infinity; let maxT = -Infinity;
  for (const vertex of sourceVertices) {
    const s = vertex[0] * texInfo.s[0] + vertex[1] * texInfo.s[1] + vertex[2] * texInfo.s[2] + texInfo.s[3];
    const t = vertex[0] * texInfo.t[0] + vertex[1] * texInfo.t[1] + vertex[2] * texInfo.t[2] + texInfo.t[3];
    minS = Math.min(minS, s); maxS = Math.max(maxS, s); minT = Math.min(minT, t); maxT = Math.max(maxT, t);
  }
  const width = Math.max(1, Math.ceil(maxS / 16) - Math.floor(minS / 16) + 1);
  const height = Math.max(1, Math.ceil(maxT / 16) - Math.floor(minT / 16) + 1);
  const sampleCount = Math.min(width * height, Math.floor((lightingLump.length - face.lightOffset) / 3));
  if (sampleCount <= 0) return [1, 1, 1];
  let r = 0; let g = 0; let b = 0;
  const start = lightingLump.offset + face.lightOffset;
  for (let i = 0; i < sampleCount; i++) {
    r += buffer[start + i * 3]; g += buffer[start + i * 3 + 1]; b += buffer[start + i * 3 + 2];
  }
  const exposure = 1.32 / (255 * sampleCount);
  return [
    Math.min(1, 0.28 + r * exposure),
    Math.min(1, 0.28 + g * exposure),
    Math.min(1, 0.28 + b * exposure)
  ];
}

function fallbackColor(name) {
  let hash = 2166136261;
  for (const char of name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const hue = hash % 360;
  const saturation = 0.12 + ((hash >>> 9) % 14) / 100;
  const lightness = 0.34 + ((hash >>> 17) % 24) / 100;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - c / 2;
  const rgb = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [...rgb.map((value) => value + m), 1];
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function proceduralFallbackTexture(texture) {
  const size = 64;
  const rgba = Buffer.alloc(size * size * 4);
  const name = String(texture.name || 'material').toLowerCase();
  let hash = 2166136261;
  for (const char of name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  let base = fallbackColor(name).slice(0, 3).map((value) => value * 255);
  let kind = 'panel';
  if (/brick/.test(name)) { base = [132, 92, 72]; kind = 'brick'; }
  else if (/crate|wood|plank|paper/.test(name)) { base = [123, 92, 58]; kind = 'wood'; }
  else if (/dirt|mud|sand|grnd|ground|snd/.test(name)) { base = [112, 98, 70]; kind = 'ground'; }
  else if (/rock|rk\d|stone|crete|concrete|pave|flr|floor|wall/.test(name)) { base = [119, 121, 116]; kind = 'masonry'; }
  else if (/metal|mtl|duct|vent|pipe|train|trk_|silo|rocket|tech|lab|generic|fifties|ammo/.test(name)) { base = [91, 105, 108]; kind = 'metal'; }
  else if (/glass|window/.test(name)) { base = [92, 137, 151]; kind = 'glass'; }
  else if (/light|lgt|lite|crt/.test(name)) { base = [194, 184, 135]; kind = 'light'; }
  else if (/yellow|stripe/.test(name)) { base = [184, 151, 48]; kind = 'hazard'; }

  const masked = name.startsWith('{');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (y * size + x) * 4;
      const noiseHash = Math.imul(hash ^ Math.imul(x + 17, 374761393) ^ Math.imul(y + 31, 668265263), 2246822519) >>> 0;
      let shade = ((noiseHash >>> 24) / 255 - 0.5) * 30;
      let color = base;
      if (kind === 'brick') {
        const row = Math.floor(y / 12);
        const mortar = y % 12 < 2 || (x + (row % 2) * 16) % 32 < 2;
        if (mortar) { color = [78, 78, 73]; shade *= 0.25; }
      } else if (kind === 'wood') {
        shade += Math.sin((x + (hash % 19)) * 0.31) * 20 + (y % 16 < 2 ? -28 : 0);
      } else if (kind === 'ground') {
        shade += Math.sin(x * 0.23) * 7 + Math.cos(y * 0.19) * 8;
      } else if (kind === 'masonry') {
        if (x % 32 < 2 || y % 32 < 2) shade -= 24;
      } else if (kind === 'metal' || kind === 'panel') {
        if (x % 32 < 2 || y % 32 < 2) shade -= 34;
        if ((x % 32 === 5 || x % 32 === 26) && (y % 32 === 5 || y % 32 === 26)) color = [43, 47, 48];
      } else if (kind === 'light') {
        if (x % 32 < 3 || y % 16 < 2) shade -= 55;
        else shade += 28;
      } else if (kind === 'hazard' && ((x + y) % 24 < 9)) {
        color = [49, 48, 42];
      }
      rgba[at] = clampByte(color[0] + shade);
      rgba[at + 1] = clampByte(color[1] + shade);
      rgba[at + 2] = clampByte(color[2] + shade);
      let alpha = 255;
      if (masked) {
        if (/ladder|rung/.test(name)) alpha = (x < 8 || x > 55 || y % 16 < 5) ? 255 : 0;
        else alpha = (x % 16 < 4 || y % 16 < 4) ? 255 : 0;
      }
      rgba[at + 3] = alpha;
    }
  }
  return { ...texture, rgba, rgbaWidth: size, rgbaHeight: size, generatedFallback: true };
}

const MATERIAL_CODE_SURFACES = Object.freeze({
  M: 'metal',
  V: 'metal',
  D: 'dirt',
  S: 'wet',
  T: 'tile',
  G: 'metal_grate',
  W: 'wood',
  P: 'metal',
  Y: 'glass',
  N: 'dirt',
  X: 'grass'
});

function readMaterialTypes(materialPaths = []) {
  const types = new Map();
  for (const materialPath of materialPaths) {
    const source = fs.readFileSync(materialPath, 'utf8');
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.replace(/\/\/.*$/, '').trim();
      const match = /^([A-Za-z])\s+(\S+)/.exec(line);
      if (!match) continue;
      const surface = MATERIAL_CODE_SURFACES[match[1].toUpperCase()];
      if (!surface) continue;
      types.set(match[2].toLowerCase().slice(0, 12), surface);
    }
  }
  return types;
}

function surfaceTypeForTextureName(textureName, materialTypes = null) {
  const name = String(textureName || '').toLowerCase();
  const taggedSurface = materialTypes?.get(name.slice(0, 12));
  if (taggedSurface) return taggedSurface;
  if (/glass|window/.test(name)) return 'glass';
  if (/ladder|rung/.test(name)) return 'ladder';
  if (/grate|grating|chainlink|fence|mesh|razor|(?:^|[_{}-])net/.test(name)) return 'metal_grate';
  if (/metal|mtl|duct|vent|pipe|train|trk_|silo|rocket|tech|lab|steel|iron|rail|gate|beam|tension|tank|tnk|engine|flatbed|crossover/.test(name)) return 'metal';
  if (/wood|crate|plank|timber|board|box|door/.test(name)) return 'wood';
  if (/grass|foliage|plant|hedge|vine|hay/.test(name)) return 'grass';
  if (/mud|sludge/.test(name)) return 'mud';
  if (/dirt|earth|soil|ground|grnd/.test(name)) return 'dirt';
  if (/gravel|pebble|rock|stone/.test(name)) return 'gravel';
  if (/sand|snd/.test(name)) return 'sand';
  if (/tile|marble|ceramic/.test(name)) return 'tile';
  if (/carpet|rug/.test(name)) return 'carpet';
  if (/rubber/.test(name)) return 'rubber';
  if (/water|liquid|puddle|wet/.test(name)) return 'wet';
  return 'concrete';
}

function addFaceGeometry(groups, texture, texInfo, sourceVertices, light, expectedNormal = null) {
  if (sourceVertices.length < 3) return 0;
  const key = texture.name;
  if (!groups.has(key)) groups.set(key, { texture, positions: [], normals: [], uvs: [], colors: [] });
  const group = groups.get(key);
  let triangles = 0;
  for (let index = 1; index < sourceVertices.length - 1; index++) {
    const triSource = [sourceVertices[0], sourceVertices[index], sourceVertices[index + 1]];
    const tri = triSource.map(transformPosition);
    let normal = normalForTriangle(tri[0], tri[1], tri[2]);
    if (expectedNormal && normal.reduce((sum, value, axis) => sum + value * expectedNormal[axis], 0) < 0) {
      [triSource[1], triSource[2]] = [triSource[2], triSource[1]];
      [tri[1], tri[2]] = [tri[2], tri[1]];
      normal = normalForTriangle(tri[0], tri[1], tri[2]);
    }
    if (!Number.isFinite(normal[0]) || Math.hypot(...normal) < 0.5) continue;
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex++) {
      const source = triSource[vertexIndex];
      const position = tri[vertexIndex];
      const s = source[0] * texInfo.s[0] + source[1] * texInfo.s[1] + source[2] * texInfo.s[2] + texInfo.s[3];
      const t = source[0] * texInfo.t[0] + source[1] * texInfo.t[1] + source[2] * texInfo.t[2] + texInfo.t[3];
      group.positions.push(...position);
      group.normals.push(...normal);
      group.uvs.push(s / texture.width, -t / texture.height);
      group.colors.push(...light);
    }
    triangles++;
  }
  return triangles;
}

function collectGeometry(buffer, lumps, textures) {
  const vertices = readVertices(buffer, lumps[LUMP.VERTICES]);
  const planes = readPlanes(buffer, lumps[LUMP.PLANES]);
  const texInfos = readTexInfo(buffer, lumps[LUMP.TEXINFO]);
  const faces = readFaces(buffer, lumps[LUMP.FACES]);
  const edges = readEdges(buffer, lumps[LUMP.EDGES]);
  const surfEdges = readSurfEdges(buffer, lumps[LUMP.SURFEDGES]);
  const groups = new Map();
  let triangleCount = 0;
  let skippedFaces = 0;

  for (const face of faces) {
    const texInfo = texInfos[face.texInfo];
    const texture = texInfo && textures[texInfo.texture];
    if (!texInfo || !texture || INVISIBLE_TEXTURE.test(texture.name)) { skippedFaces++; continue; }
    const sourceVertices = [];
    for (let edgeIndex = 0; edgeIndex < face.edgeCount; edgeIndex++) {
      const surfEdge = surfEdges[face.firstEdge + edgeIndex];
      const edge = edges[Math.abs(surfEdge)];
      const vertex = edge && vertices[surfEdge >= 0 ? edge[0] : edge[1]];
      if (vertex) sourceVertices.push(vertex);
    }
    const light = lightColor(buffer, lumps[LUMP.LIGHTING], face, sourceVertices, texInfo);
    const plane = planes[face.plane];
    const sourceNormal = plane?.normal?.map((value) => value * (face.side ? -1 : 1));
    const expectedNormal = sourceNormal ? transformNormal(sourceNormal) : null;
    triangleCount += addFaceGeometry(groups, texture, texInfo, sourceVertices, light, expectedNormal);
  }
  return { groups, triangleCount, skippedFaces };
}

async function writeGlb(outputPath, mapName, groups, materialTypes = null) {
  const { Accessor, Document, NodeIO, TextureInfo } = await import('@gltf-transform/core');
  const document = new Document();
  const buffer = document.createBuffer('map-buffer');
  const scene = document.createScene(`${mapName}-scene`);
  const mesh = document.createMesh(`${mapName}-world`);
  const node = document.createNode(`${mapName}-world`).setMesh(mesh);
  scene.addChild(node);

  for (const group of groups.values()) {
    if (!group.positions.length) continue;
    const material = document.createMaterial(group.texture.name)
      .setDoubleSided(true)
      .setMetallicFactor(0)
      .setRoughnessFactor(1)
      .setExtras({
        sourceTexture: group.texture.name,
        sourceArchive: group.texture.source || '',
        footstepSurface: surfaceTypeForTextureName(group.texture.name, materialTypes)
      });
    if (group.texture.rgba) {
      const width = group.texture.rgbaWidth || group.texture.width;
      const height = group.texture.rgbaHeight || group.texture.height;
      const rgba = group.texture.name.startsWith('{')
        ? dilateTransparentRgb(group.texture.rgba, width, height)
        : group.texture.rgba;
      const image = encodePng(width, height, rgba);
      const texture = document.createTexture(group.texture.name)
        .setImage(image)
        .setMimeType('image/png');
      material.setBaseColorTexture(texture);
      const info = material.getBaseColorTextureInfo();
      info.setWrapS(TextureInfo.WrapMode.REPEAT).setWrapT(TextureInfo.WrapMode.REPEAT);
      if (group.texture.name.startsWith('{')) material.setAlphaMode('MASK').setAlphaCutoff(0.5);
    } else {
      material.setBaseColorFactor(fallbackColor(group.texture.name));
    }

    const primitive = document.createPrimitive()
      .setAttribute('POSITION', document.createAccessor(`${group.texture.name}-position`, buffer)
        .setType(Accessor.Type.VEC3).setArray(new Float32Array(group.positions)))
      .setAttribute('NORMAL', document.createAccessor(`${group.texture.name}-normal`, buffer)
        .setType(Accessor.Type.VEC3).setArray(new Float32Array(group.normals)))
      .setAttribute('TEXCOORD_0', document.createAccessor(`${group.texture.name}-uv`, buffer)
        .setType(Accessor.Type.VEC2).setArray(new Float32Array(group.uvs)))
      .setAttribute('COLOR_0', document.createAccessor(`${group.texture.name}-light`, buffer)
        .setType(Accessor.Type.VEC3).setArray(new Float32Array(group.colors)))
      .setMaterial(material);
    mesh.addPrimitive(primitive);
  }

  const io = new NodeIO();
  const glb = await io.writeBinary(document);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, glb);
}

function mapMetadata(entities) {
  const result = { ct: [], t: [] };
  for (const entity of entities) {
    const team = entity.classname === 'info_player_start' ? 'ct'
      : entity.classname === 'info_player_deathmatch' ? 't' : null;
    if (!team || !entity.origin) continue;
    const [x, y, z] = entity.origin.trim().split(/\s+/).map(Number);
    if (![x, y, z].every(Number.isFinite)) continue;
    const angles = String(entity.angles || '').trim().split(/\s+/).map(Number);
    const sourceYaw = Number.isFinite(angles[1]) ? angles[1] : Number(entity.angle || 0);
    result[team].push({
      x: Number((x * 0.25).toFixed(3)),
      y: Number((z * 0.25).toFixed(3)),
      z: Number((-y * 0.25).toFixed(3)),
      yaw: Number((((sourceYaw - 90) * Math.PI) / 180).toFixed(6))
    });
  }
  return result;
}

async function importBsp(inputPath, outputPath, options = {}) {
  const buffer = fs.readFileSync(inputPath);
  const lumps = readLumps(buffer);
  const textures = resolveExternalTextures(readTextures(buffer, lumps[LUMP.TEXTURES]), options.wadPaths || []);
  const entities = readEntities(buffer, lumps[LUMP.ENTITIES]);
  const geometry = collectGeometry(buffer, lumps, textures);
  const mapName = path.basename(outputPath, path.extname(outputPath));
  const materialTypes = readMaterialTypes(options.materialPaths || []);
  await writeGlb(outputPath, mapName, geometry.groups, materialTypes);
  return {
    input: inputPath,
    output: outputPath,
    bytes: fs.statSync(outputPath).size,
    triangles: geometry.triangleCount,
    materials: geometry.groups.size,
    embeddedTextures: textures.filter((texture) => texture.source === 'embedded').length,
    wadTextures: textures.filter((texture) => String(texture.source).startsWith('wad:')).length,
    fallbackTextures: textures.filter((texture) => texture.generatedFallback).length,
    taggedFootstepTextures: [...geometry.groups.values()]
      .filter((group) => materialTypes.has(group.texture.name.toLowerCase().slice(0, 12))).length,
    skippedFaces: geometry.skippedFaces,
    spawns: mapMetadata(entities)
  };
}

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args[0] && path.resolve(args[0]);
  const outputPath = args[1] && path.resolve(args[1]);
  const wadPaths = [];
  const materialPaths = [];
  for (let index = 2; index < args.length; index++) {
    if (args[index] === '--wad' && args[index + 1]) wadPaths.push(path.resolve(args[++index]));
    else if (args[index].startsWith('--wad=')) wadPaths.push(path.resolve(args[index].slice('--wad='.length)));
    else if (args[index] === '--materials' && args[index + 1]) materialPaths.push(path.resolve(args[++index]));
    else if (args[index].startsWith('--materials=')) materialPaths.push(path.resolve(args[index].slice('--materials='.length)));
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (!inputPath || !outputPath) {
    console.error('Usage: node scripts/import-goldsrc-map.js <input.bsp> <output.glb> [--wad <archive.wad> ...] [--materials <materials.txt> ...]');
    process.exitCode = 1;
    return;
  }
  const result = await importBsp(inputPath, outputPath, { wadPaths, materialPaths });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

module.exports = {
  importBsp,
  mapMetadata,
  readMaterialTypes,
  readWadTextures,
  surfaceTypeForTextureName
};
