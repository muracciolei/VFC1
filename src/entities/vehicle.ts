/** Procedural vehicles and arcade driving physics. */

import * as THREE from 'three';
import { clamp, clamp01, damp, lerp, TAU } from '../core/math';
import { events } from '../core/events';
import { MeshBuilder } from '../world/geometry';
import { CollisionWorld } from '../world/collision';
import { World } from '../world/world';

export type VehicleTypeId =
  | 'panda'
  | 'berlina'
  | 'sportiva'
  | 'taxi'
  | 'furgone'
  | 'camion'
  | 'fuoristrada'
  | 'vespa'
  | 'police';

export interface VehicleDef {
  id: VehicleTypeId;
  name: string;
  classLabel: string;
  length: number;
  width: number;
  height: number;
  wheelRadius: number;
  wheelBase: number;
  maxSpeed: number;
  reverseSpeed: number;
  accel: number;
  brake: number;
  steerRate: number;
  grip: number;
  drag: number;
  health: number;
  mass: number;
  price: number;
  colors: string[];
}

export const VEHICLE_TYPES: Record<VehicleTypeId, VehicleDef> = {
  panda: {
    id: 'panda', name: 'PANDA 4X4', classLabel: 'UTILITARIA', length: 3.6, width: 1.66, height: 1.55,
    wheelRadius: 0.31, wheelBase: 2.3, maxSpeed: 31, reverseSpeed: 8, accel: 8.5, brake: 16, steerRate: 1.9,
    grip: 7.5, drag: 0.35, health: 800, mass: 900, price: 4200,
    colors: ['#c9c3b6', '#8a2f2a', '#3d5a72', '#e0d7c5', '#4f5b46'],
  },
  berlina: {
    id: 'berlina', name: 'BERLINA 2000', classLabel: 'BERLINA', length: 4.55, width: 1.82, height: 1.44,
    wheelRadius: 0.33, wheelBase: 2.7, maxSpeed: 44, reverseSpeed: 10, accel: 12, brake: 19, steerRate: 1.55,
    grip: 8.5, drag: 0.3, health: 1000, mass: 1250, price: 9800,
    colors: ['#2b3238', '#7d1f24', '#d8d2c6', '#263a55', '#4a4f52'],
  },
  sportiva: {
    id: 'sportiva', name: 'SPORTIVA V8', classLabel: 'SPORTIVA', length: 4.4, width: 1.94, height: 1.18,
    wheelRadius: 0.34, wheelBase: 2.55, maxSpeed: 62, reverseSpeed: 11, accel: 18, brake: 24, steerRate: 1.7,
    grip: 10, drag: 0.26, health: 780, mass: 1100, price: 42000,
    colors: ['#b02a24', '#d9a62e', '#1a1c20', '#e6e2d8', '#2d5a8a'],
  },
  taxi: {
    id: 'taxi', name: 'TAXI CITTÀ', classLabel: 'TAXI', length: 4.5, width: 1.8, height: 1.48,
    wheelRadius: 0.33, wheelBase: 2.68, maxSpeed: 41, reverseSpeed: 9, accel: 11, brake: 18, steerRate: 1.55,
    grip: 8.2, drag: 0.31, health: 950, mass: 1220, price: 7600,
    colors: ['#e0c14a', '#d8b43c'],
  },
  furgone: {
    id: 'furgone', name: 'FURGONE CARGO', classLabel: 'FURGONE', length: 5.2, width: 1.98, height: 2.15,
    wheelRadius: 0.36, wheelBase: 3.1, maxSpeed: 34, reverseSpeed: 8, accel: 7.5, brake: 14, steerRate: 1.3,
    grip: 6.5, drag: 0.34, health: 1250, mass: 1900, price: 13500,
    colors: ['#d7d3c8', '#5d6b78', '#8a3a2e', '#3f5a44'],
  },
  camion: {
    id: 'camion', name: 'CAMION RIMORCHIO', classLabel: 'CAMION', length: 7.4, width: 2.36, height: 3.0,
    wheelRadius: 0.44, wheelBase: 4.4, maxSpeed: 27, reverseSpeed: 6, accel: 5.5, brake: 11, steerRate: 1.1,
    grip: 5.5, drag: 0.36, health: 1900, mass: 3600, price: 26000,
    colors: ['#c9c5ba', '#7a2e2a', '#34516b'],
  },
  fuoristrada: {
    id: 'fuoristrada', name: 'FUORISTRADA', classLabel: 'SUV', length: 4.65, width: 2.0, height: 1.88,
    wheelRadius: 0.4, wheelBase: 2.8, maxSpeed: 39, reverseSpeed: 10, accel: 9.5, brake: 16, steerRate: 1.6,
    grip: 8.8, drag: 0.33, health: 1400, mass: 2000, price: 18500,
    colors: ['#3f4a3c', '#d8d2c4', '#2c3033', '#6d5a3f'],
  },
  vespa: {
    id: 'vespa', name: 'VESPA 125', classLabel: 'SCOOTER', length: 1.9, width: 0.78, height: 1.15,
    wheelRadius: 0.24, wheelBase: 1.25, maxSpeed: 25, reverseSpeed: 4, accel: 9, brake: 15, steerRate: 2.4,
    grip: 9, drag: 0.4, health: 380, mass: 160, price: 2600,
    colors: ['#c9d6c8', '#b23a30', '#e0d3a8', '#3d6a8a'],
  },
  police: {
    id: 'police', name: 'VOLANTE', classLabel: 'POLIZIA', length: 4.62, width: 1.86, height: 1.5,
    wheelRadius: 0.33, wheelBase: 2.72, maxSpeed: 50, reverseSpeed: 11, accel: 16, brake: 21, steerRate: 1.7,
    grip: 9.5, drag: 0.28, health: 1250, mass: 1400, price: 0,
    colors: ['#e8e6df'],
  },
};

interface GeoSet {
  body: THREE.BufferGeometry;
  wheel: THREE.BufferGeometry;
  lights: THREE.BufferGeometry;
}

const geoCache = new Map<VehicleTypeId, GeoSet>();
let sharedTire: THREE.MeshLambertMaterial | null = null;
let sharedLights: THREE.MeshBasicMaterial | null = null;

const W = new THREE.Color('#ffffff');
const DARK = new THREE.Color('#26282a');
const BLACK = new THREE.Color('#0e0f10');
const RED = new THREE.Color('#c62d22');
const AMBER = new THREE.Color('#d68a26');
const WHITE = new THREE.Color('#fff6d8');
const BLUE = new THREE.Color('#2c62d8');

function box(
  b: MeshBuilder,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  color: THREE.Color,
  rotY = 0,
): void {
  b.addBox(cx, cy, cz, sx, sy, sz, rotY, color, 2, color, DARK);
}

function buildCarGeometry(def: VehicleDef): GeoSet {
  const body = new MeshBuilder();
  const lights = new MeshBuilder();
  const L = def.length;
  const Wd = def.width;
  const H = def.height;
  const isVan = def.id === 'furgone';
  const isTruck = def.id === 'camion';
  const isSport = def.id === 'sportiva';
  const isScooter = def.id === 'vespa';
  const isPolice = def.id === 'police';

  if (isScooter) {
    box(body, 0, 0.45, 0, 0.36, 0.3, 1.15, W);
    box(body, 0, 0.62, -0.22, 0.4, 0.18, 0.55, DARK);
    box(body, 0, 0.78, 0.55, 0.24, 0.5, 0.24, W);
    box(body, 0, 1.02, 0.62, 0.5, 0.06, 0.08, DARK);
    box(body, 0, 0.86, 0.68, 0.18, 0.22, 0.14, WHITE);
    box(lights, 0, 0.86, 0.75, 0.16, 0.12, 0.05, WHITE);
    box(lights, 0, 0.7, -0.62, 0.12, 0.08, 0.05, RED);
  } else if (isTruck) {
    box(body, 0, 0.85, 0.4, Wd, 0.6, L * 0.72, W);
    box(body, 0, 2.0, 0.4, Wd * 0.98, 1.7, L * 0.7, W);
    box(body, 0, 1.2, L * 0.34, Wd * 0.96, 1.4, L * 0.22, W);
    box(body, 0, 1.72, L * 0.435, Wd * 0.82, 0.62, 0.08, DARK);
    box(body, 0, 0.9, -L * 0.44, Wd, 0.5, 0.25, DARK);
    box(lights, -Wd * 0.36, 0.85, L * 0.455, 0.3, 0.2, 0.06, WHITE);
    box(lights, Wd * 0.36, 0.85, L * 0.455, 0.3, 0.2, 0.06, WHITE);
    box(lights, -Wd * 0.36, 0.85, -L * 0.455, 0.3, 0.18, 0.06, RED);
    box(lights, Wd * 0.36, 0.85, -L * 0.455, 0.3, 0.18, 0.06, RED);
  } else if (isVan) {
    box(body, 0, 0.62, 0, Wd, 0.55, L, W);
    box(body, 0, 1.55, -L * 0.08, Wd * 0.98, 1.4, L * 0.78, W);
    box(body, 0, 1.1, L * 0.38, Wd * 0.94, 0.7, L * 0.24, W);
    box(body, 0, 1.6, L * 0.33, Wd * 0.82, 0.7, 0.08, DARK);
    box(body, -Wd * 0.5, 1.6, L * 0.12, 0.06, 0.5, 0.9, DARK);
    box(body, Wd * 0.5, 1.6, L * 0.12, 0.06, 0.5, 0.9, DARK);
    box(body, 0, 0.9, L * 0.5, Wd * 0.98, 0.3, 0.18, DARK);
    box(lights, -Wd * 0.36, 0.82, L * 0.505, 0.3, 0.22, 0.06, WHITE);
    box(lights, Wd * 0.36, 0.82, L * 0.505, 0.3, 0.22, 0.06, WHITE);
    box(lights, -Wd * 0.4, 1.1, -L * 0.5, 0.22, 0.55, 0.06, RED);
    box(lights, Wd * 0.4, 1.1, -L * 0.5, 0.22, 0.55, 0.06, RED);
  } else {
    const cabinH = isSport ? 0.5 : 0.6;
    const bodyH = isSport ? 0.48 : 0.55;
    const bodyY = 0.36 + bodyH / 2;
    box(body, 0, bodyY, 0, Wd, bodyH, L, W);
    // hood and trunk
    const hoodH = isSport ? 0.22 : 0.24;
    box(body, 0, 0.36 + bodyH + hoodH / 2 - 0.06, L * 0.3, Wd * 0.94, hoodH, L * 0.32, W);
    box(body, 0, 0.36 + bodyH + hoodH / 2 - 0.06, -L * 0.3, Wd * 0.94, hoodH, L * 0.3, W);
    // cabin
    const cabinZ = isSport ? -L * 0.08 : -L * 0.03;
    box(body, 0, 0.36 + bodyH + cabinH / 2, cabinZ, Wd * 0.84, cabinH, L * 0.42, W);
    // roof
    box(body, 0, 0.36 + bodyH + cabinH + 0.02, cabinZ, Wd * 0.8, 0.1, L * 0.4, W);
    // glass
    box(body, 0, 0.36 + bodyH + cabinH * 0.55, cabinZ + L * 0.215, Wd * 0.72, cabinH * 0.62, 0.06, DARK);
    box(body, 0, 0.36 + bodyH + cabinH * 0.55, cabinZ - L * 0.215, Wd * 0.72, cabinH * 0.62, 0.06, DARK);
    box(body, -Wd * 0.43, 0.36 + bodyH + cabinH * 0.55, cabinZ, 0.06, cabinH * 0.55, L * 0.32, DARK);
    box(body, Wd * 0.43, 0.36 + bodyH + cabinH * 0.55, cabinZ, 0.06, cabinH * 0.55, L * 0.32, DARK);
    // bumpers
    box(body, 0, 0.52, L * 0.505, Wd * 1.01, 0.28, 0.2, DARK);
    box(body, 0, 0.52, -L * 0.505, Wd * 1.01, 0.28, 0.2, DARK);
    box(body, 0, 0.34, 0, Wd * 0.98, 0.2, L * 0.98, BLACK);
    // grille
    box(body, 0, 0.68, L * 0.508, Wd * 0.42, 0.18, 0.06, BLACK);
    // mirrors
    box(body, -Wd * 0.53, 0.36 + bodyH + cabinH * 0.5, cabinZ + L * 0.16, 0.16, 0.1, 0.08, DARK);
    box(body, Wd * 0.53, 0.36 + bodyH + cabinH * 0.5, cabinZ + L * 0.16, 0.16, 0.1, 0.08, DARK);
    // lights
    box(lights, -Wd * 0.34, 0.72, L * 0.512, 0.34, 0.18, 0.05, WHITE);
    box(lights, Wd * 0.34, 0.72, L * 0.512, 0.34, 0.18, 0.05, WHITE);
    box(lights, -Wd * 0.36, 0.74, -L * 0.512, 0.32, 0.16, 0.05, RED);
    box(lights, Wd * 0.36, 0.74, -L * 0.512, 0.32, 0.16, 0.05, RED);
    box(lights, -Wd * 0.47, 0.72, L * 0.505, 0.1, 0.1, 0.05, AMBER);
    box(lights, Wd * 0.47, 0.72, L * 0.505, 0.1, 0.1, 0.05, AMBER);
    if (isSport) {
      box(body, 0, 0.36 + bodyH + 0.16, -L * 0.48, Wd * 0.9, 0.06, 0.35, DARK);
      box(body, -Wd * 0.42, 0.36 + bodyH + 0.08, -L * 0.47, 0.08, 0.2, 0.12, DARK);
      box(body, Wd * 0.42, 0.36 + bodyH + 0.08, -L * 0.47, 0.08, 0.2, 0.12, DARK);
    }
    if (isPolice) {
      box(lights, 0, 0.36 + bodyH + cabinH + 0.16, cabinZ, Wd * 0.5, 0.14, 0.24, BLUE);
      box(lights, 0, 0.36 + bodyH + cabinH + 0.16, cabinZ + 0.14, Wd * 0.5, 0.14, 0.1, RED);
      box(body, 0, 0.36 + bodyH + cabinH * 0.55, cabinZ, Wd * 0.845, 0.2, L * 0.42, WHITE);
    }
    if (def.id === 'taxi') {
      box(body, 0, 0.36 + bodyH + cabinH + 0.16, cabinZ, 0.5, 0.22, 0.3, WHITE);
    }
  }

  // One wheel shared by the four instances; local placement happens per car.
  const wheel = new THREE.CylinderGeometry(def.wheelRadius, def.wheelRadius, 0.24, 10);
  wheel.rotateZ(Math.PI / 2);

  return {
    body: body.build() ?? new THREE.BufferGeometry(),
    wheel,
    lights: lights.build() ?? new THREE.BufferGeometry(),
  };
}

function getGeoSet(def: VehicleDef): GeoSet {
  let set = geoCache.get(def.id);
  if (!set) {
    set = buildCarGeometry(def);
    geoCache.set(def.id, set);
  }
  return set;
}

export function getVehicleMaterials(): {
  tire: THREE.MeshLambertMaterial;
  lights: THREE.MeshBasicMaterial;
} {
  if (!sharedTire) {
    sharedTire = new THREE.MeshLambertMaterial({ color: '#17191a' });
  }
  if (!sharedLights) {
    sharedLights = new THREE.MeshBasicMaterial({ vertexColors: true });
  }
  return { tire: sharedTire, lights: sharedLights };
}

export interface DriveControls {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
}

export type DriverKind = 'player' | 'npc' | 'police' | null;

let nextVehicleId = 1;

export class Vehicle {
  readonly id: number;
  readonly def: VehicleDef;
  readonly mesh: THREE.Group;
  readonly color: string;
  position = new THREE.Vector3();
  velX = 0;
  velZ = 0;
  yaw = 0;
  health: number;
  maxHealth: number;
  driver: DriverKind = null;
  destroyed = false;
  ai: {
    link: number;
    t: number;
    speed: number;
    lane: number;
    stuck: number;
    honk: number;
  } | null = null;
  parked = false;
  /** Signed lateral velocity, used by skid marks / smoke. */
  lateralSpeed = 0;
  handbraking = false;
  /** True for vehicles bought or stored by the player (not counted as stolen). */
  owned = false;
  private pitch = 0;
  private roll = 0;
  private lastImpact = 0;
  private smokeTime = 0;
  private wheelMesh: THREE.InstancedMesh;
  private lightsMesh: THREE.Mesh;
  private lodLevel = -1;
  private wheelOffsets: Array<{ x: number; y: number; z: number; front: boolean }> = [];
  private wheelSpin = 0;
  private wheelSteer = 0;
  private readonly wheelDummy = new THREE.Object3D();

  constructor(def: VehicleDef, color: string) {
    this.id = nextVehicleId++;
    this.def = def;
    this.color = color;
    this.health = def.health;
    this.maxHealth = def.health;
    const set = getGeoSet(def);
    const mats = getVehicleMaterials();
    this.mesh = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.25,
      roughness: 0.42,
      vertexColors: true,
    });
    const bodyMesh = new THREE.Mesh(set.body, bodyMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    const wheelMesh = new THREE.InstancedMesh(set.wheel, mats.tire, 4);
    wheelMesh.castShadow = true;
    wheelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const lightsMesh = new THREE.Mesh(set.lights, mats.lights);
    this.wheelMesh = wheelMesh;
    this.lightsMesh = lightsMesh;
    const axle = def.wheelBase / 2;
    const halfTrack = def.width / 2 - 0.04;
    const wheelZ = def.id === 'vespa' ? 0.62 : axle;
    for (const sx of [-1, 1]) {
      for (const sz of def.id === 'vespa' ? [1, -1] : [-1, 1]) {
        this.wheelOffsets.push({
          x: sx * halfTrack,
          y: def.wheelRadius,
          z: sz * wheelZ,
          front: sz > 0,
        });
      }
    }
    for (let i = 0; i < this.wheelOffsets.length; i++) this.updateWheelMatrix(i);
    wheelMesh.instanceMatrix.needsUpdate = true;
    wheelMesh.computeBoundingSphere();
    this.mesh.add(bodyMesh, wheelMesh, lightsMesh);
    this.mesh.rotation.order = 'YXZ';
  }

  get forwardX(): number {
    return Math.sin(this.yaw);
  }

  get forwardZ(): number {
    return Math.cos(this.yaw);
  }

  get speed(): number {
    return Math.hypot(this.velX, this.velZ);
  }

  get speedKmh(): number {
    return Math.round(this.speed * 3.6);
  }

  get maxSpeed(): number {
    return this.def.maxSpeed;
  }

  place(x: number, z: number, yaw: number, world: World): void {
    this.position.set(x, world.groundHeight(x, z), z);
    this.yaw = yaw;
    this.velX = 0;
    this.velZ = 0;
    this.lateralSpeed = 0;
    this.handbraking = false;
    this.syncTransform();
  }

  /** Put a rolled or stuck car back on its wheels without teleporting it away. */
  resetUpright(world: World): boolean {
    if (this.destroyed) return false;
    this.position.y = world.groundHeight(this.position.x, this.position.z) + 0.02;
    this.velX = 0;
    this.velZ = 0;
    this.lateralSpeed = 0;
    this.handbraking = false;
    this.pitch = 0;
    this.roll = 0;
    this.syncTransform();
    return true;
  }

  /** 0 = full, 1 = no lights, 2 = body only (distant traffic). */
  setLod(level: number): void {
    if (this.lodLevel === level) return;
    this.lodLevel = level;
    this.lightsMesh.visible = level < 1;
    this.wheelMesh.visible = level < 2;
  }

  private updateWheelMatrix(index: number): void {
    const w = this.wheelOffsets[index];
    this.wheelDummy.position.set(w.x, w.y, w.z);
    this.wheelDummy.rotation.set(this.wheelSpin, w.front ? this.wheelSteer : 0, 0, 'YXZ');
    this.wheelDummy.updateMatrix();
    this.wheelMesh.setMatrixAt(index, this.wheelDummy.matrix);
  }

  /** Spin the wheels with forward speed and steer the front pair. */
  updateWheelVisuals(dt: number, forwardSpeed: number, steer: number): void {
    if (!this.wheelMesh.visible) return;
    let spin = this.wheelSpin + (forwardSpeed * dt) / Math.max(0.05, this.def.wheelRadius);
    spin %= TAU;
    if (spin < 0) spin += TAU;
    const targetSteer = clamp(steer, -1, 1) * 0.5;
    if (Math.abs(spin - this.wheelSpin) < 0.0001 && Math.abs(targetSteer - this.wheelSteer) < 0.0001) {
      return;
    }
    this.wheelSpin = spin;
    this.wheelSteer = targetSteer;
    for (let i = 0; i < this.wheelOffsets.length; i++) this.updateWheelMatrix(i);
    this.wheelMesh.instanceMatrix.needsUpdate = true;
  }

  syncTransform(): void {
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;
    this.mesh.rotation.x = this.pitch;
    this.mesh.rotation.z = this.roll;
  }

  update(dt: number, controls: DriveControls, world: World): void {
    if (this.destroyed) return;
    const def = this.def;
    const fwdX = this.forwardX;
    const fwdZ = this.forwardZ;
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    let fwdSpeed = this.velX * fwdX + this.velZ * fwdZ;
    let latSpeed = this.velX * rightX + this.velZ * rightZ;

    const throttle = clamp(controls.throttle, 0, 1);
    const brake = clamp(controls.brake, 0, 1);

    if (throttle > 0.02) {
      const falloff = 1 - clamp01(Math.abs(fwdSpeed) / def.maxSpeed) * 0.92;
      fwdSpeed += def.accel * throttle * falloff * dt;
    }
    if (brake > 0.02) {
      if (fwdSpeed > 0.4) {
        fwdSpeed = Math.max(0, fwdSpeed - def.brake * brake * dt);
      } else {
        fwdSpeed = Math.max(-def.reverseSpeed, fwdSpeed - def.accel * 0.7 * brake * dt);
      }
    }
    if (controls.handbrake) {
      const sign = Math.sign(fwdSpeed);
      fwdSpeed -= sign * def.brake * 0.85 * dt;
      if (Math.abs(fwdSpeed) < 0.4) fwdSpeed = 0;
    }

    // rolling resistance + aerodynamic drag
    const sign = Math.sign(fwdSpeed);
    fwdSpeed -= sign * 0.55 * dt;
    fwdSpeed -= fwdSpeed * def.drag * dt;
    if (Math.abs(fwdSpeed) < 0.05) fwdSpeed = 0;
    fwdSpeed = clamp(fwdSpeed, -def.reverseSpeed, def.maxSpeed);

    // steering
    const speedFactor = clamp01(Math.abs(fwdSpeed) / 6);
    const highSpeedDamp = lerp(1, 0.52, clamp01(Math.abs(fwdSpeed) / def.maxSpeed));
    // Positive steer points the car right, and yaw grows counter-clockwise.
    const steerDir = fwdSpeed >= -0.2 ? -1 : 1;
    const yawDelta =
      controls.steer * def.steerRate * speedFactor * highSpeedDamp * steerDir * dt;
    this.yaw += yawDelta;

    // recompute basis after steering and re-project velocity
    const nfX = Math.sin(this.yaw);
    const nfZ = Math.cos(this.yaw);
    const nrX = Math.cos(this.yaw);
    const nrZ = -Math.sin(this.yaw);
    // world velocity from previous frame
    const worldVx = fwdX * fwdSpeed + rightX * latSpeed;
    const worldVz = fwdZ * fwdSpeed + rightZ * latSpeed;
    fwdSpeed = worldVx * nfX + worldVz * nfZ;
    latSpeed = worldVx * nrX + worldVz * nrZ;

    const grip = controls.handbrake ? def.grip * 0.16 : def.grip;
    latSpeed *= Math.exp(-grip * dt);
    if (controls.handbrake) {
      latSpeed += controls.steer * Math.abs(fwdSpeed) * 0.85 * dt;
    }

    this.velX = nfX * fwdSpeed + nrX * latSpeed;
    this.velZ = nfZ * fwdSpeed + nrZ * latSpeed;

    const prevSpeed = Math.hypot(this.velX, this.velZ);
    this.position.x += this.velX * dt;
    this.position.z += this.velZ * dt;

    // collisions at front and rear
    const col = world.collision;
    const half = def.length * 0.38;
    for (const off of [half, -half]) {
      const px = this.position.x + nfX * off;
      const pz = this.position.z + nfZ * off;
      const res = col.resolveCircle(px, pz, def.width * 0.46, this.position.y + 0.3, this.position.y + def.height);
      if (res.hit) {
        this.position.x += res.x - px;
        this.position.z += res.z - pz;
        const impact = Math.abs(fwdSpeed) + Math.abs(latSpeed) * 0.5;
        if (impact > 4 && this.lastImpact < 0.2) {
          this.damage(impact * 6, 'crash');
          events.emit('vehicle:crash', {
            vehicleId: this.id,
            impact,
            x: this.position.x,
            z: this.position.z,
          });
          this.lastImpact = 0.25;
        }
        this.velX *= 0.32;
        this.velZ *= 0.32;
        break;
      }
    }
    this.lastImpact = Math.max(0, this.lastImpact - dt);

    const clamped = world.clampToWorld(this.position.x, this.position.z);
    this.position.x = clamped.x;
    this.position.z = clamped.z;

    // ground + orientation
    const ground = world.groundHeight(this.position.x, this.position.z);
    const waterLevel = world.waterLevelAt(this.position.x, this.position.z);
    if (world.isWater(this.position.x, this.position.z) && ground < waterLevel - 0.6) {
      this.position.y = damp(this.position.y, waterLevel - 0.25, 3, dt);
      this.velX *= Math.exp(-2.2 * dt);
      this.velZ *= Math.exp(-2.2 * dt);
      this.pitch = damp(this.pitch, 0, 4, dt);
      this.roll = damp(this.roll, 0, 4, dt);
    } else {
      this.position.y = damp(this.position.y, ground, 16, dt);
      const frontH = world.groundHeight(this.position.x + nfX * half, this.position.z + nfZ * half);
      const rearH = world.groundHeight(this.position.x - nfX * half, this.position.z - nfZ * half);
      const leftH = world.groundHeight(this.position.x - nrX * def.width * 0.4, this.position.z - nrZ * def.width * 0.4);
      const rightH = world.groundHeight(this.position.x + nrX * def.width * 0.4, this.position.z + nrZ * def.width * 0.4);
      const targetPitch = Math.atan2(rearH - frontH, def.wheelBase) * 0.85;
      const targetRoll = Math.atan2(leftH - rightH, def.width) * 0.7;
      this.pitch = damp(this.pitch, targetPitch, 8, dt);
      this.roll = damp(this.roll, targetRoll, 8, dt);
    }

    this.lateralSpeed = this.velX * Math.cos(this.yaw) - this.velZ * Math.sin(this.yaw);
    this.handbraking = controls.handbrake;
    this.syncTransform();
    const forwardSpeed = this.velX * nfX + this.velZ * nfZ;
    this.updateWheelVisuals(dt, forwardSpeed, -controls.steer);

    // speed-based damage smoke
    if (this.health < this.maxHealth * 0.35 && prevSpeed > 2) {
      this.smokeTime += dt;
    }
  }

  damage(amount: number, reason: string): void {
    if (this.destroyed) return;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.destroyed = true;
      this.velX = 0;
      this.velZ = 0;
      events.emit('vehicle:destroyed', { vehicleId: this.id, x: this.position.x, z: this.position.z });
      if (this.driver === 'player') {
        events.emit('player:damaged', { amount: 55, health: 0 });
      }
    }
    void reason;
  }

  repair(): void {
    this.health = this.maxHealth;
    this.destroyed = false;
    this.velX = 0;
    this.velZ = 0;
    this.lateralSpeed = 0;
    this.handbraking = false;
  }

  get smokeTimer(): number {
    return this.smokeTime;
  }

  dispose(): void {
    this.wheelMesh.dispose();
    this.mesh.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        const mat = mesh.material as THREE.Material;
        if (mat && mat !== sharedTire && mat !== sharedLights) mat.dispose();
      }
    });
  }
}

export function createVehicle(type: VehicleTypeId, color?: string): Vehicle {
  const def = VEHICLE_TYPES[type];
  const chosen = color ?? def.colors[Math.floor(Math.random() * def.colors.length)];
  return new Vehicle(def, chosen);
}
