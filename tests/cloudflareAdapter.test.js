import assert from "node:assert/strict";
import test from "node:test";
import {
  cloudflareHeaders,
  normalizeBackendUrl,
  orbitClientConfig,
  prefixSubdivisionDocument,
  subdivisionClientConfig,
  subdivisionSocketUrl
} from "../scripts/buildCloudflarePages.mjs";
import { applyPublicCors, createPublicClientOriginPolicy } from "../server/publicClientOrigins.js";
import { readFile } from "node:fs/promises";
import { isAllowedStaticClientOrigin } from "../server/jimsGateway.js";

test("Cloudflare backend configuration accepts only a plain HTTP origin", () => {
  assert.equal(normalizeBackendUrl("https://orbit-ops.onrender.com/"), "https://orbit-ops.onrender.com");
  assert.equal(subdivisionSocketUrl("https://orbit-ops.onrender.com"), "wss://orbit-ops.onrender.com/tips/ws");
  assert.throws(() => normalizeBackendUrl(""), /PUBLIC_BACKEND_URL is required/u);
  assert.throws(() => normalizeBackendUrl("javascript:alert(1)"), /plain HTTP\(S\) origin/u);
  assert.throws(() => normalizeBackendUrl("https://orbit-ops.onrender.com/private"), /must not contain a path/u);
});

test("generated public configuration points both games at Render without secrets", () => {
  const orbit = orbitClientConfig("https://orbit-ops.onrender.com");
  const subdivision = subdivisionClientConfig("https://orbit-ops.onrender.com");
  assert.match(orbit, /backendUrl: "https:\/\/orbit-ops\.onrender\.com"/u);
  assert.match(orbit, /subdivisionUrl: "\/tips\/"/u);
  assert.match(subdivision, /multiplayerUrl: "wss:\/\/orbit-ops\.onrender\.com\/tips\/ws"/u);
  assert.match(subdivision, /orbitReturnUrl: "\/"/u);
  assert.doesNotMatch(`${orbit}${subdivision}`, /DATABASE|ADMIN_TOKEN|DEVICE_SECRET/u);
});

test("Subdivision static documents are mounted entirely below /tips", () => {
  const html = prefixSubdivisionDocument(
    '<img src="/assets/ui/test.png"><script src="/client-config.js"></script><a href="/legal#terms">Terms</a><script>navigator.serviceWorker.register(\'/sw.js\')</script>',
    "index.html"
  );
  assert.match(html, /\/tips\/assets\/ui\/test\.png/u);
  assert.match(html, /\/tips\/client-config\.js/u);
  assert.match(html, /\/tips\/legal#terms/u);
  assert.match(html, /register\('\/tips\/sw\.js'\)/u);
  assert.equal(prefixSubdivisionDocument("const p = '/assets/maps/a.glb';", "maps.js"), "const p = '/tips/assets/maps/a.glb';");
});

test("Pages security and cache rules connect only to the configured backend", () => {
  const headers = cloudflareHeaders("https://orbit-ops.onrender.com");
  assert.match(headers, /connect-src 'self' https:\/\/orbit-ops\.onrender\.com wss:\/\/orbit-ops\.onrender\.com/u);
  assert.match(headers, /\/tips\/assets\/\*[\s\S]*max-age=86400, stale-while-revalidate=604800/u);
  assert.match(headers, /\/client-config\.js[\s\S]*Cache-Control: no-store/u);
});

test("Render origin policy allows only its own and configured Pages origins", () => {
  const policy = createPublicClientOriginPolicy({
    NODE_ENV: "production",
    RENDER_EXTERNAL_HOSTNAME: "orbit-ops.onrender.com",
    PUBLIC_CLIENT_ORIGINS: "https://orbit-ops.pages.dev, https://*.orbit-ops.pages.dev"
  });
  assert.equal(policy.allows("https://orbit-ops.pages.dev"), true);
  assert.equal(policy.allows("https://abc123.orbit-ops.pages.dev"), true);
  assert.equal(policy.allows("https://orbit-ops.onrender.com"), true);
  assert.equal(policy.allows("https://evil.pages.dev"), false);
  assert.equal(policy.allows("https://orbit-ops.pages.dev.evil.example"), false);
  assert.equal(policy.allows(undefined), true);
  assert.equal(isAllowedStaticClientOrigin("https://orbit-ops.pages.dev", policy), true);
  assert.equal(isAllowedStaticClientOrigin("https://evil.pages.dev", policy), false);
  // Command-line clients omit Origin; they still need the signed gateway cookie.
  assert.equal(isAllowedStaticClientOrigin(undefined, policy), false);
});

test("health CORS reflects an allowed origin and rejects an unlisted one", () => {
  const policy = createPublicClientOriginPolicy({
    NODE_ENV: "production",
    PUBLIC_CLIENT_ORIGINS: "https://orbit-ops.pages.dev"
  });
  const headers = new Map();
  const response = { setHeader: (name, value) => headers.set(name, value) };
  assert.equal(applyPublicCors({ headers: { origin: "https://orbit-ops.pages.dev" } }, response, policy), true);
  assert.equal(headers.get("Access-Control-Allow-Origin"), "https://orbit-ops.pages.dev");
  assert.equal(applyPublicCors({ headers: { origin: "https://evil.example" } }, response, policy), false);
});

test("the public configuration loads before Phaser, Socket.IO, and the module graph", async () => {
  const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const config = index.indexOf('src="/client-config.js"');
  const socket = index.indexOf('src="/socket.io/socket.io.js"');
  const main = index.indexOf('src="/src/main.js"');
  assert.ok(config > 0 && config < socket && socket < main);
});
