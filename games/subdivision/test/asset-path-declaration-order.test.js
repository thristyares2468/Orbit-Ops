// Regression: every skin preview went blank because of declaration order.
//
// EMBEDDED_ASSET_ROOT and EMBEDDED_ASSET_PREFIX are `const`, so they sit in a
// temporal dead zone until the line declaring them runs. They used to be
// declared beside the loaders, roughly seven thousand lines below the weapon
// tables - but the first weapon model is built while the inline script is still
// executing, long before that point. So the very first loadWeaponAsset() threw
// a ReferenceError from inside its promise executor. That rejection was cached
// in weaponAssetPending and handed to every later caller for the life of the
// page: no 3D previews, no inventory thumbnails, no case-editor previews, and
// no error in the console, because each caller swallowed it.
//
// A parse test cannot catch this - the file is perfectly valid JavaScript. The
// only thing that keeps it fixed is the declaration staying above its first use.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function firstIndex(pattern) {
  const match = html.match(pattern);
  assert.ok(match, `expected to find ${pattern} in index.html`);
  return match.index;
}

test('the asset-path constants are declared before anything that reads them', () => {
  const declaration = firstIndex(/const EMBEDDED_ASSET_ROOT = /u);

  // The functions that close over them.
  assert.ok(declaration < firstIndex(/function embeddedAssetPath\(/u));
  assert.ok(declaration < firstIndex(/function versionedWeaponAssetPath\(/u));

  // And the callers. loadWeaponAsset is the one that actually ran too early.
  for (const caller of [
    /function loadWeaponAsset\(/u,
    /async function getInventoryThumbnailUrl\(/u,
    /function attachWeaponAsset\(/u
  ]) {
    assert.ok(declaration < firstIndex(caller), `${caller} must come after the declaration`);
  }
});

test('the asset root is still assembled from pieces', () => {
  // The server rewrites every literal occurrence of the asset root in this
  // document to prefix it with the gateway path. Written whole, this constant
  // would be rewritten too, and the "does this path need prefixing?" test would
  // then only ever match paths that had already been prefixed.
  assert.match(html, /const EMBEDDED_ASSET_ROOT = `\/\$\{'assets'\}\/`;/u);
});

test('a failed weapon load does not wedge every later one', () => {
  // A promise that rejects before loader.load is reached never runs the error
  // callback that clears weaponAssetPending, so the rejection would be replayed
  // to every subsequent caller.
  const body = html.match(/function loadWeaponAsset\([\s\S]*?\n        \}/u)[0];
  assert.match(body, /pending\.catch\(\(\) => \{ weaponAssetPending\.delete\(cacheKey\); \}\);/u);
});

test('setInventoryThumbnailImage is defined exactly once', () => {
  const count = html.match(/function setInventoryThumbnailImage\(/gu)?.length ?? 0;
  assert.equal(count, 1);
});
