/**
 * Hitscan combat: player shots, enemy tracers, impact effects and damage
 * routing to pedestrians, police officers and vehicles.
 */

import * as THREE from 'three';
import { clamp, dist2D } from '../core/math';
import { events } from '../core/events';
import { World } from '../world/world';
import { Player, WeaponDef } from '../entities/player';
import { VehicleSystem } from './vehicles';
import { PedestrianSystem } from './pedestrians';
import { PoliceSystem } from './police';

interface Tracer {
  line: THREE.Line;
  material: THREE.LineBasicMaterial;
  life: number;
  max: number;
}

interface Flash {
  light: THREE.PointLight;
  life: number;
}

type ShotResult = 'none' | 'hit' | 'kill';

const BLOOD_COUNT = 72;

const tmpDir = new THREE.Vector3();
const tmpOrigin = new THREE.Vector3();
const tmpEnd = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
const tmpAssist = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class CombatSystem {
  private scene: THREE.Scene;
  private world: World;
  private player: Player;
  private peds: PedestrianSystem;
  private police: PoliceSystem;
  private vehicles: VehicleSystem;
  private tracers: Tracer[] = [];
  private flashes: Flash[] = [];
  private lastCrimeShot = -99;
  private readonly bloodPositions: Float32Array;
  private readonly bloodVelocities: Float32Array;
  private readonly bloodLife: Float32Array;
  private readonly bloodGeometry: THREE.BufferGeometry;
  private readonly blood: THREE.Points;
  private bloodCursor = 0;

  constructor(
    scene: THREE.Scene,
    world: World,
    player: Player,
    peds: PedestrianSystem,
    police: PoliceSystem,
    vehicles: VehicleSystem,
  ) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.peds = peds;
    this.police = police;
    this.vehicles = vehicles;

    this.bloodPositions = new Float32Array(BLOOD_COUNT * 3);
    for (let i = 0; i < BLOOD_COUNT; i++) this.bloodPositions[i * 3 + 1] = -500;
    this.bloodVelocities = new Float32Array(BLOOD_COUNT * 3);
    this.bloodLife = new Float32Array(BLOOD_COUNT);
    this.bloodGeometry = new THREE.BufferGeometry();
    this.bloodGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.bloodPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.blood = new THREE.Points(
      this.bloodGeometry,
      new THREE.PointsMaterial({
        color: 0x8f1a12,
        size: 0.085,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    );
    this.blood.frustumCulled = false;
    scene.add(this.blood);
  }

  /** Called every frame while the trigger is held. Returns true if a shot fired. */
  tryPlayerShoot(now: number, camera: THREE.PerspectiveCamera, assist = false): boolean {
    if (this.player.inVehicle || this.player.dead) return false;
    const def = this.player.tryShoot(now);
    if (!def) return false;

    camera.getWorldDirection(tmpDir).normalize();
    const origin = this.player.muzzlePosition(tmpOrigin);
    if (assist) this.applyAimAssist(origin, tmpDir);
    const spread = def.spread;

    let result: ShotResult = 'none';
    for (let i = 0; i < def.pellets; i++) {
      const dir = tmpDir.clone();
      if (spread > 0) {
        tmpRight.crossVectors(dir, UP);
        if (tmpRight.lengthSq() < 0.0001) tmpRight.set(1, 0, 0);
        tmpRight.normalize();
        tmpUp.crossVectors(tmpRight, dir).normalize();
        const a = (Math.random() - 0.5) * 2 * spread;
        const b = (Math.random() - 0.5) * 2 * spread;
        dir.addScaledVector(tmpRight, a).addScaledVector(tmpUp, b).normalize();
      }
      const shot = this.trace(origin, dir, def.range, def.damage, true);
      if (shot === 'kill') result = 'kill';
      else if (shot === 'hit' && result === 'none') result = 'hit';
    }

    this.spawnFlash(origin, 0xffd9a0, 7, 0.055);
    events.emit('audio:gunshot', { x: origin.x, z: origin.z, kind: def.id });
    events.emit('player:shoot', {
      weapon: def.id,
      position: [origin.x, origin.y, origin.z],
      direction: [tmpDir.x, tmpDir.y, tmpDir.z],
    });
    if (result !== 'none') {
      events.emit('combat:hit', {
        x: origin.x,
        z: origin.z,
        killed: result === 'kill',
      });
    }

    const nearPeople = this.peds.peds.some(
      (p) => p.state !== 'dead' && dist2D(p.x, p.z, origin.x, origin.z) < 55,
    );
    if (nearPeople || this.world.cityAt(origin.x, origin.z)) {
      this.peds.panicAt(origin.x, origin.z, 55);
      if (now - this.lastCrimeShot > 4) {
        this.lastCrimeShot = now;
        events.emit('crime', {
          type: 'sparatoria',
          severity: 1,
          x: origin.x,
          z: origin.z,
          witnessed: true,
        });
      }
    }
    return true;
  }

  /**
   * Touch aim assist: snap the shot inside a narrow 8° cone to the closest
   * person to the crosshair, with a line-of-sight check. Keyboard and mouse
   * keep pure camera aim.
   */
  private applyAimAssist(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const maxDist = 38;
    const minDot = Math.cos((8 * Math.PI) / 180);
    let bestDot = minDot;
    let found = false;

    const consider = (x: number, y: number, z: number): void => {
      const dx = x - origin.x;
      const dy = y + 0.95 - origin.y;
      const dz = z - origin.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 2.5 || dist > maxDist) return;
      const nx = dx / dist;
      const ny = dy / dist;
      const nz = dz / dist;
      const dot = nx * dir.x + ny * dir.y + nz * dir.z;
      if (dot <= bestDot) return;
      tmpAssist.set(nx, ny, nz);
      const wall = this.world.collision.raycast3D(origin, tmpAssist, dist, (wx, wz) =>
        this.world.groundHeight(wx, wz),
      );
      if (wall && wall.distance < dist - 0.8) return;
      bestDot = dot;
      tmpTarget.copy(tmpAssist);
      found = true;
    };

    for (const ped of this.peds.peds) {
      if (ped.state !== 'dead') consider(ped.x, ped.y, ped.z);
    }
    for (const cop of this.police.all) {
      if (cop.state !== 'dead') consider(cop.x, cop.y, cop.z);
    }
    if (found) dir.lerp(tmpTarget, 0.6).normalize();
  }

  private trace(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    range: number,
    damage: number,
    byPlayer: boolean,
  ): ShotResult {
    const wall = this.world.collision.raycast3D(origin, dir, range, (x, z) =>
      this.world.groundHeight(x, z),
    );
    let limit = wall ? wall.distance : range;

    const pedHit = this.peds.raycast(origin, dir, limit);
    if (pedHit && pedHit.distance < limit) limit = pedHit.distance;

    const copHit = this.police.raycast(origin, dir, limit);
    if (copHit && copHit.distance < limit) limit = copHit.distance;

    let carHit: { vehicle: THREE.Object3D; distance: number } | null = null;
    for (const v of this.vehicles.vehicles) {
      if (v.destroyed) continue;
      const forwardX = Math.sin(v.yaw);
      const forwardZ = Math.cos(v.yaw);
      const half = v.def.length * 0.32;
      for (const offset of [-half, 0, half]) {
        const cx = v.position.x + forwardX * offset;
        const cy = v.position.y + 0.75;
        const cz = v.position.z + forwardZ * offset;
        const t = raySphere(origin, dir, cx, cy, cz, Math.max(0.85, v.def.width * 0.5));
        if (t !== null && t < limit) {
          limit = t;
          carHit = { vehicle: v.mesh, distance: t };
        }
      }
    }

    const end = tmpEnd.copy(origin).addScaledVector(dir, Math.max(0.5, limit));
    this.spawnTracer(origin, end, !byPlayer);

    if (pedHit && Math.abs(pedHit.distance - limit) < 0.001) {
      this.peds.damagePed(pedHit.ped, damage, origin.x, origin.z, byPlayer);
      const killed = pedHit.ped.state === 'dead';
      this.spawnBlood(pedHit.x, pedHit.y, pedHit.z, killed ? 14 : 7);
      return killed ? 'kill' : 'hit';
    }
    if (copHit && Math.abs(copHit.distance - limit) < 0.001) {
      this.police.damageCop(copHit.cop, damage, origin.x, origin.z);
      const killed = copHit.cop.state === 'dead';
      this.spawnBlood(copHit.x, copHit.y, copHit.z, killed ? 14 : 7);
      return killed ? 'kill' : 'hit';
    }
    if (carHit) {
      const v = this.vehicles.vehicles.find((car) => car.mesh === carHit?.vehicle);
      if (v) v.damage(damage * 3.2, 'gunfire');
      return 'hit';
    }
    if (wall) {
      this.spawnFlash(
        new THREE.Vector3(wall.x, wall.y, wall.z),
        0xffb060,
        2.2,
        0.05,
      );
    }
    return 'none';
  }

  private spawnBlood(x: number, y: number, z: number, count: number): void {
    for (let n = 0; n < count; n++) {
      const index = this.bloodCursor;
      this.bloodCursor = (this.bloodCursor + 1) % BLOOD_COUNT;
      const k = index * 3;
      this.bloodPositions[k] = x;
      this.bloodPositions[k + 1] = y;
      this.bloodPositions[k + 2] = z;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.6 + Math.random() * 1.9;
      this.bloodVelocities[k] = Math.cos(angle) * speed;
      this.bloodVelocities[k + 1] = 0.8 + Math.random() * 1.7;
      this.bloodVelocities[k + 2] = Math.sin(angle) * speed;
      this.bloodLife[index] = 0.35 + Math.random() * 0.25;
    }
    (this.bloodGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  spawnTracer(from: THREE.Vector3, to: THREE.Vector3, hostile: boolean): void {
    if (this.tracers.length > 26) {
      const old = this.tracers.shift();
      if (old) this.disposeTracer(old);
    }
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const material = new THREE.LineBasicMaterial({
      color: hostile ? 0xff6a4a : 0xffe2a0,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const line = new THREE.Line(geo, material);
    line.frustumCulled = false;
    line.renderOrder = 4;
    this.scene.add(line);
    this.tracers.push({ line, material, life: hostile ? 0.11 : 0.07, max: hostile ? 0.11 : 0.07 });
  }

  private spawnFlash(pos: THREE.Vector3, color: number, intensity: number, life: number): void {
    if (this.flashes.length > 8) {
      const old = this.flashes.shift();
      if (old) {
        this.scene.remove(old.light);
        old.light.dispose();
      }
    }
    const light = new THREE.PointLight(color, intensity, 14, 2);
    light.position.copy(pos);
    this.scene.add(light);
    this.flashes.push({ light, life });
  }

  update(dt: number): void {
    let bloodDirty = false;
    for (let i = 0; i < BLOOD_COUNT; i++) {
      if (this.bloodLife[i] <= 0) continue;
      this.bloodLife[i] -= dt;
      const k = i * 3;
      if (this.bloodLife[i] <= 0) {
        this.bloodPositions[k + 1] = -500;
        bloodDirty = true;
        continue;
      }
      this.bloodVelocities[k + 1] -= 9.5 * dt;
      this.bloodPositions[k] += this.bloodVelocities[k] * dt;
      this.bloodPositions[k + 1] += this.bloodVelocities[k + 1] * dt;
      this.bloodPositions[k + 2] += this.bloodVelocities[k + 2] * dt;
      bloodDirty = true;
    }
    if (bloodDirty) {
      (this.bloodGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.material.opacity = clamp(t.life / t.max, 0, 1) * 0.9;
      if (t.life <= 0) {
        this.disposeTracer(t);
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      f.light.intensity *= Math.max(0, 1 - dt * 30);
      if (f.life <= 0) {
        this.scene.remove(f.light);
        f.light.dispose();
        this.flashes.splice(i, 1);
      }
    }
  }

  private disposeTracer(t: Tracer): void {
    this.scene.remove(t.line);
    t.line.geometry.dispose();
    t.material.dispose();
  }

  dispose(): void {
    this.scene.remove(this.blood);
    this.bloodGeometry.dispose();
    (this.blood.material as THREE.Material).dispose();
    for (const t of this.tracers) this.disposeTracer(t);
    this.tracers = [];
    for (const f of this.flashes) {
      this.scene.remove(f.light);
      f.light.dispose();
    }
    this.flashes = [];
  }
}

function raySphere(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
): number | null {
  const ox = origin.x - cx;
  const oy = origin.y - cy;
  const oz = origin.z - cz;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sqrt = Math.sqrt(disc);
  const t0 = -b - sqrt;
  const t1 = -b + sqrt;
  if (t0 > 0) return t0;
  if (t1 > 0) return t1;
  return null;
}

export type { WeaponDef };
