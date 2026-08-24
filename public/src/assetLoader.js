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

  // All at once, not one after another.
  //
  // This used to await each asset in turn, so the group cost the sum of every
  // round trip rather than the longest one - and on a cold instance, where the
  // round trip is the expensive part rather than the bytes, that is most of the
  // wait before anything is playable. The browser already opens several
  // connections; there is no reason to use one of them at a time.
  //
  // Progress still counts completions, so the bar advances as each lands. It no
  // longer reports which asset is in flight, because several are.
  async loadGroup(groupName = "essential") {
    const keys = ASSET_GROUPS[groupName] ?? [];
    this.loadedCount = 0;
    this.totalCount = keys.length;
    const failures = [];
    const report = (key, definition) => this.onProgress({
      key, definition, loaded: this.loadedCount, total: this.totalCount, category: definition.category
    });
    if (keys.length) report(keys[0], ASSET_MANIFEST[keys[0]]);

    const settled = await Promise.all(keys.map(async (key) => {
      const definition = ASSET_MANIFEST[key];
      try {
        await this.load(key, definition.required ? 2 : 0);
        return null;
      } catch (error) {
        this.onError({ key, definition, error });
        return { key, error, required: Boolean(definition.required) };
      } finally {
        this.loadedCount += 1;
        report(key, definition);
      }
    }));

    for (const failure of settled) {
      if (!failure) continue;
      failures.push({ key: failure.key, error: failure.error });
      // A required asset is still fatal - but only after the rest have finished,
      // so one bad file cannot cancel the others mid-flight.
      if (failure.required) throw failure.error;
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
