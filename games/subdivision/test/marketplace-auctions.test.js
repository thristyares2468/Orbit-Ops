const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('auction marketplace preserves escrow and settlement safeguards', () => {
  const db = read('db.js');
  const server = read('server.js');
  const antiflood = read('antiflood.js');

  for (const marker of ['listing_type', 'ends_at', 'highest_bidder_id', 'bid_count', 'skin_market_bids']) {
    assert.ok(db.includes(marker), `missing auction schema marker: ${marker}`);
  }
  assert.match(db, /async function placeMarketAuctionBid[\s\S]*?FOR UPDATE[\s\S]*?bid_too_low[\s\S]*?skin_market_bids/);
  assert.match(db, /async function cancelMarketListing[\s\S]*?auction_has_bids/);
  assert.match(db, /async function settleMarketAuctionListing[\s\S]*?reason: 'no_bids'[\s\S]*?DELETE FROM skin_loadouts/);
  assert.match(db, /async function buyMarketListing[\s\S]*?auction_requires_bid/);
  assert.match(antiflood, /marketPlaceBid: \{ ratePerSec: 1, burst: 3 \}/);
  assert.match(server, /type === 'marketPlaceBid'[\s\S]*?handleMarketPlaceBid/);
  assert.match(server, /marketAuctionSettlement[\s\S]*?3000/);
});

test('map voting and embedded asset paths remain wired through the client', () => {
  const html = read('index.html');
  const maps = read('maps.js');
  const server = read('server.js');

  assert.match(html, /function embeddedAssetPath[\s\S]*?JIMS_CLIENT_CONFIG[\s\S]*?\/assets\//);
  assert.match(html, /function versionedWeaponAssetPath[\s\S]*?embeddedAssetPath/);
  assert.match(html, /type === 'mapVoteStart'[\s\S]*?showMapVote/);
  assert.match(html, /type === 'mapVoteResult'[\s\S]*?hideMapVote/);
  assert.match(server, /function startRoomMapVote[\s\S]*?mapVoteStart/);
  assert.match(server, /function handleRoomMapVote[\s\S]*?mapVoteUpdate/);
  assert.match(maps, /PUBLIC_MAP_IDS = \['dust2', 'nuke'\]/);
});
