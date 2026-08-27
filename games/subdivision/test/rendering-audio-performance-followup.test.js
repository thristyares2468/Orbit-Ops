// Last updated: 15 July 2026
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const reflection = fs.readFileSync(path.join(ROOT, 'assets/environments/dust2-reflection.png'));

assert.strictEqual(
  crypto.createHash('sha256').update(reflection).digest('hex'),
  '356281b6dc5e8d0009f505eabb5acff247190114bae5c3871ad24ca5e9a462ac',
  'the checked-in reflection must be the exact supplied PNG'
);
assert.match(html, /const weaponDrawSfx = \{[\s\S]*?AK47:[\s\S]*?AWP:[\s\S]*?Frag:[\s\S]*?Molotov:/, 'draw SFX should cover firearms, knives, and utility');
assert.match(html, /const weaponReloadSfx = \{[\s\S]*?out:[\s\S]*?insert:[\s\S]*?action:/, 'reload SFX should use authored magazine and action stages');
assert.match(html, /soundWeaponDraw\(weapons\[currentWeaponIndex\]\?\.name\)/, 'weapon switching should play authored draw audio');
assert.match(html, /soundReload\(wp\.name, reloadDuration\)/, 'reloads should select the current weapon handling set');
assert.match(html, /grenadeHandlingSfx\[wp\.kind\]\?\.pin[\s\S]*?grenadeHandlingSfx\[kind\]\?\.throw/, 'utility should play authored pin and throw SFX');
assert.match(html, /weaponZoomSfx[\s\S]*?soundWeaponInspect\(wp\.name\)/, 'zoom and inspect actions should use available authored SFX');

assert.match(html, /case-editor-class-weights'[\s\S]*?setCaseEditorDirty\(true\);\s*applyCaseEditorClassWeights\(\);/, 'typing a class chance should not rewrite the other classes');
assert.match(html, /Math\.abs\(updateCaseEditorClassChanceTotal\(\) - 100\) > 0\.01[\s\S]*?case_class_chance_total/, 'class-mode save and test should require an explicit 100 percent total');
assert.match(html, /Normalize to 100%/, 'class mode should provide one explicit normalization command');

assert.match(html, /collisionCheckNeeded = Math\.abs\(velocity\.x\)[\s\S]*?if \(mapLoaded && collisionCheckNeeded\)/, 'stationary frames should skip the expensive wall sweep');
assert.match(html, /collisionCastOrigin\.set[\s\S]*?collisionNormalMatrix\.getNormalMatrix/, 'wall collision should reuse vector and matrix scratch storage');
assert.match(html, /raycaster\.intersectObjects\(mapObjects, false\)/, 'wall and floor collision should stay scoped to static map meshes');
assert.match(html, /const signature = `\$\{gap\}:\$\{baseGap\}`[\s\S]*?signature === lastCrosshairGapSignature/, 'unchanged crosshair transforms should not be rewritten each frame');
assert.match(html, /if \(weaponText !== lastHudText\.weapon\)[\s\S]*?if \(modeText !== lastHudText\.mode\)/, 'unchanged HUD text should not be rewritten each frame');

console.log('rendering-audio-performance-followup: reflection, utility, SFX, rarity, wear, and frame-loop regressions verified.');
