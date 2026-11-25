/**
 * Full-screen map of Mini Italia with POIs, roads, cities and waypoint picking.
 */

import { TAU, Vec2 } from '../core/math';
import { CITIES, FERRY_ROUTE, MAINLAND, POIKind, SICILY, WORLD } from '../world/config';
import { World } from '../world/world';
import { RoadSegment } from '../world/roadnetwork';
import { Player } from '../entities/player';
import type { MissionMarker, Waypoint } from './hud';

const POI_COLORS: Record<POIKind, string> = {
  safehouse: '#6fdc8c',
  garage: '#e8b25a',
  gunshop: '#e0674f',
  hospital: '#f2f2f2',
  police: '#6f9be8',
  shop: '#c9a7e8',
  airport: '#8fd4e8',
  port: '#63b6c9',
  gas: '#d9d26f',
  viewpoint: '#e8d0a0',
  collectible: '#ffd489',
  mission: '#ffd489',
  race: '#ff9a6a',
  taxi: '#f0d24a',
  landmark: '#f0e2c0',
};

export class BigMap {
  private canvas = document.getElementById('bigmap') as HTMLCanvasElement | null;
  private ctx: CanvasRenderingContext2D;
  private info = document.getElementById('map-info') as HTMLElement | null;
  private confirmBtn = document.getElementById('btn-map-waypoint') as HTMLButtonElement | null;
  private legend = document.getElementById('map-legend') as HTMLElement | null;
  private closeBtn = document.getElementById('btn-map-close') as HTMLButtonElement | null;

  private pending: Waypoint | null = null;
  private selectedPoi: string | null = null;
  private waypoint: Waypoint | null = null;
  private mission: MissionMarker | null = null;
  private playerX = 0;
  private playerZ = 0;
  private playerYaw = 0;
  private world: World;
  private onSet: (wp: Waypoint) => void;
  private onClose: () => void;

  constructor(
    world: World,
    callbacks: { onSetWaypoint: (wp: Waypoint) => void; onClose: () => void },
  ) {
    this.world = world;
    this.onSet = callbacks.onSetWaypoint;
    this.onClose = callbacks.onClose;
    if (!this.canvas) throw new Error('Missing #bigmap');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Big map 2D context unavailable');
    this.ctx = ctx;
    this.buildLegend();

    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const rect = this.canvas!.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * this.canvas!.width;
      const y = ((e.clientY - rect.top) / rect.height) * this.canvas!.height;
      this.pick(x, y);
    });

    this.confirmBtn?.addEventListener('click', () => {
      if (!this.pending) return;
      this.waypoint = { ...this.pending };
      this.onSet(this.waypoint);
      this.onClose();
    });
    this.closeBtn?.addEventListener('click', () => this.onClose());
  }

  private buildLegend(): void {
    if (!this.legend) return;
    const entries: Array<[POIKind, string]> = [
      ['mission', 'Missione'],
      ['safehouse', 'Casa sicura'],
      ['garage', 'Garage'],
      ['gunshop', 'Armeria'],
      ['hospital', 'Ospedale'],
      ['police', 'Polizia'],
      ['shop', 'Emporio'],
      ['airport', 'Aeroporto'],
      ['port', 'Porto'],
      ['viewpoint', 'Panorama'],
    ];
    this.legend.innerHTML = '';
    for (const [kind, label] of entries) {
      const span = document.createElement('span');
      span.textContent = label;
      span.style.setProperty('--dot', POI_COLORS[kind]);
      this.legend.appendChild(span);
    }
  }

  /* -------------------------------------------------------------- */
  /* Projection                                                      */
  /* -------------------------------------------------------------- */

  private project(x: number, z: number): { x: number; y: number } {
    const w = this.canvas!.width;
    const h = this.canvas!.height;
    const pad = 46;
    const scale = Math.min((w - pad * 2) / (WORLD.maxX - WORLD.minX), (h - pad * 2) / (WORLD.maxZ - WORLD.minZ));
    const ox = (w - (WORLD.maxX - WORLD.minX) * scale) / 2;
    const oy = (h - (WORLD.maxZ - WORLD.minZ) * scale) / 2;
    return {
      x: ox + (x - WORLD.minX) * scale,
      y: oy + (z - WORLD.minZ) * scale,
    };
  }

  private unproject(px: number, py: number): { x: number; z: number } {
    const w = this.canvas!.width;
    const h = this.canvas!.height;
    const pad = 46;
    const scale = Math.min((w - pad * 2) / (WORLD.maxX - WORLD.minX), (h - pad * 2) / (WORLD.maxZ - WORLD.minZ));
    const ox = (w - (WORLD.maxX - WORLD.minX) * scale) / 2;
    const oy = (h - (WORLD.maxZ - WORLD.minZ) * scale) / 2;
    return {
      x: (px - ox) / scale + WORLD.minX,
      z: (py - oy) / scale + WORLD.minZ,
    };
  }

  /* -------------------------------------------------------------- */
  /* Rendering                                                       */
  /* -------------------------------------------------------------- */

  render(player: Player, waypoint: Waypoint | null, mission: MissionMarker | null): void {
    this.playerX = player.position.x;
    this.playerZ = player.position.z;
    this.playerYaw = player.yaw;
    this.waypoint = waypoint;
    this.mission = mission;
    if (!this.pending && waypoint) this.pending = { ...waypoint };
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!canvas) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#0e161b');
    bg.addColorStop(0.55, '#0a1215');
    bg.addColorStop(1, '#080d10');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 60) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // land
    for (const poly of [MAINLAND, SICILY]) {
      ctx.beginPath();
      poly.forEach((p: Vec2, i: number) => {
        const q = this.project(p.x, p.z);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.closePath();
      ctx.fillStyle = '#1f2b25';
      ctx.fill();
      ctx.strokeStyle = '#46564a';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // roads
    const segs: RoadSegment[] = [];
    this.world.roads.segmentsInRect(WORLD.minX, WORLD.minZ, WORLD.maxX, WORLD.maxZ, segs);
    for (const seg of segs) {
      if (seg.points.length < 2) continue;
      if (seg.roadClass === 'alley') continue;
      ctx.beginPath();
      for (let i = 0; i < seg.points.length; i++) {
        const p = this.project(seg.points[i].x, seg.points[i].z);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      if (seg.roadClass === 'highway') {
        ctx.strokeStyle = 'rgba(214, 196, 148, 0.7)';
        ctx.lineWidth = 2.4;
      } else if (seg.roadClass === 'arterial') {
        ctx.strokeStyle = 'rgba(170, 162, 140, 0.5)';
        ctx.lineWidth = 1.3;
      } else {
        ctx.strokeStyle = 'rgba(120, 118, 106, 0.32)';
        ctx.lineWidth = 0.7;
      }
      ctx.stroke();
    }

    // ferry route
    const ferryA = this.project(FERRY_ROUTE.from.x, FERRY_ROUTE.from.z);
    const ferryB = this.project(FERRY_ROUTE.to.x, FERRY_ROUTE.to.z);
    ctx.setLineDash([6, 7]);
    ctx.strokeStyle = 'rgba(111, 227, 212, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(ferryA.x, ferryA.y);
    ctx.lineTo(ferryB.x, ferryB.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // city rings + labels
    for (const city of CITIES) {
      const c = this.project(city.x, city.z);
      const edge = this.project(city.x + city.radius, city.z);
      const r = Math.abs(edge.x - c.x);
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, TAU);
      ctx.fillStyle = 'rgba(232, 178, 90, 0.05)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(232, 178, 90, 0.18)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#f2ede3';
      ctx.font = '600 15px Rajdhani, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(city.name, c.x, c.y - 8);
      ctx.fillStyle = 'rgba(242, 237, 227, 0.4)';
      ctx.font = '10px Arial, sans-serif';
      ctx.fillText(city.region, c.x, c.y + 8);
    }

    // POIs
    for (const poi of this.world.pois) {
      const p = this.project(poi.x, poi.z);
      const color = POI_COLORS[poi.kind];
      const selected = this.selectedPoi === poi.id;
      ctx.beginPath();
      if (poi.kind === 'mission') {
        drawStar(ctx, p.x, p.y, 6, 3, color);
      } else if (poi.kind === 'airport' || poi.kind === 'port') {
        ctx.fillStyle = color;
        ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
      } else {
        ctx.fillStyle = color;
        ctx.arc(p.x, p.y, poi.kind === 'safehouse' ? 4.4 : 3.4, 0, TAU);
        ctx.fill();
      }
      if (selected) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 9, 0, TAU);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // waypoint + mission markers
    if (this.waypoint) {
      const p = this.project(this.waypoint.x, this.waypoint.z);
      drawDiamond(ctx, p.x, p.y, 11, '#6fe3d4');
      ctx.fillStyle = 'rgba(111, 227, 212, 0.9)';
      ctx.font = '600 11px Rajdhani, Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(this.waypoint.name, p.x + 10, p.y + 4);
    }
    if (this.mission) {
      const p = this.project(this.mission.x, this.mission.z);
      drawDiamond(ctx, p.x, p.y, this.mission.giver ? 8 : 12, '#ffd489');
    }

    // pending waypoint
    if (this.pending && this.pending !== this.waypoint) {
      const p = this.project(this.pending.x, this.pending.z);
      drawDiamond(ctx, p.x, p.y, 9, '#ffffff');
    }

    // player
    const pp = this.project(this.playerX, this.playerZ);
    ctx.save();
    ctx.translate(pp.x, pp.y);
    ctx.rotate(this.playerYaw + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /* -------------------------------------------------------------- */
  /* Picking                                                         */
  /* -------------------------------------------------------------- */

  private pick(px: number, py: number): void {
    let best: { id: string; x: number; z: number; name: string; dist: number } | null = null;
    for (const poi of this.world.pois) {
      const p = this.project(poi.x, poi.z);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < 18 && (!best || d < best.dist)) {
        best = { id: poi.id, x: poi.x, z: poi.z, name: poi.name, dist: d };
      }
    }
    if (best) {
      this.selectedPoi = best.id;
      this.pending = { x: best.x, z: best.z, name: best.name };
      if (this.info) {
        const poi = this.world.pois.find((p) => p.id === best!.id);
        this.info.textContent = `${best.name}${poi?.description ? ` — ${poi.description}` : ''}`;
      }
    } else {
      const world = this.unproject(px, py);
      const c = this.world.clampToWorld(world.x, world.z);
      const city = this.world.nearestCityName(c.x, c.z);
      this.selectedPoi = null;
      this.pending = { x: c.x, z: c.z, name: `Punto segnato · ${city}` };
      if (this.info) {
        this.info.textContent = `Destinazione libera vicino a ${city}.`;
      }
    }
    if (this.confirmBtn) this.confirmBtn.disabled = false;
    this.draw();
  }

  get currentWaypoint(): Waypoint | null {
    return this.waypoint;
  }

  resetPending(): void {
    this.pending = this.waypoint ? { ...this.waypoint } : null;
    this.selectedPoi = null;
    if (this.info) this.info.textContent = "Tocca un'icona per impostare il navigatore.";
  }
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1.5;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.strokeRect(-size / 2, -size / 2, size, size);
  ctx.restore();
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outer: number,
  inner: number,
  color: string,
): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

void 0;
