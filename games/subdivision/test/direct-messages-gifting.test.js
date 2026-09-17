// Last updated: 17 September 2026
// Covers the two player-to-player features added together: direct messages, and
// buying a marketplace listing as a gift for a friend.
//
// Both share one rule that the whole file exists to hold: the friends list is
// the authorisation boundary, and it is checked where it cannot be raced, not
// only where it is convenient. A DM and a gift are the only two ways one
// account can put something into another account without that account acting,
// so a check done before the transaction begins is not good enough.
const fs = require('fs');
const assert = require('assert');
const test = require('node:test');

const db = fs.readFileSync('db.js', 'utf8');

// Slice one top-level async function out of db.js by name. Written this way
// rather than as indexOf(next function by name) because these functions do not
// appear in the file in the order you would guess.
function dbFn(name) {
  const start = db.indexOf('async function ' + name + '(');
  assert.ok(start >= 0, 'db.js should define ' + name);
  const next = db.indexOf('\nasync function ', start + 10);
  return db.slice(start, next < 0 ? db.length : next);
}
const server = fs.readFileSync('server.js', 'utf8');
const client = fs.readFileSync('index.html', 'utf8');
const antiflood = fs.readFileSync('antiflood.js', 'utf8');

// --- Storage -----------------------------------------------------------------

test('direct messages have a table, and it is indexed for the two reads it serves', () => {
  assert.match(db, /CREATE TABLE IF NOT EXISTS direct_messages \([\s\S]*?sender_id\s+BIGINT NOT NULL REFERENCES accounts\(id\) ON DELETE CASCADE[\s\S]*?recipient_id\s+BIGINT NOT NULL REFERENCES accounts\(id\) ON DELETE CASCADE[\s\S]*?read_at\s+TIMESTAMPTZ[\s\S]*?CHECK \(sender_id <> recipient_id\)/);
  // The inbox summary and one open conversation are the only two query shapes.
  assert.match(db, /idx_direct_messages_inbox\s*\n?\s*ON direct_messages \(recipient_id, created_at DESC\)/);
  assert.match(db, /idx_direct_messages_thread\s*\n?\s*ON direct_messages \(sender_id, recipient_id, created_at DESC\)/);
  // Partial index: the unread badge is read far more often than it changes.
  assert.match(db, /idx_direct_messages_unread[\s\S]{0,120}WHERE read_at IS NULL/);
});

test('a gifted purchase records who actually received it', () => {
  // buyer_id stays whoever paid. Without this column a gift is indistinguishable
  // from the item vanishing, which is the support question it exists to answer.
  assert.match(db, /ALTER TABLE skin_market_listings ADD COLUMN IF NOT EXISTS gift_recipient_id BIGINT REFERENCES accounts\(id\) ON DELETE SET NULL/);
  assert.match(db, /ALTER TABLE case_market_listings ADD COLUMN IF NOT EXISTS gift_recipient_id BIGINT REFERENCES accounts\(id\) ON DELETE SET NULL/);
});

// --- Gifting -----------------------------------------------------------------

test('the gift recipient is resolved inside the purchase transaction', () => {
  // This is the whole safety argument. resolveGiftRecipient takes the caller's
  // transaction client, so the friendship it reads is the one that holds for the
  // transfer. A helper that opened its own connection would be checking a
  // friendship that can be removed before the item moves.
  assert.match(db, /async function resolveGiftRecipient\(client, \{ buyerId, sellerId, giftToId \}\)/);
  assert.match(db, /async function resolveGiftRecipient[\s\S]*?await client\.query\(\s*`SELECT 1 FROM friendships[\s\S]*?status = 'accepted'[\s\S]*?if \(!rows\.length\) throw new Error\('gift_recipient_not_friend'\)/);
});

test('gifting refuses the shapes that are not gifts', () => {
  const body = dbFn('resolveGiftRecipient');
  // A recipient id is only ever digits. Anything else is refused before it can
  // reach a query at all.
  assert.match(body, /if \(!\/\^\\d\+\$\/\.test\(recipient\)\) throw new Error\('gift_recipient_invalid'\)/);
  // Gifting to yourself is just buying; failing the sale over it would be rude.
  assert.match(body, /if \(recipient === String\(buyerId\)\) return null;/);
  // Buying the seller's own item back to the seller moves coins and nothing else.
  assert.match(body, /if \(recipient === String\(sellerId\)\) throw new Error\('gift_recipient_is_seller'\)/);
  assert.match(body, /status = 'active'[\s\S]*?throw new Error\('gift_recipient_unavailable'\)/);
});

test('coins leave the buyer while the item goes to the receiver', () => {
  const buy = dbFn('buyMarketListing');
  assert.match(buy, /const giftTo = await resolveGiftRecipient\(client, \{ buyerId, sellerId: row\.seller_id, giftToId \}\);\s*\n\s*const receiverId = giftTo \|\| buyerId;/);
  // The balance check and the debit still name the buyer...
  assert.match(buy, /SELECT mowbucks FROM stats WHERE account_id = \$1 FOR UPDATE`, \[buyerId\]/);
  assert.match(buy, /UPDATE stats SET mowbucks = mowbucks - \$2[\s\S]{0,60}\[buyerId, price\]/);
  // ...and only the item transfer names the receiver.
  assert.match(buy, /UPDATE skin_inventory SET account_id = \$1 WHERE id = \$2`, \[receiverId, row\.inventory_id\]/);
  // The transfer is still inside the same transaction it always was.
  assert.match(buy, /BEGIN[\s\S]*?receiverId[\s\S]*?COMMIT[\s\S]*?ROLLBACK/);
});

test('case listings gift the same way', () => {
  const buy = dbFn('buyCaseMarketListing');
  assert.match(buy, /const receiverId = giftTo \|\| buyerId;/);
  assert.match(buy, /INSERT INTO case_inventory[\s\S]{0,220}\[receiverId, row\.case_id\]/);
  assert.match(buy, /UPDATE case_market_listings SET status = 'sold', gift_recipient_id = \$2/);
});

test('the socket layer normalizes the recipient but does not authorize it', () => {
  // Deliberate division: the packet's shape is checked here, the friendship is
  // checked in the transaction. Duplicating the friendship check here would
  // invite someone to later delete the one that actually holds.
  assert.match(server, /function normalizeGiftRecipientId\(data = \{\}\)[\s\S]*?return \/\^\\d\+\$\/\.test\(id\) \? id : null;/);
  assert.doesNotMatch(server, /function normalizeGiftRecipientId[\s\S]{0,400}areFriends/);
  assert.match(server, /db\.buyMarketListing\(\{ buyerId: client\.accountId, listingId, giftToId \}\)/);
  assert.match(server, /db\.buyCaseMarketListing\(\{ buyerId: client\.accountId, listingId, giftToId \}\)/);
});

test('every gift refusal reaches the buyer as words', () => {
  for (const code of ['gift_recipient_not_friend', 'gift_recipient_is_seller', 'gift_recipient_unavailable', 'gift_recipient_invalid']) {
    assert.match(server, new RegExp(`case '${code}': return '[^']+';`), `${code} needs a player-facing message`);
  }
  assert.match(server, /giftErrorMessage\(error\) \|\| 'Could not buy that listing\.'/);
  assert.match(server, /giftErrorMessage\(error\) \|\| 'Could not buy that case listing\.'/);
});

test('the recipient is told, because their inventory changed without them acting', () => {
  assert.match(server, /function notifyGiftRecipient\(listing, buyerClient, message\)[\s\S]*?const recipientId = listing\?\.gift_recipient_id;[\s\S]*?send\(recipient, 'giftReceived'[\s\S]*?sendSkinInventory\(recipient\)/);
  assert.match(client, /type === 'giftReceived'[\s\S]*?showGiftBanner\([\s\S]*?sendPacket\('getSkinInventory'/);
});

// --- Direct messages ---------------------------------------------------------

test('every direct-message query re-checks the friendship', () => {
  assert.match(db, /async function sendDirectMessage[\s\S]*?if \(!await areFriends\(senderId, recipientId\)\) throw new Error\('not_friends'\)/);
  assert.match(db, /async function getDirectMessageThread\(accountId, otherId[\s\S]*?if \(!await areFriends\(accountId, otherId\)\) throw new Error\('not_friends'\)/);
  // The inbox filters in SQL rather than in JS, so an unfriended thread stops
  // being listed without the history being deleted.
  assert.match(db, /async function getDirectMessageThreads[\s\S]*?EXISTS \(\s*\n?\s*SELECT 1 FROM friendships f[\s\S]*?f\.status = 'accepted'/);
});

test('message bodies are bounded at both layers', () => {
  assert.match(db, /const DIRECT_MESSAGE_MAX_LENGTH = 400;/);
  assert.match(db, /async function sendDirectMessage[\s\S]*?\.trim\(\)\.slice\(0, DIRECT_MESSAGE_MAX_LENGTH\)[\s\S]*?if \(!text\) throw new Error\('empty_message'\)/);
  // A DM must not be able to carry anything room chat cannot, so it goes through
  // the same sanitizer rather than a second one that can drift from it.
  assert.match(server, /function handleSendDirectMessage[\s\S]*?const body = sanitizeChatMessage\(data\.message\);/);
  assert.match(client, /<input id="dm-input" maxlength="140"/);
});

test('opening a conversation is what marks it read', () => {
  assert.match(server, /function handleOpenDirectMessages[\s\S]*?db\.getDirectMessageThread\(client\.accountId, accountId\)[\s\S]*?await db\.markDirectMessagesRead\(client\.accountId, accountId\)[\s\S]*?sendDirectMessageThreads\(client\)/);
  assert.match(db, /async function markDirectMessagesRead[\s\S]*?WHERE recipient_id = \$1 AND sender_id = \$2 AND read_at IS NULL/);
});

test('messages are account-only, and the packets are rate limited', () => {
  assert.match(server, /function directMessageActionAllowed\(client\)[\s\S]*?if \(client\.accountId && db\.isEnabled\(\)\) return true;[\s\S]*?'directMessageNotice'[\s\S]*?return false;/);
  for (const handler of ['handleOpenDirectMessages', 'handleSendDirectMessage']) {
    assert.match(server, new RegExp(`function ${handler}\\(client, data = \\{\\}\\) \\{\\s*\\n\\s*if \\(!directMessageActionAllowed\\(client\\)\\) return;`), `${handler} must gate on an account`);
  }
  // Slower than room chat on purpose: a DM persists in one person's inbox.
  assert.match(antiflood, /sendDirectMessage: \{ ratePerSec: 1, burst: 4 \}/);
  assert.match(antiflood, /openDirectMessages: \{ ratePerSec: 1, burst: 4 \}/);
  assert.match(antiflood, /getDirectMessageThreads: \{ ratePerSec: 1, burst: 3 \}/);
});

test('the three message packets are routed', () => {
  for (const type of ['getDirectMessageThreads', 'openDirectMessages', 'sendDirectMessage']) {
    assert.match(server, new RegExp(`if \\(type === '${type}'\\) \\{`), `${type} must be routed`);
  }
  // Routed beside the friend packets, i.e. before the room gate - messaging is a
  // lobby feature and must work when the player is not in a room.
  const dmIndex = server.indexOf(`if (type === 'getDirectMessageThreads')`);
  const chatIndex = server.indexOf(`if (type === 'chatMessage')`);
  assert.ok(dmIndex > 0 && dmIndex < chatIndex, 'DM packets must be handled before the in-room gate');
});

test('the unread badge is correct before the lobby asks for it', () => {
  assert.match(server, /sendFriendsData\(client\);[\s\S]{0,220}sendDirectMessageThreads\(client\);[\s\S]{0,80}sendPartyData\(client\);/);
});

// --- Client ------------------------------------------------------------------

test('a late reply cannot overwrite the conversation on screen', () => {
  assert.match(client, /function renderDirectMessageThread\(data = \{\}\)[\s\S]*?if \(String\(data\.accountId \|\| ''\) !== String\(dmState\.openThread\)\) return;/);
  assert.match(client, /function receiveDirectMessage\(data = \{\}\)[\s\S]*?if \(String\(data\.accountId \|\| ''\) === String\(dmState\.openThread\)\)/);
});

test('everything a player typed is escaped on the way back out', () => {
  const render = client.slice(client.indexOf('function renderDirectMessageThreads'), client.indexOf('function setDirectMessageComposerEnabled'));
  for (const field of ['thread.username', 'thread.preview', 'message.body']) {
    assert.ok(render.includes(`escapeHtml(${field}`), `${field} must be escaped`);
  }
});

test('gifting is offered as a friend picker, never as a name field', () => {
  // Typing a username to send an irreversible paid transfer is the failure mode
  // this avoids: there is no undo, and usernames collide by design.
  assert.match(client, /id="market-gift-friends"/);
  assert.doesNotMatch(client, /id="market-gift-dialog"[\s\S]{0,900}<input/);
  assert.match(client, /function openMarketGiftDialog\(kind, listingId, summary\)[\s\S]*?const friends = \(friendsData\.friends \|\| \[\]\);/);
  // Auctions are excluded: a bid is paid long before the auction resolves, so
  // there is no single moment at which a recipient could be chosen.
  const action = client.slice(client.indexOf('const action = auction'), client.indexOf('const adminAction ='));
  const [auctionBranch, fixedBranch] = action.split(/\n\s*: /);
  assert.ok(/data-market-bid=/.test(auctionBranch), 'sanity: the auction branch is the one with the bid button');
  assert.ok(!/data-market-gift=/.test(auctionBranch), 'auctions must not offer a gift button');
  assert.ok(/data-market-gift=/.test(fixedBranch), 'fixed-price listings must offer a gift button');
  // Never on your own listing: you already own it.
  assert.match(fixedBranch, /\$\{own \? '' : `<button type="button" data-market-gift=/);
});

test('a gift cannot be sent twice from one dialog', () => {
  assert.match(client, /function confirmMarketGift\(accountId, username\)[\s\S]*?if \(!marketGiftDraft\) return;[\s\S]*?closeMarketGiftDialog\(\);/);
  assert.match(client, /function closeMarketGiftDialog\(\)[\s\S]*?marketGiftDraft = null;/);
});

test('cases and skins send their own packet', () => {
  assert.match(client, /const packet = kind === 'case' \? 'marketBuyCaseListing' : 'marketBuyListing';/);
  assert.match(client, /openMarketGiftDialog\('case', caseGift\.dataset\.marketCaseGift/);
  assert.match(client, /openMarketGiftDialog\('skin', listing\.id/);
});
