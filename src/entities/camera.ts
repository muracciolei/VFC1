/** Third-person orbit camera with collision and auto-follow. */

import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../core/math';
import { InputSystem } from '../core/input';
import { GameSettings } from '../core/settings';
import { World } from '../world/world';

export interface CameraOptions {
  inVehicle: boolean;
  aiming: boolean;
  speedRatio: number;
  vehicleYaw: number;
}

export class ThirdPersonCamera {
  yaw = 0;
  pitch = 0.24;
  private distance = 4.4;
  private currentDistance = 4.4;
  private zoom = 1;
  private shake = 0;
  private lookIdle = 0;
  private preset = 0;
  private static readonly PRESETS = [1, 0.76, 1.3];
  private static readonly PRESET_NAMES = ['CAMERA MEDIA', 'CAMERA VICINA', 'CAMERA LONTANA'];
  private readonly pivot = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private world: World;
  private settings: GameSettings;
  private tmpHit: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

  constructor(world: World, settings: GameSettings) {
    this.world = world;
    this.settings = settings;
  }

  snapBehind(yaw: number): void {
    this.yaw = yaw;
    this.lookIdle = 0;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  /** Cycle through close / medium / far chase distances. */
  cyclePreset(): string {
    this.preset = (this.preset + 1) % ThirdPersonCamera.PRESETS.length;
    return ThirdPersonCamera.PRESET_NAMES[this.preset];
  }

  get presetName(): string {
    return ThirdPersonCamera.PRESET_NAMES[this.preset];
  }

  update(
    dt: number,
    input: InputSystem,
    target: THREE.Vector3,
    targetYaw: number,
    opts: CameraOptions,
  ): void {
    const look = input.consumeLook();
    const sens = this.settings.sensitivity * (opts.aiming ? this.settings.aimSensitivity : 1);
    if (Math.abs(look.x) + Math.abs(look.y) > 0.0002) {
      this.yaw -= look.x * 2.2 * sens;
      this.pitch += look.y * 1.7 * sens * (this.settings.invertY ? -1 : 1);
      this.lookIdle = 0;
    } else {
      this.lookIdle += dt;
    }
    const zoomDelta = input.consumeZoom();
    if (zoomDelta !== 0) this.zoom = clamp(this.zoom + zoomDelta * 0.12, 0.8, 1.55);
    if (opts.inVehicle) this.zoom = 1;
    this.pitch = clamp(this.pitch, -0.42, 1.15);

    // auto-follow when the player is moving and not looking around
    const followYaw = opts.inVehicle ? opts.vehicleYaw : targetYaw;
    if (this.lookIdle > 1.4 && !opts.aiming && (opts.inVehicle || opts.speedRatio > 0.12)) {
      const rate = opts.inVehicle ? 2.6 : 1.5;
      this.yaw = dampAngle(this.yaw, followYaw, rate, dt);
    }

    const pivotHeight = opts.inVehicle ? 1.25 : opts.aiming ? 1.52 : 1.55;
    this.pivot.set(target.x, target.y + pivotHeight, target.z);

    const preset = ThirdPersonCamera.PRESETS[this.preset];
    const settingDist = clamp(this.settings.cameraDistance, 0.7, 1.4);
    const baseDist = (opts.inVehicle ? 7.2 : opts.aiming ? 2.9 : this.distance) * preset * settingDist;
    const desiredDist = baseDist * this.zoom;
    const cosP = Math.cos(this.pitch);
    const sinP = Math.sin(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cosP, -sinP, Math.cos(this.yaw) * cosP);

    // shoulder offset while aiming
    if (opts.aiming && !opts.inVehicle) {
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      this.pivot.x += rx * 0.62;
      this.pivot.z += rz * 0.62;
    }

    this.desired.copy(this.pivot).addScaledVector(this.dir, -desiredDist);

    // camera collision
    let allowed = desiredDist;
    const hit = this.world.collision.raycast3D(
      this.pivot,
      this.dir.clone().negate(),
      desiredDist + 0.3,
      (x, z) => this.world.groundHeight(x, z),
    );
    if (hit) {
      allowed = Math.max(0.65, hit.distance - 0.28);
    }
    if (allowed < this.currentDistance) {
      this.currentDistance = damp(this.currentDistance, allowed, 26, dt);
    } else {
      this.currentDistance = damp(this.currentDistance, allowed, 5, dt);
    }
    this.currentDistance = Math.min(this.currentDistance, desiredDist);

    const cam = this.desired.copy(this.pivot).addScaledVector(this.dir, -this.currentDistance);
    // keep camera above the ground
    const groundY = this.world.groundHeight(cam.x, cam.z) + 0.35;
    if (cam.y < groundY) cam.y = groundY;

    this.shake = Math.max(0, this.shake - dt * 2.6);
    const shakeAmt = this.shake * this.shake * 0.28;
    this.lookAt.copy(cam).add(this.dir);
    this.lookAt.x += (Math.random() - 0.5) * shakeAmt;
    this.lookAt.y += (Math.random() - 0.5) * shakeAmt;
    this.lookAt.z += (Math.random() - 0.5) * shakeAmt;

    const camera = this.getCamera();
    if (camera) {
      camera.position.copy(cam);
      camera.lookAt(this.lookAt);
    }
    void this.tmpHit;
  }

  private camera: THREE.PerspectiveCamera | null = null;

  attachCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
  }

  getCamera(): THREE.PerspectiveCamera | null {
    return this.camera;
  }

  /** Horizontal forward direction of the camera. */
  get forwardX(): number {
    return Math.sin(this.yaw);
  }

  get forwardZ(): number {
    return Math.cos(this.yaw);
  }

  get fovTarget(): number {
    return this.settings.fov;
  }
}
