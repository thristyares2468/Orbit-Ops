import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server as SocketIOServer } from "socket.io";
import { checkDatabaseHealth, closeDatabase, isDatabaseConfigured } from "./database/database.js";
import { provisionConfiguredOwner } from "./database/ownerProvisioning.js";
import { SERVER_VERSION } from "./server/constants.js";
import { GameServer } from "./server/gameServer.js";
import { createJimsGateway } from "./server/jimsGateway.js";

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  maxHttpBufferSize: 64 * 1024,
  pingInterval: 10_000,
  pingTimeout: 8_000,
  perMessageDeflate: { threshold: 1024 }
});

app.disable("x-powered-by");
app.use((request, response, next) => {
  const jimsRequest = request.path === "/tips" || request.path.startsWith("/tips/");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader(
    "Content-Security-Policy",
    jimsRequest
      ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob: https://cdn.jsdelivr.net ws: wss:; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  );
  next();
});
app.use(express.json({ limit: "32kb" }));

const jimsGateway = createJimsGateway({
  server,
  secret: process.env.SESSION_SECRET,
  orbitRoot: here
});

app.get("/easter-egg/jims-launch", jimsGateway.launch);
app.get("/easter-egg/jims-health", jimsGateway.health);
app.use(jimsGateway.publicPath, jimsGateway.middleware);

app.use("/vendor/phaser", express.static(join(here, "node_modules", "phaser"), {
  maxAge: process.env.NODE_ENV === "production" ? "30d" : 0,
  immutable: process.env.NODE_ENV === "production"
}));
app.use(express.static(join(here, "public"), {
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  etag: true,
  index: "index.html"
}));

const gameServer = new GameServer(io);
let databaseHealth = false;
let lastDatabaseCheck = 0;

app.get("/health", async (_request, response) => {
  if (Date.now() - lastDatabaseCheck > 10_000) {
    databaseHealth = await checkDatabaseHealth();
    lastDatabaseCheck = Date.now();
  }
  response.json({
    status: "ok",
    databaseConnected: databaseHealth,
    databaseConfigured: isDatabaseConfigured(),
    connectedPlayers: gameServer.connectedPlayers,
    activeRooms: gameServer.activeRooms,
    uptime: Math.round(process.uptime()),
    serverVersion: SERVER_VERSION,
    jimsGameAvailable: jimsGateway.available,
    jimsGameRunning: jimsGateway.running,
    // The hidden game's own health route answers 503 while it is down, and a 503
    // body is the thing most clients throw away - so when it is down the reason
    // rides along here, on the route that always answers 200.
    ...(jimsGateway.running ? {} : { jimsGame: jimsGateway.readiness() }),
    timestamp: new Date().toISOString()
  });
});

app.get("/*path", (_request, response) => {
  response.sendFile(join(here, "public", "index.html"));
});

app.use((error, _request, response, _next) => {
  console.error("HTTP request failed:", error.message);
  response.status(500).json({ error: "The request could not be completed." });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Orbit Ops server listening on port ${PORT}`);
  if (!isDatabaseConfigured()) console.warn("DATABASE_URL is not configured; guest multiplayer remains available.");
  provisionConfiguredOwner()
    .then((result) => {
      if (result?.found && result.updated) console.log("Configured Orbit Ops owner account.");
      else if (result?.configured && !result.found) console.warn("Configured Orbit Ops owner account was not found; provisioning will retry on restart.");
    })
    .catch((error) => console.error("Configured Orbit Ops owner provisioning failed:", error.message));
});

jimsGateway.start();

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down Orbit Ops.`);
  gameServer.stop();
  jimsGateway.stop();
  io.close();
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export { app, gameServer, io, server };
