/** Compact performance overlay for device checks (mobile / low preset). */

import * as THREE from 'three';
import { GameSettings, QualityLevel } from '../core/settings';

const QUALITY_LABEL: Record<QualityLevel, string> = {
  auto: 'AUTO',
  low: 'BASSA',
  medium: 'MEDIA',
  high: 'ALTA',
};

/** Refresh rate of the readout; the frame loop still runs every frame. */
const REFRESH = 0.25;

interface Row {
  root: HTMLElement;
  value: HTMLElement;
}

export class MetricsOverlay {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly root: HTMLElement;
  private readonly rows = new Map<string, Row>();
  private frames = 0;
  private elapsed = 0;
  private visible = false;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.root = document.createElement('div');
    this.root.id = 'perf-overlay';
    this.root.className = 'perf-overlay hidden';

    const labels: Array<[string, string]> = [
      ['fps', 'FPS'],
      ['draw', 'DRAW'],
      ['tri', 'TRIANGOLI'],
      ['res', 'RES'],
      ['quality', 'QUALITÀ'],
      ['entities', 'PED / VEICOLI'],
    ];
    for (const [key, label] of labels) {
      const row = document.createElement('div');
      row.className = 'perf-overlay__row';
      const name = document.createElement('span');
      name.textContent = label;
      const value = document.createElement('b');
      value.textContent = '—';
      row.append(name, value);
      this.root.appendChild(row);
      this.rows.set(key, { root: row, value });
    }

    // Living inside #hud makes it fade out with the HUD (menu/screens).
    (document.getElementById('hud') ?? document.body).appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.root.classList.toggle('hidden', !visible);
    this.frames = 0;
    this.elapsed = 0;
  }

  update(
    dt: number,
    settings: GameSettings,
    counts: { peds: number; vehicles: number },
  ): void {
    if (!this.visible) return;
    // Ignore tab-restore spikes: the game loop clamps dt, the overlay needs the
    // raw delta to report real frame times.
    if (dt > 0 && dt < 1) {
      this.elapsed += dt;
      this.frames++;
    }
    if (this.elapsed < REFRESH) return;

    const fps = this.frames / this.elapsed;
    const ms = (this.elapsed / Math.max(1, this.frames)) * 1000;
    const info = this.renderer.info.render;
    const canvas = this.renderer.domElement;

    this.set('fps', `${Math.round(fps)} · ${ms.toFixed(1)} ms`, fps < 30 ? 'bad' : fps < 50 ? 'warn' : '');
    this.set('draw', String(info.calls));
    this.set('tri', formatTriangles(info.triangles));
    this.set(
      'res',
      `${canvas.width}×${canvas.height} @${this.renderer.getPixelRatio().toFixed(2)}x`,
    );
    this.set('quality', `${QUALITY_LABEL[settings.quality]} · OMBRE ${settings.shadows ? 'ON' : 'OFF'}`);
    this.set('entities', `${counts.peds} / ${counts.vehicles}`);

    this.elapsed = 0;
    this.frames = 0;
  }

  private set(key: string, text: string, tone = ''): void {
    const row = this.rows.get(key);
    if (!row) return;
    row.value.textContent = text;
    row.root.classList.toggle('is-warn', tone === 'warn');
    row.root.classList.toggle('is-bad', tone === 'bad');
  }
}

function formatTriangles(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
