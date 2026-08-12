const STORAGE_KEY = "orbitOps.settings.v1";

export const DEFAULT_PLAYER_SETTINGS = Object.freeze({
  masterVolume: 0.8,
  musicVolume: 0.42,
  sfxVolume: 0.72,
  mouseSensitivity: 1,
  cameraDistance: 8,
  invertY: false,
  graphicsQuality: "medium",
  showFps: true,
  showPing: true,
  colourBlindMode: "off",
  reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  screenShake: true,
  subtitles: true,
  textSize: 1,
  keybinds: {}
});

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return sanitiseSettings({ ...DEFAULT_PLAYER_SETTINGS, ...saved });
  } catch {
    return { ...DEFAULT_PLAYER_SETTINGS };
  }
}

export function saveSettings(settings) {
  const safe = sanitiseSettings(settings);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  applyDocumentSettings(safe);
  return safe;
}

export function applyDocumentSettings(settings) {
  document.documentElement.style.setProperty("--text-scale", String(settings.textSize));
  document.documentElement.dataset.reducedMotion = String(settings.reducedMotion);
}

function sanitiseSettings(value) {
  const clamp = (number, min, max, fallback) => Math.max(min, Math.min(max, Number(number) || fallback));
  return {
    masterVolume: clamp(value.masterVolume, 0, 1, 0.8),
    musicVolume: clamp(value.musicVolume, 0, 1, 0.42),
    sfxVolume: clamp(value.sfxVolume, 0, 1, 0.72),
    mouseSensitivity: clamp(value.mouseSensitivity, 0.1, 4, 1),
    cameraDistance: clamp(value.cameraDistance, 4, 14, 8),
    invertY: Boolean(value.invertY),
    graphicsQuality: ["low", "medium", "high"].includes(value.graphicsQuality) ? value.graphicsQuality : "medium",
    showFps: value.showFps !== false, showPing: value.showPing !== false,
    colourBlindMode: String(value.colourBlindMode ?? "off").slice(0, 20),
    reducedMotion: Boolean(value.reducedMotion), screenShake: value.screenShake !== false,
    subtitles: value.subtitles !== false,
    textSize: clamp(value.textSize, 0.8, 1.5, 1),
    keybinds: value.keybinds && typeof value.keybinds === "object" ? value.keybinds : {}
  };
}
