const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

assert.match(
  html,
  /let fpsFrameCount = 0, fpsElapsedMs = 0, fpsLastFrameTime = 0, fpsValue = 0/,
  'FPS sampling should track rendered frame durations instead of assuming a refresh rate'
);
assert.match(
  html,
  /function updateFpsCounter\(time\)[\s\S]*?frameDuration = time - fpsLastFrameTime[\s\S]*?fpsFrameCount\+\+[\s\S]*?fpsElapsedMs \+= frameDuration[\s\S]*?fpsFrameCount \* 1000\) \/ fpsElapsedMs/,
  'FPS should be calculated from actual requestAnimationFrame cadence'
);
assert.match(
  html,
  /frameDuration > 0 && frameDuration < 1000/,
  'background-tab pauses should not pollute the active FPS sample'
);
assert.doesNotMatch(
  html,
  /fps-counter[^\n]{0,120}(?:60 fps|60fps)|(?:60 fps|60fps)[^\n]{0,120}fps-counter/i,
  'the FPS counter must not display a hardcoded 60 FPS value'
);

console.log('fps-counter: live rendered-frame sampling verified.');
