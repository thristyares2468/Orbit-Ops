const TASK_ART = Object.freeze({
  "orbital-frequency": "/assets/art/Tasks/Radio-sharedassets0.assets-76.png",
  "core-pressure": "/assets/art/Tasks/Calibrator-sharedassets0.assets-207.png",
  "route-plotting": "/assets/art/Tasks/SetCourse-sharedassets0.assets-107.png",
  "signal-reconstruction": "/assets/art/Tasks/ProcessData-sharedassets0.assets-187.png",
  "sample-classification": "/assets/art/Tasks/SortGame-sharedassets0.assets-102.png",
  "filter-replacement": "/assets/art/Tasks/MonitorOxy-sharedassets0.assets-182.png",
  "cargo-manifest": "/assets/art/Tasks/BoardingPass-sharedassets0.assets-58.png",
  "engine-sync": "/assets/art/Tasks/engineAlign_base-sharedassets0.assets-85.png",
  "medical-diagnostic": "/assets/art/Tasks/MedScan-sharedassets0.assets-61.png",
  "drone-route": "/assets/art/Tasks/Wifi-sharedassets0.assets-91.png"
});

const TASK_INSTRUCTIONS = Object.freeze({
  wiring: "Join each loose wire to the terminal of the matching colour.",
  route: "Plot a safe course through every marked orbital sector.",
  sequence: "Reboot the transceiver by entering the restart sequence.",
  garbage: "Pull the release in order until the chute runs clear.",
  power: "Throw the breakers that divert power to the reactor.",
  balance: "Balance the engine output by confirming the highlighted order.",
  fuel: "Fill the can, carry it over, and pump the engine full.",
  asteroids: "Track and destroy each asteroid before it reaches the hull.",
  // Retained so older assignment kinds still read sensibly.
  frequency: "Match the four carrier bands in the transmitted order.",
  classify: "Classify the four samples by their telemetry signature.",
  filter: "Replace the damaged filters in the indicated airflow order.",
  manifest: "Verify each cargo record against the highlighted manifest code.",
  sync: "Synchronise the engine phases in the shown order.",
  scan: "Track the biological waveform through each diagnostic band."
});

const SYMBOLS = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ"];

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
    document.querySelector("#task-cancel").addEventListener("click", () => this.close());
  }

  open(payload) {
    const task = payload.task;
    this.active = { task, challenge: payload.challenge, progress: 0, busy: false };
    this.title.textContent = task.name;
    this.room.textContent = `${task.roomId.replaceAll("-", " ")} // ${task.fake ? "simulation" : "assignment"}`;
    this.art.src = TASK_ART[task.id] ?? "/assets/art/Tasks/TaskAdder-sharedassets0.assets-192.png";
    this.art.alt = `Provisional supplied artwork for ${task.name}`;
    this.instruction.textContent = TASK_INSTRUCTIONS[task.kind] ?? "Complete the signal sequence.";
    this.feedback.textContent = task.fake ? "Operative simulation: this will not advance Crew progress." : "Awaiting input.";
    this.progressBar.style.width = "0%";
    this.challengeElement.replaceChildren();
    this.controls.replaceChildren();
    payload.challenge.forEach((choice, index) => {
      const chip = document.createElement("div");
      chip.className = "challenge-chip";
      chip.dataset.step = String(index);
      chip.textContent = SYMBOLS[choice];
      this.challengeElement.append(chip);
    });
    SYMBOLS.forEach((symbol, choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "task-pad";
      button.textContent = symbol;
      button.setAttribute("aria-label", `Select signal ${choice + 1}`);
      button.addEventListener("click", () => this.choose(choice));
      this.controls.append(button);
    });
    this.modal.classList.remove("is-hidden");
  }

  async choose(choice) {
    if (!this.active || this.active.busy) return;
    this.active.busy = true;
    try {
      const result = await this.network.request("taskAction", { taskId: this.active.task.id, choice });
      if (result.completed) {
        this.audio.playCue("complete");
        this.feedback.textContent = "Assignment confirmed.";
        this.progressBar.style.width = "100%";
        setTimeout(() => this.close(), 650);
        return;
      }
      this.active.progress = result.progress;
      this.progressBar.style.width = `${(result.progress / result.total) * 100}%`;
      [...this.challengeElement.children].forEach((chip, index) => chip.classList.toggle("is-complete", index < result.progress));
      this.feedback.textContent = result.correct ? "Signal accepted." : "Mismatch — sequence stepped back.";
      this.audio.playCue(result.correct ? "interact" : "fail");
    } catch (error) {
      this.feedback.textContent = error.message;
      this.audio.playCue("fail");
    } finally {
      if (this.active) this.active.busy = false;
    }
  }

  close() {
    this.active = null;
    this.modal.classList.add("is-hidden");
  }
}
