/**
 * World facade: owns terrain, roads, collision, streaming and points of interest.
 */

import * as THREE from 'three';
import { clamp, dist2D } from '../core/math';
import { settings } from '../core/settings';
import {
  CITIES,
  CITY_POI_IDS,
  CityDef,
  LAKE,
  PLAYER_SPAWN,
  POI,
  POIKind,
  POIS,
  WORLD,
  nearestCity,
  regionNameAt,
} from './config';
import { Terrain } from './terrain';
import { RoadNetwork } from './roadnetwork';
import { CollisionWorld } from './collision';
import { TextureLibrary } from './textures';
import { MaterialLibrary } from './materials';
import { CityBuilder } from './city';
import { ROAD_LIFT, buildFarTerrain, buildLake, buildRoadMeshes, buildSea, buildTerrainChunk } from './meshes';

export const CHUNK = 300;
const TERRAIN_RADIUS = 2;
const CITY_LOAD_RADIUS = 1450;
const CITY_UNLOAD_RADIUS = 1950;

function yieldFrame(): Promise<void> {
  // Race rAF with a timer: rAF lets the browser paint the progress bar, but it
  // is paused in background tabs, so a timer fallback keeps loading alive.
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    if (typeof document === 'undefined' || !document.hidden) {
      requestAnimationFrame(() => window.setTimeout(done, 0));
    }
    window.setTimeout(done, 48);
  });
}

interface ChunkRecord {
  group: THREE.Group;
  terrain: boolean;
  rural: boolean;
}

interface SectorRecord {
  group: THREE.Group;
  detail: number;
  city: CityDef;
  sector: number;
}

type BuildTask =
  | { key: string; kind: 'terrain' | 'rural' }
  | { key: string; kind: 'sector'; city: CityDef; sector: number; detail: number };

export class World {
  readonly scene: THREE.Scene;
  readonly terrain: Terrain;
  readonly roads: RoadNetwork;
  readonly collision: CollisionWorld;
  readonly textures: TextureLibrary;
  readonly materials: MaterialLibrary;
  readonly cityBuilder: CityBuilder;
  readonly pois: POI[] = [];
  readonly sea: THREE.Mesh;
  readonly lake: THREE.Mesh;
  readonly roadSurface: THREE.Mesh;
  readonly roadMarkings: THREE.Mesh;
  readonly roadRails: THREE.Mesh | null;
  readonly farTerrain: THREE.Mesh;

  private farNearCenter: THREE.Vector2;
  private chunks = new Map<string, ChunkRecord>();
  private sectors = new Map<string, SectorRecord>();
  private queue: BuildTask[] = [];
  private lastChunkX = 999999;
  private lastChunkZ = 999999;
  private initialStreamDone = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.terrain = new Terrain();
    this.roads = new RoadNetwork(this.terrain);
    this.collision = new CollisionWorld();
    this.textures = new TextureLibrary();
    this.materials = new MaterialLibrary(this.textures);
    this.cityBuilder = new CityBuilder(this.terrain, this.roads, this.materials, this.collision);

    this.roadSurface = new THREE.Mesh(new THREE.BufferGeometry(), this.materials.asphalt);
    this.roadMarkings = new THREE.Mesh(new THREE.BufferGeometry(), this.materials.markings);
    this.roadRails = null;
    // The far terrain is a coarse backdrop (35 m cells) and its interpolated
    // surface can sit above the asphalt and the 15 m streamed chunks, hiding the
    // streets. Clip it to the area outside those chunks so it only fills the
    // horizon, while still writing depth for distant scenery.
    this.farNearCenter = new THREE.Vector2();
    const nearCenter = this.farNearCenter;
    const farMaterial = this.materials.terrain.clone();
    farMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uNearCenter = { value: nearCenter };
      shader.uniforms.uNearHalf = { value: (TERRAIN_RADIUS + 0.5) * CHUNK };
      shader.vertexShader = `varying vec3 vFarWorld;\n${shader.vertexShader}`.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n  vFarWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
      shader.fragmentShader =
        `uniform vec2 uNearCenter;\nuniform float uNearHalf;\nvarying vec3 vFarWorld;\n${shader.fragmentShader}`.replace(
          '#include <clipping_planes_fragment>',
          '#include <clipping_planes_fragment>\n  if (abs(vFarWorld.x - uNearCenter.x) < uNearHalf && abs(vFarWorld.z - uNearCenter.y) < uNearHalf) discard;',
        );
    };
    this.farTerrain = new THREE.Mesh(new THREE.BufferGeometry(), farMaterial);
    this.farTerrain.renderOrder = -5;
    this.sea = buildSea(this.materials);
    this.lake = buildLake(this.materials, LAKE.x, LAKE.z, LAKE.radius * 0.92, LAKE.waterLevel);
  }

  /* -------------------------------------------------------------- */
  /* Initialisation                                                  */
  /* -------------------------------------------------------------- */

  build(onProgress: (fraction: number, label: string) => void): Promise<void> {
    return this.buildAsync(onProgress);
  }

  private async buildAsync(onProgress: (fraction: number, label: string) => void): Promise<void> {
    onProgress(0.04, 'Disegno la penisola…');
    await yieldFrame();
    onProgress(0.12, 'Stendo l’asfalto…');
    this.roads.build();
    this.cityBuilder.prepare();
    await yieldFrame();
    onProgress(0.42, 'Costruisco le città…');

    const meshes = buildRoadMeshes(this.roads, this.materials);
    this.roadSurface.geometry.dispose();
    this.roadSurface.geometry = meshes.surface.geometry;
    this.roadSurface.receiveShadow = true;
    this.roadSurface.matrixAutoUpdate = false;
    this.scene.add(this.roadSurface);

    this.roadMarkings.geometry.dispose();
    this.roadMarkings.geometry = meshes.markings.geometry;
    this.roadMarkings.matrixAutoUpdate = false;
    this.scene.add(this.roadMarkings);

    if (meshes.rail) {
      const rails = meshes.rail;
      rails.matrixAutoUpdate = false;
      this.scene.add(rails);
      (this as { roadRails: THREE.Mesh | null }).roadRails = rails;
    }

    const farGeo = buildFarTerrain(this.terrain, 7800, 220);
    this.farTerrain.geometry.dispose();
    this.farTerrain.geometry = farGeo;
    this.farTerrain.position.set(0, 0, -100);
    this.farTerrain.receiveShadow = false;
    this.farTerrain.matrixAutoUpdate = false;
    this.farTerrain.updateMatrix();
    this.scene.add(this.farTerrain);

    this.scene.add(this.sea);
    this.scene.add(this.lake);
    await yieldFrame();

    onProgress(0.6, 'Posiziono i monumenti…');
    this.snapPois();
    this.pois.push(...POIS);
    await yieldFrame();

    onProgress(0.7, 'Sveglio la città…');
    this.streamImmediate(PLAYER_SPAWN.x, PLAYER_SPAWN.z);
    this.initialStreamDone = true;
    await yieldFrame();
    onProgress(0.95, 'Ci siamo quasi…');
    await yieldFrame();
  }

  /** Build all chunks in the load radius synchronously (used during boot). */
  private streamImmediate(px: number, pz: number): void {
    const cx = Math.floor(px / CHUNK);
    const cz = Math.floor(pz / CHUNK);
    for (let oz = -TERRAIN_RADIUS; oz <= TERRAIN_RADIUS; oz++) {
      for (let ox = -TERRAIN_RADIUS; ox <= TERRAIN_RADIUS; ox++) {
        this.ensureChunk(cx + ox, cz + oz, false);
      }
    }
    for (const city of CITIES) {
      if (dist2D(px, pz, city.x, city.z) < CITY_LOAD_RADIUS) {
        for (let s = 0; s < 4; s++) this.ensureSector(city, s, px, pz);
      }
    }
  }

  /* -------------------------------------------------------------- */
  /* Streaming                                                       */
  /* -------------------------------------------------------------- */

  private ensureChunk(cx: number, cz: number, asyncBuild: boolean): void {
    const key = `${cx},${cz}`;
    let rec = this.chunks.get(key);
    if (!rec) {
      rec = { group: new THREE.Group(), terrain: false, rural: false };
      this.chunks.set(key, rec);
    }
    if (!rec.terrain) {
      if (asyncBuild) {
        if (!this.queue.some((q) => q.key === key && q.kind === 'terrain')) {
          this.queue.push({ key, kind: 'terrain' });
        }
      } else {
        this.buildTerrain(cx, cz, rec);
      }
    }
    if (!rec.rural) {
      const x = (cx + 0.5) * CHUNK;
      const z = (cz + 0.5) * CHUNK;
      let inCity = false;
      for (const c of CITIES) {
        if (dist2D(x, z, c.x, c.z) < c.radius * 1.15) {
          inCity = true;
          break;
        }
      }
      if (!inCity) {
        if (asyncBuild) {
          if (!this.queue.some((q) => q.key === key && q.kind === 'rural')) {
            this.queue.push({ key, kind: 'rural' });
          }
        } else {
          this.buildRural(cx, cz, rec);
        }
      } else {
        rec.rural = true;
      }
    }
  }

  private buildTerrain(cx: number, cz: number, rec: ChunkRecord): void {
    const geo = buildTerrainChunk(this.terrain, cx * CHUNK, cz * CHUNK, CHUNK, {
      segments: 20,
      highDetail: true,
    });
    const mesh = new THREE.Mesh(geo, this.materials.terrain);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    rec.group.add(mesh);
    rec.terrain = true;
    if (rec.group.parent === null) this.scene.add(rec.group);
  }

  private buildRural(cx: number, cz: number, rec: ChunkRecord): void {
    const group = this.cityBuilder.buildRuralChunk(cx, cz, CHUNK, 0);
    if (group) {
      rec.group.add(group);
      if (rec.group.parent === null) this.scene.add(rec.group);
    }
    rec.rural = true;
  }

  /**
   * City LOD: the quadrant under the player keeps full detail; quadrants that
   * are already far away are baked without street furniture and rooftop props.
   * Low quality tightens the threshold so phones get a lighter skyline.
   */
  private desiredSectorDetail(city: CityDef, sector: number, px: number, pz: number): number {
    const sx = sector % 2 === 0 ? -1 : 1;
    const sz = sector < 2 ? -1 : 1;
    const cx = city.x + sx * city.radius * 0.5;
    const cz = city.z + sz * city.radius * 0.5;
    const threshold = settings.value.quality === 'low' ? 330 : 560;
    return dist2D(px, pz, cx, cz) < threshold ? 0 : 1;
  }

  private buildSector(city: CityDef, sector: number, detail: number): void {
    const key = `${city.id}:${sector}`;
    const group = this.cityBuilder.buildCitySector(city, sector, detail);
    const rec: SectorRecord = {
      group: group ?? new THREE.Group(),
      detail,
      city,
      sector,
    };
    if (group) this.scene.add(group);
    this.sectors.set(key, rec);
  }

  private ensureSector(city: CityDef, sector: number, px: number, pz: number): void {
    const key = `${city.id}:${sector}`;
    const desired = this.desiredSectorDetail(city, sector, px, pz);
    const rec = this.sectors.get(key);
    if (rec) {
      // Only pay for an upgrade. Lowering detail can wait for the next unload.
      if (desired < rec.detail) {
        if (!this.queue.some((q) => q.key === key && q.kind === 'sector')) {
          this.queue.push({ key, kind: 'sector', city, sector, detail: desired });
        }
      }
      return;
    }
    this.buildSector(city, sector, desired);
  }

  private unloadChunk(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    const rec = this.chunks.get(key);
    if (!rec) return;
    this.scene.remove(rec.group);
    rec.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    this.collision.removeByOwner(key);
    this.chunks.delete(key);
  }

  private unloadSector(city: CityDef, sector: number): void {
    const key = `${city.id}:${sector}`;
    const rec = this.sectors.get(key);
    if (!rec) return;
    this.scene.remove(rec.group);
    rec.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    this.collision.removeByOwner(key);
    this.sectors.delete(key);
  }

  private rebuildSector(city: CityDef, sector: number, detail: number): void {
    this.unloadSector(city, sector);
    this.buildSector(city, sector, detail);
  }

  update(px: number, pz: number, dt: number): void {
    const cx = Math.floor(px / CHUNK);
    const cz = Math.floor(pz / CHUNK);

    if (cx !== this.lastChunkX || cz !== this.lastChunkZ) {
      this.lastChunkX = cx;
      this.lastChunkZ = cz;
      // keep the backdrop hole aligned with the streamed terrain square
      this.farNearCenter.set((cx + 0.5) * CHUNK, (cz + 0.5) * CHUNK);
      const wanted = new Set<string>();
      for (let oz = -TERRAIN_RADIUS; oz <= TERRAIN_RADIUS; oz++) {
        for (let ox = -TERRAIN_RADIUS; ox <= TERRAIN_RADIUS; ox++) {
          wanted.add(`${cx + ox},${cz + oz}`);
          this.ensureChunk(cx + ox, cz + oz, this.initialStreamDone);
        }
      }
      for (const key of [...this.chunks.keys()]) {
        if (!wanted.has(key)) {
          const [kx, kz] = key.split(',').map(Number);
          this.unloadChunk(kx, kz);
        }
      }
      // sectors
      for (const city of CITIES) {
        const d = dist2D(px, pz, city.x, city.z);
        if (d < CITY_LOAD_RADIUS) {
          for (let s = 0; s < 4; s++) this.ensureSector(city, s, px, pz);
        } else if (d > CITY_UNLOAD_RADIUS) {
          for (let s = 0; s < 4; s++) this.unloadSector(city, s);
        }
      }
    }

    // process a small amount of queued work per frame
    const budget = performance.now() + 4;
    while (this.queue.length > 0 && performance.now() < budget) {
      const task = this.queue.shift();
      if (!task) break;
      if (task.kind === 'sector') {
        this.rebuildSector(task.city, task.sector, task.detail);
        continue;
      }
      const [cx2, cz2] = task.key.split(',').map(Number);
      const rec = this.chunks.get(task.key);
      if (!rec) continue;
      if (task.kind === 'terrain' && !rec.terrain) this.buildTerrain(cx2, cz2, rec);
      if (task.kind === 'rural' && !rec.rural) this.buildRural(cx2, cz2, rec);
    }

    // animate water
    const waterUniforms = this.materials.water.uniforms;
    if (waterUniforms.uTime) waterUniforms.uTime.value += dt;
    void px;
    void pz;
  }

  /* -------------------------------------------------------------- */
  /* Queries                                                         */
  /* -------------------------------------------------------------- */

  groundHeight(x: number, z: number): number {
    let h = this.terrain.height(x, z);
    const platform = this.collision.platformHeightAt(x, z);
    if (platform !== null && platform > h) h = platform;
    const road = this.roads.sampleRoadHeight(x, z);
    // Only stand on the asphalt itself: past its edge the ground is the graded
    // shoulder, which sits below the road slab.
    if (road && road.dist <= road.width * 0.5 + 0.3) h = Math.max(h, road.height + ROAD_LIFT + 0.02);
    return h;
  }

  /** Ground without sidewalk/road lift, for placing objects. */
  naturalHeight(x: number, z: number): number {
    return this.terrain.height(x, z);
  }

  isWater(x: number, z: number): boolean {
    if (this.lakeIsWater(x, z)) return true;
    return this.terrain.height(x, z) < WORLD.seaLevel + 0.1;
  }

  lakeIsWater(x: number, z: number): boolean {
    return dist2D(x, z, LAKE.x, LAKE.z) < LAKE.radius * 0.92;
  }

  waterLevelAt(x: number, z: number): number {
    if (this.lakeIsWater(x, z)) return LAKE.waterLevel;
    return WORLD.seaLevel;
  }

  regionAt(x: number, z: number): { name: string; city: CityDef | null } {
    return regionNameAt(x, z);
  }

  cityAt(x: number, z: number): CityDef | null {
    for (const c of CITIES) {
      if (dist2D(x, z, c.x, c.z) < c.radius) return c;
    }
    return null;
  }

  nearestPoi(x: number, z: number, kinds?: POIKind[], maxDist = 30): POI | null {
    let best: POI | null = null;
    let bestD = maxDist;
    for (const poi of this.pois) {
      if (kinds && !kinds.includes(poi.kind)) continue;
      const d = dist2D(x, z, poi.x, poi.z);
      if (d < bestD) {
        bestD = d;
        best = poi;
      }
    }
    return best;
  }

  poisOfKind(kind: POIKind): POI[] {
    return this.pois.filter((p) => p.kind === kind);
  }

  /** Place city POIs on a reachable sidewalk next to a block. */
  /**
   * Place city POIs on the street grid. Every POI gets its own node so the
   * garage / armeria / ospedale of a city do not collapse onto the same spot.
   */
  private snapPois(): void {
    const placed: { cityId: string; x: number; z: number; landmark: boolean }[] = [];
    const MIN_SEP = 48;
    const LANDMARK_SEP = 70;
    const RADIUS_LADDER = [260, 420, 700];

    // Hand-placed landmarks keep their coordinates, but they still block the
    // grid so a snapped city POI never lands on top of them.
    for (const poi of POIS) {
      if (CITY_POI_IDS.has(poi.id)) continue;
      placed.push({ cityId: poi.cityId, x: poi.x, z: poi.z, landmark: true });
    }

    for (const poi of POIS) {
      if (!CITY_POI_IDS.has(poi.id)) continue;
      const city = CITIES.find((c) => c.id === poi.cityId);
      if (!city) continue;
      const grid = this.roads.cityGrids.get(city.id);
      if (!grid || !grid.blocks.length) continue;
      const cityNodes = this.roads.nodes.filter((n) => n.cityId === city.id);
      if (!cityNodes.length) continue;

      const rank = (maxDist: number): { x: number; z: number }[] =>
        cityNodes
          .map((n) => ({ x: n.x, z: n.z, d: dist2D(n.x, n.z, poi.x, poi.z) }))
          .filter((c) => c.d <= maxDist)
          .sort((a, b) => a.d - b.d)
          .map(({ x, z }) => ({ x, z }));

      let chosen: { x: number; z: number } | null = null;
      for (const maxDist of RADIUS_LADDER) {
        for (const cand of rank(maxDist)) {
          const clash = placed.some(
            (p) =>
              p.cityId === city.id &&
              dist2D(p.x, p.z, cand.x, cand.z) < (p.landmark ? LANDMARK_SEP : MIN_SEP),
          );
          if (!clash) {
            chosen = cand;
            break;
          }
        }
        if (chosen) break;
      }
      // Last resort: the closest node of the city, even if it overlaps another POI.
      if (!chosen) chosen = rank(RADIUS_LADDER[RADIUS_LADDER.length - 1])[0] ?? null;
      if (!chosen) continue;

      let bestBlock: { x: number; z: number } | null = null;
      let bestD = Infinity;
      for (const b of grid.blocks) {
        const d = dist2D(b.x, b.z, chosen.x, chosen.z);
        if (d < bestD) {
          bestD = d;
          bestBlock = b;
        }
      }
      if (!bestBlock) continue;
      const dx = bestBlock.x - chosen.x;
      const dz = bestBlock.z - chosen.z;
      const len = Math.hypot(dx, dz) || 1;
      const off = 7.2;
      poi.x = chosen.x + (dx / len) * off;
      poi.z = chosen.z + (dz / len) * off;
      placed.push({ cityId: city.id, x: poi.x, z: poi.z, landmark: false });
    }
  }

  spawnPoint(): { x: number; z: number; yaw: number } {
    return PLAYER_SPAWN;
  }

  get loadedChunkCount(): number {
    return this.chunks.size;
  }

  get loadedSectorCount(): number {
    return this.sectors.size;
  }

  /** Nearest drivable road position to a point (for spawning vehicles). */
  nearestRoadPoint(x: number, z: number): { x: number; z: number; yaw: number } | null {
    const node = this.roads.nearestNode(x, z, 400);
    if (!node) return null;
    const link = node.links[0];
    if (!link) return { x: node.x, z: node.z, yaw: 0 };
    const pts = this.roads.getLinkPoints(this.roads.links[link]);
    const a = pts[0];
    const b = pts[Math.min(1, pts.length - 1)];
    return { x: node.x, z: node.z, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
  }

  clampToWorld(x: number, z: number): { x: number; z: number } {
    return {
      x: clamp(x, WORLD.minX + 20, WORLD.maxX - 20),
      z: clamp(z, WORLD.minZ + 20, WORLD.maxZ - 20),
    };
  }

  nearestCityName(x: number, z: number): string {
    return nearestCity(x, z).name;
  }
}
