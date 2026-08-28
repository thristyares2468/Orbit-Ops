'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

test('the browser consumes the complete Containment runtime stream', () => {
  assert.equal((html.match(/<option value="containment">Zombies<\/option>/gu) || []).length, 4,
    'all host and admin mode selectors should call the mode Zombies');
  assert.match(html, /if \(mode === 'containment'\) return 'Zombies';/u,
    'room summaries should use the Zombies name');
  for (const type of ['containmentState', 'containmentSpawn', 'containmentEnemies', 'containmentEnemyHit',
    'containmentPlayerHit', 'containmentDown', 'containmentGateOpened']) {
    assert.ok(html.includes(`type === '${type}'`), `${type} should have a client handler`);
  }
});

test('server-owned enemies are rendered, interpolated, and shootable', () => {
  assert.match(html, /const containmentEnemyActors = new Map\(\)/u);
  assert.match(html, /function spawnContainmentEnemy\(row\)/u);
  assert.match(html, /function updateContainmentEnemies\(delta, time\)/u);
  assert.match(html, /sendPacket\('containmentHit', \{[\s\S]*?enemyId: pGroup\.userData\.containmentEnemyId/u);
  assert.match(html, /group\.userData\?\.isRemotePlayer \|\| group\.userData\?\.isContainmentEnemy/u);
  assert.match(html, /assets\/characters\/zombies\/nuketown-zombies\.glb/u,
    'Containment loads the supplied four-variant Nuketown zombie GLB');
  assert.match(html, /function attachContainmentZombieModel\(actor, id\)/u);
  assert.match(html, /function buildContainmentZombieRig\(model\)/u, 'the imported skeletons receive runtime animation rigs');
  assert.match(html, /function updateContainmentZombieRig\(actor, time, blend/u, 'idle, locomotion, attack and hit poses update each frame');
  assert.match(html, /function animateContainmentZombieDeath\(actor\)/u, 'kills play a rigged fall before removing the actor');
  assert.match(html, /if \(data\.enemyId\) triggerContainmentZombieAttack\(data\.enemyId\)/u,
    'server-confirmed damage triggers the correct zombie bite animation');
  assert.match(html, /THREE\.SkeletonUtils\?\.clone/u, 'rigged variants are cloned without sharing skeleton state');
  assert.match(html, /const localBounds = \(object\) =>/u, 'the imported armature is normalized in actor-local space');
  assert.match(html, /const hitboxBounds = \(\) =>/u, 'the imported visual measures the actual actor target geometry');
  assert.match(html, /const targetBounds = hitboxBounds\(\)/u, 'the visual height follows the authoritative hitbox height');
  assert.match(html, /actor\.scale\.setScalar\(1\)/u, 'network origin and zombie targets are not separated by actor scaling');
  assert.match(html, /joints\.hitHead\.geometry = new THREE\.BoxGeometry/u, 'zombies replace player targets with fitted head/body/leg volumes');
  assert.match(html, /actor\.userData\.zombieVisualBaseY = wrapper\.position\.y/u,
    'the imported model stores its grounded visual origin');
  assert.match(html, /targetBounds\.min\.y - bounds\.min\.y - floorSink/u,
    'every imported variant is sunk onto the authoritative leg hitbox');
  assert.doesNotMatch(html, /zombieVisualBaseY \|\| 0\)\s*\+\s*Math\.abs/u,
    'walking never lifts the whole zombie model above its hitbox');
  assert.match(html, /using procedural fallback/u, 'a failed asset request cannot prevent enemies spawning');
});

test('joining another room clears a stale Zombies death camera', () => {
  const joined = html.match(/type === 'roomJoined'[\s\S]*?currentRoomCode = data\.roomCode/u)?.[0] || '';
  assert.match(joined, /clearTimeout\(localDeathRespawnTimer\)/u);
  assert.match(joined, /isDead = false/u);
  assert.match(joined, /localWaitingForNextRound = false/u);
  assert.match(joined, /deathOverlay\.style\.display = 'none'/u);
});

test('Containment uses the loadout menu but its own non-persistent credits', () => {
  assert.match(html, /const VALID_GAMEMODES = new Set\(\['gunGame', 'deathmatch', 'tdm', 'containment'\]\)/u);
  assert.match(html, /return isDeathmatch\(\) \|\| isTDM\(\) \|\| isContainment\(\)/u);
  assert.match(html, /sendPacket\(isContainment\(\) \? 'containmentBuyWeapon' : 'buyWeapon'/u);
  assert.match(html, /containmentCredits = Math\.max\(0, Number\(state\.credits\) \|\| 0\)/u);
  assert.match(html, /isContainment\(\) && !force && \(!weapon \|\| !containmentOwnedWeapons\.has\(weapon\.name\)\)/u,
    'an unowned weapon cannot be equipped locally while the server still validates the previous gun');
  assert.match(html, /Buy a primary/u, 'the weapon HUD tells the player why the primary slot is unavailable');
  assert.match(html, /!containmentOwnedWeapons\.has\(selectedMainName\) \? 'No primary'/u,
    'the shop summary does not claim the default primary is owned');
});

test('gates are solid map objects and use the normal interact binding', () => {
  assert.match(html, /function spawnContainmentGate\(gate\)/u);
  assert.match(html, /barrier\.userData = \{ isMapObject: true, containmentGateId: id \}/u);
  assert.match(html, /sendPacket\('containmentOpenGate', \{ gateId: nearest\.id \}\)/u);
  assert.match(html, /!interactWithNearestContainmentGate\(\) && !interactWithNearestDoor\(\)/u);
  assert.match(html, /new THREE\.BoxGeometry\(width, height, depth\)/u,
    'the displayed collider uses the complete authored wall-to-wall gate dimensions');
});

test('the admin room exposes a synchronized zombie-spawn pause control', () => {
  assert.match(html, /id="btn-admin-zombie-spawns"/u);
  assert.match(html, /sendAdminConfig\(\{ zombieSpawnsPaused: !adminZombieSpawnsPaused\(\) \}\)/u);
  assert.match(html, /function adminZombieSpawnsPaused\(\)/u);
  assert.match(html, /Zombie Spawns: \$\{paused \? 'Paused' : 'Active'\}/u);
});

test('the coordinate capture binding copies floor coordinates for gate authoring', () => {
  const capture = html.match(/function captureLookCoords\(\) \{[\s\S]*?\n        \}/u)?.[0] || '';
  assert.match(capture, /const pasteReady = formatVec\(hit\.point\)/u);
  assert.match(capture, /Ground point copied\/logged/u);
  assert.doesNotMatch(capture, /navigator\.clipboard\.writeText\(formatVec\(spawn\)\)/u,
    'the clipboard must not receive the player-eye position for gate yHint values');
  assert.match(capture, /navigator\.clipboard\.writeText\(pasteReady\)/u);
});

test('preparation voting has a visible one-vote client control', () => {
  assert.match(html, /id="ct-skip-prep"/u);
  assert.match(html, /sendPacket\('containmentSkipPreparation', \{\}\)/u);
  assert.match(html, /event\.code === 'KeyV'/u);
  assert.match(html, /updateContainmentPreparationVote\(state\.preparationVote, state\.phase\)/u);
  assert.match(html, /button\.disabled = !!containmentPreparationVote\.voted/u);
});

test('Containment has a distinct sunset sky and restores normal map lighting outside the mode', () => {
  assert.match(html, /function createContainmentSunsetSkyTexture\(\)/u);
  assert.match(html, /texture\.mapping = THREE\.EquirectangularReflectionMapping/u);
  assert.match(html, /scene\.background = createContainmentSunsetSkyTexture\(\) \|\| new THREE\.Color\(0x4c2933\)/u);
  assert.match(html, /scene\.fog = new THREE\.Fog\(0x5a3038/u);
  assert.match(html, /mainShadowLight\.color\.setHex\(0xffa067\)/u);
  assert.match(html, /mainShadowLight\.color\.setHex\(0xffffff\)/u, 'other modes restore their original daylight key light');
  assert.match(html, /applySceneEnvironmentForMap\(getCurrentMapDef\(\)\)/u,
    'changing mode without reloading the map still changes the atmosphere');
});
