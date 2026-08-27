// Last updated: 13 August 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const db = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

assert.match(db, /metric IN \([^)]*'mapWins'/, 'map wins should be a persisted challenge metric');
assert.match(db, /seed_map_win_challenges_2026_08_13[\s\S]*?weekly_hard_map_wins_mirage/, 'daily and weekly map-win templates should be seeded idempotently');
assert.match(server, /\{ id: 'mapWins', label: 'Map wins' \}/, 'the challenge editor should expose map wins');
assert.match(server, /\[`mapWins:\$\{roomMapId\}`\]/, 'wins should increment a map-specific counter');
assert.match(html, /data-daily-field="map"/, 'the editor should let admins choose the challenge map');

assert.match(db, /copy_daily_weapon_kills_into_daily_stats_2026_08_13/, 'legacy daily weapon data should copy through an idempotent migration');
assert.match(db, /FROM daily_weapon_kills legacy[\s\S]*?ON CONFLICT \(date_key, player_key\) DO UPDATE/, 'the migration should add legacy values to daily_stats');
assert.match(db, /source rows retained/, 'the migration should explicitly preserve the source table');
assert.doesNotMatch(db, /DROP TABLE\s+(?:IF EXISTS\s+)?daily_weapon_kills/i, 'the source table must not be dropped');
assert.match(db, /async function recordWeaponKill[\s\S]*?INSERT INTO daily_stats/, 'new daily weapon wins should write to the main daily table');
assert.match(db, /async function getDailyWeaponKills[\s\S]*?FROM daily_stats/, 'challenge reads should use the consolidated main daily table');

console.log('map-wins-db-consolidation: map challenges and non-destructive daily weapon migration verified.');
