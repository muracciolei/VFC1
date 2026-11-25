/** Local progression persistence (localStorage). */

export interface OwnedVehicle {
  id: string;
  type: string;
  color: string;
  garage: string;
  plate: string;
}

export interface PlayerStats {
  distanceDriven: number;
  carsStolen: number;
  policeEscapes: number;
  kills: number;
  missionsDone: number;
  moneyEarned: number;
  playtime: number;
}

export interface MissionProgressData {
  id: string;
  /** Display name, stored so the main menu can describe the save on its own. */
  title?: string;
  stepIndex: number;
  stepTotal?: number;
  stepTimer: number;
  timeLeft: number | null;
  targetDestroyed: boolean;
  /** Timer currently shown in the HUD, if any. */
  timer?: number | null;
}

export interface ActiveMissionSummary {
  title: string;
  stepIndex: number;
  stepTotal: number;
  timer: number | null;
}

export interface SaveSummary {
  cash: number;
  missions: number;
  playtime: number;
  updatedAt: number;
  mission: ActiveMissionSummary | null;
}

export interface SaveData {
  version: number;
  updatedAt: number;
  createdAt: number;
  player: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    health: number;
    armor: number;
  };
  cash: number;
  wanted: number;
  ownedVehicles: OwnedVehicle[];
  activeVehicle: { type: string; color: string } | null;
  weapons: Record<string, { owned: boolean; ammo: number }>;
  missionStates: Record<string, 'locked' | 'available' | 'active' | 'done'>;
  activeMission: string | null;
  activeMissionProgress: MissionProgressData | null;
  collectibles: string[];
  safehouse: string;
  stats: PlayerStats;
  timeOfDay: number;
  weather: string;
  region: string;
  storyStage: number;
}

const SAVE_KEY = 'vfc1.save.v1';

export function createNewSave(x: number, z: number): SaveData {
  return {
    version: 2,
    updatedAt: Date.now(),
    createdAt: Date.now(),
    player: { x, y: 0, z, yaw: 0, health: 100, armor: 0 },
    cash: 500,
    wanted: 0,
    ownedVehicles: [],
    activeVehicle: null,
    weapons: {
      pistol: { owned: true, ammo: 36 },
      smg: { owned: false, ammo: 0 },
      shotgun: { owned: false, ammo: 0 },
    },
    missionStates: {},
    activeMission: null,
    activeMissionProgress: null,
    collectibles: [],
    safehouse: 'milano',
    stats: {
      distanceDriven: 0,
      carsStolen: 0,
      policeEscapes: 0,
      kills: 0,
      missionsDone: 0,
      moneyEarned: 0,
      playtime: 0,
    },
    timeOfDay: 8.25,
    weather: 'clear',
    region: 'milano',
    storyStage: 0,
  };
}

class SaveManager {
  hasSave(): boolean {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  }

  load(): SaveData | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as Partial<SaveData>;
      if (!data || typeof data !== 'object' || !data.player) return null;
      const base = createNewSave(data.player.x ?? 0, data.player.z ?? 0);
      return {
        ...base,
        ...data,
        player: { ...base.player, ...data.player },
        stats: { ...base.stats, ...data.stats },
        weapons: { ...base.weapons, ...data.weapons },
        missionStates: { ...base.missionStates, ...data.missionStates },
        ownedVehicles: data.ownedVehicles ?? [],
        activeMissionProgress: data.activeMissionProgress ?? null,
        collectibles: data.collectibles ?? [],
        version: 2,
      };
    } catch (err) {
      console.warn('[save] failed to load', err);
      return null;
    }
  }

  save(data: SaveData): void {
    try {
      data.updatedAt = Date.now();
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('[save] failed to write', err);
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
  }

  summary(): SaveSummary | null {
    const data = this.load();
    if (!data) return null;
    return {
      cash: data.cash,
      missions: data.stats.missionsDone,
      playtime: data.stats.playtime,
      updatedAt: data.updatedAt,
      mission: summarizeActiveMission(data),
    };
  }
}

/** Compact mission description for the main menu, or null when none is active. */
function summarizeActiveMission(data: SaveData): ActiveMissionSummary | null {
  const progress = data.activeMissionProgress;
  if (!progress || data.missionStates[progress.id] !== 'active') return null;
  if (typeof progress.title !== 'string' || progress.title.length === 0) return null;
  const stepTotal = Number.isFinite(progress.stepTotal)
    ? Math.round(progress.stepTotal as number)
    : 0;
  if (stepTotal <= 0) return null;
  const rawIndex = Number.isFinite(progress.stepIndex) ? Math.round(progress.stepIndex) : 0;
  const timer =
    typeof progress.timer === 'number' && Number.isFinite(progress.timer)
      ? Math.max(0, progress.timer)
      : progress.stepTimer > 0
        ? progress.stepTimer
        : typeof progress.timeLeft === 'number' && Number.isFinite(progress.timeLeft)
          ? Math.max(0, progress.timeLeft)
          : null;
  return {
    title: progress.title,
    stepIndex: Math.min(Math.max(rawIndex, 0), stepTotal - 1),
    stepTotal,
    timer,
  };
}

export const saveManager = new SaveManager();
