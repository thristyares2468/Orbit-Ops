// Last updated: 13 August 2026
// skins.js - hidden skin/case registry used by the backend and future UI.

const IMPORTED_SKINS = require('./skins_imported');

const RARITIES = Object.freeze([
  { id: 'common', displayName: 'Common', color: '#557ee8' },
  { id: 'rare', displayName: 'Rare', color: '#8e4de8' },
  { id: 'epic', displayName: 'Epic', color: '#e652a0' },
  { id: 'legendary', displayName: 'Legendary', color: '#d84b4b' },
  // Mythic is not open to any skin that asks for it. An item is Mythic only if
  // its own catalogue entry declares that tier, which sanitizeCaseDefinition
  // enforces - so the tier stays a short, hand-authored list rather than
  // something a case entry can promote an ordinary skin into. That list was
  // every knife until the M4A1 Elite Retaliator joined it.
  { id: 'mythic', displayName: 'Mythic', color: '#e6b63d', authoredOnly: true }
]);

const RARITY_BY_ID = new Map(RARITIES.map((rarity) => [rarity.id, rarity]));
const LEGACY_RARITY_MAP = Object.freeze({
  restricted: 'common',
  classified: 'epic',
  covert: 'legendary',
  gold: 'mythic'
});

function normalizeRarity(rarity) {
  const id = String(rarity || '').trim().toLowerCase();
  const normalized = LEGACY_RARITY_MAP[id] || id;
  return RARITY_BY_ID.has(normalized) ? normalized : 'common';
}

function rarityDisplayName(rarity) {
  const id = normalizeRarity(rarity);
  return RARITY_BY_ID.get(id)?.displayName || 'Common';
}

function embeddedTextureSkin({
  id,
  weapon,
  displayName,
  rarity,
  texture,
  model = texture,
  sourceModel,
  materialName
}) {
  const folder = weapon === 'AK47' ? 'ak47' : 'awp';
  return {
    id,
    weapon,
    kind: 'skin',
    displayName,
    rarity: normalizeRarity(rarity),
    texturePath: `/assets/skins/${folder}/${texture}.png`,
    modelPath: `/assets/skins/${folder}/${model}.glb`,
    baseModelPath: `/assets/weapons/${sourceModel}.glb`,
    // Generated GLBs already contain the selected PNG on the correct prim
    // source. Runtime repainting smears skins across unrelated material layers.
    textureApplication: 'embedded',
    textureMaterialNames: [materialName]
  };
}

const AK47_PRIM1 = { sourceModel: 'ak47_prim1', materialName: 'ak47.003' };
const AK47_PRIM2 = { sourceModel: 'ak47_prim2', materialName: 'weapon_rif_ak47.003' };
const AWP_PRIM1 = { sourceModel: 'awp_prim1', materialName: 'awp' };
const AWP_PRIM2 = { sourceModel: 'awp_prim2', materialName: 'weapon_snip_awp' };

const AK47_SKINS = [
  // The server serves /assets/*.glb with immutable one-year caching. Ice Coaled
  // already shipped on a fresh URL; the other AK wraps need fresh model URLs so
  // clients do not keep stale pre-fix GLBs.
  ['ak47_ice_coaled', 'AK-47 | Ice Coaled', 'epic', 'ice_coaled', 'ice_coaled', AK47_PRIM1],
  ['ak47_nightwish', 'AK-47 | Nightwish', 'legendary', 'nightwish', 'nightwish_akwrap', AK47_PRIM1],
  ['ak47_anubis', 'AK-47 | Anubis', 'epic', 'anubis', 'anubis_akwrap', AK47_PRIM1],
  ['ak47_asiimov', 'AK-47 | Asiimov', 'epic', 'asiimov', 'asiimov_akwrap', AK47_PRIM1],
  ['ak47_crossfade', 'AK-47 | Crossfade', 'common', 'crossfade', 'crossfade_akwrap', AK47_PRIM2],
  ['ak47_inheritence', 'AK-47 | Inheritence', 'legendary', 'inheritence', 'inheritence_akwrap', AK47_PRIM2],
  ['ak47_phantom_disruptor', 'AK-47 | Phantom Disruptor', 'epic', 'phantom_disruptor', 'phantom_disruptor_akwrap', AK47_PRIM1],
  ['ak47_point_disarray', 'AK-47 | Point Disarray', 'epic', 'point_disarray', 'point_disarray_akwrap', AK47_PRIM1],
  ['ak47_the_empress', 'AK-47 | The Empress', 'legendary', 'the_empress', 'the_empress_akwrap', AK47_PRIM1],
  ['ak47_wild_lotus', 'AK-47 | Wild Lotus', 'legendary', 'wild_lotus', 'wild_lotus_akwrap', AK47_PRIM1]
].map(([id, displayName, rarity, texture, model, source]) => embeddedTextureSkin({
  id,
  weapon: 'AK47',
  displayName,
  rarity,
  texture,
  model,
  ...source
}));

// AWP NO-TOUCH ZONE. The existing wraps were manually validated and are visually
// correct. Do not rename, regenerate, flip, rewrap, or change their prim
// assignments unless the user explicitly says AWP is broken. Bingle/Jog are
// intentional new additions and match Crakow's awp_prim2 layer.
const AWP_SKINS = [
  ['awp_asiimov', 'AWP | Asiimov', 'epic', 'asiimov', AWP_PRIM1],
  ['awp_crakow', 'AWP | Crakow!', 'epic', 'crakow', AWP_PRIM2],
  ['awp_bingle', 'AWP | Bingle', 'legendary', 'bingle', AWP_PRIM2],
  ['awp_desert_hydra', 'AWP | Desert Hydra', 'legendary', 'desert_hydra', AWP_PRIM1],
  ['awp_dragon_lore', 'AWP | Dragon Lore', 'legendary', 'dragon_lore', AWP_PRIM1],
  ['awp_gungnir', 'AWP | Gungnir', 'legendary', 'gungnir', AWP_PRIM1],
  ['awp_jog', 'AWP | Jog', 'epic', 'jog', AWP_PRIM2],
  ['awp_neo_noir', 'AWP | Neo-Noir', 'epic', 'neo_noir', AWP_PRIM1],
  ['awp_oni_taiji', 'AWP | Oni Taiji', 'legendary', 'oni_taiji', AWP_PRIM1],
  ['awp_the_prince', 'AWP | The Prince', 'legendary', 'the_prince', AWP_PRIM1],
  ['awp_wildfire', 'AWP | Wildfire', 'legendary', 'wildfire', AWP_PRIM1]
].map(([id, displayName, rarity, texture, source]) => embeddedTextureSkin({
  id,
  weapon: 'AWP',
  displayName,
  rarity,
  texture,
  ...source
}));

function dualBerettasSkin(id, title, rarity) {
  return {
    id: `dual_berettas_${id}`,
    weapon: 'Dual Berettas',
    kind: 'skin',
    displayName: `Dual Berettas | ${title}`,
    rarity: normalizeRarity(rarity),
    fixedRarity: true,
    texturePath: `/assets/skins/dual_berettas/${id}.png`,
    modelPath: '/assets/weapons/dual_elite.glb',
    // Keep the generated artwork fixed in authored UV space. These are named
    // finishes, not seed-rotated camouflage patterns.
    textureApplication: 'overlay',
    textureMaterialNames: ['weapon_pist_elite.001'],
    patternSeed: 0,
    imported: false
  };
}

// Unlike the older firearm library, these ten finishes have an authored rarity
// ladder so a case can consume them without an administrator classifying every
// entry by hand.
const DUAL_BERETTAS_SKINS = Object.freeze([
  dualBerettasSkin('carbon_service', 'Carbon Service', 'common'),
  dualBerettasSkin('urban_signal', 'Urban Signal', 'common'),
  dualBerettasSkin('desert_pulse', 'Desert Pulse', 'rare'),
  dualBerettasSkin('arctic_vector', 'Arctic Vector', 'rare'),
  dualBerettasSkin('oxide_bloom', 'Oxide Bloom', 'rare'),
  dualBerettasSkin('neon_crossfire', 'Neon Crossfire', 'epic'),
  dualBerettasSkin('abyssal_bloom', 'Abyssal Bloom', 'epic'),
  dualBerettasSkin('prism_static', 'Prism Static', 'epic'),
  dualBerettasSkin('helios_fracture', 'Helios Fracture', 'legendary'),
  dualBerettasSkin('imperial_voltage', 'Imperial Voltage', 'legendary')
]);

const SOVEREIGN_FLAME = {
  id: 'awp_sovereign_flame',
  weapon: 'AWP',
  kind: 'skin',
  displayName: 'AWP | Sovereign Flame',
  // The only catalogue skin that never declared a tier in source. The Mulch
  // case drops it as a legendary, so that is what it is.
  rarity: 'legendary',
  texturePath: '/assets/skins/imported/awp/sovereign_flame.png',
  modelPath: '/assets/weapons/imported/awp_prim2.glb',
  baseModelPath: '/assets/weapons/imported/awp_prim2.glb',
  textureApplication: 'overlay',
  textureMaterialNames: ['weapon_snip_awp'],
  imported: true
};

const FAMAS_VARIANTS = [
  {
    id: 'famas_underground',
    weapon: 'FAMAS',
    kind: 'model',
    displayName: 'FAMAS | Underground',
    rarity: 'epic',
    modelPath: '/assets/skins/famas/underground.glb',
    // The GLB's root matrix already converts its raw Y-long mesh to Z-forward.
    // Keep gameplayYaw/previewYaw separate; inventory and in-game model paths
    // normalize axes differently.
    assetAxis: 'z',
    gameplayYaw: Math.PI,
    previewYaw: Math.PI
  }
];

function equipmentPatternSkin({ id, weapon, displayName, rarity, texture, textureFolder = 'imported/patterns', materialNames, patternZoom = 1 }) {
  const sourceModel = weapon === 'Breacher' ? 'breacher' : weapon.toLowerCase();
  return {
    id,
    weapon,
    kind: 'skin',
    displayName,
    rarity: normalizeRarity(rarity),
    fixedRarity: true,
    texturePath: `/assets/skins/${textureFolder}/${texture}.png`,
    modelPath: `/assets/weapons/${sourceModel}.glb`,
    baseModelPath: `/assets/weapons/${sourceModel}.glb`,
    textureApplication: 'pattern',
    textureMaterialNames: materialNames,
    patternZoom,
    patternSeed: 0,
    imported: false
  };
}

// These newer weapons share the established procedural pattern/wear pipeline.
// Targeted material lists preserve the RPG's rocket, sights and small hardware
// instead of flattening the entire multi-material model into one texture.
const NEW_EQUIPMENT_SKINS = [
  equipmentPatternSkin({
    id: 'shield_aurora_aegis', weapon: 'Shield', rarity: 'legendary', displayName: 'Shield | Aurora Aegis',
    texture: 'bright_water', materialNames: ['Shield'], patternZoom: 1.35
  }),
  equipmentPatternSkin({
    id: 'shield_crimson_bulwark', weapon: 'Shield', rarity: 'rare', displayName: 'Shield | Crimson Bulwark',
    texture: 'crimson_web', materialNames: ['Shield'], patternZoom: 1.6
  }),
  equipmentPatternSkin({
    id: 'breacher_ember_entry', weapon: 'Breacher', rarity: 'rare', displayName: 'Breacher | Ember Entry',
    texture: 'pyrotechnic', materialNames: ['Material.001'], patternZoom: 1.25
  }),
  equipmentPatternSkin({
    id: 'breacher_night_entry', weapon: 'Breacher', rarity: 'common', displayName: 'Breacher | Night Entry',
    texture: 'urban_ddpat', materialNames: ['Material.001'], patternZoom: 1.45
  }),
  equipmentPatternSkin({
    id: 'rpg_orbital_energy', weapon: 'RPG', rarity: 'rare', displayName: 'RPG | Orbital Energy',
    texture: 'gamma_energy', materialNames: ['launcher', 'launcher_wooden_body', 'handles', 'handle_grips'], patternZoom: 1.15
  }),
  equipmentPatternSkin({
    id: 'rpg_launch_control', weapon: 'RPG', rarity: 'common', displayName: 'RPG | Launch Control',
    texture: 'control_pane', materialNames: ['launcher', 'launcher_wooden_body', 'handles', 'handle_grips'], patternZoom: 1.4
  })
];

// Rarity in this catalogue is a property of the FINISH, not of the weapon it is
// painted on. That is how the six cases authored by the original dev team
// (wearhouse, tradie, mulch, lawn_care, gardener, diamond_strong) classify their
// drops: across all six, 46 of the 48 finishes they use hold the same tier every
// time they appear. Only graphite_tech and royal_camo vary, and only by one
// adjacent tier, which reads as a per-case nudge rather than disagreement.
//
// This table is that taxonomy, used below so the equipment finishes - which
// reuse shipped firearm textures - inherit the tier the reference cases give
// them instead of being blanket-Common.
const FINISH_RARITY = Object.freeze({
  // Plain camouflage and solid metal treatments.
  arid_camo: 'common', blue_steel: 'common', boreal_forest: 'common',
  crimson_web: 'common', forest_ddpat: 'common', graphite_tech: 'common',
  pyrotechnic: 'common', royal_camo: 'common', scales: 'common',
  scorched: 'common', snake_camo: 'common', ultraviolet_swirl: 'common',
  urban_ddpat: 'common', woodgrain: 'common',
  // A single stylised motif over a plain body.
  afterimage: 'rare', franklin: 'rare', dual_energy: 'rare',
  // Full-coverage artwork. Fade is a vivid metallic gradient, not a camo.
  fade: 'epic', gamma_energy: 'epic',
  // Showpieces.
  bad_trip: 'legendary', case_hardened: 'legendary'
});

// Reuse shipped finishes without duplicating textures or changing weapon rules.
const EQUIPMENT_FINISHES = {
  RPG: [
    ['franklin', 'Franklin'], ['case_hardened', 'Heat Treated'],
    ['fade', 'Solar Fade'], ['scorched', 'Afterburn'],
    ['royal_camo', 'Royal Payload'], ['blue_steel', 'Cold Launch'],
    ['snake_camo', 'Viper'], ['ultraviolet_swirl', 'Void Spiral']
  ],
  Breacher: [
    ['case_hardened', 'Tempered Entry'], ['graphite_tech', 'Carbon Entry'],
    ['boreal_forest', 'Forest Ranger'], ['fade', 'Prismatic'],
    ['scales', 'Dragon Scale'], ['arid_camo', 'Sandstorm'],
    ['crimson_web', 'Widowmaker'], ['dual_energy', 'Double Charge']
  ],
  Shield: [
    ['blue_steel', 'Blue Bastion'], ['royal_camo', 'Royal Guard'],
    ['forest_ddpat', 'Forest Wall'], ['gamma_energy', 'Reactor Guard'],
    ['graphite_tech', 'Carbon Fortress'], ['pyrotechnic', 'Firebreak'],
    ['ultraviolet_swirl', 'Nebula'], ['woodgrain', 'Timberline']
  ]
};
for (const [weapon, finishes] of Object.entries(EQUIPMENT_FINISHES)) {
  for (const [texture, title] of finishes) {
    NEW_EQUIPMENT_SKINS.push(equipmentPatternSkin({
      id: `${weapon.toLowerCase()}_${texture}`, weapon,
      displayName: `${weapon} | ${title}`,
      rarity: FINISH_RARITY[texture] || 'common', texture, patternZoom: 1.2,
      materialNames: weapon === 'RPG'
        ? ['launcher', 'launcher_wooden_body', 'handles', 'handle_grips']
        : weapon === 'Shield' ? ['Shield'] : ['Material.001']
    }));
  }
}

// A single authored texture ladder shared across the three new equipment
// families. No Common skins are added: their existing libraries already cover
// that tier, while Rare, Epic, and Legendary need the visual variety.
const HEAVY_COLLECTION_FINISHES = Object.freeze([
  ['field_issue', 'Field Issue', 'rare', 1.2],
  ['worksite_grid', 'Worksite Grid', 'rare', 1.2],
  ['tidal_circuit', 'Tidal Circuit', 'rare', 1.25],
  ['ember_mesh', 'Ember Mesh', 'epic', 1.2],
  ['verdant_alloy', 'Verdant Alloy', 'epic', 1.15],
  ['arc_flash', 'Arc Flash', 'epic', 1.3],
  ['molten_fault', 'Molten Fault', 'epic', 1.25],
  ['spectral_bloom', 'Spectral Bloom', 'legendary', 1.18],
  ['solar_regalia', 'Solar Regalia', 'legendary', 1.12],
  ['void_crown', 'Void Crown', 'legendary', 1.2]
]);
for (const weapon of ['RPG', 'Shield', 'Breacher']) {
  for (const [texture, title, rarity, patternZoom] of HEAVY_COLLECTION_FINISHES) {
    NEW_EQUIPMENT_SKINS.push(equipmentPatternSkin({
      id: `${weapon.toLowerCase()}_${texture}`,
      weapon,
      displayName: `${weapon} | ${title}`,
      rarity,
      texture,
      textureFolder: 'equipment_collection',
      patternZoom,
      materialNames: weapon === 'RPG'
        ? ['launcher', 'launcher_wooden_body', 'handles', 'handle_grips']
        : weapon === 'Shield' ? ['Shield'] : ['Material.001']
    }));
  }
}

// The M4A1 reuses established finishes at their catalogue-wide tiers. Keep the
// magazine, stock, and scope authored; only Body1 is paintable on this model.
const M4A1_FINISHES = Object.freeze([
  ['arid_camo', 'Arid Camo', 1.3],
  ['blue_steel', 'Blue Steel', 1.15],
  ['urban_ddpat', 'Urban DDPAT', 1.35],
  ['afterimage', 'Afterimage', 1.15],
  ['franklin', 'Franklin', 1.2],
  ['dual_energy', 'Dual Energy', 1.18],
  ['fade', 'Fade', 1.1],
  ['gamma_energy', 'Gamma Energy', 1.2],
  ['bad_trip', 'Bad Trip', 1.12],
  ['case_hardened', 'Case Hardened', 1.3]
]);
for (const [texture, title, patternZoom] of M4A1_FINISHES) {
  NEW_EQUIPMENT_SKINS.push(equipmentPatternSkin({
    id: `m4a1_${texture}`,
    weapon: 'M4A1',
    displayName: `M4A1 | ${title}`,
    rarity: FINISH_RARITY[texture],
    texture,
    materialNames: ['Body1'],
    patternZoom
  }));
}

// Every Nerf skin fires the dart rather than the default streak. The tracer
// model rides with the skin rather than being keyed off the skin id in the
// client, so a skin can bring its own round without touching the shot code.
// The dart's tip already points -Z, the direction tracers are aimed down.
const NERF_DART_TRACER = '/assets/skins/shared/nerf_dart.glb';

// The Nerf Mythics. Unlike the texture skins these are not a wrap over the
// weapon's own GLB - each is a different gun entirely, so they declare kind
// 'model' and their own path, the way the Mythic knives do.
//
// Every GLB below is stored already aimed down -Z with +Y up, with whatever
// turn its source needed baked into the asset rather than carried here. That
// leaves the two yaws meaning one thing each, which is what makes them
// checkable:
//
//   gameplayYaw - cancels the yaw the weapon's own asset spec adds, and
//                 nothing else. Math.PI for the Knife and Dual Berettas,
//                 -Math.PI/2 for the M4A1, zero for every other weapon.
//   previewYaw  - Math.PI for guns. The preview path does NOT apply the spec
//                 rot and turns assetAxis 'z' by -Math.PI/2 on its own, which
//                 lands the muzzle pointing right; the half turn puts it left,
//                 matching how every base weapon frames in the showroom.
//
// The one exception is the Deagle's Firestrike Elite: its source uses
// KHR_materials_pbrSpecularGlossiness, which three r135 still renders but the
// glTF tooling here refuses to read, so its rotation could not be baked and it
// carries the turn in its yaws instead.
//
// Measure, do not reason, if any of this is ever touched. A bare Box3 cannot
// see a backwards model - a 180deg yaw leaves size and centre identical - and
// an earlier pass removed a yaw on that evidence and shipped a rifle pointing
// backwards. Render it against an arrow drawn down -Z and check the muzzle
// follows the arrow.
function nerfMythic({ id, weapon, displayName, modelPath, gameplayYaw = 0, previewYaw = Math.PI }) {
  return Object.freeze({
    id,
    weapon,
    kind: 'model',
    displayName,
    rarity: 'mythic',
    modelPath,
    assetAxis: 'z',
    gameplayYaw,
    previewYaw,
    tracerModelPath: NERF_DART_TRACER,
    imported: false
  });
}

const NERF_MYTHIC_SKINS = Object.freeze([
  // Renamed off the M4A1 and onto the AK47, which adds no yaw of its own.
  nerfMythic({ id: 'm4a1_vanguard', weapon: 'AK47', displayName: 'AK47 | Elite Retaliator', modelPath: '/assets/skins/ak47/vanguard.glb' }),
  nerfMythic({ id: 'glock_jolt', weapon: 'Glock', displayName: 'Glock | Jolt', modelPath: '/assets/skins/glock/jolt.glb' }),
  nerfMythic({ id: 'mac10_retaliator', weapon: 'MAC10', displayName: 'MAC10 | Retaliator', modelPath: '/assets/skins/mac10/retaliator.glb' }),
  // The unbakeable one - see the note above. Its source aims down +X.
  nerfMythic({ id: 'deagle_firestrike_elite', weapon: 'Deagle', displayName: 'Deagle | Firestrike Elite', modelPath: '/assets/skins/deagle/firestrike.glb', gameplayYaw: -Math.PI / 2, previewYaw: Math.PI / 2 }),
  nerfMythic({ id: 'p90_delete', weapon: 'P90', displayName: 'P90 | Delete', modelPath: '/assets/skins/p90/delete.glb' }),
  nerfMythic({ id: 'awp_heavy_sniper', weapon: 'AWP', displayName: 'AWP | Heavy Sniper', modelPath: '/assets/skins/awp/heavy_sniper.glb' }),
  // The dual-pistol splitter cuts the template at its world-X midpoint and
  // hands one half to each hand, so this GLB ships two pistols side by side
  // along X the way dual_elite.glb does. A single pistol would be halved.
  nerfMythic({ id: 'dual_berettas_doublestrike', weapon: 'Dual Berettas', displayName: 'Dual Berettas | Doublestrike', modelPath: '/assets/skins/dual_berettas/doublestrike.glb', gameplayYaw: Math.PI }),
  // Under /knife/toy/ so knifeTypeForItem reports the type as "Toy". The
  // preview path has its own knife branch, which already frames a blade the
  // way the base knives frame, so this one takes no preview turn.
  nerfMythic({ id: 'knife_toy_nerf', weapon: 'Knife', displayName: 'Knife | Toy Knife', modelPath: '/assets/skins/knife/toy/toy.glb', gameplayYaw: Math.PI, previewYaw: 0 }),
  nerfMythic({ id: 'm4a1_g36', weapon: 'M4A1', displayName: 'M4A1 | G36', modelPath: '/assets/skins/m4a1/g36.glb', gameplayYaw: -Math.PI / 2 }),
  nerfMythic({ id: 'ssg08_super_soaker', weapon: 'SSG 08', displayName: 'SSG 08 | Super Soaker 50', modelPath: '/assets/skins/ssg08/super_soaker.glb' })
]);

NEW_EQUIPMENT_SKINS.push({
  id: 'shield_rexton', weapon: 'Shield', kind: 'skin',
  displayName: 'Shield | Rexton', rarity: 'rare',
  texturePath: '/assets/skins/shield/rexton.png',
  modelPath: '/assets/skins/shield/rexton.glb',
  baseModelPath: '/assets/weapons/shield.glb',
  textureApplication: 'embedded', textureMaterialNames: ['Rexton Photo'],
  imported: false
});

const DEFAULT_KNIFE_ITEM_IDS = Object.freeze(['knife_default_ct_vanilla', 'knife_default_t_vanilla']);

const KNIFE_VARIANTS = [
  ['knife_bayonet_vanilla', 'Knife | Bayonet Vanilla', 'bayonet/bayonet.glb'],
  ['knife_bowie_vanilla', 'Knife | Bowie Vanilla', 'bowie/bowie.glb'],
  ['knife_butterfly_vanilla', 'Knife | Butterfly Vanilla', 'butterfly/butterfly.glb'],
  ['knife_canis_vanilla', 'Knife | Canis Vanilla', 'canis/canis.glb'],
  ['knife_cord_vanilla', 'Knife | Cord Vanilla', 'cord/cord.glb'],
  ['knife_css_vanilla', 'Knife | Classic Vanilla', 'css/css.glb'],
  ['knife_default_ct_vanilla', 'Knife | CT Vanilla', 'default/knifect.glb'],
  ['knife_default_t_vanilla', 'Knife | T Vanilla', 'default/knifet.glb'],
  ['knife_falchion_vanilla', 'Knife | Falchion Vanilla', 'falchion/falchion.glb'],
  ['knife_flip_vanilla', 'Knife | Flip Vanilla', 'flip/flip.glb'],
  ['knife_gut_vanilla', 'Knife | Gut Vanilla', 'gut/gut.glb'],
  ['knife_karambit_vanilla', 'Knife | Karambit Vanilla', 'karambit/karambit.glb'],
  ['knife_kukri_vanilla', 'Knife | Kukri Vanilla', 'kukri/kukri.glb'],
  ['knife_m9_vanilla', 'Knife | M9 Bayonet Vanilla', 'm9/m9.glb'],
  ['knife_navaja_vanilla', 'Knife | Navaja Vanilla', 'navaja/navaja.glb'],
  ['knife_outdoor_vanilla', 'Knife | Outdoor Vanilla', 'outdoor/outdoor.glb'],
  ['knife_skeleton_vanilla', 'Knife | Skeleton Vanilla', 'skeleton/skeleton.glb'],
  ['knife_stiletto_vanilla', 'Knife | Stiletto Vanilla', 'stiletto/stiletto.glb'],
  ['knife_tactical_vanilla', 'Knife | Tactical Vanilla', 'tactical/tactical.glb'],
  ['knife_talon_vanilla', 'Knife | Talon Vanilla', 'talon/talon.glb'],
  ['knife_ursus_vanilla', 'Knife | Ursus Vanilla', 'ursus/ursus.glb']
].map(([id, displayName, relPath]) => ({
  id,
  weapon: 'Knife',
  kind: 'model',
  displayName,
  rarity: 'mythic',
  modelPath: `/assets/skins/knife/${relPath}`
}));

// Arsenal Vault's two Mythic rewards deliberately use different knife silhouettes
// and their own repeatable texture maps.  They remain normal catalog items, so
// the admin case editor can add them to any case without client-only special
// handling.
const ARSENAL_VAULT_KNIFE_SKINS = Object.freeze([
  {
    id: 'knife_karambit_vortex_fang',
    weapon: 'Knife',
    kind: 'skin',
    displayName: 'Karambit | Vortex Fang',
    rarity: 'mythic',
    modelPath: '/assets/skins/knife/karambit/karambit.glb',
    baseModelPath: '/assets/skins/knife/karambit/karambit.glb',
    texturePath: '/assets/skins/imported/patterns/arsenal_vortex_fang.png',
    textureApplication: 'pattern',
    textureMaterialNames: ['weapon_knife_karambit'],
    patternZoom: 1.2,
    patternSeed: 0,
    imported: false
  },
  {
    id: 'knife_bowie_solar_reaver',
    weapon: 'Knife',
    kind: 'skin',
    displayName: 'Bowie | Solar Reaver',
    rarity: 'mythic',
    modelPath: '/assets/skins/knife/bowie/bowie.glb',
    baseModelPath: '/assets/skins/knife/bowie/bowie.glb',
    texturePath: '/assets/skins/imported/patterns/arsenal_solar_reaver.png',
    textureApplication: 'pattern',
    textureMaterialNames: ['weapon_knife_bowie'],
    patternZoom: 1.08,
    patternSeed: 0,
    imported: false
  }
]);

const ALL_KNIFE_ITEMS = Object.freeze([...KNIFE_VARIANTS, ...ARSENAL_VAULT_KNIFE_SKINS]);

function uniqueCatalogItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

const KNIFE_TYPE_LABELS = Object.freeze({
  bayonet: 'Bayonet', bowie: 'Bowie', butterfly: 'Butterfly', canis: 'Canis',
  classic: 'Classic', cord: 'Cord', css: 'Classic', default: 'Default',
  falchion: 'Falchion', flip: 'Flip', gut: 'Gut', huntsman: 'Huntsman',
  karambit: 'Karambit', kukri: 'Kukri', m9: 'M9 Bayonet', m9bayonet: 'M9 Bayonet',
  navaja: 'Navaja', nomad: 'Nomad', outdoor: 'Outdoor', paracord: 'Paracord',
  push: 'Shadow Daggers', skeleton: 'Skeleton', stiletto: 'Stiletto',
  survival: 'Survival', tactical: 'Tactical', talon: 'Talon', ursus: 'Ursus'
});

function titleCaseSlug(value) {
  return String(value || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function knifeTypeForItem(item) {
  if (item?.weapon !== 'Knife') return '';
  const pathMatch = String(item.modelPath || item.baseModelPath || '').match(/\/knife\/([^/]+)\//i);
  const rawType = String(pathMatch?.[1] || String(item.id || '').split('_')[1] || '').toLowerCase();
  return KNIFE_TYPE_LABELS[rawType] || titleCaseSlug(rawType);
}

function finishForItem(item, knifeType = knifeTypeForItem(item)) {
  if (item?.textureApplication === 'pattern') {
    const patternFile = String(item.texturePath || '').split('/').pop();
    if (patternFile) return titleCaseSlug(patternFile);
  }
  const displayFinish = String(item?.displayName || '').split('|').slice(1).join('|').trim();
  if (!displayFinish) return item?.kind === 'model' ? 'Vanilla' : '';
  if (item?.weapon === 'Knife' && knifeType && displayFinish.toLowerCase().startsWith(knifeType.toLowerCase())) {
    return displayFinish.slice(knifeType.length).trim() || 'Vanilla';
  }
  return displayFinish;
}

const KNIFE_HANDLE_OVERLAY_FOLDERS = new Set([
  'bayonet', 'bowie', 'butterfly', 'classic', 'falchion', 'flip', 'gut', 'huntsman',
  'karambit', 'kukri', 'm9bayonet', 'navaja', 'nomad', 'paracord', 'skeleton',
  'stiletto', 'survival', 'talon', 'ursus'
]);

function overlayTexturePathForItem(item) {
  if (item?.usesOverlay && item.weapon === 'AK47') return '/assets/skins/overlays/ak47_wooden_overlay.png';
  if (!item?.usesHandleOverlay || item?.weapon !== 'Knife') return '';
  const folder = String(item.modelPath || item.baseModelPath || '').match(/\/knife\/([^/]+)\//i)?.[1];
  return KNIFE_HANDLE_OVERLAY_FOLDERS.has(folder) ? `/assets/skins/overlays/knife/${folder}_handle_overlay.png` : '';
}

function enrichCatalogItem(item) {
  const knifeType = knifeTypeForItem(item);
  const minimumFloat = Math.max(0, Math.min(1, Number(item?.minimumFloat ?? item?.minimum_float ?? 0) || 0));
  const configuredMaximum = Number(item?.maximumFloat ?? item?.maximum_float ?? 1);
  const maximumFloat = Math.max(minimumFloat, Math.min(1, Number.isFinite(configuredMaximum) ? configuredMaximum : 1));
  return {
    ...item,
    skinDefinitionId: item?.id,
    // Every catalogue skin carries its authored tier. This used to be nulled for
    // firearms, on the principle that rarity belonged to a case drop rather than
    // to the reusable skin - but the authored values were there all along (262 of
    // the 263 non-knife skins declare one), and nulling them meant any case entry
    // that did not set a rarity by hand silently became Common, because
    // normalizeRarity(null) is 'common'. A case entry still wins where it sets
    // one, so this only changes what an unset entry inherits.
    rarity: item?.weapon === 'Knife' ? 'mythic' : normalizeRarity(item.rarity),
    minimumFloat,
    maximumFloat,
    tradeUpEligible: item?.tradeUpEligible !== false && !DEFAULT_KNIFE_ITEM_IDS.includes(item?.id),
    overlayTexturePath: overlayTexturePathForItem(item),
    knifeType,
    finish: finishForItem(item, knifeType),
    textureType: item?.textureApplication === 'pattern'
      ? 'pattern'
      : (item?.textureApplication === 'embedded' || item?.texturePath ? 'artwork' : 'vanilla')
  };
}

const KNIFE_ONLY_FINISHES = new Set(['gamma energy', 'fade', 'dual energy']);
const IMPORTED_PUBLIC_SKINS = IMPORTED_SKINS.filter((item) => {
  if (item?.weapon === 'Knife') return true;
  const finish = String(item?.displayName || '').split('|').slice(1).join('|').trim().toLowerCase();
  return !KNIFE_ONLY_FINISHES.has(finish);
});
const ITEMS = Object.freeze(uniqueCatalogItems([
  ...AK47_SKINS,
  ...AWP_SKINS,
  ...DUAL_BERETTAS_SKINS,
  SOVEREIGN_FLAME,
  ...NERF_MYTHIC_SKINS,
  ...FAMAS_VARIANTS,
  ...NEW_EQUIPMENT_SKINS,
  ...ALL_KNIFE_ITEMS,
  ...IMPORTED_PUBLIC_SKINS
]).map(enrichCatalogItem));
const ITEM_BY_ID = new Map(ITEMS.map((item) => [item.id, item]));
const KNIFE_ITEM_IDS = Object.freeze(ALL_KNIFE_ITEMS.map((item) => item.id));
const MYTHIC_KNIFE_ITEM_IDS = Object.freeze(ALL_KNIFE_ITEMS.filter((item) => item.rarity === 'mythic').map((item) => item.id));
// Non-gold pull pool. The test here is the tier, not the weapon: excluding only
// knives would have let a Mythic rifle drop as an ordinary pull.
const STANDARD_CASE_ITEM_IDS = Object.freeze(ITEMS.filter((item) => item.rarity !== 'mythic').map((item) => item.id));
const PROTOTYPE_CASE_ID = 'prototype_case';
const GOLD_ROLL_DENOMINATOR = 30;
const CASE_DESIGNS = Object.freeze([
  { id: 'operative-gold', displayName: 'Operative Gold' },
  { id: 'orbital-blue', displayName: 'Orbital Blue' },
  { id: 'aurora-vault', displayName: 'Aurora Vault' },
  { id: 'cryo-cell', displayName: 'Cryo Cell' },
  { id: 'solar-flare', displayName: 'Solar Flare' },
  { id: 'nebula-royal', displayName: 'Nebula Royal' },
  { id: 'reactor-core', displayName: 'Reactor Core' },
  { id: 'void-ops', displayName: 'Void Ops' },
  { id: 'lunar-dust', displayName: 'Lunar Dust' },
  { id: 'ion-storm', displayName: 'Ion Storm' },
  { id: 'asteroid-ore', displayName: 'Asteroid Ore' },
  { id: 'bio-dome', displayName: 'Bio Dome' },
  { id: 'garden-bloom', displayName: 'Garden Bloom' },
  { id: 'oceanic', displayName: 'Oceanic' },
  { id: 'hazard-grid', displayName: 'Hazard Grid' },
  { id: 'prism-glass', displayName: 'Prism Glass' },
  { id: 'diamond-vault', displayName: 'Diamond Vault' },
  { id: 'retro-orbit', displayName: 'Retro Orbit' },
  { id: 'signal-static', displayName: 'Signal Static' },
  { id: 'tradie-esky', displayName: 'Tradie Esky' },
  { id: 'gardener-case', displayName: 'Gardener Case' },
  { id: 'lawn-care-case', displayName: 'Lawn-Care Case' },
  { id: 'mulch-case', displayName: 'Mulch Case' },
  { id: 'nuke-case', displayName: 'Nuke Case' },
  { id: 'warehouse-case', displayName: 'Warehouse Case' },
  { id: 'curry-case', displayName: 'Curry Case' },
  { id: 'foamstrike-case', displayName: 'Foamstrike Case' }
]);
const CASE_DESIGN_IDS = new Set(CASE_DESIGNS.map(({ id }) => id));

// No default cases ship in the public catalog. Admin-created cases are stored
// in Postgres and merged at publicCatalog() time.
const CASES = Object.freeze([]);
const CASE_BY_ID = new Map(CASES.map((caseDef) => [caseDef.id, caseDef]));

// Granted only to explicitly authorised skin-lab accounts. Public accounts
// receive items from cases/grants and never from this testing catalog.
const STARTER_ITEM_IDS = Object.freeze([
  ...ITEMS.filter((item) => item.weapon !== 'Knife').map((item) => item.id),
  ...DEFAULT_KNIFE_ITEM_IDS
]);

function getItem(id) {
  return ITEM_BY_ID.get(String(id || '')) || null;
}

function sanitizeCaseId(id) {
  return String(id || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 48);
}

function sanitizeCaseDefinition(input = {}, { requireItems = true } = {}) {
  // One sanitizer is shared by the admin editor, server handlers, and DB reads.
  // It keeps case ids URL-safe, prevents duplicate drops, and enforces the
  // product rule that Mythic rewards are knives only.
  const id = sanitizeCaseId(input.id);
  if (!id) throw new Error('case_id_required');
  const displayName = String(input.displayName || input.name || id)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || id;
  const defaultCollectionName = `${displayName.replace(/\s+case$/i, '').trim() || displayName} Collection`;
  const collectionName = String(input.collectionName || input.collection_name || defaultCollectionName)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || defaultCollectionName;
  const requestedDesign = String(input.designId ?? input.design_id ?? 'auto').trim().toLowerCase();
  const designId = CASE_DESIGN_IDS.has(requestedDesign) ? requestedDesign : 'auto';
  const price = Math.max(0, Math.min(1000000000, Math.floor(Number(input.price ?? input.priceMowbucks ?? input.cost) || 0)));
  const marketVisible = (input.marketVisible ?? input.visibleInMarket ?? input.visible_in_market) !== false;
  const normalizeDate = (value) => {
    if (!value) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  };
  const availableFrom = normalizeDate(input.availableFrom ?? input.available_from);
  const availableUntil = normalizeDate(input.availableUntil ?? input.available_until);
  if (availableFrom && availableUntil && Date.parse(availableUntil) <= Date.parse(availableFrom)) throw new Error('case_availability_order');
  const showTimeRemaining = (input.showTimeRemaining ?? input.show_time_remaining) === true;
  const rawDiscountPrice = input.discountPrice ?? input.discount_price;
  const discountPrice = rawDiscountPrice === null || rawDiscountPrice === undefined || rawDiscountPrice === ''
    ? null
    : Math.max(0, Math.min(price, Math.floor(Number(rawDiscountPrice) || 0)));
  const discountMode = input.discountMode === 'final' || input.discount_mode === 'final' ? 'final'
    : (input.discountMode === 'window' || input.discount_mode === 'window' ? 'window' : 'none');
  const discountStartsAt = normalizeDate(input.discountStartsAt ?? input.discount_starts_at);
  const discountEndsAt = normalizeDate(input.discountEndsAt ?? input.discount_ends_at);
  const finalDiscountMinutes = Math.max(0, Math.min(525600, Math.floor(Number(input.finalDiscountMinutes ?? input.final_discount_minutes) || 0)));
  if (discountMode !== 'none' && (discountPrice == null || discountPrice >= price)) throw new Error('case_discount_price_required');
  if (discountMode === 'window' && (!discountStartsAt || !discountEndsAt)) throw new Error('case_discount_window_required');
  if (discountMode === 'window' && discountStartsAt && discountEndsAt && Date.parse(discountEndsAt) <= Date.parse(discountStartsAt)) throw new Error('case_discount_order');
  if (discountMode === 'final' && (!availableUntil || !finalDiscountMinutes)) throw new Error('case_final_discount_requires_end');
  if (discountMode === 'final' && availableFrom && availableUntil && finalDiscountMinutes * 60000 > Date.parse(availableUntil) - Date.parse(availableFrom)) throw new Error('case_final_discount_too_long');
  if (discountMode === 'window' && availableFrom && Date.parse(discountStartsAt) < Date.parse(availableFrom)) throw new Error('case_discount_outside_availability');
  if (discountMode === 'window' && availableUntil && Date.parse(discountEndsAt) > Date.parse(availableUntil)) throw new Error('case_discount_outside_availability');
  const rarityMode = input.rarityMode === 'class' ? 'class' : 'skin';
  const rarityWeights = Object.fromEntries(RARITIES.map(({ id: rarityId }) => [
    rarityId,
    Math.max(0, Math.min(1000000, Number(input.rarityWeights?.[rarityId]) || 0))
  ]));
  const seen = new Set();
  const items = [];
  for (const rawEntry of Array.isArray(input.items) ? input.items : []) {
    const item = getItem(rawEntry?.itemId || rawEntry?.item_id || rawEntry?.id);
    if (!item || seen.has(item.id)) continue;
    const rarity = normalizeRarity(rawEntry?.rarity || rawEntry?.tier || item.rarity);
    // A case entry can set any tier it likes EXCEPT Mythic, which it can only
    // confirm: the item has to already be authored Mythic in the catalogue.
    // Error id unchanged so existing callers and messages still match.
    if (rarity === 'mythic' && item.rarity !== 'mythic') throw new Error('mythic_requires_knife');
    const weight = Math.max(1, Math.min(100000, Math.floor(Number(rawEntry?.weight) || 0)));
    seen.add(item.id);
    items.push({ itemId: item.id, weight, rarity });
  }
  if (requireItems && !items.length) throw new Error('case_items_required');
  return {
    id, displayName, collectionName, designId, price, marketVisible,
    availableFrom, availableUntil, showTimeRemaining,
    discountPrice, discountMode, discountStartsAt, discountEndsAt, finalDiscountMinutes,
    rarityMode, rarityWeights, items
  };
}

function caseAvailability(caseDef, now = Date.now()) {
  const timestamp = Number(now) || Date.now();
  const startsAt = caseDef?.availableFrom ? Date.parse(caseDef.availableFrom) : null;
  const endsAt = caseDef?.availableUntil ? Date.parse(caseDef.availableUntil) : null;
  const available = caseDef?.marketVisible !== false
    && (!Number.isFinite(startsAt) || timestamp >= startsAt)
    && (!Number.isFinite(endsAt) || timestamp < endsAt);
  let discountStartsAt = caseDef?.discountStartsAt ? Date.parse(caseDef.discountStartsAt) : null;
  let discountEndsAt = caseDef?.discountEndsAt ? Date.parse(caseDef.discountEndsAt) : null;
  if (caseDef?.discountMode === 'final' && Number.isFinite(endsAt) && Number(caseDef.finalDiscountMinutes) > 0) {
    discountStartsAt = endsAt - Number(caseDef.finalDiscountMinutes) * 60000;
    discountEndsAt = endsAt;
  }
  const discountActive = available && caseDef?.discountPrice != null && Number(caseDef.discountPrice) < Number(caseDef.price || 0)
    && (!Number.isFinite(discountStartsAt) || timestamp >= discountStartsAt)
    && (!Number.isFinite(discountEndsAt) || timestamp < discountEndsAt);
  return {
    available,
    startsAt: Number.isFinite(startsAt) ? startsAt : null,
    endsAt: Number.isFinite(endsAt) ? endsAt : null,
    discountActive,
    discountStartsAt: Number.isFinite(discountStartsAt) ? discountStartsAt : null,
    discountEndsAt: Number.isFinite(discountEndsAt) ? discountEndsAt : null,
    price: discountActive ? Number(caseDef.discountPrice) : Number(caseDef?.price || 0)
  };
}

function sanitizeCaseDefinitions(caseDefs = []) {
  const out = [];
  const seen = new Set(CASES.map((caseDef) => caseDef.id));
  for (const raw of Array.isArray(caseDefs) ? caseDefs : []) {
    try {
      const caseDef = sanitizeCaseDefinition(raw);
      if (seen.has(caseDef.id)) continue;
      seen.add(caseDef.id);
      out.push(caseDef);
    } catch {}
  }
  return out;
}

function publicCatalog(customCases = []) {
  // The browser receives this read-only catalog. Imported skin rows come from the
  // generated skins_imported.js file; do not hand-edit those generated entries.
  const cases = [...CASES, ...sanitizeCaseDefinitions(customCases)];
  const collections = cases.map((caseDef) => ({
    id: caseDef.id,
    caseId: caseDef.id,
    displayName: caseDef.collectionName,
    items: caseDef.items
      .map((entry) => ({ ...entry, item: getItem(entry.itemId) }))
      .filter((entry) => entry.item?.weapon !== 'Knife')
      .map((entry) => ({ itemId: entry.itemId, rarity: entry.rarity }))
  })).filter((collection) => collection.items.length > 0);
  return {
    items: ITEMS,
    rarities: RARITIES,
    cases,
    collections
  };
}

function getCase(id, customCases = []) {
  const caseId = String(id || '');
  if (CASE_BY_ID.has(caseId)) return CASE_BY_ID.get(caseId);
  return sanitizeCaseDefinitions(customCases).find((caseDef) => caseDef.id === caseId) || null;
}

function caseEntriesWithItems(caseDef) {
  const clean = sanitizeCaseDefinition(caseDef);
  return clean.items
    .map((entry) => ({ ...entry, item: getItem(entry.itemId) }))
    .filter((entry) => entry.item && entry.weight > 0);
}

function caseRarityPools(caseDef, entries) {
  const clean = sanitizeCaseDefinition(caseDef);
  if (clean.rarityMode !== 'class') return [];
  return RARITIES.map(({ id }) => ({
    rarity: id,
    // Percentages retain two decimal places for an exact 0.01% roll unit.
    chanceUnits: Math.max(0, Math.round(Number(clean.rarityWeights[id] || 0) * 100)),
    entries: entries.filter(entry => normalizeRarity(entry.rarity || entry.item?.rarity) === id)
  })).filter(group => group.chanceUnits > 0 && group.entries.length > 0);
}

function randomClassEntry(caseDef, entries, randomUnit, randomIndex) {
  const pools = caseRarityPools(caseDef, entries);
  const total = pools.reduce((sum, group) => sum + group.chanceUnits, 0);
  if (!total) return null;
  let roll = randomUnit(total);
  let selected = pools[pools.length - 1];
  for (const group of pools) {
    roll -= group.chanceUnits;
    if (roll < 0) { selected = group; break; }
  }
  return selected.entries[randomIndex(selected.entries.length)] || selected.entries[0] || null;
}

function rollCase(caseId, rng = Math.random, customCases = []) {
  // Generic weighted roll helper. This is suitable for deterministic tests by
  // passing a seeded rng, but public/persistent rewards should use the secure
  // rollPrototypeCase or rollCaseDefinition path below.
  const caseDef = getCase(caseId, customCases);
  if (!caseDef) return null;
  const entries = caseEntriesWithItems(caseDef);
  const classEntry = randomClassEntry(
    caseDef,
    entries,
    total => Math.min(total - 1, Math.floor(rng() * total)),
    length => Math.min(length - 1, Math.floor(rng() * length))
  );
  if (classEntry) return classEntry.item;
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.item;
  }
  return entries[entries.length - 1]?.item || null;
}

function rollCaseDefinition(caseDef, randomInt) {
  if (typeof randomInt !== 'function') throw new TypeError('A secure integer RNG is required');
  const entries = caseEntriesWithItems(caseDef);
  const classEntry = randomClassEntry(caseDef, entries, randomInt, randomInt);
  if (classEntry) {
    const tier = normalizeRarity(classEntry.rarity || classEntry.item.rarity);
    return { item: classEntry.item, tier, gold: tier === 'mythic' };
  }
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return null;
  let roll = randomInt(total);
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) {
      const tier = normalizeRarity(entry.rarity || entry.item.rarity);
      return { item: entry.item, tier, gold: tier === 'mythic' };
    }
  }
  const fallback = entries[entries.length - 1];
  const tier = normalizeRarity(fallback.rarity || fallback.item.rarity);
  return { item: fallback.item, tier, gold: tier === 'mythic' };
}

function rollPrototypeCase(randomInt) {
  // Secure server-side case roll. Mythic is exactly 1/GOLD_ROLL_DENOMINATOR and
  // pulls only from knife item ids.
  if (typeof randomInt !== 'function') throw new TypeError('A secure integer RNG is required');
  const gold = randomInt(GOLD_ROLL_DENOMINATOR) === 0;
  const pool = gold ? MYTHIC_KNIFE_ITEM_IDS : STANDARD_CASE_ITEM_IDS;
  const item = getItem(pool[randomInt(pool.length)]);
  return item ? { item, tier: gold ? 'mythic' : normalizeRarity(item.rarity), gold } : null;
}

function buildCaseReel(result, randomInt, { length = 40, winningIndex = 34, caseDef = null } = {}) {
  // Cosmetic reel for the client animation. The awarded item is already decided
  // by the server roll; the reel is presentation, not RNG authority.
  if (!result?.item || typeof randomInt !== 'function') return null;
  const safeLength = Math.max(24, Math.min(60, Number(length) || 40));
  const safeWinner = Math.max(16, Math.min(safeLength - 3, Number(winningIndex) || 34));
  let fillerEntries = [];
  try {
    fillerEntries = caseDef
      ? caseEntriesWithItems(caseDef)
      : STANDARD_CASE_ITEM_IDS.map((itemId) => {
        const item = getItem(itemId);
        return { itemId, item, rarity: item?.rarity || 'common', weight: 1 };
      }).filter((entry) => entry.item);
  } catch {
    fillerEntries = [];
  }
  // Mythics are a reveal, not reel filler. A knife only appears in the final
  // winning slot when the authoritative roll actually awarded that knife.
  fillerEntries = fillerEntries.filter((entry) => normalizeRarity(entry.rarity || entry.item?.rarity) !== 'mythic');
  if (!fillerEntries.length) {
    fillerEntries = STANDARD_CASE_ITEM_IDS.map((itemId) => {
      const item = getItem(itemId);
      return { itemId, item, rarity: item?.rarity || 'common', weight: 1 };
    }).filter((entry) => entry.item);
  }
  if (!fillerEntries.length) return null;
  const reel = [];
  for (let i = 0; i < safeLength; i++) {
    const entry = i === safeWinner ? null : fillerEntries[randomInt(fillerEntries.length)];
    const item = i === safeWinner ? result.item : entry.item;
    const rarity = i === safeWinner ? result.tier : normalizeRarity(entry.rarity || item.rarity);
    const gold = i === safeWinner && result.gold;
    reel.push({ itemId: item.id, displayName: item.displayName, weapon: item.weapon, rarity, gold });
  }
  return { reel, winningIndex: safeWinner };
}

module.exports = {
  RARITIES,
  ITEMS,
  CASES,
  PROTOTYPE_CASE_ID,
  GOLD_ROLL_DENOMINATOR,
  CASE_DESIGNS,
  DEFAULT_KNIFE_ITEM_IDS,
  KNIFE_ITEM_IDS,
  STARTER_ITEM_IDS,
  normalizeRarity,
  rarityDisplayName,
  sanitizeCaseDefinition,
  sanitizeCaseDefinitions,
  publicCatalog,
  caseAvailability,
  getItem,
  getCase,
  rollCase,
  rollCaseDefinition,
  rollPrototypeCase,
  buildCaseReel
};
