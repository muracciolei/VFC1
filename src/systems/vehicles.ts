/** Vehicle population: parked cars, traffic, police units, enter/exit and explosions. */

import * as THREE from 'three';
import { clamp, clamp01, damp, dist2D, wrapAngle } from '../core/math';
import { events } from '../core/events';
import { World } from '../world/world';
import { RoadLink, RoadSegment } from '../world/roadnetwork';
import { Player } from '../entities/player';
import {
  createVehicle,
  DriveControls,
  Vehicle,
  VehicleTypeId,
} from '../entities/vehicle';
import { DrivingEffects } from '../effects/drivefx';

const TRAFFIC_TARGET = 12;
const PARKED_TARGET = 8;

interface Explosion {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  t: number;
  max: number;
}

const TRAFFIC_TYPES: VehicleTypeId[] = ['panda', 'berlina', 'berlina', 'taxi', 'furgone', 'vespa'];

export class VehicleSystem {
  readonly vehicles: Vehicle[] = [];
  readonly traffic: Vehicle[] = [];
  readonly parked: Vehicle[] = [];
  readonly police: Vehicle[] = [];
  playerVehicle: Vehicle | null = null;
  private scene: THREE.Scene;
  private world: World;
  private player: Player;
  private readonly effects: DrivingEffects;
  private trafficTimer = 0;
  private parkedTimer = 0;
  private explosions: Explosion[] = [];
  private offDestroyed: () => void;
  private blockedTime = new Map<number, number>();

  constructor(scene: THREE.Scene, world: World, player: Player) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.effects = new DrivingEffects(scene, world);
    this.offDestroyed = events.on('vehicle:destroyed', ({ vehicleId, x, z }) => {
      this.handleDestroyed(vehicleId, x, z);
    });
  }

  /* -------------------------------------------------------------- */
  /* Spawning                                                        */
  /* -------------------------------------------------------------- */

  spawnInitial(): void {
    this.spawnParkedNear(this.player.position.x, this.player.position.z, PARKED_TARGET);
    this.spawnTrafficNear(this.player.position.x, this.player.position.z, TRAFFIC_TARGET);
  }

  private addVehicle(v: Vehicle): void {
    this.vehicles.push(v);
    this.scene.add(v.mesh);
  }

  spawnParkedNear(x: number, z: number, count: number): void {
    let attempts = 0;
    let spawned = 0;
    while (spawned < count && attempts < count * 8) {
      attempts++;
      const link = this.world.roads.randomLinkNear(x, z, 30, 260);
      if (!link) break;
      const seg = this.world.roads.segments[link.seg];
      if (seg.roadClass === 'highway' || seg.bridge) continue;
      const t = 0.15 + Math.random() * 0.7;
      const p = this.pointOnLink(link, t * seg.length);
      if (!p) continue;
      const right = { x: p.dx, z: -p.dz };
      const off = seg.width * 0.4;
      const px = p.x + right.x * off;
      const pz = p.z + right.z * off;
      if (this.world.isWater(px, pz)) continue;
      if (this.tooClose(px, pz, 4.5)) continue;
      const type = TRAFFIC_TYPES[Math.floor(Math.random() * TRAFFIC_TYPES.length)];
      const v = createVehicle(type);
      v.place(px, pz, Math.atan2(p.dx, p.dz), this.world);
      v.parked = true;
      this.addVehicle(v);
      this.parked.push(v);
      spawned++;
    }
  }

  spawnTrafficNear(x: number, z: number, count: number): void {
    let attempts = 0;
    let spawned = 0;
    while (spawned < count && attempts < count * 10) {
      attempts++;
      const link = this.world.roads.randomLinkNear(x, z, 90, 280);
      if (!link) break;
      const seg = this.world.roads.segments[link.seg];
      if (seg.bridge) continue;
      const t = Math.random() * seg.length;
      const p = this.pointOnLink(link, t);
      if (!p) continue;
      if (this.tooClose(p.x, p.z, 5)) continue;
      if (this.world.isWater(p.x, p.z)) continue;
      const type = TRAFFIC_TYPES[Math.floor(Math.random() * TRAFFIC_TYPES.length)];
      const v = createVehicle(type);
      const right = { x: p.dx, z: -p.dz };
      const off = seg.width * 0.23;
      v.place(p.x + right.x * off, p.z + right.z * off, Math.atan2(p.dx, p.dz), this.world);
      v.driver = 'npc';
      v.ai = {
        link: link.id,
        t,
        speed: seg.speedLimit * 0.55,
        lane: off,
        stuck: 0,
        honk: 0,
      };
      this.addVehicle(v);
      this.traffic.push(v);
      spawned++;
    }
  }

  spawnPoliceCar(x: number, z: number): Vehicle | null {
    const link = this.world.roads.randomLinkNear(x, z, 80, 220);
    if (!link) return null;
    const seg = this.world.roads.segments[link.seg];
    const p = this.pointOnLink(link, Math.random() * seg.length);
    if (!p) return null;
    if (this.tooClose(p.x, p.z, 6)) return null;
    const v = createVehicle('police', '#e8e6df');
    v.place(p.x, p.z, Math.atan2(p.dx, p.dz), this.world);
    v.driver = 'police';
    this.addVehicle(v);
    this.police.push(v);
    return v;
  }

  /** Spawn a parked vehicle at an exact position (missions, garage deliveries). */
  spawnAt(
    type: VehicleTypeId,
    x: number,
    z: number,
    yaw: number,
    color?: string,
    owned = false,
  ): Vehicle {
    const v = createVehicle(type, color);
    v.place(x, z, yaw, this.world);
    v.parked = true;
    v.owned = owned;
    this.addVehicle(v);
    this.parked.push(v);
    return v;
  }

  private tooClose(x: number, z: number, dist: number): boolean {
    for (const v of this.vehicles) {
      if (v.destroyed) continue;
      if (dist2D(x, z, v.position.x, v.position.z) < dist) return true;
    }
    return false;
  }

  /* -------------------------------------------------------------- */
  /* Link helpers                                                    */
  /* -------------------------------------------------------------- */

  private getLinkPoints(link: RoadLink): { points: { x: number; z: number }[]; ys: number[]; width: number; seg: RoadSegment } {
    const seg = this.world.roads.segments[link.seg];
    const points = link.forward ? seg.points : [...seg.points].reverse();
    const ys = link.forward ? seg.ys : [...seg.ys].reverse();
    return { points, ys, width: seg.width, seg };
  }

  private pointOnLink(link: RoadLink, distance: number): { x: number; z: number; y: number; dx: number; dz: number } | null {
    const { points, ys, width } = this.getLinkPoints(link);
    if (points.length < 2) return null;
    let remaining = Math.max(0, distance);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (remaining <= len || i === points.length - 2) {
        const t = len > 0 ? clamp01(remaining / len) : 0;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const y = (ys[i] ?? 0) + ((ys[i + 1] ?? 0) - (ys[i] ?? 0)) * t;
        const inv = len > 0 ? 1 / len : 0;
        return { x, z, y, dx: (b.x - a.x) * inv, dz: (b.z - a.z) * inv };
      }
      remaining -= len;
    }
    void width;
    return null;
  }

  /* -------------------------------------------------------------- */
  /* Traffic                                                         */
  /* -------------------------------------------------------------- */

  private updateTraffic(dt: number, playerPos: THREE.Vector3): void {
    const roads = this.world.roads;
    for (let i = this.traffic.length - 1; i >= 0; i--) {
      const v = this.traffic[i];
      if (v.destroyed) {
        this.removeVehicle(v);
        continue;
      }
      const distToPlayer = dist2D(v.position.x, v.position.z, playerPos.x, playerPos.z);
      if (distToPlayer > 360) {
        this.removeVehicle(v);
        continue;
      }
      if (!v.ai) {
        this.traffic.splice(i, 1);
        continue;
      }
      const link = roads.links[v.ai.link];
      if (!link) {
        this.traffic.splice(i, 1);
        continue;
      }
      const seg = roads.segments[link.seg];
      const targetSpeed = Math.min(seg.speedLimit * 0.62, 19);
      let desired = targetSpeed;

      // obstacle scan: player vehicle, other cars
      const fx = Math.sin(v.yaw);
      const fz = Math.cos(v.yaw);
      let blocked = false;
      for (const other of this.vehicles) {
        if (other === v || other.destroyed) continue;
        const dx = other.position.x - v.position.x;
        const dz = other.position.z - v.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 13 || d < 0.01) continue;
        const dot = (dx / d) * fx + (dz / d) * fz;
        if (dot > 0.55) {
          blocked = true;
          desired = Math.min(desired, Math.max(0, (d - 4.2) * 1.8));
        }
      }
      if (this.playerVehicle && this.playerVehicle !== v) {
        const dx = this.playerVehicle.position.x - v.position.x;
        const dz = this.playerVehicle.position.z - v.position.z;
        const d = Math.hypot(dx, dz);
        const dot = d > 0.01 ? (dx / d) * fx + (dz / d) * fz : 0;
        if (d < 14 && dot > 0.5) {
          blocked = true;
          desired = Math.min(desired, Math.max(0, (d - 4.6) * 2.0));
        }
      }

      if (blocked && v.ai.speed < 1.2) {
        const stuck = (this.blockedTime.get(v.id) ?? 0) + dt;
        this.blockedTime.set(v.id, stuck);
        if (stuck > 2.6) {
          v.ai.honk = 1.4;
          this.blockedTime.set(v.id, 0);
        }
      } else {
        this.blockedTime.set(v.id, 0);
      }

      v.ai.speed = damp(v.ai.speed, desired, blocked ? 3.2 : 1.6, dt);
      if (v.ai.speed < 0.05) v.ai.speed = 0;
      v.ai.t += v.ai.speed * dt;

      const total = seg.length;
      let overflow = 0;
      if (v.ai.t >= total) {
        overflow = v.ai.t - total;
        const node = roads.nodes[link.to];
        const next = roads.chooseNextLink(node, link);
        if (!next) {
          this.removeVehicle(v);
          continue;
        }
        v.ai.link = next.id;
        v.ai.t = overflow;
        const nextSeg = roads.segments[next.seg];
        v.ai.lane = nextSeg.width * 0.23;
      }

      const curLink = roads.links[v.ai.link];
      const p = this.pointOnLink(curLink, v.ai.t);
      if (!p) continue;
      const curSeg = roads.segments[curLink.seg];
      const lane = Math.min(v.ai.lane, curSeg.width * 0.3);
      const rightX = p.dz;
      const rightZ = -p.dx;
      const tx = p.x + rightX * lane;
      const tz = p.z + rightZ * lane;
      const ty = p.y + 0.14;

      // avoid driving through the player on foot
      if (!this.player.inVehicle) {
        const dpx = this.player.position.x - tx;
        const dpz = this.player.position.z - tz;
        const dp = Math.hypot(dpx, dpz);
        if (dp < 6 && v.ai.speed > 0.5) {
          v.ai.speed = 0;
          v.velX = 0;
          v.velZ = 0;
        }
      }

      const targetYaw = Math.atan2(p.dx, p.dz);
      const steer = clamp(wrapAngle(targetYaw - v.yaw) * 2.5, -1, 1);
      v.yaw = dampAngleSafe(v.yaw, targetYaw, 6, dt);
      v.position.x = damp(v.position.x, tx, 9, dt);
      v.position.z = damp(v.position.z, tz, 9, dt);
      v.position.y = damp(v.position.y, ty, 10, dt);
      v.velX = p.dx * v.ai.speed;
      v.velZ = p.dz * v.ai.speed;
      v.syncTransform();
      v.updateWheelVisuals(dt, v.ai.speed, steer);

      if (v.ai.honk > 0) {
        v.ai.honk -= dt;
        if (v.ai.honk <= 0) {
          events.emit('audio:honk', { x: v.position.x, z: v.position.z });
        }
      }
    }

    // spawn replacement traffic
    this.trafficTimer -= dt;
    if (this.trafficTimer <= 0) {
      this.trafficTimer = 1.4;
      if (this.traffic.length < TRAFFIC_TARGET) {
        this.spawnTrafficNear(playerPos.x, playerPos.z, 2);
      }
    }
  }

  private updateParked(dt: number, playerPos: THREE.Vector3): void {
    this.parkedTimer -= dt;
    if (this.parkedTimer > 0) return;
    this.parkedTimer = 2.5;
    for (let i = this.parked.length - 1; i >= 0; i--) {
      const v = this.parked[i];
      if (v.destroyed) {
        this.parked.splice(i, 1);
        continue;
      }
      if (dist2D(v.position.x, v.position.z, playerPos.x, playerPos.z) > 320) {
        this.removeVehicle(v);
        this.parked.splice(i, 1);
      }
    }
    if (this.parked.length < PARKED_TARGET) {
      this.spawnParkedNear(playerPos.x, playerPos.z, Math.min(3, PARKED_TARGET - this.parked.length));
    }
  }

  /* -------------------------------------------------------------- */
  /* Enter / exit                                                    */
  /* -------------------------------------------------------------- */

  nearestVehicle(x: number, z: number, maxDist = 4.5, includeTraffic = true): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = maxDist;
    for (const v of this.vehicles) {
      if (v.destroyed) continue;
      if (v === this.playerVehicle) continue;
      if (!includeTraffic && v.ai) continue;
      if (v.ai && v.ai.speed > 9) continue;
      const d = dist2D(x, z, v.position.x, v.position.z);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  tryEnterNearest(maxDist = 4.5): Vehicle | null {
    if (this.playerVehicle) return null;
    const v = this.nearestVehicle(this.player.position.x, this.player.position.z, maxDist);
    if (!v) return null;
    this.enter(v);
    return v;
  }

  enter(v: Vehicle): void {
    if (v.destroyed) return;
    if (v.driver !== 'player' && !v.owned) {
      // Taking a car that is not yours (abandoned or driven by someone else).
      events.emit('vehicle:stolen', { vehicleId: v.id, x: v.position.x, z: v.position.z });
    }
    if (v.driver === 'npc' || v.driver === 'police') {
      // carjack
      const wasPolice = v.driver === 'police';
      v.driver = 'player';
      v.ai = null;
      const idx = this.traffic.indexOf(v);
      if (idx >= 0) this.traffic.splice(idx, 1);
      const pidx = this.parked.indexOf(v);
      if (pidx >= 0) this.parked.splice(pidx, 1);
      events.emit('crime', {
        type: wasPolice ? 'police_carjack' : 'carjack',
        severity: wasPolice ? 3 : 1,
        x: v.position.x,
        z: v.position.z,
        witnessed: true,
      });
    }
    v.driver = 'player';
    v.parked = false;
    v.ai = null;
    const idx = this.traffic.indexOf(v);
    if (idx >= 0) this.traffic.splice(idx, 1);
    const pidx = this.parked.indexOf(v);
    if (pidx >= 0) this.parked.splice(pidx, 1);
    this.playerVehicle = v;
    this.player.inVehicle = true;
    this.player.model.setVisible(false);
    this.player.velocity.set(0, 0, 0);
    events.emit('player:enterVehicle', { vehicleId: v.id });
  }

  exitPlayer(): boolean {
    const v = this.playerVehicle;
    if (!v) return false;
    const fwdX = Math.sin(v.yaw);
    const fwdZ = Math.cos(v.yaw);
    const rightX = Math.cos(v.yaw);
    const rightZ = -Math.sin(v.yaw);
    const candidates: Array<{ x: number; z: number }> = [
      { x: v.position.x - rightX * (v.def.width * 0.5 + 0.7), z: v.position.z - rightZ * (v.def.width * 0.5 + 0.7) },
      { x: v.position.x + rightX * (v.def.width * 0.5 + 0.7), z: v.position.z + rightZ * (v.def.width * 0.5 + 0.7) },
      { x: v.position.x - fwdX * (v.def.length * 0.5 + 1.0), z: v.position.z - fwdZ * (v.def.length * 0.5 + 1.0) },
    ];
    let chosen: { x: number; z: number } | null = null;
    for (const c of candidates) {
      if (this.world.isWater(c.x, c.z)) continue;
      const res = this.world.collision.resolveCircle(c.x, c.z, 0.4, v.position.y + 0.2, v.position.y + 1.8);
      if (!res.hit) {
        chosen = c;
        break;
      }
    }
    if (!chosen) chosen = candidates[2];
    const ground = this.world.groundHeight(chosen.x, chosen.z);
    this.player.position.set(chosen.x, ground + 0.05, chosen.z);
    this.player.velocity.set(0, 0, 0);
    this.player.inVehicle = false;
    this.player.model.setVisible(true);
    this.player.yaw = v.yaw;
    v.driver = null;
    v.velX = 0;
    v.velZ = 0;
    this.parked.push(v);
    this.playerVehicle = null;
    events.emit('player:exitVehicle', { vehicleId: v.id });
    return true;
  }

  /* -------------------------------------------------------------- */
  /* Damage / explosions                                             */
  /* -------------------------------------------------------------- */

  private handleDestroyed(vehicleId: number, x: number, z: number): void {
    const v = this.vehicles.find((car) => car.id === vehicleId);
    if (!v) return;
    if (v === this.playerVehicle) {
      this.player.inVehicle = false;
      this.player.model.setVisible(true);
      this.player.position.set(v.position.x, this.world.groundHeight(x, z) + 0.1, v.position.z);
      this.player.applyDamage(70, 'esplosione');
      this.playerVehicle = null;
    }
    this.explode(x, this.world.groundHeight(x, z) + 0.8, z);
    events.emit('audio:explosion', { x, z });
    this.removeVehicle(v);
  }

  private explode(x: number, y: number, z: number): void {
    const geo = new THREE.SphereGeometry(1, 10, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: '#ff9a3c',
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(0.8);
    this.scene.add(mesh);
    const light = new THREE.PointLight('#ff8a3c', 60, 60, 2);
    light.position.set(x, y + 1, z);
    this.scene.add(light);
    this.explosions.push({ mesh, light, t: 0, max: 0.9 });
    if (this.explosions.length > 4) {
      const old = this.explosions.shift();
      if (old) this.removeExplosion(old);
    }
  }

  private removeExplosion(e: Explosion): void {
    this.scene.remove(e.mesh);
    this.scene.remove(e.light);
    e.mesh.geometry.dispose();
    (e.mesh.material as THREE.Material).dispose();
  }

  private updateExplosions(dt: number): void {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.t += dt;
      const k = e.t / e.max;
      e.mesh.scale.setScalar(0.8 + k * 9);
      (e.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - k));
      e.light.intensity = Math.max(0, 60 * (1 - k * 1.4));
      if (e.t >= e.max) {
        this.removeExplosion(e);
        this.explosions.splice(i, 1);
      }
    }
  }

  removeVehicle(v: Vehicle): void {
    const lists = [this.vehicles, this.traffic, this.parked, this.police];
    for (const list of lists) {
      const idx = list.indexOf(v);
      if (idx >= 0) list.splice(idx, 1);
    }
    this.scene.remove(v.mesh);
    v.dispose();
    this.blockedTime.delete(v.id);
    if (v === this.playerVehicle) {
      this.playerVehicle = null;
      this.player.inVehicle = false;
      this.player.model.setVisible(true);
    }
  }

  /* -------------------------------------------------------------- */
  /* Frame update                                                    */
  /* -------------------------------------------------------------- */

  update(dt: number, playerPos: THREE.Vector3): void {
    this.updateTraffic(dt, playerPos);
    this.updateParked(dt, playerPos);
    this.updateExplosions(dt);
    this.effects.update(dt, this.playerVehicle);

    // Lights off at 70 m, wheels at 120 m: distant cars drop to one draw.
    for (const v of this.vehicles) {
      if (v.destroyed) continue;
      const d =
        v === this.playerVehicle
          ? 0
          : dist2D(playerPos.x, playerPos.z, v.position.x, v.position.z);
      v.setLod(d > 120 ? 2 : d > 70 ? 1 : 0);
    }

    // police units are driven by PoliceSystem but cleaned up here
    for (let i = this.police.length - 1; i >= 0; i--) {
      const v = this.police[i];
      if (v.destroyed) {
        this.police.splice(i, 1);
        continue;
      }
      if (v.driver !== 'police' && v !== this.playerVehicle) {
        this.police.splice(i, 1);
      }
    }
  }

  /** Remove every spawned vehicle (new game / respawn cleanup). */
  resetPopulation(): void {
    this.effects.clear();
    if (this.playerVehicle) {
      this.playerVehicle = null;
      this.player.inVehicle = false;
      this.player.model.setVisible(true);
    }
    for (const v of [...this.vehicles]) this.removeVehicle(v);
    this.traffic.length = 0;
    this.parked.length = 0;
    this.police.length = 0;
    this.blockedTime.clear();
  }

  /** All dynamic obstacle circles for player collision checks (vehicles). */
  nearbyVehicles(x: number, z: number, radius: number): Vehicle[] {
    const out: Vehicle[] = [];
    for (const v of this.vehicles) {
      if (v.destroyed) continue;
      if (dist2D(x, z, v.position.x, v.position.z) < radius + v.def.length) out.push(v);
    }
    return out;
  }

  getPoliceTarget(): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = Infinity;
    for (const v of this.police) {
      if (v.destroyed || v.driver !== 'police') continue;
      const d = dist2D(v.position.x, v.position.z, this.player.position.x, this.player.position.z);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  dispose(): void {
    this.offDestroyed();
    this.effects.dispose();
    for (const v of [...this.vehicles]) this.removeVehicle(v);
    for (const e of this.explosions) this.removeExplosion(e);
    this.explosions = [];
  }
}

function dampAngleSafe(current: number, target: number, lambda: number, dt: number): number {
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}

export type { DriveControls };
export { clamp };
