/** Renderer, camera, resize and adaptive resolution. */

import * as THREE from 'three';
import { clamp, damp } from './math';
import { GameSettings, QualityLevel } from './settings';

export class RenderSystem {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;

  private basePixelRatio = 1;
  private resolutionScale = 1;
  private targetScale = 1;
  private frameAccum = 0;
  private frameCount = 0;
  private quality: QualityLevel = 'auto';
  private lowFpsTime = 0;
  private highFpsTime = 0;
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement, settings: GameSettings) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      depth: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x0a0d10, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.35, 9000);
    this.camera.position.set(0, 20, 0);

    // Phones: filling a 3x buffer on a mid-range GPU is the fastest way to lose
    // the frame budget, so cap the backing store lower on touch devices.
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, coarse ? 1.6 : 2);
    this.quality = settings.quality;
    this.resolutionScale = settings.resolutionScale;
    this.targetScale = this.resolutionScale;
    this.applyQuality();
    this.resize();
  }

  get aspect(): number {
    return this.width / Math.max(1, this.height);
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth || window.innerWidth;
    const h = parent?.clientHeight || window.innerHeight;
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    const dpr = this.basePixelRatio * this.resolutionScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  setQuality(q: QualityLevel): void {
    this.quality = q;
    this.applyQuality();
    this.resize();
  }

  private applyQuality(): void {
    const q = this.quality;
    if (q === 'low') {
      this.renderer.shadowMap.enabled = false;
      this.targetScale = 0.7;
    } else if (q === 'medium') {
      this.renderer.shadowMap.enabled = true;
      this.targetScale = 0.9;
    } else if (q === 'high') {
      this.renderer.shadowMap.enabled = true;
      this.targetScale = Math.min(1.25, this.basePixelRatio);
    } else {
      this.targetScale = 1;
    }
    // The explicit presets must change the backing-store size, not only the
    // shadow flag: resize() reads resolutionScale, so keep the two in sync.
    this.resolutionScale = this.targetScale;
  }

  /** Call once per frame with the frame delta; adjusts resolution adaptively. */
  updateAdaptive(dt: number): void {
    if (this.quality !== 'auto') return;
    if (dt <= 0 || dt > 0.25) return;
    this.frameAccum += dt;
    this.frameCount++;
    if (this.frameAccum < 1.5) return;
    const avg = this.frameAccum / this.frameCount;
    this.frameAccum = 0;
    this.frameCount = 0;
    if (avg > 0.037) {
      this.lowFpsTime += 1.5;
      this.highFpsTime = 0;
    } else if (avg < 0.023) {
      this.highFpsTime += 1.5;
      this.lowFpsTime = 0;
    } else {
      this.lowFpsTime = Math.max(0, this.lowFpsTime - 0.75);
      this.highFpsTime = Math.max(0, this.highFpsTime - 0.75);
    }
    if (this.lowFpsTime >= 3 && this.resolutionScale > 0.62) {
      this.resolutionScale = clamp(this.resolutionScale - 0.12, 0.62, 1.3);
      this.lowFpsTime = 0;
      this.resize();
    } else if (this.highFpsTime >= 6 && this.resolutionScale < 1.2) {
      this.resolutionScale = clamp(this.resolutionScale + 0.08, 0.62, 1.2);
      this.highFpsTime = 0;
      this.resize();
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

/** Smoothly update FOV when settings change. */
export function updateFov(camera: THREE.PerspectiveCamera, targetFov: number, dt: number): void {
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov = damp(camera.fov, targetFov, 8, dt);
    camera.updateProjectionMatrix();
  }
}
