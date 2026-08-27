const HTTP_ORIGIN = /^https?:\/\//iu;
const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/iu;

function normalizeOrigin(value) {
  const candidate = String(value || "").trim();
  if (!candidate || !HTTP_ORIGIN.test(candidate)) return "";
  try {
    const url = new URL(candidate);
    if (!url.hostname || url.username || url.password) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function wildcardPattern(value) {
  const match = String(value || "").trim().match(/^(https?):\/\/\*\.([a-z0-9.-]+)(?::(\d{1,5}))?$/iu);
  if (!match || !match[2] || match[2].startsWith(".") || match[2].endsWith(".")) return null;
  const port = match[3] ? `:${match[3]}` : "";
  return { protocol: `${match[1].toLowerCase()}:`, suffix: `.${match[2].toLowerCase()}${port}` };
}

function configuredEntries(environment) {
  const entries = String(environment.PUBLIC_CLIENT_ORIGINS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (environment.RENDER_EXTERNAL_URL) entries.push(environment.RENDER_EXTERNAL_URL);
  if (environment.RENDER_EXTERNAL_HOSTNAME) entries.push(`https://${environment.RENDER_EXTERNAL_HOSTNAME}`);
  return entries;
}

export function createPublicClientOriginPolicy(environment = process.env) {
  const exact = new Set();
  const wildcards = [];
  for (const entry of configuredEntries(environment)) {
    const wildcard = wildcardPattern(entry);
    if (wildcard) {
      wildcards.push(wildcard);
      continue;
    }
    const normalized = normalizeOrigin(entry);
    if (normalized) exact.add(normalized);
  }

  const development = environment.NODE_ENV !== "production";
  const allows = (origin) => {
    // Non-browser clients and Render's internal probes do not send Origin.
    if (!origin) return true;
    const normalized = normalizeOrigin(origin);
    if (!normalized) return false;
    if (exact.has(normalized)) return true;
    const url = new URL(normalized);
    if (development && LOCAL_HOST.test(url.hostname)) return true;
    const hostWithPort = `${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}`;
    return wildcards.some((pattern) => url.protocol === pattern.protocol && hostWithPort.endsWith(pattern.suffix));
  };

  return Object.freeze({
    exact: Object.freeze([...exact]),
    wildcards: Object.freeze(wildcards.map(({ protocol, suffix }) => `${protocol}//*${suffix}`)),
    allows,
    socketIo(origin, callback) {
      const allowed = allows(origin);
      callback(allowed ? null : new Error("Origin is not allowed."), allowed);
    }
  });
}

export function applyPublicCors(request, response, policy) {
  const origin = String(request.headers.origin || "");
  if (!origin || !policy.allows(origin)) return false;
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Max-Age", "86400");
  response.setHeader("Vary", "Origin");
  return true;
}
