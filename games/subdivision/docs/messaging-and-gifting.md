# Direct messages and marketplace gifting

Two player-to-player features added together because they share one rule.

## The rule

**The friends list is the authorisation boundary, and it is checked where it
cannot be raced.**

A DM and a gift are the only two ways one account can put something into another
account without that account doing anything. Everything else in the economy is
either self-service (opening a case, listing a skin) or two-sided (a trade, which
the receiver confirms). So both features check the friendship, and both check it
at the layer that actually holds:

| Layer | What it checks | Why not here |
| --- | --- | --- |
| Client | Nothing. It only offers friends as choices. | Presentation; a crafted packet ignores it. |
| Socket handler | Packet shape, account presence, rate limit. | A friendship read here can be stale by the time the write happens. |
| `db.js` | The friendship, inside the same transaction as the transfer. | — |

For gifting this matters concretely: `resolveGiftRecipient` takes the caller's
transaction client rather than opening its own connection, so the friendship it
reads is the one that holds for the `UPDATE skin_inventory`. A check done before
`BEGIN` can be unfriended out from under the transfer.

## Direct messages

- Friend-only, in both directions, on send **and** on read. The inbox filters in
  SQL, so a thread left behind by an unfriend stops being listed without the
  history being destroyed.
- Bodies go through `sanitizeChatMessage` — the same sanitizer as room chat, so a
  DM can never carry anything room chat cannot. `db.js` caps at 400 characters
  independently, because the socket layer is not the only caller.
- Rate limited harder than room chat (1/s, burst 4, vs 2/s burst 5). Room chat is
  read by everyone present and is self-policing; a DM lands in one person's inbox
  and persists, so the abuse shape is a spam burst rather than a noisy round.
- `read_at` lives on the row rather than as a per-conversation cursor. The unread
  badge and the "mark this read" write are then each a single statement, and a
  message arriving while the thread is open can be marked read without racing a
  cursor update.
- Opening a conversation is what marks it read. There is no separate ack packet,
  which would only be a second round trip that can be dropped.

## Gifting

Gifting is not a new purchase path. It is the existing one with a different
destination, so the two cannot drift apart:

```
coins   → always leave the buyer
item    → goes to receiverId, which is the buyer unless a gift resolved
buyer_id → still whoever paid
gift_recipient_id → whose inventory it landed in
```

Refused shapes, and why each is refused rather than quietly allowed:

| Recipient | Result | Reasoning |
| --- | --- | --- |
| Not an accepted friend | `gift_recipient_not_friend` | The boundary. |
| The seller | `gift_recipient_is_seller` | They already own it; this moves coins and nothing else. |
| Not digits | `gift_recipient_invalid` | Refused before it reaches a query at all. |
| Inactive account | `gift_recipient_unavailable` | The item would be unreachable. |
| Yourself | *allowed, as an ordinary purchase* | It is just buying. Failing the sale over it would be rude. |

### Two deliberate limits

**Auctions cannot be gifted.** A bid is paid long before the auction resolves, so
there is no single moment at which a recipient could be chosen. Fixed-price
listings and case listings can be.

**The recipient is picked from a list, never typed.** A gift is an irreversible
paid transfer and usernames collide by design; a name field invites sending a
skin to a stranger with a similar name. The dialog has no text input, and a test
asserts it never gains one.

The recipient is notified (`giftReceived` + a banner) because a gift is the one
way an inventory changes without the owner acting — a silent transfer reads as a
bug.

## Testing

`test/direct-messages-gifting.test.js` (20 tests) pins the invariants above.

The transaction logic was additionally exercised offline against a faked `pg`
driver, and the client render functions against a DOM stub, because there is no
Postgres in the development environment. Both harnesses were mutation-tested:
dropping the friendship check, routing the item to the buyer, allowing the seller
as a recipient, and removing the DM friend check were each caught.
