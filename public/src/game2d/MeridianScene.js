import { CharacterSprite } from "./CharacterSprite.js";
import { MapBuilder } from "./MapBuilder.js";
import {
  PHASER_ASSETS,
  PLAYER_MODEL_ASSETS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  worldToScreen
} from "./assets.js";

const Phaser = window.Phaser;

export class MeridianScene extends Phaser.Scene {
  constructor(bridge) {
    super({ key: "meridian" });
    this.bridge = bridge;
    this.characters = new Map();
    this.incidentMarkers = new Map();
    this.stationMarkers = [];
    this.sabotageOverlay = null;
    this.privateState = null;
  }

  preload() {
    for (const [key, path] of Object.entries(PHASER_ASSETS)) this.load.image(key, path);
    for (const asset of PLAYER_MODEL_ASSETS) this.load.image(asset.key, asset.path);
  }

  create() {
    this.cameras.main.setBackgroundColor("#02060c");
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setRoundPixels(true);

    this.mapBuilder = new MapBuilder(this).build();
    this.stationMarkers = this.mapBuilder.stationMarkers;

    this.sabotageOverlay = this.add.rectangle(
      WORLD_WIDTH / 2,
      WORLD_HEIGHT / 2,
      WORLD_WIDTH,
      WORLD_HEIGHT,
      0xc31530,
      0
    ).setDepth(450);

    this.bridge.onSceneReady(this);
  }

  syncPlayers(players, localPlayerId, latestSnapshots) {
    const ids = new Set(players.map((player) => player.id));
    for (const player of players) {
      let character = this.characters.get(player.id);
      if (!character) {
        character = new CharacterSprite(this, player, player.id === localPlayerId);
        this.characters.set(player.id, character);
        const snapshot = latestSnapshots.get(player.id) ?? {
          x: 0,
          z: 0,
          alive: player.alive,
          animation: "idle"
        };
        character.applySnapshot(snapshot, true);
      }
    }
    for (const [id, character] of this.characters) {
      if (!ids.has(id)) {
        character.destroy();
        this.characters.delete(id);
      }
    }
    this.applyPrivateRoleState(this.privateState);
    this.followPlayer(localPlayerId);
  }

  applySnapshot(snapshot) {
    for (const player of snapshot.players ?? []) {
      this.characters.get(player.id)?.applySnapshot(player, false);
    }
    this.syncIncidents(snapshot.incidents ?? []);
  }

  applyPrivateRoleState(privateState) {
    this.privateState = privateState;
    const trackedTargetId = privateState?.roleState?.activeUntil > Date.now()
      ? privateState.roleState.trackedTargetId
      : null;
    for (const [playerId, character] of this.characters) {
      character.setTracked(playerId === trackedTargetId);
    }
  }

  syncIncidents(incidents) {
    const ids = new Set(incidents.map((incident) => incident.id));
    for (const incident of incidents) {
      if (this.incidentMarkers.has(incident.id)) continue;
      const point = worldToScreen(incident.x, incident.z);
      const glow = this.add.image(point.x, point.y, "incidentMarker")
        .setDisplaySize(72, 72)
        .setTint(0xff5369)
        .setAlpha(0.78)
        .setDepth(440);
      this.incidentMarkers.set(incident.id, glow);
    }
    for (const [id, marker] of this.incidentMarkers) {
      if (!ids.has(id)) {
        marker.destroy();
        this.incidentMarkers.delete(id);
      }
    }
  }

  followPlayer(playerId) {
    const character = this.characters.get(playerId);
    if (!character) return;
    this.cameras.main.startFollow(character.container, true, 0.12, 0.12);
  }

  applySettings(settings) {
    const zoom = Phaser.Math.Clamp(1.35 - (settings.cameraDistance - 4) * 0.065, 0.72, 1.35);
    this.cameras.main.setZoom(zoom);
    this.cameras.main.setRoundPixels(settings.graphicsQuality !== "high");
  }

  setSabotage(sabotage, timeSeconds) {
    if (!this.sabotageOverlay) return;
    const alpha = sabotage ? 0.055 + Math.sin(timeSeconds * 5) * 0.025 : 0;
    this.sabotageOverlay.setAlpha(alpha);
  }

  clearCharacters() {
    for (const character of this.characters.values()) character.destroy();
    this.characters.clear();
    this.privateState = null;
    this.cameras.main.stopFollow();
  }

  update(time, deltaMs) {
    const deltaSeconds = Math.min(0.1, Math.max(0.001, deltaMs / 1000));
    for (const character of this.characters.values()) {
      character.update(deltaSeconds, this.bridge.settings.reducedMotion);
    }
    for (const marker of this.stationMarkers) {
      marker.seed += deltaSeconds * 2.5;
      marker.ring.setAlpha(0.45 + Math.sin(marker.seed) * 0.16);
    }
    for (const marker of this.incidentMarkers.values()) {
      marker.setRotation(marker.rotation + deltaSeconds * 0.7);
      marker.setAlpha(0.58 + Math.sin(time / 250) * 0.18);
    }
    if (this.privateState?.roleState?.activeUntil && this.privateState.roleState.activeUntil <= Date.now()) {
      this.applyPrivateRoleState({
        ...this.privateState,
        roleState: { ...this.privateState.roleState, activeUntil: 0 }
      });
    }
    this.setSabotage(this.bridge.activeSabotage, time / 1000);
    this.bridge.onRenderFrame(time, deltaMs);
  }
}
