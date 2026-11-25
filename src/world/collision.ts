/**
 * Static world collision: OBB buildings/props, walkable platforms (sidewalks)
 * and 3D ray tests for camera, bullets and line-of-sight.
 */

import * as THREE from 'three';

export type ColliderType = 'building' | 'prop' | 'wall' | 'landmark' | 'platform';

export interface Collider {
  id: number;
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  angle: number;
  minY: number;
  maxY: number;
  type: ColliderType;
  active: boolean;
  /** Optional tag for gameplay (garage, shop, etc.) */
  tag?: string;
  owner?: string;
}

export interface Platform {
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  angle: number;
  top: number;
  active: boolean;
  owner?: string;
}

export interface RayHit {
  distance: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  collider: Collider | null;
}

const CELL = 40;

export class CollisionWorld {
  colliders: Collider[] = [];
  platforms: Platform[] = [];
  private grid = new Map<string, number[]>();
  private platformGrid = new Map<string, number[]>();
  private nextId = 1;

  clear(): void {
    this.colliders.length = 0;
    this.platforms.length = 0;
    this.grid.clear();
    this.platformGrid.clear();
  }

  private cellsFor(x: number, z: number, halfW: number, halfD: number): string[] {
    const r = Math.hypot(halfW, halfD) + 2;
    const x0 = Math.floor((x - r) / CELL);
    const x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL);
    const z1 = Math.floor((z + r) / CELL);
    const out: string[] = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) out.push(`${cx},${cz}`);
    }
    return out;
  }

  addBox(
    x: number,
    z: number,
    halfW: number,
    halfD: number,
    angle: number,
    minY: number,
    maxY: number,
    type: ColliderType = 'building',
    tag?: string,
    owner?: string,
  ): Collider {
    const collider: Collider = {
      id: this.nextId++,
      x,
      z,
      halfW,
      halfD,
      angle,
      minY,
      maxY,
      type,
      active: true,
      tag,
      owner,
    };
    this.colliders.push(collider);
    for (const key of this.cellsFor(x, z, halfW, halfD)) {
      let arr = this.grid.get(key);
      if (!arr) {
        arr = [];
        this.grid.set(key, arr);
      }
      arr.push(collider.id - 1);
    }
    return collider;
  }

  addPlatform(x: number, z: number, halfW: number, halfD: number, angle: number, top: number, owner?: string): void {
    const p: Platform = { x, z, halfW, halfD, angle, top, active: true, owner };
    this.platforms.push(p);
    for (const key of this.cellsFor(x, z, halfW, halfD)) {
      let arr = this.platformGrid.get(key);
      if (!arr) {
        arr = [];
        this.platformGrid.set(key, arr);
      }
      arr.push(this.platforms.length - 1);
    }
  }

  queryCircle(x: number, z: number, radius: number, out: Collider[] = []): Collider[] {
    out.length = 0;
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const range = Math.ceil((radius + 2) / CELL);
    const seen = new Set<number>();
    for (let ox = -range; ox <= range; ox++) {
      for (let oz = -range; oz <= range; oz++) {
        const arr = this.grid.get(`${cx + ox},${cz + oz}`);
        if (!arr) continue;
        for (const idx of arr) {
          if (seen.has(idx)) continue;
          seen.add(idx);
          const c = this.colliders[idx];
          if (!c.active) continue;
          if (Math.abs(c.x - x) > c.halfW + c.halfD + radius + 2) continue;
          if (Math.abs(c.z - z) > c.halfW + c.halfD + radius + 2) continue;
          out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Push a circle out of static colliders.
   * Returns the corrected position and whether a collision happened.
   */
  resolveCircle(
    x: number,
    z: number,
    radius: number,
    feetY: number,
    headY: number,
    out = { x: 0, z: 0, hit: false, nx: 0, nz: 0 },
  ): { x: number; z: number; hit: boolean; nx: number; nz: number } {
    out.x = x;
    out.z = z;
    out.hit = false;
    out.nx = 0;
    out.nz = 0;
    const nearby: Collider[] = [];
    this.queryCircle(x, z, radius + 1, nearby);
    for (const c of nearby) {
      if (c.maxY < feetY + 0.15 || c.minY > headY) continue;
      const cos = Math.cos(c.angle);
      const sin = Math.sin(c.angle);
      const dx = out.x - c.x;
      const dz = out.z - c.z;
      // inverse Y rotation
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      const qx = Math.max(-c.halfW, Math.min(c.halfW, lx));
      const qz = Math.max(-c.halfD, Math.min(c.halfD, lz));
      let ox = lx - qx;
      let oz = lz - qz;
      let d = Math.hypot(ox, oz);
      if (d >= radius) continue;
      if (d < 1e-5) {
        // center inside: push along the smallest penetration axis
        const penX = c.halfW - Math.abs(lx);
        const penZ = c.halfD - Math.abs(lz);
        if (penX < penZ) {
          ox = Math.sign(lx) || 1;
          oz = 0;
          d = 0;
          const push = (c.halfW - Math.abs(lx) + radius) * (Math.sign(lx) || 1);
          const wx = push * cos + 0 * sin;
          const wz = -push * sin + 0 * cos;
          out.x += wx;
          out.z += wz;
          out.hit = true;
          out.nx = ox * cos + oz * sin;
          out.nz = -ox * sin + oz * cos;
        } else {
          const push = (c.halfD - Math.abs(lz) + radius) * (Math.sign(lz) || 1);
          const wx = 0 * cos + push * sin;
          const wz = 0 * -sin + push * cos;
          out.x += wx;
          out.z += wz;
          out.hit = true;
          out.nx = 0 * cos + (Math.sign(lz) || 1) * sin;
          out.nz = 0 * -sin + (Math.sign(lz) || 1) * cos;
        }
        continue;
      }
      const push = radius - d;
      const ux = ox / d;
      const uz = oz / d;
      // back to world
      const wx = ux * cos + uz * sin;
      const wz = -ux * sin + uz * cos;
      out.x += wx * push;
      out.z += wz * push;
      out.hit = true;
      out.nx = wx;
      out.nz = wz;
    }
    return out;
  }

  removeByOwner(owner: string): void {
    let removed = false;
    for (const c of this.colliders) {
      if (c.owner === owner && c.active) {
        c.active = false;
        removed = true;
      }
    }
    for (const p of this.platforms) {
      if (p.owner === owner && p.active) {
        p.active = false;
        removed = true;
      }
    }
    if (removed) {
      this.compact();
    }
  }

  private compact(): void {
    // Drop inactive entries and rebuild the grids when enough have accumulated.
    if (this.colliders.length < 400) return;
    const activeColliders = this.colliders.filter((c) => c.active);
    const activePlatforms = this.platforms.filter((p) => p.active);
    if (activeColliders.length > this.colliders.length * 0.75) return;
    this.colliders = activeColliders;
    this.platforms = activePlatforms;
    this.grid.clear();
    this.platformGrid.clear();
    this.nextId = 1;
    for (const c of this.colliders) {
      c.id = this.nextId++;
      for (const key of this.cellsFor(c.x, c.z, c.halfW, c.halfD)) {
        let arr = this.grid.get(key);
        if (!arr) {
          arr = [];
          this.grid.set(key, arr);
        }
        arr.push(c.id - 1);
      }
    }
    for (let i = 0; i < this.platforms.length; i++) {
      const p = this.platforms[i];
      for (const key of this.cellsFor(p.x, p.z, p.halfW, p.halfD)) {
        let arr = this.platformGrid.get(key);
        if (!arr) {
          arr = [];
          this.platformGrid.set(key, arr);
        }
        arr.push(i);
      }
    }
  }

  platformHeightAt(x: number, z: number): number | null {    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let best: number | null = null;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const arr = this.platformGrid.get(`${cx + ox},${cz + oz}`);
        if (!arr) continue;
        for (const idx of arr) {
          const p = this.platforms[idx];
          if (!p.active) continue;
          const cos = Math.cos(p.angle);
          const sin = Math.sin(p.angle);
          const dx = x - p.x;
          const dz = z - p.z;
          const lx = dx * cos - dz * sin;
          const lz = dx * sin + dz * cos;
          if (Math.abs(lx) <= p.halfW && Math.abs(lz) <= p.halfD) {
            if (best === null || p.top > best) best = p.top;
          }
        }
      }
    }
    return best;
  }

  /** 2D ray against colliders (used for navigation line-of-sight). */
  raycast2D(
    x: number,
    z: number,
    dx: number,
    dz: number,
    maxDist: number,
    ignoreTags?: Set<string>,
  ): { distance: number; collider: Collider | null; x: number; z: number } {
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const steps = Math.ceil(maxDist / 8);
    let prevX = x;
    let prevZ = z;
    for (let s = 1; s <= steps; s++) {
      const d = (s / steps) * maxDist;
      const px = x + dx * d;
      const pz = z + dz * d;
      const nearby: Collider[] = [];
      this.queryCircle(px, pz, 0.4, nearby);
      for (const c of nearby) {
        if (c.type === 'platform') continue;
        if (ignoreTags?.has(c.tag ?? '')) continue;
        const cos = Math.cos(c.angle);
        const sin = Math.sin(c.angle);
        const lx = (px - c.x) * cos - (pz - c.z) * sin;
        const lz = (px - c.x) * sin + (pz - c.z) * cos;
        if (Math.abs(lx) <= c.halfW && Math.abs(lz) <= c.halfD) {
          return { distance: Math.hypot(px - x, pz - z), collider: c, x: prevX, z: prevZ };
        }
      }
      prevX = px;
      prevZ = pz;
    }
    return { distance: maxDist, collider: null, x: x + dx * maxDist, z: z + dz * maxDist };
  }

  /** 3D ray vs OBBs and terrain, for camera and hitscan. */
  raycast3D(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    terrainHeight: (x: number, z: number) => number,
    ignoreBuildingAt?: THREE.Vector3,
  ): RayHit | null {
    let best: RayHit | null = null;
    const endX = origin.x + dir.x * maxDist;
    const endZ = origin.z + dir.z * maxDist;
    const minX = Math.min(origin.x, endX);
    const maxX = Math.max(origin.x, endX);
    const minZ = Math.min(origin.z, endZ);
    const maxZ = Math.max(origin.z, endZ);
    const nearby: Collider[] = [];
    const cx0 = Math.floor(minX / CELL);
    const cx1 = Math.floor(maxX / CELL);
    const cz0 = Math.floor(minZ / CELL);
    const cz1 = Math.floor(maxZ / CELL);
    const seen = new Set<number>();
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const arr = this.grid.get(`${cx},${cz}`);
        if (!arr) continue;
        for (const idx of arr) {
          if (seen.has(idx)) continue;
          seen.add(idx);
          nearby.push(this.colliders[idx]);
        }
      }
    }

    for (const c of nearby) {
      if (!c.active) continue;
      if (c.type === 'platform') continue;
      if (ignoreBuildingAt && Math.abs(c.x - ignoreBuildingAt.x) < 0.5 && Math.abs(c.z - ignoreBuildingAt.z) < 0.5) continue;
      const hit = rayOBB(origin, dir, c, maxDist);
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }

    // terrain
    const step = 2.5;
    for (let d = 0; d < maxDist; d += step) {
      const px = origin.x + dir.x * d;
      const pz = origin.z + dir.z * d;
      const py = origin.y + dir.y * d;
      const h = terrainHeight(px, pz);
      if (py <= h) {
        // refine
        let lo = Math.max(0, d - step);
        let hi = d;
        for (let i = 0; i < 5; i++) {
          const mid = (lo + hi) / 2;
          const my = origin.y + dir.y * mid;
          const mh = terrainHeight(origin.x + dir.x * mid, origin.z + dir.z * mid);
          if (my <= mh) hi = mid;
          else lo = mid;
        }
        const dist = hi;
        if (!best || dist < best.distance) {
          best = {
            distance: dist,
            x: origin.x + dir.x * dist,
            y: origin.y + dir.y * dist,
            z: origin.z + dir.z * dist,
            nx: 0,
            ny: 1,
            nz: 0,
            collider: null,
          };
        }
        break;
      }
    }
    return best;
  }
}

function rayOBB(origin: THREE.Vector3, dir: THREE.Vector3, c: Collider, maxDist: number): RayHit | null {
  const cos = Math.cos(c.angle);
  const sin = Math.sin(c.angle);
  const ox = origin.x - c.x;
  const oz = origin.z - c.z;
  const lox = ox * cos - oz * sin;
  const loz = ox * sin + oz * cos;
  const ldx = dir.x * cos - dir.z * sin;
  const ldz = dir.x * sin + dir.z * cos;

  const halfW = c.halfW;
  const halfD = c.halfD;
  const yMin = c.minY - origin.y;
  const yMax = c.maxY - origin.y;
  const dy = dir.y || 1e-9;

  let tmin = -Infinity;
  let tmax = Infinity;
  let hitAxis = 0;
  let hitSign = 1;

  const testAxis = (originV: number, dirV: number, min: number, max: number, axis: number): boolean => {
    if (Math.abs(dirV) < 1e-9) return originV >= min && originV <= max;
    let t1 = (min - originV) / dirV;
    let t2 = (max - originV) / dirV;
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      sign = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      hitAxis = axis;
      hitSign = sign;
    }
    if (t2 < tmax) tmax = t2;
    return tmin <= tmax;
  };

  if (!testAxis(lox, ldx, -halfW, halfW, 0)) return null;
  if (!testAxis(loz, ldz, -halfD, halfD, 2)) return null;
  if (!testAxis(0, dy, yMin, yMax, 1)) return null;

  const t = tmin >= 0 ? tmin : tmax;
  if (t < 0 || t > maxDist) return null;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  if (hitAxis === 0) nx = hitSign;
  else if (hitAxis === 1) ny = hitSign;
  else nz = hitSign;
  // rotate normal back
  const wnx = nx * cos + nz * sin;
  const wnz = -nx * sin + nz * cos;
  return {
    distance: t,
    x: origin.x + dir.x * t,
    y: origin.y + dir.y * t,
    z: origin.z + dir.z * t,
    nx: wnx,
    ny,
    nz: wnz,
    collider: c,
  };
}
