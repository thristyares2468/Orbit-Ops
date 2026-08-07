import { minigameFor } from "./tasks/minigames.js";

// The console art each assignment opens against, all from the game's own set.
const TASK_ART = Object.freeze({
  wiring: "/assets/art/Tasks/WiresPanel-sharedassets0.assets-174.png",
  card: "/assets/art/Tasks/CardSlide-sharedassets0.assets-169.png",
  upload: "/assets/art/Tasks/UploadData-sharedassets0.assets-116.png",
  garbage: "/assets/art/Tasks/EmptyGarbage-sharedassets0.assets-63.png",
  fuel: "/assets/art/Tasks/FillCanisters-sharedassets0.assets-131.png",
  power: "/assets/art/Tasks/electricity_Divert_Base-sharedassets0.assets-205.png",
  reactor: "/assets/art/Tasks/SimonSays-sharedassets0.assets-202.png",
  manifolds: "/assets/art/Tasks/UnlockManifolds-sharedassets0.assets-128.png",
  align: "/assets/art/Tasks/engineAlign_base-sharedassets0.assets-85.png",
  asteroids: "/assets/art/Tasks/Weapons-sharedassets0.assets-173.png",
  shields: "/assets/art/Tasks/Shields-sharedassets0.assets-59.png",
  course: "/assets/art/Tasks/SetCourse-sharedassets0.assets-107.png",
  steering: "/assets/art/Tasks/nav_stabilize_base-sharedassets0.assets-167.png",
  scan: "/assets/art/Tasks/MedScan-sharedassets0.assets-61.png",
  sample: "/assets/art/Tasks/MedSample-sharedassets0.assets-101.png",
  o2filter: "/assets/art/Tasks/MonitorOxy-sharedassets0.assets-182.png",
  calibrate: "/assets/art/Tasks/Calibrator-sharedassets0.assets-207.png"
});

const FALLBACK_ART = "/assets/art/Tasks/TaskAdder-sharedassets0.assets-192.png";

export class TaskInterface {
  constructor(network, audio) {
    this.network = network;
    this.audio = audio;
    this.modal = document.querySelector("#task-modal");
    this.title = document.querySelector("#task-title");
    this.room = document.querySelector("#task-room");
    this.art = document.querySelector("#task-reference-art");
    this.instruction = document.querySelector("#task-instruction");
    this.challengeElement = document.querySelector("#task-challenge");
    this.controls = document.querySelector("#task-controls");
    this.progressBar = document.querySelector("#task-progress-bar");
    this.feedback = document.querySelector("#task-feedback");
    this.active = null;
    this.teardown = null;
    document.querySelector("#task-cancel").addEventListener("click", () => this.close());
  }

  open(payload) {
    const task = payload.task;
    const game = minigameFor(task.kind);
    this.disposeStage();
    this.active = {
      task,
      challenge: payload.challenge,
      step: 0,
      steps: Math.max(1, task.steps ?? 1),
      busy: false
    };

    this.title.textContent = task.name;
    // A task spanning several rooms says which leg this console is.
    const where = task.siteCount > 1
      ? `${task.siteLabel ?? task.roomId} · leg ${task.site + 1} of ${task.siteCount}`
      : String(task.roomId).replaceAll("-", " ");
    this.room.textContent = `${where} // ${task.fake ? "simulation" : "assignment"}`;
    this.art.src = TASK_ART[task.kind] ?? FALLBACK_ART;
    this.art.alt = "";
    this.instruction.textContent = game?.instruction ?? "Work the console.";
    this.feedback.textContent = task.fake
      ? "Operative simulation: this will not advance Crew progress."
      : "Awaiting input.";
    this.progressBar.style.width = "0%";
    this.challengeElement.replaceChildren();
    this.controls.replaceChildren();
    this.modal.classList.remove("is-hidden");
    this.buildStage();
  }

  // Each step gets a fresh board: Simon Says grows a square, the distributor
  // spins faster, and neither should inherit the last round's half-finished state.
  buildStage() {
    if (!this.active) return;
    const game = minigameFor(this.active.task.kind);
    this.challengeElement.replaceChildren();
    if (!game) {
      this.challengeElement.append(Object.assign(document.createElement("p"), {
        textContent: "This console has no interface fitted."
      }));
      return;
    }
    this.teardown = game.build({
      root: this.challengeElement,
      challenge: this.active.challenge,
      steps: this.active.steps,
      step: this.active.step,
      site: this.active.task.site ?? 0,
      taskId: this.active.task.id,
      status: (text) => { this.feedback.textContent = text; },
      complete: () => this.claimStep()
    }) ?? null;
  }

  disposeStage() {
    try { this.teardown?.(); } catch { /* a torn-down board must never block the next */ }
    this.teardown = null;
  }

  // Claim the outstanding step. The server counts the steps and decides when the
  // console, and the assignment behind it, is finished.
  async claimStep() {
    if (!this.active || this.active.busy) return;
    this.active.busy = true;
    try {
      const result = await this.network.request("taskAction", {
        taskId: this.active.task.id,
        step: this.active.step
      });
      if (result.completed) {
        this.audio.playCue("complete");
        this.feedback.textContent = "Assignment complete.";
        this.progressBar.style.width = "100%";
        this.disposeStage();
        setTimeout(() => this.close(), 700);
        return;
      }
      if (result.siteComplete) {
        this.audio.playCue("complete");
        this.feedback.textContent = `Done here — continue in ${result.nextLabel}.`;
        this.progressBar.style.width = "100%";
        this.disposeStage();
        setTimeout(() => this.close(), 1400);
        return;
      }
      this.active.step = result.progress;
      this.progressBar.style.width = `${(result.progress / result.total) * 100}%`;
      this.audio.playCue("interact");
      this.disposeStage();
      this.buildStage();
    } catch (error) {
      this.feedback.textContent = error.message;
      this.audio.playCue("fail");
    } finally {
      if (this.active) this.active.busy = false;
    }
  }

  close() {
    this.disposeStage();
    this.active = null;
    this.challengeElement.replaceChildren();
    this.modal.classList.add("is-hidden");
  }
}
