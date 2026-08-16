import { AudioManager } from "./audio.js";
import { doorStepAllowed } from "./doorPhysics.js";
import { VENT_DIRECTION_KEYS, ventExitForDirection } from "./ventNavigation.js";
import { MeridianScene } from "./game2d/MeridianScene.js";
import { INTERACTION_RANGE, ROLE_TARGET_RANGE } from "./gameplayConstants.js";
import { nearestLivingTarget, nearestRoleTarget as findNearestRoleTarget } from "./gameplayTargeting.js";
import { InputController } from "./input.js";
import { LocalMovementPredictor } from "./localMovementPredictor.js";
import { getRoleDefinition } from "./roleData.js";
import { readStored } from "./safeStorage.js";
import { LOBBY_MAP_ID, getMapDefinition, isWalkable, roomAt } from "./shipData.js";
import { TaskInterface } from "./tasks.js";
import { resetMinigameState } from "./tasks/minigames.js";
import { RepairInterface } from "./repairInterface.js";
import { applyDocumentSettings, saveSettings } from "./settings.js";
import {
  addMinedVent, normaliseVentTopology, sealVent
} from "./ventTopology.js";

const SESSION_KEY = "orbitOps.accountSession.v1";
const REJOIN_KEY = "orbitOps.rejoinSession.v1";
const APPEARANCE_KEY = "orbitOps.appearance.v1";

function defaultAppearance() {
  const stored = readStored(APPEARANCE_KEY, {});
  return {
    colour: "cyan",
    visor: "#9defff",
    symbol: "orbit",
    number: 7,
    accessory: "antenna",
    ...(stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {})
  };
}

function nearestInteractable(map, position, incidents = [], allow = null, ventTopology = null) {
  if (!position) return null;
  let nearest = null;
  const sealedVentIds = new Set(ventTopology?.sealedVentIds ?? []);
  const runtimeVents = (ventTopology?.minedVents ?? []).filter(({ id }) => !sealedVentIds.has(id));
  for (const station of [...map.stations, ...runtimeVents, ...incidents.map((incident) => ({ ...incident, type: "incident" }))]) {
    if (station.type === "maintenance" && sealedVentIds.has(station.id)) continue;
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
    this.ventTopology = normaliseVentTopology();
    this.nearest = null;
    this.lastFrameAt = performance.now();
    this.lastInputSentAt = 0;
    this.localMovement = new LocalMovementPredictor();
    this.socketSessionReady = false;
    this.awaitingAuthoritativeSnapshot = false;
    this.resumeRoomPromise = null;
    this.reconnectPromise = null;
    this.reconnectGeneration = -1;
    // Frames counted over a window, not a mean of per-frame 1/delta: delta is
    // clamped to a 1ms floor, so one very short frame used to report 1000fps and
    // drag the average up. Frames longer than a second are background-tab pauses
    // and are dropped rather than averaged into the live rate.
    this.fpsFrames = 0;
    this.fpsElapsedMs = 0;
    this.fps = 0;
    // HUD text is rewritten a few times a second, not every frame.
    this.hudTextAt = 0;
    this.uiStateAt = 0;
    this.uiState = { modalOpen: false, typing: false };
    this.sceneReady = false;

    this.input = new InputController();
    this.audio = new AudioManager(() => this.settings);
    this.taskInterface = new TaskInterface(network, this.audio);
    this.repairInterface = new RepairInterface(network, this.audio);
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
    scene.syncVentTopology(this.ventTopology);
  }

  bindNetwork() {
    // Authentication, joining and resuming are request/ack operations. Handling
    // the server event as well as the ack used to run resume twice, rotate the
    // token once, then delete the fresh token when the duplicate request failed.
    this.network.on("roomState", (room) => this.updateRoom(room));
    this.network.on("matchReset", ({ room }) => {
      this.currentPhase = "lobby";
      this.privateState = null;
      if (this.sceneReady) this.phaserScene.setGhostView(false);
      this.resetTaskInterfaces();
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
      // Somebody else finished it, or a meeting cleared it: shut the panel.
      this.repairInterface.sabotageEnded();
    });
    // Repair panels are shared, so a breaker thrown by anyone repaints them all.
    this.network.on("sabotagePanel", (payload) => this.repairInterface.applyPanel(payload));
    this.network.on("ventMined", ({ vent }) => {
      this.ventTopology = addMinedVent(this.ventTopology, vent);
      if (this.sceneReady) this.phaserScene.syncVentTopology(this.ventTopology);
      this.ui.toast("A new maintenance vent was opened.");
    });
    this.network.on("ventSealed", ({ ventId }) => {
      this.ventTopology = sealVent(this.ventTopology, ventId);
      if (this.sceneReady) this.phaserScene.syncVentTopology(this.ventTopology);
      this.ui.toast("A maintenance vent was welded shut.");
    });
    this.network.on("playerEliminated", ({ playerId }) => {
      this.audio.playCue("eliminate");
      const snapshot = this.latestSnapshots.get(playerId);
      if (snapshot) snapshot.alive = false;
      if (this.sceneReady) this.phaserScene.markDead(playerId);
      if (playerId === this.playerId && this.privateState) {
        this.privateState.alive = false;
        // Assignments remain available to ghosts, but living-only sabotage
        // repair panels (especially the renewing reactor handprint timer) must
        // stop the instant the local player dies.
        this.repairInterface.close();
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
      // Meetings invalidate the server-side active task/repair. Release the one
      // shared task modal before opening the meeting or it will overlap the vote
      // screen and disable movement again when the match resumes.
      this.closeTaskInterfaces();
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
      this.resetTaskInterfaces();
      this.ui.showResults(results);
    });
    this.network.on("databaseSaveStatus", (payload) => this.ui.setSaveStatus(payload));
    this.network.on("errorMessage", ({ message }) => this.ui.toast(message, true));
    this.network.on("network:disconnected", () => {
      this.socketSessionReady = false;
      this.awaitingAuthoritativeSnapshot = Boolean(this.room);
      this.input.setEnabled(false);
      this.localMovement.clear();
      if (this.room) this.ui.setConnection(false);
    });
    this.network.on("network:connected", () => {
      this.ui.setConnection(true);
      if (this.auth) this.reconnectSocketSession().catch((error) => this.ui.toast(error.message, true));
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
    const stored = readStored(SESSION_KEY);
    if (stored?.token) {
      try {
        const result = await this.network.request("resumeSession", { token: stored.token, appearance: defaultAppearance() });
        this.handleAuthenticated({ ...result, token: stored.token });
        await this.resumeRoom();
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
    await this.resumeRoom();
  }

  handleAuthenticated(result, { showMenu = true } = {}) {
    const account = result.account;
    this.auth = {
      accountId: account?.id ?? null,
      displayName: account?.displayName ?? result.displayName,
      guest: result.guest ?? !account,
      role: account?.role ?? "player",
      token: result.token ?? this.auth?.token ?? null
    };
    this.socketSessionReady = true;
    if (result.token) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ token: result.token, expiresAt: result.expiresAt }));
    }
    this.ui.setAuthMessage("Clearance accepted.");
    if (showMenu) this.ui.showMainMenu(this.auth);
  }

  async logout() {
    const token = this.auth?.token;
    await this.network.request("logout", { token }).catch(() => {});
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(REJOIN_KEY);
    this.auth = null;
    this.socketSessionReady = false;
    this.room = null;
    this.playerId = null;
    this.resetTaskInterfaces();
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
    if (this.resumeRoomPromise) return this.resumeRoomPromise;
    this.resumeRoomPromise = this.performRoomResume();
    try {
      return await this.resumeRoomPromise;
    } finally {
      this.resumeRoomPromise = null;
    }
  }

  async performRoomResume() {
    if (!this.auth || !this.network.connected || !this.socketSessionReady) return false;
    const stored = readStored(REJOIN_KEY);
    if (!stored?.token || stored.displayName !== this.auth.displayName) return false;
    try {
      const result = await this.network.request("resumeRoom", { token: stored.token });
      this.handleRoomJoined(result);
      if (result.restored) this.handlePrivateState(result.restored);
      this.audio.playCue("reconnect");
      return true;
    } catch (error) {
      // A timeout or another transient disconnect must not erase the only token
      // that can restore the reserved room slot. Remove it only when the server
      // positively says that the reservation is unusable.
      if (/expired|does not match|no saved room session|same guest name/iu.test(error.message)) {
        localStorage.removeItem(REJOIN_KEY);
        this.clearLocalRoomState();
        this.ui.toast("Your reserved room expired. Returned to the operations menu.", true);
      }
      return false;
    }
  }

  async reconnectSocketSession() {
    const requestedGeneration = this.network.connectionGeneration ?? 0;
    if (this.reconnectPromise) {
      if (this.reconnectGeneration === requestedGeneration) return this.reconnectPromise;
      // A newer transport connected while the previous one was still waiting
      // on an acknowledgement. Let that attempt settle, then authenticate the
      // current generation rather than inheriting its stale promise.
      await this.reconnectPromise.catch(() => false);
    }
    if (!this.auth || !this.network.connected) return false;
    const generation = this.network.connectionGeneration ?? 0;
    if (this.reconnectPromise && this.reconnectGeneration === generation) return this.reconnectPromise;
    const attempt = this.performSocketReconnect(generation);
    this.reconnectGeneration = generation;
    this.reconnectPromise = attempt;
    try {
      return await attempt;
    } finally {
      if (this.reconnectPromise === attempt) this.reconnectPromise = null;
    }
  }

  async performSocketReconnect(generation = this.network.connectionGeneration ?? 0) {
    if (!this.auth || !this.network.connected) return false;
    if (this.auth.guest) {
      const result = await this.network.request("guestLogin", {
        displayName: this.auth.displayName,
        appearance: defaultAppearance()
      });
      this.handleAuthenticated(result, { showMenu: !this.room });
    } else {
      const stored = readStored(SESSION_KEY);
      const token = this.auth.token ?? stored?.token;
      if (!token) throw new Error("Your saved account session is unavailable.");
      const result = await this.network.request("resumeSession", { token, appearance: defaultAppearance() });
      this.handleAuthenticated({ ...result, token }, { showMenu: !this.room });
    }
    if (!this.network.connected || (this.network.connectionGeneration ?? 0) !== generation) return false;
    if (!this.room) return true;
    const resumed = await this.resumeRoom();
    if (resumed || !this.room || !this.network.connected) return resumed || !this.room;
    // A congested deploy can lose the first request before it reaches the room
    // handler. Retry once while the same authenticated socket is still alive;
    // token rotation remains idempotent through the server's previous-token slot.
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (!this.network.connected) return false;
    return this.resumeRoom();
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
    this.ventTopology = normaliseVentTopology(room.ventTopology);
    this.ui.updateRoom(room);
    if (previousMapId && previousMapId !== this.activeMapId()) this.localMovement.clear();
    if (this.sceneReady) {
      this.phaserScene.setMap(this.activeMapId());
      this.phaserScene.syncVentTopology(this.ventTopology);
    }
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
      const force = this.awaitingAuthoritativeSnapshot
        || !["active", "lobby"].includes(snapshot.phase)
        || Boolean(this.vent);
      this.localMovement.reconcile(localServer, { force });
      this.awaitingAuthoritativeSnapshot = false;
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
    this.clearLocalRoomState();
  }

  clearLocalRoomState() {
    localStorage.removeItem(REJOIN_KEY);
    this.room = null;
    this.playerId = null;
    this.privateState = null;
    this.vent = null;
    this.ventCursor = null;
    this.ventActionPending = false;
    this.ventTopology = normaliseVentTopology();
    this.awaitingAuthoritativeSnapshot = false;
    this.input.setEnabled(false);
    if (this.sceneReady) this.phaserScene.setVentState(null);
    this.currentPhase = "menu";
    this.latestIncidents = [];
    this.trackedTarget = null;
    this.clearCharacters();
    if (this.sceneReady) this.phaserScene.syncIncidents([]);
    this.resetTaskInterfaces();
    this.ui.showMainMenu(this.auth);
  }

  resetTaskInterfaces() {
    this.closeTaskInterfaces();
    resetMinigameState();
  }

  closeTaskInterfaces() {
    this.taskInterface.close();
    this.repairInterface.close();
    this.ui.closeGameplayModals();
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
      isPositionValid: (x, z) => isWalkable(map.id, x, z)
        && doorStepAllowed(map, this.activeSabotage, this.localMovement.position, { x, z }),
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
    else if (station.type === "repair") {
      // Opens that sabotage's own panel; the repair happens inside it.
      const opened = await this.network.request("repairSabotage", { stationId: station.id });
      if (this.repairInterface.open(opened)) this.input.setEnabled(false);
    }
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
    const configuredRange = Number(this.room?.settings?.eliminationRange);
    const target = nearestLivingTarget(
      this.room?.players,
      this.latestSnapshots,
      this.playerId,
      Number.isFinite(configuredRange) ? configuredRange : 2.35
    );
    if (!target) throw new Error("No valid target is in range.");
    return this.network.request("eliminationAttempt", { targetId: target.id });
  }

  nearestRoleTarget(targeting, reach = ROLE_TARGET_RANGE) {
    const local = this.latestSnapshots.get(this.playerId);
    if (!local) throw new Error("Local player position is unavailable.");
    return findNearestRoleTarget({
      targeting,
      local,
      incidents: this.latestIncidents,
      players: this.room?.players,
      snapshots: this.latestSnapshots,
      selfId: this.playerId,
      maximumRange: reach
    });
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
    if (deltaMs > 0 && deltaMs < 1000) {
      this.fpsFrames += 1;
      this.fpsElapsedMs += deltaMs;
    }
    if (this.fpsElapsedMs >= 500) {
      this.fps = (this.fpsFrames * 1000) / this.fpsElapsedMs;
      this.fpsFrames = 0;
      this.fpsElapsedMs = 0;
    }

    // Both of these walk the DOM, and at 60fps that is 120 document queries a
    // second for state that changes when a menu opens. A tenth of a second of
    // staleness on input gating is imperceptible.
    if (time - this.uiStateAt > 100) {
      this.uiStateAt = time;
      this.uiState.modalOpen = Boolean(document.querySelector(".modal:not(.is-hidden)"));
      this.uiState.typing = Boolean(document.activeElement?.closest?.("input, textarea, select"));
    }
    const { modalOpen, typing } = this.uiState;
    const inLobby = this.currentPhase === "lobby" && Boolean(this.room);
    const gameplayActive = this.currentPhase === "active" && Boolean(this.room);
    const shouldEnableInput = this.network.connected
      && this.socketSessionReady
      && !this.awaitingAuthoritativeSnapshot
      && (inLobby || gameplayActive)
      && !modalOpen
      && !typing;
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
            ? nearestInteractable(map, local, this.latestIncidents, null, this.ventTopology)
            : nearestInteractable(map, local, [], (station) => station.type === "task", this.ventTopology);
      this.ui.updateInteraction(this.nearest, inLobby);
      if (!inLobby) this.ui.updateRoleAbility(Date.now());
    }
    // Writing HUD text every frame means a layout pass every frame for numbers
    // nobody can read that fast. Eight times a second still looks live.
    if (time - this.hudTextAt > 125) {
      this.hudTextAt = time;
      if (local) {
        const map = getMapDefinition(this.activeMapId());
        this.ui.updatePlayerHud(local, roomAt(map.id, local.x, local.z)?.name, this.network.pingMs);
      }
      // Outside a match there is no local snapshot, so this sits apart from the
      // block above - otherwise the readout freezes on the last match's numbers.
      this.ui.updateTelemetry({
        fps: this.fps,
        pingMs: this.network.pingMs,
        jitterMs: this.network.jitterMs,
        showFps: this.settings.showFps,
        showPing: this.settings.showPing
      });
    }
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
