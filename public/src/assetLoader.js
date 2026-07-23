import { ASSET_GROUPS, ASSET_MANIFEST } from "./assetManifest.js";

const DEFAULT_TIMEOUT_MS = 12_000;

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

export class AssetLoader {
  constructor({ onProgress = () => {}, onError = () => {} } = {}) {
    this.onProgress = onProgress;
    this.onError = onError;
    this.cache = new Map();
    this.inFlight = new Map();
    this.loadedCount = 0;
    this.totalCount = 0;
  }

  async loadGroup(groupName = "essential") {
    const keys = ASSET_GROUPS[groupName] ?? [];
    this.loadedCount = 0;
    this.totalCount = keys.length;
    const failures = [];
    for (const key of keys) {
      const definition = ASSET_MANIFEST[key];
      this.onProgress({ key, definition, loaded: this.loadedCount, total: this.totalCount, category: definition.category });
      try {
        await this.load(key, definition.required ? 2 : 0);
      } catch (error) {
        failures.push({ key, error });
        this.onError({ key, definition, error });
        if (definition.required) throw error;
      } finally {
        this.loadedCount += 1;
        this.onProgress({ key, definition, loaded: this.loadedCount, total: this.totalCount, category: definition.category });
      }
    }
    return { loaded: this.totalCount - failures.length, total: this.totalCount, failures };
  }

  load(key, retries = 0) {
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const definition = ASSET_MANIFEST[key];
    if (!definition) return Promise.reject(new Error(`Unknown asset key: ${key}`));
    const promise = this.loadDefinition(definition).catch(async (error) => {
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        this.inFlight.delete(key);
        return this.load(key, retries - 1);
      }
      throw error;
    }).then((asset) => {
      this.cache.set(key, asset);
      return asset;
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  loadDefinition(definition) {
    if (definition.type === "texture" || definition.type === "image") {
      return withTimeout(new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Could not load ${definition.path}.`));
        image.src = definition.path;
      }), DEFAULT_TIMEOUT_MS, definition.path);
    }
    if (definition.type === "audio") {
      return withTimeout(fetch(definition.path).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${definition.path}`);
        return response.arrayBuffer();
      }), DEFAULT_TIMEOUT_MS, definition.path);
    }
    throw new Error(`Unsupported asset type: ${definition.type}`);
  }

  get(key) {
    return this.cache.get(key) ?? null;
  }

  dispose(key) {
    this.cache.delete(key);
  }

  disposeOptional() {
    for (const key of ASSET_GROUPS.optional) this.dispose(key);
  }
}
