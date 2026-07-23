export class RateLimiter {
  constructor() {
    this.entries = new Map();
  }

  allow(key, limit, windowMs) {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (!entry || now - entry.startedAt >= windowMs) {
      this.entries.set(key, { startedAt: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  }

  cleanup() {
    const cutoff = Date.now() - 5 * 60_000;
    for (const [key, entry] of this.entries) {
      if (entry.startedAt < cutoff) this.entries.delete(key);
    }
  }
}
