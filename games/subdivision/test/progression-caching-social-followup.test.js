// Last updated: 15 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const db = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
const antiflood = fs.readFileSync(path.join(ROOT, 'antiflood.js'), 'utf8');
const legal = fs.readFileSync(path.join(ROOT, 'legal.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

assert.match(server, /function matchXpForPlayer[\s\S]*?participationXp[\s\S]*?won \? participationXp \* 2 : participationXp/, 'match winners should receive exactly twice the participation XP');
assert.match(server, /function mowbucksForLevels[\s\S]*?Math\.min\(200, 100 \+ \(\(level - 1\) \* 5\)\)/, 'per-level Mowbucks should grow and cap at 200');
assert.match(db, /function mowbucksForLevels[\s\S]*?Math\.min\(200, 100 \+ \(\(level - 1\) \* 5\)\)/, 'case collection level-ups should use the same growing Mowbucks reward');

assert.match(server, /matchChallengeDelta: newMatchChallengeDelta\(\)/, 'connections should track current-match challenge progress');
assert.match(server, /rendered\.push\(\{ \.\.\.challenge, progress, matchProgress, claimed:/, 'daily challenge responses should include match-only progress');
assert.match(html, /id="pause-daily-challenges"[\s\S]*?function renderPauseDailyChallenges[\s\S]*?class="match"[\s\S]*?this match/, 'the pause menu should distinguish current-match challenge progress');
assert.match(antiflood, /getDailyChallengeProgress:[\s\S]*?getFriendInventory:/, 'new lobby read packets should be rate limited');

assert.match(server, /if \(type === 'getFriendInventory'\)[\s\S]*?sendFriendInventory/, 'friend inventory requests should have an explicit route');
assert.match(server, /async function sendFriendInventory[\s\S]*?db\.areFriends\(client\.accountId, accountId\)[\s\S]*?item_id:[\s\S]*?wear_seed:/, 'friend inventories should require accepted friendship and expose appearance-only fields');
assert.ok(html.includes('id="btn-friend-inventory"'), 'friend profiles should include an inventory viewer command');
assert.match(html, /function renderFriendInventory[\s\S]*?friend-inventory-card/, 'friend inventories should render as read-only cosmetic cards');
assert.match(html, /data-friend-inventory-index[\s\S]*?openReadOnlySkinInspect/, 'friend inventory cards should open the shared read-only inspector');

assert.match(db, /getAllTimeLeaderboardStats[\s\S]*?s\.xp/, 'all-time leaderboard rows should include persistent XP');
assert.match(server, /meta\.scope === 'allTime'\) boards\.level/, 'account level should only be emitted for the all-time leaderboard');
assert.match(html, /data-board="level"[\s\S]*?activeLeaderboard === 'level'\) activeLeaderboardScope = 'allTime'/, 'the level tab should force the all-time scope');

assert.match(serviceWorker, /url\.pathname\.startsWith\('\/assets\/'\)[\s\S]*?cache\.match\(request\)[\s\S]*?cache\.put\(request, response\.clone\(\)\)/, 'the service worker should persist same-origin game assets cache-first');
assert.match(html, /THREE\.Cache\.enabled = true[\s\S]*?navigator\.serviceWorker\.register\('\/sw\.js'\)/, 'the client should reuse Three.js resources and register persistent asset caching');
assert.match(html, /const \[template, reflectionTexture, skinTexture, wearTextures, overlayTexture\] = await Promise\.all/, 'thumbnail dependencies should load concurrently');

assert.match(html, /if \(scoreboard\.style\.display === 'block'\) updateScoreboard\(\);/, 'remote state updates should not rebuild a hidden scoreboard');
assert.match(html, /const renderTime = netClock\.renderServerTime\(time\);[\s\S]*?remotePlayers\.forEach/, 'remote interpolation should share its render timestamp and only walk remote players');
assert.match(html, /if \(!data\.characterAsset\?\.visible\)[\s\S]*?updateCharacterAssetAnimation/, 'loaded GLB players should skip hidden procedural visual animation work');

assert.match(db, /async function listAccounts\(\)[\s\S]*?ORDER BY last_login DESC NULLS LAST, id DESC`/, 'admin moderation should return every account without an arbitrary limit');
assert.doesNotMatch(html + server + db, /adminGrantPlayerSkin|adminRemovePlayerSkin|adminGetPlayerInventory|grantSkinInventoryItem|removeSkinInventoryItem/, 'the production Add Skin editor and its APIs should be removed');

for (const phrase of ['inventory wipes', 'reset XP', 'account deletions', 'bots or gameplay automation in any form', 'cheat in any form']) {
  assert.ok(legal.toLowerCase().includes(phrase.toLowerCase()), `legal page should disclose: ${phrase}`);
}

console.log('progression-caching-social-followup: progression, caching, social views, moderation, and lobby performance verified.');
