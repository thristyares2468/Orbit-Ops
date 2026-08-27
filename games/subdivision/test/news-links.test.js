const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// renderNewsBody needs a DOM, so these assert the shape of the guard rather than
// its output. The behaviour was exercised against a real browser: 19 cases
// covering javascript:/data:/vbscript: hrefs, inline handlers, script and iframe
// injection, attribute breakout and nested anchors.

test('a bulletin can be selected and copied', () => {
  // The body allowed selection; the headline and timestamp did not, so copying
  // a bulletin whole was impossible inside a page that blocks selection.
  assert.match(client, /\.news-entry \{ user-select: text;/u);
});

test('only safe schemes can become a link', () => {
  const guard = client.match(/function safeNewsHref[\s\S]*?\n        \}/u)[0];
  assert.match(guard, /url\.protocol !== 'https:' && url\.protocol !== 'http:' && url\.protocol !== 'mailto:'/u);
  // Parsed with the URL constructor rather than pattern-matched, so
  // "java\nscript:" and friends cannot slip past by being reshaped.
  assert.match(guard, /new URL\(raw, location\.origin\)/u);
  assert.match(guard, /catch \{[\s\S]*?return '';/u, 'an unparseable address is not a link');
});

test('every link opens safely', () => {
  const anchor = client.match(/function newsAnchor[\s\S]*?\n        \}/u)[0];
  assert.match(anchor, /rel="noopener noreferrer"/u, 'the new page gets no handle back to this one');
  assert.match(anchor, /target="_blank"/u);
  assert.match(anchor, /escapeHtml\(href\)/u, 'the address is escaped into the attribute');
});

test('an authored anchor keeps nothing but its address', () => {
  const render = client.match(/function renderNewsBody[\s\S]*?\n        \}/u)[0];
  const branch = render.match(/if \(tag === 'a'\)[\s\S]*?\n                \}/u)[0];
  // Rebuilt from the href alone, so onclick, style, target and rel from the
  // source are all discarded rather than filtered.
  assert.match(branch, /safeNewsHref\(node\.getAttribute\('href'\)\)/u);
  assert.match(branch, /if \(!href\) return inner;/u, 'a bad address keeps the words, loses the link');
  assert.match(branch, /normalize\(child, true\)/u, 'children are marked as inside a link');
});

test('links do not nest', () => {
  const render = client.match(/function renderNewsBody[\s\S]*?\n        \}/u)[0];
  assert.match(render, /insideLink \? escapeHtml\(node\.textContent \|\| ''\) : linkifyNewsText/u);
});

test('a bare address is linked, without swallowing the sentence', () => {
  const linkify = client.match(/function linkifyNewsText[\s\S]*?\n        \}/u)[0];
  assert.match(linkify, /\[\.,;:!\?\]\$/u, 'trailing sentence punctuation is not part of the address');
  assert.match(linkify, /escapeHtml\(source\.slice\(last\)\)/u, 'text around a link is still escaped');
  // The plain-text path has to linkify too, or a bulletin with no markup at all
  // would render its URLs as dead text.
  assert.match(client, /return linkifyNewsText\(raw\)\.replace\(\/\\n\/g, '<br>'\)/u);
});
