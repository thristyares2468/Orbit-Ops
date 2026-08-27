#!/usr/bin/env node
// Last updated: 16 July 2026
// Exports the exact textures embedded in the shipped admin-map GLBs and builds
// a paged HTML contact sheet that can be captured for visual review.

const fs = require('fs');
const path = require('path');
const maps = require('../maps');

function safeFileName(value) {
  return String(value || 'texture')
    .replace(/[^a-z0-9._-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'texture';
}

function catalogHtml(rows) {
  const data = JSON.stringify(rows).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Imported Map Texture Catalog</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: #121614; color: #eef2ed; font-family: Arial, sans-serif; }
  body { padding: 20px 24px 24px; }
  header { min-height: 70px; display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
  h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: 0; }
  .meta { color: #aab6aa; font: 13px/1.35 monospace; }
  .navigation { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
  .navigation button, .navigation select { height: 34px; border: 1px solid #536158; border-radius: 4px; background: #202622; color: #eef2ed; font: 700 13px monospace; }
  .navigation button { width: 36px; padding: 0; cursor: pointer; font-size: 18px; }
  .navigation button:hover:not(:disabled) { border-color: #9bd66f; color: #9bd66f; }
  .navigation button:disabled { cursor: default; opacity: .35; }
  .navigation select { padding: 0 30px 0 10px; cursor: pointer; }
  .page { color: #9bd66f; font: 700 15px monospace; }
  main { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); grid-template-rows: repeat(5, 1fr); gap: 10px; height: calc(100vh - 114px); min-height: 900px; }
  article { min-width: 0; overflow: hidden; border: 1px solid #3c4840; border-radius: 4px; background: #202622; display: grid; grid-template-rows: minmax(0, 1fr) auto; }
  .preview { min-height: 0; padding: 8px; display: flex; align-items: center; justify-content: center; background-color: #39403b; background-image: linear-gradient(45deg,#4c544f 25%,transparent 25%),linear-gradient(-45deg,#4c544f 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#4c544f 75%),linear-gradient(-45deg,transparent 75%,#4c544f 75%); background-size: 18px 18px; background-position: 0 0,0 9px,9px -9px,-9px 0; }
  img { display: block; width: 100%; height: 100%; max-height: 132px; object-fit: contain; image-rendering: auto; }
  .label { padding: 7px 8px 8px; border-top: 1px solid #3c4840; min-width: 0; }
  strong { display: block; overflow: hidden; text-overflow: ellipsis; color: #fff; font: 700 12px/1.25 monospace; white-space: nowrap; }
  small { display: block; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; color: #a9b7aa; font: 10px/1.25 monospace; white-space: nowrap; }
  .empty { visibility: hidden; }
</style>
</head>
<body>
<header>
  <div><h1>Imported Map Texture Catalog</h1><div class="meta" id="range"></div></div>
  <nav class="navigation" aria-label="Catalog pages">
    <button id="previous-page" type="button" title="Previous page" aria-label="Previous page">&#8592;</button>
    <select id="page-select" aria-label="Select page"></select>
    <button id="next-page" type="button" title="Next page" aria-label="Next page">&#8594;</button>
    <span class="page" id="page"></span>
  </nav>
</header>
<main id="grid"></main>
<script>
  const rows = ${data};
  const pageSize = 30;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const requested = Number(new URLSearchParams(location.search).get('page') || 1);
  const page = Math.max(1, Math.min(pages, Math.floor(requested)));
  const start = (page - 1) * pageSize;
  const visible = rows.slice(start, start + pageSize);
  document.getElementById('page').textContent = 'Page ' + page + ' / ' + pages;
  document.getElementById('range').textContent = (start + 1) + '-' + Math.min(rows.length, start + pageSize) + ' of ' + rows.length + ' shipped materials';
  const pageSelect = document.getElementById('page-select');
  for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
    const option = document.createElement('option');
    option.value = String(pageNumber);
    option.textContent = 'Page ' + pageNumber;
    option.selected = pageNumber === page;
    pageSelect.appendChild(option);
  }
  const goToPage = pageNumber => {
    const nextPage = Math.max(1, Math.min(pages, pageNumber));
    const url = new URL(location.href);
    url.searchParams.set('page', String(nextPage));
    location.href = url.href;
  };
  const previousButton = document.getElementById('previous-page');
  const nextButton = document.getElementById('next-page');
  previousButton.disabled = page <= 1;
  nextButton.disabled = page >= pages;
  previousButton.addEventListener('click', () => goToPage(page - 1));
  nextButton.addEventListener('click', () => goToPage(page + 1));
  pageSelect.addEventListener('change', () => goToPage(Number(pageSelect.value)));
  document.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' && page > 1) goToPage(page - 1);
    if (event.key === 'ArrowRight' && page < pages) goToPage(page + 1);
  });
  const grid = document.getElementById('grid');
  for (let index = 0; index < pageSize; index++) {
    const row = visible[index];
    const card = document.createElement('article');
    if (!row) {
      card.className = 'empty';
    } else {
      card.innerHTML = '<div class="preview"><img src="' + row.file + '" alt=""></div>'
        + '<div class="label"><strong title="' + row.name.replaceAll('"', '&quot;') + '">' + row.name + '</strong>'
        + '<small>' + row.map.toUpperCase() + ' · ' + row.surface + ' · ' + row.archive + '</small></div>';
    }
    grid.appendChild(card);
  }
</script>
</body>
</html>`;
}

async function main() {
  const outputRoot = path.resolve(process.argv[2] || path.join(process.cwd(), 'map-texture-catalog'));
  const textureRoot = path.join(outputRoot, 'textures');
  fs.mkdirSync(textureRoot, { recursive: true });
  const { NodeIO } = await import('@gltf-transform/core');
  const io = new NodeIO();
  const rows = [];

  for (const mapId of maps.ADMIN_MAP_IDS) {
    const glbPath = path.resolve(__dirname, '..', maps.MAP_DEFS[mapId].collisionPath);
    const document = await io.readBinary(fs.readFileSync(glbPath));
    const materials = document.getRoot().listMaterials().slice()
      .sort((left, right) => left.getName().localeCompare(right.getName()));
    const mapTextureRoot = path.join(textureRoot, mapId);
    fs.mkdirSync(mapTextureRoot, { recursive: true });
    for (let index = 0; index < materials.length; index++) {
      const material = materials[index];
      const texture = material.getBaseColorTexture();
      const image = texture?.getImage();
      if (!image) continue;
      const extras = material.getExtras() || {};
      const extension = texture.getMimeType() === 'image/jpeg' ? 'jpg' : 'png';
      const fileName = `${String(index + 1).padStart(3, '0')}-${safeFileName(material.getName())}.${extension}`;
      const outputPath = path.join(mapTextureRoot, fileName);
      fs.writeFileSync(outputPath, Buffer.from(image));
      rows.push({
        map: mapId,
        name: material.getName(),
        surface: extras.footstepSurface || 'concrete',
        archive: extras.sourceArchive || 'unknown',
        file: path.relative(outputRoot, outputPath).split(path.sep).join('/')
      });
    }
  }

  fs.writeFileSync(path.join(outputRoot, 'catalog.json'), JSON.stringify(rows, null, 2));
  fs.writeFileSync(path.join(outputRoot, 'index.html'), catalogHtml(rows));
  console.log(JSON.stringify({
    outputRoot,
    textures: rows.length,
    pages: Math.ceil(rows.length / 30),
    maps: Object.fromEntries(maps.ADMIN_MAP_IDS.map(mapId => [mapId, rows.filter(row => row.map === mapId).length]))
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
