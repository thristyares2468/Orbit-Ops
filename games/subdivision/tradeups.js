// Last updated: 15 July 2026
// Pure Trade Up rules shared by the database transaction and regression tests.
// Collection membership and inventory ownership remain database-authoritative;
// this module only validates rarity/float rules and selects an outcome.

const crypto = require('crypto');

const RARITY_ORDER = Object.freeze(['common', 'rare', 'epic', 'legendary', 'mythic']);
const DEFAULT_KNIFE_IDS = new Set(['knife_default_ct_vanilla', 'knife_default_t_vanilla']);

function normalizeTradeUpRarity(value) {
  const rarity = String(value || '').trim().toLowerCase();
  return RARITY_ORDER.includes(rarity) ? rarity : null;
}

function nextRarity(rarity) {
  const normalized = normalizeTradeUpRarity(rarity);
  const index = RARITY_ORDER.indexOf(normalized);
  return index >= 0 && index < RARITY_ORDER.length - 1 ? RARITY_ORDER[index + 1] : null;
}

function requiredInputCount(rarity) {
  const normalized = normalizeTradeUpRarity(rarity);
  if (normalized === 'legendary') return 5;
  return ['common', 'rare', 'epic'].includes(normalized) ? 10 : 0;
}

function floatRangeForDefinition(definition = {}) {
  const rawMinimum = Number(definition.minimumFloat ?? definition.minimum_float ?? 0);
  const rawMaximum = Number(definition.maximumFloat ?? definition.maximum_float ?? 1);
  const minimumFloat = Math.max(0, Math.min(1, Number.isFinite(rawMinimum) ? rawMinimum : 0));
  const maximumFloat = Math.max(minimumFloat, Math.min(1, Number.isFinite(rawMaximum) ? rawMaximum : 1));
  return { minimumFloat, maximumFloat };
}

function normalizedInputFloat(input, definition) {
  const { minimumFloat, maximumFloat } = floatRangeForDefinition(definition);
  const range = maximumFloat - minimumFloat;
  if (range <= 0) return 0;
  const value = Number(input?.wear_value ?? input?.floatValue ?? input?.float_value ?? minimumFloat);
  return Math.max(0, Math.min(1, ((Number.isFinite(value) ? value : minimumFloat) - minimumFloat) / range));
}

function averageNormalizedFloat(inputs, getDefinition) {
  if (!Array.isArray(inputs) || !inputs.length) throw new Error('trade_up_inputs_required');
  const total = inputs.reduce((sum, input) => {
    const definition = getDefinition(input.item_id || input.itemId);
    if (!definition) throw new Error('trade_up_skin_missing');
    return sum + normalizedInputFloat(input, definition);
  }, 0);
  return Math.max(0, Math.min(1, total / inputs.length));
}

function outputFloatForDefinition(averageNormalized, definition) {
  const { minimumFloat, maximumFloat } = floatRangeForDefinition(definition);
  const normalized = Math.max(0, Math.min(1, Number(averageNormalized) || 0));
  return Math.max(minimumFloat, Math.min(maximumFloat, minimumFloat + normalized * (maximumFloat - minimumFloat)));
}

function wearConditionForFloat(value) {
  const wear = Math.max(0, Math.min(1, Number(value) || 0));
  if (wear < 0.07) return 'Factory New';
  if (wear < 0.15) return 'Minimal Wear';
  if (wear < 0.38) return 'Field Tested';
  if (wear < 0.45) return 'Well Worn';
  return 'Battle Scarred';
}

function collectionItems(collection = {}) {
  if (Array.isArray(collection.items)) return collection.items;
  return Array.isArray(collection.items_json) ? collection.items_json : [];
}

function eligibleOutputsForCollection(collection, outputRarity, getDefinition) {
  const targetRarity = normalizeTradeUpRarity(outputRarity);
  if (!targetRarity) return [];
  const seen = new Set();
  const outputs = [];
  for (const entry of collectionItems(collection)) {
    const itemId = String(entry?.itemId || entry?.item_id || entry?.id || '').trim();
    if (!itemId || seen.has(itemId) || normalizeTradeUpRarity(entry?.rarity || entry?.tier) !== targetRarity) continue;
    const definition = getDefinition(itemId);
    if (!definition || definition.tradeUpEligible === false) continue;
    if (targetRarity === 'mythic' && (definition.weapon !== 'Knife' || DEFAULT_KNIFE_IDS.has(itemId))) continue;
    if (targetRarity !== 'mythic' && definition.weapon === 'Knife') continue;
    seen.add(itemId);
    outputs.push(definition);
  }
  return outputs;
}

function collectionSupportsTradeUp(collection, inputRarity, getDefinition) {
  const outputRarity = nextRarity(inputRarity);
  return !!outputRarity && eligibleOutputsForCollection(collection, outputRarity, getDefinition).length > 0;
}

function secureRandomInt(max) {
  return crypto.randomInt(0, Math.max(1, Number(max) || 1));
}

function buildTradeUpOutcome({ inputs, collectionsById, getDefinition, randomInt = secureRandomInt }) {
  if (!Array.isArray(inputs) || !inputs.length) throw new Error('trade_up_inputs_required');
  if (!(collectionsById instanceof Map)) throw new Error('trade_up_collections_required');
  if (typeof getDefinition !== 'function') throw new Error('trade_up_catalog_required');
  if (typeof randomInt !== 'function') throw new Error('trade_up_rng_required');

  const inputRarity = normalizeTradeUpRarity(inputs[0]?.rarity_tier || inputs[0]?.rarityTier);
  const outputRarity = nextRarity(inputRarity);
  const requiredCount = requiredInputCount(inputRarity);
  if (!outputRarity || inputs.length !== requiredCount) throw new Error('trade_up_wrong_count');
  if (inputs.some(input => normalizeTradeUpRarity(input?.rarity_tier || input?.rarityTier) !== inputRarity)) {
    throw new Error('trade_up_mixed_rarity');
  }

  for (const input of inputs) {
    const collectionId = String(input.collection_id || input.collectionId || '').trim();
    const definition = getDefinition(input.item_id || input.itemId);
    if (!collectionId || !definition || definition.tradeUpEligible === false || DEFAULT_KNIFE_IDS.has(definition.id)) {
      throw new Error('trade_up_item_ineligible');
    }
    const collection = collectionsById.get(collectionId);
    if (!collection || !collectionSupportsTradeUp(collection, inputRarity, getDefinition)) {
      throw new Error(inputRarity === 'legendary' ? 'trade_up_mythic_pool_missing' : 'trade_up_collection_ineligible');
    }
  }

  const selectedInput = inputs[randomInt(inputs.length)];
  const selectedCollectionId = String(selectedInput.collection_id || selectedInput.collectionId);
  const selectedCollection = collectionsById.get(selectedCollectionId);
  const outputPool = eligibleOutputsForCollection(selectedCollection, outputRarity, getDefinition);
  if (!outputPool.length) throw new Error('trade_up_output_missing');
  const outputDefinition = outputPool[randomInt(outputPool.length)];
  const averageNormalized = averageNormalizedFloat(inputs, getDefinition);
  const outputFloat = outputFloatForDefinition(averageNormalized, outputDefinition);

  return {
    inputRarity,
    outputRarity,
    requiredCount,
    selectedCollectionId,
    selectedInputInventoryId: selectedInput.id,
    outputDefinition,
    averageNormalizedFloat: averageNormalized,
    outputFloat,
    outputWearCondition: wearConditionForFloat(outputFloat),
    outputPatternSeed: randomInt(1000) + 1,
    outputWearSeed: randomInt(2147483646) + 1
  };
}

module.exports = {
  RARITY_ORDER,
  normalizeTradeUpRarity,
  nextRarity,
  requiredInputCount,
  floatRangeForDefinition,
  normalizedInputFloat,
  averageNormalizedFloat,
  outputFloatForDefinition,
  wearConditionForFloat,
  eligibleOutputsForCollection,
  collectionSupportsTradeUp,
  buildTradeUpOutcome
};
