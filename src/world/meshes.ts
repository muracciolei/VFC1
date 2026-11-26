/** Terrain, road and water mesh builders. */

import * as THREE from 'three';
import { clamp, clamp01, fbm2, lerp, noise2, smoothstep } from '../core/math';
import { Terrain } from './terrain';
import { RoadNetwork, RoadSegment } from './roadnetwork';
import { MaterialLibrary } from './materials';
import { MeshBuilder } from './geometry';

export interface TerrainMeshOptions {
  segments: number;
  highDetail: boolean;
}

/** Height of the asphalt slab above the road centreline elevation. */
export const ROAD_LIFT = 0.2;
/** Paint sits a hair above the asphalt so it never z-fights. */
const MARK_LIFT = 0.015;

const GRASS_DARK = new THREE.Color('#4d5f34');
const GRASS_LIGHT = new THREE.Color('#7c8a4d');
const GRASS_DRY = new THREE.Color('#96905c');
const ROCK = new THREE.Color('#8a8175');
const ROCK_DARK = new THREE.Color('#6d655b');
const SAND = new THREE.Color('#cbb98f');
const SNOW = new THREE.Color('#e4e2dc');
const URBAN = new THREE.Color('#8b8578');
const SEABED = new THREE.Color('#5a6553');

export function terrainColor(
  terrain: Terrain,
  x: number,
  z: number,
  h: number,
  slope: number,
  cityWeight: number,
): THREE.Color {
  const land = terrain.landDistance(x, z);
  const n = noise2(x * 0.02, z * 0.02, 33);
  const n2 = fbm2(x * 0.006, z * 0.006, 3, 2, 0.5, 71);
  const c = new THREE.Color();

  if (h < -0.4) {
    c.copy(SEABED).lerp(ROCK_DARK, clamp01(-h / 20));
    return c;
  }

  c.copy(GRASS_DARK).lerp(GRASS_LIGHT, n2);
  if (n > 0.62) c.lerp(GRASS_DRY, (n - 0.62) * 1.8);

  const sandT = 1 - smoothstep(1.2, 3.6, h) * 0.4;
  const coastT = 1 - smoothstep(10, 90, land);
  c.lerp(SAND, clamp01(Math.max(sandT * 0.35, coastT * 0.9)));

  const rockT = smoothstep(0.38, 0.72, slope);
  c.lerp(ROCK, rockT * 0.85);
  if (n > 0.55) c.lerp(ROCK_DARK, rockT * (n - 0.55) * 0.8);

  const snowT = smoothstep(150, 205, h) * (1 - smoothstep(0.85, 1.2, slope) * 0.6);
  c.lerp(SNOW, snowT);

  if (cityWeight > 0.25) {
    c.lerp(URBAN, cityWeight * 0.6);
  }

  // subtle per-vertex light variation
  const v = 0.94 + noise2(x * 0.09, z * 0.09, 12) * 0.12;
  c.multiplyScalar(v);
  return c;
}

export function buildTerrainChunk(
  terrain: Terrain,
  x0: number,
  z0: number,
  size: number,
  opts: TerrainMeshOptions,
): THREE.BufferGeometry {
  const seg = opts.segments;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const step = size / seg;
  const heights: number[] = [];

  for (let j = 0; j <= seg; j++) {
    for (let i = 0; i <= seg; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      const h = terrain.height(x, z);
      heights.push(h);
      positions.push(x, h, z);
      uvs.push(x / 7, z / 7);
      const e = 2.5;
      const slope = Math.hypot(
        terrain.height(x + e, z) - terrain.height(x - e, z),
        terrain.height(x, z + e) - terrain.height(x, z - e),
      ) / (2 * e);
      const city = terrain.cityWeightAt(x, z);
      const col = terrainColor(terrain, x, z, h, slope, city.weight);
      colors.push(col.r, col.g, col.b);
    }
  }

  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      const b = a + 1;
      const c = a + seg + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export function buildFarTerrain(terrain: Terrain, size: number, segments: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const step = size / segments;
  const half = size / 2;
  for (let j = 0; j <= segments; j++) {
    for (let i = 0; i <= segments; i++) {
      const x = -half + i * step;
      const z = -half + j * step;
      const h = terrain.height(x, z) - 0.55;
      positions.push(x, h, z);
      uvs.push(x / 10, z / 10);
      const e = 5;
      const slope = Math.hypot(
        terrain.height(x + e, z) - terrain.height(x - e, z),
        terrain.height(x, z + e) - terrain.height(x, z - e),
      ) / (2 * e);
      const city = terrain.cityWeightAt(x, z);
      const col = terrainColor(terrain, x, z, h, slope, city.weight);
      col.multiplyScalar(0.92);
      colors.push(col.r, col.g, col.b);
    }
  }
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/* ------------------------------------------------------------------ */
/* Roads                                                               */
/* ------------------------------------------------------------------ */

function roadQuad(
  builder: MeshBuilder,
  a: { x: number; z: number; y: number },
  b: { x: number; z: number; y: number },
  width: number,
  vStart: number,
  color: THREE.Color,
  lift = 0,
): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return vStart;
  const rx = (-dz / len) * width * 0.5;
  const rz = (dx / len) * width * 0.5;
  const vEnd = vStart + len / 8;
  const y0 = a.y + ROAD_LIFT + lift;
  const y1 = b.y + ROAD_LIFT + lift;
  builder.addQuad(
    { x: a.x - rx, y: y0, z: a.z - rz },
    { x: b.x - rx, y: y1, z: b.z - rz },
    { x: b.x + rx, y: y1, z: b.z + rz },
    { x: a.x + rx, y: y0, z: a.z + rz },
    0,
    1,
    0,
    { u: 0, v: vStart },
    { u: 0, v: vEnd },
    { u: 1, v: vEnd },
    { u: 1, v: vStart },
    color,
  );
  return vEnd;
}

function laneOffset(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  offset: number,
): { ox: number; oz: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  return { ox: (-dz / len) * offset, oz: (dx / len) * offset };
}

function addDash(
  builder: MeshBuilder,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y: number,
  color: THREE.Color,
): void {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  const nx = (-dz / len) * 0.09;
  const nz = (dx / len) * 0.09;
  builder.addQuad(
    { x: ax - nx, y, z: az - nz },
    { x: bx - nx, y, z: bz - nz },
    { x: bx + nx, y, z: bz + nz },
    { x: ax + nx, y, z: az + nz },
    0,
    1,
    0,
    { u: 0, v: 0 },
    { u: 0, v: 1 },
    { u: 1, v: 1 },
    { u: 1, v: 0 },
    color,
  );
}

export interface RoadMeshes {
  surface: THREE.Mesh;
  markings: THREE.Mesh;
  rail: THREE.Mesh | null;
}

export function buildRoadMeshes(roads: RoadNetwork, mats: MaterialLibrary): RoadMeshes {
  const surface = new MeshBuilder();
  const marks = new MeshBuilder();
  const rail = new MeshBuilder();
  const white = new THREE.Color('#d8d4c8');
  const asphaltColor = new THREE.Color('#ffffff');
  const metal = new THREE.Color('#6a6e70');

  for (const seg of roads.segments) {
    let v = 0;
    for (let i = 0; i < seg.points.length - 1; i++) {
      const a = { x: seg.points[i].x, z: seg.points[i].z, y: seg.ys[i] ?? 0 };
      const b = { x: seg.points[i + 1].x, z: seg.points[i + 1].z, y: seg.ys[i + 1] ?? 0 };
      v = roadQuad(surface, a, b, seg.width, v, asphaltColor);
    }
    // node patches hide seams at sharp corners
    for (const id of [seg.a, seg.b]) {
      const n = roads.nodes[id];
      const w = seg.width + 1.2;
      surface.addPlane(n.x, n.y + ROAD_LIFT + 0.003, n.z, w, w, 0, asphaltColor, 6);
    }

    // markings
    if (seg.roadClass === 'highway') {
      const laneW = seg.laneWidth;
      for (let i = 0; i < seg.points.length - 1; i++) {
        const a = seg.points[i];
        const b = seg.points[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.1) continue;
        const steps = Math.max(1, Math.floor(len / 7));
        for (let s = 0; s < steps; s++) {
          const t0 = s / steps;
          const t1 = Math.min(1, t0 + 0.45 / steps);
          const ax = lerp(a.x, b.x, t0);
          const az = lerp(a.z, b.z, t0);
          const bx = lerp(a.x, b.x, t1);
          const bz = lerp(a.z, b.z, t1);
          const y = lerp(seg.ys[i] ?? 0, seg.ys[i + 1] ?? 0, t0) + ROAD_LIFT + MARK_LIFT;
          for (const off of [-laneW * 0.5, laneW * 0.5]) {
            const o = laneOffset(ax, az, bx, bz, off);
            addDash(marks, ax + o.ox, az + o.oz, bx + o.ox, bz + o.oz, y, white);
          }
        }
        // solid edge lines
        for (const off of [-seg.width * 0.5 + 0.55, seg.width * 0.5 - 0.55]) {
          const o0 = laneOffset(a.x, a.z, b.x, b.z, off);
          const o1 = laneOffset(a.x, a.z, b.x, b.z, off);
          const y0 = (seg.ys[i] ?? 0) + ROAD_LIFT + MARK_LIFT;
          const y1 = (seg.ys[i + 1] ?? 0) + ROAD_LIFT + MARK_LIFT;
          marks.addQuad(
            { x: a.x + o0.ox - 0.06, y: y0, z: a.z + o0.oz },
            { x: b.x + o1.ox - 0.06, y: y1, z: b.z + o1.oz },
            { x: b.x + o1.ox + 0.06, y: y1, z: b.z + o1.oz },
            { x: a.x + o0.ox + 0.06, y: y0, z: a.z + o0.oz },
            0,
            1,
            0,
            { u: 0, v: 0 },
            { u: 0, v: 1 },
            { u: 1, v: 1 },
            { u: 1, v: 0 },
            white,
          );
        }
      }
    } else if (seg.roadClass !== 'alley') {
      for (let i = 0; i < seg.points.length - 1; i++) {
        const a = seg.points[i];
        const b = seg.points[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.1) continue;
        const steps = Math.max(1, Math.floor(len / 9));
        for (let s = 0; s < steps; s++) {
          const t0 = s / steps;
          const t1 = Math.min(1, t0 + 0.5 / steps);
          const ax = lerp(a.x, b.x, t0);
          const az = lerp(a.z, b.z, t0);
          const bx = lerp(a.x, b.x, t1);
          const bz = lerp(a.z, b.z, t1);
          const y = lerp(seg.ys[i] ?? 0, seg.ys[i + 1] ?? 0, t0) + ROAD_LIFT + MARK_LIFT;
          addDash(marks, ax, az, bx, bz, y, white);
        }
      }
    }

    // bridge rails and pillars
    if (seg.bridge) {
      for (const side of [-1, 1]) {
        for (let i = 0; i < seg.points.length - 1; i++) {
          const a = seg.points[i];
          const b = seg.points[i + 1];
          const o = laneOffset(a.x, a.z, b.x, b.z, side * (seg.width * 0.5 + 0.3));
          const y0 = (seg.ys[i] ?? 0) + 1.0;
          const y1 = (seg.ys[i + 1] ?? 0) + 1.0;
          rail.addBox((a.x + b.x) / 2 + o.ox, (y0 + y1) / 2, (a.z + b.z) / 2 + o.oz, 0.14, 0.14, Math.hypot(b.x - a.x, b.z - a.z) + 0.1, Math.atan2(b.x - a.x, b.z - a.z), metal, 2);
          rail.addBox(a.x + o.ox, (seg.ys[i] ?? 0) + 0.5, a.z + o.oz, 0.2, 1.0, 0.2, 0, metal, 1);
        }
      }
      const mid = Math.floor(seg.points.length / 2);
      const p = seg.points[mid];
      const y = seg.ys[mid] ?? 0;
      if (y > 2) {
        rail.addCylinder(p.x, -1, p.z, 1.1, y + 1, 8, new THREE.Color('#8a8f92'), new THREE.Color('#6a6e70'));
      }
    }
  }

  const surfaceGeo = surface.build();
  const marksGeo = marks.build();
  const railGeo = rail.build();
  if (!surfaceGeo) throw new Error('road surface empty');
  const surfaceMesh = new THREE.Mesh(surfaceGeo, mats.asphalt);
  surfaceMesh.receiveShadow = true;
  surfaceMesh.castShadow = false;
  surfaceMesh.matrixAutoUpdate = false;

  const marksMesh = new THREE.Mesh(marksGeo ?? new THREE.BufferGeometry(), mats.markings);
  marksMesh.receiveShadow = false;
  marksMesh.castShadow = false;
  marksMesh.matrixAutoUpdate = false;

  const railMesh = railGeo ? new THREE.Mesh(railGeo, mats.metal) : null;
  if (railMesh) {
    railMesh.castShadow = true;
    railMesh.receiveShadow = true;
    railMesh.matrixAutoUpdate = false;
  }
  return { surface: surfaceMesh, markings: marksMesh, rail: railMesh };
}

/* ------------------------------------------------------------------ */
/* Water                                                               */
/* ------------------------------------------------------------------ */

export function buildSea(mats: MaterialLibrary): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(16000, 16000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mats.water);
  mesh.position.y = 0.02;
  mesh.receiveShadow = false;
  mesh.renderOrder = 1;
  return mesh;
}

export function buildLake(mats: MaterialLibrary, x: number, z: number, radius: number, y: number): THREE.Mesh {
  const geo = new THREE.CircleGeometry(radius, 48);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mats.water);
  mesh.position.set(x, y + 0.02, z);
  mesh.renderOrder = 1;
  return mesh;
}
