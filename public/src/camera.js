import * as THREE from "/vendor/three/build/three.module.js";

export class ThirdPersonCamera {
  constructor(camera, getSettings) {
    this.camera = camera;
    this.getSettings = getSettings;
    this.lookAt = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.mode = "follow";
  }

  update(target, yaw, pitch, delta, obstacles = []) {
    if (!target) return;
    const settings = this.getSettings();
    const distance = settings.cameraDistance;
    const focus = new THREE.Vector3(target.x, target.y + 1.85, target.z);
    const horizontal = Math.cos(pitch) * distance;
    this.desired.set(
      focus.x - Math.sin(yaw) * horizontal,
      focus.y + Math.sin(pitch) * distance + 1.4,
      focus.z - Math.cos(yaw) * horizontal
    );
    if (obstacles.length) {
      const direction = this.desired.clone().sub(focus);
      const fullDistance = direction.length();
      this.raycaster.set(focus, direction.normalize());
      this.raycaster.far = fullDistance;
      const hit = this.raycaster.intersectObjects(obstacles, false)[0];
      if (hit) this.desired.copy(focus).add(direction.multiplyScalar(Math.max(1.8, hit.distance - 0.35)));
    }
    const factor = settings.reducedMotion ? 1 : 1 - Math.exp(-delta * 8);
    this.camera.position.lerp(this.desired, factor);
    this.lookAt.lerp(focus, factor);
    this.camera.lookAt(this.lookAt);
  }

  snapTo(target, yaw = 0, pitch = 0.35) {
    if (!target) return;
    this.lookAt.set(target.x, target.y + 1.85, target.z);
    const distance = this.getSettings().cameraDistance;
    this.camera.position.set(target.x - Math.sin(yaw) * distance, target.y + 5, target.z - Math.cos(yaw) * distance);
    this.camera.lookAt(this.lookAt);
  }
}
