import { AssetLoader } from "./assetLoader.js";
import { OrbitOpsGame } from "./game.js";
import { NetworkClient } from "./network.js";
import { applyDocumentSettings, loadSettings } from "./settings.js";
import { GameUI } from "./ui.js";

const tips = [
  "Evidence narrows possibilities; it rarely names an Operative outright.",
  "Door logs are delayed and can be corrupted during Security Interference.",
  "Operatives receive believable fake assignments at real task stations.",
  "Critical sabotage must be repaired before an incident meeting can begin.",
  "Dead players become orbital echoes and cannot contact living crew."
];

const settings = loadSettings();
applyDocumentSettings(settings);
const ui = new GameUI();
const network = new NetworkClient();
let game = null;
let assetsReady = false;
let serverReady = false;
let health = { databaseConnected: false, databaseConfigured: false };

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
    const response = await fetch("/health", { cache: "no-store" });
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

document.getElementById("loading-tip").textContent = tips[Math.floor(Math.random() * tips.length)];
document.getElementById("loading-retry").addEventListener("click", loadAssets);
document.getElementById("loading-continue").addEventListener("click", async () => {
  if (!game) game = new OrbitOpsGame({ canvas: document.getElementById("game-canvas"), assets: loader, network, ui, settings });
  ui.enterApp();
  const restored = await game.restoreIdentity();
  if (!restored) ui.showScreen("auth");
});

await Promise.all([loadAssets(), checkHealth()]);
if (network.serverInfo) {
  serverReady = true;
  ui.setLoading({ serverReady, assetsReady, ...health });
}
