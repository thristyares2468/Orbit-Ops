# Player model runtime

The playable 2D character uses the clean frame sequence supplied in the player archive:

- `base/idle/idle.png`
- `base/walk/Walk0001.png` through `Walk0012.png`
- `base/death/Dead0001.png` through `Dead0042.png`

The browser creates cached colour variants from these source frames. Red is the main suit channel,
blue is the suit-shadow channel, and green is the visor channel. Black, white, grey, alpha, and other
neutral artwork are preserved.

The three large reference sheets are retained in `reference/`; they are not loaded into the live
game because their frames use irregular sheet layouts. Clean attacker/victim frame metadata can be
added here when the full cinematic elimination presentation is implemented.
