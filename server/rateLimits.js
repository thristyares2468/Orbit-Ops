export class RateLimiter {
  constructor() {
    this.entries = new Map();
  }

  allow(key, limit, windowMs) {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (!entry || now >= entry.expiresAt) {
      this.entries.set(key, { count: 1, expiresAt: now + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  }

  isBlocked(key, limit) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return false;
    }
    return entry.count >= limit;
  }

  recordFailure(key, windowMs) {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (!entry || now >= entry.expiresAt) {
      this.entries.set(key, { count: 1, expiresAt: now + windowMs });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }

  reset(key) {
    this.entries.delete(key);
  }

  cleanup() {
    for (const [key, entry] of this.entries) {
      if (Date.now() >= entry.expiresAt) this.entries.delete(key);
    }
  }
}
