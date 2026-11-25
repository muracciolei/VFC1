/**
 * HUD controller: money, wanted stars, clock, mission panel, prompts,
 * notifications, speedometer, aim reticle, minimap and the touch controls.
 */

import { clamp, formatCash, formatTimer, TAU } from '../core/math';
import { ActionName, InputSystem } from '../core/input';
import { GameSettings } from '../core/settings';
import { World } from '../world/world';
import { RoadSegment } from '../world/roadnetwork';
import { Player } from '../entities/player';
import { VehicleSystem } from '../systems/vehicles';
import { PoliceSystem } from '../systems/police';
import { PedestrianSystem } from '../systems/pedestrians';

export interface Waypoint {
  x: number;
  z: number;
  name: string;
}

export interface MissionMarker {
  x: number;
  z: number;
  giver: boolean;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing UI element #${id}`);
  return el as T;
}

export class HUD {
  private root = byId<HTMLElement>('hud');
  private cashEl = byId<HTMLElement>('hud-cash');
  private healthEl = byId<HTMLElement>('hud-health');
  private armorEl = byId<HTMLElement>('hud-armor');
  private staminaEl = byId<HTMLElement>('hud-stamina');
  private wantedEl = byId<HTMLElement>('hud-wanted');
  private regionEl = byId<HTMLElement>('hud-region');
  private timeEl = byId<HTMLElement>('hud-time');
  private weatherEl = byId<HTMLElement>('hud-weather');
  private minimap = byId<HTMLCanvasElement>('minimap');
  private missionPanel = byId<HTMLElement>('mission-panel');
  private missionTitle = byId<HTMLElement>('mission-title');
  private missionObj = byId<HTMLElement>('mission-objective');
  private missionTimer = byId<HTMLElement>('mission-timer');
  private promptEl = byId<HTMLElement>('interact-prompt');
  private promptKey = byId<HTMLElement>('prompt-key');
  private promptText = byId<HTMLElement>('prompt-text');
  private notifications = byId<HTMLElement>('notifications');
  private subtitle = byId<HTMLElement>('subtitle');
  private help = byId<HTMLElement>('hud-help');
  private speedo = byId<HTMLElement>('speedo');
  private speedoFill = byId<HTMLElement>('speedo-fill');
  private speedoName = byId<HTMLElement>('speedo-name');
  private speedoKmh = byId<HTMLElement>('speedo-kmh');
  private reticle = byId<HTMLElement>('aim-reticle');
  private hitMarker = byId<HTMLElement>('hit-marker');
  private touchUi = byId<HTMLElement>('touch-ui');
  private joystickZone = byId<HTMLElement>('joystick-zone');
  private joystickBase = byId<HTMLElement>('joystick-base');
  private joystickKnob = byId<HTMLElement>('joystick-knob');
  private actionCluster = byId<HTMLElement>('action-cluster');
  private driveCluster = byId<HTMLElement>('drive-cluster');
  private btnAction = byId<HTMLButtonElement>('btn-action');
  private btnJump = byId<HTMLButtonElement>('btn-jump');
  private btnSprint = byId<HTMLButtonElement>('btn-sprint');
  private btnAttack = byId<HTMLButtonElement>('btn-attack');
  private btnAim = byId<HTMLButtonElement>('btn-aim');
  private btnReload = byId<HTMLButtonElement>('btn-reload');
  private btnGas = byId<HTMLButtonElement>('btn-gas');
  private btnBrake = byId<HTMLButtonElement>('btn-brake');
  private btnHandbrake = byId<HTMLButtonElement>('btn-handbrake');
  private btnHorn = byId<HTMLButtonElement>('btn-horn');
  private btnReset = byId<HTMLButtonElement>('btn-reset');
  private btnPause = byId<HTMLButtonElement>('btn-pause');
  private btnWeapon = byId<HTMLButtonElement>('btn-weapon');
  private btnCamera = byId<HTMLButtonElement>('btn-camera');
  private btnMap = byId<HTMLButtonElement>('btn-map');

  private input: InputSystem;
  private settings: GameSettings;
  private stars: HTMLElement[] = [];
  private joyPointer = -1;
  private minimapCtx: CanvasRenderingContext2D;
  private subtitleTimer = 0;
  private promptVisible = false;
  private vehicleMode = false;
  private lastWanted = -1;
  private lastHealth = -1;
  private lastArmor = -1;
  private lastStamina = -1;

  constructor(
    input: InputSystem,
    settings: GameSettings,
    callbacks: {
      onPause: () => void;
      onMap: () => void;
      onWeapon: () => void;
      onCamera: () => void;
    },
  ) {
    this.input = input;
    this.settings = settings;
    const ctx = this.minimap.getContext('2d');
    if (!ctx) throw new Error('Minimap 2D context unavailable');
    this.minimapCtx = ctx;

    for (let i = 0; i < 5; i++) {
      const star = document.createElement('span');
      star.className = 'wanted__star';
      this.wantedEl.appendChild(star);
      this.stars.push(star);
    }

    this.bindTouch(callbacks);
    this.setTouchVisible(input.isTouch);
    this.applyScale();
    this.setWanted(0);
    this.btnAttack.classList.remove('hidden');
    this.btnWeapon.classList.remove('hidden');
    this.setActionLabel('ENTRA');
  }

  /* -------------------------------------------------------------- */
  /* Visibility / basic values                                       */
  /* -------------------------------------------------------------- */

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
    if (!visible) {
      this.input.setJoystick(0, 0, false);
      this.resetJoystickVisual();
    }
  }

  setTouchVisible(visible: boolean): void {
    this.touchUi.classList.toggle('hidden', !visible);
    // Touch-only CSS (48 px targets) must follow the actual input mode.
    document.body.classList.toggle('is-touch', visible);
  }

  applyScale(): void {
    const layout = this.settings.touchLayout ?? 'standard';
    // 0.9 keeps the small buttons at 48.6 px even at the lowest setting.
    let scale = clamp(this.settings.joystickScale, 0.9, 1.35);
    if (layout !== 'standard') scale = Math.min(scale, 0.9);
    document.documentElement.style.setProperty('--btn-scale', String(scale));
    this.touchUi.classList.toggle('layout-compact', layout === 'compact');
    this.touchUi.classList.toggle('layout-one-hand', layout === 'oneHand');
    this.touchUi.classList.toggle('joystick-right', this.settings.joystickSide === 'right');
  }

  setCash(cash: number): void {
    this.cashEl.textContent = formatCash(cash);
  }

  /** Health / armor bars (0..100). */
  setVitals(health: number, armor: number): void {
    const h = Math.round(clamp(health, 0, 100));
    const a = Math.round(clamp(armor, 0, 100));
    if (h !== this.lastHealth) {
      this.lastHealth = h;
      this.healthEl.style.width = `${h}%`;
      this.healthEl.classList.toggle('low', h < 30);
    }
    if (a !== this.lastArmor) {
      this.lastArmor = a;
      this.armorEl.style.width = `${a}%`;
    }
  }

  /** Sprint stamina (0..100). */
  setStamina(stamina: number): void {
    const s = Math.round(clamp(stamina, 0, 100));
    if (s === this.lastStamina) return;
    this.lastStamina = s;
    this.staminaEl.style.width = `${s}%`;
    this.staminaEl.classList.toggle('low', s < 25);
  }

  /** Flash the impact marker; red when the shot killed the target. */
  flashHit(killed: boolean): void {
    this.hitMarker.classList.remove('on', 'kill');
    void this.hitMarker.offsetWidth;
    this.hitMarker.classList.add('on');
    if (killed) this.hitMarker.classList.add('kill');
  }

  setWanted(level: number): void {
    if (level === this.lastWanted) return;
    this.lastWanted = level;
    for (let i = 0; i < this.stars.length; i++) {
      const star = this.stars[i];
      star.classList.toggle('on', i < level);
      star.classList.toggle('hot', i < level && level >= 4);
    }
    this.root.classList.toggle('wanted-high', level >= 3);
  }

  setRegion(name: string): void {
    if (this.regionEl.textContent !== name) this.regionEl.textContent = name;
  }

  setClock(time: string, weather: string): void {
    if (this.timeEl.textContent !== time) this.timeEl.textContent = time;
    if (this.weatherEl.textContent !== weather) this.weatherEl.textContent = weather;
  }

  /* -------------------------------------------------------------- */
  /* Prompts / toasts / mission                                      */
  /* -------------------------------------------------------------- */

  setPrompt(text: string | null, key = 'E'): void {
    if (!text) {
      if (this.promptVisible) {
        this.promptEl.classList.add('hidden');
        this.promptVisible = false;
      }
      return;
    }
    this.promptKey.textContent = key;
    this.promptText.textContent = text;
    if (!this.promptVisible) {
      this.promptEl.classList.remove('hidden');
      this.promptVisible = true;
    }
  }

  setActionLabel(label: string): void {
    if (this.btnAction.textContent !== label) this.btnAction.textContent = label;
  }

  toast(title: string, text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    while (this.notifications.children.length >= 4) {
      this.notifications.removeChild(this.notifications.firstChild as Node);
    }
    const el = document.createElement('div');
    el.className = `toast${kind === 'bad' ? ' toast--bad' : kind === 'good' ? ' toast--good' : ''}`;
    if (title) {
      const t = document.createElement('div');
      t.className = 'toast__title';
      t.textContent = title;
      el.appendChild(t);
    }
    const body = document.createElement('div');
    body.textContent = text;
    el.appendChild(body);
    this.notifications.appendChild(el);
    window.setTimeout(() => {
      el.classList.add('fade');
      window.setTimeout(() => el.remove(), 450);
    }, 3600);
  }

  setMission(title: string | null, objective = '', timer: number | null = null): void {
    if (!title) {
      this.missionPanel.classList.add('hidden');
      return;
    }
    this.missionPanel.classList.remove('hidden');
    this.missionTitle.textContent = title;
    this.missionObj.textContent = objective;
    if (timer !== null) {
      this.missionTimer.classList.remove('hidden');
      this.missionTimer.textContent = formatTimer(timer);
    } else {
      this.missionTimer.classList.add('hidden');
    }
  }

  updateMissionTimer(timer: number | null): void {
    if (timer === null) {
      this.missionTimer.classList.add('hidden');
    } else {
      this.missionTimer.classList.remove('hidden');
      this.missionTimer.textContent = formatTimer(timer);
    }
  }

  showSubtitle(text: string, seconds = 4): void {
    this.subtitle.textContent = text;
    this.subtitle.classList.remove('hidden');
    this.subtitleTimer = seconds;
  }

  updateHelp(text: string): void {
    if (this.help.textContent !== text) this.help.textContent = text;
  }

  /* -------------------------------------------------------------- */
  /* Vehicle HUD                                                     */
  /* -------------------------------------------------------------- */

  setVehicleMode(inVehicle: boolean, vehicleName = '', kmh = 0, ratio = 0): void {
    if (this.vehicleMode !== inVehicle) {
      this.vehicleMode = inVehicle;
      this.actionCluster.classList.toggle('vehicle', inVehicle);
      this.touchUi.classList.toggle('vehicle', inVehicle);
      this.btnJump.classList.toggle('hidden', inVehicle);
      this.btnSprint.classList.toggle('hidden', inVehicle);
      this.btnAttack.classList.toggle('hidden', inVehicle);
      this.btnWeapon.classList.toggle('hidden', inVehicle);
      this.btnAim.classList.toggle('hidden', inVehicle);
      this.btnReload.classList.toggle('hidden', inVehicle);
      this.driveCluster.classList.toggle('hidden', !inVehicle);
      this.btnAction.classList.toggle('exit', inVehicle);
      if (inVehicle) this.setAim(false);
    }
    this.speedo.classList.toggle('hidden', !inVehicle);
    if (inVehicle) {
      this.speedoName.textContent = vehicleName;
      this.speedoKmh.textContent = `${Math.round(kmh)} KM/H`;
      this.speedoFill.style.width = `${clamp(ratio * 100, 0, 100)}%`;
    }
  }

  setAim(aiming: boolean): void {
    this.reticle.classList.toggle('hidden', !aiming || this.vehicleMode);
  }

  setWeaponLabel(label: string): void {
    if (this.btnWeapon.textContent !== label) this.btnWeapon.textContent = label;
  }

  /** Contextual reload button: hidden with a full magazine or while driving. */
  setReloadState(reloading: boolean, canReload: boolean): void {
    const visible = !this.vehicleMode && (reloading || canReload);
    this.btnReload.classList.toggle('hidden', !visible);
    this.btnReload.classList.toggle('reloading', reloading);
    const label = reloading ? '...' : 'RICA';
    if (this.btnReload.textContent !== label) this.btnReload.textContent = label;
  }

  update(dt: number): void {
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.subtitle.classList.add('hidden');
    }
  }

  /* -------------------------------------------------------------- */
  /* Minimap                                                         */
  /* -------------------------------------------------------------- */

  updateMinimap(
    world: World,
    player: Player,
    vehicles: VehicleSystem,
    peds: PedestrianSystem,
    police: PoliceSystem,
    yaw: number,
    waypoint: Waypoint | null,
    mission: MissionMarker | null,
  ): void {
    const ctx = this.minimapCtx;
    const size = this.minimap.width;
    const center = size / 2;
    const radiusPx = center - 3;
    const range = 265;
    const scale = radiusPx / range;
    const px = player.position.x;
    const pz = player.position.z;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);

    const project = (wx: number, wz: number): { x: number; y: number } => {
      const rx = wx - px;
      const rz = wz - pz;
      return {
        x: center + (rx * cos - rz * sin) * scale,
        y: center - (rx * sin + rz * cos) * scale,
      };
    };

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, radiusPx, 0, TAU);
    ctx.clip();

    ctx.fillStyle = '#101a17';
    ctx.fillRect(0, 0, size, size);

    // coarse water mask for coastline hints
    const cells = 16;
    const step = (range * 2) / cells;
    ctx.fillStyle = '#12313a';
    for (let ix = 0; ix < cells; ix++) {
      for (let iz = 0; iz < cells; iz++) {
        const wx = px - range + (ix + 0.5) * step;
        const wz = pz - range + (iz + 0.5) * step;
        if (world.isWater(wx, wz)) {
          const p0 = project(wx - step / 2, wz - step / 2);
          const cellSize = step * scale;
          ctx.fillRect(p0.x, p0.y, cellSize + 0.6, cellSize + 0.6);
        }
      }
    }

    // roads
    const segs: RoadSegment[] = [];
    world.roads.segmentsInRect(px - range, pz - range, px + range, pz + range, segs);
    for (const seg of segs) {
      if (seg.points.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < seg.points.length; i++) {
        const p = project(seg.points[i].x, seg.points[i].z);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      const isHighway = seg.roadClass === 'highway';
      const isArterial = seg.roadClass === 'arterial';
      ctx.strokeStyle = isHighway ? '#8b8a80' : isArterial ? '#6d6f68' : '#4d5049';
      ctx.lineWidth = isHighway ? 3 : isArterial ? 2.2 : 1.3;
      ctx.stroke();
    }

    // pedestrians
    ctx.fillStyle = 'rgba(214, 190, 154, 0.55)';
    for (const ped of peds.peds) {
      if (ped.state === 'dead') continue;
      const p = project(ped.x, ped.z);
      if (p.x < 0 || p.y < 0 || p.x > size || p.y > size) continue;
      ctx.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6);
    }

    // traffic
    for (const v of vehicles.vehicles) {
      if (v.destroyed || v === vehicles.playerVehicle) continue;
      const p = project(v.position.x, v.position.z);
      if (p.x < 0 || p.y < 0 || p.x > size || p.y > size) continue;
      const isPolice = v.driver === 'police';
      ctx.fillStyle = isPolice ? '#6ea8ff' : v.driver === 'npc' ? '#d8d2c4' : '#9a948a';
      ctx.beginPath();
      ctx.arc(p.x, p.y, isPolice ? 3 : 2.2, 0, TAU);
      ctx.fill();
    }

    // police on foot
    for (const cop of police.all) {
      if (cop.state === 'dead') continue;
      const p = project(cop.x, cop.z);
      ctx.fillStyle = '#7fb0ff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.6, 0, TAU);
      ctx.fill();
    }

    // waypoint
    if (waypoint) {
      const p = project(waypoint.x, waypoint.z);
      const clamped = clampToCircle(p.x, p.y, center, center, radiusPx - 8);
      drawDiamond(ctx, clamped.x, clamped.y, 6, '#6fe3d4');
    }

    // mission marker
    if (mission) {
      const p = project(mission.x, mission.z);
      const clamped = clampToCircle(p.x, p.y, center, center, radiusPx - 10);
      drawDiamond(ctx, clamped.x, clamped.y, mission.giver ? 5 : 7, '#ffd489');
    }

    // player arrow
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(center, center - 7);
    ctx.lineTo(center + 5, center + 6);
    ctx.lineTo(center, center + 3);
    ctx.lineTo(center - 5, center + 6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  /* -------------------------------------------------------------- */
  /* Touch controls                                                  */
  /* -------------------------------------------------------------- */

  private bindTouch(callbacks: {
    onPause: () => void;
    onMap: () => void;
    onWeapon: () => void;
    onCamera: () => void;
  }): void {
    const zone = this.joystickZone;
    const updateJoy = (clientX: number, clientY: number): void => {
      const rect = this.joystickBase.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const max = rect.width * 0.5;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      this.input.setJoystick(dx / max, -dy / max, true);
      this.joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    };

    zone.addEventListener('pointerdown', (e) => {
      if (this.joyPointer !== -1) return;
      e.preventDefault();
      this.joyPointer = e.pointerId;
      zone.setPointerCapture?.(e.pointerId);
      this.joystickBase.style.opacity = '1';
      updateJoy(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joyPointer) return;
      e.preventDefault();
      updateJoy(e.clientX, e.clientY);
    });
    const endJoy = (e: PointerEvent): void => {
      if (e.pointerId !== this.joyPointer) return;
      this.joyPointer = -1;
      this.input.setJoystick(0, 0, false);
      this.resetJoystickVisual();
    };
    zone.addEventListener('pointerup', endJoy);
    zone.addEventListener('pointercancel', endJoy);
    zone.addEventListener('lostpointercapture', endJoy);

    this.holdButton(this.btnAction, 'interact');
    this.holdButton(this.btnJump, 'jump');
    this.holdButton(this.btnSprint, 'sprint');
    this.holdButton(this.btnAttack, 'attack');
    this.holdButton(this.btnAim, 'aim');
    this.holdButton(this.btnReload, 'reload');
    this.holdButton(this.btnGas, 'gas');
    this.holdButton(this.btnBrake, 'brake');
    this.holdButton(this.btnHandbrake, 'handbrake');
    this.holdButton(this.btnHorn, 'horn');
    this.holdButton(this.btnReset, 'reset');

    const tap = (button: HTMLButtonElement, fn: () => void): void => {
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      });
    };
    tap(this.btnPause, callbacks.onPause);
    tap(this.btnMap, callbacks.onMap);
    tap(this.btnWeapon, callbacks.onWeapon);
    tap(this.btnCamera, callbacks.onCamera);
  }

  private holdButton(button: HTMLButtonElement, action: ActionName): void {
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      button.setPointerCapture?.(e.pointerId);
      button.classList.add('down');
      this.input.virtualPress(action);
    });
    const release = (e: PointerEvent): void => {
      e.preventDefault();
      button.classList.remove('down');
      this.input.virtualRelease(action);
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  }

  private resetJoystickVisual(): void {
    this.joystickKnob.style.transform = 'translate(0px, 0px)';
    this.joystickBase.style.opacity = '0.75';
  }

  dispose(): void {
    this.notifications.innerHTML = '';
  }
}

function clampToCircle(
  x: number,
  y: number,
  cx: number,
  cy: number,
  radius: number,
): { x: number; y: number } {
  const dx = x - cx;
  const dy = y - cy;
  const len = Math.hypot(dx, dy);
  if (len <= radius) return { x, y };
  return { x: cx + (dx / len) * radius, y: cy + (dy / len) * radius };
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
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.strokeRect(-size / 2, -size / 2, size, size);
  ctx.restore();
}
