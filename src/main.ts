/**
 * VFC 1 — entry point.
 * Loads settings, builds the renderer and the world, then hands control to Game.
 */

import { applyMobilePreset, hasStoredSettings, settings } from './core/settings';
import { Game } from './core/game';
import { clamp01 } from './core/math';
import { RenderSystem } from './core/renderer';
import { World } from './world/world';

async function boot(): Promise<void> {
  settings.load();

  // Mobile quality must land before World.build(): decoration is baked per chunk.
  const forceMobile = new URLSearchParams(window.location.search).get('mobile') === '1';
  const touchDevice =
    window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  if (forceMobile) {
    applyMobilePreset();
    settings.value.metrics = true;
  } else if (touchDevice && !hasStoredSettings()) {
    applyMobilePreset();
  }

  const canvas = document.getElementById('game-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Canvas di gioco mancante.');
  const bootFill = document.getElementById('boot-fill');
  const bootStatus = document.getElementById('boot-status');

  const setProgress = (fraction: number, label: string): void => {
    if (bootFill) bootFill.style.width = `${Math.round(clamp01(fraction) * 100)}%`;
    if (bootStatus) bootStatus.textContent = label;
  };

  const render = new RenderSystem(canvas, settings.value);
  const world = new World(render.scene);
  await world.build(setProgress);

  new Game(render, world).hideBoot();
}

boot().catch((err: unknown) => {
  console.error('[vfc1] boot failed', err);
  const status = document.getElementById('boot-status');
  if (status) {
    status.textContent = `Impossibile avviare il gioco: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
});
