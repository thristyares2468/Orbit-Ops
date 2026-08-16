// Connection shedding, before a socket costs anything.
//
// The per-action rate limiter already protects individual messages, but it only
// runs once a connection exists and has been paid for - the handshake, the TLS
// session, the socket entry. A flood of connections that never authenticate is
// cheap to send and expensive to hold, so it is refused here instead.
//
// Two scopes, because one address is easy to rotate and a rented range is not:
// the address itself, and the /24 (or /64 for IPv6) it sits in.

export const FLOOD_DEFAULTS = Object.freeze({
  // Concurrent connections that have not authenticated yet.
  maxPendingPerAddress: 6,
  maxPendingPerSubnet: 24,
  // Total concurrent connections, authenticated or not.
  maxPerAddress: 12,
  maxPerSubnet: 48,
  // New connections accepted from one address inside the window.
  burst: 30,
  windowMs: 10_000
});

// IPv6 is grouped on its /64 because that is the smallest block normally handed
// to a single customer; IPv4 on its /24 for the same reason.
export function subnetOf(address) {
  const ip = String(address ?? "").trim().toLowerCase();
  if (!ip) return "unknown";
  const mapped = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (mapped.includes(".")) {
    const octets = mapped.split(".");
    return octets.length === 4 ? `${octets[0]}.${octets[1]}.${octets[2]}.0/24` : mapped;
  }
  if (mapped.includes(":")) {
    // Expand only as far as needed to take the first four groups.
    const groups = mapped.split("::")[0].split(":").filter(Boolean).slice(0, 4);
    return `${groups.join(":")}::/64`;
  }
  return mapped;
}

function emptyScope() {
  return { pending: 0, total: 0, recent: [] };
}

export class ConnectionFloodGuard {
  constructor(options = {}) {
    this.limits = { ...FLOOD_DEFAULTS, ...options };
    this.now = options.now ?? (() => Date.now());
    this.addresses = new Map();
    this.subnets = new Map();
  }

  scope(map, key) {
    let entry = map.get(key);
    if (!entry) {
      entry = emptyScope();
      map.set(key, entry);
    }
    return entry;
  }

  // Returns null to admit, or a short reason to refuse. The reason is for the
  // log, never for the client - a flood should learn nothing about the limits.
  admit(address) {
    const now = this.now();
    const key = String(address ?? "unknown");
    const subnetKey = subnetOf(key);
    const perAddress = this.scope(this.addresses, key);
    const perSubnet = this.scope(this.subnets, subnetKey);

    perAddress.recent = perAddress.recent.filter((at) => now - at < this.limits.windowMs);
    if (perAddress.recent.length >= this.limits.burst) return "burst";
    if (perAddress.pending >= this.limits.maxPendingPerAddress) return "pending-address";
    if (perAddress.total >= this.limits.maxPerAddress) return "total-address";
    if (perSubnet.pending >= this.limits.maxPendingPerSubnet) return "pending-subnet";
    if (perSubnet.total >= this.limits.maxPerSubnet) return "total-subnet";

    perAddress.recent.push(now);
    perAddress.pending += 1;
    perAddress.total += 1;
    perSubnet.pending += 1;
    perSubnet.total += 1;
    return null;
  }

  // Signing in moves a connection out of the pending pool, so a legitimate
  // household behind one address is not held to the unauthenticated limit.
  authenticated(address) {
    const key = String(address ?? "unknown");
    const perAddress = this.addresses.get(key);
    const perSubnet = this.subnets.get(subnetOf(key));
    if (perAddress?.pending > 0) perAddress.pending -= 1;
    if (perSubnet?.pending > 0) perSubnet.pending -= 1;
  }

  released(address, { wasAuthenticated = false } = {}) {
    const key = String(address ?? "unknown");
    const perAddress = this.addresses.get(key);
    const perSubnet = this.subnets.get(subnetOf(key));
    for (const [scope, map, mapKey] of [[perAddress, this.addresses, key], [perSubnet, this.subnets, subnetOf(key)]]) {
      if (!scope) continue;
      if (scope.total > 0) scope.total -= 1;
      if (!wasAuthenticated && scope.pending > 0) scope.pending -= 1;
      // Drop the entry once nothing references it and its window has emptied,
      // so a long-running server does not accumulate one per visitor forever.
      if (scope.total === 0 && scope.pending === 0 && scope.recent.length === 0) map.delete(mapKey);
    }
  }

  // Called on a timer. Ages out burst windows and forgets addresses nothing is
  // holding, so a long-running server does not keep one entry per visitor.
  sweep() {
    const now = this.now();
    for (const map of [this.addresses, this.subnets]) {
      for (const [key, scope] of map) {
        scope.recent = scope.recent.filter((at) => now - at < this.limits.windowMs);
        if (scope.total === 0 && scope.pending === 0 && scope.recent.length === 0) map.delete(key);
      }
    }
  }
}
