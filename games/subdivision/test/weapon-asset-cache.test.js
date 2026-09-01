'use strict';

// Weapon assets are served `Cache-Control: immutable, max-age=31536000`, so the
// `?v=WEAPON_ASSET_CACHE_VERSION` query string is the only thing that can get a
// replaced model to a browser that already has the old one. Forgetting to bump
// it ships a fix that nobody sees — which is exactly how a shotgun stayed rolled
// onto its side after the model was corrected.
//
// This pins the content of every weapon asset against the version that was
// current when it last changed. Adding a NEW asset is free (a new URL was never
// cached). Changing an EXISTING one without bumping the version fails here.
//
// After a deliberate change, refresh the manifest with:
//   UPDATE_WEAPON_ASSET_CACHE=1 node --test test/weapon-asset-cache.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(__dirname, 'weapon-asset-cache.json');
const ASSET_DIR = path.join(ROOT, 'assets/weapons');

function currentVersion() {
  const client = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const match = client.match(/const WEAPON_ASSET_CACHE_VERSION = '([^']+)'/);
  assert.ok(match, 'index.html must declare WEAPON_ASSET_CACHE_VERSION');
  return match[1];
}

function assetDigests() {
  return Object.fromEntries(fs.readdirSync(ASSET_DIR)
    .filter(name => name.endsWith('.glb'))
    .sort()
    .map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(ASSET_DIR, name))).digest('hex').slice(0, 16)]));
}

test('a replaced weapon asset comes with a cache-version bump', () => {
  const version = currentVersion();
  const digests = assetDigests();
  if (process.env.UPDATE_WEAPON_ASSET_CACHE === '1') {
    fs.writeFileSync(MANIFEST, `${JSON.stringify({ version, assets: digests }, null, 2)}\n`);
    return;
  }
  assert.ok(fs.existsSync(MANIFEST), 'run with UPDATE_WEAPON_ASSET_CACHE=1 to create the manifest');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const replaced = Object.keys(manifest.assets)
    .filter(name => digests[name] && digests[name] !== manifest.assets[name]);
  if (replaced.length && manifest.version === version) {
    assert.fail(`${replaced.join(', ')} changed but WEAPON_ASSET_CACHE_VERSION is still '${version}'. ` +
      'These files are served immutable for a year, so every browser that already loaded them will keep the old copy. ' +
      'Bump the constant in index.html, then refresh this manifest with UPDATE_WEAPON_ASSET_CACHE=1.');
  }
  if (replaced.length || manifest.version !== version) {
    assert.fail('weapon assets or the cache version moved; refresh the manifest with UPDATE_WEAPON_ASSET_CACHE=1.');
  }
  // Assets that only ever get added are fine: a new URL was never cached.
  for (const [name, digest] of Object.entries(manifest.assets)) {
    if (digests[name]) assert.equal(digests[name], digest, `${name} content drifted from the manifest`);
  }
});
