/** Lightweight geometry builder used to merge procedural props into few meshes. */

import * as THREE from 'three';
import { FACADE_ATLAS_COLS, FACADE_ATLAS_ROWS } from './textures';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface UV {
  u: number;
  v: number;
}

export class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get isEmpty(): boolean {
    return this.indices.length === 0;
  }

  addVertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, r: number, g: number, b: number): number {
    const index = this.positions.length / 3;
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.uvs.push(u, v);
    this.colors.push(r, g, b);
    return index;
  }

  addQuad(
    a: V3,
    b: V3,
    c: V3,
    d: V3,
    nx: number,
    ny: number,
    nz: number,
    uv0: UV,
    uv1: UV,
    uv2: UV,
    uv3: UV,
    color: THREE.Color,
  ): void {
    const base = this.vertexCount;
    this.addVertex(a.x, a.y, a.z, nx, ny, nz, uv0.u, uv0.v, color.r, color.g, color.b);
    this.addVertex(b.x, b.y, b.z, nx, ny, nz, uv1.u, uv1.v, color.r, color.g, color.b);
    this.addVertex(c.x, c.y, c.z, nx, ny, nz, uv2.u, uv2.v, color.r, color.g, color.b);
    this.addVertex(d.x, d.y, d.z, nx, ny, nz, uv3.u, uv3.v, color.r, color.g, color.b);
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  addTriangle(a: V3, b: V3, c: V3, nx: number, ny: number, nz: number, uv0: UV, uv1: UV, uv2: UV, color: THREE.Color): void {
    const base = this.vertexCount;
    this.addVertex(a.x, a.y, a.z, nx, ny, nz, uv0.u, uv0.v, color.r, color.g, color.b);
    this.addVertex(b.x, b.y, b.z, nx, ny, nz, uv1.u, uv1.v, color.r, color.g, color.b);
    this.addVertex(c.x, c.y, c.z, nx, ny, nz, uv2.u, uv2.v, color.r, color.g, color.b);
    this.indices.push(base, base + 1, base + 2);
  }

  /**
   * Axis-aligned-in-local-space box, rotated around Y.
   * uvScale is world units per texture repeat (larger = fewer repeats).
   */
  addBox(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    rotY: number,
    color: THREE.Color,
    uvScale = 4,
    topColor?: THREE.Color,
    bottomColor?: THREE.Color,
    skipBottom = false,
    skipTop = false,
  ): void {
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);

    const tr = (x: number, y: number, z: number): V3 => ({
      x: cx + x * cos + z * sin,
      y: cy + y,
      z: cz - x * sin + z * cos,
    });

    const nrm = (x: number, y: number, z: number): [number, number, number] => [x * cos + z * sin, y, -x * sin + z * cos];

    const p000 = tr(-hx, -hy, -hz);
    const p100 = tr(hx, -hy, -hz);
    const p110 = tr(hx, hy, -hz);
    const p010 = tr(-hx, hy, -hz);
    const p001 = tr(-hx, -hy, hz);
    const p101 = tr(hx, -hy, hz);
    const p111 = tr(hx, hy, hz);
    const p011 = tr(-hx, hy, hz);

    const top = topColor ?? color;
    const bottom = bottomColor ?? color;
    const ux = Math.max(1, Math.round(sx / uvScale));
    const uy = Math.max(1, Math.round(sy / uvScale));
    const uz = Math.max(1, Math.round(sz / uvScale));

    if (!skipTop) {
      const [nx, ny, nz] = nrm(0, 1, 0);
      this.addQuad(
        p011,
        p111,
        p101,
        p001,
        nx,
        ny,
        nz,
        { u: 0, v: 0 },
        { u: ux, v: 0 },
        { u: ux, v: uz },
        { u: 0, v: uz },
        top,
      );
    }
    if (!skipBottom) {
      const [nx, ny, nz] = nrm(0, -1, 0);
      this.addQuad(
        p000,
        p100,
        p110,
        p010,
        nx,
        ny,
        nz,
        { u: 0, v: 0 },
        { u: ux, v: 0 },
        { u: ux, v: uz },
        { u: 0, v: uz },
        bottom,
      );
    }
    {
      const [nx, ny, nz] = nrm(0, 0, 1);
      this.addQuad(
        p001,
        p101,
        p111,
        p011,
        nx,
        ny,
        nz,
        { u: 0, v: 0 },
        { u: ux, v: 0 },
        { u: ux, v: uy },
        { u: 0, v: uy },
        color,
      );
    }
    {
      const [nx, ny, nz] = nrm(0, 0, -1);
      this.addQuad(
        p100,
        p000,
        p010,
        p110,
        nx,
        ny,
        nz,
        { u: 0, v: 0 },
        { u: ux, v: 0 },
        { u: ux, v: uy },
        { u: 0, v: uy },
        color,
      );
    }
    {
      const [nx, ny, nz] = nrm(1, 0, 0);
      this.addQuad(
        p101,
        p100,
        p110,
        p111,
        nx,
        ny,
        nz,
        { u: 0, v: 0 },
        { u: uz, v: 0 },
        { u: uz, v: uy },
        { u: 0, v: uy },
        color,
      );
    }
    {
      const [nx, ny, nz] = nrm(-1, 0, 0);
      this.addQuad(
        p000,
        p001,
        p011,
        p010,
        nx,
        ny,
        nz,
        { u: 0, v: 0 },
        { u: uz, v: 0 },
        { u: uz, v: uy },
        { u: 0, v: uy },
        color,
      );
    }
  }

  addCylinder(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    height: number,
    segments: number,
    color: THREE.Color,
    topColor?: THREE.Color,
    rotY = 0,
  ): void {
    const top = topColor ?? color;
    const y0 = cy;
    const y1 = cy + height;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2 + rotY;
      const a1 = ((i + 1) / segments) * Math.PI * 2 + rotY;
      const x0 = cx + Math.cos(a0) * radius;
      const z0 = cz + Math.sin(a0) * radius;
      const x1 = cx + Math.cos(a1) * radius;
      const z1 = cz + Math.sin(a1) * radius;
      const nx = Math.cos((a0 + a1) / 2);
      const nz = Math.sin((a0 + a1) / 2);
      this.addQuad(
        { x: x0, y: y0, z: z0 },
        { x: x1, y: y0, z: z1 },
        { x: x1, y: y1, z: z1 },
        { x: x0, y: y1, z: z0 },
        nx,
        0,
        nz,
        { u: i / segments, v: 0 },
        { u: (i + 1) / segments, v: 0 },
        { u: (i + 1) / segments, v: 1 },
        { u: i / segments, v: 1 },
        color,
      );
    }
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      this.addTriangle(
        { x: cx, y: y1, z: cz },
        { x: cx + Math.cos(a0) * radius, y: y1, z: cz + Math.sin(a0) * radius },
        { x: cx + Math.cos(a1) * radius, y: y1, z: cz + Math.sin(a1) * radius },
        0,
        1,
        0,
        { u: 0.5, v: 0.5 },
        { u: 0.5 + Math.cos(a0) * 0.5, v: 0.5 + Math.sin(a0) * 0.5 },
        { u: 0.5 + Math.cos(a1) * 0.5, v: 0.5 + Math.sin(a1) * 0.5 },
        top,
      );
    }
  }

  addCone(cx: number, cy: number, cz: number, radius: number, height: number, segments: number, color: THREE.Color): void {
    const y1 = cy + height;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * radius;
      const z0 = cz + Math.sin(a0) * radius;
      const x1 = cx + Math.cos(a1) * radius;
      const z1 = cz + Math.sin(a1) * radius;
      const nx = Math.cos((a0 + a1) / 2);
      const nz = Math.sin((a0 + a1) / 2);
      const ny = radius / height;
      this.addTriangle(
        { x: x0, y: cy, z: z0 },
        { x: x1, y: cy, z: z1 },
        { x: cx, y: y1, z: cz },
        nx,
        ny,
        nz,
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 0.5, v: 1 },
        color,
      );
    }
  }

  addSphere(cx: number, cy: number, cz: number, radius: number, color: THREE.Color, segments = 10, rings = 6, scaleY = 1): void {
    for (let r = 0; r < rings; r++) {
      const v0 = r / rings;
      const v1 = (r + 1) / rings;
      const phi0 = v0 * Math.PI;
      const phi1 = v1 * Math.PI;
      for (let s = 0; s < segments; s++) {
        const u0 = s / segments;
        const u1 = (s + 1) / segments;
        const theta0 = u0 * Math.PI * 2;
        const theta1 = u1 * Math.PI * 2;
        const p = (phi: number, theta: number): V3 => ({
          x: cx + Math.sin(phi) * Math.cos(theta) * radius,
          y: cy + Math.cos(phi) * radius * scaleY,
          z: cz + Math.sin(phi) * Math.sin(theta) * radius,
        });
        const a = p(phi0, theta0);
        const b = p(phi1, theta0);
        const c = p(phi1, theta1);
        const d = p(phi0, theta1);
        const nx = Math.sin((phi0 + phi1) / 2) * Math.cos((theta0 + theta1) / 2);
        const ny = Math.cos((phi0 + phi1) / 2);
        const nz = Math.sin((phi0 + phi1) / 2) * Math.sin((theta0 + theta1) / 2);
        this.addQuad(a, b, c, d, nx, ny, nz, { u: u0, v: 1 - v0 }, { u: u0, v: 1 - v1 }, { u: u1, v: 1 - v1 }, { u: u1, v: 1 - v0 }, color);
      }
    }
  }

  addPlane(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sz: number,
    rotY: number,
    color: THREE.Color,
    uvScale = 4,
  ): void {
    const hx = sx / 2;
    const hz = sz / 2;
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const tr = (x: number, z: number): V3 => ({ x: cx + x * cos + z * sin, y: cy, z: cz - x * sin + z * cos });
    const ux = Math.max(1, Math.round(sx / uvScale));
    const uz = Math.max(1, Math.round(sz / uvScale));
    this.addQuad(
      tr(-hx, hz),
      tr(hx, hz),
      tr(hx, -hz),
      tr(-hx, -hz),
      0,
      1,
      0,
      { u: 0, v: 0 },
      { u: ux, v: 0 },
      { u: ux, v: uz },
      { u: 0, v: uz },
      color,
    );
  }

  build(): THREE.BufferGeometry | null {
    if (this.isEmpty) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.setIndex(this.indices);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }

  clear(): void {
    this.positions.length = 0;
    this.normals.length = 0;
    this.uvs.length = 0;
    this.colors.length = 0;
    this.indices.length = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Facade atlas UVs                                                    */
/* ------------------------------------------------------------------ */

export interface UVRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export function facadeCellRect(styleIndex: number, bay: number, floor: number): UVRect {
  const col = styleIndex % FACADE_ATLAS_COLS;
  const row = Math.floor(styleIndex / FACADE_ATLAS_COLS);
  const tileW = 1 / FACADE_ATLAS_COLS;
  const tileH = 1 / FACADE_ATLAS_ROWS;
  const cellW = tileW / 4;
  const cellH = tileH / 4;
  const u0 = col * tileW + (((bay % 4) + 4) % 4) * cellW;
  const v0 = 1 - (row + 1) * tileH + (3 - (((floor % 4) + 4) % 4)) * cellH;
  return { u0, v0, u1: u0 + cellW, v1: v0 + cellH };
}

/** Slight inset to prevent atlas bleeding. */
export function insetRect(r: UVRect, inset = 0.0012): UVRect {
  return { u0: r.u0 + inset, v0: r.v0 + inset, u1: r.u1 - inset, v1: r.v1 - inset };
}

/* ------------------------------------------------------------------ */
/* Rotation helpers                                                    */
/* ------------------------------------------------------------------ */

export function rotateXZ(x: number, z: number, angle: number): { x: number; z: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x * c + z * s, z: -x * s + z * c };
}

export function localToWorld(cx: number, cz: number, angle: number, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: cx + lx * c + lz * s, z: cz - lx * s + lz * c };
}
