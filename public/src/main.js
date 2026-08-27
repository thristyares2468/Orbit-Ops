import { AssetLoader } from "./assetLoader.js";
import { NetworkClient } from "./network.js";
import { applyDocumentSettings, loadSettings } from "./settings.js";
import { GameUI } from "./ui.js";

const settings = loadSettings();
applyDocumentSettings(settings);
const ui = new GameUI();
const network = new NetworkClient();
let game = null;
let assetsReady = false;
let serverReady = false;
let health = { databaseConnected: false, databaseConfigured: false };
const clientConfig = window.ORBIT_OPS_CLIENT_CONFIG || {};
const backendUrl = String(clientConfig.backendUrl || "").trim().replace(/\/+$/u, "");

function backendPath(path) {
  return backendUrl ? `${backendUrl}${path}` : path;
}

function updateServiceStrip() {
  const serverStatus = document.getElementById("auth-server-status");
  const databaseStatus = document.getElementById("auth-db-status");
  if (serverStatus) serverStatus.textContent = serverReady ? "Server online" : "Server reconnecting";
  if (databaseStatus) {
    databaseStatus.textContent = health.databaseConnected
      ? "Database connected"
      : health.databaseConfigured ? "Database unavailable" : "Guest mode available";
  }
}

const loader = new AssetLoader({
  onProgress: ({ key, definition, loaded, total, category }) => {
    ui.setLoading({ progress: total ? loaded / total : 0, category: `Loading ${category}`, asset: definition?.path ?? key, assetsReady, serverReady, ...health });
  },
  onError: ({ error }) => ui.setLoading({ error: error.message, assetsReady, serverReady, ...health })
});

// A deploy before the player has even entered costs nothing to take.
network.on("server:updated", () => {
  if (!game) window.location.reload();
});
network.on("server:ready", (info) => {
  serverReady = true;
  health.databaseConfigured = info.databaseConfigured;
  ui.setLoading({ serverReady, assetsReady, ...health });
  updateServiceStrip();
});
network.on("network:connected", () => { serverReady = Boolean(network.serverInfo); ui.setLoading({ serverReady, assetsReady, ...health }); updateServiceStrip(); });
network.on("network:disconnected", () => { serverReady = false; ui.setLoading({ serverReady, assetsReady, ...health }); updateServiceStrip(); });

async function checkHealth() {
  try {
    const response = await fetch(backendPath("/health"), { cache: "no-store" });
    if (!response.ok) throw new Error(`Health endpoint returned ${response.status}.`);
    health = await response.json();
  } catch {
    health = { databaseConnected: false, databaseConfigured: network.serverInfo?.databaseConfigured ?? false };
  }
  ui.setLoading({ serverReady, assetsReady, ...health });
  updateServiceStrip();
}

async function loadAssets() {
  try {
    await loader.loadGroup("essential");
    assetsReady = true;
    ui.setLoading({ progress: 1, category: "Meridian systems ready", asset: "Essential assets loaded", assetsReady, serverReady, ...health });
  } catch (error) {
    assetsReady = false;
    ui.setLoading({ error: error.message, assetsReady, serverReady, ...health });
  }
}

document.getElementById("loading-retry").addEventListener("click", loadAssets);
// game.js pulls in the whole Phaser scene graph, and evaluating that module needs
// the Phaser global. Importing it here rather than at the top means the menu is
// built and interactive without any of it - the cost is paid by the player who
// chooses Orbit Ops, at the moment they choose it, not by everyone on arrival.
document.getElementById("loading-continue").addEventListener("click", async () => {
  const button = document.getElementById("loading-continue");
  if (button.dataset.busy) return;
  button.dataset.busy = "1";
  try {
    if (!game) {
      const { OrbitOpsGame } = await import("./game.js");
      game = new OrbitOpsGame({ canvas: document.getElementById("game-canvas"), assets: loader, network, ui, settings });
    }
    ui.enterApp();
    const restored = await game.restoreIdentity();
    if (!restored) ui.showScreen("auth");
  } catch (error) {
    ui.setLoading({ error: `Could not start Orbit Ops: ${error.message}`, assetsReady, serverReady, ...health });
  } finally {
    delete button.dataset.busy;
  }
});
// Render keeps the signed same-origin launch route. A Cloudflare build replaces
// this with its static /tips/ path; the Subdivision client then opens its socket
// directly to the allowlisted Render backend.
document.getElementById("loading-subdivision").addEventListener("click", () => {
  window.location.assign(String(clientConfig.subdivisionUrl || "/easter-egg/jims-launch"));
});

await Promise.all([loadAssets(), checkHealth()]);
if (network.serverInfo) {
  serverReady = true;
  ui.setLoading({ serverReady, assetsReady, ...health });
}
