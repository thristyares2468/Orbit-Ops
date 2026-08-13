import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import httpProxy from "http-proxy";

export const JIMS_PUBLIC_PATH = "/tips";
export const JIMS_ACCESS_COOKIE = "orbitOps.jimsAccess";
const ACCESS_LIFETIME_SECONDS = 6 * 60 * 60;
const RESTART_MIN_MS = 1000;
const RESTART_MAX_MS = 30000;

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
  let restartTimer = null;
  let restartAttempt = 0;
  let stopping = false;

  const readiness = () => ({
    available: Boolean(gameRoot && existsSync(join(gameRoot, "server.js"))),
    running,
    productionSecretsReady: Boolean(process.env.JIMS_DATABASE_URL && process.env.JIMS_ADMIN_TOKEN && process.env.JIMS_DEVICE_SECRET),
    requiredVariables: ["JIMS_DATABASE_URL", "JIMS_ADMIN_TOKEN", "JIMS_DEVICE_SECRET"].filter((name) => !process.env[name])
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

  const health = (_request, response) => {
    // Configuration state only: no connection string or secret is exposed.
    response.setHeader("Cache-Control", "no-store");
    response.status(running ? 200 : 503).json(readiness());
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

  const scheduleRestart = () => {
    if (stopping || restartTimer || process.env.NODE_ENV === "test" || process.env.DISABLE_JIMS_GAME === "1") return;
    const delay = Math.min(RESTART_MAX_MS, RESTART_MIN_MS * (2 ** restartAttempt));
    restartAttempt += 1;
    console.warn(`[jims-gateway] restarting child in ${delay}ms.`);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      start();
    }, delay);
    restartTimer.unref();
  };

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
    stopping = false;
    const spawnedChild = spawn(process.execPath, ["server.js"], {
      cwd: gameRoot,
      env: {
        ...process.env,
        PORT: String(childPort),
        PUBLIC_BASE_PATH: publicPath,
        DATABASE_URL: process.env.JIMS_DATABASE_URL || "",
        DATABASE_POOL_MAX: process.env.JIMS_DATABASE_POOL_MAX || "6",
        DATABASE_CONNECT_TIMEOUT_MS: process.env.JIMS_DATABASE_CONNECT_TIMEOUT_MS || "15000",
        DATABASE_IDLE_TIMEOUT_MS: process.env.JIMS_DATABASE_IDLE_TIMEOUT_MS || "60000",
        DATABASE_QUERY_TIMEOUT_MS: process.env.JIMS_DATABASE_QUERY_TIMEOUT_MS || "12000",
        DATABASE_MAX_LIFETIME_SECONDS: process.env.JIMS_DATABASE_MAX_LIFETIME_SECONDS || "900",
        DATABASE_APPLICATION_NAME: "orbit-ops-embedded",
        ADMIN_TOKEN: process.env.JIMS_ADMIN_TOKEN || "local-jims-admin-token",
        DEVICE_SECRET: process.env.JIMS_DEVICE_SECRET || "local-jims-device-secret",
        MAIL_PROVIDER: process.env.JIMS_MAIL_PROVIDER || "",
        BREVO_API_KEY: process.env.JIMS_BREVO_API_KEY || "",
        BREVO_FROM: process.env.JIMS_BREVO_FROM || "",
        EMAIL_REPLY_TO: process.env.JIMS_EMAIL_REPLY_TO || "",
        NODE_ENV: process.env.NODE_ENV === "production" ? "production" : "development"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child = spawnedChild;
    let settled = false;
    spawnedChild.stdout.on("data", (chunk) => {
      const output = String(chunk);
      if (output.includes("Server running at")) {
        running = true;
        restartAttempt = 0;
      }
      process.stdout.write(`[jims] ${chunk}`);
    });
    spawnedChild.stderr.on("data", (chunk) => process.stderr.write(`[jims] ${chunk}`));
    const childStopped = (reason) => {
      if (settled) return;
      settled = true;
      running = false;
      if (child === spawnedChild) child = null;
      console.warn(`[jims-gateway] child stopped (${reason}).`);
      scheduleRestart();
    };
    spawnedChild.once("error", (error) => childStopped(error.message));
    spawnedChild.once("exit", (code, signal) => childStopped(signal || code || 0));
  };

  const stop = () => {
    stopping = true;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
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
    health,
    start,
    stop,
    get available() { return Boolean(gameRoot && existsSync(join(gameRoot, "server.js"))); },
    get running() { return running; }
  };
}
