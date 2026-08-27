// Last updated: 15 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const db = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

assert.match(db, /CREATE TABLE IF NOT EXISTS daily_challenge_templates[\s\S]*?period TEXT NOT NULL DEFAULT 'daily'[\s\S]*?metric TEXT NOT NULL[\s\S]*?enabled BOOLEAN NOT NULL DEFAULT true/, 'database should persist separate daily and weekly challenge templates');
assert.match(db, /CREATE INDEX IF NOT EXISTS idx_daily_challenge_templates_tier ON daily_challenge_templates \(tier, enabled, sort_order, id\)[\s\S]*?await pool\.query\(`ALTER TABLE daily_challenge_templates ADD COLUMN IF NOT EXISTS period[\s\S]*?CREATE INDEX IF NOT EXISTS idx_challenge_templates_period_tier/, 'existing databases must add the period column before creating the period-aware index');
assert.match(db, /seed_daily_challenge_templates_2026_07_11[\s\S]*?hard_weapon_25[\s\S]*?ON CONFLICT \(id\) DO NOTHING/, 'database should seed the initial editable challenge pool exactly once');
assert.match(db, /seed_weekly_challenge_templates_2026_07_14[\s\S]*?weekly_hard_weapon_100[\s\S]*?ON CONFLICT \(id\) DO NOTHING/, 'database should seed a dedicated editable weekly challenge pool exactly once');
assert.match(db, /async function getDailyChallengeTemplates[\s\S]*?async function upsertDailyChallengeTemplate[\s\S]*?async function deleteDailyChallengeTemplate/, 'database should expose challenge template CRUD');

for (const packet of ['getDailyChallengeEditor', 'saveDailyChallengeTemplate', 'deleteDailyChallengeTemplate']) {
  assert.match(server, new RegExp(`if \\(type === '${packet}'\\)[\\s\\S]*?isAdminUser\\(client\\)`), `${packet} must be admin-gated`);
}
assert.match(server, /function sanitizeDailyChallengeTemplate[\s\S]*?DAILY_CHALLENGE_TIERS[\s\S]*?DAILY_CHALLENGE_METRIC_IDS[\s\S]*?invalid_challenge_weapon/, 'server should validate every editable challenge field');
assert.match(server, /async function dailyChallengeDefinitions[\s\S]*?getDailyChallengeTemplates\(\{ enabledOnly: true, period: 'daily' \}\)[\s\S]*?\['easy', 'medium', 'hard'\]/, 'daily selection should choose one enabled persisted template per tier');
assert.match(server, /async function weeklyChallengeDefinitions[\s\S]*?getDailyChallengeTemplates\(\{ enabledOnly: true, period: 'weekly' \}\)[\s\S]*?rewardCase: template\.tier === 'hard'/, 'weekly selection should use its own editable pool and flag the hard case reward');
assert.match(server, /function refreshDailyChallengeDefinitions[\s\S]*?dailyChallengeDefinitionCache = null[\s\S]*?sendDailyChallengeProgress/, 'admin edits should invalidate the current rotation and refresh connected players');
assert.match(server, /challenge\.key === 'weaponKills'[\s\S]*?weaponProgress\.get\(challenge\.weapon\)/, 'editable weapon challenges should use per-weapon authoritative progress');

for (const id of ['btn-admin-daily-challenges', 'daily-challenge-editor-menu', 'daily-challenge-editor-list', 'btn-daily-challenge-add', 'btn-daily-challenge-refresh']) {
  assert.ok(html.includes(`id="${id}"`), `admin UI should include ${id}`);
}
assert.match(html, /function renderDailyChallengeEditor[\s\S]*?dailyChallengeEditorRowMarkup[\s\S]*?function saveDailyChallengeEditorRow[\s\S]*?saveDailyChallengeTemplate/, 'client editor should render and save challenge rows');
assert.match(html, /data-challenge-editor-period="daily"[\s\S]*?data-challenge-editor-period="weekly"[\s\S]*?function setChallengeEditorPeriod/, 'challenge editor should switch cleanly between daily and weekly pools');
assert.match(html, /data-daily-field="tier"[\s\S]*?data-daily-field="metric"[\s\S]*?data-daily-field="target"[\s\S]*?data-daily-field="xp"[\s\S]*?data-daily-field="weapon"[\s\S]*?data-daily-field="label"/, 'challenge rows should expose all editable definition fields');
assert.match(html, /const localDailyChallengeEditorTest[\s\S]*?loadLocalDailyChallengeEditorPreview/, 'localhost should expose a rendered challenge editor fixture');

console.log('daily-challenge-editor: persisted admin CRUD, authoritative rotation, and editor UI verified.');
