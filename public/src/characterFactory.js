import * as THREE from "/vendor/three/build/three.module.js";

const SUIT_COLOURS = Object.freeze({
  cyan: 0x27bad8, amber: 0xe2a238, violet: 0x805bd0, lime: 0x54b86a,
  coral: 0xd9575f, white: 0xc8d8dd, blue: 0x3f67c9, rose: 0xc74f87
});

function material(colour, options = {}) {
  return new THREE.MeshStandardMaterial({ color: colour, roughness: 0.56, metalness: 0.18, ...options });
}

function createNameplate(displayName, symbol, number) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(3, 10, 17, .82)";
  context.fillRect(2, 2, 508, 88);
  context.strokeStyle = "rgba(116, 229, 255, .65)";
  context.lineWidth = 3;
  context.strokeRect(2, 2, 508, 88);
  context.fillStyle = "#dff8ff";
  context.font = "700 34px Avenir Next, sans-serif";
  context.textAlign = "center";
  context.fillText(`${displayName}  //  ${String(symbol).toUpperCase()}-${number}`, 256, 58, 486);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.name = "nameplate";
  sprite.scale.set(1.25, 0.24, 1);
  sprite.position.y = 3.45;
  sprite.userData.disposableTexture = texture;
  return sprite;
}

export function createPlaceholderCharacter(player) {
  const group = new THREE.Group();
  group.name = `placeholder-character:${player.id}`;
  const suitColour = SUIT_COLOURS[player.appearance?.colour] ?? SUIT_COLOURS.cyan;
  const suit = material(suitColour, { emissive: suitColour, emissiveIntensity: 0.24 });
  const dark = material(0x1b2d39, { emissive: 0x08131a, emissiveIntensity: 0.35, metalness: 0.6, roughness: 0.35 });
  const trim = material(0xc7f5ff, { emissive: 0x163b48, emissiveIntensity: 0.8 });
  const visor = material(player.appearance?.visor ?? 0x9defff, { metalness: 0.75, roughness: 0.12, emissive: 0x123240, emissiveIntensity: 0.55 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 0.78, 6, 12), suit);
  torso.position.y = 1.62;
  torso.castShadow = true;
  group.add(torso);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.34, 0.12), trim);
  chest.position.set(0, 1.68, 0.58);
  chest.castShadow = true;
  group.add(chest);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.72, 18, 12), dark);
  helmet.scale.y = 0.82;
  helmet.position.y = 2.6;
  helmet.castShadow = true;
  group.add(helmet);

  const visorMesh = new THREE.Mesh(new THREE.SphereGeometry(0.58, 18, 10, -1.1, 2.2, 0.25, 1.7), visor);
  visorMesh.scale.set(1, 0.66, 0.45);
  visorMesh.rotation.x = -0.12;
  visorMesh.position.set(0, 2.62, 0.55);
  group.add(visorMesh);

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.86, 0.42), dark);
  backpack.position.set(0, 1.75, -0.62);
  backpack.castShadow = true;
  group.add(backpack);

  const limbs = { arms: [], legs: [] };
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), trim);
    shoulder.position.set(side * 0.71, 1.97, 0);
    group.add(shoulder);
    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.72, 1.9, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.6, 4, 8), suit);
    arm.position.y = -0.42;
    arm.castShadow = true;
    armPivot.add(arm);
    group.add(armPivot);
    limbs.arms.push(armPivot);

    const legPivot = new THREE.Group();
    legPivot.position.set(side * 0.3, 1.1, 0);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.52, 4, 8), suit);
    leg.position.y = -0.42;
    leg.castShadow = true;
    legPivot.add(leg);
    group.add(legPivot);
    limbs.legs.push(legPivot);
  }

  if (player.appearance?.accessory === "antenna") {
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 6), trim);
    antenna.position.set(0.3, 3.23, 0);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), visor);
    tip.position.y = 0.36;
    antenna.add(tip);
    group.add(antenna);
  } else if (player.appearance?.accessory === "crest") {
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.7), trim);
    crest.position.set(0, 3.22, -0.04);
    group.add(crest);
  } else if (player.appearance?.accessory === "scanner") {
    const scanner = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.16), visor);
    scanner.position.set(0.58, 2.92, 0.24);
    group.add(scanner);
  }

  group.add(createNameplate(player.displayName, player.appearance?.symbol ?? "orbit", player.appearance?.number ?? 7));
  group.userData.limbs = limbs;
  group.userData.phase = Math.random() * Math.PI * 2;
  return group;
}

export class CharacterView {
  constructor(player) {
    this.player = player;
    this.group = createPlaceholderCharacter(player);
    this.targetPosition = new THREE.Vector3(player.x ?? 0, 0, player.z ?? 0);
    this.targetYaw = 0;
    this.animation = "idle";
    this.alive = true;
    this.time = 0;
  }

  applySnapshot(snapshot, immediate = false) {
    this.targetPosition.set(snapshot.x, snapshot.y ?? 0, snapshot.z);
    this.targetYaw = snapshot.yaw;
    this.animation = snapshot.animation;
    this.setAlive(snapshot.alive);
    if (immediate) {
      this.group.position.copy(this.targetPosition);
      this.group.rotation.y = this.targetYaw;
    }
  }

  setAlive(alive) {
    if (this.alive === alive) return;
    this.alive = alive;
    this.group.traverse((object) => {
      if (!object.isMesh || !object.material) return;
      object.material = object.material.clone();
      object.material.transparent = !alive;
      object.material.opacity = alive ? 1 : 0.35;
      object.material.depthWrite = alive;
    });
  }

  update(delta, reducedMotion = false) {
    this.time += delta;
    const interpolation = reducedMotion ? 1 : 1 - Math.exp(-delta * 13);
    this.group.position.lerp(this.targetPosition, interpolation);
    const yawDelta = Math.atan2(Math.sin(this.targetYaw - this.group.rotation.y), Math.cos(this.targetYaw - this.group.rotation.y));
    this.group.rotation.y += yawDelta * interpolation;
    const limbs = this.group.userData.limbs;
    const moving = ["walk", "sprint", "crouch"].includes(this.animation);
    const frequency = this.animation === "sprint" ? 11 : this.animation === "walk" ? 7 : 4;
    const amplitude = reducedMotion || !moving ? 0 : this.animation === "sprint" ? 0.75 : 0.48;
    const swing = Math.sin(this.time * frequency + this.group.userData.phase) * amplitude;
    limbs.arms[0].rotation.x = swing;
    limbs.arms[1].rotation.x = -swing;
    limbs.legs[0].rotation.x = -swing;
    limbs.legs[1].rotation.x = swing;
    this.group.scale.y += ((this.animation === "crouch" ? 0.72 : 1) - this.group.scale.y) * interpolation;
  }

  dispose() {
    this.group.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        object.material.map?.dispose?.();
        object.material.dispose?.();
      }
      object.userData.disposableTexture?.dispose?.();
    });
  }
}
