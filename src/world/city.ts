/**
 * Procedural city & countryside geometry.
 * Buildings use a facade atlas, one merged mesh per chunk per material.
 */

import * as THREE from 'three';
import { RNG, clamp, dist2D, lerp, smoothstep } from '../core/math';
import { settings } from '../core/settings';
import {
  CITIES,
  CityDef,
  CityStyle,
  LAKE,
} from './config';
import { CityBlock as Block, CityGrid, RoadNetwork } from './roadnetwork';
import { CollisionWorld } from './collision';
import { MaterialLibrary } from './materials';
import { MeshBuilder, facadeCellRect, insetRect, localToWorld, V3 } from './geometry';
import { FACADE_STYLES, FacadeStyle } from './textures';
import { Terrain } from './terrain';

const STYLE_INDEX = new Map<FacadeStyle, number>(FACADE_STYLES.map((s, i) => [s, i]));

const CITY_FACADES: Record<CityStyle, FacadeStyle[]> = {
  milano: ['classic', 'modern', 'ornate', 'modern', 'barocco'],
  roma: ['ornate', 'classic', 'brick', 'classic', 'medieval', 'barocco'],
  napoli: ['classic', 'coastal', 'ornate', 'classic', 'barocco'],
  torino: ['classic', 'ornate', 'modern', 'barocco'],
  firenze: ['ornate', 'classic', 'brick', 'medieval', 'barocco'],
  venezia: ['coastal', 'ornate', 'classic', 'medieval'],
  bologna: ['brick', 'classic', 'ornate', 'medieval'],
  genova: ['classic', 'coastal', 'brick', 'medieval'],
  palermo: ['coastal', 'ornate', 'classic', 'barocco'],
  bari: ['coastal', 'classic', 'modern', 'medieval'],
};

interface BuildCtx {
  facade: MeshBuilder;
  roof: MeshBuilder;
  shop: MeshBuilder;
  paving: MeshBuilder;
  props: MeshBuilder;
  glow: MeshBuilder;
  ground: MeshBuilder;
  pool: MeshBuilder;
  owner: string;
  detail: number;
}

/**
 * Low preset: flower boxes, AC units and balcony plants are pure decoration
 * baked into the chunk meshes, so they are skipped while the city is generated.
 * Evaluated at build time (not import time) because the preset is applied by
 * main.ts after module loading and before World.build().
 */
function lowDetail(): boolean {
  return settings.value.quality === 'low';
}

const C = (hex: string): THREE.Color => new THREE.Color(hex);

const COLORS = {
  curb: C('#b8b2a6'),
  curbDark: C('#8f897d'),
  stone: C('#c9c0ae'),
  stoneLight: C('#ddd4c1'),
  darkStone: C('#8a8172'),
  metal: C('#5d6164'),
  darkMetal: C('#33373a'),
  wood: C('#6b4a2e'),
  woodLight: C('#9a6b43'),
  leaf: C('#3f5a2c'),
  leafLight: C('#587a3c'),
  leafDark: C('#2c4320'),
  cypress: C('#2f4a2a'),
  palm: C('#4e6b30'),
  olive: C('#7d8a63'),
  trunk: C('#5b4631'),
  white: C('#e8e2d6'),
  marble: C('#e9e3d7'),
  travertine: C('#c9a878'),
  brick: C('#a9684a'),
  brickDark: C('#8d5238'),
  roofGrey: C('#8a8f92'),
  terracotta: C('#b86a49'),
  water: C('#2f6b74'),
  accent: C('#b04a35'),
  green: C('#4f7a44'),
  red: C('#a83a2c'),
  blue: C('#3a5f80'),
  cream: C('#e6d9b8'),
  yellow: C('#c9a34a'),
  black: C('#1d1f21'),
};

function rngForBlock(city: CityDef, block: Block): RNG {
  let h = 2166136261;
  const key = `${city.id}:${block.i}:${block.j}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return new RNG(h >>> 0);
}

function vary(color: THREE.Color, rng: RNG, amount = 0.08): THREE.Color {
  const k = 1 + rng.range(-amount, amount);
  return new THREE.Color(color.r * k, color.g * k, color.b * k);
}

function shade(color: THREE.Color, k: number): THREE.Color {
  return new THREE.Color(color.r * k, color.g * k, color.b * k);
}

export class CityBuilder {
  private terrain: Terrain;
  private roads: RoadNetwork;
  private mats: MaterialLibrary;
  private collision: CollisionWorld;
  private landmarkKeys = new Map<string, Set<string>>();
  private landmarkCenters = new Map<string, string>();
  private gridByCity = new Map<string, CityGrid>();

  constructor(terrain: Terrain, roads: RoadNetwork, mats: MaterialLibrary, collision: CollisionWorld) {
    this.terrain = terrain;
    this.roads = roads;
    this.mats = mats;
    this.collision = collision;
    this.prepare();
  }

  /**
   * Cache city grids and landmark blocks. Must be called after RoadNetwork.build(),
   * which fills roads.cityGrids; the constructor call is a harmless no-op until then.
   */
  prepare(): void {
    this.gridByCity.clear();
    this.landmarkKeys.clear();
    this.landmarkCenters.clear();
    for (const city of CITIES) {
      const grid = this.roads.cityGrids.get(city.id);
      if (!grid) continue;
      this.gridByCity.set(city.id, grid);
      let best: Block | null = null;
      let bestD = Infinity;
      for (const b of grid.blocks) {
        const d = dist2D(b.x, b.z, city.x, city.z);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      const keys = new Set<string>();
      if (best) {
        keys.add(`${best.i},${best.j}`);
        this.landmarkCenters.set(city.id, `${best.i},${best.j}`);
        // clear the immediately adjacent blocks for a proper piazza
        keys.add(`${best.i + 1},${best.j}`);
        keys.add(`${best.i - 1},${best.j}`);
        keys.add(`${best.i},${best.j + 1}`);
        keys.add(`${best.i},${best.j - 1}`);
      }
      this.landmarkKeys.set(city.id, keys);
    }
  }

  /* -------------------------------------------------------------- */
  /* Standalone chunk / sector builders                              */
  /* -------------------------------------------------------------- */

  buildRuralChunk(cx: number, cz: number, size: number, detail: number): THREE.Group | null {
    const ctx = this.newCtx(`${cx},${cz}`, detail);
    this.buildRural(ctx, cx, cz, size, detail);
    return this.finalize(ctx);
  }

  buildCitySector(city: CityDef, sector: number, detail: number): THREE.Group | null {
    const grid = this.gridByCity.get(city.id);
    if (!grid) return null;
    const ctx = this.newCtx(`city:${city.id}:${sector}`, detail);
    const landmark = this.landmarkKeys.get(city.id);
    const landmarkCenter = this.landmarkCenters.get(city.id);
    for (const block of grid.blocks) {
      const sx = block.x < city.x ? 0 : 1;
      const sz = block.z < city.z ? 0 : 1;
      const s = sz * 2 + sx;
      if (s !== sector) continue;
      if (landmark?.has(`${block.i},${block.j}`)) {
        if (landmarkCenter === `${block.i},${block.j}`) {
          this.buildLandmarkBlock(ctx, city, block);
        } else {
          this.buildPlaza(ctx, city, block, this.terrain.height(block.x, block.z) + 0.16, rngForBlock(city, block));
        }
      } else {
        this.buildBlock(ctx, city, block, detail);
      }
    }
    return this.finalize(ctx);
  }

  private newCtx(owner: string, detail: number): BuildCtx {
    return {
      facade: new MeshBuilder(),
      roof: new MeshBuilder(),
      shop: new MeshBuilder(),
      paving: new MeshBuilder(),
      props: new MeshBuilder(),
      glow: new MeshBuilder(),
      ground: new MeshBuilder(),
      pool: new MeshBuilder(),
      owner,
      detail,
    };
  }

  /* -------------------------------------------------------------- */
  /* Chunk build                                                     */
  /* -------------------------------------------------------------- */

  buildChunk(cx: number, cz: number, size: number, detail: number): THREE.Group | null {
    const x0 = cx * size;
    const z0 = cz * size;
    const x1 = x0 + size;
    const z1 = z0 + size;
    const ctx: BuildCtx = {
      facade: new MeshBuilder(),
      roof: new MeshBuilder(),
      shop: new MeshBuilder(),
      paving: new MeshBuilder(),
      props: new MeshBuilder(),
      glow: new MeshBuilder(),
      ground: new MeshBuilder(),
      pool: new MeshBuilder(),
      owner: `${cx},${cz}`,
      detail,
    };

    let anyCity = false;
    for (const city of CITIES) {
      if (x1 < city.x - city.radius * 1.6 || x0 > city.x + city.radius * 1.6) continue;
      if (z1 < city.z - city.radius * 1.6 || z0 > city.z + city.radius * 1.6) continue;
      const grid = this.gridByCity.get(city.id);
      if (!grid) continue;
      const landmark = this.landmarkKeys.get(city.id);
      const landmarkCenter = this.landmarkCenters.get(city.id);
      for (const block of grid.blocks) {
        if (block.x < x0 || block.x >= x1 || block.z < z0 || block.z >= z1) continue;
        anyCity = true;
        if (landmark?.has(`${block.i},${block.j}`)) {
          if (landmarkCenter === `${block.i},${block.j}`) {
            this.buildLandmarkBlock(ctx, city, block);
          } else {
            this.buildPlaza(ctx, city, block, this.terrain.height(block.x, block.z) + 0.16, rngForBlock(city, block));
          }
        } else {
          this.buildBlock(ctx, city, block, detail);
        }
      }
    }

    if (!anyCity) {
      this.buildRural(ctx, cx, cz, size, detail);
    } else if (detail === 0) {
      // a little countryside on the outskirts
      this.buildRural(ctx, cx, cz, size, detail, true);
    }

    return this.finalize(ctx);
  }

  private finalize(ctx: BuildCtx): THREE.Group | null {
    const group = new THREE.Group();
    const add = (builder: MeshBuilder, material: THREE.Material, shadows = true): void => {
      const geo = builder.build();
      if (!geo) return;
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    };
    add(ctx.facade, this.mats.facade);
    add(ctx.roof, this.mats.roof);
    add(ctx.shop, this.mats.shopfront);
    add(ctx.paving, this.mats.sidewalk, false);
    add(ctx.ground, this.mats.terrain, false);
    add(ctx.props, this.mats.props);
    add(ctx.glow, this.mats.glow, false);
    add(ctx.pool, this.mats.lightPool, false);
    if (group.children.length === 0) return null;
    group.userData.owner = ctx.owner;
    return group;
  }

  /* -------------------------------------------------------------- */
  /* Blocks                                                          */
  /* -------------------------------------------------------------- */

  private buildBlock(ctx: BuildCtx, city: CityDef, block: Block, detail: number): void {
    const rng = rngForBlock(city, block);
    const ground = this.terrain.height(block.x, block.z);
    const top = ground + 0.16;
    const slabW = block.width - 12;
    const slabD = block.depth - 12;

    // sidewalk slab
    ctx.paving.addBox(
      block.x,
      ground + 0.08,
      block.z,
      slabW,
      0.16,
      slabD,
      block.angle,
      vary(COLORS.curb, rng, 0.06),
      3.2,
      vary(COLORS.stoneLight, rng, 0.05),
    );
    this.collision.addPlatform(block.x, block.z, slabW / 2, slabD / 2, block.angle, top, ctx.owner);

    // curb trim
    ctx.props.addBox(
      block.x,
      top - 0.02,
      block.z,
      slabW + 0.3,
      0.08,
      slabD + 0.3,
      block.angle,
      shade(COLORS.curbDark, 1),
      2,
      undefined,
      undefined,
      true,
      true,
    );

    if (block.park) {
      this.buildPark(ctx, city, block, top, rng);
      return;
    }
    if (block.plaza) {
      this.buildPlaza(ctx, city, block, top, rng);
      return;
    }

    const margin = 2.6;
    const usableW = slabW - margin * 2;
    const usableD = slabD - margin * 2;
    if (usableW < 8 || usableD < 8) return;

    const lots = rng.chance(0.32) ? 1 : rng.chance(0.55) ? 2 : 3;
    const gap = lots > 1 ? rng.range(1.6, 3.2) : 0;
    const lotW = (usableW - gap * (lots - 1)) / lots;
    const courtyard = lots === 1 && rng.chance(0.28);

    for (let l = 0; l < lots; l++) {
      const lx = -usableW / 2 + lotW / 2 + l * (lotW + gap);
      const depth = courtyard ? usableD * 0.58 : usableD;
      const lz = courtyard ? usableD * 0.18 : 0;
      const p = localToWorld(block.x, block.z, block.angle, lx, lz);
      this.buildBuilding(ctx, city, p.x, p.z, top, lotW - 0.8, depth - 0.8, block.angle, rng, detail);
    }

    if (courtyard) {
      const p = localToWorld(block.x, block.z, block.angle, 0, -usableD * 0.28);
      this.addTree(ctx, p.x, top, p.z, 'broadleaf', rng);
      this.addTree(ctx, p.x + 4, top, p.z + 2, 'olive', rng);
    }

    this.addStreetFurniture(ctx, block, top, rng, detail, city);
  }

  private buildPark(ctx: BuildCtx, city: CityDef, block: Block, top: number, rng: RNG): void {
    const grass = C('#4d6b39');
    ctx.ground.addBox(
      block.x,
      top + 0.02,
      block.z,
      block.width - 14,
      0.05,
      block.depth - 14,
      block.angle,
      vary(grass, rng, 0.1),
      3,
      vary(grass, rng, 0.1),
    );
    const treeCount = 5 + Math.floor(rng.next() * 5);
    for (let i = 0; i < treeCount; i++) {
      const lx = rng.range(-block.width * 0.35, block.width * 0.35);
      const lz = rng.range(-block.depth * 0.35, block.depth * 0.35);
      const p = localToWorld(block.x, block.z, block.angle, lx, lz);
      const kind = rng.chance(0.3) ? 'cypress' : rng.chance(0.5) ? 'broadleaf' : 'olive';
      this.addTree(ctx, p.x, top, p.z, kind, rng);
    }
    // paths
    ctx.paving.addBox(block.x, top + 0.03, block.z, 3.2, 0.04, block.depth - 16, block.angle, COLORS.stone, 2);
    ctx.paving.addBox(block.x, top + 0.03, block.z, block.width - 16, 0.04, 3.2, block.angle, COLORS.stone, 2);
    this.addBench(ctx, block.x + 3, top, block.z, block.angle, rng);
    this.addBench(ctx, block.x - 3, top, block.z + 5, block.angle + Math.PI, rng);
    if (ctx.detail === 0) {
      this.addLamp(ctx, block.x + block.width * 0.38, top, block.z + block.depth * 0.38, rng);
      this.addLamp(ctx, block.x - block.width * 0.38, top, block.z - block.depth * 0.38, rng);
    }
  }

  private buildPlaza(ctx: BuildCtx, city: CityDef, block: Block, top: number, rng: RNG): void {
    ctx.paving.addBox(
      block.x,
      top + 0.02,
      block.z,
      block.width - 14,
      0.04,
      block.depth - 14,
      block.angle,
      vary(COLORS.stoneLight, rng, 0.05),
      2.4,
    );
    // fountain
    const fx = block.x;
    const fz = block.z;
    ctx.props.addCylinder(fx, top, fz, 3.4, 0.8, 12, COLORS.stone, COLORS.stoneLight);
    ctx.props.addCylinder(fx, top + 0.8, fz, 2.6, 0.15, 12, COLORS.water);
    ctx.props.addCylinder(fx, top + 0.8, fz, 0.5, 2.0, 8, COLORS.stoneLight);
    ctx.props.addSphere(fx, top + 2.7, fz, 0.6, COLORS.stoneLight, 8, 4);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const tx = fx + Math.cos(a) * 12;
      const tz = fz + Math.sin(a) * 12;
      this.addTree(ctx, tx, top, tz, rng.chance(0.5) ? 'cypress' : 'broadleaf', rng);
    }
    this.addBench(ctx, fx + 8, top, fz, block.angle, rng);
    this.addBench(ctx, fx - 8, top, fz, block.angle + Math.PI, rng);
    if (rng.chance(0.5)) {
      this.addLamp(ctx, fx + 10, top, fz + 10, rng);
      this.addLamp(ctx, fx - 10, top, fz - 10, rng);
    }
  }

  private addStreetFurniture(
    ctx: BuildCtx,
    block: Block,
    top: number,
    rng: RNG,
    detail: number,
    city: CityDef,
  ): void {
    if (detail > 0) return;
    const halfW = (block.width - 12) / 2;
    const halfD = (block.depth - 12) / 2;
    const corners: Array<[number, number]> = [
      [-halfW + 1.6, -halfD + 1.6],
      [halfW - 1.6, -halfD + 1.6],
      [-halfW + 1.6, halfD - 1.6],
      [halfW - 1.6, halfD - 1.6],
    ];

    // Keep a per-block footprint list so street props cannot be stacked.
    const placed: Array<{ x: number; z: number; r: number }> = [];
    const tryPlace = (lx: number, lz: number, r: number): { x: number; z: number } | null => {
      const p = localToWorld(block.x, block.z, block.angle, lx, lz);
      for (const o of placed) {
        if (dist2D(p.x, p.z, o.x, o.z) < r + o.r) return null;
      }
      placed.push({ x: p.x, z: p.z, r });
      return p;
    };

    const lampCount = rng.chance(0.55) ? 2 : 1;
    for (let i = 0; i < lampCount; i++) {
      const c = corners[(i + (rng.chance(0.5) ? 1 : 0)) % 4];
      const p = tryPlace(c[0], c[1], 0.65);
      if (p) this.addLamp(ctx, p.x, top, p.z, rng);
    }

    // cafe / umbrella
    if (rng.chance(0.3)) {
      const lx = rng.range(-halfW * 0.7, halfW * 0.7);
      const p = tryPlace(lx, halfD - 2.4, 2.35);
      if (p) this.addCafe(ctx, p.x, top, p.z, block.angle, rng);
    }
    // parked scooters
    if (rng.chance(0.4)) {
      const lx = rng.range(-halfW * 0.8, halfW * 0.8);
      const p = tryPlace(lx, -halfD + 1.2, 0.95);
      if (p) this.addScooter(ctx, p.x, top, p.z, block.angle + Math.PI / 2, rng);
    }
    if (rng.chance(0.5)) {
      const p = tryPlace(halfW - 1.2, rng.range(-halfD * 0.6, halfD * 0.6), 0.55);
      if (p) this.addBin(ctx, p.x, top, p.z);
    }
    if (rng.chance(0.4)) {
      const p = tryPlace(-halfW + 1.2, rng.range(-halfD * 0.6, halfD * 0.6), 0.85);
      if (p) this.addPlanter(ctx, p.x, top, p.z, rng);
    }
    // Mediterranean streets get palms instead of the usual cypresses.
    if (city.coastal && rng.chance(0.34)) {
      const c = corners[(rng.next() * 4) | 0];
      const p = tryPlace(c[0], c[1], 1.1);
      if (p) this.addTree(ctx, p.x, top, p.z, 'palm', rng);
    }
    // a parked car or two
    if (rng.chance(city.density * 0.55)) {
      const p = tryPlace(rng.range(-halfW * 0.5, halfW * 0.5), -halfD - 1.8, 2.4);
      if (p) this.addParkedCar(ctx, p.x, top, p.z, block.angle + Math.PI / 2, rng);
    }
    // edicola: only on a corner with room for its full footprint, placed after
    // lamps/terraces/cars so it can never be dropped on top of them.
    if (rng.chance(0.2)) {
      for (let i = 0; i < 4; i++) {
        const c = corners[(i + ((rng.next() * 4) | 0)) % 4];
        const p = tryPlace(c[0], c[1], 1.75);
        if (p) {
          this.addKiosk(ctx, p.x, top, p.z, block.angle, rng);
          break;
        }
      }
    }
  }

  /* -------------------------------------------------------------- */
  /* Buildings                                                       */
  /* -------------------------------------------------------------- */

  private buildBuilding(
    ctx: BuildCtx,
    city: CityDef,
    cx: number,
    cz: number,
    baseY: number,
    width: number,
    depth: number,
    angle: number,
    rng: RNG,
    detail: number,
  ): void {
    const w = Math.max(5, width);
    const d = Math.max(5, depth);
    const centerDist = dist2D(cx, cz, city.x, city.z);
    const centerT = 1 - clamp(centerDist / city.radius, 0, 1);
    const style = CITY_FACADES[city.style][Math.floor(rng.next() * CITY_FACADES[city.style].length)];
    const styleIdx = STYLE_INDEX.get(style) ?? 0;
    const wallColor = vary(C(style === 'modern' ? city.palette.wall[0] : city.palette.wall[Math.floor(rng.next() * city.palette.wall.length)]), rng, 0.1);
    const roofColor = vary(
    C(city.palette.roof[Math.floor(rng.next() * city.palette.roof.length)]),
    rng,
    0.07,
  );

    let floors: number;
    if (style === 'modern' && city.id === 'milano' && rng.chance(0.1)) {
      floors = rng.int(10, 20);
    } else {
      const baseFloors = lerp(2.4, 6.2, city.heightScale * (0.65 + centerT * 0.55));
      floors = Math.round(baseFloors + rng.range(-1.6, 2.6));
      floors = clamp(floors, 2, city.id === 'roma' ? 8 : city.id === 'venezia' ? 5 : 12);
    }
    const shopH = rng.chance(0.72) ? 3.7 : 0;
    const floorH = 3.15;
    const wallH = floors * floorH;
    const base = baseY;
    const shopTop = base + shopH;
    const wallTop = shopTop + wallH;

    // shopfront
    if (shopH > 0) {
      ctx.shop.addBox(
        cx,
        base + shopH / 2,
        cz,
        w + 0.24,
        shopH,
        d + 0.24,
        angle,
        vary(C('#ffffff'), rng, 0.05),
        7,
        undefined,
        undefined,
        true,
        true,
      );
      // cornice above shops
      ctx.props.addBox(cx, shopTop + 0.12, cz, w + 0.7, 0.24, d + 0.7, angle, COLORS.stoneLight, 2);
      this.addShopfrontDetails(ctx, cx, cz, angle, w, d, base, shopH, rng);
    } else {
      this.addEntrance(ctx, cx, cz, angle, w, d, base, rng);
    }

    // upper walls with facade atlas cells
    this.addFacadeWalls(ctx, cx, cz, angle, w, d, shopTop, wallTop, styleIdx, wallColor, rng);

    // corner quoins
    const quoinColor = shade(wallColor, 1.14);
    const qh = wallTop - shopTop;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const p = localToWorld(cx, cz, angle, sx * (w / 2 - 0.16), sz * (d / 2 - 0.16));
        ctx.props.addBox(p.x, shopTop + qh / 2, p.z, 0.42, qh, 0.42, angle, quoinColor, 2);
      }
    }

    // string course at the second floor and cornice at the top
    if (floors >= 3) {
      ctx.props.addBox(cx, shopTop + floorH * 2, cz, w + 0.3, 0.12, d + 0.3, angle, shade(wallColor, 1.12), 2);
    }
    ctx.props.addBox(cx, wallTop - 0.12, cz, w + 0.6, 0.28, d + 0.6, angle, shade(wallColor, 1.16), 2);

    const gable = style !== 'modern' && rng.chance(0.42) && floors <= 5;
    let totalTop = wallTop;
    if (gable) {
      totalTop = this.addGableRoof(ctx, cx, cz, angle, w, d, wallTop, roofColor, wallColor, rng);
    } else {
      this.addFlatRoof(ctx, cx, cz, angle, w, d, wallTop, roofColor, rng, detail);
      totalTop = wallTop + 0.5;
    }

    // Stepped massing breaks the uniform "shoebox" skyline.
    if (detail === 0) {
      if (style === 'modern' && floors >= 5 && rng.chance(0.6)) {
        const setW = w * rng.range(0.55, 0.76);
        const setD = d * rng.range(0.55, 0.76);
        const extra = rng.int(1, 3);
        const extraH = extra * 3.2;
        ctx.props.addBox(cx, totalTop + extraH / 2 - 0.15, cz, setW, extraH, setD, angle, wallColor, 2);
        ctx.props.addBox(
          cx,
          totalTop + extraH,
          cz,
          setW + 0.45,
          0.26,
          setD + 0.45,
          angle,
          shade(wallColor, 1.12),
          2,
        );
        totalTop += extraH;
      } else if ((style === 'ornate' || style === 'medieval') && rng.chance(0.3)) {
        const sx = rng.chance(0.5) ? -1 : 1;
        const sz = rng.chance(0.5) ? -1 : 1;
        const p = localToWorld(cx, cz, angle, sx * (w / 2 - 1.1), sz * (d / 2 - 1.1));
        const turretTop = wallTop + rng.range(2, 5);
        ctx.props.addCylinder(
          p.x,
          (shopTop + turretTop) / 2,
          p.z,
          1.25,
          turretTop - shopTop,
          10,
          shade(wallColor, 1.04),
          wallColor,
        );
        ctx.props.addCone(p.x, turretTop + 1.7, p.z, 1.65, 3.4, 10, shade(roofColor, 0.92));
        totalTop = Math.max(totalTop, turretTop + 3.4);
      }
    }

    // Ground-floor portico: columns and a continuous lintel over the shopfront.
    if (
      detail === 0 &&
      shopH > 0 &&
      (style === 'classic' || style === 'ornate' || style === 'barocco') &&
      rng.chance(0.5)
    ) {
      const cols = Math.max(3, Math.round(w / 4));
      for (let i = 0; i <= cols; i++) {
        const p = localToWorld(cx, cz, angle, -w / 2 + (i * w) / cols, d / 2 + 1.5);
        ctx.props.addCylinder(
          p.x,
          base + shopH / 2,
          p.z,
          0.32,
          shopH,
          8,
          COLORS.stoneLight,
          COLORS.stone,
        );
      }
      const l = localToWorld(cx, cz, angle, 0, d / 2 + 1.5);
      ctx.props.addBox(l.x, shopTop - 0.1, l.z, w + 0.5, 0.35, 1.3, angle, COLORS.stone, 2);
    }

    // balconies
    if (
      detail === 0 &&
      (style === 'ornate' || style === 'classic' || style === 'coastal' || style === 'medieval' || style === 'brick' || style === 'barocco')
    ) {
      const balconyFloors = Math.min(floors, 4);
      for (let f = 1; f < balconyFloors; f++) {
        if (!rng.chance(0.55)) continue;
        const bay = Math.floor(rng.next() * Math.max(1, Math.round(w / 3.4)));
        const bayW = w / Math.max(1, Math.round(w / 3.4));
        const bx = -w / 2 + (bay + 0.5) * bayW;
        const p = localToWorld(cx, cz, angle, bx, d / 2 + 0.5);
        const y = shopTop + f * floorH + 0.05;
        ctx.props.addBox(p.x, y, p.z, Math.min(2.6, bayW * 0.92), 0.12, 1.0, angle, COLORS.stoneLight, 1.5);
        // railing
        const rp = localToWorld(cx, cz, angle, bx, d / 2 + 0.98);
        ctx.props.addBox(rp.x, y + 0.45, rp.z, Math.min(2.6, bayW * 0.92), 0.06, 0.06, angle, COLORS.darkMetal, 1);
        ctx.props.addBox(rp.x, y + 0.05, rp.z, Math.min(2.6, bayW * 0.92), 0.06, 0.06, angle, COLORS.darkMetal, 1);
        for (let b = 0; b < 5; b++) {
          const bxp = localToWorld(cx, cz, angle, bx - 1.1 + b * 0.55, d / 2 + 0.98);
          ctx.props.addBox(bxp.x, y + 0.25, bxp.z, 0.045, 0.5, 0.045, angle, COLORS.darkMetal, 1);
        }
        // Potted plants and a railing flower box give the balconies life.
        if (!lowDetail() && rng.chance(0.5)) {
          const fw = Math.min(1.2, bayW * 0.45);
          const fp = localToWorld(cx, cz, angle, bx, d / 2 + 1.02);
          ctx.props.addBox(fp.x, y + 0.3, fp.z, fw, 0.18, 0.2, angle, C('#7a4a34'), 1.5);
          for (let k = 0; k < 3; k++) {
            const q = localToWorld(cx, cz, angle, bx - fw / 2 + (k + 0.5) * (fw / 3), d / 2 + 1.04);
            ctx.props.addSphere(q.x, y + 0.42, q.z, 0.11, vary(COLORS.leaf, rng, 0.12), 4, 3, 0.75);
            ctx.props.addSphere(q.x, y + 0.5, q.z + 0.05, 0.04, rng.pick([COLORS.red, COLORS.accent, COLORS.yellow]), 3, 2);
          }
        } else if (!lowDetail() && rng.chance(0.4)) {
          const pp = localToWorld(cx, cz, angle, bx + Math.min(0.8, bayW * 0.25), d / 2 + 0.28);
          ctx.props.addCylinder(pp.x, y + 0.22, pp.z, 0.16, 0.32, 6, C('#8a5a3c'));
          ctx.props.addSphere(pp.x, y + 0.5, pp.z, 0.22, vary(COLORS.leaf, rng, 0.1), 4, 3, 0.85);
        }
      }
    }

    // "panni stesi": laundry lines strung between upper windows.
    if (
      detail === 0 &&
      (style === 'coastal' || style === 'ornate' || style === 'classic' || style === 'medieval' || style === 'brick' || style === 'barocco') &&
      floors >= 3 &&
      rng.chance(0.42)
    ) {
      const f = rng.int(2, Math.min(floors, 5));
      const y = shopTop + f * floorH + 0.45;
      const lineStart = -w * 0.36;
      const lineEnd = w * 0.36;
      const a = localToWorld(cx, cz, angle, lineStart, d / 2 + 0.55);
      const b = localToWorld(cx, cz, angle, lineEnd, d / 2 + 0.55);
      ctx.props.addBox((a.x + b.x) / 2, y, (a.z + b.z) / 2, lineEnd - lineStart + 0.5, 0.025, 0.025, angle, COLORS.darkMetal, 1);
      const cloth = [COLORS.white, COLORS.blue, COLORS.cream, COLORS.accent, COLORS.red];
      for (let k = 0; k < 4; k++) {
        const t = (k + 0.5) / 4;
        const lx = lerp(lineStart, lineEnd, t);
        const q = localToWorld(cx, cz, angle, lx, d / 2 + 0.55);
        const color = vary(rng.pick(cloth), rng, 0.08);
        const h = rng.range(0.45, 0.8);
        ctx.props.addBox(q.x, y - h / 2, q.z, rng.range(0.4, 0.7), h, 0.03, angle, color, 1);
      }
    }

    // awning
    if (shopH > 0 && rng.chance(0.62)) {
      const aw = Math.min(w * 0.62, 6.5);
      const p = localToWorld(cx, cz, angle, rng.range(-w * 0.15, w * 0.15), d / 2 + 0.9);
      const awningColor = vary(rng.pick([COLORS.accent, COLORS.green, COLORS.blue, COLORS.red]), rng, 0.1);
      ctx.props.addBox(p.x, shopTop - 0.25, p.z, aw, 0.08, 1.5, angle, awningColor, 2);
      const edge = localToWorld(cx, cz, angle, rng.range(-w * 0.15, w * 0.15), d / 2 + 1.62);
      ctx.props.addBox(edge.x, shopTop - 0.5, edge.z, aw, 0.4, 0.06, angle, awningColor, 1);
    }

    // shop sign / glow with a dark backing box so it reads as a mounted sign
    if (shopH > 0 && rng.chance(0.55)) {
      const sx = rng.range(-w * 0.2, w * 0.2);
      const signW = Math.min(3, w * 0.4);
      const back = localToWorld(cx, cz, angle, sx, d / 2 + 0.15);
      const p = localToWorld(cx, cz, angle, sx, d / 2 + 0.22);
      const signColor = vary(rng.pick([COLORS.yellow, COLORS.cream, COLORS.accent, C('#8fd0c0')]), rng, 0.1);
      ctx.props.addBox(back.x, base + shopH - 0.46, back.z, signW + 0.34, 0.56, 0.1, angle, C('#241f1b'), 1.5);
      ctx.glow.addBox(p.x, base + shopH - 0.46, p.z, signW, 0.34, 0.06, angle, signColor, 1);
    }

    this.collision.addBox(cx, cz, w / 2, d / 2, angle, base, totalTop + 0.4, 'building', undefined, ctx.owner);
  }

  private addFacadeWalls(
    ctx: BuildCtx,
    cx: number,
    cz: number,
    angle: number,
    w: number,
    d: number,
    y0: number,
    y1: number,
    styleIdx: number,
    color: THREE.Color,
    rng: RNG,
  ): void {
    const height = y1 - y0;
    const floors = Math.max(1, Math.round(height / 3.15));
    const cellH = height / floors;
    // Per-building offsets break the repeating 4x4 window pattern of the atlas.
    const bayShift = rng.int(0, 3);
    const floorShift = rng.int(0, 3);
    const faces: Array<'front' | 'back' | 'right' | 'left'> = ['front', 'back', 'right', 'left'];
    for (const face of faces) {
      const faceWidth = face === 'front' || face === 'back' ? w : d;
      const bays = Math.max(1, Math.round(faceWidth / 3.4));
      const cellW = faceWidth / bays;
      const normalLocal: [number, number, number] =
        face === 'front' ? [0, 0, 1] : face === 'back' ? [0, 0, -1] : face === 'right' ? [1, 0, 0] : [-1, 0, 0];
      const nx = normalLocal[0] * Math.cos(angle) + normalLocal[2] * Math.sin(angle);
      const nz = -normalLocal[0] * Math.sin(angle) + normalLocal[2] * Math.cos(angle);

      for (let f = 0; f < floors; f++) {
        for (let b = 0; b < bays; b++) {
          const rect = insetRect(
            facadeCellRect(styleIdx, b + bayShift + f * 2, f + floorShift),
            0.0009,
          );
          const yy0 = y0 + f * cellH;
          const yy1 = yy0 + cellH;
          let p0: { x: number; z: number };
          let p1: { x: number; z: number };
          if (face === 'front') {
            const lx0 = -w / 2 + b * cellW;
            const lx1 = lx0 + cellW;
            p0 = localToWorld(cx, cz, angle, lx0, d / 2);
            p1 = localToWorld(cx, cz, angle, lx1, d / 2);
          } else if (face === 'back') {
            const lx0 = w / 2 - b * cellW;
            const lx1 = lx0 - cellW;
            p0 = localToWorld(cx, cz, angle, lx0, -d / 2);
            p1 = localToWorld(cx, cz, angle, lx1, -d / 2);
          } else if (face === 'right') {
            const lz0 = d / 2 - b * cellW;
            const lz1 = lz0 - cellW;
            p0 = localToWorld(cx, cz, angle, w / 2, lz0);
            p1 = localToWorld(cx, cz, angle, w / 2, lz1);
          } else {
            const lz0 = -d / 2 + b * cellW;
            const lz1 = lz0 + cellW;
            p0 = localToWorld(cx, cz, angle, -w / 2, lz0);
            p1 = localToWorld(cx, cz, angle, -w / 2, lz1);
          }
          const a: V3 = { x: p0.x, y: yy0, z: p0.z };
          const bb: V3 = { x: p1.x, y: yy0, z: p1.z };
          const c: V3 = { x: p1.x, y: yy1, z: p1.z };
          const dd: V3 = { x: p0.x, y: yy1, z: p0.z };
          ctx.facade.addQuad(
            a,
            bb,
            c,
            dd,
            nx,
            0,
            nz,
            { u: rect.u0, v: rect.v0 },
            { u: rect.u1, v: rect.v0 },
            { u: rect.u1, v: rect.v1 },
            { u: rect.u0, v: rect.v1 },
            color,
          );

          // Actual relief on the facade: sill, lintel and (sometimes) jambs.
          // Everything is merged into ctx.props, so this costs no draw calls.
          if ((face === 'front' || face === 'back') && rng.chance(0.55)) {
            let lx = 0;
            let lz = 0;
            const alongX = face === 'front' || face === 'back';
            if (face === 'front') {
              lx = -w / 2 + (b + 0.5) * cellW;
              lz = d / 2 + 0.07;
            } else if (face === 'back') {
              lx = w / 2 - (b + 0.5) * cellW;
              lz = -d / 2 - 0.07;
            } else if (face === 'right') {
              lx = w / 2 + 0.07;
              lz = d / 2 - (b + 0.5) * cellW;
            } else {
              lx = -w / 2 - 0.07;
              lz = -d / 2 + (b + 0.5) * cellW;
            }
            const q = localToWorld(cx, cz, angle, lx, lz);
            const fw = cellW * 0.48;
            const sx = alongX ? fw : 0.16;
            const sz = alongX ? 0.16 : fw;
            const winBottom = yy0 + cellH * 0.28;
            const winTop = yy0 + cellH * 0.8;
            ctx.props.addBox(
              q.x,
              winBottom - 0.06,
              q.z,
              sx + 0.14,
              0.13,
              sz + 0.14,
              angle,
              shade(color, 0.88),
              1,
            );
            ctx.props.addBox(
              q.x,
              winTop + 0.06,
              q.z,
              sx + 0.12,
              0.11,
              sz + 0.12,
              angle,
              shade(color, 1.1),
              1,
            );
            // Modern facades get wall-mounted AC units under some windows.
            if (!lowDetail() && face === 'front' && FACADE_STYLES[styleIdx] === 'modern' && rng.chance(0.24)) {
              const acW = Math.min(1.0, cellW * 0.3);
              const ac = localToWorld(cx, cz, angle, lx + cellW * 0.2, lz + 0.2);
              const grille = localToWorld(cx, cz, angle, lx + cellW * 0.2, lz + 0.41);
              ctx.props.addBox(ac.x, winBottom - 0.3, ac.z, acW, 0.46, 0.4, angle, C('#9aa0a2'), 1.5);
              ctx.props.addBox(grille.x, winBottom - 0.3, grille.z, acW * 0.72, 0.3, 0.03, angle, C('#5c6264'), 1);
              ctx.props.addBox(ac.x, winBottom - 0.55, ac.z, acW * 0.78, 0.06, 0.3, angle, COLORS.darkMetal, 1);
            }
            // Window flower boxes: geraniums and greenery at street level.
            if (
              !lowDetail() &&
              face === 'front' &&
              FACADE_STYLES[styleIdx] !== 'modern' &&
              rng.chance(0.35)
            ) {
              const flowerW = cellW * 0.62;
              const pot = vary(
                rng.pick([COLORS.terracotta, COLORS.cream, COLORS.stone]),
                rng,
                0.08,
              );
              ctx.props.addBox(
                q.x,
                winBottom - 0.2,
                q.z,
                flowerW + 0.16,
                0.2,
                0.38,
                angle,
                pot,
                1.4,
              );
              ctx.props.addBox(
                q.x,
                winBottom - 0.04,
                q.z,
                flowerW * 0.9,
                0.14,
                0.3,
                angle,
                vary(COLORS.leaf, rng, 0.12),
                1,
              );
              for (let k = 0; k < 3; k++) {
                const bloom = localToWorld(q.x, q.z, angle, (k - 1) * flowerW * 0.3, 0.03);
                ctx.props.addSphere(
                  bloom.x,
                  winBottom + 0.06,
                  bloom.z,
                  0.055,
                  vary(rng.pick([C('#c4473a'), C('#d883a0'), C('#e0c04a')]), rng, 0.1),
                  3,
                  2,
                );
              }
            }
            if (rng.chance(0.3)) {
              const off = fw * 0.5;
              const jamb = alongX
                ? { x: q.x, z: q.z, w: 0.09, d: 0.13, ox: off, oz: 0 }
                : { x: q.x, z: q.z, w: 0.13, d: 0.09, ox: 0, oz: off };
              for (const s of [-1, 1]) {
                const jp = localToWorld(
                  jamb.x,
                  jamb.z,
                  angle,
                  alongX ? s * jamb.ox : 0,
                  alongX ? 0 : s * jamb.oz,
                );
                ctx.props.addBox(
                  jp.x,
                  (winBottom + winTop) / 2,
                  jp.z,
                  jamb.w,
                  winTop - winBottom,
                  jamb.d,
                  angle,
                  shade(color, 1.04),
                  1,
                );
              }
            }
          }
        }
      }
    }
  }

  private addFlatRoof(
    ctx: BuildCtx,
    cx: number,
    cz: number,
    angle: number,
    w: number,
    d: number,
    wallTop: number,
    roofColor: THREE.Color,
    rng: RNG,
    detail: number,
  ): void {
    ctx.roof.addBox(cx, wallTop + 0.18, cz, w + 0.5, 0.36, d + 0.5, angle, roofColor, 3, shade(roofColor, 0.85));
    // parapet
    const ph = 0.75;
    for (const sz of [-1, 1]) {
      const p = localToWorld(cx, cz, angle, 0, sz * (d / 2 - 0.15));
      ctx.roof.addBox(p.x, wallTop + ph / 2, p.z, w + 0.5, ph, 0.3, angle, shade(roofColor, 1.06), 2);
    }
    for (const sx of [-1, 1]) {
      const p = localToWorld(cx, cz, angle, sx * (w / 2 - 0.15), 0);
      ctx.roof.addBox(p.x, wallTop + ph / 2, p.z, 0.3, ph, d + 0.5, angle, shade(roofColor, 1.06), 2);
    }
    if (detail > 0) return;
    // Rooftops are visible from elevated camera angles: give them a skyline.
    const items = rng.int(2, 4);
    for (let i = 0; i < items; i++) {
      const lx = rng.range(-w * 0.32, w * 0.32);
      const lz = rng.range(-d * 0.32, d * 0.32);
      const p = localToWorld(cx, cz, angle, lx, lz);
      const kind = rng.next();
      if (kind < 0.22) {
        // HVAC box with an exhaust vent
        ctx.props.addBox(p.x, wallTop + 1.0, p.z, 2.4, 1.7, 2.6, angle, COLORS.stone, 2);
        ctx.props.addBox(p.x, wallTop + 1.9, p.z, 2.6, 0.16, 2.8, angle, COLORS.darkStone, 2);
        ctx.props.addCylinder(
          p.x + 0.55,
          wallTop + 2.15,
          p.z,
          0.22,
          0.45,
          8,
          COLORS.metal,
          COLORS.darkMetal,
        );
      } else if (kind < 0.42) {
        // Raised water tank on four legs (very Italian rooftops)
        ctx.props.addCylinder(p.x, wallTop + 1.45, p.z, 0.95, 1.65, 10, COLORS.metal, COLORS.darkMetal);
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const q = localToWorld(p.x, p.z, angle, sx * 0.6, sz * 0.6);
            ctx.props.addBox(q.x, wallTop + 0.38, q.z, 0.12, 0.72, 0.12, angle, COLORS.darkMetal, 1);
          }
        }
      } else if (kind < 0.6) {
        // Tilted solar panel array
        for (let s = 0; s < 2; s++) {
          const sp = localToWorld(cx, cz, angle, lx + s * 1.65 - 0.8, lz);
          ctx.props.addBox(sp.x, wallTop + 0.78, sp.z, 1.5, 0.09, 2.5, angle, C('#1d2b43'), 1.5);
          ctx.props.addBox(sp.x, wallTop + 0.5, sp.z - 0.5, 1.5, 0.5, 0.08, angle, COLORS.darkMetal, 1);
        }
      } else if (kind < 0.75) {
        // Satellite dish
        ctx.props.addCylinder(p.x, wallTop + 0.5, p.z, 0.07, 0.9, 6, COLORS.darkMetal, COLORS.darkMetal);
        ctx.props.addCone(p.x, wallTop + 1.05, p.z, 0.55, 0.25, 10, COLORS.white);
      } else if (kind < 0.9) {
        // Pergola with four posts
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const q = localToWorld(cx, cz, angle, sx * 1.45, sz * 1.1);
            ctx.props.addBox(q.x, wallTop + 0.95, q.z, 0.1, 1.9, 0.1, angle, COLORS.wood, 1);
          }
        }
        ctx.props.addBox(p.x, wallTop + 1.9, p.z, 3.2, 0.12, 2.5, angle, COLORS.woodLight, 1.5);
      } else {
        // Antenna mast
        ctx.props.addBox(p.x, wallTop + 1.9, p.z, 0.09, 3.8, 0.09, angle, COLORS.darkMetal, 1);
        ctx.props.addBox(p.x, wallTop + 3.2, p.z, 1.5, 0.07, 0.07, angle, COLORS.darkMetal, 1);
        ctx.props.addBox(p.x, wallTop + 2.7, p.z, 1.0, 0.06, 0.06, angle, COLORS.darkMetal, 1);
      }
    }
    if (rng.chance(0.45)) {
      const p = localToWorld(cx, cz, angle, rng.range(-w * 0.3, w * 0.3), rng.range(-d * 0.3, d * 0.3));
      ctx.props.addBox(p.x, wallTop + 1.6, p.z, 0.6, 3.2, 0.6, angle, COLORS.brick, 2);
      ctx.props.addBox(p.x, wallTop + 3.3, p.z, 0.8, 0.2, 0.8, angle, COLORS.darkStone, 2);
    }
  }

  private addGableRoof(
    ctx: BuildCtx,
    cx: number,
    cz: number,
    angle: number,
    w: number,
    d: number,
    wallTop: number,
    roofColor: THREE.Color,
    wallColor: THREE.Color,
    rng: RNG,
  ): number {
    const over = 0.6;
    const rise = Math.min(3.0, d * 0.22);
    const hw = w / 2 + over;
    const hd = d / 2 + over;
    const nFront = { x: Math.sin(angle), z: Math.cos(angle) };
    const nBack = { x: -Math.sin(angle), z: -Math.cos(angle) };
    const nLen = Math.hypot(rise, hd);
    const ny = hd / nLen;
    const nzF = rise / nLen;

    const p = (lx: number, lz: number, y: number): V3 => {
      const wpt = localToWorld(cx, cz, angle, lx, lz);
      return { x: wpt.x, y, z: wpt.z };
    };

    // front slope
    ctx.roof.addQuad(
      p(-hw, hd, wallTop),
      p(hw, hd, wallTop),
      p(hw, 0, wallTop + rise),
      p(-hw, 0, wallTop + rise),
      nFront.x * nzF,
      ny,
      nFront.z * nzF,
      { u: 0, v: 0 },
      { u: w / 4, v: 0 },
      { u: w / 4, v: nLen / 4 },
      { u: 0, v: nLen / 4 },
      roofColor,
    );
    // back slope
    ctx.roof.addQuad(
      p(hw, -hd, wallTop),
      p(-hw, -hd, wallTop),
      p(-hw, 0, wallTop + rise),
      p(hw, 0, wallTop + rise),
      nBack.x * nzF,
      ny,
      nBack.z * nzF,
      { u: 0, v: 0 },
      { u: w / 4, v: 0 },
      { u: w / 4, v: nLen / 4 },
      { u: 0, v: nLen / 4 },
      roofColor,
    );
    // gable ends
    for (const sx of [-1, 1]) {
      const a = p(sx * hw, -hd, wallTop);
      const b = p(sx * hw, hd, wallTop);
      const c = p(sx * hw, 0, wallTop + rise);
      ctx.props.addTriangle(a, b, c, sx * Math.cos(angle), 0, -sx * Math.sin(angle), { u: 0, v: 0 }, { u: w / 4, v: 0 }, { u: w / 8, v: rise / 4 }, wallColor);
    }
    // ridge
    ctx.roof.addBox(cx, wallTop + rise + 0.05, cz, w + over * 2, 0.16, 0.24, angle, shade(roofColor, 0.9), 2);
    void rng;
    return wallTop + rise + 0.2;
  }

  /* -------------------------------------------------------------- */
  /* Props                                                           */
  /* -------------------------------------------------------------- */

  private addTree(ctx: BuildCtx, x: number, y: number, z: number, kind: 'cypress' | 'broadleaf' | 'olive' | 'palm', rng: RNG): void {
    const scale = rng.range(0.85, 1.25);
    if (kind === 'cypress') {
      ctx.props.addCylinder(x, y, z, 0.12 * scale, 1.1 * scale, 5, COLORS.trunk);
      ctx.props.addCone(x, y + 0.9 * scale, z, 0.85 * scale, 4.6 * scale, 7, vary(COLORS.cypress, rng, 0.1));
      ctx.props.addCone(x, y + 3.2 * scale, z, 0.6 * scale, 2.2 * scale, 7, vary(COLORS.cypress, rng, 0.1));
    } else if (kind === 'broadleaf') {
      ctx.props.addCylinder(x, y, z, 0.2 * scale, 2.4 * scale, 6, COLORS.trunk);
      ctx.props.addSphere(x, y + 3.0 * scale, z, 1.5 * scale, vary(COLORS.leaf, rng, 0.1), 8, 5, 0.9);
      ctx.props.addSphere(x + 0.9 * scale, y + 3.5 * scale, z + 0.3 * scale, 1.0 * scale, vary(COLORS.leafLight, rng, 0.1), 7, 4, 0.9);
      ctx.props.addSphere(x - 0.7 * scale, y + 3.4 * scale, z - 0.5 * scale, 0.9 * scale, vary(COLORS.leafDark, rng, 0.1), 7, 4, 0.9);
    } else if (kind === 'olive') {
      ctx.props.addCylinder(x, y, z, 0.15 * scale, 1.5 * scale, 5, COLORS.trunk);
      ctx.props.addSphere(x, y + 2.2 * scale, z, 1.2 * scale, vary(COLORS.olive, rng, 0.1), 7, 4, 0.8);
      ctx.props.addSphere(x + 0.6 * scale, y + 2.5 * scale, z + 0.3 * scale, 0.8 * scale, vary(COLORS.olive, rng, 0.1), 6, 3, 0.8);
    } else {
      const lean = rng.range(-0.3, 0.3);
      for (let i = 0; i < 5; i++) {
        ctx.props.addCylinder(x + lean * i * 0.3, y + i * 1.1 * scale, z, 0.16 * scale * (1 - i * 0.12), 1.2 * scale, 5, COLORS.trunk);
      }
      const topY = y + 5.4 * scale;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + rng.range(-0.2, 0.2);
        const fx = x + lean * 1.4 + Math.cos(a) * 1.6 * scale;
        const fz = z + Math.sin(a) * 1.6 * scale;
        ctx.props.addBox(fx, topY - 0.2, fz, 2.2 * scale, 0.1, 0.5 * scale, a, vary(COLORS.palm, rng, 0.1), 2);
      }
    }
  }

  private addLamp(ctx: BuildCtx, x: number, y: number, z: number, rng: RNG): void {
    const h = rng.range(4.2, 5.2);
    ctx.props.addCylinder(x, y, z, 0.09, h, 5, COLORS.darkMetal);
    ctx.props.addBox(x, y + h, z, 1.1, 0.09, 0.09, rng.range(0, Math.PI), COLORS.darkMetal, 1);
    const gx = x + 0.45;
    ctx.glow.addBox(gx, y + h - 0.15, z, 0.4, 0.24, 0.24, 0, C('#ffe0a8'), 1);
    // warm pool of light on the pavement
    ctx.pool.addQuad(
      { x: x - 4, y: y + 0.02, z: z - 4 },
      { x: x + 4, y: y + 0.02, z: z - 4 },
      { x: x + 4, y: y + 0.02, z: z + 4 },
      { x: x - 4, y: y + 0.02, z: z + 4 },
      0,
      1,
      0,
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
      COLORS.cream,
    );
  }

  private addBench(ctx: BuildCtx, x: number, y: number, z: number, angle: number, rng: RNG): void {
    ctx.props.addBox(x, y + 0.42, z, 1.8, 0.1, 0.5, angle, vary(COLORS.woodLight, rng, 0.08), 1);
    ctx.props.addBox(x, y + 0.75, z, 1.8, 0.45, 0.08, angle, vary(COLORS.woodLight, rng, 0.08), 1);
    for (const s of [-1, 1]) {
      const p = localToWorld(x, z, angle, s * 0.75, 0);
      ctx.props.addBox(p.x, y + 0.22, p.z, 0.08, 0.44, 0.42, angle, COLORS.darkMetal, 1);
    }
  }

  private addCafe(ctx: BuildCtx, x: number, y: number, z: number, angle: number, rng: RNG): void {
    ctx.props.addCylinder(x, y, z, 0.06, 2.3, 5, COLORS.metal);
    const canopy = rng.pick([COLORS.cream, COLORS.red, COLORS.green]);
    ctx.props.addCone(x, y + 2.2, z, 1.5, 0.5, 8, vary(canopy, rng, 0.08));
    ctx.props.addCylinder(x, y, z, 0.42, 0.7, 8, COLORS.white);
    for (let i = 0; i < 2; i++) {
      const p = localToWorld(x, z, angle, (i === 0 ? 1 : -1) * 1.1, 0);
      ctx.props.addBox(p.x, y + 0.25, p.z, 0.42, 0.5, 0.42, angle, COLORS.darkMetal, 1);
      ctx.props.addBox(p.x, y + 0.55, p.z, 0.42, 0.5, 0.06, angle, COLORS.darkMetal, 1);
    }
  }

  private addScooter(ctx: BuildCtx, x: number, y: number, z: number, angle: number, rng: RNG): void {
    const color = rng.pick([COLORS.cream, COLORS.red, COLORS.blue, COLORS.yellow]);
    ctx.props.addBox(x, y + 0.55, z, 0.45, 0.5, 1.6, angle, vary(color, rng, 0.08), 1);
    ctx.props.addBox(x, y + 0.95, z - 0.35, 0.35, 0.55, 0.5, angle, COLORS.darkMetal, 1);
    ctx.props.addBox(x, y + 0.15, z + 0.55, 0.15, 0.3, 0.6, angle, COLORS.black, 1);
    ctx.props.addBox(x, y + 0.15, z - 0.55, 0.15, 0.3, 0.6, angle, COLORS.black, 1);
    ctx.props.addBox(x, y + 1.1, z + 0.6, 0.55, 0.06, 0.06, angle, COLORS.darkMetal, 1);
  }

  private addBin(ctx: BuildCtx, x: number, y: number, z: number): void {
    ctx.props.addCylinder(x, y, z, 0.32, 0.95, 8, COLORS.darkMetal, COLORS.metal);
  }

  private addPlanter(ctx: BuildCtx, x: number, y: number, z: number, rng: RNG): void {
    ctx.props.addBox(x, y + 0.25, z, 1.2, 0.5, 0.5, 0, COLORS.stone, 1);
    ctx.props.addSphere(x, y + 0.65, z, 0.45, vary(COLORS.leaf, rng, 0.1), 6, 4, 0.8);
  }

  /** Shop door, display windows and step on the front face. */
  private addShopfrontDetails(
    ctx: BuildCtx,
    cx: number,
    cz: number,
    angle: number,
    w: number,
    d: number,
    base: number,
    shopH: number,
    rng: RNG,
  ): void {
    const faceZ = d / 2 + 0.16;
    const doorW = Math.min(1.9, w * 0.18);
    const doorH = Math.min(2.5, shopH - 0.5);
    const doorX = rng.range(-w * 0.11, w * 0.11);
    const door = localToWorld(cx, cz, angle, doorX, faceZ);
    const frameColor = C('#3f3327');

    // Wooden door with a glass upper panel, raised lower panel and brass handle.
    ctx.props.addBox(door.x, base + doorH / 2, door.z, doorW, doorH, 0.1, angle, C('#3a2b21'), 2);
    for (const s of [-1, 1]) {
      const post = localToWorld(cx, cz, angle, doorX + s * (doorW / 2 + 0.1), faceZ);
      ctx.props.addBox(post.x, base + doorH / 2, post.z, 0.16, doorH + 0.12, 0.32, angle, frameColor, 1.5);
    }
    const lintel = localToWorld(cx, cz, angle, doorX, faceZ);
    ctx.props.addBox(lintel.x, base + doorH + 0.08, lintel.z, doorW + 0.4, 0.18, 0.36, angle, frameColor, 1.5);
    const doorPanel = localToWorld(cx, cz, angle, doorX, faceZ + 0.06);
    ctx.props.addBox(doorPanel.x, base + 0.86, doorPanel.z, doorW * 0.62, 0.8, 0.03, angle, C('#4a3a2c'), 1.5);
    const doorGlass = localToWorld(cx, cz, angle, doorX, faceZ + 0.055);
    ctx.props.addBox(doorGlass.x, base + 1.88, doorGlass.z, doorW * 0.64, 0.78, 0.02, angle, C('#3b4c52'), 1.5);
    const handle = localToWorld(cx, cz, angle, doorX + doorW * 0.32, faceZ + 0.075);
    ctx.props.addBox(handle.x, base + 1.12, handle.z, 0.05, 0.3, 0.05, angle, C('#b08a4a'), 1);
    const step = localToWorld(cx, cz, angle, doorX, faceZ + 0.38);
    ctx.props.addBox(step.x, base + 0.02, step.z, doorW + 0.52, 0.08, 0.76, angle, COLORS.stoneLight, 1.5);

    // Display windows on both sides, grounded by a stone plinth and split by mullions.
    const winW = Math.min(2.9, w * 0.22);
    const winH = 1.72;
    if (winW > 1.3) {
      for (const s of [-1, 1]) {
        const wx = doorX + s * (doorW / 2 + winW / 2 + 0.45);
        if (Math.abs(wx) + winW / 2 > w / 2 - 0.25) continue;
        const pos = localToWorld(cx, cz, angle, wx, faceZ);
        const winY = base + 1.52;
        const plinth = localToWorld(cx, cz, angle, wx, faceZ + 0.05);
        ctx.props.addBox(plinth.x, base + 0.33, plinth.z, winW + 0.3, 0.66, 0.26, angle, shade(COLORS.stone, 1.02), 1.5);
        ctx.props.addBox(pos.x, winY, pos.z, winW + 0.24, winH + 0.22, 0.16, angle, C('#4a433b'), 1.5);
        // Pane sits on the backing face; the wider dark box reads as a frame.
        const glass = localToWorld(cx, cz, angle, wx, faceZ + 0.1);
        ctx.props.addBox(glass.x, winY, glass.z, winW, winH, 0.04, angle, C('#2f3d42'), 1.5);
        for (const mx of [-winW / 6, winW / 6]) {
          const m = localToWorld(cx, cz, angle, wx + mx, faceZ + 0.125);
          ctx.props.addBox(m.x, winY, m.z, 0.07, winH, 0.03, angle, C('#2b2722'), 1);
        }
        const transom = localToWorld(cx, cz, angle, wx, faceZ + 0.125);
        ctx.props.addBox(transom.x, winY + winH * 0.22, transom.z, winW, 0.07, 0.03, angle, C('#2b2722'), 1);
        const sill = localToWorld(cx, cz, angle, wx, faceZ + 0.14);
        ctx.props.addBox(sill.x, base + 0.66, sill.z, winW + 0.34, 0.1, 0.32, angle, COLORS.stoneLight, 1);
      }
    }

    // Thin stone fascia above the shop windows.
    const fascia = localToWorld(cx, cz, angle, 0, faceZ + 0.06);
    ctx.props.addBox(fascia.x, base + 2.8, fascia.z, Math.min(w * 0.94, 14), 0.12, 0.24, angle, shade(COLORS.stone, 0.92), 1.5);
  }

  /** Plain residential entrance for buildings without a shopfront. */
  private addEntrance(
    ctx: BuildCtx,
    cx: number,
    cz: number,
    angle: number,
    w: number,
    d: number,
    base: number,
    rng: RNG,
  ): void {
    if (w < 4 || !rng.chance(0.62)) return;
    const faceZ = d / 2 + 0.03;
    const doorW = Math.min(1.25, w * 0.2);
    const doorH = 2.35;
    const doorX = rng.range(-w * 0.22, w * 0.22);
    const door = localToWorld(cx, cz, angle, doorX, faceZ);
    ctx.props.addBox(door.x, base + doorH / 2, door.z, doorW, doorH, 0.08, angle, C('#2a241f'), 2);
    for (const s of [-1, 1]) {
      const post = localToWorld(cx, cz, angle, doorX + s * (doorW / 2 + 0.08), faceZ);
      ctx.props.addBox(post.x, base + doorH / 2, post.z, 0.12, doorH + 0.1, 0.2, angle, COLORS.stoneLight, 1);
    }
    const lintel = localToWorld(cx, cz, angle, doorX, faceZ);
    ctx.props.addBox(lintel.x, base + doorH + 0.08, lintel.z, doorW + 0.3, 0.16, 0.26, angle, COLORS.stoneLight, 1);
    const panel = localToWorld(cx, cz, angle, doorX, faceZ + 0.055);
    ctx.props.addBox(panel.x, base + 1.28, panel.z, doorW * 0.62, 1.5, 0.03, angle, C('#3a2f26'), 1);
    const handle = localToWorld(cx, cz, angle, doorX + doorW * 0.3, faceZ + 0.07);
    ctx.props.addBox(handle.x, base + 1.08, handle.z, 0.04, 0.24, 0.04, angle, C('#b08a4a'), 1);
    const step = localToWorld(cx, cz, angle, doorX, faceZ + 0.3);
    ctx.props.addBox(step.x, base + 0.02, step.z, doorW + 0.36, 0.08, 0.58, angle, COLORS.stoneLight, 1);
    const lamp = localToWorld(cx, cz, angle, doorX - doorW / 2 - 0.32, faceZ + 0.08);
    ctx.glow.addBox(lamp.x, base + doorH + 0.3, lamp.z, 0.12, 0.18, 0.12, angle, C('#ffd9a0'), 1);
  }

  /** Newsstand / edicola with a lit magazine wall and awning. */
  private addKiosk(
    ctx: BuildCtx,
    x: number,
    y: number,
    z: number,
    angle: number,
    rng: RNG,
  ): void {
    const body = vary(C('#3b4f42'), rng, 0.08);
    // Paving pad and stone base ground the kiosk instead of letting it sit on grass.
    ctx.paving.addBox(x, y + 0.03, z, 3.0, 0.06, 2.35, angle, COLORS.stone, 1.5);
    ctx.props.addBox(x, y + 1.02, z, 2.2, 2.05, 1.5, angle, body, 2);
    ctx.props.addBox(x, y + 0.14, z, 2.26, 0.2, 1.56, angle, COLORS.stone, 1.5);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = localToWorld(x, z, angle, sx * 1.06, sz * 0.72);
        ctx.props.addBox(post.x, y + 1.02, post.z, 0.12, 2.02, 0.12, angle, COLORS.cream, 1.2);
      }
    }
    ctx.props.addBox(x, y + 2.0, z, 2.55, 0.16, 1.85, angle, shade(body, 0.82), 2);
    const counter = localToWorld(x, z, angle, 0, 0.79);
    ctx.props.addBox(counter.x, y + 1.34, counter.z, 1.95, 0.12, 0.08, angle, COLORS.cream, 1);
    const wall = localToWorld(x, z, angle, 0, 0.775);
    ctx.glow.addBox(wall.x, y + 1.56, wall.z, 1.68, 0.62, 0.05, angle, C('#ffe0aa'), 1);
    const awning = localToWorld(x, z, angle, 0, 1.08);
    ctx.props.addBox(
      awning.x,
      y + 2.25,
      awning.z,
      2.6,
      0.08,
      1.25,
      angle,
      vary(rng.pick([COLORS.red, COLORS.green, COLORS.blue]), rng, 0.08),
      1.5,
    );
    // Roof-mounted sign with a dark frame, sitting on the awning.
    ctx.props.addBox(x, y + 2.39, z, 1.4, 0.32, 0.1, angle, C('#241f1b'), 1.5);
    const signFace = localToWorld(x, z, angle, 0, 0.07);
    ctx.glow.addBox(signFace.x, y + 2.39, signFace.z, 1.15, 0.2, 0.04, angle, COLORS.cream, 1);
    this.collision.addBox(x, z, 1.15, 0.82, angle, y, y + 2.35, 'prop', 'edicola', ctx.owner);
    for (let i = 0; i < 4; i++) {
      const p = localToWorld(x, z, angle, -0.6 + i * 0.4, 0.815);
      ctx.props.addBox(p.x, y + 1.52, p.z, 0.3, 0.38, 0.03, angle, vary(rng.pick([COLORS.cream, COLORS.yellow, COLORS.red, COLORS.blue]), rng, 0.1), 1);
    }
  }

  private addParkedCar(ctx: BuildCtx, x: number, y: number, z: number, angle: number, rng: RNG): void {
    const colors = [COLORS.cream, C('#8a2f2a'), C('#2f4a63'), C('#c9c3b8'), C('#3f5a44'), C('#1f2224')];
    const body = vary(rng.pick(colors), rng, 0.08);
    ctx.props.addBox(x, y + 0.55, z, 1.8, 0.55, 4.1, angle, body, 2);
    ctx.props.addBox(x, y + 1.0, z - 0.1, 1.6, 0.5, 2.2, angle, shade(body, 0.9), 2);
    ctx.props.addBox(x, y + 1.03, z - 0.1, 1.5, 0.36, 1.9, angle, COLORS.black, 2);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const p = localToWorld(x, z, angle, sx * 0.85, sz * 1.35);
        ctx.props.addBox(p.x, y + 0.3, p.z, 0.22, 0.6, 0.6, angle, COLORS.black, 1);
      }
    }
    this.collision.addBox(x, z, 1.0, 2.1, angle, y, y + 1.5, 'prop', 'parked', ctx.owner);
  }

  /* -------------------------------------------------------------- */
  /* Landmarks                                                       */
  /* -------------------------------------------------------------- */

  private buildLandmarkBlock(ctx: BuildCtx, city: CityDef, block: Block): void {
    const ground = this.terrain.height(block.x, block.z);
    const top = ground + 0.18;
    const rng = rngForBlock(city, block);
    ctx.paving.addBox(
      block.x,
      ground + 0.09,
      block.z,
      block.width - 8,
      0.18,
      block.depth - 8,
      block.angle,
      COLORS.stoneLight,
      3,
    );
    this.collision.addPlatform(block.x, block.z, (block.width - 8) / 2, (block.depth - 8) / 2, block.angle, top, ctx.owner);
    const angle = city.angle;
    switch (city.landmark) {
      case 'duomo':
        if (city.id === 'milano') this.landmarkDuomoMilano(ctx, block.x, top, block.z, angle, rng);
        else this.landmarkDuomoFirenze(ctx, block.x, top, block.z, angle, rng);
        break;
      case 'colosseo':
        this.landmarkColosseum(ctx, block.x, top, block.z, angle, rng);
        break;
      case 'mole':
        this.landmarkMole(ctx, block.x, top, block.z, angle, rng);
        break;
      case 'campanile':
        this.landmarkCampanile(ctx, block.x, top, block.z, angle, rng);
        break;
      case 'towers':
        this.landmarkTowers(ctx, block.x, top, block.z, angle, rng);
        break;
      case 'port':
        this.landmarkPort(ctx, city, block.x, top, block.z, angle, rng);
        break;
      case 'cattedrale':
        this.landmarkCathedral(ctx, block.x, top, block.z, angle, rng);
        break;
      case 'lungomare':
        this.landmarkLungomare(ctx, block.x, top, block.z, angle, rng);
        break;
      case 'vesuvio':
        this.landmarkVesuvio(ctx, block.x, top, block.z, angle, rng);
        break;
      default:
        this.buildPlaza(ctx, city, block, top, rng);
    }
    // a few trees around the landmark
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const r = block.width * 0.38;
      this.addTree(ctx, block.x + Math.cos(a) * r, top, block.z + Math.sin(a) * r, i % 2 ? 'cypress' : 'palm', rng);
    }
  }

  private landmarkDuomoMilano(ctx: BuildCtx, x: number, y: number, z: number, angle: number, rng: RNG): void {
    const marble = COLORS.marble;
    // nave
    ctx.props.addBox(x, y + 9, z, 24, 18, 20, angle, marble, 4);
    ctx.props.addBox(x, y + 9, z - 15, 18, 18, 12, angle, marble, 4);
    // facade
    ctx.props.addBox(x, y + 9, z + 10.5, 26, 18, 2, angle, shade(marble, 1.02), 3);
    const f = localToWorld(x, z, angle, 0, 10.5);
    ctx.props.addTriangle(
      { x: f.x - 13 * Math.cos(angle), y: y + 18, z: f.z + 13 * Math.sin(angle) },
      { x: f.x + 13 * Math.cos(angle), y: y + 18, z: f.z - 13 * Math.sin(angle) },
      { x: f.x, y: y + 23, z: f.z },
      Math.sin(angle),
      0.2,
      Math.cos(angle),
      { u: 0, v: 0 },
      { u: 3, v: 0 },
      { u: 1.5, v: 1.5 },
      marble,
    );
    // pilasters
    for (let i = -5; i <= 5; i++) {
      const p = localToWorld(x, z, angle, i * 2.2, 11.6);
      ctx.props.addBox(p.x, y + 9, p.z, 0.8, 18, 0.8, angle, shade(marble, 1.06), 1);
    }
    // dome
    ctx.props.addCylinder(x, y + 18, z - 2, 7.5, 4, 8, shade(marble, 1.03), marble);
    ctx.props.addSphere(x, y + 22.5, z - 2, 7.2, shade(marble, 1.05), 10, 6, 0.7);
    ctx.props.addCone(x, y + 27, z - 2, 2.2, 8, 6, C('#7e8a86'));
    // spires
    for (let i = 0; i < 14; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(4, 14);
      const sx = x + Math.cos(a) * r;
      const sz = z - 3 + Math.sin(a) * r;
      ctx.props.addCylinder(sx, y + 17.5, sz, 0.45, 3, 5, marble);
      ctx.props.addCone(sx, y + 20.5, sz, 0.8, rng.range(2.5, 5), 5, shade(marble, 1.04));
    }
    this.collision.addBox(x, z, 13, 11, angle, y, y + 18, 'landmark', 'duomo', ctx.owner);
  }

  private landmarkDuomoFirenze(ctx: BuildCtx, x: number, y: number, z: number, angle: number, rng: RNG): void {
    const marble = COLORS.marble;
    ctx.props.addBox(x, y + 8, z, 26, 16, 18, angle, marble, 4);
    ctx.props.addBox(x, y + 8, z - 12, 16, 16, 10, angle, marble, 4);
    // octagonal dome
    ctx.props.addCylinder(x, y + 16, z, 8, 5, 8, shade(marble, 0.98), marble);
    ctx.props.addSphere(x, y + 21, z, 8, C('#a95b3d'), 12, 7, 0.95);
    ctx.props.addCylinder(x, y + 28, z, 1.4, 4, 6, marble);
    ctx.props.addCone(x, y + 32, z, 1.8, 3, 6, C('#8a8f82'));
    // campanile
    const c = localToWorld(x, z, angle, 15, 6);
    ctx.props.addBox(c.x, y + 20, c.z, 6, 40, 6, angle, shade(marble, 0.97), 3);
    ctx.props.addBox(c.x, y + 40.5, c.z, 6.6, 1.2, 6.6, angle, C('#b9a78a'), 2);
    // facade detail
    for (let i = -4; i <= 4; i++) {
      const p = localToWorld(x, z, angle, i * 2.6, 9.2);
      ctx.props.addBox(p.x, y + 8, p.z, 0.6, 16, 0.5, angle, C('#d9cdb7'), 1);
    }
    this.collision.addBox(x, z, 13, 10, angle, y, y + 17, 'landmark', 'duomo', ctx.owner);
    this.collision.addBox(c.x, c.z, 3, 3, angle, y, y + 40, 'landmark', 'campanile', ctx.owner);
  }

  private landmarkColosseum(ctx: BuildCtx, x: number, y: number, z: number, angle: number, rng: RNG): void {
    const stone = COLORS.travertine;
    const tiers = [8, 15, 22];
    const rx = 30;
    const rz = 22;
    const segments = 36;
    for (let i = 0; i < segments; i++) {
      if (i >= 11 && i <= 14) continue;
      const a0 = (i / segments) * Math.PI * 2 + angle;
      const a1 = ((i + 1) / segments) * Math.PI * 2 + angle;
      const mx = x + Math.cos((a0 + a1) / 2) * rx;
      const mz = z + Math.sin((a0 + a1) / 2) * rz;
      const tangent = Math.atan2(Math.cos((a0 + a1) / 2) * rz, -Math.sin((a0 + a1) / 2) * rx);
      // pier
      ctx.props.addBox(mx, y + 11, mz, 2.2, 22, 3.2, tangent, shade(stone, 0.92 + (i % 3) * 0.03), 3);
      // arches / lintels
      for (const t of tiers) {
        ctx.props.addBox(mx, y + t, mz, 4.4, 1.1, 3.0, tangent, shade(stone, 1.02), 2);
      }
      // outer arch ring segment
      if (i % 2 === 0) {
        ctx.props.addBox(mx, y + 4, mz, 4.2, 1.4, 3.4, tangent, shade(stone, 0.88), 2);
      }
    }
    // inner ring
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + angle;
      const mx = x + Math.cos(a) * (rx * 0.7);
      const mz = z + Math.sin(a) * (rz * 0.7);
      ctx.props.addBox(mx, y + 5, mz, 2.4, 10, 2.4, -a, shade(stone, 0.82), 3);
    }
    // arena floor
    ctx.props.addCylinder(x, y + 0.05, z, 1, 0.1, 24, C('#b9a98c'));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.collision.addBox(x + Math.cos(a) * rx * 0.9, z + Math.sin(a) * rz * 0.9, 6, 4, -a, y, y + 23, 'landmark', 'colosseo', ctx.owner);
    }
    void rng;
  }

  private landmarkMole(ctx: BuildCtx, x: number, y: number, z: number, angle: number, rng: RNG): void {
    const brick = C('#a9744e');
    const stone = COLORS.stoneLight;
    ctx.props.addBox(x, y + 14, z, 14, 28, 14, angle, brick, 3);
    ctx.props.addBox(x, y + 30, z, 12, 4, 12, angle, stone, 3);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const p = localToWorld(x, z, angle, Math.cos(a) * 5.4, Math.sin(a) * 5.4);
      ctx.props.addBox(p.x, y + 33, p.z, 1.4, 4, 1.4, angle, stone, 2);
    }
    ctx.props.addCylinder(x, y + 34, z, 6.5, 5, 8, shade(stone, 1.02), stone);
    ctx.props.addSphere(x, y + 39.5, z, 6.6, C('#7d8a80'), 12, 7, 0.85);
    ctx.props.addCone(x, y + 44, z, 1.8, 12, 6, C('#6f7d74'));
    // wings
    for (const s of [-1, 1]) {
      const p = localToWorld(x, z, angle, s * 11, 0);
      ctx.props.addBox(p.x, y + 8, p.z, 6, 16, 10, angle, shade(brick, 0.94), 3);
    }
    this.collision.addBox(x, z, 8, 8, angle, y, y + 44, 'landmark', 'mole', ctx.owner);
    void rng;
  }

  private landmarkCampanile(ctx: BuildCtx, x: number, y: number, z: number, angle: number, rng: RNG): void {
    const brick = C('#b0714d');
    const stone = COLORS.stoneLight;
    ctx.props.addBox(x, y + 20, z, 8, 40, 8, angle, brick, 4);
    for (let i = 0; i < 4; i++) {
      const p = localToWorld(x, z, angle, Math.cos((i / 4) * Math.PI * 2) * 4.2, Math.sin((i / 4) * Math.PI * 2) * 4.2);
      ctx.props.addBox(p.x, y + 41, p.z, 1.1, 5, 1.1, angle, stone, 2);
    }
    ctx.props.addBox(x, y + 43, z, 9, 5, 9, angle, stone, 3);
    ctx.props.addCone(x, y + 45.5, z, 6.4, 9, 4, C('#3f6b5a'));
    ctx.props.addBox(x, y + 1.2, z, 10, 2.4, 10, angle, shade(stone, 0.96), 3);
    this.collision.addBox(x, z, 5, 5, angle, y, y + 48, 'landmark', 'campanile', ctx.owner);
    void rng;
  }

  private landmarkTowers(ctx: BuildCtx, x: number, y: number, z: number, angle: number, rng: RNG): void {
    const brick = C('#a35f43');
    const p1 = localToWorld(x, z, angle, -7, 0);
    const p2 = localToWorld(x, z, angle, 9, 3);
    for (let i = 0; i < 10; i++) {
      ctx.props.addBox(p1.x + i * 0.28, y + 2.4 + i * 4.8, p1.z, 7 - i * 0.08, 4.8, 7 - i * 0.08, angle, shade(brick, 1 - i * 0.012), 3);
    }
    for (let i = 0; i < 8; i++) {
      ctx.props.addBox(p2.x + i * 0.16, y + 2.2 + i * 4.4, p2.z, 5.6 - i * 0.06, 4.4, 5.6 - i * 0.06, angle, shade(brick, 0.94 - i * 0.01), 3);
    }
    ctx.props.addBox(p1.x + 2.5, y + 49, p1.z, 6, 1, 6, angle, C('#7f4a34'), 2);
    this.collision.addBox(p1.x + 1.4, p1.z, 4, 4, angle, y, y + 49, 'landmark', 'towers', ctx.owner);
    this.collision.addBox(p2.x + 0.8, p2.z, 3.2, 3.2, angle, y, y + 36, 'landmark', 'towers', ctx.owner);
    void rng;
  }

  private landmarkPort(ctx: BuildCtx, city: CityDef, x: number, y: number, z: number, angle: number, rng: RNG): void {
    // find the sea direction
    let seaAngle = angle;
    let best = Infinity;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const px = city.x + Math.cos(a) * city.radius * 0.9;
      const pz = city.z + Math.sin(a) * city.radius * 0.9;
      const d = this.terrain.landDistance(px, pz);
      if (d < best) {
        best = d;
        seaAngle = a;
      }
    }
    const px = city.x + Math.cos(seaAngle) * city.radius * 0.55;
    const pz = city.z + Math.sin(seaAngle) * city.radius * 0.55;
    const py = Math.max(1.2, this.terrain.height(px, pz));
    // warehouses
    for (let i = 0; i < 3; i++) {
      const off = localToWorld(px, pz, seaAngle, (i - 1) * 16, -10);
      ctx.props.addBox(off.x, py + 5, off.z, 12, 10, 20, seaAngle, C('#8a8b83'), 4);
      ctx.roof.addBox(off.x, py + 10.2, off.z, 12.6, 0.4, 20.6, seaAngle, C('#7f8285'), 4);
      this.collision.addBox(off.x, off.z, 6, 10, seaAngle, py, py + 10.5, 'landmark', 'port', ctx.owner);
    }
    // containers
    const containerColors = [C('#a83a2c'), C('#2f5b7a'), C('#c9a34a'), C('#4f7a44'), C('#b0b4b6')];
    for (let i = 0; i < 10; i++) {
      const cx = px + rng.range(-24, 24);
      const cz = pz + rng.range(-24, 24);
      const col = rng.pick(containerColors);
      const h = rng.int(1, 3);
      for (let k = 0; k < h; k++) {
        ctx.props.addBox(cx, py + 1.4 + k * 2.6, cz, 2.4, 2.5, 6, seaAngle + rng.range(-0.1, 0.1), col, 2);
      }
    }
    // cranes
    for (let i = 0; i < 3; i++) {
      const cx = px + (i - 1) * 26;
      const cz = pz - 18;
      ctx.props.addBox(cx, py + 12, cz, 2, 24, 2, seaAngle, C('#c9a34a'), 2);
      ctx.props.addBox(cx + 8, py + 23, cz, 18, 1.2, 1.2, seaAngle, C('#c9a34a'), 2);
      ctx.props.addBox(cx + 17, py + 20, cz, 0.3, 6, 0.3, seaAngle, COLORS.darkMetal, 1);
    }
    // quay
    ctx.paving.addBox(px, py + 0.1, pz, 70, 0.2, 60, seaAngle, COLORS.curb, 3);
    void x;
    void y;
    void z;
  }

  private landmarkCathedral(ctx: BuildCtx, x: number, y: number, z: number, angle: number, rng: RNG): void {
    const stone = C('#d7bd97');
    ctx.props.addBox(x, y + 9, z, 24, 18, 22, angle, stone, 4);
    ctx.props.addBox(x, y + 9, z - 14, 16, 18, 10, angle, stone, 4);
    // towers
    for (const s of [-1, 1]) {
      const p = localToWorld(x, z, angle, s * 12, 10);
      ctx.props.addBox(p.x, y + 14, p.z, 5, 28, 5, angle, shade(stone, 1.03), 3);
      ctx.props.addBox(p.x, y + 28.5, p.z, 5.8, 1.2, 5.8, angle, shade(stone, 1.08), 2);
      ctx.props.addCone(p.x, y + 29, p.z, 2.6, 4, 4, C('#a94f37'));
    }
    // dome
    ctx.props.addCylinder(x, y + 18, z - 2, 6, 4, 8, stone, shade(stone, 1.04));
    ctx.props.addSphere(x, y + 22.5, z - 2, 6.2, C('#b45c3f'), 10, 6, 0.9);
    ctx.props.addCone(x, y + 28, z - 2, 1.2, 3, 5, C('#c9a34a'));
    // arches on facade
    for (let i = -3; i <= 3; i++) {
      const p = localToWorld(x, z, angle, i * 3, 11.2);
      ctx.props.addBox(p.x, y + 9, p.z, 1.2, 14, 0.7, angle, shade(stone, 1.05), 1);
    }
    this.collision.addBox(x, z, 13, 12, angle, y, y + 18, 'landmark', 'cattedrale', ctx.owner);
    void rng;
  }

  private landmarkLungomare(ctx: BuildCtx, x: number, y: number, z: number, angle: number, rng: RNG): void {
    // theatre
    ctx.props.addBox(x, y + 7, z, 26, 14, 18, angle, C('#d8cbb4'), 4);
    ctx.props.addBox(x, y + 14.4, z, 27, 0.8, 19, angle, C('#b8ad98'), 3);
    for (let i = -3; i <= 3; i++) {
      const p = localToWorld(x, z, angle, i * 3.4, 9.2);
      ctx.props.addBox(p.x, y + 7, p.z, 0.5, 13, 0.5, angle, COLORS.white, 1);
    }
    // promenade railing
    for (let i = 0; i < 12; i++) {
      const p = localToWorld(x, z, angle, -30 + i * 5.5, -16);
      ctx.props.addBox(p.x, y + 0.6, p.z, 0.08, 1.2, 0.08, angle, COLORS.darkMetal, 1);
    }
    ctx.props.addBox(x, y + 1.15, z - 16, 66, 0.08, 0.08, angle, COLORS.darkMetal, 1);
    for (let i = 0; i < 6; i++) {
      const p = localToWorld(x, z, angle, -25 + i * 10, -12);
      this.addTree(ctx, p.x, y, p.z, 'palm', rng);
    }
    this.collision.addBox(x, z, 13, 9, angle, y, y + 14, 'landmark', 'lungomare', ctx.owner);
  }

  private landmarkCastello(ctx: BuildCtx, x: number, y: number, z: number, angle: number, rng: RNG): void {
    const stone = C('#b6a98f');
    ctx.props.addBox(x, y + 7, z, 26, 14, 26, angle, stone, 4);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const p = localToWorld(x, z, angle, sx * 12, sz * 12);
        ctx.props.addCylinder(p.x, y, p.z, 3, 16, 8, shade(stone, 0.96), stone);
        ctx.props.addCone(p.x, y + 16, p.z, 3.4, 4, 8, C('#8a4b33'));
        this.collision.addBox(p.x, p.z, 3, 3, angle, y, y + 16, 'landmark', 'castello', ctx.owner);
      }
    }
    // battlements
    for (let i = 0; i < 8; i++) {
      const p = localToWorld(x, z, angle, -12 + i * 3.4, 13);
      ctx.props.addBox(p.x, y + 14.5, p.z, 1.6, 1.2, 0.8, angle, stone, 1);
    }
    this.collision.addBox(x, z, 13, 13, angle, y, y + 15, 'landmark', 'castello', ctx.owner);
    void rng;
  }

  /** Vesuvio: layered cone, crater rim, lava streaks and a drifting plume. */
  private landmarkVesuvio(
    ctx: BuildCtx,
    x: number,
    y: number,
    z: number,
    angle: number,
    rng: RNG,
  ): void {
    const rock = C('#6d635c');
    const dark = C('#453e3a');
    // Two stacked cones read as a broad volcano with a steeper summit.
    ctx.props.addCone(x, y + 23, z, 27, 46, 18, rock);
    ctx.props.addCone(x, y + 47, z, 13, 28, 16, shade(rock, 0.9));
    // Crater rim.
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      ctx.props.addSphere(
        x + Math.cos(a) * 6.2,
        y + 60,
        z + Math.sin(a) * 6.2,
        1.8,
        shade(dark, 1.15),
        8,
        5,
      );
    }
    // Lava streaks down the flank.
    for (let i = 0; i < 6; i++) {
      const a = rng.range(0, Math.PI * 2);
      const p = localToWorld(x, z, angle, Math.cos(a) * 11, Math.sin(a) * 11);
      ctx.props.addCone(p.x, y + 30, p.z, 1.1 + rng.next() * 0.7, 34, 6, C('#a33a22'));
    }
    // Smoke plume that leans with the wind.
    for (let i = 0; i < 7; i++) {
      const drift = i * 1.4;
      ctx.props.addSphere(
        x + drift,
        y + 64 + i * 5.2,
        z + Math.sin(i * 0.9) * 3.5,
        Math.max(1.4, 5.2 - i * 0.5),
        C('#9d9992'),
        9,
        6,
        0.78,
      );
    }
    this.collision.addBox(x, z, 25, 25, angle, y, y + 58, 'landmark', 'vesuvio', ctx.owner);
  }

  /* -------------------------------------------------------------- */
  /* Countryside                                                     */
  /* -------------------------------------------------------------- */

  private buildRural(ctx: BuildCtx, cx: number, cz: number, size: number, detail: number, outskirts = false): void {
    const rng = new RNG((cx * 73856093) ^ (cz * 19349663) ^ 0x9e3779b9);
    const x0 = cx * size;
    const z0 = cz * size;
    const attempts = outskirts ? 18 : detail === 0 ? 34 : 16;
    for (let i = 0; i < attempts; i++) {
      const x = x0 + rng.range(4, size - 4);
      const z = z0 + rng.range(4, size - 4);
      if (x < -2400 || x > 2400 || z < -3200 || z > 3200) continue;
      const land = this.terrain.landDistance(x, z);
      if (land < 30) continue;
      const cityW = this.terrain.cityWeightAt(x, z).weight;
      if (outskirts && cityW > 0.15) continue;
      const slope = this.terrain.slopeAt(x, z);
      if (slope > 0.55) continue;
      const h = this.terrain.height(x, z);
      if (h < 1.2) continue;
      const road = this.roads.sampleRoadHeight(x, z);
      if (road && road.weight > 0.12) continue;
      const lakeD = dist2D(x, z, LAKE.x, LAKE.z);
      if (lakeD < LAKE.radius * 1.25) continue;

      const roll = rng.next();
      if (roll < 0.55) {
        const kind = rng.chance(0.28) ? 'cypress' : rng.chance(0.5) ? 'broadleaf' : 'olive';
        this.addTree(ctx, x, h, z, kind, rng);
        if (rng.chance(0.5)) this.addTree(ctx, x + rng.range(-6, 6), h, z + rng.range(-6, 6), 'cypress', rng);
      } else if (roll < 0.68) {
        // rocks
        const s = rng.range(0.8, 2.4);
        ctx.props.addSphere(x, h + s * 0.35, z, s, C('#8a8175'), 6, 4, 0.7);
      } else if (roll < 0.8) {
        // hay bales
        for (let k = 0; k < rng.int(1, 3); k++) {
          ctx.props.addCylinder(x + k * 1.8, h, z + rng.range(-1, 1), 0.8, 1.2, 8, C('#c9b06a'), C('#d9c27e'));
        }
      } else if (roll < 0.86 && detail === 0) {
        this.buildFarmhouse(ctx, x, h, z, rng);
      } else if (roll < 0.94) {
        // vineyard rows
        const rows = rng.int(2, 4);
        const len = rng.int(3, 6);
        for (let r = 0; r < rows; r++) {
          for (let k = 0; k < len; k++) {
            const vx = x + k * 2.2;
            const vz = z + r * 2.6;
            ctx.props.addBox(vx, h + 0.5, vz, 0.08, 1.0, 0.08, 0, COLORS.wood, 1);
            ctx.props.addSphere(vx, h + 1.15, vz, 0.5, vary(COLORS.leaf, rng, 0.08), 5, 3, 0.8);
          }
        }
      } else {
        // stone wall
        const len = rng.int(2, 6);
        const a = rng.range(0, Math.PI);
        for (let k = 0; k < len; k++) {
          const wx = x + Math.cos(a) * k * 1.4;
          const wz = z + Math.sin(a) * k * 1.4;
          ctx.props.addBox(wx, h + 0.35, wz, 1.4, 0.7, 0.5, a, C('#a89c88'), 2);
        }
      }
    }
  }

  private buildFarmhouse(ctx: BuildCtx, x: number, y: number, z: number, rng: RNG): void {
    const w = rng.range(7, 11);
    const d = rng.range(9, 14);
    const h = rng.range(5, 7);
    const angle = rng.range(0, Math.PI * 2);
    const wall = vary(C('#d8c3a0'), rng, 0.08);
    ctx.props.addBox(x, y + h / 2, z, w, h, d, angle, wall, 3);
    // windows
    for (let i = -1; i <= 1; i++) {
      const p = localToWorld(x, z, angle, i * (w * 0.28), d / 2 + 0.02);
      ctx.props.addBox(p.x, y + h * 0.6, p.z, 1.0, 1.4, 0.08, angle, C('#2f3436'), 1);
      ctx.props.addBox(p.x, y + h * 0.28, p.z, 1.2, 1.8, 0.08, angle, C('#4a3a2a'), 1);
    }
    // gable roof
    const rise = 2.6;
    const hw = w / 2 + 0.6;
    const hd = d / 2 + 0.6;
    const p = (lx: number, lz: number, yy: number): V3 => {
      const wpt = localToWorld(x, z, angle, lx, lz);
      return { x: wpt.x, y: yy, z: wpt.z };
    };
    const roofC = vary(C('#a9603f'), rng, 0.08);
    const nLen = Math.hypot(rise, hd);
    ctx.roof.addQuad(p(-hw, hd, y + h), p(hw, hd, y + h), p(hw, 0, y + h + rise), p(-hw, 0, y + h + rise), Math.sin(angle) * rise / nLen, hd / nLen, Math.cos(angle) * rise / nLen, { u: 0, v: 0 }, { u: w / 3, v: 0 }, { u: w / 3, v: nLen / 3 }, { u: 0, v: nLen / 3 }, roofC);
    ctx.roof.addQuad(p(hw, -hd, y + h), p(-hw, -hd, y + h), p(-hw, 0, y + h + rise), p(hw, 0, y + h + rise), -Math.sin(angle) * rise / nLen, hd / nLen, -Math.cos(angle) * rise / nLen, { u: 0, v: 0 }, { u: w / 3, v: 0 }, { u: w / 3, v: nLen / 3 }, { u: 0, v: nLen / 3 }, roofC);
    this.collision.addBox(x, z, w / 2, d / 2, angle, y, y + h + rise, 'building', 'farmhouse', ctx.owner);
  }
}
