import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import httpProxy from "http-proxy";

export const JIMS_PUBLIC_PATH = "/tips";
export const JIMS_ACCESS_COOKIE = "orbitOps.jimsAccess";
const ACCESS_LIFETIME_SECONDS = 6 * 60 * 60;

function digest(value, secret) {
  return createHmac("sha256", String(secret || "orbit-ops-local-jims-gateway"))
    .update(String(value))
    .digest("base64url");
}

export function createJimsAccessToken(secret, now = Date.now()) {
  const expiresAt = Math.floor(now / 1000) + ACCESS_LIFETIME_SECONDS;
  return `${expiresAt}.${digest(expiresAt, secret)}`;
}

export function verifyJimsAccessToken(token, secret, now = Date.now()) {
  const [expiresText, suppliedSignature] = String(token || "").split(".");
  const expiresAt = Number(expiresText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < Math.floor(now / 1000) || !suppliedSignature) return false;
  const expected = Buffer.from(digest(expiresAt, secret));
  const supplied = Buffer.from(suppliedSignature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function cookieValue(request, name) {
  const item = String(request.headers.cookie || "")
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
}

export function publicOrigin(request) {
  const protocol = String(request.headers["x-forwarded-proto"] || "http").split(",")[0].trim().toLowerCase() === "https"
    ? "https"
    : "http";
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "").split(",")[0].trim();
  // This header is sent only to the child process over loopback. Reject header
  // injection and malformed Host values before it can ever enter an email.
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) return "";
  return `${protocol}://${host}`;
}

export function resolveJimsGameRoot(orbitRoot, configuredRoot = process.env.JIMS_GAME_ROOT) {
  const candidates = [
    configuredRoot,
    join(orbitRoot, ".render", "jims-mowing"),
    join(dirname(orbitRoot), "James-Garden-Care"),
    join(dirname(orbitRoot), "fpsshooterserver", "fpsshooterserver")
  ].filter(Boolean).map((candidate) => resolve(candidate));
  return candidates.find((candidate) => existsSync(join(candidate, "server.js"))) ?? candidates[0];
}

export function createJimsGateway({ server, secret, orbitRoot, childPort = Number(process.env.JIMS_GAME_PORT || 3101) }) {
  const publicPath = JIMS_PUBLIC_PATH;
  const target = `http://127.0.0.1:${childPort}`;
  const gameRoot = resolveJimsGameRoot(orbitRoot);
  const proxy = httpProxy.createProxyServer({ target, ws: true, xfwd: true });
  let child = null;
  let running = false;

  proxy.on("proxyReq", (proxyRequest, request) => {
    const origin = publicOrigin(request);
    if (origin) proxyRequest.setHeader("X-Orbit-Ops-Public-Origin", origin);
  });

  const authorized = (request) => verifyJimsAccessToken(cookieValue(request, JIMS_ACCESS_COOKIE), secret);
  const unavailable = (response) => response.status(503).json({ error: "The hidden transmission is currently offline." });

  proxy.on("error", (error, _request, responseOrSocket) => {
    console.error(`[jims-gateway] ${error.message}`);
    if (typeof responseOrSocket?.writeHead === "function") {
      if (!responseOrSocket.headersSent) responseOrSocket.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      responseOrSocket.end("The hidden transmission could not be reached.");
    } else {
      responseOrSocket?.destroy?.();
    }
  });

  const launch = (_request, response) => {
    if (!gameRoot || !existsSync(join(gameRoot, "server.js"))) return unavailable(response);
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    const token = encodeURIComponent(createJimsAccessToken(secret));
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Set-Cookie", `${JIMS_ACCESS_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=${publicPath}; Max-Age=${ACCESS_LIFETIME_SECONDS}${secure}`);
    response.redirect(302, `${publicPath}/`);
  };

  const middleware = (request, response) => {
    if (!authorized(request)) return response.status(404).send("Not found");
    if (!running) return unavailable(response);
    proxy.web(request, response);
  };

  const handleUpgrade = (request, socket, head) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname !== `${publicPath}/ws`) return;
    if (!authorized(request) || !running) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    request.url = "/" + url.search;
    proxy.ws(request, socket, head);
  };
  server.prependListener("upgrade", handleUpgrade);

  const start = () => {
    if (process.env.NODE_ENV === "test" || process.env.DISABLE_JIMS_GAME === "1") return;
    if (child || !gameRoot || !existsSync(join(gameRoot, "server.js"))) {
      if (!gameRoot || !existsSync(join(gameRoot, "server.js"))) console.warn("[jims-gateway] Jim's game source is unavailable; run npm run jims:sync.");
      return;
    }
    const productionSecretsReady = Boolean(
      process.env.JIMS_DATABASE_URL && process.env.JIMS_ADMIN_TOKEN && process.env.JIMS_DEVICE_SECRET
    );
    if (process.env.NODE_ENV === "production" && !productionSecretsReady) {
      console.warn("[jims-gateway] Jim's game is disabled until its three JIMS_* secrets are configured.");
      return;
    }
    child = spawn(process.execPath, ["server.js"], {
      cwd: gameRoot,
      env: {
        ...process.env,
        PORT: String(childPort),
        PUBLIC_BASE_PATH: publicPath,
        DATABASE_URL: process.env.JIMS_DATABASE_URL || "",
        ADMIN_TOKEN: process.env.JIMS_ADMIN_TOKEN || "local-jims-admin-token",
        DEVICE_SECRET: process.env.JIMS_DEVICE_SECRET || "local-jims-device-secret",
        MAIL_PROVIDER: process.env.JIMS_MAIL_PROVIDER || "",
        BREVO_API_KEY: process.env.JIMS_BREVO_API_KEY || "",
        BREVO_FROM: process.env.JIMS_BREVO_FROM || "",
        EMAIL_REPLY_TO: process.env.JIMS_EMAIL_REPLY_TO || "",
        PUBLIC_APP_ORIGIN: process.env.JIMS_PUBLIC_APP_ORIGIN || "",
        NODE_ENV: process.env.NODE_ENV === "production" ? "production" : "development"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk) => {
      const output = String(chunk);
      if (output.includes("Server running at")) running = true;
      process.stdout.write(`[jims] ${chunk}`);
    });
    child.stderr.on("data", (chunk) => process.stderr.write(`[jims] ${chunk}`));
    child.once("exit", (code, signal) => {
      running = false;
      child = null;
      console.warn(`[jims-gateway] child stopped (${signal || code || 0}).`);
    });
  };

  const stop = () => {
    server.removeListener("upgrade", handleUpgrade);
    proxy.close();
    if (child && !child.killed) child.kill("SIGTERM");
    child = null;
    running = false;
  };

  return {
    publicPath,
    launch,
    middleware,
    start,
    stop,
    get available() { return Boolean(gameRoot && existsSync(join(gameRoot, "server.js"))); },
    get running() { return running; }
  };
}
