export class AudioManager {
  constructor(getSettings) {
    this.getSettings = getSettings;
    this.context = null;
    this.master = null;
    this.ambience = null;
    this.started = false;
    window.addEventListener("pointerdown", () => this.start(), { once: true });
    window.addEventListener("keydown", () => this.start(), { once: true });
  }

  async start() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
      this.createAmbience();
    }
    await this.context.resume();
    this.started = true;
    this.applySettings();
  }

  applySettings() {
    if (!this.master) return;
    const settings = this.getSettings();
    this.master.gain.setTargetAtTime(settings.masterVolume, this.context.currentTime, 0.03);
    if (this.ambience) this.ambience.gain.setTargetAtTime(settings.musicVolume * 0.13, this.context.currentTime, 0.25);
  }

  createAmbience() {
    const gain = this.context.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    const low = this.context.createOscillator();
    const upper = this.context.createOscillator();
    low.type = "sine"; low.frequency.value = 43;
    upper.type = "triangle"; upper.frequency.value = 86.4;
    low.connect(gain); upper.connect(gain);
    low.start(); upper.start();
    this.ambience = gain;
  }

  playCue(name) {
    if (!this.context || this.context.state !== "running") return;
    const settings = this.getSettings();
    const presets = {
      ui: [620, 0.06, "sine"], interact: [410, 0.1, "triangle"], complete: [840, 0.22, "sine"],
      fail: [150, 0.18, "sawtooth"], alarm: [115, 0.5, "square"], report: [220, 0.7, "sawtooth"],
      vote: [520, 0.18, "triangle"], eliminate: [72, 0.55, "sawtooth"], reconnect: [740, 0.2, "sine"]
    };
    const [frequency, duration, type] = presets[name] ?? presets.ui;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, this.context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.72), this.context.currentTime + duration);
    gain.gain.setValueAtTime(Math.max(0.0001, settings.sfxVolume * 0.12), this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(); oscillator.stop(this.context.currentTime + duration);
  }

  setEmergency(active) {
    if (!this.ambience || !this.context) return;
    const settings = this.getSettings();
    this.ambience.gain.setTargetAtTime(settings.musicVolume * (active ? 0.22 : 0.13), this.context.currentTime, 0.15);
  }
}
