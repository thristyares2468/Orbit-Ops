import * as THREE from "/vendor/three/build/three.module.js";
import { AudioManager } from "./audio.js";
import { ThirdPersonCamera } from "./camera.js";
import { CharacterView } from "./characterFactory.js";
import { InputController } from "./input.js";
import { TASK_DEFINITIONS, roomAt } from "./shipData.js";
import { TaskInterface } from "./tasks.js";
import { MeridianWorld } from "./world.js";
import { applyDocumentSettings, saveSettings } from "./settings.js";

const SESSION_KEY = "orbitOps.accountSession.v1";
const REJOIN_KEY = "orbitOps.rejoinSession.v1";
const APPEARANCE_KEY = "orbitOps.appearance.v1";

function defaultAppearance() {
  try { return { colour: "cyan", visor: "#9defff", symbol: "orbit", number: 7, accessory: "antenna", ...JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? "{}") }; }
  catch { return { colour: "cyan", visor: "#9defff", symbol: "orbit", number: 7, accessory: "antenna" }; }
}

export class OrbitOpsGame {
  constructor({ canvas, assets, network, ui, settings }) {
    this.canvas = canvas;
    this.assets = assets;
    this.network = network;
    this.ui = ui;
    this.settings = settings;
    this.auth = null;
    this.room = null;
    this.playerId = null;
    this.privateState = null;
    this.latestSnapshots = new Map();
    this.characters = new Map();
    this.currentPhase = "menu";
    this.activeSabotage = null;
    this.nearest = null;
    this.running = true;
    this.lastFrameAt = performance.now();
    this.lastInputSentAt = 0;
    this.frameSamples = [];

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.graphicsQuality !== "low", powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 250);
    this.input = new InputController(canvas, () => this.settings);
    this.audio = new AudioManager(() => this.settings);
    this.cameraController = new ThirdPersonCamera(this.camera, () => this.settings);
    this.world = new MeridianWorld(this.scene, assets, settings);
    this.taskInterface = new TaskInterface(network, this.audio);

    this.applyGraphicsSettings();
    this.bindNetwork();
    this.bindUI();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); this.ui.toast("Graphics context lost. Waiting for recovery…", true); });
    canvas.addEventListener("webglcontextrestored", () => { this.ui.toast("Graphics context restored."); this.applyGraphicsSettings(); });
    requestAnimationFrame((time) => this.frame(time));
  }

  bindNetwork() {
    this.network.on("authenticationResult", (payload) => { if (payload.ok) this.handleAuthenticated(payload); });
    this.network.on("roomJoined", (payload) => this.handleRoomJoined(payload));
    this.network.on("reconnectState", (payload) => {
      this.handleRoomJoined(payload);
      if (payload.restored) this.handlePrivateState(payload.restored);
      this.audio.playCue("reconnect");
    });
    this.network.on("roomState", (room) => this.updateRoom(room));
    this.network.on("matchReset", ({ room }) => { this.currentPhase = "lobby"; this.privateState = null; this.ui.closeGameplayModals(); this.ui.showLobby(room, this.playerId); });
    this.network.on("countdown", () => { this.currentPhase = "countdown"; this.ui.showGame(); });
    this.network.on("roleAssigned", (state) => this.handlePrivateState(state));
    this.network.on("matchStarted", (payload) => { this.currentPhase = "active"; this.ui.showGame(); this.ui.updateTaskProgress(payload.taskProgress); this.input.setEnabled(true); });
    this.network.on("phaseChanged", ({ phase, endsAt }) => { this.currentPhase = phase; this.ui.setPhase(phase, endsAt); if (phase !== "active") this.input.setEnabled(false); });
    this.network.on("worldSnapshot", (snapshot) => this.applyWorldSnapshot(snapshot));
    this.network.on("taskStarted", (payload) => { this.input.setEnabled(false); this.taskInterface.open(payload); this.audio.playCue("interact"); });
    this.network.on("taskCompleted", (payload) => {
      if (this.privateState && !this.privateState.completedTaskIds.includes(payload.taskId)) this.privateState.completedTaskIds.push(payload.taskId);
      if (this.privateState) this.ui.renderTasks(this.privateState.tasks, this.privateState.completedTaskIds);
      this.ui.updateTaskProgress(payload.sharedProgress);
    });
    this.network.on("taskProgress", (progress) => { if (progress.total !== undefined && progress.completed !== undefined) this.ui.updateTaskProgress(progress); });
    this.network.on("sabotageStarted", (sabotage) => { this.activeSabotage = sabotage; this.ui.updateSabotage(sabotage); this.audio.setEmergency(true); this.audio.playCue("alarm"); });
    this.network.on("sabotageUpdated", (sabotage) => { this.activeSabotage = sabotage; this.ui.updateSabotage(sabotage); });
    this.network.on("sabotageEnded", () => { this.activeSabotage = null; this.ui.clearSabotage(); this.audio.setEmergency(false); this.ui.toast("Sabotage resolved."); });
    this.network.on("playerEliminated", ({ playerId }) => { this.audio.playCue("eliminate"); if (playerId === this.playerId && this.privateState) { this.privateState.alive = false; this.ui.toast("Your suit is offline. You are now an orbital echo."); } });
    this.network.on("meetingStarted", (payload) => { this.ui.showMeeting(payload); this.audio.playCue("report"); this.input.setEnabled(false); });
    this.network.on("discussionStarted", ({ endsAt }) => this.ui.setDiscussion(endsAt));
    this.network.on("votingStarted", ({ endsAt }) => this.ui.setVoting(endsAt));
    this.network.on("voteResult", (payload) => { this.ui.showVoteResult(payload); this.audio.playCue("vote"); });
    this.network.on("matchResumed", () => { this.currentPhase = "active"; this.ui.closeModal("meeting"); this.input.setEnabled(true); });
    this.network.on("chatMessage", (payload) => this.ui.appendChat(payload));
    this.network.on("matchEnded", (results) => { this.currentPhase = "results"; this.input.setEnabled(false); this.ui.showResults(results); });
    this.network.on("databaseSaveStatus", (payload) => this.ui.setSaveStatus(payload));
    this.network.on("errorMessage", ({ message }) => this.ui.toast(message, true));
    this.network.on("network:disconnected", () => { if (this.room) this.ui.setConnection(false); });
    this.network.on("network:connected", () => { this.ui.setConnection(true); if (this.auth && this.room) this.resumeRoom().catch(() => {}); });
  }

  bindUI() {
    this.ui.setActions({
      guestLogin: (payload) => this.authenticate("guestLogin", { ...payload, appearance: defaultAppearance() }),
      login: (payload) => this.authenticate("login", { ...payload, appearance: defaultAppearance() }),
      register: (payload) => this.authenticate("register", { ...payload, appearance: defaultAppearance() }),
      logout: () => this.logout(),
      joinPublic: () => this.join("joinPublic"),
      createRoom: (payload) => this.join("createRoom", payload),
      joinRoom: (payload) => this.join("joinRoom", payload),
      leaveRoom: () => this.leaveRoom(),
      ready: (payload) => this.network.request("readyState", payload),
      hostSettings: (payload) => this.network.request("hostSettings", payload),
      practiceRole: (payload) => this.network.request("practiceRole", payload),
      startMatch: () => this.network.request("startMatch"),
      returnLobby: () => this.returnToLobby(),
      chat: (payload) => this.network.request("chatMessage", payload),
      vote: (payload) => this.network.request("submitVote", payload),
      report: () => this.interactWithIncident(),
      primaryAbility: () => this.tryEliminate(),
      sabotage: (payload) => this.network.request("sabotageRequest", payload),
      saveSettings: (payload) => this.applySettings(payload),
      modalChanged: ({ open, name }) => this.onModalChanged(open, name)
    });
    document.getElementById("loading-reconnect").addEventListener("click", () => this.network.reconnect());
  }

  async restoreIdentity() {
    const stored = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    if (stored?.token) {
      try {
        const result = await this.network.request("resumeSession", { token: stored.token, appearance: defaultAppearance() });
        this.handleAuthenticated({ ...result, token: stored.token });
        return true;
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }
    }
    return false;
  }

  async authenticate(event, payload) {
    this.ui.setAuthMessage("Contacting Meridian personnel archive…");
    const result = await this.network.request(event, payload, 12_000);
    this.handleAuthenticated(result);
  }

  handleAuthenticated(result) {
    const account = result.account;
    this.auth = { accountId: account?.id ?? null, displayName: account?.displayName ?? result.displayName, guest: result.guest ?? !account, token: result.token ?? this.auth?.token ?? null };
    if (result.token) localStorage.setItem(SESSION_KEY, JSON.stringify({ token: result.token, expiresAt: result.expiresAt }));
    this.ui.setAuthMessage("Clearance accepted.");
    this.ui.showMainMenu(this.auth);
    this.resumeRoom().catch(() => {});
  }

  async logout() {
    const token = this.auth?.token;
    await this.network.request("logout", { token }).catch(() => {});
    localStorage.removeItem(SESSION_KEY); localStorage.removeItem(REJOIN_KEY);
    this.auth = null; this.room = null; this.playerId = null;
    this.clearCharacters(); this.ui.showScreen("auth");
  }

  async join(event, payload = {}) {
    const result = await this.network.request(event, payload, 10_000);
    this.handleRoomJoined(result);
  }

  handleRoomJoined(payload) {
    if (!payload?.room) return;
    this.playerId = payload.playerId;
    this.room = payload.room;
    this.currentPhase = payload.room.phase;
    if (payload.rejoinToken) localStorage.setItem(REJOIN_KEY, JSON.stringify({ token: payload.rejoinToken, displayName: this.auth?.displayName }));
    this.updateRoom(payload.room);
    if (payload.room.phase === "lobby") this.ui.showLobby(payload.room, this.playerId);
    else this.ui.showGame();
  }

  async resumeRoom() {
    if (!this.auth || !this.network.connected) return false;
    const stored = JSON.parse(localStorage.getItem(REJOIN_KEY) ?? "null");
    if (!stored?.token || stored.displayName !== this.auth.displayName) return false;
    try {
      const result = await this.network.request("resumeRoom", { token: stored.token });
      this.handleRoomJoined(result);
      if (result.restored) this.handlePrivateState(result.restored);
      return true;
    } catch {
      localStorage.removeItem(REJOIN_KEY);
      return false;
    }
  }

  updateRoom(room) {
    if (!room) return;
    this.room = room;
    this.activeSabotage = room.activeSabotage;
    this.ui.updateRoom(room);
    this.syncCharacterMetadata(room.players);
  }

  syncCharacterMetadata(players) {
    const ids = new Set(players.map((player) => player.id));
    for (const player of players) {
      if (!this.characters.has(player.id)) {
        const snapshot = this.latestSnapshots.get(player.id) ?? { x: 0, z: 0, yaw: 0, alive: player.alive, animation: "idle" };
        const view = new CharacterView({ ...player, ...snapshot });
        view.applySnapshot(snapshot, true);
        const nameplate = view.group.getObjectByName("nameplate");
        if (nameplate && player.id === this.playerId) nameplate.visible = false;
        this.characters.set(player.id, view);
        this.scene.add(view.group);
      }
    }
    for (const [id, view] of this.characters) {
      if (!ids.has(id)) { this.scene.remove(view.group); view.dispose(); this.characters.delete(id); }
    }
  }

  handlePrivateState(state) {
    this.privateState = { ...state, completedTaskIds: [...(state.completedTaskIds ?? [])] };
    this.ui.setPrivateState(this.privateState);
  }

  applyWorldSnapshot(snapshot) {
    this.currentPhase = snapshot.phase;
    for (const player of snapshot.players) {
      this.latestSnapshots.set(player.id, player);
      this.characters.get(player.id)?.applySnapshot(player, false);
    }
    this.world.syncIncidents(snapshot.incidents ?? []);
  }

  async leaveRoom() {
    await this.network.request("leaveRoom").catch(() => {});
    localStorage.removeItem(REJOIN_KEY);
    this.room = null; this.playerId = null; this.privateState = null; this.currentPhase = "menu";
    this.clearCharacters(); this.world.syncIncidents([]); this.ui.closeGameplayModals(); this.ui.showMainMenu(this.auth);
  }

  async returnToLobby() {
    const result = await this.network.request("returnToLobby");
    this.privateState = null; this.updateRoom(result.room); this.ui.showLobby(result.room, this.playerId);
  }

  clearCharacters() {
    for (const view of this.characters.values()) { this.scene.remove(view.group); view.dispose(); }
    this.characters.clear(); this.latestSnapshots.clear();
  }

  async interact() {
    const station = this.nearest?.station;
    if (!station) return;
    if (station.type === "task") await this.network.request("beginTask", { stationId: station.id });
    else if (station.type === "repair") await this.network.request("repairSabotage", { stationId: station.id });
    else if (station.type === "meeting") await this.network.request("callMeeting");
    else if (station.type === "maintenance") await this.network.request("useMaintenance", { stationId: station.id });
    else if (station.type === "security" || station.type === "doorLogs") this.ui.showSecurity(await this.network.request("requestSecurity"));
    else if (station.type === "incident") await this.network.request("reportIncident", { incidentId: station.id });
    this.audio.playCue("interact");
  }

  interactWithIncident() {
    const station = this.nearest?.station;
    if (station?.type !== "incident") throw new Error("No incident is in report range.");
    return this.network.request("reportIncident", { incidentId: station.id });
  }

  tryEliminate() {
    if (this.privateState?.faction !== "operative" || !this.privateState.alive) throw new Error("Elimination is unavailable.");
    const local = this.characters.get(this.playerId)?.group.position;
    if (!local) throw new Error("Local player position is unavailable.");
    let target = null; let best = 3.2;
    for (const player of this.room?.players ?? []) {
      if (player.id === this.playerId || !player.alive) continue;
      const snapshot = this.latestSnapshots.get(player.id); if (!snapshot) continue;
      const distance = Math.hypot(local.x - snapshot.x, local.z - snapshot.z);
      if (distance < best) { target = player; best = distance; }
    }
    if (!target) throw new Error("No valid target is in range.");
    return this.network.request("eliminationAttempt", { targetId: target.id });
  }

  applySettings(changes) {
    this.settings = saveSettings({ ...this.settings, ...changes });
    applyDocumentSettings(this.settings);
    this.ui.fillSettings(this.settings);
    this.audio.applySettings();
    this.applyGraphicsSettings();
    this.network.request("saveSettings", this.settings).catch(() => {});
    this.ui.closeModal("settings");
    this.ui.toast("Settings applied.");
  }

  applyGraphicsSettings() {
    const ratios = { low: 0.72, medium: 1, high: Math.min(1.5, window.devicePixelRatio) };
    this.renderer.setPixelRatio(ratios[this.settings.graphicsQuality] ?? 1);
    this.renderer.shadowMap.enabled = this.settings.graphicsQuality !== "low";
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.resize();
  }

  onModalChanged(open, name) {
    if (name === "settings" && open) this.ui.fillSettings(this.settings);
    if (name === "profile" && open && this.auth && !this.auth.guest) {
      this.network.request("requestProfile").then((result) => this.renderProfile(result.profile)).catch((error) => this.ui.toast(error.message, true));
    }
    if (name === "minimap" && open) this.drawMinimap();
    if (open) this.input.setEnabled(false);
    else if (this.currentPhase === "active" && !document.querySelector(".modal:not(.is-hidden)")) this.input.setEnabled(true);
  }

  renderProfile(profile) {
    const content = document.getElementById("profile-content"); content.replaceChildren();
    if (!profile) { const p = document.createElement("p"); p.textContent = "Profile is unavailable."; content.append(p); return; }
    const heading = document.createElement("h3"); heading.textContent = profile.account.display_name;
    const stats = document.createElement("p"); stats.textContent = `${profile.stats.games_played} operations · ${profile.stats.total_wins} victories · ${profile.stats.tasks_completed} assignments`;
    content.append(heading, stats);
  }

  drawMinimap() {
    const local = this.latestSnapshots.get(this.playerId);
    this.ui.drawMinimap({
      playerPosition: local,
      tasks: this.privateState?.tasks ?? [], completedTaskIds: this.privateState?.completedTaskIds ?? [],
      sabotage: this.activeSabotage
    });
  }

  frame(time) {
    if (!this.running) return;
    const delta = Math.min(0.1, Math.max(0.001, (time - this.lastFrameAt) / 1000));
    this.lastFrameAt = time;
    this.frameSamples.push(1 / delta); if (this.frameSamples.length > 30) this.frameSamples.shift();

    const modalOpen = Boolean(document.querySelector(".modal:not(.is-hidden)"));
    const gameplayActive = this.currentPhase === "active" && this.room;
    const shouldEnableInput = Boolean(gameplayActive && !modalOpen);
    if (this.input.enabled !== shouldEnableInput) this.input.setEnabled(shouldEnableInput);
    if (gameplayActive && !modalOpen) this.handleInput(time);
    for (const view of this.characters.values()) view.update(delta, this.settings.reducedMotion);
    const localView = this.characters.get(this.playerId);
    if (localView) {
      this.cameraController.update(localView.group.position, this.input.yaw, this.input.pitch, delta, this.world.cameraObstacles);
      this.nearest = gameplayActive && this.privateState?.alive ? this.world.nearestInteractable(localView.group.position) : null;
      this.ui.updateInteraction(this.nearest);
      const room = roomAt(localView.group.position.x, localView.group.position.z);
      this.ui.updatePlayerHud(this.latestSnapshots.get(this.playerId), room?.name, this.network.pingMs);
    }
    this.world.update(delta, time / 1000, this.activeSabotage);
    const fps = this.frameSamples.reduce((sum, value) => sum + value, 0) / this.frameSamples.length;
    this.ui.updateFps(fps, this.settings.showFps);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((nextTime) => this.frame(nextTime));
  }

  handleInput(time) {
    if (time - this.lastInputSentAt > 50) {
      this.lastInputSentAt = time;
      this.network.send("playerInput", this.input.movement());
    }
    if (this.input.consume("KeyE")) this.interact().catch((error) => this.ui.toast(error.message, true));
    if (this.input.consume("KeyR")) this.interactWithIncident().catch((error) => this.ui.toast(error.message, true));
    if (this.input.consume("KeyQ")) this.tryEliminate().catch((error) => this.ui.toast(error.message, true));
    if (this.input.consume("KeyF") && this.privateState?.faction === "operative") this.ui.openModal("sabotage");
    if (this.input.consume("Space")) this.network.request("jump").catch(() => {});
    if (this.input.consume("Tab")) { this.ui.openModal("minimap"); this.drawMinimap(); }
    if (this.input.consume("Escape")) this.ui.openModal("pause");
    if (this.input.consume("Enter") && ["discussion", "voting"].includes(this.currentPhase)) document.getElementById("meeting-chat-input").focus();
  }

  resize() {
    const width = window.innerWidth; const height = window.innerHeight;
    this.camera.aspect = width / Math.max(1, height); this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
