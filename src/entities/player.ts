/** On-foot player controller: movement, collision, health and weapons. */

import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../core/math';
import { InputSystem } from '../core/input';
import { events } from '../core/events';
import { World } from '../world/world';
import { CharacterModel, PLAYER_LOOK } from './character';

export type WeaponId = 'pistol' | 'smg' | 'shotgun';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  damage: number;
  rpm: number;
  magSize: number;
  spread: number;
  range: number;
  pellets: number;
  auto: boolean;
  reloadTime: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    id: 'pistol',
    name: '9MM',
    damage: 24,
    rpm: 300,
    magSize: 12,
    spread: 0.014,
    range: 85,
    pellets: 1,
    auto: false,
    reloadTime: 1.25,
  },
  smg: {
    id: 'smg',
    name: 'SMG',
    damage: 15,
    rpm: 760,
    magSize: 30,
    spread: 0.032,
    range: 70,
    pellets: 1,
    auto: true,
    reloadTime: 1.6,
  },
  shotgun: {
    id: 'shotgun',
    name: 'SHOTGUN',
    damage: 12,
    rpm: 75,
    magSize: 6,
    spread: 0.075,
    range: 38,
    pellets: 7,
    auto: false,
    reloadTime: 2.1,
  },
};

const RADIUS = 0.36;
const GRAVITY = 20;

export class Player {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  health = 100;
  armor = 0;
  dead = false;
  grounded = true;
  inWater = false;
  aiming = false;
  speed = 0;
  readonly model: CharacterModel;

  weapon: WeaponId = 'pistol';
  owned: Record<WeaponId, boolean> = { pistol: true, smg: false, shotgun: false };
  loaded: Record<WeaponId, number> = { pistol: 12, smg: 0, shotgun: 0 };
  reserve: Record<WeaponId, number> = { pistol: 36, smg: 0, shotgun: 0 };

  inVehicle = false;
  stamina = 100;
  readonly staminaMax = 100;
  sprinting = false;
  private exhausted = false;
  private staminaIdle = 0;
  private jumpBuffer = 0;
  private landTimer = 0;
  private aimPitch = 0;
  private fireCooldown = 0;
  private reloadTimer = 0;
  private reloadWeapon: WeaponId | null = null;
  private coyote = 0;
  private lastDamageAt = -100;
  private lastShotAt = -100;
  private stepTimer = 0;

  constructor(world: World) {
    void world;
    this.model = new CharacterModel(PLAYER_LOOK);
  }

  reset(x: number, z: number, yaw: number, world: World): void {
    this.position.set(x, world.groundHeight(x, z) + 0.05, z);
    // Spawn and respawn points can land inside a facade or a landmark: push
    // the capsule out before the first frame instead of letting it snap later.
    for (let i = 0; i < 3; i++) {
      const res = world.collision.resolveCircle(
        this.position.x,
        this.position.z,
        RADIUS,
        this.position.y + 0.1,
        this.position.y + 1.7,
      );
      if (!res.hit) break;
      this.position.x = res.x;
      this.position.z = res.z;
      this.position.y = world.groundHeight(res.x, res.z) + 0.05;
    }
    // If the point was deep inside a block, start on the nearest street instead.
    if (Math.hypot(this.position.x - x, this.position.z - z) > 8) {
      const road = world.nearestRoadPoint(this.position.x, this.position.z);
      if (road) {
        this.position.set(road.x, world.groundHeight(road.x, road.z) + 0.05, road.z);
        yaw = road.yaw;
      }
    }
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.health = 100;
    this.armor = 0;
    this.dead = false;
    this.grounded = true;
    this.aiming = false;
    this.inWater = false;
    this.stamina = this.staminaMax;
    this.exhausted = false;
    this.staminaIdle = 0;
    this.sprinting = false;
    this.jumpBuffer = 0;
    this.landTimer = 0;
    this.model.group.rotation.z = 0;
    this.model.group.position.y = 0;
    this.fireCooldown = 0;
    this.reloadTimer = 0;
    this.reloadWeapon = null;
    this.model.setWeapon(this.weapon);
    this.syncModel();
  }

  get eyeHeight(): number {
    return 1.58;
  }

  get forwardX(): number {
    return Math.sin(this.yaw);
  }

  get forwardZ(): number {
    return Math.cos(this.yaw);
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get currentWeapon(): WeaponDef {
    return WEAPONS[this.weapon];
  }

  get ammoLabel(): string {
    const def = this.currentWeapon;
    return `${this.loaded[this.weapon]} / ${this.reserve[this.weapon]}`;
  }

  setWeapon(id: WeaponId): void {
    if (!this.owned[id]) return;
    this.weapon = id;
    this.reloadTimer = 0;
    this.reloadWeapon = null;
  }

  cycleWeapon(): void {
    const order: WeaponId[] = ['pistol', 'smg', 'shotgun'];
    const start = order.indexOf(this.weapon);
    for (let i = 1; i <= order.length; i++) {
      const next = order[(start + i) % order.length];
      if (this.owned[next]) {
        this.setWeapon(next);
        return;
      }
    }
  }

  giveWeapon(id: WeaponId, reserveAmmo: number): void {
    this.owned[id] = true;
    this.reserve[id] += reserveAmmo;
    if (this.loaded[id] === 0) {
      const take = Math.min(WEAPONS[id].magSize, this.reserve[id]);
      this.loaded[id] = take;
      this.reserve[id] -= take;
    }
  }

  update(
    dt: number,
    input: InputSystem,
    camYaw: number,
    world: World,
    controllable = true,
    camPitch = 0,
  ): void {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.tickReload(dt);
    this.landTimer = Math.max(0, this.landTimer - dt);
    this.aimPitch = camPitch;

    if (this.dead) {
      this.velocity.x = 0;
      this.velocity.z = 0;
      this.speed = 0;
      this.sprinting = false;
      this.syncModel();
      this.model.update(dt, 0, false, false, true);
      return;
    }

    if (this.health < 60 && performance.now() / 1000 - this.lastDamageAt > 12) {
      this.health = Math.min(60, this.health + 2.4 * dt);
    }

    if (this.inVehicle) {
      this.speed = 0;
      this.sprinting = false;
      this.tickStamina(dt);
      this.syncModel();
      this.model.setVisible(false);
      return;
    }
    this.model.setVisible(true);

    const mx = controllable ? input.moveX : 0;
    const my = controllable ? input.moveY : 0;
    const moveLen = Math.hypot(mx, my);
    if (controllable && input.wasPressed('jump')) this.jumpBuffer = 0.16;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.aiming = controllable && (input.isDown('aim') || input.isDown('attack')) && !this.inWater;

    const fwdX = Math.sin(camYaw);
    const fwdZ = Math.cos(camYaw);
    const rightX = Math.cos(camYaw);
    const rightZ = -Math.sin(camYaw);
    let dx = fwdX * my + rightX * mx;
    let dz = fwdZ * my + rightZ * mx;
    const dl = Math.hypot(dx, dz);
    if (dl > 1) {
      dx /= dl;
      dz /= dl;
    }

    const analog = clamp(moveLen, 0, 1);
    const wantSprint =
      controllable && input.isDown('sprint') && my > 0.25 && !this.aiming && !this.inWater;
    this.sprinting = wantSprint && !this.exhausted && this.stamina > 0 && analog > 0.4;
    this.tickStamina(dt);
    // dx/dz keep the stick magnitude, so a half push walks at half run speed.
    const maxSpeed = this.inWater ? 2.5 : this.aiming ? 2.5 : this.sprinting ? 7.4 : 4.35;
    const accel = this.grounded ? (this.aiming ? 16 : 13) : 3.2;
    const targetVx = dx * maxSpeed;
    const targetVz = dz * maxSpeed;
    this.velocity.x = damp(this.velocity.x, targetVx, accel, dt);
    this.velocity.z = damp(this.velocity.z, targetVz, accel, dt);

    if (dl > 0.08) {
      const targetYaw = this.aiming ? camYaw : Math.atan2(dx, dz);
      this.yaw = dampAngle(this.yaw, targetYaw, this.aiming ? 18 : 11, dt);
    } else if (this.aiming) {
      this.yaw = dampAngle(this.yaw, camYaw, 16, dt);
    }

    // horizontal move + collision
    const nx = this.position.x + this.velocity.x * dt;
    const nz = this.position.z + this.velocity.z * dt;
    this.position.x = nx;
    this.position.z = nz;
    const res = world.collision.resolveCircle(
      this.position.x,
      this.position.z,
      RADIUS,
      this.position.y + 0.1,
      this.position.y + 1.7,
    );
    if (res.hit) {
      this.position.x = res.x;
      this.position.z = res.z;
      // slide: kill velocity along the normal
      const dot = this.velocity.x * res.nx + this.velocity.z * res.nz;
      if (dot < 0) {
        this.velocity.x -= res.nx * dot;
        this.velocity.z -= res.nz * dot;
      }
    }

    const clamped = world.clampToWorld(this.position.x, this.position.z);
    this.position.x = clamped.x;
    this.position.z = clamped.z;

    const ground = world.groundHeight(this.position.x, this.position.z);
    const water = world.isWater(this.position.x, this.position.z) && ground < world.waterLevelAt(this.position.x, this.position.z) - 0.35;
    this.inWater = water;

    if (water) {
      this.grounded = false;
      const surface = world.waterLevelAt(this.position.x, this.position.z) - 0.48;
      this.position.y = damp(this.position.y, surface, 8, dt);
      this.velocity.y = 0;
    } else {
      if (this.grounded) {
        this.coyote = 0.12;
        if (ground > this.position.y - 0.55) {
          this.position.y = ground;
          this.velocity.y = 0;
        } else {
          this.grounded = false;
        }
      } else {
        this.coyote = Math.max(0, this.coyote - dt);
        this.velocity.y -= GRAVITY * dt;
        this.position.y += this.velocity.y * dt;
        if (this.position.y <= ground) {
          const impact = -this.velocity.y;
          if (impact > 9) {
            this.applyDamage(Math.min(35, (impact - 9) * 2.2), 'caduta');
          }
          if (impact > 6) {
            this.landTimer = 0.34;
            events.emit('player:landed', { impact });
          }
          this.position.y = ground;
          this.velocity.y = 0;
          this.grounded = true;
        }
      }

      if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
        this.velocity.y = 5.7;
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
      }
    }

    this.speed = this.horizontalSpeed;
    this.syncModel();
    this.model.setWeapon(this.weapon);
    this.model.update(
      dt,
      this.speed,
      this.aiming,
      !this.grounded && !this.inWater,
      false,
      this.aimPitch,
      this.sprinting,
      this.landTimer > 0 ? this.landTimer / 0.34 : 0,
    );

    // footsteps (used by audio through events is overkill; the game reads speed)
    this.stepTimer += dt * this.speed;
    if (this.stepTimer > 2.4 && this.grounded) {
      this.stepTimer = 0;
      events.emit('audio:crash', { x: this.position.x, z: this.position.z, impact: 0 });
    }
  }

  private tickStamina(dt: number): void {
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - 18 * dt);
      this.staminaIdle = 0;
      if (this.stamina <= 0) this.exhausted = true;
      return;
    }
    this.staminaIdle += dt;
    if (this.staminaIdle < 0.55) return;
    this.stamina = Math.min(this.staminaMax, this.stamina + 22 * dt);
    if (this.exhausted && this.stamina >= 25) this.exhausted = false;
  }

  private tickReload(dt: number): void {
    if (this.reloadTimer <= 0) return;
    this.reloadTimer -= dt;
    if (this.reloadTimer <= 0 && this.reloadWeapon) {
      const id = this.reloadWeapon;
      const def = WEAPONS[id];
      const take = Math.min(def.magSize - this.loaded[id], this.reserve[id]);
      this.loaded[id] += take;
      this.reserve[id] -= take;
      this.reloadWeapon = null;
    }
  }

  startReload(): boolean {
    if (this.reloadTimer > 0) return false;
    const def = this.currentWeapon;
    if (this.loaded[this.weapon] >= def.magSize || this.reserve[this.weapon] <= 0) return false;
    this.reloadTimer = def.reloadTime;
    this.reloadWeapon = this.weapon;
    return true;
  }

  /** Attempt a shot; returns the weapon definition when the trigger is valid. */
  tryShoot(now: number): WeaponDef | null {
    if (this.dead || this.reloadTimer > 0 || this.fireCooldown > 0) return null;
    const def = this.currentWeapon;
    if (this.loaded[this.weapon] <= 0) {
      this.startReload();
      return null;
    }
    this.loaded[this.weapon]--;
    this.fireCooldown = 60 / def.rpm;
    this.lastShotAt = now;
    if (this.loaded[this.weapon] === 0) this.startReload();
    return def;
  }

  get isReloading(): boolean {
    return this.reloadTimer > 0;
  }

  get reloadProgress(): number {
    if (!this.reloadWeapon || this.reloadTimer <= 0) return 1;
    return 1 - this.reloadTimer / WEAPONS[this.reloadWeapon].reloadTime;
  }

  applyDamage(amount: number, reason: string): void {
    if (this.dead || amount <= 0) return;
    this.lastDamageAt = performance.now() / 1000;
    let remaining = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, remaining * 0.7);
      this.armor -= absorbed;
      remaining -= absorbed;
    }
    this.health = Math.max(0, this.health - remaining);
    events.emit('player:damaged', { amount: remaining, health: this.health });
    if (this.health <= 0) {
      this.dead = true;
      this.velocity.set(0, 0, 0);
      events.emit('game:death', { reason });
    }
  }

  heal(amount: number): void {
    this.health = Math.min(100, this.health + amount);
    events.emit('player:healed', { health: this.health });
  }

  addArmor(amount: number): void {
    this.armor = Math.min(100, this.armor + amount);
  }

  muzzlePosition(out = new THREE.Vector3()): THREE.Vector3 {
    const fwdX = Math.sin(this.yaw);
    const fwdZ = Math.cos(this.yaw);
    return out.set(this.position.x + fwdX * 0.55, this.position.y + 1.38, this.position.z + fwdZ * 0.55);
  }

  syncModel(): void {
    this.model.group.position.set(this.position.x, this.position.y, this.position.z);
    this.model.group.rotation.y = this.yaw;
  }

  get lastShot(): number {
    return this.lastShotAt;
  }
}
