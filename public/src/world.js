import * as THREE from "/vendor/three/build/three.module.js";
import { CORRIDORS, ROOMS, STATIONS, roomAt } from "./shipData.js";

function createTextSprite(text, colour = "#bdefff") {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 96;
  const context = canvas.getContext("2d");
  context.fillStyle = "rgba(3, 12, 20, .84)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(105, 220, 255, .55)";
  context.lineWidth = 2;
  context.strokeRect(2, 2, 508, 92);
  context.fillStyle = colour;
  context.textAlign = "center";
  context.font = "700 27px Avenir Next, sans-serif";
  context.fillText(text.toUpperCase(), 256, 59, 480);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(1.1, 0.21, 1);
  sprite.userData.disposableTexture = texture;
  return sprite;
}

function makeFloor(rect, colour, materialCache) {
  const key = `${colour}`;
  if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshStandardMaterial({ color: colour, metalness: 0.36, roughness: 0.65 }));
  const floor = new THREE.Mesh(new THREE.BoxGeometry(rect.width, 0.22, rect.depth), materialCache.get(key));
  floor.position.set(rect.x, -0.12, rect.z);
  floor.receiveShadow = true;
  return floor;
}

export class MeridianWorld {
  constructor(scene, assets, settings) {
    this.scene = scene;
    this.assets = assets;
    this.settings = settings;
    this.root = new THREE.Group();
    this.root.name = "placeholder-meridian-map";
    this.scene.add(this.root);
    this.interactables = [];
    this.incidentMeshes = new Map();
    this.cameraObstacles = [];
    this.roomLights = [];
    this.animated = [];
    this.build();
  }

  build() {
    this.scene.background = new THREE.Color(0x03070c);
    this.scene.fog = new THREE.FogExp2(0x050a11, 0.012);
    const hemisphere = new THREE.HemisphereLight(0x79ccea, 0x080c13, 1.6);
    this.scene.add(hemisphere);
    const fill = new THREE.DirectionalLight(0xbcdcff, this.settings.graphicsQuality === "low" ? 0.45 : 0.8);
    fill.position.set(-20, 38, 14);
    fill.castShadow = this.settings.graphicsQuality !== "low";
    fill.shadow.mapSize.set(1024, 1024);
    this.scene.add(fill);

    const starTexture = this.assets.get("stars");
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(115, 32, 18),
      new THREE.MeshBasicMaterial({ color: 0x111927, map: starTexture, side: THREE.BackSide, fog: false })
    );
    sky.rotation.y = 0.7;
    this.root.add(sky);
    this.animated.push({ object: sky, speed: 0.002 });

    const materialCache = new Map();
    for (const corridor of CORRIDORS) this.root.add(makeFloor(corridor, 0x142430, materialCache));
    for (const room of ROOMS) {
      const floor = makeFloor(room, room.colour, materialCache);
      floor.userData.roomId = room.id;
      this.root.add(floor);
      const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x233846, emissive: 0x0c2f3e, emissiveIntensity: 0.65, metalness: 0.65, roughness: 0.36 });
      const frameGeometryHorizontal = new THREE.BoxGeometry(room.width, 0.35, 0.18);
      const frameGeometryVertical = new THREE.BoxGeometry(0.18, 0.35, room.depth);
      for (const z of [room.z - room.depth / 2, room.z + room.depth / 2]) {
        const frame = new THREE.Mesh(frameGeometryHorizontal, frameMaterial);
        frame.position.set(room.x, 0.08, z); this.root.add(frame);
      }
      for (const x of [room.x - room.width / 2, room.x + room.width / 2]) {
        const frame = new THREE.Mesh(frameGeometryVertical, frameMaterial);
        frame.position.set(x, 0.08, room.z); this.root.add(frame);
      }
      const sign = createTextSprite(room.name);
      sign.position.set(room.x, 3.15, room.z - room.depth * 0.28);
      this.root.add(sign);
      if (this.settings.graphicsQuality === "high" || ["operations-hub", "core-chamber", "observation-ring"].includes(room.id)) {
        const light = new THREE.PointLight(room.id === "core-chamber" ? 0xff5d68 : 0x6cddff, 1.4, 14, 2);
        light.position.set(room.x, 4.5, room.z);
        this.roomLights.push(light); this.root.add(light);
      }
    }

    this.buildStations();
    this.buildLandmarks();
  }

  buildStations() {
    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x182b37, metalness: 0.55, roughness: 0.42 });
    const colours = { task: 0x35d5f6, repair: 0xffb547, meeting: 0xffdf82, security: 0xa77bff, doorLogs: 0x72aaff, maintenance: 0xe45c7a };
    for (const station of STATIONS) {
      const group = new THREE.Group();
      group.position.set(station.x, 0, station.z);
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.62, 1.25, 8), baseMaterial);
      pedestal.position.y = 0.62; pedestal.castShadow = true;
      const screen = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.55, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x111c25, emissive: colours[station.type] ?? 0x58c9e7, emissiveIntensity: 1.65 })
      );
      screen.position.set(0, 1.3, 0.32); screen.rotation.x = -0.22;
      group.add(pedestal, screen);
      group.userData.station = station;
      this.interactables.push(group);
      this.root.add(group);
    }
  }

  buildLandmarks() {
    const core = new THREE.Group();
    core.position.set(-18, 1.2, -18);
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.55, 2), new THREE.MeshStandardMaterial({ color: 0x34182b, emissive: 0xb51442, emissiveIntensity: 2.1, wireframe: true }));
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.1, 8, 32), new THREE.MeshStandardMaterial({ color: 0xff5874, emissive: 0x9a102a, emissiveIntensity: 1.5 }));
    const ringB = ringA.clone(); ringB.rotation.x = Math.PI / 2;
    core.add(shell, ringA, ringB); this.root.add(core);
    this.animated.push({ object: ringA, speed: 0.45, axis: "y" }, { object: ringB, speed: -0.38, axis: "z" });

    const anomaly = new THREE.Mesh(new THREE.SphereGeometry(8, 32, 20), new THREE.MeshBasicMaterial({ color: 0x8053da, transparent: true, opacity: 0.5, wireframe: true, fog: false }));
    anomaly.position.set(58, 8, -26);
    this.root.add(anomaly);
    this.animated.push({ object: anomaly, speed: 0.08, axis: "y" });

    const cargoMaterial = new THREE.MeshStandardMaterial({ color: 0x63533b, metalness: 0.35, roughness: 0.72 });
    for (let index = 0; index < 10; index += 1) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1 + (index % 2) * 0.45, 1.2), cargoMaterial);
      crate.position.set(-40 + (index % 5) * 1.8, 0.55, 15 + Math.floor(index / 5) * 2.1);
      crate.castShadow = true; this.root.add(crate);
    }
  }

  update(delta, elapsed, activeSabotage) {
    for (const item of this.animated) item.object.rotation[item.axis ?? "y"] += item.speed * delta;
    const emergency = Boolean(activeSabotage?.critical);
    for (let index = 0; index < this.roomLights.length; index += 1) {
      const light = this.roomLights[index];
      if (emergency) {
        light.color.setHex(0xff3148);
        light.intensity = 1.1 + Math.sin(elapsed * 7 + index) * 0.7;
      } else {
        light.color.setHex(0x6cddff);
        light.intensity = 1.4;
      }
    }
  }

  nearestInteractable(position, maxDistance = 2.8) {
    let closest = null;
    let closestDistance = maxDistance;
    for (const object of this.interactables) {
      const distance = Math.hypot(position.x - object.position.x, position.z - object.position.z);
      if (distance < closestDistance) { closest = object.userData.station; closestDistance = distance; }
    }
    for (const [id, object] of this.incidentMeshes) {
      const distance = Math.hypot(position.x - object.position.x, position.z - object.position.z);
      if (distance < closestDistance) { closest = { id, type: "incident", x: object.position.x, z: object.position.z }; closestDistance = distance; }
    }
    return closest ? { station: closest, distance: closestDistance } : null;
  }

  syncIncidents(incidents) {
    const incoming = new Set(incidents.map((incident) => incident.id));
    for (const [id, mesh] of this.incidentMeshes) {
      if (!incoming.has(id)) { this.root.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); this.incidentMeshes.delete(id); }
    }
    for (const incident of incidents) {
      if (this.incidentMeshes.has(incident.id)) continue;
      const mesh = new THREE.Mesh(
        new THREE.TorusKnotGeometry(0.45, 0.13, 28, 6),
        new THREE.MeshStandardMaterial({ color: 0x4a2338, emissive: 0xff315e, emissiveIntensity: 1.2, metalness: 0.4, roughness: 0.5 })
      );
      mesh.position.set(incident.x, 0.5, incident.z);
      mesh.rotation.x = Math.PI / 2;
      mesh.userData.incidentId = incident.id;
      this.incidentMeshes.set(incident.id, mesh);
      this.root.add(mesh);
    }
  }

  roomAt(position) { return roomAt(position.x, position.z); }

  dispose() {
    this.root.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((entry) => entry.dispose());
      else object.material?.dispose?.();
      object.userData.disposableTexture?.dispose?.();
    });
    this.scene.remove(this.root);
  }
}
