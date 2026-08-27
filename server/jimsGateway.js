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

export function isAllowedStaticClientOrigin(origin, publicClientOrigins) {
  const browserOrigin = String(origin || "");
  return Boolean(browserOrigin) && Boolean(publicClientOrigins?.allows(browserOrigin));
}

function cookieValue(request, name) {
  const item = String(request.headers.cookie || "")
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
}

function firstConfigured(environment, primary, legacy) {
  return String(environment[primary] || environment[legacy] || "").trim();
}

export function resolveSubdivisionConfiguration(environment = process.env) {
  return {
    databaseUrl: firstConfigured(environment, "SUBDIVISION_DATABASE_URL", "JIMS_DATABASE_URL"),
    adminToken: firstConfigured(environment, "SUBDIVISION_ADMIN_TOKEN", "JIMS_ADMIN_TOKEN"),
    deviceSecret: firstConfigured(environment, "SUBDIVISION_DEVICE_SECRET", "JIMS_DEVICE_SECRET"),
    mailProvider: firstConfigured(environment, "SUBDIVISION_MAIL_PROVIDER", "JIMS_MAIL_PROVIDER"),
    brevoApiKey: firstConfigured(environment, "SUBDIVISION_BREVO_API_KEY", "JIMS_BREVO_API_KEY"),
    brevoFrom: firstConfigured(environment, "SUBDIVISION_BREVO_FROM", "JIMS_BREVO_FROM"),
    emailReplyTo: firstConfigured(environment, "SUBDIVISION_EMAIL_REPLY_TO", "JIMS_EMAIL_REPLY_TO")
  };
}

export function resolveJimsGameRoot(
  orbitRoot,
  configuredRoot = process.env.SUBDIVISION_GAME_ROOT || process.env.JIMS_GAME_ROOT
) {
  const candidates = [
    configuredRoot,
    join(orbitRoot, "games", "subdivision"),
    join(orbitRoot, ".render", "jims-mowing"),
    join(dirname(orbitRoot), "James-Garden-Care"),
    join(dirname(orbitRoot), "fpsshooterserver", "fpsshooterserver")
  ].filter(Boolean).map((candidate) => resolve(candidate));
  return candidates.find((candidate) => existsSync(join(candidate, "server.js"))) ?? candidates[0];
}

export function createJimsGateway({
  server,
  secret,
  orbitRoot,
  publicClientOrigins = { allows: () => false },
  childPort = Number(process.env.SUBDIVISION_GAME_PORT || process.env.JIMS_GAME_PORT || 3101)
}) {
  const publicPath = JIMS_PUBLIC_PATH;
  const target = `http://127.0.0.1:${childPort}`;
  const gameRoot = resolveJimsGameRoot(orbitRoot);
  const proxy = httpProxy.createProxyServer({ target, ws: true, xfwd: true });
  let child = null;
  let running = false;
  let restartTimer = null;
  let restartAttempt = 0;
  let stopping = false;
  // Why the child is not up. A boot failure here is deterministic - a missing
  // secret, a migration that will not apply - so the gateway retries forever and
  // every attempt fails the same way. Reporting only `running: false` meant the
  // reason existed solely in the platform's log stream, which is the one place
  // you cannot reach from a browser when the game is down.
  let lastExit = null;
  let lastStderr = "";

  const readiness = () => {
    const configuration = resolveSubdivisionConfiguration();
    return ({
      available: Boolean(gameRoot && existsSync(join(gameRoot, "server.js"))),
      running,
      productionSecretsReady: Boolean(configuration.databaseUrl && configuration.adminToken && configuration.deviceSecret),
      requiredVariables: [
        ["SUBDIVISION_DATABASE_URL", configuration.databaseUrl],
        ["SUBDIVISION_ADMIN_TOKEN", configuration.adminToken],
        ["SUBDIVISION_DEVICE_SECRET", configuration.deviceSecret]
      ].filter(([, value]) => !value).map(([name]) => name),
      restartAttempt,
      // Diagnostics only: the child's own last words and how it died. No secret is
      // echoed here - the child prints connection errors, not connection strings.
      lastExit,
      lastError: lastStderr
    });
  };

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

  // The room handoff a cross-server invite arrives with. Shape only: the token is
  // validated and consumed by the game itself against the shared database, which
  // this gateway has no business duplicating.
  const handoffToken = (request) => {
    const value = String(request.query?.handoff ?? "");
    return /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : "";
  };

  // One place mints the access cookie, so the two doors cannot drift apart.
  const grantAccess = (response) => {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    const token = encodeURIComponent(createJimsAccessToken(secret));
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Set-Cookie", `${JIMS_ACCESS_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=${publicPath}; Max-Age=${ACCESS_LIFETIME_SECONDS}${secure}`);
  };

  const launch = (request, response) => {
    if (!gameRoot || !existsSync(join(gameRoot, "server.js"))) return unavailable(response);
    grantAccess(response);
    // Carry a cross-server room handoff through the door. The embedded game is
    // reachable only with the access cookie, so a player sent here from the
    // standalone deployment has to pass this route to get one - and the redirect
    // used to drop the query, which turned an invite into "you are logged in,
    // now find the room yourself".
    //
    // Only this one parameter is forwarded, and only in the shape the game will
    // accept, so the route cannot be used to smuggle arbitrary query into the
    // embedded client.
    const handoff = handoffToken(request);
    response.redirect(302, `${publicPath}/${handoff ? `?handoff=${encodeURIComponent(handoff)}` : ""}`);
  };

  const middleware = (request, response) => {
    if (!authorized(request)) {
      // A player handed off from the standalone deployment has never been through
      // the front door, so carries no cookie - and 404ing them made /tips unusable
      // as an arrival address, which is the obvious thing to advertise. An invite
      // carries a one-time room handoff, so admit that and mint the cookie here.
      //
      // This is no weaker than the door already is: the launch route is itself
      // unauthenticated, so anyone who knows either URL gets in. What stops a
      // stranger reaching somebody's room is the token, which the game checks
      // against the shared database and can only spend once.
      if (!handoffToken(request)) return response.status(404).send("Not found");
      grantAccess(response);
    }
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
    // Cloudflare Pages deliberately serves only the public client. Its browser
    // cannot receive the same-origin /tips cookie, so an explicitly allowlisted
    // Pages origin is the equivalent front door for WebSocket upgrades. The
    // child still requires account or guest authentication before gameplay.
    const allowedStaticClient = isAllowedStaticClientOrigin(request.headers.origin, publicClientOrigins);
    if ((!authorized(request) && !allowedStaticClient) || !running) {
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
      if (!gameRoot || !existsSync(join(gameRoot, "server.js"))) {
        // A refusal to spawn leaves no child to report its own death, so the
        // reason has to be recorded here or readiness() says nothing at all.
        lastExit = "not-started: bundled Subdivision source is unavailable";
        console.warn("[subdivision-gateway] Bundled Subdivision source is unavailable.");
      }
      return;
    }
    const configuration = resolveSubdivisionConfiguration();
    const productionSecretsReady = Boolean(
      configuration.databaseUrl && configuration.adminToken && configuration.deviceSecret
    );
    if (process.env.NODE_ENV === "production" && !productionSecretsReady) {
      lastExit = "not-started: missing SUBDIVISION_* secrets";
      console.warn("[subdivision-gateway] Subdivision is disabled until its database, admin, and device secrets are configured.");
      return;
    }
    stopping = false;
    const spawnedChild = spawn(process.execPath, ["server.js"], {
      cwd: gameRoot,
      env: {
        ...process.env,
        PORT: String(childPort),
        PUBLIC_BASE_PATH: publicPath,
        DATABASE_URL: configuration.databaseUrl,
        DATABASE_POOL_MAX: process.env.SUBDIVISION_DATABASE_POOL_MAX || process.env.JIMS_DATABASE_POOL_MAX || "6",
        DATABASE_CONNECT_TIMEOUT_MS: process.env.SUBDIVISION_DATABASE_CONNECT_TIMEOUT_MS || process.env.JIMS_DATABASE_CONNECT_TIMEOUT_MS || "15000",
        DATABASE_IDLE_TIMEOUT_MS: process.env.SUBDIVISION_DATABASE_IDLE_TIMEOUT_MS || process.env.JIMS_DATABASE_IDLE_TIMEOUT_MS || "60000",
        DATABASE_QUERY_TIMEOUT_MS: process.env.SUBDIVISION_DATABASE_QUERY_TIMEOUT_MS || process.env.JIMS_DATABASE_QUERY_TIMEOUT_MS || "12000",
        DATABASE_MAX_LIFETIME_SECONDS: process.env.SUBDIVISION_DATABASE_MAX_LIFETIME_SECONDS || process.env.JIMS_DATABASE_MAX_LIFETIME_SECONDS || "900",
        DATABASE_APPLICATION_NAME: "orbit-ops-subdivision-embedded",
        ADMIN_TOKEN: configuration.adminToken || "local-subdivision-admin-token",
        DEVICE_SECRET: configuration.deviceSecret || "local-subdivision-device-secret",
        MAIL_PROVIDER: configuration.mailProvider,
        BREVO_API_KEY: configuration.brevoApiKey,
        BREVO_FROM: configuration.brevoFrom,
        EMAIL_REPLY_TO: configuration.emailReplyTo,
        // Both games now run behind this process. Do not let Render's inherited
        // public URL turn the retired cross-host lobby directory back on inside
        // the child process.
        CROSS_SERVER_PUBLIC_URL: "",
        RENDER_EXTERNAL_URL: "",
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
        lastExit = null;
        lastStderr = "";
      }
      process.stdout.write(`[jims] ${chunk}`);
    });
    spawnedChild.stderr.on("data", (chunk) => {
      // Keep the tail rather than the whole stream: the useful line is the last
      // one, and an unbounded buffer on a crash loop is its own problem.
      lastStderr = `${lastStderr}${chunk}`.slice(-600);
      process.stderr.write(`[jims] ${chunk}`);
    });
    const childStopped = (reason) => {
      if (settled) return;
      settled = true;
      running = false;
      lastExit = String(reason);
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
    readiness,
    start,
    stop,
    get available() { return Boolean(gameRoot && existsSync(join(gameRoot, "server.js"))); },
    get running() { return running; }
  };
}
