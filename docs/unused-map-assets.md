# Map asset placement audit

This audit covers the current 2D builds of The Skeld, MIRA HQ, and Polus. The three supplied reference screenshots are not runtime assets and are not stored, loaded, or rendered by the game.

## Confirmed runtime placement

### The Skeld

- `Cafeteria/Cafeteria-sharedassets0.assets-210.png`
- `Engine-sharedassets0.assets-147.png` (deliberate upper- and lower-engine crops)
- `MedBay-sharedassets0.assets-110.png` (deliberate room crop)
- `Weapons-sharedassets0.assets-201.png` (deliberate room crop)
- `Navigation-sharedassets0.assets-160.png` (deliberate room crop)
- `assets/rooms/skeld-o2.png`

The remaining Skeld rooms use original procedural floors, frames, and collision-matched props where a supplied sheet could not be isolated without displaying unrelated atlas content.

### MIRA HQ

- `assets/rooms/mira-admin.png`
- `assets/rooms/mira-cafeteria.png`
- `assets/rooms/mira-greenhouse.png`
- `assets/rooms/mira-laboratory.png`
- `assets/rooms/mira-medbay.png`
- `assets/rooms/mira-storage.png`
- `launchPadWalls-sharedassets0.assets-204.png`

The `assets/rooms/mira-*.png` files are the supplied room art already separated from the larger MIRA sheets. Office, Reactor, Decontamination, Locker Room, Communications, and Balcony use procedural textures and collision-matched props.

### Polus

- `PlanetSprites3-sharedassets0.assets-114.png` (deliberate Office and Admin crops)
- `dropshipTop-sharedassets0.assets-134.png` (Dropship hatch only)
- `ramp-sharedassets0.assets-166.png` (Dropship ramp only)
- `room_O2-sharedassets0.assets-93.png`
- `room_broadcast-sharedassets0.assets-57.png`
- `room_science-sharedassets0.assets-90.png` (deliberate Laboratory and MedBay crops that exclude the baked character)
- `room_specimen-sharedassets0.assets-123.png`
- `room_tunnel2-sharedassets0.assets-138.png`
- `room_weapon-sharedassets0.assets-80.png`
- `Storage/room_storage-sharedassets0.assets-98.png`

## Supplied map sheets not yet placed

These remain available in the repository, but they are not preloaded or displayed because their intended placement is ambiguous or their atlas region includes unrelated content.

### The Skeld

- `Cafeteria/cafeteriaWalls-sharedassets0.assets-152.png`
- `Hull-sharedassets0.assets-159.png`
- `LifeSupport-sharedassets0.assets-119.png`
- `Storage/Admin_Comms_Elec_Engine_Halls_Shields_Storage-sharedassets0.assets-150.png`
- `Security/Security-sharedassets0.assets-105.png`
- `Security/Security-sharedassets0.assets-162.png`
- `Security/Security-sharedassets0.assets-203.png`

The large Storage sheet appears to contain multiple halls and rooms interleaved with mask material. Exact crop coordinates for Electrical, Storage, Communications, Admin, Shields, Reactor, and Security would let those procedural sections be replaced safely.

### MIRA HQ

- `HQAssets-sharedassets0.assets-72.png`
- `HQAssets2-sharedassets0.assets-186.png`
- `HQAssets3-sharedassets0.assets-79.png`
- `compLabGreenHouseAdminWalls-sharedassets0.assets-67.png`

These are source atlases for several already separated room images. They are retained for future crop refinement rather than rendered as full sheets.

### Polus

- `PlanetSprites-sharedassets0.assets-62.png`
- `Other/PlanetSprites2-sharedassets0.assets-200.png`
- `Security/PlanetSecurity-sharedassets0.assets-53.png`

These contain composite exterior props, rocks, rockets, tunnels, or a security screen rather than an unambiguous whole-room image. A placement guide identifying crop bounds and target rooms would be useful.

## Intentionally excluded from map-room placement

- `Animations-sharedassets0.assets-165.png` — animation atlas
- `Doors-sharedassets0.assets-104.png` — door-state atlas
- `Lobby/Lobby-sharedassets0.assets-54.png` — lobby-specific art
- `bridge_sab-sharedassets0.assets-151.png` — sabotage/interface material
- `Tasks/ReactorRoom-sharedassets0.assets-132.png` — task/animation sheet, not a room background

These are not missing map art and should remain in their task, animation, door, or lobby pipelines.
