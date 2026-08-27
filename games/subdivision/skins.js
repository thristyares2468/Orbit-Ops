// Last updated: 13 August 2026
// skins.js - hidden skin/case registry used by the backend and future UI.

const IMPORTED_SKINS = require('./skins_imported');

const RARITIES = Object.freeze([
  { id: 'common', displayName: 'Common', color: '#557ee8' },
  { id: 'rare', displayName: 'Rare', color: '#8e4de8' },
  { id: 'epic', displayName: 'Epic', color: '#e652a0' },
  { id: 'legendary', displayName: 'Legendary', color: '#d84b4b' },
  { id: 'mythic', displayName: 'Mythic', color: '#e6b63d', knifeOnly: true }
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
  ['ak47_ice_coaled', 'AK-47 | Ice Coaled', 'common', 'ice_coaled', 'ice_coaled', AK47_PRIM1],
  ['ak47_nightwish', 'AK-47 | Nightwish', 'legendary', 'nightwish', 'nightwish_akwrap', AK47_PRIM1],
  ['ak47_anubis', 'AK-47 | Anubis', 'epic', 'anubis', 'anubis_akwrap', AK47_PRIM1],
  ['ak47_asiimov', 'AK-47 | Asiimov', 'legendary', 'asiimov', 'asiimov_akwrap', AK47_PRIM1],
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
  ['awp_asiimov', 'AWP | Asiimov', 'legendary', 'asiimov', AWP_PRIM1],
  ['awp_crakow', 'AWP | Crakow!', 'epic', 'crakow', AWP_PRIM2],
  ['awp_bingle', 'AWP | Bingle', 'legendary', 'bingle', AWP_PRIM2],
  ['awp_desert_hydra', 'AWP | Desert Hydra', 'legendary', 'desert_hydra', AWP_PRIM1],
  ['awp_dragon_lore', 'AWP | Dragon Lore', 'legendary', 'dragon_lore', AWP_PRIM1],
  ['awp_gungnir', 'AWP | Gungnir', 'legendary', 'gungnir', AWP_PRIM1],
  ['awp_jog', 'AWP | Jog', 'epic', 'jog', AWP_PRIM2],
  ['awp_neo_noir', 'AWP | Neo-Noir', 'legendary', 'neo_noir', AWP_PRIM1],
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

const SOVEREIGN_FLAME = {
  id: 'awp_sovereign_flame',
  weapon: 'AWP',
  kind: 'skin',
  displayName: 'AWP | Sovereign Flame',
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
  rarity: DEFAULT_KNIFE_ITEM_IDS.includes(id) ? 'common' : 'mythic',
  modelPath: `/assets/skins/knife/${relPath}`
}));

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
    // Firearm rarity belongs to a case drop, not to the reusable catalog skin.
    // Knives are the only catalog items with an intrinsic Mythic/Common tier.
    rarity: item?.weapon === 'Knife' ? normalizeRarity(item.rarity) : null,
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
  SOVEREIGN_FLAME,
  ...FAMAS_VARIANTS,
  ...KNIFE_VARIANTS,
  ...IMPORTED_PUBLIC_SKINS
]).map(enrichCatalogItem));
const ITEM_BY_ID = new Map(ITEMS.map((item) => [item.id, item]));
const KNIFE_ITEM_IDS = Object.freeze(KNIFE_VARIANTS.map((item) => item.id));
const MYTHIC_KNIFE_ITEM_IDS = Object.freeze(KNIFE_VARIANTS.filter((item) => item.rarity === 'mythic').map((item) => item.id));
const STANDARD_CASE_ITEM_IDS = Object.freeze(ITEMS.filter((item) => item.weapon !== 'Knife').map((item) => item.id));
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
  { id: 'warehouse-case', displayName: 'Warehouse Case' }
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
    if (rarity === 'mythic' && item.weapon !== 'Knife') throw new Error('mythic_requires_knife');
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
