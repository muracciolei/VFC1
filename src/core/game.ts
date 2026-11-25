/**
 * VFC 1 — game orchestrator.
 * Owns the world session, screen flow, economy, interactions and the frame loop.
 */

import { settings } from './settings';
import { createNewSave, OwnedVehicle, saveManager, SaveData } from './save';
import { events } from './events';
import { clamp, clamp01, dist2D, formatCash, TAU } from './math';
import { InputSystem } from './input';
import { RenderSystem, updateFov } from './renderer';
import { World } from '../world/world';
import { Environment, WeatherKind } from '../world/environment';
import { FERRY_ROUTE, POI, POIKind, PLAYER_SPAWN } from '../world/config';
import { Player, WEAPONS, WeaponId } from '../entities/player';
import { ThirdPersonCamera } from '../entities/camera';
import { Vehicle, VEHICLE_TYPES, VehicleTypeId } from '../entities/vehicle';
import { VehicleSystem } from '../systems/vehicles';
import { PedestrianSystem } from '../systems/pedestrians';
import { PoliceSystem } from '../systems/police';
import { CombatSystem } from '../systems/combat';
import { MissionSystem } from '../systems/missions';
import { NavigationSystem } from '../systems/navigation';
import { HUD, MissionMarker, Waypoint } from '../ui/hud';
import { MetricsOverlay } from '../ui/metrics';
import { GarageItem, Menus, MissionListItem } from '../ui/menus';
import { BigMap } from '../ui/bigmap';
import { AudioSystem } from '../audio/audio';

type GameMode =
  | 'menu'
  | 'playing'
  | 'paused'
  | 'map'
  | 'missions'
  | 'garage'
  | 'settings'
  | 'controls'
  | 'wasted'
  | 'missionFail'
  | 'dialogue';

type ScreenReturn = 'playing' | 'paused' | 'menu';

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

type NavigatorWithWakeLock = Navigator & { wakeLock?: WakeLockLike };

interface Interaction {
  label: string;
  text: string;
  run: () => void;
}

interface ShopRow {
  unlock: number;
  ammoPrice: number;
  ammo: number;
}

const WEAPON_ORDER: WeaponId[] = ['pistol', 'smg', 'shotgun'];

const WEAPON_SHOP: Record<WeaponId, ShopRow> = {
  pistol: { unlock: 0, ammoPrice: 150, ammo: 36 },
  smg: { unlock: 2800, ammoPrice: 320, ammo: 90 },
  shotgun: { unlock: 3600, ammoPrice: 300, ammo: 24 },
};

const HOSPITAL_FEE = 150;
const SUPPLY_FEE = 120;
const RENT_FEE = 300;
const FERRY_FARE = 120;

/** Redraw the minimap at 12 Hz — it does not need 60 fps and costs CPU. */
const MINIMAP_INTERVAL = 1 / 12;

const DEATH_LABEL: Record<string, string> = {
  polizia: 'La polizia ti ha fermato.',
  caduta: 'Sei caduto da troppo in alto.',
  esplosione: 'Il veicolo è esploso con te dentro.',
  speronamento: 'Sei stato speronato dalla polizia.',
};

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing UI element #${id}`);
  return el as T;
}

function plate(): string {
  const letters = 'ABCDEFGHJKLMNPRSTVWXYZ';
  const l = (): string => letters[Math.floor(Math.random() * letters.length)];
  const n = Math.floor(Math.random() * 900 + 100);
  return `VFC ${n} ${l()}${l()}`;
}

export class Game {
  readonly render: RenderSystem;
  readonly world: World;
  readonly env: Environment;
  readonly input: InputSystem;
  readonly player: Player;
  readonly camera: ThirdPersonCamera;
  readonly vehicles: VehicleSystem;
  readonly peds: PedestrianSystem;
  readonly police: PoliceSystem;
  readonly combat: CombatSystem;
  readonly missions: MissionSystem;
  readonly navigation: NavigationSystem;
  readonly hud: HUD;
  readonly metrics: MetricsOverlay;
  readonly menus: Menus;
  readonly bigMap: BigMap;
  readonly audio: AudioSystem;

  private mode: GameMode = 'menu';
  private screenReturn: ScreenReturn = 'playing';
  private garageMode: 'garage' | 'gunshop' = 'garage';
  private cash = 500;
  private saveData: SaveData = createNewSave(PLAYER_SPAWN.x, PLAYER_SPAWN.z);
  private ownedVehicles: OwnedVehicle[] = [];
  private readonly mapScreen = byId<HTMLElement>('map-screen');
  private readonly missionFailPanel = byId<HTMLElement>('mission-fail');
  private readonly missionFailReason = byId<HTMLElement>('mission-fail-reason');
  private lastFrame = 0;
  private autosaveTimer = 60;
  private minimapTimer = 0;
  private repairCooldown = 0;
  private deathCost = 0;
  private lastVehicleState = false;
  private orientationDismissed = false;
  private hornCooldown = 0;
  private wakeLock: WakeLockSentinelLike | null = null;
  private wakeLockPending = false;
  private wakeLockRetryAt = 0;
  private wakeLockTimer = 0;

  constructor(render: RenderSystem, world: World) {
    this.render = render;
    this.world = world;
    this.env = new Environment(render.scene, render.renderer, world.materials, settings.value);
    this.input = new InputSystem(render.canvas);
    this.player = new Player(world);
    render.scene.add(this.player.model.group);
    this.camera = new ThirdPersonCamera(world, settings.value);
    this.camera.attachCamera(render.camera);
    this.vehicles = new VehicleSystem(render.scene, world, this.player);
    this.peds = new PedestrianSystem(render.scene, world);
    this.police = new PoliceSystem(render.scene, world, this.player, this.vehicles);
    this.combat = new CombatSystem(
      render.scene,
      world,
      this.player,
      this.peds,
      this.police,
      this.vehicles,
    );
    this.missions = new MissionSystem(render.scene, world, this.player, this.vehicles, this.police);
    this.navigation = new NavigationSystem(render.scene, world);
    this.audio = new AudioSystem(settings.value);

    this.hud = new HUD(this.input, settings.value, {
      onPause: () => this.togglePause(),
      onMap: () => this.openMap(),
      onWeapon: () => this.cycleWeapon(),
      onCamera: () => this.cycleCamera(),
    });
    this.metrics = new MetricsOverlay(render.renderer);
    this.metrics.setVisible(settings.value.metrics);

    this.menus = new Menus({
      onContinue: () => this.continueGame(),
      onNewGame: () => this.newGame(),
      onOpenSettings: () => this.openSettings('menu'),
      onOpenControls: () => this.openControls(),
      onResume: () => this.resume(),
      onPauseMap: () => this.openMap(),
      onPauseMissions: () => this.openMissions(),
      onPauseGarage: () => this.openGarage('garage'),
      onPauseSettings: () => this.openSettings('paused'),
      onPauseSave: () => this.saveGame(false),
      onPauseMenu: () => this.toMainMenu(),
      onMissionsClose: () => this.closeMissions(),
      onGarageClose: () => this.closeGarage(),
      onSettingsClose: () => this.returnFromScreen(),
      onControlsClose: () => this.returnFromScreen(),
      onSettingsApplied: () => this.applySettings(),
      onResetSave: () => this.onSaveCleared(),
      onRespawn: () => this.respawn(),
      onDialogueDone: () => this.onDialogueDone(),
      onMissionAction: (id) => this.startMissionFromMenu(id),
      onGarageAction: (id) => this.garageAction(id),
    });

    this.bigMap = new BigMap(this.world, {
      onSetWaypoint: (wp) => this.navigation.set(wp),
      onClose: () => this.closeMap(),
    });

    byId<HTMLButtonElement>('btn-mission-retry').addEventListener('click', () =>
      this.retryMission(),
    );
    byId<HTMLButtonElement>('btn-mission-abandon').addEventListener('click', () =>
      this.abandonMission(),
    );

    this.wireEvents();
    this.wireOrientationHint();
    this.input.setEnabled(false);
    this.showMenu();

    window.addEventListener('resize', () => this.render.resize());
    window.addEventListener('orientationchange', () => {
      window.setTimeout(() => this.render.resize(), 180);
    });
    window.addEventListener('pagehide', () => {
      this.saveIfSession();
      this.audio.setSuspended(true);
      this.releaseWakeLock();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.handleHidden();
      else this.handleVisible();
    });

    this.lastFrame = performance.now();
    requestAnimationFrame(this.loop);
  }

  hideBoot(): void {
    this.menus.hideBoot();
    // Console/debug handle (local sessions only) for diagnostics.
    const host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      (window as unknown as { vfc1?: Game }).vfc1 = this;
    }
  }

  /**
   * Persist a loaded session, whichever screen is open (map, garage, settings…).
   * WASTED is skipped: saving before respawn would let a reload skip the death cost.
   */
  private saveIfSession(): void {
    if (this.mode === 'menu' || this.mode === 'wasted') return;
    // Settings/controls can be opened from the main menu, where no session is loaded.
    if ((this.mode === 'settings' || this.mode === 'controls') && this.screenReturn === 'menu') {
      return;
    }
    this.saveGame(true);
  }

  /** Real pause when the tab/app goes to the background. */
  private handleHidden(): void {
    this.saveIfSession();
    this.audio.setSuspended(true);
    this.releaseWakeLock();
    if (this.mode === 'playing') this.openPause();
  }

  private handleVisible(): void {
    // rAF was throttled while hidden; do not turn the gap into a physics step.
    this.lastFrame = performance.now();
    this.wakeLockRetryAt = 0;
    if (this.mode === 'playing') this.openPause();
    this.syncWakeLock();
  }

  /** Keep the screen awake only while actual gameplay is running. */
  private syncWakeLock(): void {
    if (document.hidden || this.mode !== 'playing') {
      this.releaseWakeLock();
      return;
    }
    void this.requestWakeLock();
  }

  private async requestWakeLock(): Promise<void> {
    if (this.wakeLock || this.wakeLockPending) return;
    if (performance.now() < this.wakeLockRetryAt) return;
    if (document.hidden) return;
    const api = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!api) {
      this.wakeLockRetryAt = Number.POSITIVE_INFINITY;
      return;
    }
    this.wakeLockPending = true;
    try {
      const sentinel = await api.request('screen');
      if (this.mode !== 'playing' || document.hidden) {
        void sentinel.release().catch(() => {});
        return;
      }
      this.wakeLock = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.wakeLock === sentinel) this.wakeLock = null;
      });
    } catch {
      // Insecure origins and low-power modes can reject the request; retry later.
      this.wakeLockRetryAt = performance.now() + 15000;
    } finally {
      this.wakeLockPending = false;
    }
  }

  private releaseWakeLock(): void {
    const sentinel = this.wakeLock;
    this.wakeLock = null;
    if (sentinel) void sentinel.release().catch(() => {});
  }

  /* ------------------------------------------------------------------ */
  /* Event wiring                                                        */
  /* ------------------------------------------------------------------ */

  private wireEvents(): void {
    events.on('ui:toast', ({ title, text, kind }) => {
      this.hud.toast(title ?? '', text, kind);
    });

    events.on('ui:missionPanel', (panel) => {
      if (panel) this.hud.setMission(panel.title, panel.objective, panel.timer);
      else this.hud.setMission(null);
    });

    events.on('mission:objective', () => {
      this.hud.updateMissionTimer(this.missions.currentTimer);
    });

    events.on('mission:complete', ({ reward }) => {
      this.cash += Math.round(reward);
      this.saveData.stats.missionsDone++;
      this.saveData.stats.moneyEarned += Math.round(reward);
      this.hud.setCash(this.cash);
      this.saveGame(true);
    });

    events.on('mission:fail', ({ reason }) => {
      this.hud.toast('MISSIONE FALLITA', reason, 'bad');
      if (this.mode === 'playing') this.showMissionFail(reason);
      // Otherwise a reload would resume the failed mission from its old checkpoint.
      // The respawn path saves itself after applying the death cost.
      if (this.mode !== 'wasted') this.saveGame(true);
    });

    events.on('mission:checkpoint', ({ index, total }) => {
      this.hud.toast('CHECKPOINT', `${index} / ${total}`, 'info');
      // A checkpoint is the safest resume point if the app is killed later.
      this.saveGame(true);
    });

    events.on('wanted:changed', ({ level }) => this.hud.setWanted(level));

    events.on('wanted:escape', () => {
      this.saveData.stats.policeEscapes++;
      this.hud.toast('RICERCATO', 'Hai seminato la polizia.', 'good');
    });

    events.on('police:radio', ({ text }) => {
      if (settings.value.subtitles) this.hud.showSubtitle(`RADIO POLIZIA — ${text}`, 4.2);
    });

    events.on('world:region', ({ name }) => this.hud.setRegion(name));

    events.on('vehicle:stolen', () => {
      this.saveData.stats.carsStolen++;
    });

    events.on('vehicle:crash', ({ vehicleId, impact }) => {
      if (this.vehicles.playerVehicle?.id !== vehicleId) return;
      this.camera.addShake(clamp01(impact / 26) * 0.55);
      if (settings.value.vibration && this.input.isTouch) this.input.rumble(70);
    });

    events.on('player:damaged', ({ amount }) => {
      this.camera.addShake(clamp(amount / 90, 0, 0.5));
      if (settings.value.vibration && this.input.isTouch) this.input.rumble(60);
    });

    events.on('player:landed', ({ impact }) => {
      this.camera.addShake(clamp01((impact - 5) / 26) * 0.32);
      if (settings.value.vibration && this.input.isTouch) this.input.rumble(45);
    });

    events.on('combat:hit', ({ killed }) => {
      this.hud.flashHit(killed);
      if (killed && settings.value.vibration && this.input.isTouch) this.input.rumble(35);
    });

    events.on('player:shoot', () => {
      if (settings.value.vibration && this.input.isTouch) this.input.rumble(30, 0.45);
    });

    events.on('game:death', ({ reason }) => this.handleDeath(reason));
  }

  /** Portrait hint for touch devices; a tap dismisses it for the session. */
  private wireOrientationHint(): void {
    const hint = document.getElementById('rotate-hint');
    if (!hint) return;
    const update = (): void => {
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      hint.classList.toggle('hidden', !portrait || !this.input.isTouch || this.orientationDismissed);
    };
    hint.addEventListener('pointerdown', () => {
      this.orientationDismissed = true;
      hint.classList.add('hidden');
    });
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', () => window.setTimeout(update, 200));
    update();
  }

  /* ------------------------------------------------------------------ */
  /* Menu / session flow                                                 */
  /* ------------------------------------------------------------------ */

  showMenu(): void {
    this.mode = 'menu';
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.hud.setVisible(false);
    this.missionFailPanel.classList.add('hidden');
    this.audio.setSuspended(true);
    this.syncWakeLock();
    this.menus.showMenu();
  }

  private continueGame(): void {
    const data = saveManager.load();
    if (data) this.startSession(data);
    else this.newGame();
  }

  private newGame(): void {
    saveManager.clear();
    this.startSession(createNewSave(PLAYER_SPAWN.x, PLAYER_SPAWN.z));
    this.audio.unlock();
    this.menus.showDialogue('SERGIO “IL CONTABILE”', [
      'Benvenuto a Milano, amico mio. Qui il tempo è denaro e la Polizia non dorme mai.',
      'Se cerchi lavoro, segui il segnale dorato: trovi i contatti in ogni città. Prendi un’auto e porta a casa i soldi.',
      'La penisola è tua: dieci città, montagne, coste e una sola regola. Non farti prendere.',
    ]);
    this.mode = 'dialogue';
    this.input.setEnabled(false);
    this.syncWakeLock();
  }

  private startSession(data: SaveData): void {
    this.saveData = data;
    this.vehicles.resetPopulation();
    this.police.clearAll();
    this.missions.load(
      data.missionStates,
      data.storyStage,
      data.activeMissionProgress ?? null,
    );

    this.player.reset(data.player.x, data.player.z, data.player.yaw, this.world);
    this.player.health = data.player.health > 0 ? clamp(data.player.health, 25, 100) : 100;
    this.player.armor = clamp(data.player.armor, 0, 100);
    this.applyWeapons(data);

    this.cash = Math.max(0, Math.round(data.cash));
    this.ownedVehicles = data.ownedVehicles.map((v) => ({ ...v }));
    this.env.setTime(data.timeOfDay);
    this.env.setWeather((data.weather as WeatherKind) || 'clear', true);
    this.camera.snapBehind(data.player.yaw);
    this.camera.pitch = 0.24;
    this.navigation.set(null);

    this.police.forceLevel(clamp(Math.round(data.wanted), 0, 5));
    this.vehicles.spawnInitial();
    if (data.activeVehicle) this.restoreVehicle(data.activeVehicle);

    this.mode = 'playing';
    this.input.setEnabled(true);
    this.hud.setVisible(true);
    this.missionFailPanel.classList.add('hidden');
    this.hud.setCash(this.cash);
    this.hud.setWanted(this.police.level);
    if (this.missions.isActive) {
      this.hud.setMission(
        this.missions.activeTitle ?? '',
        this.missions.activeObjective ?? '',
        this.missions.currentTimer,
      );
    } else {
      this.hud.setMission(null);
    }
    this.hud.setPrompt(null);
    this.menus.hideAllScreens();
    this.menus.hideMenu();
    this.audio.unlock();
    this.audio.setVolumes();
    this.autosaveTimer = 60;
    this.lastVehicleState = this.player.inVehicle;
    this.updateHelpText();
    this.syncWakeLock();
  }

  private applyWeapons(data: SaveData): void {
    for (const id of WEAPON_ORDER) {
      const entry = data.weapons[id];
      const owned = entry ? entry.owned : id === 'pistol';
      const ammo = Math.max(0, Math.round(entry?.ammo ?? 0));
      const loaded = Math.min(WEAPONS[id].magSize, ammo);
      this.player.owned[id] = owned;
      this.player.loaded[id] = owned ? loaded : 0;
      this.player.reserve[id] = owned ? ammo - loaded : 0;
    }
    this.player.weapon = WEAPON_ORDER.find((id) => this.player.owned[id]) ?? 'pistol';
    if (!this.player.owned[this.player.weapon]) this.player.owned.pistol = true;
  }

  private restoreVehicle(spec: { type: string; color: string }): void {
    if (!(spec.type in VEHICLE_TYPES)) return;
    const point = this.world.nearestRoadPoint(this.player.position.x, this.player.position.z);
    if (point) {
      this.vehicles.spawnAt(spec.type as VehicleTypeId, point.x, point.z, point.yaw, spec.color, true);
    }
  }

  private onDialogueDone(): void {
    if (this.mode !== 'dialogue') return;
    this.mode = 'playing';
    this.input.setEnabled(true);
    this.audio.setSuspended(false);
    this.syncWakeLock();
  }

  private togglePause(): void {
    if (this.mode === 'playing') this.openPause();
    else if (this.mode === 'paused') this.resume();
  }

  private openPause(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.hud.setPrompt(null);
    this.audio.setSuspended(true);
    this.syncWakeLock();
    this.openPausePanel();
  }

  private openPausePanel(): void {
    this.menus.openPause(this.locationLabel(), {
      cash: this.cash,
      missions: this.missions.defs.filter((d) => this.missions.stateOf(d.id) === 'done').length,
      playtime: this.saveData.stats.playtime,
    });
  }

  private resume(): void {
    this.menus.closePause();
    this.mode = 'playing';
    this.input.setEnabled(true);
    this.wakeLockRetryAt = 0;
    this.audio.setSuspended(false);
    this.syncWakeLock();
  }

  private toMainMenu(): void {
    this.saveGame(true);
    this.menus.closePause();
    this.showMenu();
  }

  private onSaveCleared(): void {
    this.ownedVehicles = [];
    this.cash = 500;
    this.saveData = createNewSave(PLAYER_SPAWN.x, PLAYER_SPAWN.z);
    this.showMenu();
    this.hud.toast('PROGRESSI', 'Salvataggio cancellato.', 'info');
  }

  private locationLabel(): string {
    return this.world.regionAt(this.player.position.x, this.player.position.z).name;
  }

  /* ------------------------------------------------------------------ */
  /* Screens                                                             */
  /* ------------------------------------------------------------------ */

  /** Mode to return to when a full-screen panel closes. */
  private screenFromPlay(): 'playing' | 'paused' | null {
    if (this.mode === 'playing') return 'playing';
    if (this.mode === 'paused') return 'paused';
    return null;
  }

  private enterScreen(mode: GameMode, from: ScreenReturn): void {
    this.screenReturn = from;
    if (from === 'paused') this.menus.closePause();
    this.mode = mode;
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.syncWakeLock();
  }

  private returnFromScreen(): void {
    if (this.screenReturn === 'menu') {
      this.showMenu();
      return;
    }
    if (this.screenReturn === 'paused') {
      this.mode = 'paused';
      this.input.setEnabled(false);
      this.openPausePanel();
      this.syncWakeLock();
      return;
    }
    this.mode = 'playing';
    this.input.setEnabled(true);
    this.audio.setSuspended(false);
    this.syncWakeLock();
  }

  private openMap(): void {
    const from = this.screenFromPlay();
    if (!from) return;
    this.enterScreen('map', from);
    this.mapScreen.classList.remove('hidden');
    this.bigMap.resetPending();
    this.bigMap.render(this.player, this.navigation.waypoint, this.missionMarker());
  }

  private closeMap(): void {
    this.mapScreen.classList.add('hidden');
    this.returnFromScreen();
  }

  private openMissions(): void {
    const from = this.screenFromPlay();
    if (!from) return;
    this.enterScreen('missions', from);
    this.menus.openMissions(this.missionItems());
  }

  private closeMissions(): void {
    this.menus.closeMissions();
    this.returnFromScreen();
  }

  private startMissionFromMenu(id: string): void {
    this.menus.closeMissions();
    if (!this.beginMission(id)) {
      this.hud.toast('MISSIONE', 'Non è più disponibile.', 'bad');
      this.returnFromScreen();
      return;
    }
    this.mode = 'playing';
    this.input.setEnabled(true);
    this.audio.setSuspended(false);
    this.syncWakeLock();
  }

  private openSettings(from: 'menu' | 'paused'): void {
    this.enterScreen('settings', from);
    this.menus.openSettings();
  }

  private openControls(): void {
    this.enterScreen('controls', 'menu');
    this.menus.openControls();
  }

  private applySettings(): void {
    const s = settings.value;
    this.render.setQuality(s.quality);
    this.render.renderer.shadowMap.enabled = s.shadows;
    this.env.setShadows(s.shadows);
    this.metrics.setVisible(s.metrics);
    this.hud.applyScale();
    this.audio.setVolumes();
    this.render.camera.fov = s.fov;
    this.render.camera.updateProjectionMatrix();
    this.updateHelpText();
    this.returnFromScreen();
  }

  private openGarage(mode: 'garage' | 'gunshop'): void {
    const from = this.screenFromPlay();
    if (!from) return;
    this.enterScreen('garage', from);
    this.garageMode = mode;
    this.refreshGarage();
  }

  private closeGarage(): void {
    this.menus.closeGarage();
    this.returnFromScreen();
  }

  private refreshGarage(): void {
    const items = this.garageMode === 'garage' ? this.vehicleItems() : this.weaponItems();
    const note =
      this.garageMode === 'garage'
        ? 'I veicoli acquistati restano nel garage e possono essere evocati ovunque.'
        : 'Le armi e le munizioni restano con te anche dopo un arresto o un ricovero.';
    this.menus.openGarage(this.garageMode, this.cash, items, note);
    this.hud.setCash(this.cash);
  }

  private vehicleItems(): GarageItem[] {
    return (Object.keys(VEHICLE_TYPES) as VehicleTypeId[])
      .filter((id) => id !== 'police')
      .map((id) => {
        const def = VEHICLE_TYPES[id];
        const owned = this.ownedVehicles.some((v) => v.type === id);
        return {
          id: `car:${id}`,
          name: def.name,
          classLabel: `${def.classLabel} · ${Math.round(def.maxSpeed * 3.6)} km/h · ${def.mass} kg`,
          price: def.price,
          owned,
          actionLabel: owned ? 'EVOCA' : 'COMPRA',
        };
      });
  }

  private weaponItems(): GarageItem[] {
    return WEAPON_ORDER.map((id) => {
      const def = WEAPONS[id];
      const shop = WEAPON_SHOP[id];
      const owned = this.player.owned[id];
      return {
        id: `gun:${id}`,
        name: def.name,
        classLabel: `${def.damage} danni · caricatore ${def.magSize} · ${def.auto ? 'automatica' : 'semiautomatica'}`,
        price: owned ? shop.ammoPrice : shop.unlock,
        owned,
        actionLabel: owned ? `MUNIZIONI +${shop.ammo}` : 'ACQUISTA',
      };
    });
  }

  private garageAction(id: string): void {
    if (id.startsWith('car:')) this.buyOrSummonVehicle(id.slice(4) as VehicleTypeId);
    else if (id.startsWith('gun:')) this.buyOrReloadWeapon(id.slice(4) as WeaponId);
    this.refreshGarage();
    this.saveGame(true);
  }

  private buyOrSummonVehicle(type: VehicleTypeId): void {
    const def = VEHICLE_TYPES[type];
    if (!def) return;
    if (this.ownedVehicles.some((v) => v.type === type)) {
      this.deliverVehicle(type);
      this.hud.toast('GARAGE', `${def.name} consegnata accanto a te.`, 'good');
      return;
    }
    if (!this.charge(def.price, 'GARAGE')) return;
    this.ownedVehicles.push({
      id: `owned-${Date.now()}-${type}`,
      type,
      color: def.colors[0],
      garage: this.world.nearestCityName(this.player.position.x, this.player.position.z).toLowerCase(),
      plate: plate(),
    });
    this.deliverVehicle(type);
    this.hud.toast('ACQUISTO', `${def.name} · €${formatCash(def.price)}`, 'good');
  }

  private deliverVehicle(type: VehicleTypeId): void {
    const point = this.world.nearestRoadPoint(this.player.position.x, this.player.position.z);
    const yaw = point?.yaw ?? this.player.yaw;
    const x = (point?.x ?? this.player.position.x) + Math.cos(yaw) * 3.4;
    const z = (point?.z ?? this.player.position.z) - Math.sin(yaw) * 3.4;
    this.vehicles.spawnAt(type, x, z, yaw, undefined, true);
  }

  private buyOrReloadWeapon(id: WeaponId): void {
    const shop = WEAPON_SHOP[id];
    const owned = this.player.owned[id];
    const cost = owned ? shop.ammoPrice : shop.unlock;
    if (!this.charge(cost, 'ARMERIA')) return;
    this.player.giveWeapon(id, shop.ammo);
    this.hud.toast(
      owned ? 'MUNIZIONI' : 'ARMA ACQUISTATA',
      `${WEAPONS[id].name} · €${formatCash(cost)}`,
      'good',
    );
    this.hud.setWeaponLabel(this.player.currentWeapon.name);
  }

  /** Deduct cash or explain why not. */
  private charge(amount: number, source: string): boolean {
    if (this.cash < amount) {
      this.hud.toast(source, 'Fondi insufficienti.', 'bad');
      return false;
    }
    this.cash -= amount;
    this.hud.setCash(this.cash);
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Save                                                                */
  /* ------------------------------------------------------------------ */

  private saveGame(autosave: boolean): void {
    const s = this.saveData;
    s.player = {
      x: this.player.position.x,
      y: this.player.position.y,
      z: this.player.position.z,
      yaw: this.player.yaw,
      health: Math.round(this.player.health),
      armor: Math.round(this.player.armor),
    };
    s.cash = Math.round(this.cash);
    s.wanted = this.police.level;
    s.missionStates = { ...this.missions.states };
    s.storyStage = this.missions.storyStage;
    s.timeOfDay = this.env.timeOfDay;
    s.weather = this.env.weather;
    s.region = this.locationLabel();
    s.ownedVehicles = this.ownedVehicles;
    s.activeVehicle = this.vehicles.playerVehicle
      ? { type: this.vehicles.playerVehicle.def.id, color: this.vehicles.playerVehicle.color }
      : null;
    s.activeMission = this.missions.active?.def.id ?? null;
    s.activeMissionProgress = this.missions.snapshot();
    s.weapons = {};
    for (const id of WEAPON_ORDER) {
      s.weapons[id] = {
        owned: this.player.owned[id],
        ammo: this.player.loaded[id] + this.player.reserve[id],
      };
    }
    saveManager.save(s);
    if (!autosave) this.hud.toast('SALVATAGGIO', 'Progressi salvati.', 'good');
  }

  /* ------------------------------------------------------------------ */
  /* Death / respawn                                                     */
  /* ------------------------------------------------------------------ */

  private handleDeath(reason: string): void {
    if (this.mode === 'wasted') return;
    this.deathCost = Math.min(this.cash, 180 + Math.floor(this.cash * 0.06));
    this.mode = 'wasted';
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.hud.setPrompt(null);
    this.hud.setVisible(false);
    this.audio.setSuspended(true);
    this.syncWakeLock();
    this.menus.showWasted(DEATH_LABEL[reason] ?? 'Sei fuori gioco.', this.deathCost);
  }

  private respawn(): void {
    this.cash = Math.max(0, this.cash - this.deathCost);
    this.deathCost = 0;
    this.police.clearAll();
    this.missions.failActive('Sei finito in ospedale.');
    this.vehicles.resetPopulation();

    const spot = this.nearestPoiOfKind('hospital') ?? this.nearestPoiOfKind('safehouse');
    const x = (spot?.x ?? PLAYER_SPAWN.x) + 3;
    const z = (spot?.z ?? PLAYER_SPAWN.z) + 3;
    const yaw = Math.random() * TAU;
    this.player.reset(x, z, yaw, this.world);
    this.camera.pitch = 0.24;
    this.camera.snapBehind(yaw);
    this.vehicles.spawnInitial();

    this.mode = 'playing';
    this.input.setEnabled(true);
    this.menus.hideWasted();
    this.hud.setVisible(true);
    this.hud.setCash(this.cash);
    this.hud.setWanted(0);
    this.navigation.set(null);
    this.updateHelpText();
    this.audio.setSuspended(false);
    this.syncWakeLock();
    this.saveGame(true);
  }

  private nearestPoiOfKind(kind: POIKind): POI | null {
    let best: POI | null = null;
    let bestD = Infinity;
    for (const poi of this.world.pois) {
      if (poi.kind !== kind) continue;
      const d = dist2D(poi.x, poi.z, this.player.position.x, this.player.position.z);
      if (d < bestD) {
        bestD = d;
        best = poi;
      }
    }
    return best;
  }

  private missionMarker(): MissionMarker | null {
    return this.missions.objectiveMarker;
  }

  private missionItems(): MissionListItem[] {
    return this.missions.defs.map((def) => ({
      id: def.id,
      title: def.title,
      description: def.description,
      meta: `€${formatCash(def.reward)} · ${def.steps.length} obiettivi${def.timeLimit ? ` · ${Math.round(def.timeLimit)} s` : ''}`,
      state: this.missions.stateOf(def.id),
    }));
  }

  private beginMission(id: string): boolean {
    if (!this.missions.start(id)) return false;
    const marker = this.missionMarker();
    if (marker) this.navigation.set({ x: marker.x, z: marker.z, name: 'Obiettivo missione' });
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Interactions                                                        */
  /* ------------------------------------------------------------------ */

  private findInteraction(): Interaction | null {
    const { player, vehicles, missions, world } = this;
    if (player.dead) return null;
    const x = player.position.x;
    const z = player.position.z;

    if (player.inVehicle) {
      return {
        label: 'ESCI',
        text: 'Scendi dal veicolo',
        run: () => {
          if (this.vehicles.exitPlayer()) this.camera.snapBehind(this.player.yaw);
        },
      };
    }

    const mission = missions.missionNear(x, z, 11);
    if (mission) {
      return {
        label: 'LAVORO',
        text: `${mission.title} — ${mission.giverName}`,
        run: () => {
          this.beginMission(mission.id);
        },
      };
    }

    const car = vehicles.nearestVehicle(x, z, 4.8);
    if (car) {
      return {
        label: 'ENTRA',
        text: `Entra in ${car.def.name}`,
        run: () => {
          this.vehicles.enter(car);
          car.velX = 0;
          car.velZ = 0;
        },
      };
    }

    const poi = world.nearestPoi(x, z, undefined, 14);
    return poi ? this.poiInteraction(poi) : null;
  }

  private poiInteraction(poi: POI): Interaction | null {
    switch (poi.kind) {
      case 'safehouse':
        return {
          label: 'SALVA',
          text: `${poi.name} · recupera energia e salva`,
          run: () => {
            this.player.heal(60);
            this.saveGame(false);
          },
        };

      case 'garage':
        return { label: 'GARAGE', text: poi.name, run: () => this.openGarage('garage') };

      case 'gunshop':
        return { label: 'ARMERIA', text: poi.name, run: () => this.openGarage('gunshop') };

      case 'hospital':
        return {
          label: 'CURA',
          text: `${poi.name} · cura completa €${formatCash(HOSPITAL_FEE)}`,
          run: () => {
            if (this.player.health >= 100) {
              this.hud.toast('OSPEDALE', 'Sei già in perfetta forma.', 'info');
              return;
            }
            if (!this.charge(HOSPITAL_FEE, 'OSPEDALE')) return;
            this.player.heal(100);
            this.hud.toast('OSPEDALE', 'Ferite curate.', 'good');
          },
        };

      case 'shop':
        return {
          label: 'EMPORIO',
          text: `${poi.name} · provviste e giubbotto €${formatCash(SUPPLY_FEE)}`,
          run: () => {
            if (!this.charge(SUPPLY_FEE, 'EMPORIO')) return;
            this.player.heal(45);
            this.player.addArmor(45);
            this.hud.toast('EMPORIO', 'Provviste e giubbotto acquistati.', 'good');
          },
        };

      case 'gas':
        return {
          label: 'RIPARA',
          text: `${poi.name} · ripara il veicolo vicino`,
          run: () => this.repairNearbyVehicle(),
        };

      case 'airport':
        return {
          label: 'NOLEGGIA',
          text: `${poi.name} · noleggia una berlina €${formatCash(RENT_FEE)}`,
          run: () => {
            if (!this.charge(RENT_FEE, 'AEROPORTO')) return;
            this.deliverVehicle('berlina');
            this.hud.toast('AEROPORTO', 'Berlina a noleggio consegnata.', 'good');
          },
        };

      case 'port':
        return {
          label: 'TRAGHETTO',
          text: `${poi.name} · attraversa lo stretto €${formatCash(FERRY_FARE)}`,
          run: () => this.takeFerry(poi),
        };

      case 'viewpoint':
      case 'landmark':
      case 'race':
        return {
          label: 'GUARDA',
          text: `${poi.name}${poi.description ? ` · ${poi.description}` : ''}`,
          run: () => {
            this.hud.toast(
              poi.name.toUpperCase(),
              poi.description || 'Uno dei luoghi simbolo della penisola.',
              'info',
            );
          },
        };

      case 'police':
        return {
          label: 'QUESTURA',
          text: poi.name,
          run: () => {
            this.hud.toast(
              'QUESTURA',
              this.police.level > 0
                ? 'Non entrare con le stelle accese.'
                : 'Nessun mandato a tuo carico. Per ora.',
              this.police.level > 0 ? 'bad' : 'info',
            );
          },
        };

      default:
        return null;
    }
  }

  private repairCost(car: Vehicle): number {
    return 30 + Math.round((1 - car.health / car.maxHealth) * 220);
  }

  private repairNearbyVehicle(): void {
    const car =
      this.vehicles.playerVehicle ??
      this.vehicles.nearestVehicle(this.player.position.x, this.player.position.z, 9);
    if (!car) {
      this.hud.toast('DISTRIBUTORE', 'Nessun veicolo nelle vicinanze.', 'info');
      return;
    }
    if (car.health >= car.maxHealth - 0.5) {
      this.hud.toast('DISTRIBUTORE', 'Il veicolo è già in ordine.', 'info');
      return;
    }
    const cost = this.repairCost(car);
    if (!this.charge(cost, 'DISTRIBUTORE')) return;
    car.repair();
    this.repairCooldown = 6;
    this.hud.toast('DISTRIBUTORE', `Veicolo riparato · €${formatCash(cost)}`, 'good');
  }

  private takeFerry(from: POI): void {
    const target = from.z < 1800 ? FERRY_ROUTE.to : FERRY_ROUTE.from;
    let destination: POI | null = null;
    let best = Infinity;
    for (const port of this.world.pois) {
      if (port.kind !== 'port' || port.id === from.id) continue;
      const d = dist2D(port.x, port.z, target.x, target.z);
      if (d < best) {
        best = d;
        destination = port;
      }
    }
    if (!destination) {
      this.hud.toast('TRAGHETTO', 'Nessun porto raggiungibile.', 'bad');
      return;
    }
    if (!this.charge(FERRY_FARE, 'TRAGHETTO')) return;

    const x = destination.x + 4;
    const z = destination.z + 4;
    const yaw = Math.atan2(this.player.position.x - x, this.player.position.z - z);
    this.player.reset(x, z, yaw, this.world);
    this.camera.snapBehind(yaw);
    this.navigation.set(null);
    this.hud.toast(
      'TRAGHETTO',
      `Sei sbarcato a ${destination.name.replace('Porto — ', '')}.`,
      'good',
    );
  }

  /* ------------------------------------------------------------------ */
  /* HUD helpers                                                         */
  /* ------------------------------------------------------------------ */

  private updateHelpText(): void {
    if (!settings.value.showHints) {
      this.hud.updateHelp('');
      return;
    }
    if (this.vehicles.playerVehicle) {
      this.hud.updateHelp(
        this.input.isTouch
          ? '▲ ACCELERA · ▼ FRENA · JOYSTICK STERZA · DRIFT'
          : 'WASD GUIDA · SPAZIO DRIFT · H CLACSON · E ESCI',
      );
      return;
    }
    this.hud.updateHelp(
      this.input.isTouch
        ? 'JOYSTICK MUOVE · TRASCINA PER GUARDARE · ● INTERAGISCI'
        : 'WASD MUOVI · SHIFT CORRI · E INTERAGISCI · M MAPPA',
    );
  }

  private cycleCamera(): void {
    if (this.mode !== 'playing') return;
    this.hud.toast('', this.camera.cyclePreset(), 'info');
  }

  private cycleWeapon(): void {
    if (this.mode !== 'playing' || this.player.inVehicle) return;
    const before = this.player.weapon;
    this.player.cycleWeapon();
    if (this.player.weapon === before) {
      this.hud.toast('ARMERIA', 'Nessun’altra arma posseduta.', 'info');
      return;
    }
    this.hud.setWeaponLabel(this.player.currentWeapon.name);
    this.hud.toast('', this.player.currentWeapon.name, 'info');
  }

  private nearestPoliceDistance(): number {
    let best = Infinity;
    const x = this.player.position.x;
    const z = this.player.position.z;
    for (const cop of this.police.all) {
      if (cop.state === 'dead') continue;
      best = Math.min(best, dist2D(cop.x, cop.z, x, z));
    }
    for (const car of this.vehicles.police) {
      if (car.destroyed || car.driver !== 'police') continue;
      best = Math.min(best, dist2D(car.position.x, car.position.z, x, z));
    }
    return best;
  }

  /* ------------------------------------------------------------------ */
  /* Frame loop                                                          */
  /* ------------------------------------------------------------------ */

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    // Real pause: never simulate while the tab is in the background.
    if (document.hidden) {
      this.lastFrame = now;
      this.input.endFrame();
      return;
    }
    if (!this.lastFrame) this.lastFrame = now;
    const rawDt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    let dt = rawDt;
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    dt = Math.min(0.05, dt);

    if (this.mode === 'playing') {
      this.update(dt);
    } else {
      if (this.mode === 'map') {
        this.bigMap.render(this.player, this.navigation.waypoint, this.missionMarker());
      }
      this.handleScreenKeys();
    }

    if (this.mode !== 'menu') {
      this.render.render();
      this.render.updateAdaptive(dt);
    }
    this.metrics.update(rawDt, settings.value, {
      peds: this.peds.peds.length,
      vehicles: this.vehicles.vehicles.length,
    });
    this.wakeLockTimer -= rawDt;
    if (this.wakeLockTimer <= 0) {
      this.wakeLockTimer = 1;
      this.syncWakeLock();
    }
    this.input.endFrame();
  };

  private update(dt: number): void {
    // Returning from a pause/menu must bring the audio graph back with gameplay.
    this.audio.setSuspended(false);
    this.input.update(dt);
    this.saveData.stats.playtime += dt;
    this.repairCooldown = Math.max(0, this.repairCooldown - dt);
    this.hornCooldown = Math.max(0, this.hornCooldown - dt);

    if (this.handleShortcuts()) return;
    if (this.updateInteraction()) return;

    const car = this.updatePlayer(dt);
    const speedRatio = this.updateCamera(dt, car);
    this.updateWorld(dt);
    this.updateCombat();
    this.autoRepair(car);
    this.updateWaypoint(dt);
    this.updateHud(dt, car, speedRatio);
    this.updateAudio(dt, car);
    this.updateAutosave(dt);
  }

  /** Keyboard navigation while a screen is open (Escape closes / resumes). */
  private handleScreenKeys(): void {
    const input = this.input;
    if (this.mode === 'dialogue') {
      if (input.wasPressed('pause') || input.wasPressed('interact') || input.wasPressed('enter')) {
        this.menus.advanceDialogue();
      }
      return;
    }
    if (!input.wasPressed('pause')) return;
    if (this.mode === 'paused') {
      this.resume();
      return;
    }
    switch (this.mode) {
      case 'map':
        this.closeMap();
        break;
      case 'missions':
        this.closeMissions();
        break;
      case 'garage':
        this.closeGarage();
        break;
      case 'settings':
      case 'controls':
        this.returnFromScreen();
        break;
      case 'missionFail':
        this.abandonMission();
        break;
      default:
        break;
    }
  }

  /** Keyboard actions that can change the screen. Returns true when they did. */
  private handleShortcuts(): boolean {
    const input = this.input;
    if (input.wasPressed('pause')) {
      this.openPause();
      return true;
    }
    if (input.wasPressed('map')) {
      this.openMap();
      return true;
    }
    if (input.wasPressed('phone')) {
      this.openGarage('garage');
      return true;
    }
    if (input.wasPressed('camera')) this.cycleCamera();
    if (input.wasPressed('weapon')) this.cycleWeapon();
    if (input.wasPressed('reload') && this.player.startReload()) {
      this.hud.toast('', 'Ricarica…', 'info');
    }
    if (input.wasPressed('reset')) {
      const car = this.vehicles.playerVehicle;
      if (car?.resetUpright(this.world)) {
        this.camera.addShake(0.18);
        this.hud.toast('VEICOLO', 'Veicolo raddrizzato.', 'info');
        if (settings.value.vibration && input.isTouch) input.rumble(35);
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Mission failure / checkpoint retry                                  */
  /* ------------------------------------------------------------------ */

  private showMissionFail(reason: string): void {
    if (this.mode !== 'playing') return;
    this.mode = 'missionFail';
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.hud.setPrompt(null);
    this.missionFailReason.textContent = reason;
    this.missionFailPanel.classList.remove('hidden');
  }

  private retryMission(): void {
    this.missionFailPanel.classList.add('hidden');
    if (!this.missions.retryLastFailure()) {
      this.abandonMission();
      return;
    }
    this.mode = 'playing';
    this.input.setEnabled(true);
    this.wakeLockRetryAt = 0;
    this.audio.setSuspended(false);
    this.syncWakeLock();
    this.camera.snapBehind(this.player.yaw);
    this.hud.toast('CHECKPOINT', 'Riparti dall’ultimo obiettivo.', 'info');
  }

  private abandonMission(): void {
    this.missionFailPanel.classList.add('hidden');
    this.missions.discardFailure();
    this.mode = 'playing';
    this.input.setEnabled(true);
    this.wakeLockRetryAt = 0;
    this.audio.setSuspended(false);
    this.syncWakeLock();
    this.hud.setMission(null);
    this.hud.setPrompt(null);
  }

  /** Contextual prompt + action. Returns true when the action left gameplay. */
  private updateInteraction(): boolean {
    const input = this.input;
    const interaction = this.findInteraction();
    if (!interaction) {
      this.hud.setPrompt(null);
      this.hud.setActionLabel(this.player.inVehicle ? 'ESCI' : 'AZIONE');
      return false;
    }

    this.hud.setPrompt(interaction.text, input.isTouch ? '●' : 'E');
    this.hud.setActionLabel(interaction.label);
    if (!input.wasPressed('interact') && !input.wasPressed('enter')) return false;

    interaction.run();
    if (this.mode === 'playing') return false;
    this.hud.setPrompt(null);
    return true;
  }

  /** Drive the current vehicle or walk; returns the vehicle when driving. */
  private updatePlayer(dt: number): Vehicle | null {
    const { input, player, world } = this;
    const car = this.vehicles.playerVehicle;
    if (!car) {
      player.update(dt, input, this.camera.yaw, world, true, this.camera.pitch);
      return null;
    }

    player.aiming = false;
    const throttle = Math.max(input.throttle, settings.value.autoAccelerate ? 0.42 : 0);
    const steer = clamp(input.steer * (settings.value.steeringAssist ? 1.05 : 1), -1, 1);
    car.update(
      dt,
      { throttle, brake: input.brake, steer, handbrake: input.handbrake },
      world,
    );
    if (input.isDown('horn') && this.hornCooldown <= 0) {
      this.hornCooldown = 0.55;
      events.emit('audio:honk', { x: car.position.x, z: car.position.z });
      this.peds.panicAt(car.position.x, car.position.z, 20);
      if (settings.value.vibration && input.isTouch) input.rumble(16, 0.3);
    }
    player.position.copy(car.position);
    player.yaw = car.yaw;
    player.update(dt, input, this.camera.yaw, world, false);
    this.saveData.stats.distanceDriven += car.speed * dt;
    return car;
  }

  private updateCamera(dt: number, car: Vehicle | null): number {
    const speedRatio = car
      ? clamp01(car.speed / Math.max(1, car.maxSpeed))
      : clamp01(this.player.speed / 7.4);
    this.camera.update(dt, this.input, this.player.position, car ? car.yaw : this.player.yaw, {
      inVehicle: !!car,
      aiming: this.player.aiming,
      speedRatio,
      vehicleYaw: car ? car.yaw : 0,
    });
    updateFov(this.render.camera, settings.value.fov + speedRatio * (car ? 9 : 2), dt);
    return speedRatio;
  }

  private updateWorld(dt: number): void {
    const { player, world } = this;
    const x = player.position.x;
    const z = player.position.z;
    world.update(x, z, dt);
    this.env.update(dt, this.render.camera.position, player.position);
    this.vehicles.update(dt, player.position);
    this.peds.update(dt, x, z, this.vehicles);
    this.police.update(dt, this.combat);
    this.missions.update(dt);
    this.combat.update(dt);
  }

  private updateCombat(): void {
    if (this.vehicles.playerVehicle || this.player.dead) return;
    const def = this.player.currentWeapon;
    const wants = def.auto ? this.input.isDown('attack') : this.input.wasPressed('attack');
    if (wants && this.player.aiming) {
      this.combat.tryPlayerShoot(
        performance.now() / 1000,
        this.render.camera,
        this.input.isTouch,
      );
    }
  }

  private autoRepair(car: Vehicle | null): void {
    if (!car || car.health >= car.maxHealth - 0.5 || car.speed >= 1.6) return;
    if (this.repairCooldown > 0) return;
    if (!this.world.nearestPoi(car.position.x, car.position.z, ['gas'], 18)) return;
    const cost = this.repairCost(car);
    if (this.cash < cost) return;
    this.cash -= cost;
    car.repair();
    this.repairCooldown = 9;
    this.hud.setCash(this.cash);
    this.hud.toast('DISTRIBUTORE', `Veicolo riparato · €${formatCash(cost)}`, 'good');
  }

  private updateWaypoint(dt: number): void {
    const arrived = this.navigation.update(dt, this.player.position.x, this.player.position.z);
    if (arrived) this.hud.toast('NAVIGATORE', 'Destinazione raggiunta.', 'good');
  }

  private updateHud(dt: number, car: Vehicle | null, speedRatio: number): void {
    const { player, world } = this;
    const inVehicle = !!car;
    if (inVehicle !== this.lastVehicleState) {
      this.lastVehicleState = inVehicle;
      this.updateHelpText();
    }

    this.hud.setCash(this.cash);
    this.hud.setVitals(player.health, player.armor);
    this.hud.setStamina(player.stamina);
    this.hud.setWanted(this.police.level);
    this.hud.setRegion(world.regionAt(player.position.x, player.position.z).name);
    this.hud.setClock(this.env.timeLabel, this.env.weatherLabel);
    this.hud.setVehicleMode(
      inVehicle,
      car?.def.name ?? '',
      car?.speedKmh ?? 0,
      inVehicle ? speedRatio : 0,
    );
    this.hud.setAim(player.aiming);
    this.hud.setWeaponLabel(player.currentWeapon.name);
    this.hud.setReloadState(
      player.isReloading,
      player.loaded[player.weapon] < player.currentWeapon.magSize && player.reserve[player.weapon] > 0,
    );
    this.hud.updateMissionTimer(this.missions.isActive ? this.missions.currentTimer : null);
    this.hud.update(dt);

    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = MINIMAP_INTERVAL;
      this.hud.updateMinimap(
        world,
        player,
        this.vehicles,
        this.peds,
        this.police,
        this.camera.yaw,
        this.navigation.waypoint,
        this.missionMarker(),
      );
    }
  }

  private updateAudio(dt: number, car: Vehicle | null): void {
    const weather = this.env.weather;
    const rain =
      weather === 'storm' ? 1 : weather === 'rain' ? 0.68 : weather === 'cloudy' ? 0.12 : 0;
    this.audio.updatePosition(this.player.position.x, this.player.position.z);
    this.audio.update(dt, {
      driving: !!car,
      speed: car?.speed ?? 0,
      throttle: this.input.throttle,
      wanted: this.police.level,
      policeDistance: this.nearestPoliceDistance(),
      rain,
      night: this.env.isNight ? 1 : 0,
    });
  }

  private updateAutosave(dt: number): void {
    this.autosaveTimer -= dt;
    if (this.autosaveTimer > 0) return;
    this.autosaveTimer = 60;
    this.saveGame(true);
  }
}
