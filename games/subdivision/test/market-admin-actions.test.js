// Admin marketplace powers: force-cancel any listing, and reprice any listing.
//
// Taking a listing without paying used to be here too and has been removed; the
// checks below also hold that door shut, because a free path is the kind of
// thing that comes back as a default argument nobody notices.
//
// Both surviving powers reach into other players' property, so these checks are
// less about "does it work" than about the ways it could go wrong quietly: an
// ordinary player getting the power by asking for it, a bidder's escrowed coins
// disappearing when their auction is pulled, and a repriced auction stranding a
// bid that was taken at the old figure.
const fs = require('fs');
const assert = require('assert');

const db = fs.readFileSync('db.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');
const client = fs.readFileSync('index.html', 'utf8');

// The body of a top-level async function. Counting has to start at the body
// brace: `function f({ a, b }) {` closes its first brace before the body opens.
function body(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  let depth = 0;
  for (let i = source.indexOf(') {', start) + 2; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

// --- the power is never granted by the packet -------------------------------

assert.ok(
  /data\.asAdmin === true && isAdminUser\(client\)/.test(server),
  'a forced cancel must confirm the role from the socket, not trust data.asAdmin'
);
assert.ok(
  /function handleMarketAdminSetPrice\(client, data = \{\}\) \{\s*\n\s*if \(!isAdminUser\(client\)\) return;/.test(server),
  'repricing must confirm the role from the socket before anything else'
);

// --- force cancel -----------------------------------------------------------

const cancel = body(db, 'cancelMarketListing');
assert.ok(/asAdmin = false/.test(cancel), 'asAdmin defaults to off');
assert.ok(
  /asAdmin\s*\n?\s*\?\s*`SELECT \* FROM skin_market_listings WHERE id = \$1 AND status = 'active' FOR UPDATE`/.test(cancel),
  'the admin lookup drops the seller_id constraint'
);
assert.ok(
  /AND seller_id = \$2 AND status = 'active'/.test(cancel),
  'the ordinary lookup still restricts to the seller'
);
assert.ok(
  /if \(hasBids && !asAdmin\) throw new Error\('auction_has_bids'\)/.test(cancel),
  'a seller still cannot cancel their own auction once it has bids'
);

// Bidding deducts immediately, so cancelling an auction with bids has to hand
// the money back - and inside the same transaction, or a failure eats it.
assert.ok(/if \(hasBids && listing\.highest_bidder_id\)/.test(cancel), 'the top bidder is refunded');
const refundAt = cancel.indexOf('mowbucks = stats.mowbucks + EXCLUDED.mowbucks');
const commitAt = cancel.indexOf("client.query('COMMIT')");
assert.ok(refundAt !== -1 && refundAt < commitAt, 'the refund is committed with the cancel, not after it');

// --- a free purchase is no longer possible ---------------------------------

const buy = body(db, 'buyMarketListing');
// Taking a listing without paying was removed outright rather than left behind a
// flag. Every player is charged, and no caller can opt out.
assert.ok(!/free/.test(buy), 'buyMarketListing has no free path left');
assert.ok(/if \(balance < price\) throw new Error\('not_enough_coins'\)/.test(buy), 'the balance check applies to everyone');
assert.ok(
  /if \(String\(row\.seller_id\) === String\(buyerId\)\) throw new Error\('own_listing'\)/.test(buy),
  'nobody buys their own listing'
);
assert.ok(!/free/.test(server) || !/marketBuyListing[\s\S]{0,300}?free/.test(server), 'the server sends no free flag');
assert.ok(!/data-market-admin-free|Take Free/.test(client), 'the Take Free control is gone from the card');

// --- repricing someone else's listing ---------------------------------------

const reprice = body(db, 'setMarketListingPrice');
assert.ok(
  /SELECT \* FROM skin_market_listings WHERE id = \$1 AND status = 'active' FOR UPDATE/.test(reprice),
  'any active listing can be found, not only the caller\'s own'
);
// Bidding deducts the bid at once and the listing price IS that held amount, so
// moving it would strand a bidder's money or overpay the seller.
assert.ok(
  /if \(listing\.listing_type === 'auction' && Number\(listing\.bid_count \|\| 0\) > 0\) \{\s*\n\s*throw new Error\('auction_has_bids'\);/.test(reprice),
  'an auction that has taken a bid cannot be repriced'
);
assert.ok(
  /Math\.max\(0, Math\.min\(1000000000, Math\.floor\(Number\(price\) \|\| 0\)\)\)/.test(reprice),
  'the new price is clamped and integral'
);
assert.ok(/previous_price/.test(reprice), 'the old figure comes back so the change can be reported');

// --- both are recorded ------------------------------------------------------

assert.ok(/\[admin-market\][\s\S]*?force-cancelled listing/.test(server), 'a forced cancel is logged');
assert.ok(/\[admin-market\][\s\S]*?repriced listing/.test(server), 'a reprice is logged');

// --- the buttons ------------------------------------------------------------

assert.ok(
  /const adminAction = !accountIsAdmin \? '' :/.test(client),
  'the admin buttons are only rendered for an admin account'
);
assert.ok(
  /data-market-admin-cancel=/.test(client) && /data-market-admin-price=/.test(client),
  'both admin actions have a control'
);
// Force Cancel is offered on every listing, with no condition in front of it.
// It used to be suppressed on your own listing when that listing had no bids,
// which made the red control appear and disappear down a page for a reason that
// was invisible from the outside.
const adminButtons = /const adminAction = !accountIsAdmin \? '' : \[([\s\S]*?)\]\.join\('''?\);/.exec(client)
  || /const adminAction = !accountIsAdmin \? '' : \[([\s\S]*?)\]\.join/.exec(client);
assert.ok(adminButtons, 'the admin button list is where it was');
const cancelEntry = adminButtons[1]
  .split('\n')
  .find((line) => line.includes('data-market-admin-cancel'));
assert.ok(cancelEntry, 'Force Cancel is in the list');
assert.ok(
  !/\?/.test(cancelEntry.slice(0, cancelEntry.indexOf('data-market-admin-cancel'))),
  'Force Cancel must not sit behind a conditional'
);
// Both act on the first click. An admin clearing a list works through many in a
// row, and a modal on every one trains you to dismiss without reading, which is
// worse than no modal at all. The safety net is the server: the role is checked
// there, every use is logged, and a pulled auction refunds its bidder.
for (const action of ['marketAdminCancel']) {
  const handler = new RegExp(`dataset\\.${action}[\\s\\S]{0,400}?marketplace-status`);
  const match = handler.exec(client);
  assert.ok(match, `${action} should send and then report in the status line`);
  assert.ok(!/confirm\(/.test(match[0]), `${action} should not raise a confirm dialog`);
}
// Whatever happened is reported after the fact instead.
assert.ok(/Force-cancelling listing\.\.\./.test(client), 'a forced cancel reports itself');

// Repricing needs a number typed, so it opens the in-page dialog. A native
// prompt() would be silenced by the same "don't show again" checkbox that once
// killed these buttons - and a silenced prompt returns null, so the control
// would look alive and do nothing.
assert.ok(/openMarketPriceDialog\(listing\)/.test(client), 'the price control opens the in-page dialog');
assert.ok(/id="market-price-dialog"/.test(client) && /id="market-price-amount"/.test(client), 'the dialog exists');
const priceDialog = /function openMarketPriceDialog\([\s\S]*?\n        \}/.exec(client);
assert.ok(priceDialog && !/prompt\(/.test(priceDialog[0]), 'no native prompt anywhere in the price flow');
assert.ok(/sendPacket\('marketAdminSetPrice', \{ listingId, price \}\)/.test(client), 'the dialog sends the packet');
assert.ok(
  /An administrator changed your listing price to/.test(server),
  'the seller is told their price changed'
);
assert.ok(
  /An administrator removed your listing\./.test(server),
  'the seller is told their listing was pulled'
);
assert.ok(
  /Auction cancelled by an administrator\. \$\{listing\.refunded\.amount\} refunded\./.test(server),
  'a refunded bidder is told the amount'
);

console.log('market-admin-actions: all assertions passed');
