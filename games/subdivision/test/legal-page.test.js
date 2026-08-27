// Last updated: 13 August 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const legalHtml = fs.readFileSync(path.join(ROOT, 'legal.html'), 'utf8');
const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// Legal footer should be present only on lobby/auth surfaces, with gameplay and
// hub subviews left unobstructed.
const footerCount = (indexHtml.match(/<nav class="legal-footer" aria-label="Legal information">/g) || []).length;
assert.strictEqual(footerCount, 3, 'legal footer should appear only on auth, boot, and main menu containers');
assert.ok(indexHtml.includes('#main-menu.hub-view-open .legal-footer { display: none; }'), 'hub subviews should hide the legal footer');

for (const href of ['/legal#privacy', '/legal#terms', '/legal#rules']) {
  assert.ok(indexHtml.includes(`href="${href}"`), `menu footer should link to ${href}`);
}
assert.ok(!indexHtml.includes('/legal#contact'), 'menu footers should not expose a removed Contact page');

assert.match(
  indexHtml,
  /id="main-menu"[\s\S]*?<nav class="legal-footer" aria-label="Legal information">/,
  'main menu should include the legal footer'
);
assert.match(
  indexHtml,
  /id="boot-menu"[\s\S]*?<nav class="legal-footer" aria-label="Legal information">/,
  'boot menu should include the legal footer'
);
assert.match(
  indexHtml,
  /id="auth-menu"[\s\S]*?<nav class="legal-footer" aria-label="Legal information">/,
  'auth menu should include the legal footer'
);

assert.match(
  serverJs,
  /urlPath === '\/legal' \|\| urlPath === '\/legal\/' \? '\/legal\.html' : urlPath/,
  'server should route /legal and /legal/ to the lightweight legal page'
);

for (const id of ['privacy', 'terms', 'rules']) {
  assert.ok(legalHtml.includes(`id="${id}"`), `legal page should include #${id} section`);
}
assert.ok(!legalHtml.includes('id="contact"'), 'legal page should not include a Contact section');

assert.ok(legalHtml.includes('Last updated: 13 August 2026'), 'legal page should show the current last updated date');
assert.ok(!legalHtml.includes('emartin@saac.qld.edu.au'), 'legal page should not publish the removed contact email');
assert.ok(legalHtml.includes('There is currently no monetisation on the Website.'), 'legal page should state there is no monetisation');
assert.ok(legalHtml.includes('process payments'), 'legal page should state there is no payment processing');
assert.ok(legalHtml.includes('have no real-world monetary value'), 'legal page should state virtual items have no real-world value');
assert.ok(legalHtml.includes('You must be at least 18 years old'), 'terms should require every user to be 18 or older');
assert.ok(legalHtml.includes('independent parody inspired by tactical multiplayer games including Counter-Strike'), 'terms should identify the game as a Counter-Strike-inspired parody');
assert.ok(legalHtml.includes('not intended to be taken seriously'), 'terms should state that the parody presentation is not serious or factual');
assert.ok(legalHtml.includes('User Responsibility at School, Work, and Other Locations'), 'terms should make school and workplace responsibility explicit');
assert.ok(legalHtml.includes('not responsible or liable for detention, discipline, academic penalties'), 'terms should disclaim school and workplace consequences to the permitted extent');
assert.ok(legalHtml.includes('current Terms acceptance version'), 'privacy wording should disclose the browser acceptance record');
assert.ok(legalHtml.includes('href="/">Back to game</a>'), 'legal page should include a Back to game link');
for (const wording of ['Australian Privacy Principles', 'reasonably necessary', 'destroy or de-identify', 'Access, Correction, Deletion, and Complaints', 'Office of the Australian Information Commissioner', 'overseas']) assert.ok(legalHtml.includes(wording), `privacy policy should cover ${wording}`);

for (const marker of ['id="terms-consent"', 'id="btn-terms-agree"', "const TERMS_ACCEPTANCE_VERSION = '2026-08-13-v4-australian-app-notice'", '18+ Only And Parody', 'Collection Notice', 'showTermsConsentIfNeeded();']) {
  assert.ok(indexHtml.includes(marker), `startup Terms gate should include ${marker}`);
}
assert.match(indexHtml, /function hasAcceptedCurrentTerms[\s\S]*?TERMS_ACCEPTANCE_VERSION[\s\S]*?function showTermsConsentIfNeeded/, 'startup should compare the stored acceptance against the current Terms version');
assert.match(indexHtml, /function acceptCurrentTerms[\s\S]*?acceptedAt:[\s\S]*?terms-consent'\)\.hidden = true/, 'I Agree should record a timestamped version before dismissing the gate');

console.log('legal-page: footer, route, consent gate, anchors, and required legal wording verified.');
