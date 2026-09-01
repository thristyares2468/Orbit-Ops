# Third-party notices

## Town Of Us R

Orbit Ops includes adapted gameplay concepts and the following ability icons from the locally supplied
Town Of Us R source tree:

- `Engineer.png`
- `Medic.png`
- `Shoot.png`
- `Track.png`
- `Morph.png`
- `Swoop.png`
- `Janitor.png`
- `Vest.png`
- `NoAbility.png`

Town Of Us R identifies its plugin as `com.slushiegoose.townofus` and is distributed under the GNU
General Public License, version 3. The corresponding license text is preserved in
`third_party/town-of-us-r/LICENSE` and at the root of this source distribution.

The Orbit Ops implementations are new JavaScript server-authoritative adaptations for this project;
they do not embed or execute the original Unity/C# mod.

Source reference supplied by the project owner:

`/Users/jherbig/Downloads/Town-Of-Us-R-master`

## Player model and animation references

The project owner supplied a playable-character frame archive plus Alien, Gun, and Knife Stab
animation reference sheets. Their filenames identify them as Among Us character sprites and credit
the sheet ripper as JJ314. No separate open-source license accompanied these files, so they are
treated as user-supplied third-party art and are not relicensed by Orbit Ops' GPL-3.0-only source
license.

Runtime use is limited to the clean idle, walk, and standard death frame sequence extracted from the
supplied player archive. The three composite death sheets are preserved under
`public/assets/player-models/reference/` for the future cinematic animation pass.

Orbit Ops recolours the channel-authored model at runtime according to the supplied convention:

- Red source pixels map to the player's main suit colour.
- Blue source pixels map to the darker suit-shadow colour.
- Green source pixels map to the configured visor colour.
- Neutral outlines, highlights, and ground shadows remain unchanged.

Source references supplied by the project owner:

- `PC _ Computer - Among Us - Playable Characters - Player (Base, New Version).zip`
- `PC _ Computer - Among Us - Death Animations - Alien (New Version).png`
- `PC _ Computer - Among Us - Death Animations - Gun (New Version).png`
- `PC _ Computer - Among Us - Death Animations - Knife Stab (New Version).png`

## Dropship lobby sprites

`public/assets/lobby/` holds five sprites separated out of the supplied
`Maps/Lobby/Lobby-sharedassets0.assets-54.png` packed sheet: `dropship.png` (hull, wings, and both
engine pods), `cargo-door.png`, `crate.png`, `laptop.png`, and `exhaust.png`. The split is lossless —
each file is one connected drawn component copied pixel-for-pixel with its original alpha, with no
resampling, recolouring, or re-encoding of the artwork itself. The original sheet is untouched in
`public/assets/art/Maps/Lobby/` and remains the catalogued source of record. `equipment-case.svg` is
new Orbit Ops project art created to supply the small starboard case visible in the owner's lobby
layout reference but absent from that packed sheet; it is not extracted third-party material.

## Room artwork extracted from packed sheets

`public/assets/rooms/` holds whole-room images cropped losslessly from the supplied packed map
sheets so each room renders its real interior instead of a flat colour: `mira-cafeteria`,
`mira-admin`, `mira-laboratory`, `mira-greenhouse`, `mira-medbay`, and `mira-storage` come from
`Maps/HQAssets-*.png` and `Maps/compLabGreenHouseAdminWalls-*.png`; `skeld-o2` comes from
`Maps/LifeSupport-*.png`. Each crop is a plain rectangular region copied pixel-for-pixel with its
original alpha - no resampling, recolouring, or re-encoding of the artwork. The source sheets are
untouched and remain the catalogued originals under `public/assets/art/Maps/`.

## Python fan-conversion map architecture

The project owner supplied `Among-Us-clone-main.zip`, a Python/Pygame fan conversion whose source
code is released under the Unlicense. Orbit Ops adapts its general Tiled-map architecture:
ordered visible render layers are kept separate from named object groups used for collisions,
spawns, and interactions. The corresponding license is preserved in
`third_party/among-us-python-clone/LICENSE`.

The fan conversion's README states that its bundled original-game art was ripped. Orbit Ops does
not include its images, fonts, tilesets, or Skeld TMX map. Only the public-domain source
architecture was used as an implementation reference.

## Subdivision weapon models from Sketchfab

Three Subdivision weapon assets were supplied by the project owner. Two are Sketchfab exports that
carry their author and licence in the file's own `asset.extras` metadata, which the shipped copies
preserve: both are licensed **CC BY 4.0** (http://creativecommons.org/licenses/by/4.0/), which
permits this use and requires the attribution below. Neither is relicensed by Orbit Ops'
GPL-3.0-only source licence; each remains under CC BY 4.0. The third carries no metadata at all and
its provenance is still open.

- **"Basic Explosive"** by **Blender3D** (https://sketchfab.com/Blender3D) —
  https://sketchfab.com/3d-models/basic-explosive-e2ef33fefa4241b59c2aaf45c75a20ee
  Ships as `games/subdivision/assets/weapons/c4.glb` as the remote C4 charge.
  **Modified by Orbit Ops.** Geometry and UVs are untouched. The Sketchfab display matrix was
  removed from the root node so the model sits axis-aligned for the weapon-asset loader, the normal
  and occlusion/roughness maps were resampled to 512x512, and all three textures were re-encoded as
  JPEG, taking the file from 1.9 MB to 736 KB.

- **Shield** — provenance not recorded. Supplied by the project owner as `shield.obj`, a Blender OBJ
  export with no accompanying `.mtl`, no texture and no author or licence metadata of any kind, so
  nothing here identifies where it came from. **This entry needs the owner to confirm the source and
  licence before the asset is distributed.** It ships as
  `games/subdivision/assets/weapons/shield.glb`, the handheld shield primary. Orbit Ops converted the
  OBJ to binary glTF
  (fan-triangulated to 194 triangles, normals and UVs preserved) and authored a plain PBR material,
  since none was supplied. Geometry is unchanged.

- **"Shotgun"** by **tinycomputer** (https://sketchfab.com/tinycomputer) —
  https://sketchfab.com/3d-models/shotgun-cf4830cc5d09441495843ac79f005b73
  Ships as `games/subdivision/assets/weapons/breacher.glb` as the Breacher shotgun.
  **Modified by Orbit Ops.** Geometry, UVs and textures are untouched; only the Sketchfab display
  matrix was removed from the root node, so the authored axes reach the weapon loader.
