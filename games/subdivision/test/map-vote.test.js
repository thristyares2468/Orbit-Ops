'use strict';

// The map vote overlay: where it renders, and giving the mouse back afterwards.
//
// Two bugs, with the same root shape - something declared twice, and the second
// declaration not fully replacing the first.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const client = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

// --- where it renders -------------------------------------------------------

test('the overlay is styled exactly once', () => {
  // It used to be styled twice: an early top-banner design and a later
  // full-screen modal. The later one won for the properties it mentioned, but
  // every property it did NOT mention kept applying from the earlier one - so
  // the modal inherited transform:translateX(-50%) and a fixed width while
  // taking inset:0 from its own rule. Measured, that put it at left:-412px on a
  // 1280px screen: nearly half of it off the side, and unclickable.
  const base = client.match(/#map-vote-overlay \{ position[^}]*\}/gu) || [];
  assert.equal(base.length, 1, 'one base rule, or the cascade merges two designs');
  assert.equal((client.match(/\.map-vote-panel \{/gu) || []).length, 1, 'one panel rule');
});

test('nothing shifts or disables the overlay', () => {
  const rule = client.match(/#map-vote-overlay \{ position[^}]*\}/u)[0];
  assert.doesNotMatch(rule, /transform:/u, 'a transform on a full-bleed overlay moves it off screen');
  assert.doesNotMatch(rule, /pointer-events:\s*none/u, 'the overlay has to be clickable');
  assert.match(rule, /inset:0/u, 'it covers its container');
  assert.match(rule, /align-items:center/u, 'and centres the panel');
});

test('the narrow-screen override only relaxes padding', () => {
  // The old override pinned `top` and forced a width, which is the same class of
  // mistake: fighting inset:0 from a different rule.
  assert.doesNotMatch(client, /#map-vote-overlay \{ top:4px; width:calc\(100vw - 8px\); \}/u);
  assert.match(client, /#map-vote-overlay \{ padding:10px; \}/u);
});

test('the option grid is not declared twice in the same breakpoint', () => {
  assert.equal((client.match(/#map-vote-options \{ grid-template-columns:minmax\(0,1fr\); \}/gu) || []).length, 0);
});

// --- giving the mouse back --------------------------------------------------

test('relocking verifies that it actually worked', () => {
  // controls.lock() is a request, not a guarantee - requestPointerLock is
  // rejected when the document has lost focus or when it comes too soon after an
  // exit, and the wrapper swallows the rejection. Fire-and-forget therefore
  // fails silently and leaves the player unable to look around.
  assert.match(client, /function relockPointer\(attempt = 0\) \{/u);
  const fn = client.match(/function relockPointer\(attempt = 0\) \{[\s\S]*?\n        \}/u)[0];
  assert.match(fn, /controls\?\.lock\(\)/u, 'it asks');
  assert.match(fn, /if \(!gameStarted \|\| controls\?\.isLocked\) return;/u, 'then checks whether it took');
  assert.match(fn, /if \(attempt < 2\) \{ relockPointer\(attempt \+ 1\); return; \}/u, 'and tries again');
  assert.match(fn, /showPauseMenu\(\);/u, 'falling back to a way in rather than a dead screen');
});

test('relocking yields to whatever else has taken the mouse', () => {
  const fn = client.match(/function relockPointer\(attempt = 0\) \{[\s\S]*?\n        \}/u)[0];
  for (const overlay of ['chat-active', 'buyMenu', 'settingsMenu', 'map-vote-overlay']) {
    assert.ok(fn.includes(overlay), `${overlay} should suppress the relock`);
  }
});

test('a dead player still gets the mouse back', () => {
  // A map vote runs between rounds, which is exactly when players are dead.
  // Skipping the relock there left them with no mouse for the whole next round,
  // and nothing retried it when they respawned.
  assert.doesNotMatch(client, /shouldRelock && gameStarted && !isDead/u);
  assert.match(client, /if \(shouldRelock\) setTimeout\(\(\) => relockPointer\(\), 120\);/u);
});

test('the vote still only relocks if it took the lock in the first place', () => {
  // Opening the vote while already unlocked - sitting in a menu, say - must not
  // yank the player into the game when it closes.
  assert.match(client, /relockAfter: wasLocked \|\| !!mapVoteState\?\.relockAfter/u);
  assert.match(client, /const shouldRelock = allowRelock && mapVoteState\.relockAfter;/u);
});

// --- the camera after the vote ---------------------------------------------

test('the MVP camera lock cannot outlive the screen it belongs to', () => {
  // The end-of-round presentation borrows the camera via a global flag, set in
  // one place and cleared in exactly one other with a 6.25s timer as its only
  // guarantee. Any route that tore the presentation down without going through
  // hideMvpScreen stranded it - and the symptom reads as anything but a camera
  // bug, because pointer lock is still held: moving, shooting and swapping
  // weapons all work, and only the camera refuses to turn.
  assert.match(client, /function isMvpPresentationVisible\(\) \{[\s\S]*?screen\.style\.display === 'block';/u);
  assert.match(
    client,
    /if \(mvpCameraInputLocked && !isMvpPresentationVisible\(\)\) mvpCameraInputLocked = false;/u,
    'the flag is tied to what is actually on screen'
  );
});

test('the self-heal runs before the guard it protects', () => {
  // Clearing it after the early return would never take effect.
  const fn = client.match(/const applyLookDelta = \(movementX, movementY, scale = 1\) => \{[\s\S]*?\n            \};/u)[0];
  const heal = fn.indexOf('mvpCameraInputLocked = false;');
  const guard = fn.indexOf('if (!controls.isLocked || isDead || mvpCameraInputLocked) return;');
  assert.ok(heal !== -1 && guard !== -1, 'both lines are present');
  assert.ok(heal < guard, 'the reset has to come first or it can never run');
});

test('the other two look gates are untouched', () => {
  // Fixing the stuck flag must not hand the camera to a dead player or to
  // someone who has not got pointer lock.
  assert.match(client, /if \(!controls\.isLocked \|\| isDead \|\| mvpCameraInputLocked\) return;/u);
});

// --- the round-end presentation ---------------------------------------------

test('the presentation teardown is scheduled before anything that can fail', () => {
  // This sequence owns three pieces of global state - the camera lock, the
  // staged scene, and the callback that ends the round freeze and respawns the
  // player - and all three were released only by the timer on the last line.
  // Anything throwing while staging the actors stranded every one of them at
  // once: frozen match, dead camera, and a map vote arriving to a client that
  // could not act on it.
  const fn = client.match(/function showMvpScreen\(mvp, onDone\) \{[\s\S]*?\n        \}/u)[0];
  const timer = fn.indexOf('mvpScreenTimer = setTimeout');
  const staging = fn.indexOf('startMvpPreview(placements);');
  assert.ok(timer !== -1 && staging !== -1, 'both are present');
  assert.ok(timer < staging, 'the teardown must be armed before staging runs');
  assert.match(fn, /\} catch \(error\) \{/u, 'and staging is wrapped');
  assert.match(fn, /hideMvpScreen\(\{ runCallback: true \}\);/u, 'a failure still continues the round');
});

test('the staged scene has a failsafe, like the round freeze does', () => {
  // mvpStage halts the entire simulation in animate() - no movement, no
  // shooting, no physics. It was released by exactly one call and had no guard.
  assert.match(client, /const MVP_STAGE_MAX_MS = 12000;/u);
  assert.match(client, /mvpStageFailsafe = setTimeout\(\(\) => \{[\s\S]*?hideMvpScreen\(\{ runCallback: true \}\);/u);
  const stop = client.match(/function stopMvpPreview\(\) \{[\s\S]{0,160}/u)[0];
  assert.match(stop, /clearTimeout\(mvpStageFailsafe\);/u, 'and it is cleared on a clean teardown');
});

test('the map vote does not trip the pause menu over itself', () => {
  // The vote drops pointer lock so the cursor can reach the options. The unlock
  // handler cannot tell that from the player pressing Escape, so it opened the
  // pause menu on top of the vote.
  assert.match(client, /if \(wasLocked\) \{ mapVoteReleasingPointer = true; controls\.unlock\(\); mapVoteReleasingPointer = false; \}/u);
  assert.match(client, /if \(gameStarted && !buying && !mapVoteReleasingPointer\) showPauseMenu\(\);/u);
});

test('the map vote is not gated on game mode anywhere', () => {
  // TDM reaches startRoomMapVote on exactly the same path as deathmatch; there
  // is no mode check in showMapVote either. If it ever feels inert in one mode,
  // the cause is downstream of the vote, not the vote being skipped.
  const show = client.match(/function showMapVote\(data = \{\}\) \{[\s\S]*?\n        \}/u)[0];
  assert.doesNotMatch(show, /gamemode/u, 'showMapVote must stay mode-agnostic');
  assert.doesNotMatch(show, /isTDM\(\)|isGunGame\(\)/u);
});

