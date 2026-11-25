/**
 * Procedural canvas textures. Everything is generated at runtime, no external
 * assets. Textures are neutral so buildings can be tinted with vertex colors.
 */

import * as THREE from 'three';
import { RNG, clamp01 } from '../core/math';

function canvas2d(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return { c, g };
}

function toTexture(c: HTMLCanvasElement, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function grain(g: CanvasRenderingContext2D, w: number, h: number, rng: RNG, amount: number, alpha = 0.08): void {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * amount * 255;
    d[i] = clamp01((d[i] + n) / 255) * 255;
    d[i + 1] = clamp01((d[i + 1] + n) / 255) * 255;
    d[i + 2] = clamp01((d[i + 2] + n) / 255) * 255;
  }
  g.putImageData(img, 0, 0);
  void alpha;
}

function softNoise(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  rng: RNG,
  count: number,
  colors: string[],
  radius: number,
  alpha: number,
): void {
  g.save();
  g.globalAlpha = alpha;
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[(rng.next() * colors.length) | 0];
    g.beginPath();
    g.arc(rng.range(0, w), rng.range(0, h), rng.range(radius * 0.3, radius), 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/* ------------------------------------------------------------------ */
/* Facades                                                             */
/* ------------------------------------------------------------------ */

type FacadeStyle =
  | 'classic'
  | 'modern'
  | 'brick'
  | 'ornate'
  | 'coastal'
  | 'medieval'
  | 'barocco';

const FACADE_SIZE = 512;
const FLOORS = 4;
const BAYS = 4;

function drawFacade(style: FacadeStyle, seed: number): { base: HTMLCanvasElement; emissive: HTMLCanvasElement } {
  const rng = new RNG(seed);
  const { c, g } = canvas2d(FACADE_SIZE, FACADE_SIZE);
  const { c: ec, g: eg } = canvas2d(FACADE_SIZE, FACADE_SIZE);

  // New styles reuse a base treatment but get their own wall colour and seed.
  const visual: FacadeStyle =
    style === 'medieval' ? 'brick' : style === 'barocco' ? 'ornate' : style;

  const wallColors: Record<FacadeStyle, string> = {
    classic: '#e6ddcd',
    modern: '#d9d8d3',
    brick: '#c98b67',
    ornate: '#e9e0cf',
    coastal: '#efe4d0',
    medieval: '#b9a184',
    barocco: '#f0e2c4',
  };

  g.fillStyle = wallColors[style];
  g.fillRect(0, 0, FACADE_SIZE, FACADE_SIZE);
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, FACADE_SIZE, FACADE_SIZE);

  // plaster variation
  softNoise(g, FACADE_SIZE, FACADE_SIZE, rng, 160, ['#00000010', '#ffffff12', '#00000008'], 34, 0.5);
  grain(g, FACADE_SIZE, FACADE_SIZE, rng, 0.055);

  // horizontal plaster bands
  g.globalAlpha = 0.1;
  for (let y = 0; y < FACADE_SIZE; y += 128) {
    g.fillStyle = '#7a6a55';
    g.fillRect(0, y + 120, FACADE_SIZE, 2);
    g.fillStyle = '#ffffff';
    g.fillRect(0, y + 122, FACADE_SIZE, 2);
  }
  g.globalAlpha = 1;

  if (visual === 'brick') {
    for (let row = 0; row < 64; row++) {
      const y = row * 8;
      const offset = row % 2 ? 8 : 0;
      for (let col = -1; col < 32; col++) {
        const x = col * 16 + offset;
        g.fillStyle = rng.chance(0.5) ? '#b57652' : rng.chance(0.5) ? '#c98b67' : '#a96744';
        g.fillRect(x + 1, y + 1, 14, 6);
      }
    }
    g.globalAlpha = 0.18;
    g.fillStyle = '#4a2c1e';
    for (let row = 0; row < 64; row++) g.fillRect(0, row * 8, FACADE_SIZE, 1);
    g.globalAlpha = 1;
  }

  if (visual === 'modern') {
    // concrete panel grid
    g.strokeStyle = 'rgba(80,80,80,0.28)';
    g.lineWidth = 2;
    for (let i = 0; i <= BAYS; i++) {
      g.beginPath();
      g.moveTo(i * (FACADE_SIZE / BAYS), 0);
      g.lineTo(i * (FACADE_SIZE / BAYS), FACADE_SIZE);
      g.stroke();
    }
    for (let j = 0; j <= FLOORS; j++) {
      g.beginPath();
      g.moveTo(0, j * (FACADE_SIZE / FLOORS));
      g.lineTo(FACADE_SIZE, j * (FACADE_SIZE / FLOORS));
      g.stroke();
    }
  }

  const cellW = FACADE_SIZE / BAYS;
  const cellH = FACADE_SIZE / FLOORS;

  for (let f = 0; f < FLOORS; f++) {
    for (let b = 0; b < BAYS; b++) {
      const cx = b * cellW + cellW / 2;
      const cy = f * cellH + cellH * 0.52;

      let winW = cellW * 0.4;
      let winH = cellH * 0.52;
      if (visual === 'modern') {
        winW = cellW * 0.72;
        winH = cellH * 0.58;
      }
      if (visual === 'coastal') {
        winW = cellW * 0.44;
        winH = cellH * 0.5;
      }
      if (style === 'medieval') {
        winW = cellW * 0.3;
        winH = cellH * 0.42;
      }
      if (style === 'barocco') {
        winW = cellW * 0.5;
        winH = cellH * 0.62;
      }

      const x = cx - winW / 2;
      const y = cy - winH / 2;

      // lintel / frame
      g.fillStyle = visual === 'modern' ? '#8f8f8a' : '#cfc4b1';
      g.fillRect(x - 5, y - 6, winW + 10, winH + 12);
      g.fillStyle = '#8a7f6d';
      g.fillRect(x - 6, y + winH + 4, winW + 12, 4);

      // glass
      const glass = g.createLinearGradient(x, y, x + winW, y + winH);
      if (visual === 'modern') {
        glass.addColorStop(0, '#4f6b78');
        glass.addColorStop(0.45, '#7e9aa5');
        glass.addColorStop(1, '#2f424b');
      } else {
        glass.addColorStop(0, '#2e3a3d');
        glass.addColorStop(0.5, '#455457');
        glass.addColorStop(1, '#1f282a');
      }
      g.fillStyle = glass;
      g.fillRect(x, y, winW, winH);

      // reflection streak
      g.globalAlpha = 0.22;
      g.fillStyle = '#dce8ea';
      g.beginPath();
      g.moveTo(x, y + winH);
      g.lineTo(x + winW * 0.55, y);
      g.lineTo(x + winW * 0.78, y);
      g.lineTo(x + winW * 0.2, y + winH);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;

      // mullions
      g.fillStyle = '#6a6255';
      g.fillRect(x + winW / 2 - 1, y, 2, winH);
      if (style !== 'modern') g.fillRect(x, y + winH * 0.55, winW, 2);

      // shutters
      if (visual === 'classic' || visual === 'ornate' || visual === 'coastal') {
        const shutterW = winW * 0.3;
        g.fillStyle = visual === 'coastal' ? '#6d7f6a' : visual === 'ornate' ? '#5b4a3a' : '#4a5a4c';
        g.fillRect(x - shutterW - 4, y - 2, shutterW, winH + 4);
        g.fillRect(x + winW + 4, y - 2, shutterW, winH + 4);
        g.strokeStyle = 'rgba(0,0,0,0.28)';
        g.lineWidth = 1;
        for (let s = 0; s < 6; s++) {
          const sy = y + 4 + s * (winH / 6);
          g.beginPath();
          g.moveTo(x - shutterW - 4, sy);
          g.lineTo(x - 4, sy);
          g.stroke();
          g.beginPath();
          g.moveTo(x + winW + 4, sy);
          g.lineTo(x + winW + shutterW + 4, sy);
          g.stroke();
        }
      }

      // balcony rail for ornate style
      if (visual === 'ornate') {
        g.fillStyle = 'rgba(38,32,26,0.85)';
        g.fillRect(x - 10, y + winH + 10, winW + 20, 3);
        g.fillRect(x - 10, y + winH + 10, 2, 18);
        g.fillRect(x + winW + 8, y + winH + 10, 2, 18);
        for (let r = 0; r < 7; r++) {
          g.fillRect(x - 8 + r * ((winW + 16) / 7), y + winH + 12, 1.5, 16);
        }
      }

      // emissive lit window chance
      if (rng.chance(visual === 'modern' ? 0.22 : 0.3)) {
        const warm = rng.chance(0.15) ? '#ffb46a' : '#ffd79a';
        eg.fillStyle = warm;
        eg.globalAlpha = rng.range(0.55, 1);
        eg.fillRect(x + 2, y + 2, winW - 4, winH - 4);
        eg.globalAlpha = 1;
        // curtain silhouette
        if (rng.chance(0.4)) {
          eg.fillStyle = 'rgba(40,24,10,0.55)';
          eg.fillRect(x + 2, y + 2, winW * rng.range(0.2, 0.45), winH - 4);
        }
        // mullion shadow
        eg.fillStyle = 'rgba(0,0,0,0.6)';
        eg.fillRect(x + winW / 2 - 1, y, 2, winH);
      }
    }
  }

  // grime at the bottom
  const grime = g.createLinearGradient(0, FACADE_SIZE * 0.82, 0, FACADE_SIZE);
  grime.addColorStop(0, 'rgba(50,40,30,0)');
  grime.addColorStop(1, 'rgba(50,40,30,0.25)');
  g.fillStyle = grime;
  g.fillRect(0, 0, FACADE_SIZE, FACADE_SIZE);

  return { base: c, emissive: ec };
}

/* ------------------------------------------------------------------ */
/* Ground & surfaces                                                   */
/* ------------------------------------------------------------------ */

function drawAsphalt(seed: number): HTMLCanvasElement {
  const rng = new RNG(seed);
  const { c, g } = canvas2d(256, 256);
  g.fillStyle = '#3c3d3e';
  g.fillRect(0, 0, 256, 256);
  softNoise(g, 256, 256, rng, 700, ['#2c2d2e', '#48494a', '#333436', '#525355'], 3.2, 0.35);
  grain(g, 256, 256, rng, 0.14);
  // cracks
  g.strokeStyle = 'rgba(20,20,20,0.35)';
  g.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    let x = rng.range(0, 256);
    let y = rng.range(0, 256);
    g.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += rng.range(-18, 18);
      y += rng.range(-18, 18);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // patch repairs
  g.fillStyle = 'rgba(30,30,32,0.3)';
  g.fillRect(20, 160, 80, 46);
  g.fillStyle = 'rgba(90,90,92,0.05)';
  g.fillRect(150, 30, 70, 50);
  return c;
}

function drawSidewalk(seed: number): HTMLCanvasElement {
  const rng = new RNG(seed);
  const { c, g } = canvas2d(256, 256);
  g.fillStyle = '#9d978c';
  g.fillRect(0, 0, 256, 256);
  const tile = 32;
  for (let y = 0; y < 256; y += tile) {
    const off = (y / tile) % 2 ? tile / 2 : 0;
    for (let x = -tile; x < 256 + tile; x += tile) {
      const v = rng.range(-14, 14);
      g.fillStyle = `rgb(${157 + v},${151 + v},${140 + v})`;
      g.fillRect(x + off + 1, y + 1, tile - 2, tile - 2);
    }
  }
  g.strokeStyle = 'rgba(60,55,48,0.3)';
  g.lineWidth = 1;
  for (let y = 0; y <= 256; y += tile) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
  softNoise(g, 256, 256, rng, 90, ['#6b665e', '#c2bcb0'], 6, 0.12);
  grain(g, 256, 256, rng, 0.06);
  return c;
}

function drawGrass(seed: number): HTMLCanvasElement {
  const rng = new RNG(seed);
  const { c, g } = canvas2d(256, 256);
  g.fillStyle = '#5d6f3c';
  g.fillRect(0, 0, 256, 256);
  softNoise(g, 256, 256, rng, 500, ['#4d5f31', '#6c7f47', '#7a8a50', '#46592d'], 7, 0.5);
  g.strokeStyle = 'rgba(38,52,25,0.5)';
  g.lineWidth = 1;
  for (let i = 0; i < 900; i++) {
    const x = rng.range(0, 256);
    const y = rng.range(0, 256);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + rng.range(-2, 2), y - rng.range(2, 6));
    g.stroke();
  }
  grain(g, 256, 256, rng, 0.08);
  return c;
}

function drawRock(seed: number): HTMLCanvasElement {
  const rng = new RNG(seed);
  const { c, g } = canvas2d(256, 256);
  g.fillStyle = '#8a8175';
  g.fillRect(0, 0, 256, 256);
  softNoise(g, 256, 256, rng, 420, ['#6f675c', '#a29a8c', '#7c7468', '#b1a898'], 9, 0.45);
  g.strokeStyle = 'rgba(50,45,38,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i < 18; i++) {
    g.beginPath();
    let x = rng.range(0, 256);
    let y = rng.range(0, 256);
    g.moveTo(x, y);
    for (let s = 0; s < 3; s++) {
      x += rng.range(-24, 24);
      y += rng.range(6, 26);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  grain(g, 256, 256, rng, 0.1);
  return c;
}

function drawSand(seed: number): HTMLCanvasElement {
  const rng = new RNG(seed);
  const { c, g } = canvas2d(256, 256);
  g.fillStyle = '#cbb98f';
  g.fillRect(0, 0, 256, 256);
  softNoise(g, 256, 256, rng, 360, ['#bda87b', '#d8c79d', '#c2b085'], 6, 0.4);
  grain(g, 256, 256, rng, 0.1);
  return c;
}

function drawRoof(seed: number): HTMLCanvasElement {
  const rng = new RNG(seed);
  const { c, g } = canvas2d(256, 256);
  g.fillStyle = '#9a5237';
  g.fillRect(0, 0, 256, 256);
  const rowH = 22;
  const tileW = 30;
  for (let row = 0; row < 12; row++) {
    const y = row * rowH;
    const off = row % 2 ? tileW / 2 : 0;
    for (let x = -tileW; x < 256 + tileW; x += tileW) {
      const shade = rng.range(-22, 22);
      g.fillStyle = `rgb(${158 + shade},${84 + shade * 0.6},${56 + shade * 0.4})`;
      g.beginPath();
      g.moveTo(x + off, y);
      g.lineTo(x + off + tileW, y);
      g.lineTo(x + off + tileW - 3, y + rowH - 2);
      g.quadraticCurveTo(x + off + tileW / 2, y + rowH + 3, x + off + 3, y + rowH - 2);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(60,26,14,0.35)';
      g.lineWidth = 1;
      g.stroke();
    }
  }
  softNoise(g, 256, 256, rng, 60, ['#5d2f1e', '#c97a54'], 10, 0.15);
  grain(g, 256, 256, rng, 0.07);
  return c;
}

function drawShopfront(seed: number): HTMLCanvasElement {
  const rng = new RNG(seed);
  const { c, g } = canvas2d(512, 256);
  g.fillStyle = '#d9cdb8';
  g.fillRect(0, 0, 512, 256);
  grain(g, 512, 256, rng, 0.05);

  const bays = 4;
  const bw = 512 / bays;
  for (let i = 0; i < bays; i++) {
    const x = i * bw;
    // awning
    const awningColor = ['#7a3a2e', '#2f5b4a', '#5a4a2f', '#3d4d63'][i % 4];
    g.fillStyle = awningColor;
    g.beginPath();
    g.moveTo(x + 8, 34);
    g.lineTo(x + bw - 8, 34);
    g.lineTo(x + bw - 2, 64);
    g.lineTo(x + 2, 64);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.15)';
    for (let s = 0; s < 4; s++) {
      g.fillRect(x + 12 + s * (bw / 4), 34, bw / 8, 30);
    }
    // sign
    g.fillStyle = 'rgba(30,26,22,0.75)';
    g.fillRect(x + 20, 8, bw - 40, 20);
    g.fillStyle = 'rgba(232,210,170,0.85)';
    for (let s = 0; s < 4; s++) g.fillRect(x + 28 + s * 18, 15, 10, 5);

    // window / door
    const wy = 72;
    const wh = 158;
    g.fillStyle = '#3a3a36';
    g.fillRect(x + 12, wy, bw - 24, wh);
    const glass = g.createLinearGradient(x, wy, x + bw, wy + wh);
    glass.addColorStop(0, 'rgba(90,110,116,0.55)');
    glass.addColorStop(0.5, 'rgba(160,180,185,0.25)');
    glass.addColorStop(1, 'rgba(60,75,80,0.5)');
    g.fillStyle = glass;
    g.fillRect(x + 16, wy + 4, bw - 32, wh - 8);
    // interior warm glow
    g.fillStyle = 'rgba(230,170,90,0.16)';
    g.fillRect(x + 16, wy + 4, bw - 32, wh - 8);
    // door
    g.fillStyle = '#4a382a';
    g.fillRect(x + bw / 2 - 18, wy + 30, 36, wh - 30);
    g.fillStyle = 'rgba(20,15,10,0.5)';
    g.fillRect(x + bw / 2 - 14, wy + 38, 28, wh - 42);
    // frame
    g.strokeStyle = '#8a7c66';
    g.lineWidth = 4;
    g.strokeRect(x + 12, wy, bw - 24, wh);
  }
  return c;
}

function drawWood(seed: number): HTMLCanvasElement {
  const rng = new RNG(seed);
  const { c, g } = canvas2d(128, 128);
  g.fillStyle = '#6b4a2e';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 22; i++) {
    g.strokeStyle = `rgba(${30 + rng.range(0, 40)},${20 + rng.range(0, 25)},${10 + rng.range(0, 15)},0.35)`;
    g.lineWidth = rng.range(1, 3);
    g.beginPath();
    const y = rng.range(0, 128);
    g.moveTo(0, y);
    g.bezierCurveTo(40, y + rng.range(-8, 8), 90, y + rng.range(-8, 8), 128, y + rng.range(-5, 5));
    g.stroke();
  }
  grain(g, 128, 128, rng, 0.08);
  return c;
}

function drawConcrete(seed: number): HTMLCanvasElement {
  const rng = new RNG(seed);
  const { c, g } = canvas2d(128, 128);
  g.fillStyle = '#a8a49b';
  g.fillRect(0, 0, 128, 128);
  softNoise(g, 128, 128, rng, 120, ['#8f8b82', '#bcb8ae'], 5, 0.3);
  grain(g, 128, 128, rng, 0.08);
  return c;
}

function drawLightPool(): HTMLCanvasElement {
  const { c, g } = canvas2d(128, 128);
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,220,160,0.9)');
  grad.addColorStop(0.35, 'rgba(255,205,130,0.35)');
  grad.addColorStop(0.7, 'rgba(255,190,110,0.1)');
  grad.addColorStop(1, 'rgba(255,180,100,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

/* ------------------------------------------------------------------ */
/* Library                                                             */
/* ------------------------------------------------------------------ */

export const FACADE_STYLES: FacadeStyle[] = [
  'classic',
  'modern',
  'brick',
  'ornate',
  'coastal',
  'medieval',
  'barocco',
];
export const FACADE_ATLAS_COLS = 4;
export const FACADE_ATLAS_ROWS = 2;

export class TextureLibrary {
  readonly facadeAtlas: THREE.Texture;
  readonly facadeEmissiveAtlas: THREE.Texture;
  readonly roof: THREE.Texture;
  readonly asphalt: THREE.Texture;
  readonly sidewalk: THREE.Texture;
  readonly grass: THREE.Texture;
  readonly rock: THREE.Texture;
  readonly sand: THREE.Texture;
  readonly shopfront: THREE.Texture;
  readonly wood: THREE.Texture;
  readonly concrete: THREE.Texture;
  readonly lightPool: THREE.Texture;

  constructor() {
    const seeds: Record<FacadeStyle, number> = {
      classic: 101,
      modern: 202,
      brick: 303,
      ornate: 404,
      coastal: 505,
      medieval: 606,
      barocco: 707,
    };
    const atlas = canvas2d(FACADE_ATLAS_COLS * FACADE_SIZE, FACADE_ATLAS_ROWS * FACADE_SIZE);
    const atlasE = canvas2d(FACADE_ATLAS_COLS * FACADE_SIZE, FACADE_ATLAS_ROWS * FACADE_SIZE);
    atlas.g.fillStyle = '#e6ddcd';
    atlas.g.fillRect(0, 0, atlas.c.width, atlas.c.height);
    atlasE.g.fillStyle = '#000';
    atlasE.g.fillRect(0, 0, atlasE.c.width, atlasE.c.height);
    FACADE_STYLES.forEach((style, i) => {
      const { base, emissive: em } = drawFacade(style, seeds[style]);
      const col = i % FACADE_ATLAS_COLS;
      const row = Math.floor(i / FACADE_ATLAS_COLS);
      atlas.g.drawImage(base, col * FACADE_SIZE, row * FACADE_SIZE);
      atlasE.g.drawImage(em, col * FACADE_SIZE, row * FACADE_SIZE);
    });
    this.facadeAtlas = toTexture(atlas.c, false);
    this.facadeEmissiveAtlas = toTexture(atlasE.c, false);
    this.roof = toTexture(drawRoof(606));
    this.asphalt = toTexture(drawAsphalt(707));
    this.sidewalk = toTexture(drawSidewalk(808));
    this.grass = toTexture(drawGrass(909));
    this.rock = toTexture(drawRock(1010));
    this.sand = toTexture(drawSand(1111));
    this.shopfront = toTexture(drawShopfront(1212));
    this.wood = toTexture(drawWood(1313));
    this.concrete = toTexture(drawConcrete(1414));
    this.lightPool = toTexture(drawLightPool(), false);
  }

  setAnisotropy(value: number): void {
    this.facadeAtlas.anisotropy = value;
    this.facadeEmissiveAtlas.anisotropy = value;
    this.roof.anisotropy = value;
    this.asphalt.anisotropy = value;
    this.sidewalk.anisotropy = value;
    this.grass.anisotropy = value;
    this.rock.anisotropy = value;
    this.sand.anisotropy = value;
    this.shopfront.anisotropy = value;
    this.wood.anisotropy = value;
    this.concrete.anisotropy = value;
    this.lightPool.anisotropy = value;
  }
}

export type { FacadeStyle };

