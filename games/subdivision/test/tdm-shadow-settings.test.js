// Last updated: 15 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

assert.match(server, /function teamKillTotals[\s\S]*?room\.settings\?\.gamemode !== 'tdm'[\s\S]*?player\.kills/, 'server should authoritatively total TDM kills by team');
assert.match(server, /function getRoomState[\s\S]*?teamKills: teamKillTotals\(room\)/, 'room state should include authoritative TDM totals');
assert.match(server, /respawnPlayer\(client\.roomCode, target[\s\S]*?teamKills: teamKillTotals\(room\)/, 'kill events should immediately carry updated TDM totals');

assert.ok(html.includes('id="tdm-team-score"'), 'game HUD should include the TDM team kill counter');
assert.ok(html.includes('id="tdm-score-ct"') && html.includes('id="tdm-score-t"'), 'TDM counter should show both Counter-Terrorist and Terrorist totals');
assert.match(html, /function applyTdmTeamKills[\s\S]*?tdm-score-ct[\s\S]*?tdm-score-t/, 'client should render server-provided team totals');
assert.match(html, /function refreshTdmHud[\s\S]*?score\.style\.display = isTDM\(\) \? 'grid' : 'none'/, 'team counter should only display in TDM');

assert.ok(html.includes('id="set-shadow-quality"'), 'visual settings should expose shadow quality');
for (const quality of ['off', 'low', 'medium', 'high']) {
  assert.ok(html.includes(`${quality}: { enabled:`), `shadow renderer should define the ${quality} profile`);
}
assert.match(html, /function applyShadowQuality[\s\S]*?renderer\.shadowMap\.enabled[\s\S]*?shadow\.mapSize\.set[\s\S]*?object\.castShadow[\s\S]*?object\.receiveShadow/, 'shadow quality should control renderer, resolution, casters, and receivers');
assert.match(html, /function updateShadowLightAnchor[\s\S]*?mainShadowLight\.target\.position\.set/, 'directional shadows should follow the active play area');
assert.match(html, /shadowQuality[\s\S]*?localStorage\.setItem\('webfps_settings'/, 'shadow quality should persist with player settings');

console.log('tdm-shadow-settings: authoritative team counter and runtime shadow quality controls verified.');
