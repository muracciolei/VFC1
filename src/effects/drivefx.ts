/**
 * Driving feedback: skid marks on the asphalt, tire smoke while drifting and
 * dark smoke from a damaged engine. Purely cosmetic — no physics here.
 */

import * as THREE from 'three';
import { World } from '../world/world';
import { Vehicle } from '../entities/vehicle';

const MAX_QUADS = 420;
const SMOKE_PUFFS = 12;
const EMIT_INTERVAL = 0.032;

interface Puff {
  sprite: THREE.Sprite;
  life: number;
  max: number;
  vx: number;
  vy: number;
  vz: number;
}

function smokeTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export class DrivingEffects {
  private readonly world: World;
  private readonly scene: THREE.Scene;
  private readonly markPositions: Float32Array;
  private readonly markGeometry: THREE.BufferGeometry;
  private readonly markMesh: THREE.Mesh;
  private readonly puffs: Puff[] = [];
  private readonly texture: THREE.Texture;
  private readonly prevL = new THREE.Vector3();
  private readonly prevR = new THREE.Vector3();
  private readonly wheelL = new THREE.Vector3();
  private readonly wheelR = new THREE.Vector3();
  private hasPrev = false;
  private markCursor = 0;
  private emitTimer = 0;
  private damageTimer = 0;
  private puffCursor = 0;

  constructor(scene: THREE.Scene, world: World) {
    this.scene = scene;
    this.world = world;

    this.markPositions = new Float32Array(MAX_QUADS * 4 * 3);
    for (let i = 1; i < this.markPositions.length; i += 3) this.markPositions[i] = -500;
    this.markGeometry = new THREE.BufferGeometry();
    this.markGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.markPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    const indices: number[] = [];
    for (let i = 0; i < MAX_QUADS; i++) {
      const b = i * 4;
      indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    this.markGeometry.setIndex(indices);
    this.markMesh = new THREE.Mesh(
      this.markGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x151618,
        transparent: true,
        opacity: 0.46,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    this.markMesh.frustumCulled = false;
    this.markMesh.renderOrder = 1;
    scene.add(this.markMesh);

    this.texture = smokeTexture();
    for (let i = 0; i < SMOKE_PUFFS; i++) {
      const material = new THREE.SpriteMaterial({
        map: this.texture,
        color: 0xc4c5c6,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(0.6, 0.6, 1);
      sprite.visible = false;
      scene.add(sprite);
      this.puffs.push({ sprite, life: 0, max: 1, vx: 0, vy: 0, vz: 0 });
    }
  }

  update(dt: number, car: Vehicle | null): void {
    this.updateSmoke(dt);
    if (!car || car.destroyed) {
      this.hasPrev = false;
      return;
    }

    const speed = car.speed;
    const slip = Math.abs(car.lateralSpeed);
    const skidding = speed > 3.2 && ((car.handbraking && speed > 4) || slip > 2.4);

    if (skidding) {
      this.emitTimer -= dt;
      if (this.emitTimer <= 0) {
        this.emitTimer = EMIT_INTERVAL;
        this.rearWheel(car, -1, this.wheelL);
        this.rearWheel(car, 1, this.wheelR);
        if (this.hasPrev) {
          this.addMark(this.prevL, this.wheelL);
          this.addMark(this.prevR, this.wheelR);
        }
        this.prevL.copy(this.wheelL);
        this.prevR.copy(this.wheelR);
        this.hasPrev = true;
        this.puff(this.wheelL, 0xc7c8c9, 0.28);
        this.puff(this.wheelR, 0xc7c8c9, 0.24);
      }
    } else {
      this.hasPrev = false;
      this.emitTimer = 0;
    }

    // Damaged engine: dark smoke from under the hood.
    if (car.health < car.maxHealth * 0.35 && speed > 2) {
      this.damageTimer -= dt;
      if (this.damageTimer <= 0) {
        this.damageTimer = 0.12;
        const fx = Math.sin(car.yaw);
        const fz = Math.cos(car.yaw);
        this.puff(
          {
            x: car.position.x + fx * car.def.length * 0.32,
            y: this.world.groundHeight(car.position.x, car.position.z) + 0.8,
            z: car.position.z + fz * car.def.length * 0.32,
          },
          0x3b3c3e,
          0.2,
        );
      }
    }
  }

  clear(): void {
    for (let i = 1; i < this.markPositions.length; i += 3) this.markPositions[i] = -500;
    (this.markGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.markCursor = 0;
    this.hasPrev = false;
    this.emitTimer = 0;
    this.damageTimer = 0;
    for (const puff of this.puffs) {
      puff.life = 0;
      puff.sprite.visible = false;
      puff.sprite.material.opacity = 0;
    }
  }

  private rearWheel(car: Vehicle, side: -1 | 1, out: THREE.Vector3): void {
    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);
    const rx = Math.cos(car.yaw);
    const rz = -Math.sin(car.yaw);
    const lx = side * (car.def.width / 2 - 0.1);
    const lz = -car.def.wheelBase / 2;
    out.set(
      car.position.x + rx * lx + fx * lz,
      this.world.groundHeight(
        car.position.x + rx * lx + fx * lz,
        car.position.z + rz * lx + fz * lz,
      ),
      car.position.z + rz * lx + fz * lz,
    );
  }

  private addMark(from: THREE.Vector3, to: THREE.Vector3): void {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.03 || length > 2.4) return;
    const nx = (-dz / length) * 0.085;
    const nz = (dx / length) * 0.085;
    const i = this.markCursor * 12;
    const yFrom = this.world.groundHeight(from.x, from.z) + 0.035;
    const yTo = this.world.groundHeight(to.x, to.z) + 0.035;
    const p = this.markPositions;
    p[i] = from.x + nx;
    p[i + 1] = yFrom;
    p[i + 2] = from.z + nz;
    p[i + 3] = from.x - nx;
    p[i + 4] = yFrom;
    p[i + 5] = from.z - nz;
    p[i + 6] = to.x - nx;
    p[i + 7] = yTo;
    p[i + 8] = to.z - nz;
    p[i + 9] = to.x + nx;
    p[i + 10] = yTo;
    p[i + 11] = to.z + nz;
    this.markCursor = (this.markCursor + 1) % MAX_QUADS;
    (this.markGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  private puff(
    at: { x: number; y: number; z: number },
    color: number,
    strength: number,
  ): void {
    const puff = this.puffs[this.puffCursor % this.puffs.length];
    this.puffCursor++;
    puff.life = 0.9;
    puff.max = 0.9;
    puff.vx = (Math.random() - 0.5) * 0.9;
    puff.vy = 0.5 + Math.random() * 0.45;
    puff.vz = (Math.random() - 0.5) * 0.9;
    puff.sprite.position.set(at.x + (Math.random() - 0.5) * 0.3, at.y + 0.22, at.z + (Math.random() - 0.5) * 0.3);
    puff.sprite.material.color.setHex(color);
    puff.sprite.material.opacity = strength;
    puff.sprite.scale.set(0.5, 0.5, 1);
    puff.sprite.visible = true;
  }

  private updateSmoke(dt: number): void {
    for (const puff of this.puffs) {
      if (puff.life <= 0) continue;
      puff.life -= dt;
      if (puff.life <= 0) {
        puff.sprite.visible = false;
        puff.sprite.material.opacity = 0;
        continue;
      }
      puff.vy += 0.35 * dt;
      puff.sprite.position.x += puff.vx * dt;
      puff.sprite.position.y += puff.vy * dt;
      puff.sprite.position.z += puff.vz * dt;
      const t = puff.life / puff.max;
      puff.sprite.material.opacity = t * 0.26;
      puff.sprite.scale.setScalar(0.5 + (1 - t) * 0.95);
    }
  }

  dispose(): void {
    this.scene.remove(this.markMesh);
    this.markGeometry.dispose();
    (this.markMesh.material as THREE.Material).dispose();
    for (const puff of this.puffs) {
      this.scene.remove(puff.sprite);
      puff.sprite.material.dispose();
    }
    this.texture.dispose();
  }
}
