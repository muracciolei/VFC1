/**
 * Procedural terrain for Mini Italia: coastline, hills, Alps, Apennines,
 * volcanoes, the lake and flattened city basins. Road flattening is layered
 * on top via a provider registered by the road network.
 */

import {
  Vec2,
  clamp,
  clamp01,
  dist2D,
  fbm2,
  lerp,
  noise2,
  pointSegmentDistanceSq,
  polygonSignedDistance,
  ridged2,
  smoothstep,
} from '../core/math';
import {
  CITIES,
  CityDef,
  LAKE,
  LAND_MASSES,
  MAINLAND,
  MOUNTAIN_RIDGES,
  SICILY,
  VOLCANOES,
  WORLD,
} from './config';

export interface RoadHeightProvider {
  /** Returns road elevation and influence (0..1) at a world position, or null. */
  sampleRoadHeight(x: number, z: number): { height: number; weight: number; width: number } | null;
}

export interface TerrainSample {
  height: number;
  water: boolean;
  slope: number;
  city: CityDef | null;
  cityWeight: number;
}

const MAINLAND_BOUNDS = { minX: -1800, maxX: 1900, minZ: -3250, maxZ: 1650 };
const SICILY_BOUNDS = { minX: -700, maxX: 650, minZ: 2000, maxZ: 3000 };

export class Terrain {
  private roadProvider: RoadHeightProvider | null = null;
  private cityBase = new Map<string, number>();
  private initialized = false;

  constructor() {
    this.initCities();
  }

  private initCities(): void {
    for (const city of CITIES) {
      const raw = this.rawHeight(city.x, city.z);
      const base = clamp(raw, 2.2, 55);
      city.baseHeight = base;
      this.cityBase.set(city.id, base);
    }
    this.initialized = true;
  }

  setRoadProvider(provider: RoadHeightProvider): void {
    this.roadProvider = provider;
  }

  /* -------------------------------------------------------------- */
  /* Raw natural terrain                                             */
  /* -------------------------------------------------------------- */

  /** Land signed distance (positive inside) using a cheap bounds test. */
  landDistance(x: number, z: number): number {
    let best = -Infinity;
    if (
      x >= MAINLAND_BOUNDS.minX &&
      x <= MAINLAND_BOUNDS.maxX &&
      z >= MAINLAND_BOUNDS.minZ &&
      z <= MAINLAND_BOUNDS.maxZ
    ) {
      best = Math.max(best, polygonSignedDistance(x, z, MAINLAND));
    }
    if (
      x >= SICILY_BOUNDS.minX &&
      x <= SICILY_BOUNDS.maxX &&
      z >= SICILY_BOUNDS.minZ &&
      z <= SICILY_BOUNDS.maxZ
    ) {
      best = Math.max(best, polygonSignedDistance(x, z, SICILY));
    }
    if (best === -Infinity) {
      // approximate negative distance to the nearest landmass bbox
      const dx = Math.max(MAINLAND_BOUNDS.minX - x, x - MAINLAND_BOUNDS.maxX, 0);
      const dz = Math.max(MAINLAND_BOUNDS.minZ - z, z - MAINLAND_BOUNDS.maxZ, 0);
      const dxs = Math.max(SICILY_BOUNDS.minX - x, x - SICILY_BOUNDS.maxX, 0);
      const dzs = Math.max(SICILY_BOUNDS.minZ - z, z - SICILY_BOUNDS.maxZ, 0);
      best = -Math.min(Math.hypot(dx, dz), Math.hypot(dxs, dzs)) - 10;
    }
    return best;
  }

  isLand(x: number, z: number): boolean {
    return this.landDistance(x, z) > 0;
  }

  /** Natural height before cities and roads. */
  rawHeight(x: number, z: number): number {
    const sdf = this.landDistance(x, z);

    // rolling countryside
    const broad = fbm2(x * 0.00085, z * 0.00085, 4, 2.0, 0.55, 11);
    const detail = fbm2(x * 0.0042, z * 0.0042, 3, 2.0, 0.5, 27);
    const inland = smoothstep(20, 320, sdf);
    let h = 1.0 + broad * 30 * (0.35 + inland * 0.65) + detail * 2.4 * inland;

    // mountain ridges
    for (let i = 0; i < MOUNTAIN_RIDGES.length; i++) {
      const ridge = MOUNTAIN_RIDGES[i];
      let d = Infinity;
      for (let j = 0; j < ridge.points.length - 1; j++) {
        const a = ridge.points[j];
        const b = ridge.points[j + 1];
        const dd = pointSegmentDistanceSq(x, z, a.x, a.z, b.x, b.z);
        if (dd < d) d = dd;
      }
      const dist = Math.sqrt(d);
      if (dist < ridge.width * 1.4) {
        const falloff = 1 - smoothstep(0, ridge.width, dist);
        const crest = ridged2(x * 0.0019, z * 0.0019, 5, 41 + i * 17);
        const jag = fbm2(x * 0.008, z * 0.008, 3, 2, 0.5, 63 + i) * 0.35;
        h += ridge.height * falloff * falloff * (0.45 + crest * 0.75 + jag);
      }
    }

    // volcanoes
    for (const v of VOLCANOES) {
      const d = dist2D(x, z, v.x, v.z);
      if (d < v.radius * 1.5) {
        const t = 1 - smoothstep(v.radius * 0.18, v.radius, d);
        const crater = 1 - smoothstep(0, v.radius * 0.16, d);
        h += v.height * t * t * (1 - crater * 0.55);
      }
    }

    // coastline shelf
    if (sdf < 0) {
      const depth = smoothstep(0, 220, -sdf);
      return lerp(-0.6, -26, depth);
    }
    h = Math.max(h, 0.4);
    const beach = smoothstep(0, 55, sdf);
    h = lerp(0.35, h, beach);

    // Alpine snow line lift (kept gentle so cities stay low)
    return h;
  }

  /* -------------------------------------------------------------- */
  /* Cities                                                          */
  /* -------------------------------------------------------------- */

  cityWeightAt(x: number, z: number): { city: CityDef | null; weight: number } {
    let bestCity: CityDef | null = null;
    let bestWeight = 0;
    for (const city of CITIES) {
      const d = dist2D(x, z, city.x, city.z);
      if (d > city.radius * 1.5) continue;
      const w = 1 - smoothstep(city.radius * 0.62, city.radius * 1.28, d);
      if (w > bestWeight) {
        bestWeight = w;
        bestCity = city;
      }
    }
    return { city: bestCity, weight: bestWeight };
  }

  /** Height including city flattening, before roads. */
  baseHeight(x: number, z: number): number {
    let h = this.rawHeight(x, z);
    const { city, weight } = this.cityWeightAt(x, z);
    if (city && weight > 0) {
      const base = this.cityBase.get(city.id) ?? city.baseHeight;
      const landMask = smoothstep(-14, 8, this.landDistance(x, z));
      const target = base + noise2(x * 0.012, z * 0.012, 91) * 0.7;
      h = lerp(h, target, weight * 0.92 * landMask);
    }

    // Lake Como basin
    const lakeD = dist2D(x, z, LAKE.x, LAKE.z);
    if (lakeD < LAKE.radius * 1.5) {
      const shore = 1 - smoothstep(LAKE.radius * 0.72, LAKE.radius * 1.22, lakeD);
      const bed = LAKE.waterLevel - 9 - (1 - clamp01(lakeD / LAKE.radius)) * 6;
      h = lerp(h, Math.min(h, bed), shore * 0.96);
    }
    return h;
  }

  /* -------------------------------------------------------------- */
  /* Final height with roads                                         */
  /* -------------------------------------------------------------- */

  height(x: number, z: number): number {
    let h = this.baseHeight(x, z);
    if (this.roadProvider) {
      const road = this.roadProvider.sampleRoadHeight(x, z);
      if (road && road.weight > 0) {
        const w = clamp01(road.weight);
        h = lerp(h, road.height, w * 0.94);
      }
    }
    return h;
  }

  sample(x: number, z: number): TerrainSample {
    const height = this.height(x, z);
    const { city, weight } = this.cityWeightAt(x, z);
    const e = 2.5;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    const slope = Math.hypot(hx, hz) / (2 * e);
    return {
      height,
      water: height < WORLD.seaLevel + 0.15,
      slope,
      city,
      cityWeight: weight,
    };
  }

  normal(x: number, z: number, out?: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const e = 2.0;
    const hl = this.height(x - e, z);
    const hr = this.height(x + e, z);
    const hd = this.height(x, z - e);
    const hu = this.height(x, z + e);
    const nx = hl - hr;
    const ny = 2 * e;
    const nz = hd - hu;
    const len = Math.hypot(nx, ny, nz) || 1;
    const res = out ?? { x: 0, y: 1, z: 0 };
    res.x = nx / len;
    res.y = ny / len;
    res.z = nz / len;
    return res;
  }

  /** Approximate slope 0..1 (0 flat). */
  slopeAt(x: number, z: number): number {
    const e = 2.5;
    const dx = this.height(x + e, z) - this.height(x - e, z);
    const dz = this.height(x, z + e) - this.height(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  /** Convenience: distance to the sea (positive inland). */
  distanceToSea(x: number, z: number): number {
    return this.landDistance(x, z);
  }

  /** True if a point is inside the built-up city footprint. */
  inCity(x: number, z: number, scale = 1): CityDef | null {
    for (const c of CITIES) {
      if (dist2D(x, z, c.x, c.z) < c.radius * scale) return c;
    }
    return null;
  }

  /** The world land polygons, for the map renderer. */
  get landMasses(): Vec2[][] {
    return LAND_MASSES;
  }

  get initializedFlag(): boolean {
    return this.initialized;
  }
}
