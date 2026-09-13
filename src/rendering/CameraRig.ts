import {
  Box3,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector3,
} from 'three';
import { clamp, damp, dampAngle, lerp } from '@/util/math';
import { Spring } from '@/util/easing';

export interface CameraPreset {
  /** Horizontal distance from the target. */
  distance: number;
  /** Height above the target. */
  height: number;
  /** Downward tilt, in radians, applied to the look target. */
  pitchOffset: number;
  fov: number;
}

export const CAMERA_PRESETS: Record<string, CameraPreset> = {
  // The default exterior framing: high enough to read the island as a diorama,
  // shallow enough that buildings still have visible faces.
  exterior: { distance: 17, height: 12.5, pitchOffset: 0.0, fov: 38 },
  exteriorClose: { distance: 11, height: 8, pitchOffset: 0.1, fov: 40 },
  exteriorWide: { distance: 26, height: 19, pitchOffset: -0.05, fov: 36 },
  interior: { distance: 9.5, height: 8.5, pitchOffset: 0.05, fov: 44 },
  fishing: { distance: 12, height: 7.5, pitchOffset: 0.16, fov: 36 },
  dialogue: { distance: 8.5, height: 5.6, pitchOffset: 0.2, fov: 34 },
  vista: { distance: 34, height: 26, pitchOffset: -0.1, fov: 34 },
};

interface FadedObject {
  mesh: Mesh;
  material: MeshStandardMaterial;
  originalOpacity: number;
  originalTransparent: boolean;
  originalDepthWrite: boolean;
  target: number;
  current: number;
}

const UP = new Vector3(0, 1, 0);

/**
 * Cozy-sim follow camera: eased position, movement look-ahead, orbit on the
 * right stick, and occlusion fading so a house or a canopy never hides the
 * player. Everything is frame-rate independent.
 */
export class CameraRig {
  /** Where the camera is looking — the player, plus look-ahead. */
  readonly focus = new Vector3();
  private smoothedFocus = new Vector3();
  private lookAhead = new Vector3();
  private currentPosition = new Vector3();

  /** Orbit yaw around the target, in radians. */
  yaw = Math.PI;
  private targetYaw = Math.PI;

  private zoomSpring = new Spring(1, 90, 16);
  private zoomTarget = 1;

  private distanceSpring = new Spring(CAMERA_PRESETS.exterior.distance, 60, 14);
  private heightSpring = new Spring(CAMERA_PRESETS.exterior.height, 60, 14);
  private fovSpring = new Spring(CAMERA_PRESETS.exterior.fov, 50, 13);

  private preset: CameraPreset = CAMERA_PRESETS.exterior;
  private raycaster = new Raycaster();
  private faded = new Map<string, FadedObject>();
  private shakeAmount = 0;
  private shakeTime = 0;
  shakeEnabled = true;

  /** Objects the camera should fade rather than clip through. */
  occluders: Object3D[] = [];
  /** Bounds the camera target is kept inside, so it never drifts off the island. */
  bounds: Box3 | null = null;

  constructor(
    private camera: PerspectiveCamera,
    private scene: Scene,
  ) {
    this.currentPosition.copy(camera.position);
  }

  setPreset(name: keyof typeof CAMERA_PRESETS | CameraPreset, immediate = false): void {
    this.preset = typeof name === 'string' ? CAMERA_PRESETS[name] : name;
    if (immediate) {
      this.distanceSpring.snap(this.preset.distance);
      this.heightSpring.snap(this.preset.height);
      this.fovSpring.snap(this.preset.fov);
    }
  }

  /** Player-controlled zoom, 0.6 (close) to 1.6 (wide). */
  setZoom(z: number): void {
    this.zoomTarget = clamp(z, 0.6, 1.7);
  }

  nudgeZoom(delta: number): void {
    this.setZoom(this.zoomTarget + delta);
  }

  get zoom(): number {
    return this.zoomTarget;
  }

  orbit(delta: number): void {
    this.targetYaw += delta;
  }

  /** Snaps the camera behind the target — used on teleports and scene loads. */
  snapTo(target: Vector3, facing = Math.PI): void {
    this.focus.copy(target);
    this.smoothedFocus.copy(target);
    this.lookAhead.set(0, 0, 0);
    this.yaw = facing;
    this.targetYaw = facing;
    this.zoomSpring.snap(this.zoomTarget);
    this.distanceSpring.snap(this.preset.distance);
    this.heightSpring.snap(this.preset.height);
    this.fovSpring.snap(this.preset.fov);
    this.applyTransform(0, true);
  }

  shake(amount: number): void {
    if (!this.shakeEnabled) return;
    this.shakeAmount = Math.min(1, this.shakeAmount + amount);
  }

  /**
   * @param target World position of the player.
   * @param velocity Player velocity, used for look-ahead.
   * @param orbitInput Right-stick X, in [-1, 1].
   */
  update(dt: number, target: Vector3, velocity: Vector3, orbitInput: number): void {
    this.targetYaw += orbitInput * dt * 2.1;

    this.focus.copy(target);
    if (this.bounds) {
      this.focus.x = clamp(this.focus.x, this.bounds.min.x, this.bounds.max.x);
      this.focus.z = clamp(this.focus.z, this.bounds.min.z, this.bounds.max.z);
    }

    // Look-ahead: push the framing in the direction of travel, but only a
    // little, and ease it so a quick direction change does not whip the view.
    const speed = Math.hypot(velocity.x, velocity.z);
    const aheadStrength = Math.min(1, speed / 6) * 3.4;
    const desiredAhead = speed > 0.05
      ? new Vector3(velocity.x / speed, 0, velocity.z / speed).multiplyScalar(aheadStrength)
      : new Vector3();
    this.lookAhead.x = damp(this.lookAhead.x, desiredAhead.x, 0.34, dt);
    this.lookAhead.z = damp(this.lookAhead.z, desiredAhead.z, 0.34, dt);

    const desiredFocus = this.focus.clone().add(this.lookAhead);
    // Vertical follow is slower than horizontal so stairs and slopes do not bob.
    this.smoothedFocus.x = damp(this.smoothedFocus.x, desiredFocus.x, 0.11, dt);
    this.smoothedFocus.z = damp(this.smoothedFocus.z, desiredFocus.z, 0.11, dt);
    this.smoothedFocus.y = damp(this.smoothedFocus.y, desiredFocus.y, 0.3, dt);

    this.yaw = dampAngle(this.yaw, this.targetYaw, 0.13, dt);
    this.zoomSpring.step(this.zoomTarget, dt);
    this.distanceSpring.step(this.preset.distance, dt);
    this.heightSpring.step(this.preset.height, dt);
    this.fovSpring.step(this.preset.fov, dt);

    this.applyTransform(dt, false);
    this.updateOcclusion(dt);
  }

  private applyTransform(dt: number, immediate: boolean): void {
    const zoom = this.zoomSpring.value;
    const distance = this.distanceSpring.value * zoom;
    const height = this.heightSpring.value * lerp(1, 1.12, zoom - 1);

    const offset = new Vector3(Math.sin(this.yaw) * distance, height, Math.cos(this.yaw) * distance);
    const desired = this.smoothedFocus.clone().add(offset);

    if (immediate) {
      this.currentPosition.copy(desired);
    } else {
      this.currentPosition.x = damp(this.currentPosition.x, desired.x, 0.09, dt);
      this.currentPosition.y = damp(this.currentPosition.y, desired.y, 0.13, dt);
      this.currentPosition.z = damp(this.currentPosition.z, desired.z, 0.09, dt);
    }

    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeAmount > 0.001) {
      this.shakeTime += dt * 34;
      shakeX = Math.sin(this.shakeTime) * this.shakeAmount * 0.32;
      shakeY = Math.cos(this.shakeTime * 1.37) * this.shakeAmount * 0.26;
      this.shakeAmount = Math.max(0, this.shakeAmount - dt * 2.6);
    }

    this.camera.position.set(this.currentPosition.x + shakeX, this.currentPosition.y + shakeY, this.currentPosition.z);

    const lookTarget = this.smoothedFocus.clone();
    lookTarget.y += 1.35 - this.preset.pitchOffset * 8;
    this.camera.up.copy(UP);
    this.camera.lookAt(lookTarget);

    if (Math.abs(this.camera.fov - this.fovSpring.value) > 0.01) {
      this.camera.fov = this.fovSpring.value;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Fades anything sitting between the camera and the player. Fading rather
   * than pushing the camera in keeps the framing stable while still
   * guaranteeing the player is readable behind a roof or a canopy.
   */
  private updateOcclusion(dt: number): void {
    const targetPoint = this.smoothedFocus.clone();
    targetPoint.y += 1.1;
    const direction = targetPoint.clone().sub(this.camera.position);
    const distance = direction.length();
    direction.normalize();

    this.raycaster.set(this.camera.position, direction);
    this.raycaster.far = Math.max(0.1, distance - 1.2);
    this.raycaster.near = 0.1;

    for (const entry of this.faded.values()) entry.target = 1;

    if (this.occluders.length > 0) {
      const hits = this.raycaster.intersectObjects(this.occluders, true);
      for (const hit of hits) {
        const mesh = hit.object as Mesh;
        if (!mesh.isMesh) continue;
        const material = mesh.material as MeshStandardMaterial;
        if (Array.isArray(mesh.material) || !material) continue;
        // Instanced foliage would fade whole batches at once; skip it.
        if ((mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) continue;
        if (mesh.userData.noFade) continue;

        const key = mesh.uuid;
        let entry = this.faded.get(key);
        if (!entry) {
          entry = {
            mesh,
            material,
            originalOpacity: material.opacity,
            originalTransparent: material.transparent,
            originalDepthWrite: material.depthWrite,
            target: 1,
            current: 1,
          };
          this.faded.set(key, entry);
        }
        entry.target = 0.22;
      }
    }

    for (const [key, entry] of this.faded) {
      entry.current = damp(entry.current, entry.target, 0.09, dt);
      if (entry.current > 0.985 && entry.target === 1) {
        entry.material.opacity = entry.originalOpacity;
        entry.material.transparent = entry.originalTransparent;
        entry.material.depthWrite = entry.originalDepthWrite;
        entry.material.needsUpdate = true;
        this.faded.delete(key);
        continue;
      }
      entry.material.transparent = true;
      entry.material.depthWrite = false;
      entry.material.opacity = entry.originalOpacity * entry.current;
    }
  }

  /** Restores every faded material — call when unloading a scene. */
  clearOcclusion(): void {
    for (const entry of this.faded.values()) {
      entry.material.opacity = entry.originalOpacity;
      entry.material.transparent = entry.originalTransparent;
      entry.material.depthWrite = entry.originalDepthWrite;
      entry.material.needsUpdate = true;
    }
    this.faded.clear();
    this.occluders = [];
    void this.scene;
  }
}
