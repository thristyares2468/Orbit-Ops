# Map asset placement audit

This audit covers the current 2D builds of The Skeld, MIRA HQ, Polus, and the pre-match Dropship lobby. The supplied reference screenshots are not runtime assets and are not stored, loaded, or rendered by the game.

## Confirmed runtime placement

### The Skeld

- `Cafeteria/Cafeteria-sharedassets0.assets-210.png`
- `assets/rooms/skeld-upper-engine.png` and `assets/rooms/skeld-lower-engine.png` (complete floor-and-machinery composites isolated from `Engine-sharedassets0.assets-147.png`)
- `assets/rooms/skeld-reactor.png` (a rebuilt room shell using the supplied reactor machinery from `Tasks/ReactorRoom-sharedassets0.assets-132.png`)
- `MedBay-sharedassets0.assets-110.png` (deliberate room crop)
- `assets/rooms/skeld-weapons.png` (the isolated room silhouette from `Weapons-sharedassets0.assets-201.png`)
- `Navigation-sharedassets0.assets-160.png` (deliberate room crop)
- `assets/rooms/skeld-security.png` (the complete room plus the supplied monitor bank)
- `assets/rooms/skeld-o2.png` (the isolated O2 room from `LifeSupport-sharedassets0.assets-119.png`)
- `assets/rooms/skeld-electrical.png`
- `assets/rooms/skeld-storage.png`
- `assets/rooms/skeld-admin.png`
- `assets/rooms/skeld-communications.png`
- `assets/rooms/skeld-shields.png`

The last five room files above are carefully masked composites from `Storage/Admin_Comms_Elec_Engine_Halls_Shields_Storage-sharedassets0.assets-150.png`. Electrical and Storage preserve their intact supplied silhouettes. Admin restores the supplied map table. Communications rebuilds the missing shell around the supplied chair and desk. Shields recomposes the supplied platform, seating, and console bank. Opaque green atlas-mask islands and unrelated neighbouring sprites are not present in the runtime images.

### MIRA HQ

- `assets/rooms/mira-admin.png` (Office; the old filename is misleading)
- `assets/rooms/mira-laboratory.png` (Admin; the old filename is misleading)
- `assets/rooms/mira-cafeteria.png` (Locker Room; the old filename is misleading)
- `assets/rooms/mira-greenhouse.png`
- `assets/rooms/mira-medbay.png`
- `assets/rooms/mira-storage.png`
- `HQAssets2-sharedassets0.assets-186.png` (separate Reactor, Laboratory, and Decontamination crops)
- `HQAssets2-sharedassets0.assets-186.png` (one clean orange table crop, placed twice in Cafeteria as shown in the reference)
- `Cafeteria/cafeteriaWalls-sharedassets0.assets-152.png` (Cafeteria and Balcony crops; despite its folder, this is MIRA art)
- `launchPadWalls-sharedassets0.assets-204.png`

The room assignments above correct the previous cross-room mapping. Communications still uses an original procedural texture and a collision-matched console because no complete Communications background exists as a clean rectangular region.

### Polus

- `PlanetSprites3-sharedassets0.assets-114.png` (deliberate Office and Admin crops)
- `PlanetSprites-sharedassets0.assets-62.png` (the clean Security sub-room only)
- `dropshipTop-sharedassets0.assets-134.png` (Dropship hatch only)
- `ramp-sharedassets0.assets-166.png` (Dropship ramp only)
- `room_O2-sharedassets0.assets-93.png` (separate O2 tree-room, O2 Annex, and Boiler Room crops)
- `room_broadcast-sharedassets0.assets-57.png`
- `room_science-sharedassets0.assets-90.png` (deliberate Laboratory and MedBay crops that exclude the baked character)
- `room_specimen-sharedassets0.assets-123.png`
- `room_tunnel2-sharedassets0.assets-138.png`
- `room_weapon-sharedassets0.assets-80.png`
- `Storage/room_storage-sharedassets0.assets-98.png`

### Dropship lobby

- `assets/lobby/dropship.png` — hull, rear hatch, seat banks, floor grid, wings, and engine pods
- `assets/lobby/cargo-door.png` — scaled front ramp panel
- `assets/lobby/crate.png` — console, port, and starboard cargo placements
- `assets/lobby/laptop.png` — interactive host launch console
- `assets/lobby/exhaust.png` — paired cyan plumes, placed twice per engine pod
- `assets/lobby/equipment-case.svg` — original supplemental texture for the small case that is present in the lobby reference but absent from the supplied packed sheet

Every separated lobby sprite is now placed. `Lobby/Lobby-sharedassets0.assets-54.png` remains untouched as the catalogued source sheet; loading the separated sprites avoids rendering unrelated atlas regions.

## Supplied map sheets not yet placed

These remain available in the repository, but they are not preloaded or displayed because their intended placement is ambiguous or their atlas region includes unrelated content.

### The Skeld

- `Hull-sharedassets0.assets-159.png`
- `Security/Security-sharedassets0.assets-105.png`
- `Security/Security-sharedassets0.assets-162.png`

`Hull` is exterior hull, thruster, vent, and fastener material rather than a room. `Security-105` is an animation strip and `Security-162` contains monitor/desk props. The useful room regions from the large Storage sheet are now placed through masked, room-specific images; its remaining regions are corridors, duplicate fragments, or opaque atlas masks.

### MIRA HQ

- `HQAssets-sharedassets0.assets-72.png`
- `HQAssets3-sharedassets0.assets-79.png`
- `compLabGreenHouseAdminWalls-sharedassets0.assets-67.png`

These are source atlases for several already separated room images. `HQAssets` also contains furniture and task-adjacent material around the Locker Room/MedBay area. `HQAssets3` contains the large Y-shaped glass corridor, Greenhouse vines, the biological cylinder, map consoles, and office props across one connected composition. `compLabGreenHouseAdminWalls` is the source composition for Greenhouse, Office, and Admin. Their remaining regions are not loaded as rectangular rooms because they span multiple rooms or corridors.

### Polus

- `PlanetSprites-sharedassets0.assets-62.png`
- `Other/PlanetSprites2-sharedassets0.assets-200.png`
- `Security/PlanetSecurity-sharedassets0.assets-53.png`

The Security sub-room from `PlanetSprites` is placed, but its larger Electrical/Security building cannot be split into a clean Electrical rectangle without including the neighbouring room. The rest of that sheet and `PlanetSprites2` are exterior rocks, snow paths, rockets, antennae, crates, and environmental props. `PlanetSecurity` is the camera-monitor interface rather than floor art.

## Intentionally excluded from map-room placement

- `Animations-sharedassets0.assets-165.png` — animation atlas
- `Doors-sharedassets0.assets-104.png` — door-state atlas
- `bridge_sab-sharedassets0.assets-151.png` — sabotage/interface material
- The unused portions of `Tasks/ReactorRoom-sharedassets0.assets-132.png` remain task/animation frames; its reactor machinery is now reused in the rebuilt Reactor room.

These are not missing map art and should remain in their task, animation, or door pipelines.

## Scan conclusions

- The supplied reference screenshots remain reference-only and are never loaded by the runtime.
- No lobby-specific separated sprite is unused. The packed Lobby sheet stays as the source catalog, while all five extracted sprites and the supplemental equipment case are placed.
- Every canonical Skeld room now has supplied or reconstructed room art. The remaining files are primarily corridor/exterior assemblies, duplicate props, task interfaces, or animation sheets—not undiscovered complete rectangular rooms.
