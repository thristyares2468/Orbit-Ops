// Last updated: 13 August 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const db = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
const maps = require('../maps');
const manifest = require('../assets/profile-icons/manifest.json');

const playerIcons = ['player-round-v3.png', 'player-shield-v3.png', 'player-portrait-v3.png'];
for (const filename of [...playerIcons, 'admin-v3.png']) {
  const bytes = fs.readFileSync(path.join(ROOT, 'assets', 'profile-icons', filename));
  assert.strictEqual(bytes.subarray(1, 4).toString(), 'PNG', `${filename} should be a PNG`);
  assert.ok(bytes.readUInt32BE(16) >= 256 && bytes.readUInt32BE(20) >= 384, `${filename} should remain crisp in large account views`);
}
assert.strictEqual(manifest['admin-v3.png'], 'ChatGPT Image Aug 13, 2026, 12_40_42 PM (7).png', 'the reserved admin avatar must come from the requested source icon');
assert.ok(playerIcons.every(filename => !/\(10\)\.png$/.test(manifest[filename])), 'ordinary player avatars must exclude the reserved admin source');
assert.match(html, /\.profile-avatar-image[^}]*padding:0;[^}]*object-fit:contain;[^}]*object-position:center/, 'profile badges should preserve their supplied aspect ratio inside square slots');
assert.match(html, /\.hub-avatar img[^}]*position:absolute;[^}]*inset:0;[^}]*min-width:0;[^}]*max-height:100%;[^}]*object-fit:contain;[^}]*transform:scale\(1\.22\);/, 'square avatar frames should override the tall PNG intrinsic size and uniformly tighten its transparent padding');
assert.match(html, /\.hub-news-img \{[^}]*overflow:hidden;[^}]*min-width:0;[^}]*min-height:0;/, 'news artwork should be clipped by its frame without stretching or overflowing');
assert.match(html, /\.friend-avatar-art \{[^}]*overflow:hidden;[^}]*\}[\s\S]*?\.friend-avatar-art img[^}]*object-fit:contain;[^}]*transform:scale\(1\.22\);/, 'friend artwork should preserve its ratio inside an inner clipping layer while leaving presence dots untouched');
assert.match(html, /<span class="friend-avatar-art"><img[^>]+><\/span>\$\{includePresence/, 'friend presence dots should remain siblings of the clipped artwork layer');
assert.match(html, /const PROFILE_ICON_PATHS = new Set\(\[\.\.\.PLAYER_PROFILE_ICONS, ADMIN_PROFILE_ICON\]\)/, 'the client should only render the shipped profile icon allowlist');
assert.match(server, /if \(normalizedRole === 'admin' \|\| normalizedRole === 'owner'\) return ADMIN_PROFILE_ICON/, 'database admin and owner roles should always receive the reserved avatar');
assert.match(server, /PLAYER_PROFILE_ICONS\[\(hash >>> 0\) % PLAYER_PROFILE_ICONS\.length\]/, 'regular players should receive a stable randomized icon');
assert.match(server, /profileIcon: profileIconForClient\(client\)/, 'authenticated users and room players should receive their server-owned profile icon');
assert.match(db, /other\.role AS other_role/, 'offline friend profiles should preserve database role-aware avatars');
assert.match(db, /SELECT a\.id AS account_id, a\.username, a\.role, r\.last_seen/, 'recent players should preserve database role-aware avatars');

assert.deepStrictEqual(maps.PUBLIC_MAP_IDS, ['dust2', 'nuke', 'inferno', 'mirage']);
assert.strictEqual(maps.MAP_DEFS.nuke.adminOnly, false, 'Nuke should be released publicly');
assert.ok(!maps.MAP_DEFS.inferno.adminOnly && maps.MAP_DEFS.vertigo.adminOnly && !maps.MAP_DEFS.mirage.adminOnly, 'Inferno and Mirage should be public while Vertigo stays admin-only');
assert.match(html, /id="create-map-select"[\s\S]*?value="dust2"[\s\S]*?value="nuke"[\s\S]*?value="inferno"[\s\S]*?value="mirage"/, 'lobby hosts should choose every public map');
assert.match(server, /PUBLIC_MAP_VOTE_MS = 5000/, 'the authoritative voting period should last exactly five seconds');
assert.match(server, /MVP_SCREEN_MS = 6250/, 'the MVP screen should remain for the one-second winner reveal after voting, including network margin');
assert.match(server, /PUBLIC_MAP_VOTE_MIN_OPTIONS = 2[\s\S]*?PUBLIC_MAP_VOTE_MAX_OPTIONS = 4/, 'map votes should support two to four candidates');
assert.match(server, /function startRoomMapVote[\s\S]*?'mapVoteStart'[\s\S]*?function handleRoomMapVote[\s\S]*?'mapVoteUpdate'/, 'the server should own vote start, validation, and live totals');
assert.match(server, /function finishRoomMapVote[\s\S]*?switchRoomMap\(roomCode, room, winner\.id, 'mapVoteResult'/, 'the winning map should drive an authoritative room reload');
assert.match(server, /function startRoomMapVote\(roomCode, room, delayMs = DEATH_SPECTATE_MS\)/, 'the map vote should begin when the MVP presentation begins');
assert.match(html, /id="map-vote-overlay"[\s\S]*?id="map-vote-progress"[\s\S]*?id="map-vote-options"/, 'the client should render a stable countdown and candidate surface');
assert.match(html, /function showMapVote[\s\S]*?fetch\(path, \{ cache: 'force-cache' \}\)/, 'vote candidates should preload their full-quality map asset');
assert.match(html, /\.map-vote-option\.winner[^}]*transition:background-color \.2s ease/, 'winning vote option should brighten over two tenths of a second');
assert.match(html, /function revealMapVoteWinner[\s\S]*?winnerMapId[\s\S]*?setTimeout\(\(\) => hideMapVote\(result\), 1000\)/, 'winner should remain visible for one second while the map reload path runs behind the locked MVP view');
assert.match(html, /type === 'mapVoteStart'[\s\S]*?showMapVote\(data\)[\s\S]*?type === 'mapVoteUpdate'[\s\S]*?updateMapVote\(data\)/, 'the client should follow authoritative vote state');

console.log('public-map-vote-profile-icons: public map selection, server voting, and role-safe profile icons verified.');
