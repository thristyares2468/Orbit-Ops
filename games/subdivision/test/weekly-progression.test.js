// Last updated: 16 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const auth = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
const db = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

for (const [name, source] of [['auth', auth], ['database', db], ['server', server]]) {
  assert.ok(source.includes('const LEVEL_BASE_XP = 350;'), `${name} progression should use the easier 350 XP base`);
  assert.ok(source.includes('const LEVEL_XP_GROWTH = 1.15;'), `${name} progression should use the gentler 1.15 growth curve`);
  assert.match(source, /Math\.round\(LEVEL_BASE_XP \* Math\.pow\(LEVEL_XP_GROWTH, level - 1\)\)/, `${name} should calculate levels from the shared curve constants`);
}

const weeklyDateFunctions = server.match(/function weeklyStartDateKey\(date = new Date\(\)\) \{[\s\S]*?\n\}\n\nfunction weeklyChallengePeriodKey\(date = new Date\(\)\) \{[\s\S]*?\n\}/);
assert.ok(weeklyDateFunctions, 'server should define Brisbane weekly period helpers');
const weeklyDates = new Function(`${weeklyDateFunctions[0]}; return { weeklyStartDateKey, weeklyChallengePeriodKey };`)();
assert.strictEqual(weeklyDates.weeklyStartDateKey(new Date('2026-07-12T13:59:00.000Z')), '2026-07-06', 'Sunday night Brisbane time should remain in the prior week');
assert.strictEqual(weeklyDates.weeklyStartDateKey(new Date('2026-07-12T14:01:00.000Z')), '2026-07-13', 'Monday midnight Brisbane time should start a new week');
assert.strictEqual(weeklyDates.weeklyChallengePeriodKey(new Date('2026-07-12T14:01:00.000Z')), 'week:2026-07-13', 'weekly persistence keys should be isolated from daily keys');

const dailyDateFunctions = server.match(/function dailyDateKey\(date = new Date\(\)\) \{[\s\S]*?\n\}\n\nfunction dailyChallengePeriodKey\(date = new Date\(\)\) \{[\s\S]*?\n\}/);
assert.ok(dailyDateFunctions, 'server should define separate Brisbane calendar and challenge-period helpers');
const dailyDates = new Function(`${dailyDateFunctions[0]}; return { dailyDateKey, dailyChallengePeriodKey };`)();
assert.strictEqual(dailyDates.dailyDateKey(new Date('2026-07-13T13:59:00.000Z')), '2026-07-13', 'daily stats should remain on the Brisbane calendar day before midnight');
assert.strictEqual(dailyDates.dailyDateKey(new Date('2026-07-13T14:01:00.000Z')), '2026-07-14', 'daily stats should rotate at Brisbane midnight');
assert.strictEqual(dailyDates.dailyChallengePeriodKey(new Date('2026-07-14T01:59:00.000Z')), 'day:2026-07-14:am', 'morning challenges should run from midnight until midday');
assert.strictEqual(dailyDates.dailyChallengePeriodKey(new Date('2026-07-14T02:01:00.000Z')), 'day:2026-07-14:pm', 'afternoon challenges should begin at midday');
assert.strictEqual(dailyDates.dailyChallengePeriodKey(new Date('2026-07-14T14:01:00.000Z')), 'day:2026-07-15:am', 'a fresh morning challenge period should begin at midnight');

assert.match(server, /async function weeklyChallengeDefinitions[\s\S]*?period: 'weekly'[\s\S]*?rewardCase: template\.tier === 'hard'/, 'weekly challenges should use their dedicated editable pool');
assert.match(db, /CREATE TABLE IF NOT EXISTS weekly_challenge_rotations[\s\S]*?period_key TEXT PRIMARY KEY[\s\S]*?challenges JSONB NOT NULL/, 'weekly challenge selections should have persistent database storage');
assert.match(db, /async function saveWeeklyChallengeRotation[\s\S]*?ON CONFLICT \(period_key\) DO UPDATE[\s\S]*?RETURNING challenges/, 'concurrent servers should converge on one saved weekly rotation');
const weeklyDefinitions = server.slice(server.indexOf('async function weeklyChallengeDefinitions'), server.indexOf('async function randomMarketplaceChallengeCase'));
assert.ok(weeklyDefinitions.indexOf('getWeeklyChallengeRotation(periodKey)') < weeklyDefinitions.indexOf("period: 'weekly'"), 'the server should load this week\'s saved rotation before consulting editable templates');
assert.ok(weeklyDefinitions.includes('saveWeeklyChallengeRotation(periodKey, challenges)'), 'the first weekly selection should be persisted before it is cached');
assert.match(server, /async function buildWeeklyChallengeProgress[\s\S]*?getDailyChallengeCounters[\s\S]*?getDailyChallengeClaims[\s\S]*?claimChallengeReward/, 'weekly progress and rewards should use persisted atomic challenge storage');
assert.match(server, /async function randomMarketplaceChallengeCase[\s\S]*?getCustomCaseDefinitions\(\{ force: true \}\)[\s\S]*?caseAvailability\(caseDef\)\.available/, 'the weekly hard reward should choose only a currently available marketplace case');
assert.match(db, /async function claimDailyChallenge[\s\S]*?caseRewardId[\s\S]*?INSERT INTO case_inventory[\s\S]*?COMMIT/, 'weekly hard XP and case rewards should commit atomically');
assert.match(db, /previousXp = Math\.max\(0, xp - Math\.max\(0, Number\(xpAwarded\)/, 'atomic challenge claims should return their exact pre-award XP for level rewards');
assert.match(server, /const beforeLevel = progressionForXpLocal\(result\.previousXp \|\| 0\)\.level/, 'level-up currency should use the atomic claim result instead of a stale XP read');
assert.match(server, /recordWeaponKill\(client\.accountId, weeklyChallengePeriodKey\(\), resolvedWeapon\)/, 'validated weapon kills should count toward weekly challenges');
assert.match(server, /const counters = \{[\s\S]*?kills:[\s\S]*?wins:[\s\S]*?incrementDailyChallengeCounters\(client\.accountId, dailyChallengePeriodKey\(\), counters\)[\s\S]*?incrementDailyChallengeCounters\(client\.accountId, weeklyChallengePeriodKey\(\), counters\)/, 'validated kills and wins should count toward both challenge periods');

for (const id of ['daily-challenges-view', 'weekly-challenges-view', 'weekly-challenges-list']) {
  assert.ok(html.includes(`id="${id}"`), `challenge hub should include ${id}`);
}
assert.match(html, /function setChallengePeriod[\s\S]*?activeChallengePeriod[\s\S]*?aria-selected/, 'challenge period tabs should switch accessibly');
const countdownFunction = html.match(/function updateDailyChallengeCountdown[\s\S]*?\n        \}/)?.[0] || '';
assert.match(countdownFunction, /daysUntilMonday/, 'weekly countdown should target Monday midnight');
assert.match(countdownFunction, /todayMiddayUtc[\s\S]*?nextMidnightUtc/, 'daily countdown should target the next midday or midnight boundary');
assert.match(countdownFunction, /New week in/, 'weekly countdown should use clear period wording');
assert.doesNotMatch(countdownFunction, /AEST/, 'the visible challenge timer should not show a timezone abbreviation');
assert.ok(html.includes('id="pause-weekly-challenges"'), 'the in-game pause menu should show weekly challenge progress');
assert.match(html, /function challengeProgressParts[\s\S]*?rawTotal - rawMatch[\s\S]*?const match = Math\.min\(target - saved[\s\S]*?totalPct:[\s\S]*?savedPct:/, 'main-menu and pause challenge views should share one progress calculation with the match segment starting at the saved endpoint');
assert.match(html, /function pauseChallengeProgressLabel[\s\S]*?parts\.match > 0[\s\S]*?Challenge complete · /, 'completed challenges should keep showing the progress earned in the current match');
assert.match(html, /renderDailyChallenges[\s\S]*?challengeProgressParts\(challenge\)[\s\S]*?renderPauseDailyChallenges[\s\S]*?challengeProgressParts\(challenge\)[\s\S]*?renderWeeklyChallenges[\s\S]*?challengeProgressParts\(challenge\)/, 'daily and weekly challenge totals should be identical in the hub and pause menu');
assert.match(html, /Random Marketplace Case/, 'the weekly hard challenge should explain its case reward');
assert.match(html, /type === 'weeklyChallengeProgress'[\s\S]*?applyWeeklyChallengeProgress\(data\)/, 'client should consume authoritative weekly progress packets');

console.log('weekly-progression: twice-daily rotation, weekly editor/reward persistence, tracking, and challenge UI verified.');
