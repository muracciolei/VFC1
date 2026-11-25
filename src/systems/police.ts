/**
 * Wanted level, police response, foot officers and police cruisers.
 * The system reacts to `crime` events emitted by the rest of the game.
 */

import * as THREE from 'three';
import { clamp, dist2D, randomRange, wrapAngle } from '../core/math';
import { events } from '../core/events';
import { World } from '../world/world';
import { Player } from '../entities/player';
import { CharacterModel, COP_LOOK } from '../entities/character';
import { Vehicle, DriveControls } from '../entities/vehicle';
import { VehicleSystem } from './vehicles';
import type { CombatSystem } from './combat';

export type CopState = 'chase' | 'shoot' | 'dead';

export interface Cop {
  id: number;
  x: number;
  z: number;
  y: number;
  yaw: number;
  health: number;
  state: CopState;
  model: CharacterModel;
  fireTimer: number;
  deadTime: number;
  moveSpeed: number;
}

const MAX_COPS = 6;
const RADIO_LINES = [
  'Centrale, unità in avvicinamento.',
  'Soggetto segnalato in zona. Massima attenzione.',
  'Richiesta supporto, abbiamo il bersaglio.',
  'Tutte le unità, chiudete le vie di fuga.',
  'Centrale, inseguimento in corso.',
  'Il soggetto è armato. Procedete con cautela.',
];

let nextCopId = 1;
const tmpOrigin = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();

export class PoliceSystem {
  level = 0;
  heat = 0;
  private scene: THREE.Scene;
  private world: World;
  private player: Player;
  private vehicles: VehicleSystem;
  private cops: Cop[] = [];
  private spawnTimer = 0;
  private carTimer = 0;
  private searchTimer = 0;
  private timeSinceCrime = 99;
  private escapeMode = false;
  private radioCooldown = 0;
  private lastLevel = 0;

  constructor(scene: THREE.Scene, world: World, player: Player, vehicles: VehicleSystem) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.vehicles = vehicles;
    events.on('crime', ({ severity, witnessed }) => {
      if (!witnessed && severity < 3) return;
      this.addCrime(severity);
    });
  }

  /* -------------------------------------------------------------- */
  /* Wanted level                                                    */
  /* -------------------------------------------------------------- */

  addCrime(severity: number): void {
    if (this.player.dead) return;
    this.heat = clamp(this.heat + severity * 0.85, 0, 5);
    this.timeSinceCrime = 0;
    this.searchTimer = 0;
    this.setLevel(Math.ceil(this.heat));
  }

  forceLevel(level: number): void {
    this.heat = clamp(level, 0, 5);
    this.timeSinceCrime = 0;
    this.searchTimer = 0;
    this.setLevel(level);
  }

  setEscapeMode(enabled: boolean): void {
    this.escapeMode = enabled;
  }

  clearWanted(): void {
    this.heat = 0;
    this.setLevel(0);
    this.searchTimer = 0;
    this.escapeMode = false;
  }

  private setLevel(level: number): void {
    const next = clamp(Math.round(level), 0, 5);
    if (next === this.level) return;
    this.level = next;
    const radius = next === 0 ? 0 : 40 + next * 28;
    events.emit('wanted:changed', { level: next, searchRadius: radius });
    if (next > 0 && next !== this.lastLevel && this.radioCooldown <= 0) {
      this.radioCooldown = 8;
      events.emit('police:radio', { text: RADIO_LINES[Math.min(RADIO_LINES.length - 1, next - 1)] });
    }
    if (next === 0) {
      events.emit('wanted:escape', {});
    }
    this.lastLevel = next;
  }

  /* -------------------------------------------------------------- */
  /* Spawning                                                        */
  /* -------------------------------------------------------------- */

  private spawnCop(x: number, z: number): Cop | null {
    if (this.cops.length >= MAX_COPS) return null;
    if (this.world.isWater(x, z)) return null;
    const ground = this.world.groundHeight(x, z);
    const res = this.world.collision.resolveCircle(x, z, 0.4, ground + 0.2, ground + 1.8);
    if (res.hit) return null;
    const model = new CharacterModel(COP_LOOK);
    model.setWeapon('pistol');
    this.scene.add(model.group);
    const cop: Cop = {
      id: nextCopId++,
      x,
      z,
      y: ground,
      yaw: 0,
      health: 110,
      state: 'chase',
      model,
      fireTimer: randomRange(0.8, 1.8),
      deadTime: 0,
      moveSpeed: randomRange(3.7, 4.5),
    };
    this.cops.push(cop);
    return cop;
  }

  private spawnCopNearPlayer(): void {
    const link = this.world.roads.randomLinkNear(
      this.player.position.x,
      this.player.position.z,
      45,
      110,
    );
    if (!link) return;
    const seg = this.world.roads.segments[link.seg];
    if (!seg || seg.bridge) return;
    const pts = this.world.roads.getLinkPoints(link);
    if (pts.length < 2) return;
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
    const off = seg.width * 0.5 + 1.6;
    const cop = this.spawnCop(x + dz * off * side, z - dx * off * side);
    if (cop) {
      cop.yaw = Math.atan2(this.player.position.x - cop.x, this.player.position.z - cop.z);
    }
  }

  /* -------------------------------------------------------------- */
  /* Frame update                                                    */
  /* -------------------------------------------------------------- */

  update(dt: number, combat: CombatSystem): void {
    this.radioCooldown = Math.max(0, this.radioCooldown - dt);
    this.timeSinceCrime += dt;

    if (this.level > 0) {
      this.searchTimer = this.copsSeePlayer() ? 0 : this.searchTimer + dt;
      const decay = this.escapeMode ? 5 : 13;
      if (this.searchTimer > decay) {
        this.searchTimer = 0;
        this.heat = Math.max(0, this.heat - 1);
        this.setLevel(Math.floor(this.heat + 0.001));
        if (this.level === 0) this.escapeMode = false;
      }
    }

    // spawn foot officers
    const wantedCops = this.level === 0 ? 0 : Math.min(MAX_COPS, 1 + this.level);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 2.4;
      if (this.cops.filter((c) => c.state !== 'dead').length < wantedCops) {
        this.spawnCopNearPlayer();
      }
    }

    // police cruisers
    this.carTimer -= dt;
    if (this.carTimer <= 0) {
      this.carTimer = 3.5;
      const wantedCars = this.level >= 2 ? Math.min(3, this.level - 1) : 0;
      const activeCars = this.vehicles.police.filter((v) => v.driver === 'police' && !v.destroyed).length;
      if (activeCars < wantedCars) {
        this.vehicles.spawnPoliceCar(this.player.position.x, this.player.position.z);
      }
    }

    this.updateCars(dt);
    this.updateCops(dt, combat);

    // drop units when the player is clean
    if (this.level === 0) {
      for (let i = this.cops.length - 1; i >= 0; i--) {
        const cop = this.cops[i];
        const far = dist2D(cop.x, cop.z, this.player.position.x, this.player.position.z) > 60;
        if (cop.state === 'dead' && cop.deadTime > 12) {
          this.removeCop(cop);
        } else if (far && cop.state !== 'dead') {
          this.removeCop(cop);
        }
      }
    }
  }

  private updateCars(dt: number): void {
    for (const v of this.vehicles.police) {
      if (v.destroyed || v.driver !== 'police') continue;
      const dx = this.player.position.x - v.position.x;
      const dz = this.player.position.z - v.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 17 && v.speed < 4.5) {
        // deploy an officer and leave the car
        const rx = Math.cos(v.yaw);
        const rz = -Math.sin(v.yaw);
        const cop = this.spawnCop(
          v.position.x - rx * (v.def.width * 0.5 + 0.9),
          v.position.z - rz * (v.def.width * 0.5 + 0.9),
        );
        if (cop) {
          cop.yaw = Math.atan2(dx, dz);
          v.driver = null;
          v.parked = true;
          v.velX = 0;
          v.velZ = 0;
          continue;
        }
      }

      const targetYaw = Math.atan2(dx, dz);
      const delta = wrapAngle(targetYaw - v.yaw);
      const controls: DriveControls = {
        throttle: dist > 24 ? 1 : dist > 13 ? 0.55 : 0.1,
        brake: dist < 11 ? 0.8 : 0,
        steer: clamp(delta * 1.5, -1, 1),
        handbrake: false,
      };
      v.update(dt, controls, this.world);

      // ramming damage
      const pv = this.vehicles.playerVehicle;
      if (pv && pv !== v && !pv.destroyed) {
        const d = dist2D(v.position.x, v.position.z, pv.position.x, pv.position.z);
        if (d < 3.4 && v.speed > 5) {
          pv.damage(v.speed * 3.5, 'police_ram');
          this.player.applyDamage(4 + this.level * 1.5, 'speronamento');
          events.emit('audio:crash', { x: pv.position.x, z: pv.position.z, impact: v.speed });
        }
      }
    }
  }

  private updateCops(dt: number, combat: CombatSystem): void {
    const px = this.player.position.x;
    const pz = this.player.position.z;
    for (let i = this.cops.length - 1; i >= 0; i--) {
      const cop = this.cops[i];
      const dist = dist2D(cop.x, cop.z, px, pz);

      if (cop.state === 'dead') {
        cop.deadTime += dt;
        cop.model.group.position.set(cop.x, cop.y, cop.z);
        cop.model.group.rotation.y = cop.yaw;
        cop.model.update(dt, 0, false, false, true);
        if (cop.deadTime > 22 || dist > 260) this.removeCop(cop);
        continue;
      }
      if (dist > 280) {
        this.removeCop(cop);
        continue;
      }

      const visible = dist < 60 && this.hasLineOfSight(cop.x, cop.y + 1.45, cop.z, px, this.player.position.y + 1.3, pz);
      const targetYaw = Math.atan2(px - cop.x, pz - cop.z);
      let moving = false;

      if (dist > 13 || !visible) {
        const speed = cop.moveSpeed;
        const nx = cop.x + Math.sin(targetYaw) * speed * dt;
        const nz = cop.z + Math.cos(targetYaw) * speed * dt;
        const ground = this.world.groundHeight(nx, nz);
        const res = this.world.collision.resolveCircle(nx, nz, 0.34, ground + 0.2, ground + 1.8);
        if (!res.hit && !this.world.isWater(nx, nz)) {
          cop.x = nx;
          cop.z = nz;
          cop.y = ground;
          moving = true;
        }
      }
      cop.yaw = cop.yaw + wrapAngle(targetYaw - cop.yaw) * Math.min(1, 10 * dt);
      cop.model.group.position.set(cop.x, cop.y, cop.z);
      cop.model.group.rotation.y = cop.yaw;
      cop.model.update(dt, moving ? cop.moveSpeed : 0, visible, false, false);

      if (visible) {
        cop.state = 'shoot';
        cop.fireTimer -= dt;
        if (cop.fireTimer <= 0) {
          cop.fireTimer = randomRange(0.9, 2.0) * (1 - this.level * 0.05);
          this.copShoot(cop, combat, dist);
        }
      } else {
        cop.state = 'chase';
      }
    }
  }

  private copShoot(cop: Cop, combat: CombatSystem, dist: number): void {
    const origin = tmpOrigin.set(cop.x, cop.y + 1.4, cop.z);
    const target = tmpTarget.set(
      this.player.position.x,
      this.player.position.y + (this.vehicles.playerVehicle ? 0.8 : 1.15),
      this.player.position.z,
    );
    const dir = tmpDir.copy(target).sub(origin).normalize();
    const accuracy = clamp(0.42 + this.level * 0.07 - dist * 0.004, 0.2, 0.8);
    const hit = Math.random() < accuracy;
    const end = target.clone();
    if (!hit) {
      end.x += randomRange(-1.6, 1.6);
      end.y += randomRange(-0.8, 1.2);
      end.z += randomRange(-1.6, 1.6);
      const len = origin.distanceTo(end);
      dir.copy(end).sub(origin).normalize();
      const wall = this.world.collision.raycast3D(origin, dir, len, (x, z) => this.world.groundHeight(x, z));
      if (wall) end.copy(origin).addScaledVector(dir, wall.distance);
    }
    combat.spawnTracer(origin, end, true);
    events.emit('audio:gunshot', { x: cop.x, z: cop.z, kind: 'pistol' });
    if (hit) {
      const pv = this.vehicles.playerVehicle;
      if (pv && dist < 30) {
        pv.damage(9 + this.level * 2, 'police_fire');
        if (Math.random() < 0.35) this.player.applyDamage(5 + this.level, 'polizia');
      } else {
        this.player.applyDamage(6 + this.level * 1.6, 'polizia');
      }
      events.emit('ui:toast', { title: 'POLIZIA', text: 'Sei sotto tiro!', kind: 'bad' });
    }
  }

  private hasLineOfSight(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
  ): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.5) return true;
    const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
    const origin = new THREE.Vector3(x0, y0, z0);
    const hit = this.world.collision.raycast3D(origin, dir, len - 0.4, (x, z) =>
      this.world.groundHeight(x, z),
    );
    return !hit;
  }

  private copsSeePlayer(): boolean {
    for (const cop of this.cops) {
      if (cop.state === 'dead') continue;
      if (
        dist2D(cop.x, cop.z, this.player.position.x, this.player.position.z) < 55 &&
        this.hasLineOfSight(
          cop.x,
          cop.y + 1.45,
          cop.z,
          this.player.position.x,
          this.player.position.y + 1.2,
          this.player.position.z,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  private removeCop(cop: Cop): void {
    const idx = this.cops.indexOf(cop);
    if (idx >= 0) this.cops.splice(idx, 1);
    this.scene.remove(cop.model.group);
    cop.model.dispose();
  }

  /* -------------------------------------------------------------- */
  /* Combat interface                                                */
  /* -------------------------------------------------------------- */

  damageCop(cop: Cop, amount: number, fromX: number, fromZ: number): void {
    if (cop.state === 'dead') return;
    cop.health -= amount;
    if (cop.health <= 0) {
      cop.state = 'dead';
      cop.deadTime = 0;
      cop.model.group.rotation.z = 0;
      events.emit('npc:shot', { x: cop.x, z: cop.z, killed: true });
      this.addCrime(1.4);
      events.emit('ui:toast', { title: 'POLIZIA', text: 'Agente abbattuto. La risposta sarà dura.', kind: 'bad' });
    } else {
      cop.state = 'chase';
      cop.yaw = Math.atan2(cop.x - fromX, cop.z - fromZ);
    }
  }

  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
  ): { cop: Cop; distance: number; x: number; y: number; z: number } | null {
    let best: { cop: Cop; distance: number; x: number; y: number; z: number } | null = null;
    for (const cop of this.cops) {
      if (cop.state === 'dead') continue;
      const cx = cop.x;
      const cy = cop.y + 0.95;
      const cz = cop.z;
      const ox = origin.x - cx;
      const oy = origin.y - cy;
      const oz = origin.z - cz;
      const t = -(ox * dir.x + oy * dir.y + oz * dir.z);
      if (t < 0 || t > maxDist) continue;
      const px = ox + dir.x * t;
      const py = oy + dir.y * t;
      const pz = oz + dir.z * t;
      if (px * px + py * py + pz * pz < 0.4 * 0.4) {
        if (!best || t < best.distance) {
          best = { cop, distance: t, x: cx, y: cy, z: cz };
        }
      }
    }
    return best;
  }

  /* -------------------------------------------------------------- */
  /* Queries / cleanup                                               */
  /* -------------------------------------------------------------- */

  get all(): readonly Cop[] {
    return this.cops;
  }

  get aliveCount(): number {
    return this.cops.filter((c) => c.state !== 'dead').length;
  }

  nearestCopDistance(x: number, z: number): number {
    let best = Infinity;
    for (const cop of this.cops) {
      if (cop.state === 'dead') continue;
      best = Math.min(best, dist2D(cop.x, cop.z, x, z));
    }
    return best;
  }

  clearAll(): void {
    for (const cop of [...this.cops]) this.removeCop(cop);
    for (const v of [...this.vehicles.police]) {
      if (v.driver === 'police') {
        v.driver = null;
        v.parked = true;
      }
    }
    this.clearWanted();
  }

  /** For HUD: 0..5 stars. */
  get stars(): number {
    return this.level;
  }

  dispose(): void {
    this.clearAll();
  }
}

export type { Vehicle };
