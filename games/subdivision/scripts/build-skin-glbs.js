#!/usr/bin/env node
// Last updated: 15 July 2026
// Builds shipped skin GLBs from catalog entries.
//
// A texture skin should keep its source PNG in `texturePath` and point `modelPath`
// at the generated GLB. This script embeds that PNG into the base GLB by replacing
// selected base-color images used by the model's materials. Meshes, UVs, transforms,
// animations, compression extensions, and non-color maps are left untouched.

const fs = require('fs');
const path = require('path');
const { ITEMS } = require('../skins');

const ROOT = path.resolve(__dirname, '..');
const GLB_MAGIC = 'glTF';
const JSON_CHUNK = 'JSON';
const BIN_CHUNK = 'BIN\0';

function toLocalPath(assetPath) {
  return path.join(ROOT, String(assetPath || '').replace(/^\//, ''));
}

function align4(value) {
  return (value + 3) & ~3;
}

function padBuffer(buffer, byte = 0) {
  const length = align4(buffer.length);
  if (length === buffer.length) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(length - buffer.length, byte)]);
}

function readGlb(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.toString('ascii', 0, 4) !== GLB_MAGIC) throw new Error(`${filePath} is not a GLB`);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === JSON_CHUNK) json = JSON.parse(data.toString('utf8').trim());
    if (type === BIN_CHUNK) bin = Buffer.from(data);
    offset += 8 + length;
  }
  if (!json || !bin) throw new Error(`${filePath} is missing JSON or BIN chunks`);
  return { json, bin };
}

function writeGlb(filePath, json, bin) {
  const jsonBuffer = padBuffer(Buffer.from(JSON.stringify(json)), 0x20);
  const binBuffer = padBuffer(bin, 0x00);
  const output = Buffer.alloc(12 + 8 + jsonBuffer.length + 8 + binBuffer.length);
  output.write(GLB_MAGIC, 0, 'ascii');
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  let offset = 12;
  output.writeUInt32LE(jsonBuffer.length, offset);
  output.write(JSON_CHUNK, offset + 4, 'ascii');
  jsonBuffer.copy(output, offset + 8);
  offset += 8 + jsonBuffer.length;
  output.writeUInt32LE(binBuffer.length, offset);
  output.write(BIN_CHUNK, offset + 4, 'ascii');
  binBuffer.copy(output, offset + 8);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, output);
}

function textureImageIndex(texture) {
  return texture?.source ?? texture?.extensions?.KHR_texture_basisu?.source ?? null;
}

function replaceBaseColorImages(baseGlbPath, pngPath, outputGlbPath, options = {}) {
  const { json, bin } = readGlb(baseGlbPath);
  const png = fs.readFileSync(pngPath);
  const baseColorImageIndexes = new Set();
  const materialNames = Array.isArray(options.materialNames)
    ? new Set(options.materialNames.map(name => String(name || '').trim()).filter(Boolean))
    : null;

  for (const material of json.materials || []) {
    if (materialNames && !materialNames.has(material.name || '')) continue;
    const textureIndex = material.pbrMetallicRoughness?.baseColorTexture?.index;
    const texture = json.textures?.[textureIndex];
    const imageIndex = textureImageIndex(texture);
    if (Number.isInteger(imageIndex)) baseColorImageIndexes.add(imageIndex);
  }

  if (!baseColorImageIndexes.size) {
    throw new Error(`${baseGlbPath} has no material base-color images to replace`);
  }

  let nextBin = padBuffer(bin, 0x00);
  for (const imageIndex of baseColorImageIndexes) {
    const byteOffset = align4(nextBin.length);
    const bufferViewIndex = json.bufferViews.length;
    nextBin = Buffer.concat([padBuffer(nextBin, 0x00), png]);
    json.bufferViews.push({ buffer: 0, byteOffset, byteLength: png.length });

    const image = json.images[imageIndex];
    image.name = `${path.basename(pngPath, path.extname(pngPath))}_base_color`;
    image.mimeType = 'image/png';
    image.bufferView = bufferViewIndex;

    for (const texture of json.textures || []) {
      if (textureImageIndex(texture) !== imageIndex) continue;
      delete texture.extensions;
      texture.source = imageIndex;
    }
  }

  json.buffers[0].byteLength = nextBin.length;
  writeGlb(outputGlbPath, json, nextBin);
  return baseColorImageIndexes.size;
}

function outputPathForItem(item) {
  if (item.modelPath) return toLocalPath(item.modelPath);
  return toLocalPath(item.texturePath).replace(/\.[^.]+$/, '.glb');
}

function buildAll() {
  const textureSkins = ITEMS.filter(item => item.kind === 'skin' && item.texturePath && item.baseModelPath);
  for (const item of textureSkins) {
    const baseGlbPath = toLocalPath(item.baseModelPath);
    const pngPath = toLocalPath(item.texturePath);
    const outputGlbPath = outputPathForItem(item);
    const replaced = replaceBaseColorImages(baseGlbPath, pngPath, outputGlbPath, { materialNames: item.textureMaterialNames });
    console.log(`${item.id}: wrote ${path.relative(ROOT, outputGlbPath)} (${replaced} base-color image${replaced === 1 ? '' : 's'})`);
  }
}

if (require.main === module) buildAll();

module.exports = { replaceBaseColorImages, readGlb, writeGlb };
