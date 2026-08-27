// Last updated: 15 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Static regression coverage for admin news deletion. These assertions make sure
// delete support stays DB-backed, server-admin-gated, and visible in the UI.
const ROOT = path.resolve(__dirname, '..');
const dbJs = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

assert.match(
  dbJs,
  /async function deleteNewsMessage\(id\) \{[\s\S]*?DELETE FROM news_messages[\s\S]*?RETURNING id[\s\S]*?return rows\.length > 0;/,
  'db should expose a news delete helper that removes by id'
);

assert.match(
  dbJs,
  /getNewsMessages,[\s\S]*?createNewsMessage,[\s\S]*?deleteNewsMessage,/,
  'db exports should include deleteNewsMessage'
);

assert.match(
  serverJs,
  /if \(type === 'deleteNews'\) \{[\s\S]*?if \(!isAdminUser\(client\)\) return;[\s\S]*?handleDeleteNews\(client, data\);/,
  'deleteNews packets must be admin-gated'
);

assert.match(
  serverJs,
  /function handleDeleteNews\(client, data\) \{[\s\S]*?db\.deleteNewsMessage\(id\)[\s\S]*?newsMemory\.splice\(memoryIndex, 1\)[\s\S]*?await broadcastNewsData\(\);/,
  'deleteNews should remove DB and memory-backed news, then broadcast refreshed news'
);

assert.ok(indexHtml.includes('data-news-delete'), 'news entries should render delete controls for admins');
assert.ok(indexHtml.includes("sendPacket('deleteNews'"), 'delete button should send deleteNews packets');
assert.ok(!indexHtml.includes('id="news-title-input" maxlength='), 'news title input should not enforce a client-side length cap');
assert.ok(!indexHtml.includes('id="news-body-input" maxlength='), 'news body input should not enforce a client-side length cap');
assert.ok(!serverJs.includes("String(data.title || '').replace(/\\s+/g, ' ').trim().slice("), 'news titles should not be truncated server-side');
assert.ok(!serverJs.includes("String(data.body || '').replace(/\\s+/g, ' ').trim().slice("), 'news bodies should not be truncated server-side');
assert.ok(indexHtml.includes('contenteditable="true"'), 'news body should use a rich text editor');
assert.ok(indexHtml.includes('data-news-command="bold"'), 'news editor should expose bold formatting');
assert.ok(indexHtml.includes('data-news-command="italic"'), 'news editor should expose italic formatting');
assert.ok(indexHtml.includes("document.execCommand('fontSize'"), 'news editor should expose font size formatting');
assert.ok(indexHtml.includes("event.key !== 'Tab'"), 'news editor should intercept Tab for article spacing');
assert.ok(indexHtml.includes("sendPacket('postNews', { title, body, bodyHtml })"), 'news publishing should send sanitized rich HTML input');
assert.ok(indexHtml.includes('#hub-news-body { display: -webkit-box; -webkit-line-clamp: 2;'), 'hub news preview should clamp instead of expanding the card');
assert.ok(indexHtml.includes('function renderNewsBody(body)'), 'news viewer should normalize rich article HTML');
assert.ok(indexHtml.includes('news-size-large'), 'news viewer should map rich font sizes to stable display classes');
assert.ok(indexHtml.includes('const NEWS_SEEN_STORAGE_KEY'), 'client should remember the latest seen news article');
assert.ok(indexHtml.includes('function maybeOpenNewNews(messages)'), 'client should auto-open unseen news in the lobby');
assert.ok(indexHtml.includes('showNews({ skipRequest: true })'), 'auto-open should show the current news payload without another request loop');
assert.ok(indexHtml.includes('if (options.skipRequest) renderNews(newsData);'), 'auto-opened news should render cached news instead of staying on Loading');
assert.ok(indexHtml.includes('.news-entry { margin: 0 0 14px; padding: 18px 20px;'), 'news viewer entries should be padded readable cards');
assert.ok(indexHtml.includes('rgba(8,16,9,0.82)'), 'news viewer entries should use a darker readable card background');
assert.ok(indexHtml.includes("document.getElementById('news-status').textContent = 'Showing saved news. Reconnecting...';"), 'news viewer should fall back instead of getting stuck on Loading');
assert.ok(serverJs.includes('function sanitizeNewsBody(input)'), 'server should sanitize rich news HTML');
assert.ok(serverJs.includes('.replace(/<script[\\s\\S]*?<\\/script>/gi'), 'server should strip scripts from news HTML');
assert.ok(serverJs.includes('.replace(/\\son\\w+='), 'server should strip inline event handlers from news HTML');
assert.ok(serverJs.includes('`<font size="${size}">`'), 'server should limit font tags to explicit sizes');
assert.match(
  indexHtml,
  /\$\{newsData\.canPost \? `<button class="news-delete-btn"[\s\S]*?Delete<\/button>` : ''\}/,
  'delete controls should only render when the server says the user can post/administer news'
);

console.log('admin-news-delete: admin-gated news deletion verified.');
