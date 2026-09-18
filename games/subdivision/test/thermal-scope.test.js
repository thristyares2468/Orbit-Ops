'use strict';

// The SSG 08's thermal optic. Two passes: the world drawn cold and flat, then
// heat sources drawn hot over the top of it. Almost every property worth
// protecting here is a property of how those two passes are sequenced, and the
// sequencing is easy to break by accident - the first working version of this
// feature drew a black screen and let you shoot through walls.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function fnBody(name) {
  const start = client.indexOf(`function ${name}(`);
  assert.ok(start > 0, `index.html must declare ${name}`);
  const rest = client.slice(start);
  const end = rest.indexOf('\n        function ', 1);
  return end > 0 ? rest.slice(0, end) : rest;
}

test('only the SSG carries the thermal optic', () => {
  assert.match(client, /const THERMAL_SCOPE_WEAPON = 'SSG 08';/u);
  const body = fnBody('thermalScopeActive');
  // Both halves matter. Without the zoom check the whole map goes thermal while
  // you are hip-firing; without the weapon check the AWP inherits it.
  assert.match(body, /isZoomed/u, 'thermal only applies while scoped');
  assert.match(body, /=== THERMAL_SCOPE_WEAPON/u, 'and only on the weapon that has the optic');
  assert.match(body, /weapons\[currentWeaponIndex\]/u, 'read from the weapon actually held');
});

test('the cold pass keeps the map readable', () => {
  // A MeshBasicMaterial override would paint every surface the same value and
  // erase the map: no walls, no crates, no stairs, just a silhouette on a void.
  // Lighting is the only thing keeping geometry legible once colour is gone.
  assert.match(client, /const thermalColdMaterial = new THREE\.MeshLambertMaterial\(/u,
    'the cold override must be lit, not flat');
  assert.doesNotMatch(client, /const thermalColdMaterial = new THREE\.MeshBasicMaterial\(/u);
  // The hot pass stays unfogged, but uses lighting so limbs and clothing folds
  // remain visible instead of becoming a flat white cut-out.
  assert.match(client, /const thermalHotMaterial = new THREE\.MeshPhongMaterial\(\{/u,
    'the hot override must retain surface detail');
  assert.match(client, /color: 0xe23800,[\s\S]*?emissive: 0x790800,[\s\S]*?fog: false/u,
    'players should read as emissive red-orange heat');
});

test('the hot pass is drawn over the cold one, not instead of it', () => {
  const body = fnBody('renderFrame');
  const coldAt = body.indexOf('scene.overrideMaterial = thermalColdMaterial;');
  const hotAt = body.indexOf('scene.overrideMaterial = thermalHotMaterial;');
  assert.ok(coldAt > 0 && hotAt > coldAt, 'cold first, then hot');

  const between = body.slice(coldAt, hotAt);
  assert.match(between, /renderer\.render\(scene, camera\);/u, 'the cold pass has to actually render');

  const afterCold = body.slice(coldAt);
  // THE bug. autoClear = false is not enough on its own: three.js force-clears
  // whenever scene.background is a Color, regardless of autoClear, which wipes
  // the colour and depth the cold pass just wrote. Dropping the background for
  // the hot pass is what preserves both.
  const nullAt = afterCold.indexOf('scene.background = null;');
  const hotRenderAt = afterCold.indexOf('renderer.render(scene, camera);', afterCold.indexOf('scene.overrideMaterial = thermalHotMaterial;'));
  assert.ok(nullAt > 0 && hotRenderAt > nullAt,
    'the background must be cleared to null before the hot pass renders');
  assert.match(afterCold.slice(0, hotRenderAt), /renderer\.autoClear = false;/u);
  assert.match(afterCold.slice(0, hotRenderAt), /camera\.layers\.set\(THERMAL_LAYER\);/u);
});

test('the optic does not see through walls', () => {
  const body = fnBody('renderFrame');
  // The depth buffer written by the cold pass is the entire occlusion
  // guarantee: a body behind a wall fails the depth test in the hot pass. There
  // is no separate visibility check, so anything that clears depth between the
  // two passes silently turns this sight into a wallhack.
  assert.doesNotMatch(body, /renderer\.clear\(/u, 'nothing may clear between the passes');
  assert.doesNotMatch(body, /clearDepth/u);
  assert.doesNotMatch(body, /depthTest: false/u, 'the hot material must be depth-tested');
  assert.doesNotMatch(body, /renderOrder/u);
});

test('heat sources are bodies and fire, and are re-marked every frame', () => {
  const body = fnBody('thermalHeatSources');
  assert.match(body, /remotePlayers\.forEach/u, 'other players are warm');
  assert.match(body, /adminDummies\.forEach/u, 'so are admin dummies');
  assert.match(body, /molotovFires/u, 'so is fire');

  const render = fnBody('renderFrame');
  // Marked per frame rather than at spawn: a character GLB that finishes
  // streaming in, or a model rebuilt on a skin change, arrives carrying only
  // the default layer and would otherwise render cold - invisible, in a sight
  // whose entire job is to show bodies.
  assert.match(render, /group\.traverse\(node => node\.layers\.enable\(THERMAL_LAYER\)\);/u);
  assert.match(render, /if \(!node\.isLight\) return;[\s\S]*?node\.layers\.enable\(THERMAL_LAYER\);/u,
    'the lit hot material needs the existing scene lights on its isolated pass');
  assert.match(render, /savedLayerMasks\.forEach\(\(mask, node\) => \{ node\.layers\.mask = mask; \}\);/u,
    'and every original layer mask is restored so the state stays local');
});

test('thermal targets remain visible through smoke without becoming visible through walls', () => {
  assert.match(client, /const THERMAL_SMOKE_LAYER = 4;/u);
  assert.match(client, /const thermalSmokeMaterial = new THREE\.MeshBasicMaterial\(\{[\s\S]*?opacity: 0\.14,[\s\S]*?depthWrite: false,/u,
    'thermal smoke should be a faint non-occluding cool overlay');
  assert.match(fnBody('thermalSmokeSources'), /smokeClouds\.map/u);

  const body = fnBody('renderFrame');
  const coldAt = body.indexOf('scene.overrideMaterial = thermalColdMaterial;');
  const hotAt = body.indexOf('scene.overrideMaterial = thermalHotMaterial;');
  const smokeAt = body.indexOf('scene.overrideMaterial = thermalSmokeMaterial;');
  assert.ok(coldAt > 0 && smokeAt > coldAt && hotAt > smokeAt,
    'draw the map, then faint smoke, then hot targets clearly on top');
  assert.match(body, /node\.layers\.set\(THERMAL_SMOKE_LAYER\)/u,
    'smoke must leave the cold pass or the override would make it opaque');
  assert.match(body, /camera\.layers\.set\(THERMAL_SMOKE_LAYER\);[\s\S]*?renderer\.render\(scene, camera\);/u);
  assert.doesNotMatch(body, /clearDepth/u, 'wall depth must remain intact for every thermal pass');
});

test('a thermal frame leaves the scene exactly as it found it', () => {
  const body = fnBody('renderFrame');
  // Every one of these leaks into the next frame - which is a normal,
  // unscoped frame - if it is not put back.
  for (const restore of [
    'scene.overrideMaterial = prevOverride;',
    'scene.background = prevBackground;',
    'scene.fog = prevFog;',
    'renderer.autoClear = prevAutoClear;',
    'camera.layers.set(0);'
  ]) assert.ok(body.includes(restore), `renderFrame must restore: ${restore}`);
  assert.match(body, /const prevFog = scene\.fog;/u);
  // Fog is swapped, not merely recoloured: a map that ships with no fog must
  // not gain any.
  assert.match(body, /scene\.fog = prevFog \? thermalFog : null;/u);
});

test('the frame loop renders through renderFrame, the QA hooks do not', () => {
  const loopAt = client.indexOf('if (!gameStarted && !localSkinLabTest) {');
  assert.ok(loopAt > 0, 'index.html must contain the frame loop');
  const loop = client.slice(loopAt);
  // Every early-return path renders too. One that called renderer.render
  // directly would drop out of thermal for that frame and strobe the scope.
  assert.equal((loop.match(/renderer\.render\(scene, camera\);/gu) || []).length, 0,
    'no frame-loop path may bypass renderFrame');
  assert.ok((loop.match(/renderFrame\(\);/gu) || []).length >= 6);
  // The admin-map QA hooks render a scene nobody is scoped in, and run before
  // the loop - they keep the plain call.
  const hooks = client.slice(0, loopAt);
  assert.ok((hooks.match(/renderer\.render\(scene, camera\);/gu) || []).length >= 4);
});

test('the scope says which optic it is', () => {
  assert.match(client, /#sniper-ui\.thermal \{/u, 'the thermal vignette needs its own style');
  assert.match(client, /<div class="thermal-label">THERMAL<\/div>/u);
  assert.match(client, /#sniper-ui \.thermal-label \{ display: none;/u,
    'the label must be hidden on a normal scope');
  const zoom = fnBody('toggleZoom');
  assert.match(zoom, /classList\.toggle\('thermal', thermalScopeActive\(\)\)/u,
    'the class has to follow the weapon, not just the zoom');
});
