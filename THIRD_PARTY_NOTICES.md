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
`public/assets/art/Maps/Lobby/` and remains the catalogued source of record.

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
