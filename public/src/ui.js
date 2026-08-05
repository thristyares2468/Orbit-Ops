import { ART_CATALOG } from "./artCatalog.js";
import { PLAYER_COLOUR_PALETTES } from "./game2d/assets.js";
import { mapShapePolygon, pointInMapShape } from "./mapSchema.js";
import { getRoleDefinition } from "./roleData.js";
import { getMapDefinition } from "./shipData.js";
import { pauseCopy, progressLabels, roleAbilityStatus } from "./hudState.js";

const FIRST_RUN_KEY = "orbitOps.firstRunHint.v1";
const COLOURS = Object.freeze({ cyan: "#27bad8", amber: "#e2a238", violet: "#805bd0", lime: "#54b86a", coral: "#d9575f", white: "#c8d8dd", blue: "#3f67c9", rose: "#c74f87" });

function byId(id) { return document.getElementById(id); }
function setVisible(element, visible) { element?.classList.toggle("is-hidden", !visible); }
function titleCase(value) { return String(value ?? "").replaceAll("-", " ").replace(/\b\w/gu, (character) => character.toUpperCase()); }
function hexRgb(value, fallback = "#9defff") {
  const match = /^#?([0-9a-f]{6})$/iu.exec(String(value ?? "")) ?? /^#?([0-9a-f]{6})$/iu.exec(fallback);
  return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16));
}

async function paintMenuCrew() {
  const canvases = [...document.querySelectorAll(".menu-drifter")];
  if (!canvases.length) return;
  const source = new Image();
  source.src = "/assets/player-models/base/idle/idle.png";
  await source.decode();
  for (const canvas of canvases) {
    const palette = PLAYER_COLOUR_PALETTES[canvas.dataset.colour] ?? PLAYER_COLOUR_PALETTES.cyan;
    const main = hexRgb(palette.main, "#27bad8");
    const shadow = hexRgb(palette.shadow, "#126a83");
    const visor = hexRgb(canvas.dataset.visor, "#9defff");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      const red = pixels.data[offset];
      const green = pixels.data[offset + 1];
      const blue = pixels.data[offset + 2];
      if (pixels.data[offset + 3] === 0) continue;
      let target = null;
      let intensity = 1;
      if (red - green > 12 && red - blue > 12) {
        target = main;
        intensity = red / 255;
      } else if (blue - red > 12 && blue - green > 12) {
        target = shadow;
        intensity = blue / 255;
      } else if (green - red > 12 && green - blue > 12) {
        target = visor;
        intensity = green / 255;
      }
      if (!target) continue;
      pixels.data[offset] = Math.round(target[0] * intensity);
      pixels.data[offset + 1] = Math.round(target[1] * intensity);
      pixels.data[offset + 2] = Math.round(target[2] * intensity);
    }
    context.putImageData(pixels, 0, 0);
  }
}

export class GameUI {
  constructor() {
    this.actions = {};
    this.room = null;
    this.playerId = null;
    this.privateState = null;
    this.meetingPhase = null;
    this.assetArchiveBuilt = false;
    this.elements = {
      loading: byId("loading-screen"), app: byId("app"), auth: byId("auth-screen"), menu: byId("main-menu"), lobbyHud: byId("lobby-hud"),
      hud: byId("hud"), results: byId("results-screen"), disconnect: byId("disconnect-overlay"), roleReveal: byId("role-reveal"),
      minimap: byId("minimap"), task: byId("task-modal"), meeting: byId("meeting-modal"), sabotage: byId("sabotage-modal"), security: byId("security-modal"),
      pause: byId("pause-modal"), settings: byId("settings-modal"), howto: byId("howto-modal"), profile: byId("profile-modal"), assets: byId("assets-modal"),
      lobbySettings: byId("lobby-settings-modal"),
      admin: byId("admin-modal"),
      firstRunHint: byId("first-run-hint"),
      ventPanel: byId("vent-panel")
    };
    this.lastMinimapRequest = null;
    paintMenuCrew().catch(() => {});
    this.bindStaticEvents();
    // Re-fit the open map overview when the viewport changes so it is never cropped.
    window.addEventListener("resize", () => {
      if (this.elements.minimap?.classList.contains("is-hidden")) return;
      if (this.lastMinimapRequest) this.drawMinimap(this.lastMinimapRequest);
    });
  }

  setActions(actions) { this.actions = actions; }

  bindStaticEvents() {
    document.querySelectorAll("[data-auth-tab]").forEach((button) => button.addEventListener("click", () => this.showAuthTab(button.dataset.authTab)));
    byId("guest-form").addEventListener("submit", (event) => { event.preventDefault(); this.invoke("guestLogin", { displayName: byId("guest-name").value }); });
    byId("login-form").addEventListener("submit", (event) => { event.preventDefault(); this.invoke("login", { email: byId("login-email").value, password: byId("login-password").value }); });
    byId("register-form").addEventListener("submit", (event) => {
      event.preventDefault();
      if (byId("register-password").value !== byId("register-confirm").value) { this.setAuthMessage("Passwords do not match.", true); return; }
      this.invoke("register", { email: byId("register-email").value, displayName: byId("register-name").value, password: byId("register-password").value });
    });
    byId("join-public").addEventListener("click", () => this.invoke("joinPublic"));
    byId("create-private").addEventListener("click", () => this.invoke("createRoom", { mode: "private" }));
    byId("practice-mode").addEventListener("click", () => this.invoke("createRoom", { mode: "practice" }));
    byId("join-private-open").addEventListener("click", () => byId("join-code-form").classList.toggle("is-hidden"));
    byId("join-code-form").addEventListener("submit", (event) => { event.preventDefault(); this.invoke("joinRoom", { code: byId("join-code").value }); });
    byId("logout-button").addEventListener("click", () => this.invoke("logout"));
    byId("leave-room").addEventListener("click", () => this.invoke("leaveRoom"));
    byId("lobby-code-copy").addEventListener("click", () => this.copyRoomCode());
    byId("pause-leave").addEventListener("click", () => this.invoke("leaveRoom"));
    byId("ready-button").addEventListener("click", () => this.invoke("ready", { ready: !this.myPlayer()?.ready }));
    byId("start-match").addEventListener("click", () => this.invoke("startMatch"));
    byId("practice-role").addEventListener("change", () => this.invoke("practiceRole", { role: byId("practice-role").value }));
    byId("lobby-chat-form").addEventListener("submit", (event) => this.submitChat(event, "lobby-chat-input"));
    byId("meeting-chat-form").addEventListener("submit", (event) => this.submitChat(event, "meeting-chat-input"));
    byId("task-list-toggle").addEventListener("click", () => byId("task-list").classList.toggle("is-collapsed"));
    byId("report-button").addEventListener("click", () => this.invoke("report"));
    byId("primary-ability").addEventListener("click", () => this.invoke("primaryAbility"));
    byId("role-ability").addEventListener("click", () => this.invoke("roleAbility"));
    byId("meeting-button").addEventListener("click", () => this.invoke("emergencyMeeting"));
    byId("secondary-ability").addEventListener("click", () => this.openModal("sabotage"));
    byId("vote-skip").addEventListener("click", () => this.invoke("vote", { targetId: "skip" }));
    byId("resume-game").addEventListener("click", () => this.closeModal("pause"));
    byId("first-run-dismiss").addEventListener("click", () => this.dismissFirstRunHint());
    byId("results-lobby").addEventListener("click", () => this.invoke("returnLobby"));
    byId("results-menu").addEventListener("click", () => this.invoke("leaveRoom"));
    byId("save-settings").addEventListener("click", () => this.invoke("saveSettings", this.readSettingsForm()));
    document.querySelectorAll("[data-open-modal]").forEach((button) => button.addEventListener("click", () => this.openModal(button.dataset.openModal)));
    document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", () => this.closeModal(button.dataset.closeModal)));
    for (const id of ["setting-max-players", "setting-operatives", "setting-tasks", "setting-discussion", "setting-voting"]) {
      byId(id).addEventListener("input", () => this.updateSettingOutputs());
      byId(id).addEventListener("change", () => this.sendHostSettings());
    }
    byId("setting-anonymous").addEventListener("change", () => this.sendHostSettings());
    byId("setting-map").addEventListener("change", () => this.sendHostSettings());
    this.buildSabotageOptions();
  }

  invoke(action, payload = {}) {
    try {
      const result = this.actions[action]?.(payload);
      if (result?.catch) result.catch((error) => this.toast(error.message, true));
      return result;
    } catch (error) {
      this.toast(error.message, true);
      return null;
    }
  }

  async copyRoomCode() {
    const code = this.room?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.toast(`Room code ${code} copied.`);
    } catch {
      this.toast(`Room code is ${code}.`);
    }
  }

  showAuthTab(tab) {
    document.querySelectorAll("[data-auth-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.authTab === tab));
    for (const name of ["guest", "login", "register"]) setVisible(byId(`${name}-form`), name === tab);
  }

  setAuthMessage(message, error = false) {
    const element = byId("auth-message");
    element.textContent = message ?? "";
    element.style.color = error ? "#ff9ba6" : "#69efb2";
  }

  setLoading({ progress, category, asset, error, assetsReady, serverReady, databaseConnected, databaseConfigured }) {
    if (Number.isFinite(progress)) {
      byId("loading-bar").style.width = `${Math.round(progress * 100)}%`;
      byId("loading-percent").textContent = `${Math.round(progress * 100)}%`;
    }
    if (category) byId("loading-category").textContent = category;
    if (asset) byId("loading-asset").textContent = asset;
    if (serverReady !== undefined) {
      byId("loading-server").textContent = serverReady ? "Online" : "Connecting";
      byId("loading-server-dot").className = `status-dot ${serverReady ? "is-online" : "is-pending"}`;
      setVisible(byId("loading-reconnect"), !serverReady);
    }
    if (databaseConfigured !== undefined) {
      const text = databaseConnected ? "Connected" : databaseConfigured ? "Unavailable" : "Guest mode";
      byId("loading-db").textContent = text;
      byId("loading-db-dot").className = `status-dot ${databaseConnected ? "is-online" : databaseConfigured ? "is-offline" : "is-pending"}`;
    }
    if (error) { byId("loading-error").textContent = error; setVisible(byId("loading-error"), true); setVisible(byId("loading-retry"), true); }
    byId("loading-continue").disabled = !(assetsReady && serverReady);
  }

  enterApp() { setVisible(this.elements.loading, false); setVisible(this.elements.app, true); this.showScreen("auth"); }

  // "lobby" and "game" are both played inside the Phaser world, so they show an
  // overlay rather than one of the full-screen menu surfaces.
  showScreen(name) {
    for (const key of ["auth", "menu", "results"]) setVisible(this.elements[key], key === name);
    if (name !== "game") setVisible(this.elements.firstRunHint, false);
    setVisible(this.elements.lobbyHud, name === "lobby");
    setVisible(this.elements.hud, name === "game");
    if (name !== "lobby") this.closeModal("lobbySettings");
  }

  showMainMenu(auth) {
    this.showScreen("menu");
    byId("menu-display-name").textContent = auth.displayName;
    byId("menu-account-type").textContent = auth.guest ? "Guest clearance" : "Persistent account";
  }

  showLobby(room, playerId) {
    this.playerId = playerId ?? this.playerId;
    this.updateRoom(room);
    this.showScreen("lobby");
  }

  updateRoom(room) {
    if (!room) return;
    const previousMapId = this.room?.mapId;
    this.room = room;
    byId("lobby-code").textContent = room.code;
    byId("lobby-mode").textContent = titleCase(room.mode);
    byId("lobby-count").textContent = `${room.players.length} / ${room.settings.maxPlayers}`;
    setVisible(byId("practice-role-wrap"), room.mode === "practice");
    this.renderLobbySettings(room);
    this.renderRoster(room.players);
    this.syncHostControls();
    this.updateTaskProgress(room.taskProgress);
    if (room.activeSabotage) this.updateSabotage(room.activeSabotage); else this.clearSabotage();
    if (previousMapId !== room.mapId) this.buildSabotageOptions(room.mapId);
    const me = this.myPlayer();
    if (me) byId("ready-button").textContent = me.ready ? "Ready ✓" : "Mark Ready";
  }

  myPlayer() { return this.room?.players.find((player) => player.id === this.playerId) ?? null; }

  renderLobbySettings(room) {
    const list = byId("lobby-settings-list");
    list.replaceChildren();
    const rows = [
      ["Map", getMapDefinition(room.mapId).name],
      ["Operatives", room.settings.operativeCount],
      ["Max crew", room.settings.maxPlayers],
      ["Assignments", room.settings.assignmentQuantity],
      ["Emergency calls", room.settings.emergencyMeetings],
      ["Discussion", `${room.settings.discussionSeconds}s`],
      ["Voting", `${room.settings.votingSeconds}s`],
      ["Anonymous votes", room.settings.anonymousVoting ? "On" : "Off"]
    ];
    for (const [label, value] of rows) {
      const term = document.createElement("dt"); term.textContent = label;
      const detail = document.createElement("dd"); detail.textContent = String(value);
      list.append(term, detail);
    }
  }

  renderRoster(players = []) {
    const list = byId("lobby-player-list");
    list.replaceChildren();
    for (const player of players) {
      const row = document.createElement("li"); row.className = "player-row";
      row.style.setProperty("--player-colour", COLOURS[player.appearance?.colour] ?? COLOURS.cyan);
      const swatch = document.createElement("span"); swatch.className = "player-swatch";
      const identity = document.createElement("span");
      const name = document.createElement("b"); name.textContent = player.displayName;
      const detail = document.createElement("small"); detail.textContent = `${titleCase(player.appearance?.symbol)}-${player.appearance?.number} ${player.bot ? "// SIM" : player.guest ? "// GUEST" : ""}`;
      identity.append(name, detail);
      const status = document.createElement("small");
      status.className = player.ready && !player.isHost ? "is-ready" : "";
      status.textContent = player.isHost ? "HOST" : player.ready ? "READY" : player.connected ? "STANDBY" : "LINK LOST";
      row.append(swatch, identity, status); list.append(row);
    }
  }

  syncHostControls() {
    const me = this.myPlayer();
    const host = me?.id === this.room?.hostId;
    const connectedHumans = this.room?.players.filter((player) => player.connected && !player.bot) ?? [];
    const everyoneReady = connectedHumans.length > 0 && connectedHumans.every((player) => player.ready);
    byId("start-match").disabled = !host || (this.room?.mode !== "practice" && !everyoneReady);
    byId("start-match").title = !host
      ? "Only the room host can launch."
      : this.room?.mode !== "practice" && !everyoneReady ? "Every connected player must be ready." : "";
    byId("host-settings").querySelectorAll("input, select").forEach((input) => { input.disabled = !host; });
    byId("setting-map").closest(".map-setting")?.classList.toggle("is-locked", !host);
    const settings = this.room?.settings;
    if (settings) {
      byId("setting-max-players").value = settings.maxPlayers;
      byId("setting-operatives").value = settings.operativeCount;
      byId("setting-tasks").value = settings.assignmentQuantity;
      byId("setting-discussion").value = settings.discussionSeconds;
      byId("setting-voting").value = settings.votingSeconds;
      byId("setting-anonymous").checked = settings.anonymousVoting;
      byId("setting-map").value = this.room?.mapId ?? settings.mapId ?? "the-skeld";
      this.updateSettingOutputs();
    }
  }

  updateSettingOutputs() {
    byId("setting-max-players-value").textContent = byId("setting-max-players").value;
    byId("setting-operatives-value").textContent = byId("setting-operatives").value;
    byId("setting-tasks-value").textContent = byId("setting-tasks").value;
    byId("setting-discussion-value").textContent = `${byId("setting-discussion").value}s`;
    byId("setting-voting-value").textContent = `${byId("setting-voting").value}s`;
  }

  sendHostSettings() {
    this.invoke("hostSettings", {
      maxPlayers: Number(byId("setting-max-players").value), operativeCount: Number(byId("setting-operatives").value),
      assignmentQuantity: Number(byId("setting-tasks").value), discussionSeconds: Number(byId("setting-discussion").value),
      votingSeconds: Number(byId("setting-voting").value), anonymousVoting: byId("setting-anonymous").checked,
      mapId: byId("setting-map").value
    });
  }

  showGame() {
    this.showScreen("game");
    this.maybeShowFirstRunHint();
  }

  maybeShowFirstRunHint() {
    if (this.firstRunHintHandled) return;
    let acknowledged = false;
    try {
      acknowledged = localStorage.getItem(FIRST_RUN_KEY) === "1";
    } catch {
      acknowledged = false;
    }
    if (acknowledged) {
      this.firstRunHintHandled = true;
      return;
    }
    const practice = this.room?.mode === "practice";
    setVisible(byId("first-run-note"), practice);
    setVisible(this.elements.firstRunHint, true);
  }

  dismissFirstRunHint() {
    this.firstRunHintHandled = true;
    setVisible(this.elements.firstRunHint, false);
    try {
      localStorage.setItem(FIRST_RUN_KEY, "1");
    } catch {
      /* private browsing: the hint simply returns next session */
    }
  }

  setPrivateState(state) {
    const previousRole = this.privateState?.role;
    this.privateState = state;
    const operative = state.faction === "operative";
    const neutral = state.faction === "neutral";
    const definition = getRoleDefinition(state.role);
    byId("hud-role").textContent = definition.name.toUpperCase();
    byId("hud-role").style.color = definition.colour;
    byId("hud-objective").textContent = definition.objective;
    const ghostRole = state.role === "guardian-angel";
    setVisible(byId("primary-ability"), operative && state.alive);
    setVisible(byId("secondary-ability"), operative);
    const roleAbility = definition.ability;
    setVisible(byId("role-ability"), Boolean(roleAbility && (state.alive || ghostRole)));
    if (roleAbility) {
      byId("role-ability-icon").src = roleAbility.icon;
      byId("role-ability-icon").alt = "";
      byId("role-ability-label").textContent = roleAbility.label;
    }
    this.renderTasks(state.tasks, state.completedTaskIds);
    byId("role-reveal-title").textContent = definition.name;
    byId("role-reveal-description").textContent = definition.objective;
    byId("role-reveal-title").style.color = definition.colour;
    this.elements.roleReveal.classList.toggle("is-operative", operative);
    this.elements.roleReveal.classList.toggle("is-neutral", neutral);
    if (previousRole !== state.role) {
      setVisible(this.elements.roleReveal, true);
      setTimeout(() => setVisible(this.elements.roleReveal, false), 3200);
    }
    this.updateRoleAbility(Date.now());
  }

  renderTasks(tasks = [], completedIds = []) {
    this.updatePersonalProgress();
    const completed = new Set(completedIds);
    const list = byId("task-list-items"); list.replaceChildren();
    for (const task of tasks) {
      const item = document.createElement("li");
      item.textContent = `${completed.has(task.id) ? "✓ " : ""}${task.name} — ${titleCase(task.roomId)}${task.fake ? " [SIM]" : ""}`;
      if (completed.has(task.id)) item.style.opacity = ".45";
      list.append(item);
    }
  }

  // The shared meter counts every crew member, bots included, so it can move while the
  // player stands still. The personal line makes that legible instead of confusing.
  updateTaskProgress(progress = { completed: 0, total: 0 }) {
    const percent = progress.total ? Math.min(100, progress.completed / progress.total * 100) : 0;
    byId("mission-meter-bar").style.width = `${percent}%`;
    this.sharedProgress = progress;
    this.updatePersonalProgress();
  }

  updatePersonalProgress() {
    const labels = progressLabels(
      this.sharedProgress ?? { completed: 0, total: 0 },
      this.privateState?.tasks ?? [],
      this.privateState?.completedTaskIds ?? []
    );
    byId("mission-meter-label").textContent = labels.crew;
    const personal = byId("personal-progress-label");
    if (personal) personal.textContent = labels.personal;
  }

  updatePlayerHud(snapshot, roomName, pingMs) {
    byId("hud-room").textContent = roomName ?? titleCase(snapshot?.roomId ?? "Transit");
    byId("hud-ping").textContent = pingMs == null ? "— ms" : `${pingMs} ms`;
    byId("lobby-ping").textContent = pingMs == null ? "— ms" : `${pingMs} ms`;
  }

  setPhase(phase, endsAt) {
    byId("hud-phase").textContent = titleCase(phase);
    this.meetingPhase = phase;
    if (["incidentTransition", "discussion", "voting", "removal"].includes(phase)) setVisible(this.elements.meeting, true);
    if (phase === "active") setVisible(this.elements.meeting, false);
    if (endsAt) this.startPhaseTimer(endsAt);
  }

  startPhaseTimer(endsAt) {
    clearInterval(this.phaseTimer);
    const update = () => {
      const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      byId("meeting-timer").textContent = `${seconds}s`;
      if (seconds <= 0) clearInterval(this.phaseTimer);
    };
    update(); this.phaseTimer = setInterval(update, 250);
  }

  // Vent panel: while inside, the only actions are hopping and climbing out.
  showVent(vent) {
    const panel = byId("vent-panel");
    setVisible(panel, Boolean(vent?.inVent));
    if (!vent?.inVent) return;
    const list = byId("vent-exits");
    list.replaceChildren();
    for (const exit of vent.exits) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = titleCase(exit.roomId);
      button.addEventListener("click", () => this.invoke("hopVent", { stationId: exit.id }));
      list.append(button);
    }
  }

  updateInteraction(nearest, inLobby = false) {
    const prompt = byId("interaction-prompt");
    setVisible(byId("report-button"), false);
    setVisible(byId("meeting-button"), false);
    if (!nearest) { setVisible(prompt, false); return; }
    const labels = { task: "Access assignment", repair: "Repair system", meeting: "Call emergency meeting", security: "Watch the cameras", doorLogs: "Review door logs", admin: "Read the admin table", maintenance: "Climb into the vent", incident: "Report incident", launch: "Launch the operation" };
    prompt.querySelector("span").textContent = labels[nearest.station.type] ?? "Interact";
    setVisible(prompt, true);
    if (inLobby) return;
    setVisible(byId("report-button"), nearest.station.type === "incident");
    const meetingAvailable = nearest.station.type === "meeting"
      && (this.room?.mode === "practice" || (this.privateState?.emergencyMeetings ?? 0) > 0);
    setVisible(byId("meeting-button"), meetingAvailable);
    byId("meeting-button-count").textContent = this.room?.mode === "practice"
      ? "Practice"
      : `${this.privateState?.emergencyMeetings ?? 0} left`;
  }

  updateRoleAbility(now = Date.now()) {
    const definition = getRoleDefinition(this.privateState?.role);
    const button = byId("role-ability");
    const ghostRole = this.privateState?.role === "guardian-angel";
    if (!definition.ability || (!this.privateState?.alive && !ghostRole)) {
      setVisible(button, false);
      return;
    }
    const status = byId("role-ability-status");
    const view = roleAbilityStatus({
      mode: this.room?.mode,
      roleState: this.privateState.roleState ?? {},
      now
    });
    button.disabled = view.disabled;
    status.textContent = view.label;
    if (view.ariaLabel) status.setAttribute("aria-label", view.ariaLabel);
    else status.removeAttribute("aria-label");
  }

  // Escape opens a menu, not a pause: the server keeps simulating either way.
  syncPauseCopy() {
    const copy = pauseCopy(this.room?.mode);
    byId("pause-eyebrow").textContent = copy.eyebrow;
    byId("pause-note").textContent = copy.note;
  }

  updateSabotage(sabotage) {
    if (!sabotage) return this.clearSabotage();
    setVisible(byId("critical-alert"), true);
    byId("critical-name").textContent = sabotage.name.toUpperCase();
    clearInterval(this.sabotageTimer);
    const update = () => byId("critical-timer").textContent = String(Math.max(0, Math.ceil((sabotage.endsAt - Date.now()) / 1000)));
    update(); this.sabotageTimer = setInterval(update, 250);
  }

  clearSabotage() { clearInterval(this.sabotageTimer); setVisible(byId("critical-alert"), false); }

  buildSabotageOptions(mapId = this.room?.mapId) {
    const container = byId("sabotage-options");
    container.replaceChildren();
    const map = getMapDefinition(mapId);
    for (const sabotage of map.sabotageDefinitions) {
      const button = document.createElement("button"); button.type = "button";
      const name = document.createElement("b"); name.textContent = sabotage.name;
      const detail = document.createElement("small"); detail.textContent = `${titleCase(sabotage.roomId)} · ${sabotage.critical ? "critical" : "disruption"}`;
      button.append(name, detail);
      button.addEventListener("click", () => { this.invoke("sabotage", { sabotageId: sabotage.id }); this.closeModal("sabotage"); });
      container.append(button);
    }
  }

  showMeeting(payload) {
    setVisible(this.elements.meeting, true);
    byId("meeting-title").textContent = payload.incidentRoom ? `Incident in ${titleCase(payload.incidentRoom)}` : "Emergency crew meeting";
    const evidence = byId("meeting-evidence"); evidence.replaceChildren();
    if (!payload.evidence?.length) { const item = document.createElement("li"); item.textContent = "No reliable evidence recovered."; evidence.append(item); }
    for (const clue of payload.evidence ?? []) { const item = document.createElement("li"); item.textContent = `${titleCase(clue.type)}: ${clue.detail}`; evidence.append(item); }
    this.renderMeetingPlayers(false);
  }

  renderMeetingPlayers(voting) {
    const container = byId("meeting-players"); container.replaceChildren();
    for (const player of this.room?.players ?? []) {
      const card = document.createElement("div"); card.className = `meeting-player${player.alive ? "" : " is-dead"}`;
      const name = document.createElement("b"); name.textContent = player.displayName;
      const status = document.createElement("small"); status.textContent = player.alive ? player.voted ? "VOTED" : "ACTIVE" : "ORBITAL ECHO";
      card.append(name, status);
      if (voting && player.alive && this.myPlayer()?.alive && player.id !== this.playerId) {
        const button = document.createElement("button"); button.type = "button"; button.textContent = "Select for removal";
        button.addEventListener("click", () => this.invoke("vote", { targetId: player.id }));
        card.append(button);
      }
      container.append(card);
    }
  }

  setDiscussion(endsAt) { byId("meeting-status").textContent = "Discussion in progress"; this.renderMeetingPlayers(false); this.startPhaseTimer(endsAt); }
  setVoting(endsAt) { byId("meeting-status").textContent = "Select one player or skip"; this.renderMeetingPlayers(true); this.startPhaseTimer(endsAt); }
  showVoteResult(result) {
    byId("meeting-status").textContent = result.removedName ? `${result.removedName} was removed${result.faction ? ` — ${result.faction}` : ""}.` : result.tie ? "Vote tied. Nobody was removed." : "Vote skipped. Nobody was removed.";
    this.renderMeetingPlayers(false);
  }

  appendChat(payload) {
    const target = payload.channel === "lobby" ? byId("lobby-chat-log") : byId("meeting-chat-log");
    if (!target) return;
    const line = document.createElement("p"); line.className = "chat-message";
    const name = document.createElement("b"); name.textContent = `${payload.displayName}: `;
    const message = document.createElement("span"); message.textContent = payload.message;
    line.append(name, message); target.append(line);
    while (target.children.length > 60) target.firstElementChild.remove();
    target.scrollTop = target.scrollHeight;
  }

  submitChat(event, inputId) {
    event.preventDefault();
    const input = byId(inputId); const message = input.value.trim();
    if (!message) return;
    this.invoke("chat", { message }); input.value = "";
  }

  // Admin table: live head count per room.
  showAdmin(data) {
    const content = byId("admin-content");
    content.replaceChildren();
    const occupied = data.rooms.filter((room) => room.count > 0);
    const summary = document.createElement("p");
    summary.textContent = occupied.length
      ? `${occupied.reduce((total, room) => total + room.count, 0)} crew detected across ${occupied.length} rooms.`
      : "No crew detected on the deck.";
    content.append(summary);
    const grid = document.createElement("div");
    grid.className = "admin-grid";
    for (const room of data.rooms) {
      const cell = document.createElement("div");
      cell.className = `admin-room${room.count ? " is-occupied" : ""}`;
      const name = document.createElement("b"); name.textContent = room.name;
      const count = document.createElement("span"); count.textContent = String(room.count);
      cell.append(name, count);
      grid.append(cell);
    }
    content.append(grid);
    this.openModal("admin");
  }

  showSecurity(data) {
    const content = byId("security-content"); content.replaceChildren();
    const summary = document.createElement("p"); summary.textContent = `${data.motion.length} life signs on camera across ${new Set(data.motion.map((item) => item.roomId)).size} sectors.`;
    const list = document.createElement("ul");
    for (const log of data.doorLogs) { const item = document.createElement("li"); item.textContent = `${titleCase(log.from)} → ${titleCase(log.to)} · ${Math.max(1, Math.round((Date.now() - log.at) / 1000))}s ago`; list.append(item); }
    content.append(summary, list); this.openModal("security");
  }

  showResults(results) {
    this.showScreen("results");
    const titles = { crew: "Crew Victory", operative: "Operative Control", neutral: "Neutral Victory" };
    const colours = { crew: "#74e5ff", operative: "#ff5f6f", neutral: "#ff72dd" };
    byId("results-winner").textContent = titles[results.winner] ?? "Operation Complete";
    byId("results-winner").style.color = colours[results.winner] ?? "#74e5ff";
    byId("results-reason").textContent = `${titleCase(results.reason)} · ${results.durationSeconds}s operation`;
    const table = byId("results-table"); table.replaceChildren();
    for (const player of results.players) {
      const row = document.createElement("div"); row.className = "result-row";
      for (const value of [player.displayName, titleCase(player.role), `${player.score} pts`, `${player.stats.tasksCompleted} tasks`, `${player.stats.eliminations} elim.`]) {
        const span = document.createElement("span"); span.textContent = value; row.append(span);
      }
      table.append(row);
    }
    byId("results-save").textContent = "Match record pending…";
  }

  setSaveStatus(payload) { byId("results-save").textContent = payload.saved ? "Neon match record saved." : "Guest/local result only — database record unavailable."; }

  openModal(name) {
    const element = this.elements[name]; if (!element) return;
    if (name === "assets" && !this.assetArchiveBuilt) this.buildAssetArchive();
    if (name === "pause") this.syncPauseCopy();
    setVisible(element, true);
    this.actions.modalChanged?.({ open: true, name });
  }

  closeModal(name) {
    const element = this.elements[name]; if (!element) return;
    setVisible(element, false);
    this.actions.modalChanged?.({ open: false, name });
  }

  closeGameplayModals() {
    for (const name of ["minimap", "task", "meeting", "sabotage", "security", "pause"]) setVisible(this.elements[name], false);
  }

  buildAssetArchive() {
    this.assetArchiveBuilt = true;
    const categories = ["All", ...new Set(ART_CATALOG.map((asset) => asset.category))];
    const filters = byId("asset-filter");
    const render = (category) => {
      filters.querySelectorAll("button").forEach((button) => button.classList.toggle("is-active", button.textContent === category));
      const grid = byId("asset-grid"); grid.replaceChildren();
      for (const asset of ART_CATALOG.filter((item) => category === "All" || item.category === category)) {
        const card = document.createElement("article"); card.className = "asset-card";
        const image = document.createElement("img"); image.loading = "lazy"; image.src = asset.path; image.alt = asset.filename;
        const name = document.createElement("b"); name.textContent = asset.filename;
        const detail = document.createElement("small"); detail.textContent = `${asset.category} · ${asset.width}×${asset.height}`;
        card.append(image, name, detail); grid.append(card);
      }
    };
    for (const category of categories) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = category;
      button.addEventListener("click", () => render(category)); filters.append(button);
    }
    render("All");
  }

  fillSettings(settings) {
    byId("pref-master").value = settings.masterVolume; byId("pref-music").value = settings.musicVolume; byId("pref-sfx").value = settings.sfxVolume;
    byId("pref-camera").value = settings.cameraDistance; byId("pref-quality").value = settings.graphicsQuality;
    byId("pref-fps").checked = settings.showFps; byId("pref-reduced-motion").checked = settings.reducedMotion;
    byId("pref-screen-shake").checked = settings.screenShake; byId("pref-text-size").value = settings.textSize;
  }

  readSettingsForm() {
    return {
      masterVolume: Number(byId("pref-master").value), musicVolume: Number(byId("pref-music").value), sfxVolume: Number(byId("pref-sfx").value),
      cameraDistance: Number(byId("pref-camera").value), graphicsQuality: byId("pref-quality").value,
      showFps: byId("pref-fps").checked, reducedMotion: byId("pref-reduced-motion").checked,
      screenShake: byId("pref-screen-shake").checked, textSize: Number(byId("pref-text-size").value)
    };
  }

  // The canvas backing store is resized to whatever the modal actually leaves it, so
  // the authored bounds always fit instead of being cropped at narrow viewports.
  sizeMinimapCanvas(canvas) {
    const box = canvas.getBoundingClientRect();
    const style = window.getComputedStyle(canvas);
    const border = Number.parseFloat(style.borderLeftWidth || "0") * 2;
    const available = Math.max(240, Math.round(box.width - border) || 0);
    const modal = this.elements.minimap;
    const header = modal?.querySelector("header")?.getBoundingClientRect().height ?? 0;
    const legend = modal?.querySelector(".minimap-legend")?.getBoundingClientRect().height ?? 0;
    const footnote = modal?.querySelector("small")?.getBoundingClientRect().height ?? 0;
    const chrome = header + legend + footnote + 96;
    const height = Math.max(200, Math.min(Math.round(available * 0.66), Math.round(window.innerHeight - chrome)));
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(available * ratio);
    const backingHeight = Math.round(height * ratio);
    if (canvas.width !== width || canvas.height !== backingHeight) {
      canvas.width = width;
      canvas.height = backingHeight;
    }
    canvas.style.height = `${height}px`;
    return { width, height: backingHeight };
  }

  drawMinimap({ mapId = this.room?.mapId, playerPosition, tasks = [], completedTaskIds = [], sabotage = null }) {
    const canvas = byId("minimap-canvas");
    const context = canvas.getContext("2d");
    const map = getMapDefinition(mapId);
    const bounds = map.bounds;
    byId("minimap-title").textContent = map.name;
    this.sizeMinimapCanvas(canvas);
    this.lastMinimapRequest = { mapId, playerPosition, tasks, completedTaskIds, sabotage };
    const padding = Math.max(12, Math.round(Math.min(canvas.width, canvas.height) * 0.045));
    const mapWidth = bounds.maxX - bounds.minX;
    const mapHeight = bounds.maxZ - bounds.minZ;
    const scale = Math.min((canvas.width - padding * 2) / mapWidth, (canvas.height - padding * 2) / mapHeight);
    const offsetX = (canvas.width - mapWidth * scale) / 2;
    const offsetY = (canvas.height - mapHeight * scale) / 2;
    const sx = (x) => offsetX + (x - bounds.minX) * scale;
    const sy = (z) => offsetY + (z - bounds.minZ) * scale;
    const markerScale = Math.max(0.55, Math.min(1, Math.min(canvas.width, canvas.height) / 700));
    const roomPath = (room) => {
      context.beginPath();
      if (room.shape === "ellipse") {
        context.ellipse(sx(room.x), sy(room.z), room.width * scale / 2, room.depth * scale / 2, 0, 0, Math.PI * 2);
        return;
      }
      const authoredOutline = room.artClipPolygon ?? room.walkablePolygon;
      if (Array.isArray(authoredOutline) && authoredOutline.length >= 3) {
        const points = authoredOutline.map((point) => ({ x: room.x + point.x, z: room.z + point.z }));
        context.moveTo(sx(points[0].x), sy(points[0].z));
        for (const point of points.slice(1)) context.lineTo(sx(point.x), sy(point.z));
        context.closePath();
        return;
      }
      context.roundRect(
        sx(room.x - room.width / 2),
        sy(room.z - room.depth / 2),
        room.width * scale,
        room.depth * scale,
        Math.min(14, room.width * scale * 0.12)
      );
    };
    const currentRoom = playerPosition
      ? map.rooms.find((room) => pointInMapShape(playerPosition.x, playerPosition.z, room))
      : null;

    context.clearRect(0, 0, canvas.width, canvas.height);
    const background = context.createRadialGradient(canvas.width / 2, canvas.height / 2, 40, canvas.width / 2, canvas.height / 2, canvas.width * 0.65);
    background.addColorStop(0, "#12223f");
    background.addColorStop(1, "#030712");
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.save();
    context.globalAlpha = 0.14;
    context.strokeStyle = "#8ba6d6";
    context.lineWidth = 1;
    for (let x = offsetX; x <= canvas.width - offsetX; x += scale * 5) {
      context.beginPath(); context.moveTo(x, offsetY); context.lineTo(x, canvas.height - offsetY); context.stroke();
    }
    for (let y = offsetY; y <= canvas.height - offsetY; y += scale * 5) {
      context.beginPath(); context.moveTo(offsetX, y); context.lineTo(canvas.width - offsetX, y); context.stroke();
    }
    context.restore();

    for (const zone of (map.zones ?? []).filter((item) => item.minimap !== false)) {
      roomPath(zone);
      context.fillStyle = "rgba(86, 79, 128, .78)";
      context.strokeStyle = "rgba(197, 205, 242, .72)";
      context.lineWidth = 2;
      context.fill();
      context.stroke();
    }

    for (const corridor of map.corridors) {
      const x = sx(corridor.x - corridor.width / 2);
      const y = sy(corridor.z - corridor.depth / 2);
      const width = corridor.width * scale;
      const height = corridor.depth * scale;
      context.fillStyle = "rgba(211, 222, 255, .88)";
      context.strokeStyle = "rgba(255, 255, 255, .95)";
      context.lineWidth = 2;
      context.beginPath();
      context.roundRect(x, y, width, height, Math.min(8, width / 3, height / 3));
      context.fill();
      context.stroke();
    }

    for (const room of map.rooms) {
      roomPath(room);
      context.fillStyle = room.id === currentRoom?.id ? "rgba(47, 111, 255, .98)" : "rgba(32, 71, 218, .92)";
      context.strokeStyle = room.id === currentRoom?.id ? "#9ef4ff" : "#f4f7ff";
      context.lineWidth = room.id === currentRoom?.id ? 5 : 3;
      context.shadowColor = room.id === currentRoom?.id ? "rgba(83, 225, 255, .65)" : "rgba(11, 20, 61, .7)";
      context.shadowBlur = room.id === currentRoom?.id ? 18 : 8;
      context.fill();
      context.stroke();
      context.shadowBlur = 0;

      if (room.label !== false) {
        const fontSize = Math.max(8, Math.min(15, room.width * scale * 0.115));
        context.fillStyle = "#ffffff";
        context.strokeStyle = "rgba(5, 16, 53, .92)";
        context.lineWidth = 4;
        context.font = `800 ${fontSize}px Avenir Next, Inter, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.strokeText(room.name, sx(room.x), sy(room.z), room.width * scale - 10);
        context.fillText(room.name, sx(room.x), sy(room.z), room.width * scale - 10);
      }
    }

    const complete = new Set(completedTaskIds);
    for (const assignment of tasks.filter((task) => !complete.has(task.id))) {
      const definition = map.taskDefinitions.find((task) => task.id === assignment.id);
      if (!definition) continue;
      context.fillStyle = "#ffd63e";
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(sx(definition.x), sy(definition.z), 9 * markerScale, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = "#17213d";
      context.font = "900 13px Inter, sans-serif";
      context.fillText("!", sx(definition.x), sy(definition.z) + 1);
    }
    if (sabotage) {
      const definition = map.sabotageDefinitions.find((item) => item.id === sabotage.id);
      const room = map.rooms.find((item) => item.id === definition?.roomId);
      if (room) {
        context.fillStyle = "#ff684f";
        context.strokeStyle = "#fff1b6";
        context.lineWidth = 4;
        context.beginPath();
        context.arc(sx(room.x), sy(room.z), 14 * markerScale, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }
    }
    if (playerPosition) {
      const x = sx(playerPosition.x);
      const y = sy(playerPosition.z);
      context.fillStyle = "#ffffff";
      context.strokeStyle = "#55e8ff";
      context.lineWidth = 4;
      context.beginPath();
      context.arc(x, y, 10 * markerScale, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = "#ffffff";
      context.strokeStyle = "#07142d";
      context.lineWidth = 4;
      context.font = "900 11px Inter, sans-serif";
      context.strokeText("YOU", x, y - 19 * markerScale);
      context.fillText("YOU", x, y - 19 * markerScale);
    }
  }

  setConnection(connected) { setVisible(this.elements.disconnect, !connected); }
  updateFps(fps, visible) { setVisible(byId("telemetry"), visible); byId("fps-value").textContent = String(Math.round(fps)); }

  toast(message, error = false) {
    const toast = document.createElement("div"); toast.className = `toast${error ? " is-error" : ""}`; toast.textContent = message;
    byId("toast-region").append(toast); setTimeout(() => toast.remove(), 4200);
  }
}
