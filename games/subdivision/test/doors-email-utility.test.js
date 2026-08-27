// Last updated: 19 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const maps = require('../maps');
const { loadMapCollision } = require('../mapCollision');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const mailer = fs.readFileSync(path.join(ROOT, 'mailer.js'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8');

assert.strictEqual(maps.NUKE_DOORS.length, 4, 'all four authored Nuke double doors should be described');
assert.match(html, /interact: 'KeyE'/, 'interact should default to E');
assert.match(html, /\['interact', 'Interact \/ Open Door'\]/, 'interact should be configurable in settings');
assert.match(html, /function installNukeInteractiveDoorFaces[\s\S]*?interactiveDoorLeaf/, 'the real Nuke door brush faces should become moving leaves');
assert.match(html, /function interactWithNearestDoor[\s\S]*?sendPacket\('doorToggle'/, 'nearby doors should use the synchronized interaction packet');
assert.match(html, /Press \$\{bindLabel\('interact'\)\} to open door/, 'first-time door users should see their configured key');
assert.match(server, /function handleDoorToggle[\s\S]*?distanceBetweenVectors\(player\.position, center\) > 52[\s\S]*?'doorState'/, 'server should range-check and synchronize door toggles');
assert.match(server, /ignoredDoors: room\.openDoors/, 'open doors should stop blocking server LOS');

assert.ok(mailer.includes("responses.push(responseLines.join('\\r\\n'))"), 'SMTP reader should queue complete multiline responses');
assert.match(mailer, /process\.env\.NODE_ENV === 'production'[\s\S]*?Email provider is not configured/, 'production must not claim that an unsent email succeeded');
assert.match(mailer, /BREVO_API_KEY[\s\S]*?https:\/\/api\.brevo\.com\/v3\/smtp\/email/, 'account mail should support Brevo over Railway-safe HTTPS');
assert.match(mailer, /RESEND_API_KEY[\s\S]*?https:\/\/api\.resend\.com\/emails/, 'account mail should support the Resend transactional API');
assert.match(mailer, /Idempotency-Key/, 'account mail should prevent duplicate Resend deliveries');
assert.match(server, /mailer\.providerStatus\(\)[\s\S]*?\[mail\]/, 'startup logs should expose provider readiness without secrets');

assert.match(core, /smoke: \{ radius: 38, durationMs: 18000 \}/, 'server and client smoke lifetime should share an authoritative duration');
assert.match(server, /function shotPassesThroughActiveSmoke[\s\S]*?distanceFromSegment/, 'through-smoke kills should be derived from active server smoke volumes');
assert.match(server, /killContext\.victimFlashed \|\| killContext\.throughSmoke\) killContext\.utility = true/, 'flash-assisted and through-smoke kills should count as utility kills');

(async () => {
  const def = maps.MAP_DEFS.nuke;
  const collision = await loadMapCollision(path.join(ROOT, def.collisionPath), def.scale);
  assert.deepStrictEqual([...collision.doorIds].sort(), maps.NUKE_DOORS.map(door => door.id).sort(), 'server collision should identify every authored door');
  console.log('doors-email-utility: SMTP, leave-safe doors, and utility modifier credit verified.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
