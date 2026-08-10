import { AudioManager } from "./audio.js";
import { VENT_DIRECTION_KEYS, ventExitForDirection } from "./ventNavigation.js";
import { MeridianScene } from "./game2d/MeridianScene.js";
import { InputController } from "./input.js";
import { LocalMovementPredictor } from "./localMovementPredictor.js";
import { getRoleDefinition } from "./roleData.js";
import { LOBBY_MAP_ID, getMapDefinition, isWalkable, roomAt } from "./shipData.js";
import { TaskInterface } from "./tasks.js";
import { applyDocumentSettings, saveSettings } from "./settings.js";

const SESSION_KEY = "orbitOps.accountSession.v1";
const REJOIN_KEY = "orbitOps.rejoinSession.v1";
const APPEARANCE_KEY = "orbitOps.appearance.v1";
const INTERACTION_RANGE = 2.8;
// Mirrors ROLE_TARGET_RANGE in server/roleEngine.js: the client only picks the
// target, the server still decides whether the reach was legal.
const ROLE_TARGET_RANGE = 3.2;

function defaultAppearance() {
  try {
    return {
      colour: "cyan",
      visor: "#9defff",
      symbol: "orbit",
      number: 7,
      accessory: "antenna",
      ...JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? "{}")
    };
  } catch {
    return { colour: "cyan", visor: "#9defff", symbol: "orbit", number: 7, accessory: "antenna" };
  }
}

function nearestInteractable(map, position, incidents = [], allow = null) {
  if (!position) return null;
  let nearest = null;
  for (const station of [...map.stations, ...incidents.map((incident) => ({ ...incident, type: "incident" }))]) {
    if (allow && !allow(station)) continue;
    const distance = Math.hypot(position.x - station.x, position.z - station.z);
    if (distance <= (station.range ?? INTERACTION_RANGE) && (!nearest || distance < nearest.distance)) {
      nearest = { station, distance };
    }
  }
  return nearest;
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
    this.latestIncidents = [];
    this.trackedTarget = null;
    this.currentPhase = "menu";
    this.activeSabotage = null;
    this.nearest = null;
    this.lastFrameAt = performance.now();
    this.lastInputSentAt = 0;
    this.localMovement = new LocalMovementPredictor();
    this.frameSamples = [];
    this.sceneReady = false;

    this.input = new InputController();
    this.audio = new AudioManager(() => this.settings);
    this.taskInterface = new TaskInterface(network, this.audio);
    this.phaserScene = new MeridianScene(this);
    this.phaserGame = new window.Phaser.Game({
      type: window.Phaser.WEBGL,
      canvas,
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: "#02060c",
      scale: {
        mode: window.Phaser.Scale.RESIZE,
        width: window.innerWidth,
        height: window.innerHeight
      },
      render: {
        antialias: settings.graphicsQuality !== "low",
        roundPixels: settings.graphicsQuality !== "high",
        powerPreference: "high-performance"
      },
      input: { keyboard: false, mouse: false, touch: false },
      scene: [this.phaserScene]
    });

    this.bindNetwork();
    this.bindUI();
  }

  onSceneReady(scene) {
    this.phaserScene = scene;
    this.sceneReady = true;
    this.applyGraphicsSettings();
    if (this.room?.players) this.syncCharacterMetadata(this.room.players);
    if (this.latestIncidents.length) scene.syncIncidents(this.latestIncidents);
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
    this.network.on("matchReset", ({ room }) => {
      this.currentPhase = "lobby";
      this.privateState = null;
      if (this.sceneReady) this.phaserScene.setGhostView(false);
      this.ui.closeGameplayModals();
      this.updateRoom(room);
      this.ui.showLobby(room, this.playerId);
    });
    // The reveal goes up first and the ship is built behind it, so the match never
    // opens on the game room and only then tells you who you are.
    this.network.on("countdown", () => {
      this.currentPhase = "countdown";
      this.ui.beginRoleReveal();
      this.ui.showGame();
    });
    this.network.on("roleAssigned", (state) => this.handlePrivateState(state));
    this.network.on("matchStarted", (payload) => {
      this.currentPhase = "active";
      this.ui.showGame();
      this.ui.endRoleReveal();
      this.ui.updateTaskProgress(payload.taskProgress);
      this.input.setEnabled(true);
    });
    this.network.on("phaseChanged", ({ phase, endsAt }) => {
      this.currentPhase = phase;
      this.ui.setPhase(phase, endsAt);
      if (phase !== "active") this.input.setEnabled(false);
    });
    this.network.on("worldSnapshot", (snapshot) => this.applyWorldSnapshot(snapshot));
    this.network.on("taskStarted", (payload) => {
      this.input.setEnabled(false);
      this.taskInterface.open(payload);
      this.audio.playCue("interact");
    });
    this.network.on("taskCompleted", (payload) => {
      if (this.privateState && !this.privateState.completedTaskIds.includes(payload.taskId)) {
        this.privateState.completedTaskIds.push(payload.taskId);
      }
      if (this.privateState) this.ui.renderTasks(this.privateState.tasks, this.privateState.completedTaskIds);
      this.ui.updateTaskProgress(payload.sharedProgress);
    });
    this.network.on("taskProgress", (progress) => {
      if (progress.total !== undefined && progress.completed !== undefined) this.ui.updateTaskProgress(progress);
    });
    // One leg of a multi-room assignment finished; the rest of it is elsewhere.
    this.network.on("taskSiteAdvanced", (payload) => {
      const assignment = this.privateState?.tasks?.find((task) => task.id === payload.taskId);
      if (assignment) assignment.site = payload.site;
      if (this.privateState) this.ui.renderTasks(this.privateState.tasks, this.privateState.completedTaskIds);
      this.ui.toast(`${payload.nextLabel} next.`);
    });
    this.network.on("sabotageStarted", (sabotage) => {
      this.activeSabotage = sabotage;
      this.ui.updateSabotage(sabotage);
      this.audio.setEmergency(true);
      this.audio.playCue("alarm");
    });
    this.network.on("sabotageUpdated", (sabotage) => {
      this.activeSabotage = sabotage;
      this.ui.updateSabotage(sabotage);
    });
    this.network.on("sabotageEnded", () => {
      this.activeSabotage = null;
      this.ui.clearSabotage();
      this.audio.setEmergency(false);
      this.ui.toast("Sabotage resolved.");
    });
    this.network.on("playerEliminated", ({ playerId }) => {
      this.audio.playCue("eliminate");
      const snapshot = this.latestSnapshots.get(playerId);
      if (snapshot) snapshot.alive = false;
      if (this.sceneReady) this.phaserScene.markDead(playerId);
      if (playerId === this.playerId && this.privateState) {
        this.privateState.alive = false;
        if (this.sceneReady) this.phaserScene.setGhostView(true);
        this.ui.toast("Your suit is offline. You drift on as a ghost - finish your assignments.");
      }
    });
    this.network.on("shieldBlocked", ({ playerId, attackerId, protection }) => {
      const shieldNames = { vest: "Your vest", "guardian-shield": "A guardian's shield" };
      if (playerId === this.playerId) this.ui.toast(`${shieldNames[protection] ?? "A Medic shield"} blocked an elimination.`);
      else if (attackerId === this.playerId) this.ui.toast("The target was protected.");
    });
    this.network.on("incidentCleaned", ({ incidentId }) => {
      this.latestIncidents = this.latestIncidents.filter((incident) => incident.id !== incidentId);
      if (this.sceneReady) this.phaserScene.syncIncidents(this.latestIncidents);
    });
    this.network.on("meetingStarted", (payload) => {
      this.ui.showMeeting(payload);
      this.audio.playCue("report");
      this.input.setEnabled(false);
    });
    this.network.on("discussionStarted", ({ endsAt }) => this.ui.setDiscussion(endsAt));
    this.network.on("votingStarted", ({ endsAt }) => this.ui.setVoting(endsAt));
    this.network.on("voteResult", (payload) => {
      this.ui.showVoteResult(payload);
      this.audio.playCue("vote");
      if (payload.removedId) {
        const snapshot = this.latestSnapshots.get(payload.removedId);
        if (snapshot) snapshot.alive = false;
        if (this.sceneReady) this.phaserScene.markDead(payload.removedId, true);
      }
    });
    this.network.on("matchResumed", () => {
      this.currentPhase = "active";
      this.ui.closeModal("meeting");
      this.input.setEnabled(true);
    });
    // Private role findings (Detective forensics, Investigator reports, seances).
    this.network.on("roleFinding", (finding) => this.ui.showRoleFinding(finding));
    this.network.on("votesSwapped", () => this.ui.toast("The vote was tampered with."));
    this.network.on("playerRevived", ({ playerId }) => {
      this.ui.toast(playerId === this.playerId ? "You have been revived." : "Someone was pulled back from the dead.");
    });
    this.network.on("chatMessage", (payload) => this.ui.appendChat(payload));
    this.network.on("matchEnded", (results) => {
      this.currentPhase = "results";
      this.input.setEnabled(false);
      this.ui.showResults(results);
    });
    this.network.on("databaseSaveStatus", (payload) => this.ui.setSaveStatus(payload));
    this.network.on("errorMessage", ({ message }) => this.ui.toast(message, true));
    this.network.on("network:disconnected", () => { if (this.room) this.ui.setConnection(false); });
    this.network.on("network:connected", () => {
      this.ui.setConnection(true);
      if (this.auth && this.room) this.resumeRoom().catch(() => {});
    });
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
      roleAbility: (payload) => this.performRoleAction(payload?.targetId ?? null),
      emergencyMeeting: () => this.callEmergencyMeeting(),
      sabotage: (payload) => this.network.request("sabotageRequest", payload),
      hopVent: (payload) => this.hopVent(payload.stationId),
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
    this.auth = {
      accountId: account?.id ?? null,
      displayName: account?.displayName ?? result.displayName,
      guest: result.guest ?? !account,
      token: result.token ?? this.auth?.token ?? null
    };
    if (result.token) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ token: result.token, expiresAt: result.expiresAt }));
    }
    this.ui.setAuthMessage("Clearance accepted.");
    this.ui.showMainMenu(this.auth);
    this.resumeRoom().catch(() => {});
  }

  async logout() {
    const token = this.auth?.token;
    await this.network.request("logout", { token }).catch(() => {});
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(REJOIN_KEY);
    this.auth = null;
    this.room = null;
    this.playerId = null;
    this.clearCharacters();
    this.ui.showScreen("auth");
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
    if (payload.rejoinToken) {
      localStorage.setItem(REJOIN_KEY, JSON.stringify({ token: payload.rejoinToken, displayName: this.auth?.displayName }));
    }
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

  // Everything before the countdown happens in the shared dropship lobby; the
  // host's selected map only becomes the live world once the match starts.
  activeMapId() {
    return this.currentPhase === "lobby" ? LOBBY_MAP_ID : this.room?.mapId;
  }

  updateRoom(room) {
    if (!room) return;
    const previousMapId = this.activeMapId();
    this.room = room;
    this.activeSabotage = room.activeSabotage;
    this.ui.updateRoom(room);
    if (previousMapId && previousMapId !== this.activeMapId()) this.localMovement.clear();
    if (this.sceneReady) this.phaserScene.setMap(this.activeMapId());
    this.syncCharacterMetadata(room.players);
  }

  syncCharacterMetadata(players) {
    if (!this.sceneReady) return;
    this.phaserScene.syncPlayers(players, this.playerId, this.latestSnapshots);
  }

  handlePrivateState(state) {
    this.privateState = { ...state, completedTaskIds: [...(state.completedTaskIds ?? [])] };
    this.ui.setPrivateState(this.privateState);
    // The server is authoritative about being in a vent, in both directions. It
    // empties vents for meetings, death and match reset, and it is also the only
    // thing that knows you got in if the enter request's response never landed.
    // Mirroring it here means the client can never be stuck believing the opposite
    // of the server - which is what left players vented but unable to move or exit.
    const ventedNow = Boolean(state.vent?.inVent);
    if (!ventedNow && this.vent) {
      this.ventActionPending = false;
      this.applyVentState(null);
    } else if (ventedNow && state.vent.ventId !== this.vent?.ventId) {
      this.ventActionPending = false;
      this.applyVentState(state.vent);
    }
    if (this.sceneReady) {
      this.phaserScene.applyPrivateRoleState(this.privateState);
      this.phaserScene.setGhostView(this.privateState.alive === false);
    }
  }

  applyWorldSnapshot(snapshot) {
    // Sensory states the HUD needs to explain to the player.
    this.ui.setSensoryState({
      blinded: Boolean(snapshot.blinded),
      cuffed: Boolean(snapshot.cuffed),
      lightsOut: Boolean(snapshot.lightsOut)
    });
    this.currentPhase = snapshot.phase;
    const localServer = (snapshot.players ?? []).find((player) => player.id === this.playerId);
    let localDisplay = localServer;
    if (localServer) {
      const force = !["active", "lobby"].includes(snapshot.phase) || Boolean(this.vent);
      this.localMovement.reconcile(localServer, { force });
      localDisplay = this.localMovement.renderSnapshot(localServer);
    }
    const renderPlayers = (snapshot.players ?? []).map((player) =>
      player.id === this.playerId && localDisplay ? localDisplay : player);
    for (const player of renderPlayers) this.latestSnapshots.set(player.id, player);
    this.latestIncidents = snapshot.incidents ?? [];
    // The Tracker's mark rides outside the culled player list, so it survives the
    // target walking out of sight - which is exactly when the arrow matters.
    this.trackedTarget = snapshot.tracked ?? null;
    if (this.sceneReady) this.phaserScene.applySnapshot({ ...snapshot, players: renderPlayers });
    // The map is a live view while it is open, so a moving mark keeps moving on it.
    if (this.trackedTarget && !document.getElementById("minimap")?.classList.contains("is-hidden")) {
      this.drawMinimap();
    }
  }

  async leaveRoom() {
    await this.network.request("leaveRoom").catch(() => {});
    localStorage.removeItem(REJOIN_KEY);
    this.room = null;
    this.playerId = null;
    this.privateState = null;
    this.vent = null;
    this.ventCursor = null;
    this.ventActionPending = false;
    if (this.sceneReady) this.phaserScene.setVentState(null);
    this.currentPhase = "menu";
    this.latestIncidents = [];
    this.trackedTarget = null;
    this.clearCharacters();
    if (this.sceneReady) this.phaserScene.syncIncidents([]);
    this.ui.closeGameplayModals();
    this.ui.showMainMenu(this.auth);
  }

  async returnToLobby() {
    const result = await this.network.request("returnToLobby");
    this.privateState = null;
    this.updateRoom(result.room);
    this.ui.showLobby(result.room, this.playerId);
  }

  clearCharacters() {
    if (this.sceneReady) this.phaserScene.clearCharacters();
    this.latestSnapshots.clear();
    this.localMovement.clear();
  }

  predictLocalMovement(input, delta) {
    const local = this.latestSnapshots.get(this.playerId);
    if (!local || this.vent) return;
    const map = getMapDefinition(this.activeMapId());
    const position = this.localMovement.advance({
      input,
      delta,
      faction: this.privateState?.faction,
      settings: this.room?.settings,
      alive: this.privateState?.alive !== false,
      isPositionValid: (x, z) => isWalkable(map.id, x, z),
      bounds: map.bounds
    });
    if (!position) return;
    const predicted = this.localMovement.renderSnapshot(local, input);
    this.latestSnapshots.set(this.playerId, predicted);
    if (this.sceneReady) this.phaserScene.applyLocalPrediction(predicted);
  }

  sendPlayerInput(time) {
    if (time - this.lastInputSentAt <= 50) return;
    this.lastInputSentAt = time;
    const movement = this.input.movement();
    if (this.localMovement.position) {
      movement.position = { ...this.localMovement.position };
      this.localMovement.recordInput(movement.seq);
    }
    this.network.send("playerInput", movement);
  }

  async interact() {
    const station = this.nearest?.station;
    if (!station) return;
    if (this.privateState && !this.privateState.alive && station.type !== "task") {
      throw new Error("Ghosts can only work on assignments.");
    }
    if (station.type === "launch") await this.network.request("startMatch");
    else if (station.type === "task") await this.network.request("beginTask", { stationId: station.id });
    else if (station.type === "repair") await this.network.request("repairSabotage", { stationId: station.id });
    else if (station.type === "meeting") await this.network.request("callMeeting");
    else if (station.type === "maintenance") await this.enterVent(station.id);
    else if (station.type === "admin") {
      this.ui.showAdmin(await this.network.request("requestAdmin"));
    } else if (station.type === "security" || station.type === "doorLogs") {
      this.ui.showSecurity(await this.network.request("requestSecurity"));
    } else if (station.type === "incident") {
      await this.network.request("reportIncident", { incidentId: station.id });
    }
    this.audio.playCue("interact");
  }

  // enterVent, hopVent and leaveVent all share one in-flight guard. Without it, a
  // second E press fired before the first request's ack arrives would still see
  // this.vent as null (it is only set from the response) and fall through to
  // interact() -> enterVent() again, which read as "pressing E while already vented
  // tries to re-enter" - it was really a race, not the exit logic being wrong.
  // Single point where vent state is applied, so the HUD panel and the in-world
  // arrows always agree with each other and with the server.
  applyVentState(vent) {
    this.vent = vent?.inVent ? vent : null;
    this.ventCursor = null;
    this.ui.showVent(this.vent);
    if (this.sceneReady) this.phaserScene.setVentState(this.vent);
  }

  async enterVent(stationId) {
    if (this.ventActionPending) return;
    this.ventActionPending = true;
    try {
      const result = await this.network.request("enterVent", { stationId });
      this.applyVentState(result.vent);
    } finally {
      this.ventActionPending = false;
    }
  }

  async hopVent(stationId) {
    if (this.ventActionPending) return;
    this.ventActionPending = true;
    try {
      const result = await this.network.request("moveVent", { stationId });
      this.applyVentState(result.vent);
    } finally {
      this.ventActionPending = false;
    }
  }

  async leaveVent() {
    if (this.ventActionPending) return;
    this.ventActionPending = true;
    try {
      await this.network.request("exitVent");
      this.applyVentState(null);
    } finally {
      this.ventActionPending = false;
    }
  }

  // WASD is the primary way to move through a vent loop: press the direction the
  // exit you want lies in, and the best-aligned exit is chosen. Alt still cycles
  // through exits in order as a fallback for when no direction lines up well enough
  // (or for players who prefer it).
  handleVentNavigation() {
    if (!this.vent?.exits?.length || this.ventActionPending) return;
    for (const { code, direction } of VENT_DIRECTION_KEYS) {
      if (!this.input.consume(code)) continue;
      const exit = ventExitForDirection(this.vent.exits, direction);
      if (exit) this.hopVent(exit.id).catch((error) => this.ui.toast(error.message, true));
      return;
    }
  }

  // Alt cycles to the next vent on the network, as in the reference.
  cycleVent() {
    if (!this.vent?.exits?.length) return null;
    this.ventCursor = ((this.ventCursor ?? -1) + 1) % this.vent.exits.length;
    return this.hopVent(this.vent.exits[this.ventCursor].id);
  }

  interactWithIncident() {
    const station = this.nearest?.station;
    if (station?.type !== "incident") throw new Error("No incident is in report range.");
    return this.network.request("reportIncident", { incidentId: station.id });
  }

  tryEliminate() {
    if (this.privateState?.faction !== "operative" || !this.privateState.alive) {
      throw new Error("Elimination is unavailable.");
    }
    const local = this.latestSnapshots.get(this.playerId);
    if (!local) throw new Error("Local player position is unavailable.");
    let target = null;
    let best = 3.2;
    for (const player of this.room?.players ?? []) {
      if (player.id === this.playerId || !player.alive) continue;
      const snapshot = this.latestSnapshots.get(player.id);
      if (!snapshot || snapshot.alive === false) continue;
      const distance = Math.hypot(local.x - snapshot.x, local.z - snapshot.z);
      if (distance < best) {
        target = player;
        best = distance;
      }
    }
    if (!target) throw new Error("No valid target is in range.");
    return this.network.request("eliminationAttempt", { targetId: target.id });
  }

  nearestRoleTarget(targeting, reach = ROLE_TARGET_RANGE) {
    const local = this.latestSnapshots.get(this.playerId);
    if (!local) throw new Error("Local player position is unavailable.");
    if (targeting === "incident") {
      let nearest = null;
      let best = reach;
      for (const incident of this.latestIncidents) {
        const distance = Math.hypot(local.x - incident.x, local.z - incident.z);
        if (distance < best) {
          nearest = incident;
          best = distance;
        }
      }
      return nearest;
    }
    if (targeting !== "player") return null;
    let nearest = null;
    let best = reach;
    for (const player of this.room?.players ?? []) {
      if (player.id === this.playerId) continue;
      const snapshot = this.latestSnapshots.get(player.id);
      if (!snapshot || snapshot.alive === false) continue;
      const distance = Math.hypot(local.x - snapshot.x, local.z - snapshot.z);
      if (distance < best) {
        nearest = player;
        best = distance;
      }
    }
    return nearest;
  }

  // explicitTargetId comes from the meeting UI, where you pick a face rather than
  // stand next to someone. Everywhere else the target is whatever is nearest.
  async performRoleAction(explicitTargetId = null) {
    if (!this.privateState) throw new Error("Your role ability is unavailable.");
    const definition = getRoleDefinition(this.privateState.role);
    if (!definition.ability) throw new Error("Your current role has no active ability.");
    // The Guardian Angel acts from the grave; every other role needs to be alive.
    if (!this.privateState.alive && !definition.capabilities.actsWhileDead) {
      throw new Error("Your role ability is unavailable.");
    }
    const { targeting } = definition.ability;
    // A role that ignores range picks its target by name, not by proximity, so
    // asking "who is nearest" would wrongly refuse it when nobody is close.
    // A range-free role still targets whoever is nearest — the Guardian Angel
    // drifts over to the crewmate it means to cover — it just is not refused for
    // being far away.
    const reach = definition.capabilities.ignoresAbilityRange ? Infinity : ROLE_TARGET_RANGE;
    const target = explicitTargetId
      ? { id: explicitTargetId }
      : this.nearestRoleTarget(targeting, reach);
    if (targeting !== "none" && !target) {
      throw new Error(targeting === "incident"
        ? "No incident is in ability range."
        : definition.capabilities.ignoresAbilityRange
          ? "There is nobody left to target."
          : "No player is in ability range.");
    }
    const payload = targeting === "incident"
      ? { incidentId: target.id }
      : targeting === "player" ? { targetId: target.id } : {};
    const result = await this.network.request("roleAction", payload);
    if (result.privateState) this.handlePrivateState(result.privateState);
    this.ui.toast(`${definition.name}: ${definition.ability.label} activated.`);
    return result;
  }

  callEmergencyMeeting() {
    if (this.nearest?.station?.type !== "meeting") {
      throw new Error("Move to the emergency meeting button.");
    }
    return this.network.request("callMeeting");
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
    if (this.sceneReady) this.phaserScene.applySettings(this.settings);
  }

  onModalChanged(open, name) {
    if (name === "settings" && open) this.ui.fillSettings(this.settings);
    if (name === "profile" && open && this.auth && !this.auth.guest) {
      this.network.request("requestProfile")
        .then((result) => this.renderProfile(result.profile))
        .catch((error) => this.ui.toast(error.message, true));
    }
    if (name === "minimap" && open) this.drawMinimap();
    if (open) this.input.setEnabled(false);
    else if (this.currentPhase === "active" && !document.querySelector(".modal:not(.is-hidden)")) {
      this.input.setEnabled(true);
    }
  }

  renderProfile(profile) {
    const content = document.getElementById("profile-content");
    content.replaceChildren();
    if (!profile) {
      const paragraph = document.createElement("p");
      paragraph.textContent = "Profile is unavailable.";
      content.append(paragraph);
      return;
    }
    const heading = document.createElement("h3");
    heading.textContent = profile.account.display_name;
    const stats = document.createElement("p");
    stats.textContent = `${profile.stats.games_played} operations · ${profile.stats.total_wins} victories · ${profile.stats.tasks_completed} assignments`;
    content.append(heading, stats);
  }

  drawMinimap() {
    const local = this.latestSnapshots.get(this.playerId);
    this.ui.drawMinimap({
      mapId: this.room?.mapId,
      playerPosition: local,
      tasks: this.privateState?.tasks ?? [],
      completedTaskIds: this.privateState?.completedTaskIds ?? [],
      sabotage: this.activeSabotage,
      // Only ever populated for a Tracker with a live track.
      tracked: this.trackedTarget
    });
  }

  onRenderFrame(time, deltaMs) {
    const delta = Math.min(0.1, Math.max(0.001, deltaMs / 1000));
    this.lastFrameAt = time;
    this.frameSamples.push(1 / delta);
    if (this.frameSamples.length > 30) this.frameSamples.shift();

    const modalOpen = Boolean(document.querySelector(".modal:not(.is-hidden)"));
    const typing = Boolean(document.activeElement?.closest?.("input, textarea, select"));
    const inLobby = this.currentPhase === "lobby" && Boolean(this.room);
    const gameplayActive = this.currentPhase === "active" && Boolean(this.room);
    const shouldEnableInput = (inLobby || gameplayActive) && !modalOpen && !typing;
    if (this.input.enabled !== shouldEnableInput) this.input.setEnabled(shouldEnableInput);
    if (shouldEnableInput) {
      const movement = this.input.currentMovement();
      this.predictLocalMovement(movement, delta);
      this.sendPlayerInput(time);
      if (inLobby) this.handleLobbyInput();
      else this.handleInput();
    }

    const local = this.latestSnapshots.get(this.playerId);
    if (local) {
      const map = getMapDefinition(this.activeMapId());
      this.nearest = inLobby
        ? nearestInteractable(map, local)
        : !gameplayActive ? null
          : this.privateState?.alive
            ? nearestInteractable(map, local, this.latestIncidents)
            : nearestInteractable(map, local, [], (station) => station.type === "task");
      this.ui.updateInteraction(this.nearest, inLobby);
      if (!inLobby) this.ui.updateRoleAbility(Date.now());
      const room = roomAt(map.id, local.x, local.z);
      this.ui.updatePlayerHud(local, room?.name, this.network.pingMs);
    }
    const fps = this.frameSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, this.frameSamples.length);
    this.ui.updateFps(fps, this.settings.showFps);
  }

  handleLobbyInput() {
    if (this.input.consume("KeyE")) this.interact().catch((error) => this.ui.toast(error.message, true));
    if (this.input.consume("Enter")) document.getElementById("lobby-chat-input")?.focus();
    if (this.input.consume("Escape")) this.ui.openModal("pause");
  }

  handleInput() {
    if (this.vent) {
      // Vented: WASD hops to whichever exit lies in the pressed direction, Alt
      // cycles through exits in order, and E always climbs out - never back in.
      this.handleVentNavigation();
      if (this.input.consume("AltLeft") || this.input.consume("AltRight")) {
        this.cycleVent()?.catch((error) => this.ui.toast(error.message, true));
      }
      if (this.input.consume("KeyE")) {
        this.leaveVent().catch((error) => this.ui.toast(error.message, true));
      }
    } else if (this.input.consume("KeyE")) {
      this.interact().catch((error) => this.ui.toast(error.message, true));
    }
    if (this.input.consume("KeyR")) this.interactWithIncident().catch((error) => this.ui.toast(error.message, true));
    if (this.input.consume("KeyQ")) this.tryEliminate().catch((error) => this.ui.toast(error.message, true));
    if (this.input.consume("KeyG")) this.performRoleAction().catch((error) => this.ui.toast(error.message, true));
    if (this.input.consume("KeyF") && this.privateState?.faction === "operative") this.ui.openModal("sabotage");
    if (this.input.consume("Tab")) {
      this.ui.openModal("minimap");
      this.drawMinimap();
    }
    if (this.input.consume("Escape")) this.ui.openModal("pause");
    if (this.input.consume("Enter") && ["discussion", "voting"].includes(this.currentPhase)) {
      document.getElementById("meeting-chat-input").focus();
    }
  }
}
