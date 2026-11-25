/**
 * Road network: procedural city grids, inter-city highways and rural routes.
 * Provides lane-following links for traffic, A* navigation and terrain
 * flattening around asphalt.
 */

import {
  RNG,
  Vec2,
  clamp,
  clamp01,
  dist2D,
  lerp,
  pointSegmentDistanceSq,
  smoothPolyline,
} from '../core/math';
import {
  CITIES,
  CityDef,
  HIGHWAY_ROUTES,
  LAKE,
  POIS,
  WORLD,
  cityRng,
} from './config';
import { Terrain } from './terrain';

export type RoadClass = 'highway' | 'arterial' | 'street' | 'rural' | 'mountain' | 'alley';

export interface RoadNode {
  id: number;
  x: number;
  z: number;
  y: number;
  links: number[];
  cityId: string | null;
  perimeter: boolean;
  gridI?: number;
  gridJ?: number;
}

export interface RoadSegment {
  id: number;
  a: number;
  b: number;
  points: Vec2[];
  ys: number[];
  length: number;
  width: number;
  laneWidth: number;
  speedLimit: number;
  roadClass: RoadClass;
  cityId: string | null;
  oneway: boolean;
  bridge: boolean;
  name?: string;
}

export interface RoadLink {
  id: number;
  seg: number;
  from: number;
  to: number;
  forward: boolean;
  length: number;
}

export interface CityGrid {
  city: CityDef;
  spacing: number;
  n: number;
  nodes: Map<string, number>;
  blocks: CityBlock[];
  perimeterNodes: number[];
}

export interface CityBlock {
  i: number;
  j: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  angle: number;
  park: boolean;
  plaza: boolean;
  landmark: boolean;
  nodes: number[];
}

const CELL = 64;

export class RoadNetwork {
  nodes: RoadNode[] = [];
  segments: RoadSegment[] = [];
  links: RoadLink[] = [];
  cityGrids = new Map<string, CityGrid>();
  private nodeCells = new Map<string, number[]>();
  private segmentCells = new Map<string, number[]>();
  private terrain: Terrain;

  constructor(terrain: Terrain) {
    this.terrain = terrain;
  }

  /* -------------------------------------------------------------- */
  /* Construction                                                    */
  /* -------------------------------------------------------------- */

  build(): void {
    this.nodes = [];
    this.segments = [];
    this.links = [];
    this.cityGrids.clear();

    for (const city of CITIES) {
      this.buildCityGrid(city);
    }
    this.buildHighways();
    this.buildRuralRoutes();
    this.finalizeElevations();
    this.buildSpatialIndex();
    this.terrain.setRoadProvider(this);
  }

  private addNode(
    x: number,
    z: number,
    cityId: string | null,
    perimeter = false,
    gridI?: number,
    gridJ?: number,
  ): RoadNode {
    const node: RoadNode = {
      id: this.nodes.length,
      x,
      z,
      y: 0,
      links: [],
      cityId,
      perimeter,
      gridI,
      gridJ,
    };
    this.nodes.push(node);
    return node;
  }

  private addSegment(
    a: RoadNode,
    b: RoadNode,
    points: Vec2[],
    roadClass: RoadClass,
    width: number,
    speedLimit: number,
    cityId: string | null,
    oneway = false,
  ): RoadSegment {
    const seg: RoadSegment = {
      id: this.segments.length,
      a: a.id,
      b: b.id,
      points,
      ys: [],
      length: 0,
      width,
      laneWidth: Math.max(2.2, width * 0.22),
      speedLimit,
      roadClass,
      cityId,
      oneway,
      bridge: false,
    };
    let len = 0;
    for (let i = 1; i < points.length; i++) {
      len += dist2D(points[i - 1].x, points[i - 1].z, points[i].x, points[i].z);
    }
    seg.length = len;
    this.segments.push(seg);
    this.addLink(seg, a, b, true);
    if (!oneway) this.addLink(seg, b, a, false);
    return seg;
  }

  private addLink(seg: RoadSegment, from: RoadNode, to: RoadNode, forward: boolean): void {
    const link: RoadLink = {
      id: this.links.length,
      seg: seg.id,
      from: from.id,
      to: to.id,
      forward,
      length: seg.length,
    };
    this.links.push(link);
    from.links.push(link.id);
  }

  private buildCityGrid(city: CityDef): void {
    const rng = cityRng(city);
    const spacing = clamp(Math.round(city.radius * 0.3), 82, 112);
    const n = Math.ceil((city.radius * 0.94) / spacing);
    const cos = Math.cos(city.angle);
    const sin = Math.sin(city.angle);
    const nodes = new Map<string, number>();
    const blocks: CityBlock[] = [];
    const perimeterNodes: number[] = [];

    const local = (i: number, j: number): Vec2 => ({
      x: city.x + i * spacing * cos - j * spacing * sin,
      z: city.z + i * spacing * sin + j * spacing * cos,
    });

    const exists = (i: number, j: number): boolean => {
      const p = local(i, j);
      const d = Math.hypot(i * spacing, j * spacing);
      if (d > city.radius * 0.96) return false;
      const h = this.terrain.baseHeight(p.x, p.z);
      if (h < 0.55) return false;
      if (this.terrain.landDistance(p.x, p.z) < 4) return false;
      return true;
    };

    const nodeAt = (i: number, j: number): RoadNode | null => {
      const key = `${i},${j}`;
      const id = nodes.get(key);
      return id === undefined ? null : this.nodes[id];
    };

    // create nodes
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        if (!exists(i, j)) continue;
        const p = local(i, j);
        const perimeter = !exists(i - 1, j) || !exists(i + 1, j) || !exists(i, j - 1) || !exists(i, j + 1);
        const node = this.addNode(p.x, p.z, city.id, perimeter, i, j);
        nodes.set(`${i},${j}`, node.id);
        if (perimeter) perimeterNodes.push(node.id);
      }
    }

    const axisWidth = (i: number, j: number, dir: 'h' | 'v'): number => {
      const main = dir === 'h' ? j === 0 : i === 0;
      const perimeter = dir === 'h' ? !exists(i, j - 1) || !exists(i, j + 1) : !exists(i - 1, j) || !exists(i + 1, j);
      if (main) return 17;
      if (perimeter) return 13;
      return rng.chance(0.14) ? 12 : 9.5;
    };

    // connect edges
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const a = nodeAt(i, j);
        if (!a) continue;
        // horizontal
        const b = nodeAt(i + 1, j);
        if (b && b.id !== a.id) {
          const mid = local(i + 0.5, j);
          if (this.terrain.baseHeight(mid.x, mid.z) > 0.3) {
            this.addSegment(
              a,
              b,
              [{ x: a.x, z: a.z }, { x: b.x, z: b.z }],
              'street',
              axisWidth(i, j, 'h'),
              14,
              city.id,
            );
          }
        }
        // vertical
        const c = nodeAt(i, j + 1);
        if (c && c.id !== a.id) {
          const mid = local(i, j + 0.5);
          if (this.terrain.baseHeight(mid.x, mid.z) > 0.3) {
            this.addSegment(
              a,
              c,
              [{ x: a.x, z: a.z }, { x: c.x, z: c.z }],
              'street',
              axisWidth(i, j, 'v'),
              14,
              city.id,
            );
          }
        }
      }
    }

    // blocks (2x2 node cells)
    for (let j = -n; j < n; j++) {
      for (let i = -n; i < n; i++) {
        const a = nodeAt(i, j);
        const b = nodeAt(i + 1, j);
        const c = nodeAt(i, j + 1);
        const d = nodeAt(i + 1, j + 1);
        if (!a || !b || !c || !d) continue;
        const center = local(i + 0.5, j + 0.5);
        const distCenter = Math.hypot((i + 0.5) * spacing, (j + 0.5) * spacing);
        if (distCenter > city.radius * 0.9) continue;
        const h = this.terrain.baseHeight(center.x, center.z);
        if (h < 0.6) continue;
        const angle = city.angle;
        const parkChance = city.id === 'roma' ? 0.09 : 0.055;
        const park = rng.chance(parkChance);
        const plaza = rng.chance(0.035);
        blocks.push({
          i,
          j,
          x: center.x,
          z: center.z,
          width: spacing,
          depth: spacing,
          angle,
          park,
          plaza,
          landmark: false,
          nodes: [a.id, b.id, c.id, d.id],
        });
      }
    }

    this.cityGrids.set(city.id, { city, spacing, n, nodes, blocks, perimeterNodes });
  }

  private nearestPerimeterNode(city: CityDef, tx: number, tz: number): RoadNode | null {
    const grid = this.cityGrids.get(city.id);
    if (!grid) return null;
    let best: RoadNode | null = null;
    let bestScore = Infinity;
    for (const id of grid.perimeterNodes) {
      const node = this.nodes[id];
      const d = dist2D(node.x, node.z, tx, tz);
      if (d < bestScore) {
        bestScore = d;
        best = node;
      }
    }
    return best;
  }

  private buildHighways(): void {
    const rng = new RNG(WORLD.seed + 77);
    const done = new Set<string>();

    for (const route of HIGHWAY_ROUTES) {
      for (let r = 0; r < route.length - 1; r++) {
        const aCity = CITIES.find((c) => c.id === route[r]);
        const bCity = CITIES.find((c) => c.id === route[r + 1]);
        if (!aCity || !bCity) continue;
        const key = [aCity.id, bCity.id].sort().join('-');
        if (done.has(key)) continue;
        done.add(key);
        if (aCity.id === 'palermo' || bCity.id === 'palermo') continue;

        const a = this.nearestPerimeterNode(aCity, bCity.x, bCity.z);
        const b = this.nearestPerimeterNode(bCity, aCity.x, aCity.z);
        if (!a || !b) continue;

        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 10) continue;
        const nx = -dz / dist;
        const nz = dx / dist;
        const wobble = Math.min(180, dist * 0.18);
        const w1 = rng.range(-wobble, wobble);
        const w2 = rng.range(-wobble, wobble);
        const points: Vec2[] = [
          { x: a.x, z: a.z },
          { x: a.x + dx * 0.28 + nx * w1, z: a.z + dz * 0.28 + nz * w1 },
          { x: a.x + dx * 0.66 + nx * w2, z: a.z + dz * 0.66 + nz * w2 },
          { x: b.x, z: b.z },
        ];

        // avoid obvious water crossings by nudging midpoints toward land
        for (let attempt = 0; attempt < 3; attempt++) {
          let bad = false;
          for (let s = 1; s < points.length - 1; s++) {
            if (this.terrain.baseHeight(points[s].x, points[s].z) < 0.4) bad = true;
          }
          if (!bad) break;
          for (let s = 1; s < points.length - 1; s++) {
            points[s].x = lerp(points[s].x, (a.x + b.x) / 2, 0.3);
            points[s].z = lerp(points[s].z, (a.z + b.z) / 2, 0.3);
          }
        }

        const smooth = smoothPolyline(points, Math.max(4, Math.round(dist / 45)));
        const step = 34;
        const sampled: Vec2[] = [smooth[0]];
        let acc = 0;
        for (let i = 1; i < smooth.length; i++) {
          acc += dist2D(smooth[i - 1].x, smooth[i - 1].z, smooth[i].x, smooth[i].z);
          if (acc >= step) {
            sampled.push(smooth[i]);
            acc = 0;
          }
        }
        const last = smooth[smooth.length - 1];
        if (dist2D(sampled[sampled.length - 1].x, sampled[sampled.length - 1].z, last.x, last.z) > 4) {
          sampled.push(last);
        } else {
          sampled[sampled.length - 1] = last;
        }

        // first/last are the existing city nodes
        sampled[0] = { x: a.x, z: a.z };
        sampled[sampled.length - 1] = { x: b.x, z: b.z };

        let prevNode = a;
        for (let i = 1; i < sampled.length - 1; i++) {
          const p = sampled[i];
          if (dist2D(p.x, p.z, prevNode.x, prevNode.z) < 8) continue;
          const node = this.addNode(p.x, p.z, null);
          this.addSegment(
            prevNode,
            node,
            [{ x: prevNode.x, z: prevNode.z }, { x: node.x, z: node.z }],
            'highway',
            20,
            44,
            null,
          );
          prevNode = node;
        }
        const finalNode = b;
        if (prevNode.id !== finalNode.id) {
          this.addSegment(
            prevNode,
            finalNode,
            [{ x: prevNode.x, z: prevNode.z }, { x: finalNode.x, z: finalNode.z }],
            'highway',
            20,
            44,
            null,
          );
        }
      }
    }
  }

  private buildRuralRoutes(): void {
    const rng = new RNG(WORLD.seed + 311);
    const anchors: Array<{ x: number; z: number; city: string; kind: RoadClass }> = [
      { x: LAKE.x + LAKE.radius, z: LAKE.z + 40, city: 'milano', kind: 'mountain' },
      { x: 240, z: -2820, city: 'milano', kind: 'mountain' },
      { x: -420, z: 1210, city: 'napoli', kind: 'mountain' },
      { x: 300, z: 2680, city: 'palermo', kind: 'rural' },
      { x: -900, z: -2600, city: 'milano', kind: 'rural' },
      { x: 620, z: -30, city: 'roma', kind: 'rural' },
    ];

    for (const anchor of anchors) {
      const city = CITIES.find((c) => c.id === anchor.city);
      if (!city) continue;
      const start = this.nearestPerimeterNode(city, anchor.x, anchor.z);
      if (!start) continue;
      const dx = anchor.x - start.x;
      const dz = anchor.z - start.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 60) continue;
      const nx = -dz / dist;
      const nz = dx / dist;
      const w1 = rng.range(-dist * 0.14, dist * 0.14);
      const points: Vec2[] = [
        { x: start.x, z: start.z },
        { x: start.x + dx * 0.33 + nx * w1, z: start.z + dz * 0.33 + nz * w1 },
        { x: start.x + dx * 0.7 - nx * w1 * 0.5, z: start.z + dz * 0.7 - nz * w1 * 0.5 },
        { x: anchor.x, z: anchor.z },
      ];
      const smooth = smoothPolyline(points, Math.max(5, Math.round(dist / 40)));
      const step = 30;
      const sampled: Vec2[] = [smooth[0]];
      let acc = 0;
      for (let i = 1; i < smooth.length; i++) {
        acc += dist2D(smooth[i - 1].x, smooth[i - 1].z, smooth[i].x, smooth[i].z);
        if (acc >= step) {
          sampled.push(smooth[i]);
          acc = 0;
        }
      }
      sampled.push(smooth[smooth.length - 1]);

      let prev = start;
      for (let i = 1; i < sampled.length; i++) {
        const p = sampled[i];
        if (dist2D(p.x, p.z, prev.x, prev.z) < 6) continue;
        const node = this.addNode(p.x, p.z, null);
        this.addSegment(
          prev,
          node,
          [{ x: prev.x, z: prev.z }, { x: node.x, z: node.z }],
          anchor.kind,
          anchor.kind === 'mountain' ? 9 : 8,
          anchor.kind === 'mountain' ? 17 : 20,
          null,
        );
        prev = node;
      }
    }
  }

  private finalizeElevations(): void {
    // sample natural heights
    for (const node of this.nodes) {
      node.y = this.terrain.baseHeight(node.x, node.z);
    }
    // smooth highway/rural node elevations (keep city grids flat)
    for (let iter = 0; iter < 3; iter++) {
      const next = this.nodes.map((n) => n.y);
      for (const node of this.nodes) {
        if (node.cityId) continue;
        let sum = node.y;
        let count = 1;
        for (const linkId of node.links) {
          const link = this.links[linkId];
          const other = this.nodes[link.to];
          sum += other.y;
          count++;
        }
        next[node.id] = sum / count;
      }
      for (const node of this.nodes) node.y = next[node.id];
    }
    // roads over water become bridges
    for (const seg of this.segments) {
      const a = this.nodes[seg.a];
      const b = this.nodes[seg.b];
      const waterA = this.terrain.baseHeight(a.x, a.z) < 0.5;
      const waterB = this.terrain.baseHeight(b.x, b.z) < 0.5;
      if (waterA || waterB) {
        seg.bridge = true;
        a.y = Math.max(a.y, 6);
        b.y = Math.max(b.y, 6);
      }
    }
    // interpolate segment heights, blending interior sampled heights toward
    // the straight line between endpoint elevations for a smooth grade
    for (const seg of this.segments) {
      const a = this.nodes[seg.a];
      const b = this.nodes[seg.b];
      const ys: number[] = [];
      const lengths: number[] = [0];
      for (let i = 1; i < seg.points.length; i++) {
        lengths.push(lengths[i - 1] + dist2D(seg.points[i - 1].x, seg.points[i - 1].z, seg.points[i].x, seg.points[i].z));
      }
      const total = lengths[lengths.length - 1] || 1;
      for (let i = 0; i < seg.points.length; i++) {
        const t = lengths[i] / total;
        const linear = lerp(a.y, b.y, t);
        const natural = this.terrain.baseHeight(seg.points[i].x, seg.points[i].z);
        ys.push(lerp(linear, natural, 0.25));
      }
      ys[0] = a.y;
      ys[ys.length - 1] = b.y;
      if (seg.bridge) {
        for (let i = 0; i < ys.length; i++) ys[i] = Math.max(ys[i], 5.5);
      }
      seg.ys = ys;
    }
  }

  private buildSpatialIndex(): void {
    this.nodeCells.clear();
    this.segmentCells.clear();
    for (const node of this.nodes) {
      const key = this.cellKey(node.x, node.z);
      let arr = this.nodeCells.get(key);
      if (!arr) {
        arr = [];
        this.nodeCells.set(key, arr);
      }
      arr.push(node.id);
    }
    for (const seg of this.segments) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const p of seg.points) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
      const pad = seg.width * 0.5 + 5;
      const x0 = Math.floor((minX - pad) / CELL);
      const x1 = Math.floor((maxX + pad) / CELL);
      const z0 = Math.floor((minZ - pad) / CELL);
      const z1 = Math.floor((maxZ + pad) / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const key = `${cx},${cz}`;
          let arr = this.segmentCells.get(key);
          if (!arr) {
            arr = [];
            this.segmentCells.set(key, arr);
          }
          arr.push(seg.id);
        }
      }
    }
  }

  private cellKey(x: number, z: number): string {
    return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  }

  /* -------------------------------------------------------------- */
  /* Queries                                                         */
  /* -------------------------------------------------------------- */

  sampleRoadHeight(x: number, z: number): { height: number; weight: number; width: number } | null {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let best: { height: number; weight: number; width: number; dist: number } | null = null;

    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const arr = this.segmentCells.get(`${cx + ox},${cz + oz}`);
        if (!arr) continue;
        for (const id of arr) {
          const seg = this.segments[id];
          const pad = seg.width * 0.5 + 6;
          if (x < this.segMinX(seg) - pad || x > this.segMaxX(seg) + pad) continue;
          if (z < this.segMinZ(seg) - pad || z > this.segMaxZ(seg) + pad) continue;
          const hit = this.closestOnSegment(seg, x, z);
          if (!hit) continue;
          const half = seg.width * 0.5;
          if (hit.dist > half + 5) continue;
          const weight = 1 - clamp01((hit.dist - half * 0.55) / (half * 0.45 + 5));
          if (!best || hit.dist < best.dist) {
            best = { height: hit.y, weight, width: seg.width, dist: hit.dist };
          }
        }
      }
    }
    if (!best) return null;
    return { height: best.height, weight: clamp01(best.weight * 1.15), width: best.width };
  }

  private segMinX(seg: RoadSegment): number {
    let v = Infinity;
    for (const p of seg.points) v = Math.min(v, p.x);
    return v;
  }
  private segMaxX(seg: RoadSegment): number {
    let v = -Infinity;
    for (const p of seg.points) v = Math.max(v, p.x);
    return v;
  }
  private segMinZ(seg: RoadSegment): number {
    let v = Infinity;
    for (const p of seg.points) v = Math.min(v, p.z);
    return v;
  }
  private segMaxZ(seg: RoadSegment): number {
    let v = -Infinity;
    for (const p of seg.points) v = Math.max(v, p.z);
    return v;
  }

  private closestOnSegment(
    seg: RoadSegment,
    x: number,
    z: number,
  ): { x: number; z: number; y: number; dist: number; t: number } | null {
    let best: { x: number; z: number; y: number; dist: number; t: number } | null = null;
    for (let i = 0; i < seg.points.length - 1; i++) {
      const a = seg.points[i];
      const b = seg.points[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const denom = abx * abx + abz * abz;
      let t = denom > 1e-9 ? ((x - a.x) * abx + (z - a.z) * abz) / denom : 0;
      t = clamp01(t);
      const px = a.x + abx * t;
      const pz = a.z + abz * t;
      const d = Math.hypot(x - px, z - pz);
      if (!best || d < best.dist) {
        best = {
          x: px,
          z: pz,
          y: lerp(seg.ys[i] ?? 0, seg.ys[i + 1] ?? 0, t),
          dist: d,
          t,
        };
      }
    }
    return best;
  }

  getLinkPoints(link: RoadLink): Vec2[] {
    const seg = this.segments[link.seg];
    if (link.forward) return seg.points;
    return [...seg.points].reverse();
  }

  getLinkYs(link: RoadLink): number[] {
    const seg = this.segments[link.seg];
    if (link.forward) return seg.ys;
    return [...seg.ys].reverse();
  }

  nearestNode(x: number, z: number, maxDist = 400): RoadNode | null {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const range = Math.ceil(maxDist / CELL);
    let best: RoadNode | null = null;
    let bestD = maxDist * maxDist;
    for (let ox = -range; ox <= range; ox++) {
      for (let oz = -range; oz <= range; oz++) {
        const arr = this.nodeCells.get(`${cx + ox},${cz + oz}`);
        if (!arr) continue;
        for (const id of arr) {
          const node = this.nodes[id];
          const d = (node.x - x) ** 2 + (node.z - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = node;
          }
        }
      }
    }
    return best;
  }

  /** Random drivable link near a position, preferring the given radius. */
  randomLinkNear(x: number, z: number, minR = 60, maxR = 260, rng = Math.random): RoadLink | null {
    const candidates: RoadLink[] = [];
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const range = Math.ceil(maxR / CELL);
    const seen = new Set<number>();
    for (let ox = -range; ox <= range; ox++) {
      for (let oz = -range; oz <= range; oz++) {
        const arr = this.segmentCells.get(`${cx + ox},${cz + oz}`);
        if (!arr) continue;
        for (const segId of arr) {
          if (seen.has(segId)) continue;
          seen.add(segId);
          const seg = this.segments[segId];
          if (seg.bridge) continue;
          const mid = seg.points[Math.floor(seg.points.length / 2)];
          const d = dist2D(x, z, mid.x, mid.z);
          if (d < minR || d > maxR) continue;
          for (const linkId of this.nodes[seg.a].links) {
            const link = this.links[linkId];
            if (link.seg === segId) {
              candidates.push(link);
              break;
            }
          }
        }
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(rng() * candidates.length)];
  }

  randomNodeNear(x: number, z: number, minR: number, maxR: number, rng = Math.random): RoadNode | null {
    const candidates: RoadNode[] = [];
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const range = Math.ceil(maxR / CELL);
    const seen = new Set<number>();
    for (let ox = -range; ox <= range; ox++) {
      for (let oz = -range; oz <= range; oz++) {
        const arr = this.nodeCells.get(`${cx + ox},${cz + oz}`);
        if (!arr) continue;
        for (const id of arr) {
          if (seen.has(id)) continue;
          seen.add(id);
          const node = this.nodes[id];
          const d = dist2D(x, z, node.x, node.z);
          if (d >= minR && d <= maxR && node.links.length > 0) candidates.push(node);
        }
      }
    }
    if (!candidates.length) return null;
    return candidates[Math.floor(rng() * candidates.length)];
  }

  /** Find a link at a node that continues a path, avoiding immediate U-turns. */
  chooseNextLink(node: RoadNode, cameFromLink: RoadLink | null, rng = Math.random): RoadLink | null {
    const options = node.links.map((id) => this.links[id]).filter((l) => l.from === node.id);
    if (options.length === 0) return null;
    if (options.length === 1) return options[0];
    let filtered = options;
    if (cameFromLink) {
      const incomingSeg = cameFromLink.seg;
      const noUturn = options.filter((l) => l.seg !== incomingSeg);
      if (noUturn.length > 0) filtered = noUturn;
    }
    // prefer straighter continuation
    const weights = filtered.map((l) => {
      if (!cameFromLink) return 1;
      const inPts = this.getLinkPoints(cameFromLink);
      const outPts = this.getLinkPoints(l);
      const a = inPts[Math.max(0, inPts.length - 2)];
      const b = inPts[inPts.length - 1];
      const c = outPts[Math.min(1, outPts.length - 1)];
      const inDir = Math.atan2(b.x - a.x, b.z - a.z);
      const outDir = Math.atan2(c.x - b.x, c.z - b.z);
      let diff = Math.abs(((outDir - inDir + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      return 0.2 + Math.cos(diff) * 0.8;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (let i = 0; i < filtered.length; i++) {
      r -= weights[i];
      if (r <= 0) return filtered[i];
    }
    return filtered[filtered.length - 1];
  }

  /* -------------------------------------------------------------- */
  /* Navigation (A*)                                                 */
  /* -------------------------------------------------------------- */

  findPath(fromX: number, fromZ: number, toX: number, toZ: number): Vec2[] | null {
    const start = this.nearestNode(fromX, fromZ, 500);
    const goal = this.nearestNode(toX, toZ, 700);
    if (!start || !goal) return null;
    if (start.id === goal.id) return [{ x: start.x, z: start.z }, { x: goal.x, z: goal.z }];

    const nodeCount = this.nodes.length;
    const gScore = new Float64Array(nodeCount).fill(Infinity);
    const fScore = new Float64Array(nodeCount).fill(Infinity);
    const cameFrom = new Int32Array(nodeCount).fill(-1);
    const closed = new Uint8Array(nodeCount);
    const open: number[] = [start.id];
    const inOpen = new Uint8Array(nodeCount);
    gScore[start.id] = 0;
    fScore[start.id] = this.heuristic(start.id, goal.id);
    inOpen[start.id] = 1;

    while (open.length > 0) {
      // pick lowest f (small network, linear scan is acceptable)
      let bestIdx = 0;
      let bestF = Infinity;
      for (let i = 0; i < open.length; i++) {
        const f = fScore[open[i]];
        if (f < bestF) {
          bestF = f;
          bestIdx = i;
        }
      }
      const currentId = open.splice(bestIdx, 1)[0];
      inOpen[currentId] = 0;
      if (currentId === goal.id) {
        const path: Vec2[] = [];
        let cur = currentId;
        const nodeIds: number[] = [];
        while (cur !== -1) {
          nodeIds.push(cur);
          cur = cameFrom[cur];
        }
        nodeIds.reverse();
        for (let i = 0; i < nodeIds.length - 1; i++) {
          const link = this.findLinkBetween(nodeIds[i], nodeIds[i + 1]);
          if (!link) continue;
          const pts = this.getLinkPoints(link);
          for (let p = 0; p < pts.length - 1; p++) path.push(pts[p]);
        }
        const last = this.nodes[goal.id];
        path.push({ x: last.x, z: last.z });
        return path;
      }
      closed[currentId] = 1;
      const node = this.nodes[currentId];
      for (const linkId of node.links) {
        const link = this.links[linkId];
        if (link.from !== currentId) continue;
        if (closed[link.to]) continue;
        const seg = this.segments[link.seg];
        const cost = seg.length / Math.max(6, seg.speedLimit);
        const tentative = gScore[currentId] + cost;
        if (tentative < gScore[link.to]) {
          cameFrom[link.to] = currentId;
          gScore[link.to] = tentative;
          fScore[link.to] = tentative + this.heuristic(link.to, goal.id);
          if (!inOpen[link.to]) {
            open.push(link.to);
            inOpen[link.to] = 1;
          }
        }
      }
    }
    return null;
  }

  private findLinkBetween(fromId: number, toId: number): RoadLink | null {
    for (const linkId of this.nodes[fromId].links) {
      const link = this.links[linkId];
      if (link.from === fromId && link.to === toId) return link;
    }
    return null;
  }

  private heuristic(a: number, b: number): number {
    const na = this.nodes[a];
    const nb = this.nodes[b];
    return Math.hypot(na.x - nb.x, na.z - nb.z) / 40;
  }

  /* -------------------------------------------------------------- */
  /* Map rendering helpers                                           */
  /* -------------------------------------------------------------- */

  forEachSegment(fn: (seg: RoadSegment) => void): void {
    for (const seg of this.segments) fn(seg);
  }

  /** Returns road segments within a world-space rectangle (for minimap). */
  segmentsInRect(minX: number, minZ: number, maxX: number, maxZ: number, out: RoadSegment[]): void {
    out.length = 0;
    const seen = new Set<number>();
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL);
    const z1 = Math.floor(maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.segmentCells.get(`${cx},${cz}`);
        if (!arr) continue;
        for (const id of arr) {
          if (seen.has(id)) continue;
          seen.add(id);
          const seg = this.segments[id];
          if (this.segMaxX(seg) < minX || this.segMinX(seg) > maxX) continue;
          if (this.segMaxZ(seg) < minZ || this.segMinZ(seg) > maxZ) continue;
          out.push(seg);
        }
      }
    }
  }

  get cityCount(): number {
    return this.cityGrids.size;
  }

  get pois(): typeof POIS {
    return POIS;
  }
}
