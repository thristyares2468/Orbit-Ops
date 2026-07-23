import { ART_CATALOG } from "./artCatalog.js";
import { getRoleDefinition } from "./roleData.js";
import { ROOMS, SABOTAGE_DEFINITIONS, TASK_DEFINITIONS } from "./shipData.js";

const COLOURS = Object.freeze({ cyan: "#27bad8", amber: "#e2a238", violet: "#805bd0", lime: "#54b86a", coral: "#d9575f", white: "#c8d8dd", blue: "#3f67c9", rose: "#c74f87" });

function byId(id) { return document.getElementById(id); }
function setVisible(element, visible) { element?.classList.toggle("is-hidden", !visible); }
function titleCase(value) { return String(value ?? "").replaceAll("-", " ").replace(/\b\w/gu, (character) => character.toUpperCase()); }

export class GameUI {
  constructor() {
    this.actions = {};
    this.room = null;
    this.playerId = null;
    this.privateState = null;
    this.meetingPhase = null;
    this.assetArchiveBuilt = false;
    this.elements = {
      loading: byId("loading-screen"), app: byId("app"), auth: byId("auth-screen"), menu: byId("main-menu"), lobby: byId("lobby-screen"),
      hud: byId("hud"), results: byId("results-screen"), disconnect: byId("disconnect-overlay"), roleReveal: byId("role-reveal"),
      minimap: byId("minimap"), task: byId("task-modal"), meeting: byId("meeting-modal"), sabotage: byId("sabotage-modal"), security: byId("security-modal"),
      pause: byId("pause-modal"), settings: byId("settings-modal"), howto: byId("howto-modal"), profile: byId("profile-modal"), assets: byId("assets-modal")
    };
    this.bindStaticEvents();
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

  showScreen(name) {
    for (const key of ["auth", "menu", "lobby", "results"]) setVisible(this.elements[key], key === name);
    if (["auth", "menu", "lobby", "results"].includes(name)) setVisible(this.elements.hud, false);
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
    this.room = room;
    byId("lobby-code").textContent = room.code;
    byId("lobby-mode").textContent = titleCase(room.mode);
    setVisible(byId("practice-role-wrap"), room.mode === "practice");
    this.renderRoster(room.players);
    this.syncHostControls();
    this.updateTaskProgress(room.taskProgress);
    if (room.activeSabotage) this.updateSabotage(room.activeSabotage); else this.clearSabotage();
    const me = this.myPlayer();
    if (me) byId("ready-button").textContent = me.ready ? "Ready ✓" : "Mark Ready";
  }

  myPlayer() { return this.room?.players.find((player) => player.id === this.playerId) ?? null; }

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
      const status = document.createElement("small"); status.textContent = player.isHost ? "HOST" : player.ready ? "READY" : player.connected ? "STANDBY" : "LINK LOST";
      row.append(swatch, identity, status); list.append(row);
    }
  }

  syncHostControls() {
    const me = this.myPlayer();
    const host = me?.id === this.room?.hostId;
    const connectedHumans = this.room?.players.filter((player) => player.connected && !player.bot) ?? [];
    const everyoneReady = connectedHumans.length > 0 && connectedHumans.every((player) => player.ready);
    byId("start-match").disabled = !host || (this.room?.mode !== "practice" && !everyoneReady);
    byId("start-match").title = this.room?.mode !== "practice" && !everyoneReady ? "Every connected player must be ready." : "";
    byId("host-settings").querySelectorAll("input").forEach((input) => { input.disabled = !host; });
    const settings = this.room?.settings;
    if (settings) {
      byId("setting-max-players").value = settings.maxPlayers;
      byId("setting-operatives").value = settings.operativeCount;
      byId("setting-tasks").value = settings.assignmentQuantity;
      byId("setting-discussion").value = settings.discussionSeconds;
      byId("setting-voting").value = settings.votingSeconds;
      byId("setting-anonymous").checked = settings.anonymousVoting;
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
      votingSeconds: Number(byId("setting-voting").value), anonymousVoting: byId("setting-anonymous").checked
    });
  }

  showGame() {
    for (const key of ["auth", "menu", "lobby", "results"] ) setVisible(this.elements[key], false);
    setVisible(this.elements.hud, true);
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
    setVisible(byId("primary-ability"), operative && state.alive);
    setVisible(byId("secondary-ability"), operative && state.alive);
    const roleAbility = definition.ability;
    setVisible(byId("role-ability"), Boolean(roleAbility && state.alive));
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
    const completed = new Set(completedIds);
    const list = byId("task-list-items"); list.replaceChildren();
    for (const task of tasks) {
      const item = document.createElement("li");
      item.textContent = `${completed.has(task.id) ? "✓ " : ""}${task.name} — ${titleCase(task.roomId)}${task.fake ? " [SIM]" : ""}`;
      if (completed.has(task.id)) item.style.opacity = ".45";
      list.append(item);
    }
  }

  updateTaskProgress(progress = { completed: 0, total: 0 }) {
    const percent = progress.total ? Math.min(100, progress.completed / progress.total * 100) : 0;
    byId("mission-meter-bar").style.width = `${percent}%`;
    byId("mission-meter-label").textContent = `${progress.completed} / ${progress.total} assignments`;
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

  updateInteraction(nearest) {
    const prompt = byId("interaction-prompt");
    setVisible(byId("report-button"), false);
    setVisible(byId("meeting-button"), false);
    if (!nearest) { setVisible(prompt, false); return; }
    const labels = { task: "Access assignment", repair: "Repair system", meeting: "Call emergency meeting", security: "Open camera telemetry", doorLogs: "Review door logs", maintenance: "Enter maintenance route", incident: "Report incident" };
    prompt.querySelector("span").textContent = labels[nearest.station.type] ?? "Interact";
    setVisible(prompt, true);
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
    if (!definition.ability || !this.privateState?.alive) {
      setVisible(button, false);
      return;
    }
    const state = this.privateState.roleState ?? {};
    const cooldownSeconds = Math.max(0, Math.ceil(((state.cooldownEndsAt ?? 0) - now) / 1000));
    const activeSeconds = Math.max(0, Math.ceil(((state.activeUntil ?? 0) - now) / 1000));
    const exhausted = state.usesLeft !== null && state.usesLeft <= 0;
    button.disabled = cooldownSeconds > 0 || exhausted;
    if (activeSeconds > 0) byId("role-ability-status").textContent = `ACTIVE ${activeSeconds}s`;
    else if (cooldownSeconds > 0) byId("role-ability-status").textContent = `${cooldownSeconds}s`;
    else if (state.usesLeft !== null) byId("role-ability-status").textContent = `${Math.max(0, state.usesLeft)} use${state.usesLeft === 1 ? "" : "s"}`;
    else byId("role-ability-status").textContent = "Ready";
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

  buildSabotageOptions() {
    const container = byId("sabotage-options");
    for (const sabotage of SABOTAGE_DEFINITIONS) {
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

  showSecurity(data) {
    const content = byId("security-content"); content.replaceChildren();
    const summary = document.createElement("p"); summary.textContent = `${data.motion.length} life signs detected across ${new Set(data.motion.map((item) => item.roomId)).size} sectors (two-second delay).`;
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

  drawMinimap({ playerPosition, tasks = [], completedTaskIds = [], sabotage = null }) {
    const canvas = byId("minimap-canvas"); const context = canvas.getContext("2d");
    const bounds = { minX: -62, maxX: 48, minZ: -45, maxZ: 30 };
    const sx = (x) => (x - bounds.minX) / (bounds.maxX - bounds.minX) * canvas.width;
    const sy = (z) => (z - bounds.minZ) / (bounds.maxZ - bounds.minZ) * canvas.height;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#040b12"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(105,220,255,.28)"; context.lineWidth = 2;
    for (const room of ROOMS) {
      const x = sx(room.x - room.width / 2); const y = sy(room.z - room.depth / 2);
      const width = room.width / (bounds.maxX - bounds.minX) * canvas.width; const height = room.depth / (bounds.maxZ - bounds.minZ) * canvas.height;
      context.fillStyle = "rgba(28,64,81,.6)"; context.fillRect(x, y, width, height); context.strokeRect(x, y, width, height);
      context.fillStyle = "#8fb6c7"; context.font = "11px Avenir Next"; context.textAlign = "center"; context.fillText(room.name, sx(room.x), sy(room.z));
    }
    const complete = new Set(completedTaskIds);
    context.fillStyle = "#74e5ff";
    for (const assignment of tasks.filter((task) => !complete.has(task.id))) {
      const definition = TASK_DEFINITIONS.find((task) => task.id === assignment.id); if (!definition) continue;
      context.beginPath(); context.arc(sx(definition.x), sy(definition.z), 6, 0, Math.PI * 2); context.fill();
    }
    if (sabotage) {
      const definition = SABOTAGE_DEFINITIONS.find((item) => item.id === sabotage.id); const room = ROOMS.find((item) => item.id === definition?.roomId);
      if (room) { context.fillStyle = "#ffc45e"; context.beginPath(); context.arc(sx(room.x), sy(room.z), 10, 0, Math.PI * 2); context.fill(); }
    }
    if (playerPosition) { context.fillStyle = "#ffffff"; context.beginPath(); context.arc(sx(playerPosition.x), sy(playerPosition.z), 8, 0, Math.PI * 2); context.fill(); context.strokeStyle = "#74e5ff"; context.stroke(); }
  }

  setConnection(connected) { setVisible(this.elements.disconnect, !connected); }
  updateFps(fps, visible) { setVisible(byId("telemetry"), visible); byId("fps-value").textContent = String(Math.round(fps)); }

  toast(message, error = false) {
    const toast = document.createElement("div"); toast.className = `toast${error ? " is-error" : ""}`; toast.textContent = message;
    byId("toast-region").append(toast); setTimeout(() => toast.remove(), 4200);
  }
}
