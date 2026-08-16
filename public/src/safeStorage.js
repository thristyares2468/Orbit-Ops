// Treat browser storage as untrusted input. Extensions, old builds and manual
// edits can all leave malformed JSON behind; one bad value must not abort boot.
export function readStored(key, fallback = null, storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(key);
    return value === null || value === undefined ? fallback : JSON.parse(value);
  } catch {
    try { storage?.removeItem(key); } catch { /* inaccessible storage is equivalent to empty */ }
    return fallback;
  }
}
