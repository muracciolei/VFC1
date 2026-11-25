/**
 * Pedestrian population rendered with instanced meshes (one draw per body part).
 * Peds wander the streets, panic when shots are fired and can be run over.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, dist2D, pick, randomRange, wrapAngle } from '../core/math';
import { events } from '../core/events';
import { World } from '../world/world';
import { VehicleSystem } from './vehicles';

const MAX_PEDS = 46;
const TARGET_PEDS = 26;

const SHIRTS = [
  '#2c3b47', '#7d3a34', '#3f5a44', '#c9c3b6', '#4a4f6a', '#8a6a3f',
  '#5a3f52', '#2d4a5a', '#a8a29a', '#6b4a34', '#3a3a3c', '#b5844a',
];
const PANTS = ['#23262b', '#2e3038', '#3b3a35', '#1e2024', '#4a4438', '#2a3036'];
const SKINS = ['#c99a72', '#b9875e', '#e0b58c', '#8a5f3f', '#d1a077', '#a9754f'];
const HAIR_COLORS = ['#241d18', '#3b2a1d', '#6b5334', '#16181b', '#8b7355', '#43332a'];
const HAT_COLORS = ['#2a2c30', '#6b3d32', '#3b4a5a', '#c9b48a', '#4a5a3a'];
const BAG_COLORS = ['#3a2c22', '#5b3a28', '#23262b', '#6b5a3f'];
const JACKETS = ['#3a2f28', '#22303a', '#4a3a2e', '#2e3d2c', '#5a2f2a', '#2b2b30', '#5b4a33'];
const SHOE_COLORS = ['#2e2a26', '#3b342c', '#242e33'];
const HAIR_COLOR_OBJS = HAIR_COLORS.map((c) => new THREE.Color(c));
const HAT_COLOR_OBJS = HAT_COLORS.map((c) => new THREE.Color(c));
const BAG_COLOR_OBJS = BAG_COLORS.map((c) => new THREE.Color(c));
const SHOE_COLOR_OBJS = SHOE_COLORS.map((c) => new THREE.Color(c));

export type PedState = 'walk' | 'flee' | 'dead';

export interface Ped {
  id: number;
  x: number;
  z: number;
  y: number;
  yaw: number;
  targetYaw: number;
  phase: number;
  speed: number;
  state: PedState;
  stateTimer: number;
  turnTimer: number;
  health: number;
  deadTime: number;
  shirt: THREE.Color;
  pants: THREE.Color;
  skin: THREE.Color;
  jacket: THREE.Color | null;
  /** Torso width multiplier, 0.94..1.08, for less uniform silhouettes. */
  build: number;
  threatX: number;
  threatZ: number;
}

interface PartMesh {
  mesh: THREE.InstancedMesh;
  kind:
    | 'torso'
    | 'neck'
    | 'head'
    | 'hair'
    | 'legL'
    | 'legR'
    | 'shinL'
    | 'shinR'
    | 'armL'
    | 'armR'
    | 'handL'
    | 'handR'
    | 'shoeL'
    | 'shoeR'
    | 'hat'
    | 'bag'
    | 'jacket';
  scale: THREE.Vector3;
}

const tmpMatrix = new THREE.Matrix4();
const tmpLocal = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

export class PedestrianSystem {
  readonly peds: Ped[] = [];
  private scene: THREE.Scene;
  private world: World;
  private parts: PartMesh[] = [];
  private spawnTimer = 0;
  private colorsDirty = true;
  private nextId = 1;
  private time = 0;
  private anchorX = 0;
  private anchorZ = 0;
  private seeded = false;

  constructor(scene: THREE.Scene, world: World) {
    this.scene = scene;
    this.world = world;
    this.createInstances();
  }

  /* -------------------------------------------------------------- */
  /* Instanced rendering                                             */
  /* -------------------------------------------------------------- */

  private createInstances(): void {
    const mat = (): THREE.MeshLambertMaterial =>
      new THREE.MeshLambertMaterial({ color: 0xffffff });

    // Tapered cylinders + spheres read as people instead of stacked crates.
    const torsoGeo = new THREE.CylinderGeometry(0.24, 0.185, 0.58, 8, 1);
    const headGeo = new THREE.SphereGeometry(0.135, 10, 8);
    const hairGeo = new THREE.SphereGeometry(0.143, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.56);
    const thighGeo = new THREE.CylinderGeometry(0.094, 0.078, 0.42, 6, 1);
    thighGeo.translate(0, -0.21, 0);
    const shinGeo = new THREE.CylinderGeometry(0.074, 0.058, 0.36, 6, 1);
    shinGeo.translate(0, -0.18, 0);
    // Shoe origin is the ankle, not the ground; the knee chain places it.
    const shoeGeo = new THREE.BoxGeometry(0.13, 0.09, 0.26);
    shoeGeo.translate(0, -0.035, 0.055);
    const armGeo = new THREE.CylinderGeometry(0.073, 0.055, 0.54, 6, 1);
    armGeo.translate(0, -0.27, 0);
    const capTop = new THREE.CylinderGeometry(0.145, 0.152, 0.095, 10);
    capTop.translate(0, 0.0475, 0);
    const capBrim = new THREE.BoxGeometry(0.28, 0.022, 0.2);
    capBrim.translate(0, 0.008, 0.07);
    const mergedHat = mergeGeometries([capTop, capBrim], false);
    capTop.dispose();
    capBrim.dispose();
    if (!mergedHat) throw new Error('Pedestrian hat geometry merge failed');
    const bagGeo = new THREE.BoxGeometry(0.17, 0.24, 0.09);
    // Open-front shell worn over the shirt, with a gap centred on +Z.
    const jacketGeo = new THREE.CylinderGeometry(0.252, 0.2, 0.5, 10, 1, true, 0.3, Math.PI * 2 - 0.6);
    const neckGeo = new THREE.CylinderGeometry(0.068, 0.078, 0.16, 6);
    const handGeo = new THREE.SphereGeometry(0.062, 6, 4);
    handGeo.translate(0, -0.56, 0);

    const ONE_SCALE = new THREE.Vector3(1, 1, 1);
    const defs: Array<{
      geo: THREE.BufferGeometry;
      kind: PartMesh['kind'];
      scale?: THREE.Vector3;
    }> = [
      { geo: torsoGeo, kind: 'torso' },
      { geo: neckGeo, kind: 'neck' },
      { geo: headGeo, kind: 'head', scale: new THREE.Vector3(1, 1.1, 0.94) },
      { geo: hairGeo, kind: 'hair' },
      { geo: thighGeo, kind: 'legL' },
      { geo: thighGeo.clone(), kind: 'legR' },
      { geo: shinGeo, kind: 'shinL' },
      { geo: shinGeo.clone(), kind: 'shinR' },
      { geo: armGeo, kind: 'armL' },
      { geo: armGeo.clone(), kind: 'armR' },
      { geo: handGeo, kind: 'handL' },
      { geo: handGeo.clone(), kind: 'handR' },
      { geo: shoeGeo, kind: 'shoeL' },
      { geo: shoeGeo.clone(), kind: 'shoeR' },
      { geo: mergedHat, kind: 'hat' },
      { geo: bagGeo, kind: 'bag' },
      { geo: jacketGeo, kind: 'jacket' },
    ];

    for (const d of defs) {
      const mesh = new THREE.InstancedMesh(d.geo, mat(), MAX_PEDS);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.parts.push({ mesh, kind: d.kind, scale: d.scale ?? ONE_SCALE });
    }
    // allocate instanceColor buffers up front
    for (const p of this.parts) {
      const colors = new Float32Array(MAX_PEDS * 3);
      p.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      p.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
  }

  private refreshInstances(): void {
    const n = this.peds.length;
    const writeColors = this.colorsDirty;
    for (const part of this.parts) {
      part.mesh.count = n;
      part.mesh.instanceMatrix.needsUpdate = true;
      if (writeColors && part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
    }
    for (let i = 0; i < n; i++) {
      this.writePed(i, writeColors);
    }
    this.colorsDirty = false;
  }

  private writePed(i: number, writeColors: boolean): void {
    const ped = this.peds[i];
    const dead = ped.state === 'dead';
    const flee = ped.state === 'flee';
    const hasHat = ped.id % 3 === 0;
    const hasBag = ped.id % 4 === 1;
    const hasJacket = ped.jacket !== null;
    const amp = clamp((flee ? 4.3 : ped.speed) / 3, 0, 1);
    const swing = Math.sin(ped.phase) * amp * 0.52;
    const bob = dead ? 0 : Math.abs(Math.sin(ped.phase * 2)) * amp * 0.022;
    const height = 0.9 + (ped.id % 7) * 0.033; // 0.90 .. 1.10

    // Two-segment legs: thigh + shin + foot. The knee bends on the back swing
    // and the hips drop just enough to keep the lower foot on the pavement.
    const hipY = 0.88;
    const thighLen = 0.42;
    const shinLen = 0.36;
    const legL = dead ? 0.12 : swing;
    const legR = dead ? -0.12 : -swing;
    // The trailing leg bends as it lifts; the leading leg stays straighter.
    const kneeL = dead ? 0.3 : 0.08 + Math.max(0, Math.sin(ped.phase)) * amp * 0.7;
    const kneeR = dead ? 0.3 : 0.08 + Math.max(0, -Math.sin(ped.phase)) * amp * 0.7;
    const ankleL = hipY - thighLen * Math.cos(legL) - shinLen * Math.cos(legL + kneeL);
    const ankleR = hipY - thighLen * Math.cos(legR) - shinLen * Math.cos(legR + kneeR);
    const footRotL = (legL + kneeL) * 0.25;
    const footRotR = (legR + kneeR) * 0.25;
    // Lowest sole corner after the shoe tilt; using the ankle alone lets the toe
    // or heel dip below the pavement on some phases.
    const shoeBottom = (ankle: number, rot: number): number => {
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      return ankle - 0.08 * c - Math.max(0.185 * s, -0.075 * s);
    };
    const groundDrop = dead
      ? 0
      : clamp(Math.min(shoeBottom(ankleL, footRotL), shoeBottom(ankleR, footRotR)) - 0.002, 0, 0.2) * height;

    if (dead) {
      tmpEuler.set(0, ped.yaw, -Math.PI * 0.48, 'YXZ');
      tmpQuat.setFromEuler(tmpEuler);
      tmpPos.set(ped.x, ped.y + 0.24, ped.z);
    } else {
      tmpEuler.set(0, ped.yaw, 0, 'YXZ');
      tmpQuat.setFromEuler(tmpEuler);
      tmpPos.set(ped.x, ped.y - groundDrop, ped.z);
    }
    tmpMatrix.compose(tmpPos, tmpQuat, ONE);

    for (const part of this.parts) {
      let localY = 0;
      let localX = 0;
      let localZ = 0;
      let rotX = 0;
      switch (part.kind) {
        case 'torso':
          localY = 1.16 + bob;
          break;
        case 'neck':
          localY = 1.52 + bob;
          break;
        case 'head':
        case 'hair':
          localY = (part.kind === 'hair' ? 1.665 : 1.64) + bob;
          break;
        case 'legL':
          localX = -0.112;
          localY = hipY;
          rotX = legL;
          break;
        case 'legR':
          localX = 0.112;
          localY = hipY;
          rotX = legR;
          break;
        case 'shinL':
          localX = -0.112;
          localY = hipY - thighLen * Math.cos(legL);
          localZ = -thighLen * Math.sin(legL);
          rotX = legL + kneeL;
          break;
        case 'shinR':
          localX = 0.112;
          localY = hipY - thighLen * Math.cos(legR);
          localZ = -thighLen * Math.sin(legR);
          rotX = legR + kneeR;
          break;
        case 'shoeL':
          localX = -0.112;
          localY = ankleL;
          localZ = -thighLen * Math.sin(legL) - shinLen * Math.sin(legL + kneeL);
          rotX = footRotL;
          break;
        case 'shoeR':
          localX = 0.112;
          localY = ankleR;
          localZ = -thighLen * Math.sin(legR) - shinLen * Math.sin(legR + kneeR);
          rotX = footRotR;
          break;
        case 'jacket':
          localY = 1.17 + bob;
          break;
        case 'armL':
          localX = -0.275 * ped.build;
          localY = 1.43 + bob;
          rotX = dead
            ? -0.2
            : flee
              ? -2.3 + Math.sin(this.time * 11 + ped.id) * 0.12
              : -swing * 0.82;
          break;
        case 'armR':
          localX = 0.275 * ped.build;
          localY = 1.43 + bob;
          rotX = dead
            ? 0.2
            : flee
              ? -2.3 + Math.sin(this.time * 11 + ped.id + 1.7) * 0.12
              : swing * 0.82;
          break;
        case 'handL':
          localX = -0.275 * ped.build;
          localY = 1.43 + bob;
          rotX = dead
            ? -0.2
            : flee
              ? -2.3 + Math.sin(this.time * 11 + ped.id) * 0.12
              : -swing * 0.82;
          break;
        case 'handR':
          localX = 0.275 * ped.build;
          localY = 1.43 + bob;
          rotX = dead
            ? 0.2
            : flee
              ? -2.3 + Math.sin(this.time * 11 + ped.id + 1.7) * 0.12
              : swing * 0.82;
          break;
        case 'hat':
          localY = 1.74 + bob;
          break;
        case 'bag':
          localX = 0.19;
          localY = 1.0;
          localZ = -0.12;
          break;
      }
      if (part.kind === 'armL' || part.kind === 'armR' || part.kind === 'handL' || part.kind === 'handR') {
        const left = part.kind === 'armL' || part.kind === 'handL';
        const splay = flee ? (left ? 0.35 : -0.35) : left ? -0.05 : 0.05;
        tmpEuler.set(rotX, 0, splay, 'XYZ');
        tmpLocal.makeRotationFromEuler(tmpEuler);
      } else {
        tmpLocal.makeRotationX(rotX);
      }
      const visible =
        part.kind === 'hat'
          ? hasHat
          : part.kind === 'bag'
            ? hasBag
            : part.kind === 'jacket'
              ? hasJacket
              : true;
      tmpLocal.setPosition(localX, localY * height, localZ * height);
      tmpScale.copy(part.scale).multiplyScalar(visible ? height : 0);
      if (part.kind === 'torso' || part.kind === 'jacket') {
        tmpScale.x *= ped.build;
        tmpScale.z *= ped.build;
      }
      tmpLocal.scale(tmpScale);
      // Body transform first, then the limb offset: local * body would scale the
      // world position and sink the pedestrians into the ground.
      tmpLocal.premultiply(tmpMatrix);
      part.mesh.setMatrixAt(i, tmpLocal);

      if (writeColors) {
        const color =
          part.kind === 'torso'
            ? ped.shirt
            : part.kind === 'armL' || part.kind === 'armR' || part.kind === 'jacket'
              ? (ped.jacket ?? ped.shirt)
              : part.kind === 'head' || part.kind === 'neck' || part.kind === 'handL' || part.kind === 'handR'
              ? ped.skin
              : part.kind === 'hair'
                ? HAIR_COLOR_OBJS[ped.id % HAIR_COLOR_OBJS.length]
                : part.kind === 'hat'
                  ? HAT_COLOR_OBJS[ped.id % HAT_COLOR_OBJS.length]
                  : part.kind === 'bag'
                    ? BAG_COLOR_OBJS[ped.id % BAG_COLOR_OBJS.length]
                    : part.kind === 'shoeL' || part.kind === 'shoeR'
                      ? SHOE_COLOR_OBJS[ped.id % SHOE_COLOR_OBJS.length]
                      : ped.pants;
        part.mesh.setColorAt(i, color);
      }
    }
  }

  /* -------------------------------------------------------------- */
  /* Spawning                                                        */
  /* -------------------------------------------------------------- */

  private spawnNear(maxRadius: number): Ped | null {
    const link = this.world.roads.randomLinkNear(this.anchorX, this.anchorZ, 18, maxRadius);
    if (!link) return null;
    const seg = this.world.roads.segments[link.seg];
    if (!seg || seg.roadClass === 'highway' || seg.bridge) return null;
    const pts = this.world.roads.getLinkPoints(link);
    if (pts.length < 2) return null;
    const idx = Math.floor(Math.random() * (pts.length - 1));
    const a = pts[idx];
    const b = pts[idx + 1];
    const t = Math.random();
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const dx = (b.x - a.x) / len;
    const dz = (b.z - a.z) / len;
    const side = Math.random() < 0.5 ? -1 : 1;
    const off = seg.width * 0.5 + randomRange(1.4, 2.6);
    const px = x + dz * off * side;
    const pz = z - dx * off * side;
    if (this.world.isWater(px, pz)) return null;
    const ground = this.world.groundHeight(px, pz);
    const res = this.world.collision.resolveCircle(px, pz, 0.3, ground + 0.2, ground + 1.8);
    if (res.hit) return null;
    if (this.peds.some((p) => dist2D(px, pz, p.x, p.z) < 1.4)) return null;

    const yaw = Math.atan2(dx, dz) + (side < 0 ? Math.PI : 0);
    const ped: Ped = {
      id: this.nextId++,
      x: px,
      z: pz,
      y: ground,
      yaw,
      targetYaw: yaw,
      phase: Math.random() * Math.PI * 2,
      speed: randomRange(0.9, 1.5),
      state: 'walk',
      stateTimer: 0,
      turnTimer: randomRange(3, 9),
      health: 45,
      deadTime: 0,
      shirt: new THREE.Color(pick(SHIRTS)),
      pants: new THREE.Color(pick(PANTS)),
      skin: new THREE.Color(pick(SKINS)),
      jacket: Math.random() < 0.38 ? new THREE.Color(pick(JACKETS)) : null,
      build: randomRange(0.94, 1.08),
      threatX: 0,
      threatZ: 0,
    };
    this.peds.push(ped);
    this.colorsDirty = true;
    return ped;
  }

  /* -------------------------------------------------------------- */
  /* Frame update                                                    */
  /* -------------------------------------------------------------- */

  update(dt: number, playerX: number, playerZ: number, vehicles: VehicleSystem): void {
    this.time += dt;
    this.anchorX = playerX;
    this.anchorZ = playerZ;

    if (!this.seeded) {
      this.seeded = true;
      for (let i = 0; i < 20; i++) this.spawnNear(170);
      this.refreshInstances();
    }

    for (let i = this.peds.length - 1; i >= 0; i--) {
      const ped = this.peds[i];
      const distToPlayer = dist2D(ped.x, ped.z, playerX, playerZ);

      if (ped.state === 'dead') {
        ped.deadTime += dt;
        if (ped.deadTime > 30 && distToPlayer > 45) {
          this.peds.splice(i, 1);
          this.colorsDirty = true;
          continue;
        }
        continue;
      }
      if (distToPlayer > 230) {
        this.peds.splice(i, 1);
        this.colorsDirty = true;
        continue;
      }

      if (ped.state === 'flee') {
        ped.stateTimer -= dt;
        if (ped.stateTimer <= 0) {
          ped.state = 'walk';
          ped.speed = randomRange(0.9, 1.5);
          ped.turnTimer = randomRange(2, 5);
        }
      }

      let speed = ped.state === 'flee' ? 4.3 : ped.speed;
      if (ped.state === 'flee') {
        ped.yaw = Math.atan2(ped.x - ped.threatX, ped.z - ped.threatZ);
      } else {
        ped.turnTimer -= dt;
        if (ped.turnTimer <= 0) {
          ped.targetYaw = wrapAngle(ped.yaw + randomRange(-1.2, 1.2));
          ped.turnTimer = randomRange(3, 9);
        }
        let delta = wrapAngle(ped.targetYaw - ped.yaw);
        ped.yaw += clamp(delta, -2.4 * dt, 2.4 * dt);
      }

      const nx = ped.x + Math.sin(ped.yaw) * speed * dt;
      const nz = ped.z + Math.cos(ped.yaw) * speed * dt;
      if (this.world.isWater(nx, nz)) {
        ped.yaw = wrapAngle(ped.yaw + Math.PI);
        ped.targetYaw = ped.yaw;
        ped.turnTimer = randomRange(2, 4);
      } else {
        const ground = this.world.groundHeight(nx, nz);
        const res = this.world.collision.resolveCircle(nx, nz, 0.3, ground + 0.25, ground + 1.8);
        if (res.hit) {
          ped.yaw = Math.atan2(res.nx, res.nz) + randomRange(-0.5, 0.5);
          ped.targetYaw = ped.yaw;
          ped.turnTimer = randomRange(1.2, 3);
          speed *= 0.3;
        } else {
          ped.x = nx;
          ped.z = nz;
          ped.y = ground;
        }
      }

      // vehicle impacts
      for (const v of vehicles.vehicles) {
        if (v.destroyed) continue;
        const d = dist2D(ped.x, ped.z, v.position.x, v.position.z);
        if (d > 2.5 || Math.abs(v.position.y - ped.y) > 2.2) continue;
        if (v.speed > 4.5) {
          const byPlayer = v === vehicles.playerVehicle;
          this.killPed(ped, v.position.x, v.position.z, byPlayer);
          if (byPlayer) {
            events.emit('crime', {
              type: 'investimento',
              severity: 2,
              x: ped.x,
              z: ped.z,
              witnessed: true,
            });
          }
          events.emit('audio:crash', { x: ped.x, z: ped.z, impact: v.speed });
          break;
        } else if (v.speed > 0.4 && d < 1.5) {
          ped.state = 'flee';
          ped.stateTimer = 5;
          ped.threatX = v.position.x;
          ped.threatZ = v.position.z;
        }
      }

      ped.phase += speed * 3.2 * dt;
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.65;
      if (this.peds.length < TARGET_PEDS) {
        const added = this.spawnNear(160);
        if (added) this.refreshInstances();
      }
    }

    // rebuild matrices for active peds
    if (this.peds.length > 0) this.refreshInstances();
  }

  /* -------------------------------------------------------------- */
  /* Combat / reactions                                              */
  /* -------------------------------------------------------------- */

  killPed(ped: Ped, fromX: number, fromZ: number, byPlayer: boolean): void {
    if (ped.state === 'dead') return;
    ped.state = 'dead';
    ped.health = 0;
    ped.deadTime = 0;
    ped.speed = 0;
    ped.yaw = Math.atan2(ped.x - fromX, ped.z - fromZ);
    events.emit('npc:shot', { x: ped.x, z: ped.z, killed: true });
    if (byPlayer) {
      events.emit('crime', { type: 'omicidio', severity: 3, x: ped.x, z: ped.z, witnessed: true });
    }
  }

  damagePed(ped: Ped, amount: number, fromX: number, fromZ: number, byPlayer: boolean): void {
    if (ped.state === 'dead') return;
    ped.health -= amount;
    if (ped.health <= 0) {
      this.killPed(ped, fromX, fromZ, byPlayer);
    } else {
      ped.state = 'flee';
      ped.stateTimer = 12;
      ped.threatX = fromX;
      ped.threatZ = fromZ;
      events.emit('npc:shot', { x: ped.x, z: ped.z, killed: false });
    }
  }

  panicAt(x: number, z: number, radius: number): void {
    for (const ped of this.peds) {
      if (ped.state === 'dead') continue;
      if (dist2D(ped.x, ped.z, x, z) < radius) {
        ped.state = 'flee';
        ped.stateTimer = randomRange(6, 12);
        ped.threatX = x;
        ped.threatZ = z;
      }
    }
    events.emit('npc:panic', { x, z, radius });
  }

  /** Ray vs ped capsules. Returns distance and ped index. */
  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
  ): { ped: Ped; distance: number; x: number; y: number; z: number } | null {
    let best: { ped: Ped; distance: number; x: number; y: number; z: number } | null = null;
    for (const ped of this.peds) {
      if (ped.state === 'dead') continue;
      const cx = ped.x;
      const cy = ped.y + 0.95;
      const cz = ped.z;
      const ox = origin.x - cx;
      const oy = origin.y - cy;
      const oz = origin.z - cz;
      const t = -(ox * dir.x + oy * dir.y + oz * dir.z);
      if (t < 0 || t > maxDist) continue;
      const px = ox + dir.x * t;
      const py = oy + dir.y * t;
      const pz = oz + dir.z * t;
      if (px * px + py * py + pz * pz < 0.42 * 0.42) {
        if (!best || t < best.distance) {
          best = { ped, distance: t, x: cx + px * 0.2, y: cy + py * 0.2, z: cz + pz * 0.2 };
        }
      }
    }
    return best;
  }

  get aliveCount(): number {
    let n = 0;
    for (const p of this.peds) if (p.state !== 'dead') n++;
    return n;
  }

  dispose(): void {
    for (const part of this.parts) {
      this.scene.remove(part.mesh);
      part.mesh.geometry.dispose();
      (part.mesh.material as THREE.Material).dispose();
      part.mesh.dispose();
    }
    this.parts = [];
    this.peds.length = 0;
  }
}
