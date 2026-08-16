import { CharacterSprite } from "./CharacterSprite.js";
import { MapBuilder } from "./MapBuilder.js";
import { VisionOverlay } from "./VisionOverlay.js";
import { DoorOverlay } from "./DoorOverlay.js";
import { VentArrows } from "./VentArrows.js";
import { TrackerArrow } from "./TrackerArrow.js";
import { NetClock } from "../netClock.js";
import { DEFAULT_MAP_ID, getMapDefinition } from "../shipData.js";
import {
  PHASER_ASSETS,
  PLAYER_MODEL_ASSETS,
  worldDetailScale,
  worldMetrics,
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
    this.runtimeVentMarkers = new Map();
    this.sabotageOverlay = null;
    this.doorOverlay = null;
    this.privateState = null;
    this.ghostView = false;
    this.mapId = null;
    this.map = null;
    this.metrics = null;
    // Snapshots are 20/s; the clock decides how far behind them to draw others.
    this.netClock = new NetClock(1000 / 20);
    this.renderTime = null;
  }

  preload() {
    for (const [key, path] of Object.entries(PHASER_ASSETS)) this.load.image(key, path);
    for (const asset of PLAYER_MODEL_ASSETS) this.load.image(asset.key, asset.path);
  }

  create() {
    this.cameras.main.setBackgroundColor("#02060c");
    this.cameras.main.setRoundPixels(true);
    this.vision = new VisionOverlay(this);
    this.doorOverlay = new DoorOverlay(this);
    this.ventArrows = new VentArrows(this);
    this.trackerArrow = new TrackerArrow(this);
    this.setMap(this.bridge.activeMapId() ?? DEFAULT_MAP_ID);

    this.bridge.onSceneReady(this);
  }

  setMap(mapId) {
    const map = getMapDefinition(mapId);
    if (this.mapId === map.id && this.mapBuilder) return;
    this.clearCharacters();
    for (const marker of this.incidentMarkers.values()) marker.destroy();
    this.incidentMarkers.clear();
    this.sabotageOverlay?.destroy();
    this.ventArrows?.hide();
    this.trackerArrow?.hide();
    this.clearRuntimeVentMarkers();
    this.mapBuilder?.destroy();

    this.mapId = map.id;
    this.map = map;
    this.metrics = worldMetrics(map);
    this.detailScale = worldDetailScale(map);
    this.cameras.main.setBounds(0, 0, this.metrics.width, this.metrics.height);
    this.mapBuilder = new MapBuilder(this, map).build();
    this.doorOverlay?.setMap(map);
    this.stationMarkers = this.mapBuilder.stationMarkers;
    this.syncVentTopology(this.bridge.ventTopology);
    this.sabotageOverlay = this.add.rectangle(
      this.metrics.width / 2,
      this.metrics.height / 2,
      this.metrics.width,
      this.metrics.height,
      0xc31530,
      0
    ).setDepth(450);
  }

  mapPoint(x, z) {
    return worldToScreen(x, z, this.map);
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

  // When the local player is dead the whole scene renders dead crew as drifting
  // ghosts; the living instead keep each corpse frozen where it fell.
  setGhostView(enabled) {
    this.ghostView = Boolean(enabled);
  }

  markDead(playerId, vanish = false) {
    this.characters.get(playerId)?.markDead(vanish);
  }

  // The server tells us how far we can see; the overlay only draws that decision.
  applyVisionState(snapshot) {
    if (snapshot.visionRadius === undefined) {
      this.visionRadius = null;
      this.lightsOut = false;
      return;
    }
    this.visionRadius = snapshot.visionRadius;
    this.lightsOut = Boolean(snapshot.lightsOut);
    this.blinded = Boolean(snapshot.blinded);
    this.cuffed = Boolean(snapshot.cuffed);
  }

  applySnapshot(snapshot) {
    this.applyVisionState(snapshot);
    // Every snapshot carries the server's clock; feed it so remote crew can be
    // played back on that timeline rather than on ours.
    this.netClock.observe(Number(snapshot.serverTime));
    // Sent only to a Tracker with a live track; null for everyone else.
    this.tracked = snapshot.tracked ?? null;
    const visible = new Set((snapshot.players ?? []).map((player) => player.id));
    for (const [id, character] of this.characters) {
      // Anyone the server culled is outside our sight radius entirely.
      character.setSeen(visible.has(id));
    }
    for (const player of snapshot.players ?? []) {
      this.characters.get(player.id)?.applySnapshot(player, false, Number(snapshot.serverTime));
    }
    this.syncIncidents(snapshot.incidents ?? []);
  }

  applyLocalPrediction(snapshot) {
    this.characters.get(this.bridge.playerId)?.applySnapshot(snapshot, true);
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
      const point = this.mapPoint(incident.x, incident.z);
      const glow = this.add.image(point.x, point.y, "incidentMarker")
        .setDisplaySize(72 * this.detailScale, 72 * this.detailScale)
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

  clearRuntimeVentMarkers() {
    for (const marker of this.runtimeVentMarkers.values()) marker.container.destroy(true);
    this.runtimeVentMarkers.clear();
  }

  setVentMarkerSealed(marker, sealed) {
    marker.ring.setStrokeStyle(
      Math.max(2, 3 * this.detailScale),
      sealed ? 0xff5369 : 0x74e5ff,
      0.95
    );
    marker.icon.setAlpha(sealed ? 0.3 : marker.normalIconAlpha ?? 1);
    if (sealed) marker.icon.setTint(0x78828b);
    else marker.icon.clearTint();
    if (!marker.sealedSlash) {
      marker.sealedSlash = this.add.graphics();
      marker.sealedSlash.lineStyle(Math.max(3, 5 * this.detailScale), 0xff5369, 0.95);
      const radius = 18 * this.detailScale;
      marker.sealedSlash.lineBetween(-radius, -radius * 0.65, radius, radius * 0.65);
      marker.container.add(marker.sealedSlash);
    }
    marker.sealedSlash.setVisible(sealed);
  }

  createRuntimeVentMarker(vent) {
    const point = this.mapPoint(vent.x, vent.z);
    const style = this.map.render.station;
    const detail = this.detailScale;
    const container = this.add.container(point.x, point.y)
      .setDepth((style.depth ?? 300) + 1)
      .setName(`runtime-station:${vent.id}`);
    const backing = this.add.ellipse(0, 0, 48 * detail, 34 * detail, 0x02070d, 0.62);
    const ring = this.add.ellipse(0, 0, 45 * detail, 30 * detail)
      .setStrokeStyle(Math.max(2, 3 * detail), 0x74e5ff, 0.95);
    const icon = this.add.image(0, -4 * detail, "maintenanceConsole")
      .setDisplaySize(style.iconSize * detail, style.iconSize * detail);
    container.add([backing, ring, icon]);
    container.setData({ stationId: vent.id, roomId: vent.roomId, stationType: "maintenance" });
    return {
      id: vent.id,
      type: "maintenance",
      roomId: vent.roomId,
      container,
      ring,
      icon,
      normalIconAlpha: 1,
      sealedSlash: null,
      seed: Math.random() * Math.PI * 2
    };
  }

  syncVentTopology(topology = {}) {
    if (!this.map) return;
    const minedVents = Array.isArray(topology?.minedVents) ? topology.minedVents : [];
    const sealed = new Set(Array.isArray(topology?.sealedVentIds) ? topology.sealedVentIds : []);
    const wanted = new Set(minedVents.map(({ id }) => id));
    for (const [id, marker] of this.runtimeVentMarkers) {
      if (wanted.has(id)) continue;
      marker.container.destroy(true);
      this.runtimeVentMarkers.delete(id);
    }
    for (const vent of minedVents) {
      let marker = this.runtimeVentMarkers.get(vent.id);
      if (!marker) {
        marker = this.createRuntimeVentMarker(vent);
        this.runtimeVentMarkers.set(vent.id, marker);
      }
      this.setVentMarkerSealed(marker, sealed.has(vent.id));
    }
    for (const marker of this.stationMarkers) {
      if (marker.type === "maintenance") this.setVentMarkerSealed(marker, sealed.has(marker.id));
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
    this.doorOverlay?.setSabotage(sabotage);
  }

  // Show one arrow per exit while vented, anchored on the player's own vent.
  setVentState(vent) {
    this.ventState = vent?.inVent ? vent : null;
    if (!this.ventArrows) return;
    if (!this.ventState) {
      this.ventArrows.hide();
      return;
    }
    const local = this.characters.get(this.bridge.playerId);
    const centre = local
      ? { x: local.container.x, y: local.container.y }
      : null;
    this.ventArrows.show(centre, this.ventState.exits ?? [], this.detailScale);
  }

  updateVentArrows(deltaSeconds) {
    if (!this.ventArrows) return;
    if (!this.ventState) return;
    const local = this.characters.get(this.bridge.playerId);
    if (local) this.ventArrows.moveTo({ x: local.container.x, y: local.container.y });
    this.ventArrows.update(deltaSeconds);
  }

  // Point at the Tracker's mark, but only while they are off-screen: once the
  // target is in view the player can see them directly.
  updateTrackerArrow(deltaSeconds) {
    if (!this.trackerArrow) return;
    const local = this.characters.get(this.bridge.playerId);
    if (!this.tracked || !local) {
      this.trackerArrow.hide();
      return;
    }
    const point = this.mapPoint(this.tracked.x, this.tracked.z);
    const view = this.cameras.main.worldView;
    const onScreen = Phaser.Geom.Rectangle.Contains(view, point.x, point.y);
    const origin = { x: local.container.x, y: local.container.y };
    this.trackerArrow.show(origin, point, {
      onScreen,
      name: this.tracked.displayName ?? "Mark",
      scale: this.detailScale,
      // Report the gap in world units, which is what the map is measured in.
      distanceUnits: Math.hypot(point.x - origin.x, point.y - origin.y) / this.metrics.scale
    });
    this.trackerArrow.update(deltaSeconds);
  }

  updateVision(deltaSeconds) {
    if (!this.vision) return;
    const local = this.characters.get(this.bridge.playerId);
    const active = this.visionRadius !== null && this.visionRadius !== undefined && Boolean(local);
    this.vision.setEnabled(active);
    if (!active) return;
    this.vision.update(
      { x: local.container.x, y: local.container.y },
      this.visionRadius * this.metrics.scale,
      deltaSeconds,
      this.lightsOut || this.blinded ? 1 : 0.94
    );
  }

  clearCharacters() {
    for (const character of this.characters.values()) character.destroy();
    this.characters.clear();
    this.privateState = null;
    this.ghostView = false;
    this.cameras.main.stopFollow();
  }

  update(time, deltaMs) {
    const deltaSeconds = Math.min(0.1, Math.max(0.001, deltaMs / 1000));
    this.netClock.tick(deltaSeconds);
    this.renderTime = this.netClock.renderServerTime();
    for (const character of this.characters.values()) {
      character.update(deltaSeconds, this.bridge.settings.reducedMotion, this.ghostView, this.renderTime);
    }
    for (const marker of [...this.stationMarkers, ...this.runtimeVentMarkers.values()]) {
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
    this.updateVentArrows(deltaSeconds);
    this.updateTrackerArrow(deltaSeconds);
    this.updateVision(deltaSeconds);
    this.bridge.onRenderFrame(time, deltaMs);
  }
}
