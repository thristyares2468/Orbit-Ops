import { repairPanelFor } from "./sabotage/repairPanels.js";
import { claimTaskModal, ownsTaskModal, releaseTaskModal } from "./taskModalOwner.js";

// Drives a sabotage repair panel. It borrows the task modal's shell rather than
// adding a second one, but the flow is its own: repair panels are shared between
// everyone working the outage, so the server pushes updates and the open panel
// repaints, which is how you see somebody flip a breaker back down.

const PANEL_ART = Object.freeze({
  switches: "/assets/art/Tasks/SwitchesPanel-sharedassets0.assets-100.png",
  keypad: "/assets/art/Tasks/KeypadGame-sharedassets0.assets-148.png",
  radio: "/assets/art/Tasks/Radio-sharedassets0.assets-76.png",
  handprint: "/assets/art/Tasks/reactorMeltdown_handprintBase-sharedassets0.assets-124.png"
});

export class RepairInterface {
  constructor(network, audio) {
    this.network = network;
    this.audio = audio;
    this.modal = document.querySelector("#task-modal");
    this.title = document.querySelector("#task-title");
    this.room = document.querySelector("#task-room");
    this.art = document.querySelector("#task-reference-art");
    this.instruction = document.querySelector("#task-instruction");
    this.stage = document.querySelector("#task-challenge");
    this.controls = document.querySelector("#task-controls");
    this.progressBar = document.querySelector("#task-progress-bar");
    this.feedback = document.querySelector("#task-feedback");
    this.active = null;
    this.live = null;
    // The task interface owns the same button; each only acts on its own session.
    document.querySelector("#task-cancel")?.addEventListener("click", () => {
      if (this.active && ownsTaskModal(this)) this.close();
    });
  }

  get isOpen() { return Boolean(this.active); }

  open(payload) {
    const kind = payload?.panel?.kind;
    const panel = repairPanelFor(kind);
    if (!panel) return false;
    if (!claimTaskModal(this)) return false;
    this.dispose();
    this.active = { stationId: payload.stationId, sabotageId: payload.sabotage?.id, kind };

    this.title.textContent = payload.sabotage?.name ?? panel.title;
    this.room.textContent = `${payload.stationLabel ?? "repair panel"} // emergency`;
    this.art.src = PANEL_ART[kind] ?? PANEL_ART.switches;
    this.art.alt = "";
    this.instruction.textContent = panel.instruction;
    this.feedback.textContent = "";
    this.progressBar.style.width = "0%";
    this.stage.replaceChildren();
    this.controls.replaceChildren();
    this.modal.classList.remove("is-hidden");

    this.live = panel.build({
      root: this.stage,
      panel: payload.panel,
      station: payload.stationId,
      status: (text) => { this.feedback.textContent = text; },
      act: (body) => this.act(body)
    }) ?? null;
    return true;
  }

  async act(body = {}) {
    if (!this.active) return null;
    const result = await this.network.request("repairAction", {
      stationId: this.active.stationId,
      ...body
    });
    if (result?.solved) {
      this.audio.playCue("complete");
      this.feedback.textContent = "System restored.";
      this.progressBar.style.width = "100%";
      this.dispose();
      setTimeout(() => this.close(), 650);
    } else if (result?.rejected) {
      this.audio.playCue("fail");
    }
    return result;
  }

  // Somebody else changed the shared panel: repaint without disturbing this
  // player's own input.
  applyPanel(payload) {
    if (!this.active || payload?.sabotageId !== this.active.sabotageId) return;
    this.live?.paint?.(payload.panel);
  }

  // The outage ended - by someone else finishing it, or by a meeting.
  sabotageEnded() {
    if (this.active) this.close();
  }

  dispose() {
    try { this.live?.teardown?.(); } catch { /* a torn-down panel must not block the next */ }
    this.live = null;
  }

  close() {
    if (!ownsTaskModal(this)) return false;
    this.dispose();
    this.active = null;
    this.stage.replaceChildren();
    this.modal.classList.add("is-hidden");
    releaseTaskModal(this);
    return true;
  }
}
