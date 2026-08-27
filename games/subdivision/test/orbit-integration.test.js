const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('Orbit Ops embed keeps the code return path without a persistent return button', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

  assert.match(html, /orbitReturnUrl/);
  assert.match(html, /ORBITOPS/);
  assert.doesNotMatch(html, /id="orbit-return"/);
  assert.doesNotMatch(html, /Return to Orbit Ops/);
  assert.match(server, /PUBLIC_BASE_PATH/);
  assert.match(server, /const websocketPath = `\$\{PUBLIC_BASE_PATH \|\| ''\}\/ws`/);
  assert.match(html, /Orbit Ops Subdivision/);
  assert.match(server, /orbit-ops-subdivision-badge-simple\.png/);
});

test('every menu scene loads a cache-busted orbital-aurora background', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const backgrounds = [
    'bg-auth-arena.jpg',
    'bg-boot-mower-vibrant.jpg',
    'bg-lobby-arena.jpg',
    'menu-background.jpg',
    'bg-profile-arena.jpg',
    'bg-leaderboard-arena.jpg',
    'bg-create-arena.jpg',
    'bg-servers-arena.jpg',
    'bg-settings-arena.jpg',
    'bg-cases-arena.jpg'
  ];

  for (const background of backgrounds) {
    assert.match(html, new RegExp(`${background.replace('.', '\\.')}\\?v=orbit-aurora-20260823`));
  }
  assert.match(html, /var\(--panel-bg-image\) center \/ cover no-repeat/);
});
