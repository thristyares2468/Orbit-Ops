const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

// The whole client is one inline script. A syntax error anywhere in it stops the
// browser evaluating any of it, so the page paints its CSS and then does nothing
// at all - no menu, no logo, no error. Nothing else in this suite catches that,
// because every other test matches source text rather than parsing it.
//
// This exists because a merge once left two declarations of the same variable
// several thousand lines apart, which is invisible to review and fatal at runtime.
function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
}

test('index.html inline scripts parse', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const blocks = inlineScripts(html);
  assert.ok(blocks.length > 0, 'index.html should carry at least one inline script');
  // Compiled, never run: this asks the engine to parse, nothing more.
  assert.doesNotThrow(
    () => new vm.Script(blocks.join('\n;\n'), { filename: 'index.html-inline.js' }),
    'the client script must parse, or the page renders nothing'
  );
});

test('legal.html inline scripts parse', () => {
  const html = fs.readFileSync(path.join(root, 'legal.html'), 'utf8');
  for (const [index, block] of inlineScripts(html).entries()) {
    assert.doesNotThrow(
      () => new vm.Script(block, { filename: `legal.html-inline-${index}.js` }),
      `legal.html inline script ${index} must parse`
    );
  }
});

// A duplicate declaration is the specific failure that motivated this file, and
// it is worth naming: the parse check above catches it, but this reports which
// identifier is at fault instead of just a line number.
test('no script-scope identifier is declared twice', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const seen = new Map();
  for (const block of inlineScripts(html)) {
    for (const match of block.matchAll(/^ {8}(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*[=;]/gm)) {
      const name = match[1];
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }
  }
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
  assert.deepEqual(duplicates, [], `declared more than once at script scope: ${duplicates.join(', ')}`);
});
