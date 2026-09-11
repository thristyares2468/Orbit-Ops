# Minigun

Classic Legendary Fortnite-inspired primary, not the Sideways/Brutus variant.
Reference: https://fortnite-archive.fandom.com/wiki/Minigun
Overheat reference: https://www.fortnite.com/patch-notes/v7-20

- 10 body/leg damage (half the classic 20); 12.5 head damage (requested 1.25x).
- 12 shots/second; 0.75-second trigger wind-up.
- 72 continuous shots before overheating; 4.5-second thermal lockout.
- 240 rounds per life, no reserve magazine or manual reload. This ammo allocation
  is a Subdivision balance choice, not Fortnite's shared light-ammo inventory.
- Sustained fire tightens spread; movement/sprinting still penalize accuracy.
- Held movement multiplier 0.50; RPG changed from 0.68 to 0.58. These are the
  existing game's movement-weight controls, not kilograms or inventory-wide weight.
- Shared server/client thermal rule; server tracks accepted shots and life ammo.
- Price 6500 in paid modes; available as a public primary in free-loadout modes.

The supplied six-second animation is sliced at 30fps: fire 0-6, ambient 7-60,
reload 61-128, hide 129-140, ready 140-159, melee 160-180. Fire, ready and ambient
are used by the viewmodel. The other authored clips remain available but do not
invent a reload or melee mechanic. Overheating uses separate animated barrel
emission and rising smoke, not the reload clip. Synthesized firing, motor and
cooling sounds respect mute, master and channel volumes.

Fortnite-only building damage and its inventory/range units are not transplanted
into Subdivision; existing map units, hitscan and armor/damage paths are retained.
