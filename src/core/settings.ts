/** Persistent user settings. */

export type QualityLevel = 'auto' | 'low' | 'medium' | 'high';
export type TouchLayout = 'standard' | 'compact' | 'oneHand';

export interface GameSettings {
  sensitivity: number;
  aimSensitivity: number;
  invertY: boolean;
  cameraDistance: number;
  fov: number;
  quality: QualityLevel;
  shadows: boolean;
  resolutionScale: number;
  joystickScale: number;
  joystickSide: 'left' | 'right';
  touchLayout: TouchLayout;
  autoAccelerate: boolean;
  steeringAssist: boolean;
  musicVolume: number;
  sfxVolume: number;
  engineVolume: number;
  subtitles: boolean;
  showHints: boolean;
  vibration: boolean;
  metrics: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  sensitivity: 1,
  aimSensitivity: 0.7,
  invertY: false,
  cameraDistance: 1,
  fov: 68,
  quality: 'auto',
  shadows: true,
  resolutionScale: 1,
  joystickScale: 1,
  joystickSide: 'left',
  touchLayout: 'standard',
  autoAccelerate: false,
  steeringAssist: true,
  musicVolume: 0.45,
  sfxVolume: 0.8,
  engineVolume: 0.7,
  subtitles: true,
  showHints: true,
  vibration: true,
  metrics: false,
};

const KEY = 'vfc1.settings.v1';

class SettingsManager {
  value: GameSettings = { ...DEFAULT_SETTINGS };

  load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<GameSettings>;
        this.value = { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch {
      this.value = { ...DEFAULT_SETTINGS };
    }
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* storage may be unavailable */
    }
  }

  reset(): void {
    this.value = { ...DEFAULT_SETTINGS };
    this.save();
  }
}

export const settings = new SettingsManager();

/**
 * Preset for checking the build on a real phone: bakes a lighter city, drops
 * shadows and turns the performance overlay on. It must be applied before the
 * world is built, because decoration is baked into the chunk meshes.
 */
export const MOBILE_PRESET: Partial<GameSettings> = {
  quality: 'low',
  shadows: false,
  metrics: false,
};

export function applyMobilePreset(): void {
  Object.assign(settings.value, MOBILE_PRESET);
  settings.save();
}

/** True once the player has saved settings at least once. */
export function hasStoredSettings(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}
