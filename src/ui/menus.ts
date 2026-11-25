/**
 * All DOM panels: boot, main menu, pause, settings, controls, missions,
 * garage/shop, wasted screen and dialogue.
 */

import { formatCash, formatTimer } from '../core/math';
import { applyMobilePreset, GameSettings, QualityLevel, settings } from '../core/settings';
import { saveManager } from '../core/save';

export type MissionCardState = 'locked' | 'available' | 'active' | 'done';

export interface MissionListItem {
  id: string;
  title: string;
  description: string;
  meta: string;
  state: MissionCardState;
}

export interface GarageItem {
  id: string;
  name: string;
  classLabel: string;
  price: number;
  owned: boolean;
  actionLabel: string;
  disabled?: boolean;
}

export interface MenuCallbacks {
  onContinue: () => void;
  onNewGame: () => void;
  onOpenSettings: () => void;
  onOpenControls: () => void;
  onResume: () => void;
  onPauseMap: () => void;
  onPauseMissions: () => void;
  onPauseGarage: () => void;
  onPauseSettings: () => void;
  onPauseSave: () => void;
  onPauseMenu: () => void;
  onMissionsClose: () => void;
  onGarageClose: () => void;
  onSettingsClose: () => void;
  onControlsClose: () => void;
  onSettingsApplied: (settings: GameSettings) => void;
  onResetSave: () => void;
  onRespawn: () => void;
  onDialogueDone: () => void;
  onMissionAction: (id: string) => void;
  onGarageAction: (id: string) => void;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing UI element #${id}`);
  return el as T;
}

function show(el: HTMLElement): void {
  el.classList.remove('hidden');
}

function hide(el: HTMLElement): void {
  el.classList.add('hidden');
}

export class Menus {
  private boot = byId<HTMLElement>('boot');
  private bootStatus = byId<HTMLElement>('boot-status');
  private bootFill = byId<HTMLElement>('boot-fill');
  private menu = byId<HTMLElement>('menu');
  private menuProfile = byId<HTMLElement>('menu-profile');
  private menuHint = byId<HTMLElement>('menu-hint');
  private continueBtn = byId<HTMLButtonElement>('btn-continue');
  private continueMeta = byId<HTMLElement>('continue-meta');
  private pause = byId<HTMLElement>('pause');
  private pauseLocation = byId<HTMLElement>('pause-location');
  private pauseStats = byId<HTMLElement>('pause-stats');
  private missions = byId<HTMLElement>('missions');
  private missionList = byId<HTMLElement>('mission-list');
  private garage = byId<HTMLElement>('garage');
  private garageTitle = document.querySelector('#garage .panel h2') as HTMLElement | null;
  private garageCash = byId<HTMLElement>('garage-cash');
  private garageList = byId<HTMLElement>('garage-list');
  private settingsScreen = byId<HTMLElement>('settings');
  private settingsBody = byId<HTMLElement>('settings-body');
  private controls = byId<HTMLElement>('controls');
  private controlsBody = byId<HTMLElement>('controls-body');
  private wasted = byId<HTMLElement>('wasted');
  private wastedSub = document.querySelector('#wasted .wasted__sub') as HTMLElement | null;
  private wastedCost = byId<HTMLElement>('wasted-cost');
  private dialogue = byId<HTMLElement>('dialogue');
  private dialogueName = byId<HTMLElement>('dialogue-name');
  private dialogueText = byId<HTMLElement>('dialogue-text');
  private dialogueBtn = byId<HTMLButtonElement>('btn-dialogue');

  private cb: MenuCallbacks;
  private draft: GameSettings = { ...settings.value };
  private dialogueLines: string[] = [];
  private dialogueIndex = 0;
  private dialogueActive = false;

  constructor(callbacks: MenuCallbacks) {
    this.cb = callbacks;

    this.continueBtn.addEventListener('click', () => this.cb.onContinue());
    byId<HTMLButtonElement>('btn-new').addEventListener('click', () => this.cb.onNewGame());
    byId<HTMLButtonElement>('btn-settings').addEventListener('click', () => this.cb.onOpenSettings());
    byId<HTMLButtonElement>('btn-controls').addEventListener('click', () => this.cb.onOpenControls());

    byId<HTMLButtonElement>('btn-resume').addEventListener('click', () => this.cb.onResume());
    byId<HTMLButtonElement>('btn-pause-map').addEventListener('click', () => this.cb.onPauseMap());
    byId<HTMLButtonElement>('btn-pause-missions').addEventListener('click', () => this.cb.onPauseMissions());
    byId<HTMLButtonElement>('btn-pause-garage').addEventListener('click', () => this.cb.onPauseGarage());
    byId<HTMLButtonElement>('btn-pause-settings').addEventListener('click', () => this.cb.onPauseSettings());
    byId<HTMLButtonElement>('btn-pause-save').addEventListener('click', () => this.cb.onPauseSave());
    byId<HTMLButtonElement>('btn-pause-menu').addEventListener('click', () => this.cb.onPauseMenu());

    byId<HTMLButtonElement>('btn-missions-close').addEventListener('click', () => this.cb.onMissionsClose());
    byId<HTMLButtonElement>('btn-garage-close').addEventListener('click', () => this.cb.onGarageClose());
    byId<HTMLButtonElement>('btn-settings-close').addEventListener('click', () => this.cb.onSettingsClose());
    byId<HTMLButtonElement>('btn-controls-close').addEventListener('click', () => this.cb.onControlsClose());

    byId<HTMLButtonElement>('btn-settings-apply').addEventListener('click', () => this.applySettings());
    byId<HTMLButtonElement>('btn-reset-save').addEventListener('click', () => {
      if (window.confirm('Cancellare tutti i progressi? L’operazione è irreversibile.')) {
        saveManager.clear();
        this.cb.onResetSave();
      }
    });

    byId<HTMLButtonElement>('btn-respawn').addEventListener('click', () => this.cb.onRespawn());
    this.dialogueBtn.addEventListener('click', () => this.advanceDialogue());

    this.buildControls();
  }

  /* -------------------------------------------------------------- */
  /* Boot / menu                                                     */
  /* -------------------------------------------------------------- */

  setBoot(progress: number, label: string): void {
    this.bootFill.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
    this.bootStatus.textContent = label;
  }

  hideBoot(): void {
    hide(this.boot);
  }

  showMenu(): void {
    const summary = saveManager.summary();
    if (summary) {
      this.continueBtn.disabled = false;
      const stats = `€${formatCash(summary.cash)} · ${summary.missions} missioni · ${formatPlaytime(summary.playtime)}`;
      const mission = summary.mission;
      if (mission) {
        const line = document.createElement('span');
        line.className = 'continue-meta__mission';
        const timer = mission.timer !== null ? ` · ${formatTimer(mission.timer)}` : '';
        line.textContent = `${mission.title} · PASSO ${mission.stepIndex + 1}/${mission.stepTotal}${timer}`;
        this.continueMeta.replaceChildren(line, document.createTextNode(stats));
      } else {
        this.continueMeta.textContent = stats;
      }
      this.menuProfile.innerHTML = `
        <div><b>€${formatCash(summary.cash)}</b>CONTANTI</div>
        <div><b>${summary.missions}/6</b>MISSIONI</div>
        <div><b>${formatPlaytime(summary.playtime)}</b>IN GIOCO</div>`;
    } else {
      this.continueBtn.disabled = true;
      this.continueMeta.textContent = 'Nessun salvataggio';
      this.menuProfile.innerHTML = `
        <div><b>VFC 1</b>MINI ITALIA</div>
        <div><b>10</b>CITTÀ</div>
        <div><b>6</b>MISSIONI</div>`;
    }
    const touch = window.matchMedia('(pointer: coarse)').matches;
    this.menuHint.textContent = touch ? 'Touch · joystick e pulsanti' : 'WASD + mouse · gamepad supportato';
    show(this.menu);
    hide(this.pause);
    hide(this.missions);
    hide(this.garage);
    hide(this.settingsScreen);
    hide(this.controls);
    hide(this.wasted);
    hide(this.dialogue);
  }

  hideMenu(): void {
    hide(this.menu);
  }

  /* -------------------------------------------------------------- */
  /* Pause                                                           */
  /* -------------------------------------------------------------- */

  openPause(location: string, stats: { cash: number; missions: number; playtime: number }): void {
    this.pauseLocation.textContent = location;
    this.pauseStats.innerHTML = `
      <div><b>€${formatCash(stats.cash)}</b>CONTANTI</div>
      <div><b>${stats.missions}/6</b>MISSIONI</div>
      <div><b>${formatPlaytime(stats.playtime)}</b>IN GIOCO</div>`;
    show(this.pause);
  }

  closePause(): void {
    hide(this.pause);
  }

  /* -------------------------------------------------------------- */
  /* Missions                                                        */
  /* -------------------------------------------------------------- */

  openMissions(items: MissionListItem[]): void {
    this.missionList.innerHTML = '';
    items.forEach((item, index) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `mission-card ${item.state}`;
      const icon = document.createElement('div');
      icon.className = 'mission-card__icon';
      icon.textContent = item.state === 'done' ? '✓' : String(index + 1).padStart(2, '0');
      const body = document.createElement('div');
      body.className = 'mission-card__body';
      const title = document.createElement('div');
      title.className = 'mission-card__title';
      title.textContent = item.title;
      const desc = document.createElement('div');
      desc.className = 'mission-card__desc';
      desc.textContent = item.description;
      const meta = document.createElement('div');
      meta.className = 'mission-card__meta';
      meta.textContent = item.meta;
      body.append(title, desc, meta);
      card.append(icon, body);
      const disabled = item.state === 'locked' || item.state === 'done' || item.state === 'active';
      card.disabled = disabled;
      if (!disabled) card.addEventListener('click', () => this.cb.onMissionAction(item.id));
      this.missionList.appendChild(card);
    });
    show(this.missions);
  }

  closeMissions(): void {
    hide(this.missions);
  }

  /* -------------------------------------------------------------- */
  /* Garage / shop                                                   */
  /* -------------------------------------------------------------- */

  openGarage(
    mode: 'garage' | 'gunshop',
    cash: number,
    items: GarageItem[],
    note: string,
  ): void {
    if (this.garageTitle) this.garageTitle.textContent = mode === 'garage' ? 'GARAGE' : 'ARMERIA';
    this.garageCash.textContent = `€ ${formatCash(cash)}`;
    const noteEl = document.querySelector('#garage .panel__note');
    if (noteEl) noteEl.textContent = note;
    this.garageList.innerHTML = '';
    for (const item of items) {
      const card = document.createElement('div');
      card.className = `car-card${item.owned ? ' owned' : ''}`;
      const name = document.createElement('div');
      name.className = 'car-card__name';
      name.textContent = item.name;
      const cls = document.createElement('div');
      cls.className = 'car-card__class';
      cls.textContent = item.classLabel;
      const price = document.createElement('div');
      price.className = 'car-card__price';
      price.textContent = item.price > 0 ? `€ ${formatCash(item.price)}` : '—';
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'car-card__action';
      action.textContent = item.actionLabel;
      action.disabled = !!item.disabled;
      action.addEventListener('click', () => this.cb.onGarageAction(item.id));
      card.append(name, cls, price, action);
      this.garageList.appendChild(card);
    }
    show(this.garage);
  }

  closeGarage(): void {
    hide(this.garage);
  }

  refreshGarageCash(cash: number): void {
    this.garageCash.textContent = `€ ${formatCash(cash)}`;
  }

  /* -------------------------------------------------------------- */
  /* Settings                                                        */
  /* -------------------------------------------------------------- */

  openSettings(): void {
    this.draft = { ...settings.value };
    this.buildSettings();
    show(this.settingsScreen);
  }

  closeSettings(): void {
    hide(this.settingsScreen);
  }

  private buildSettings(): void {
    const body = this.settingsBody;
    body.innerHTML = '';

    body.appendChild(
      this.rangeRow('Sensibilità', 'Sensibilità della telecamera e del mirino.', 'sensitivity', 0.3, 2.5, 0.05, (v) => v.toFixed(2)),
    );
    body.appendChild(
      this.rangeRow('Sensibilità mirino', 'Mentre sei in mira.', 'aimSensitivity', 0.3, 2, 0.05, (v) => v.toFixed(2)),
    );
    body.appendChild(
      this.rangeRow('Campo visivo', 'Ampiezza della visuale (FOV).', 'fov', 55, 90, 1, (v) => `${Math.round(v)}°`),
    );
    body.appendChild(this.toggleRow('Inverti asse Y', 'Inverte il movimento verticale.', 'invertY'));
    body.appendChild(
      this.selectRow('Qualità', 'Preset grafico. Auto adatta la risoluzione.', 'quality', [
        ['auto', 'AUTOMATICA'],
        ['low', 'BASSA'],
        ['medium', 'MEDIA'],
        ['high', 'ALTA'],
      ]),
    );
    body.appendChild(this.mobilePresetRow());
    body.appendChild(this.toggleRow('Ombre', 'Ombre dinamiche del sole e dei veicoli.', 'shadows'));
    body.appendChild(this.toggleRow('Metriche', 'Mostra FPS, draw call, triangoli e risoluzione.', 'metrics'));
    body.appendChild(
      this.rangeRow('Scala joystick', 'Dimensione dei controlli touch. Minimo 48 px.', 'joystickScale', 0.9, 1.35, 0.05, (v) => `${Math.round(v * 100)}%`),
    );
    body.appendChild(
      this.selectRow('Lato joystick', 'Mano preferita per il movimento.', 'joystickSide', [
        ['left', 'SINISTRA'],
        ['right', 'DESTRA'],
      ]),
    );
    body.appendChild(
      this.selectRow('Layout táctil', 'Posizione dei comandi su schermo.', 'touchLayout', [
        ['standard', 'STANDARD'],
        ['compact', 'COMPATTO'],
        ['oneHand', 'UNA MANO'],
      ]),
    );
    body.appendChild(this.toggleRow('Accelerazione auto', 'L’auto accelera da sola.', 'autoAccelerate'));
    body.appendChild(this.toggleRow('Assistenza sterzo', 'Corregge leggermente la traiettoria.', 'steeringAssist'));
    body.appendChild(
      this.rangeRow('Musica', 'Volume della colonna sonora.', 'musicVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
    );
    body.appendChild(
      this.rangeRow('Effetti', 'Volume di armi, motori e ambiente.', 'sfxVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
    );
    body.appendChild(
      this.rangeRow('Motore', 'Volume del motore del veicolo.', 'engineVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
    );
    body.appendChild(this.toggleRow('Sottotitoli', 'Mostra i dialoghi e le radio.', 'subtitles'));
    body.appendChild(this.toggleRow('Suggerimenti', 'Mostra i comandi a schermo.', 'showHints'));
    body.appendChild(this.toggleRow('Vibrazione', 'Feedback aptico su mobile e gamepad.', 'vibration'));
  }

  /** One-tap setup for phone testing; reloads so the city is rebuilt. */
  private mobilePresetRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting';
    const labelEl = document.createElement('div');
    labelEl.className = 'setting__label';
    labelEl.textContent = 'Preset mobile';
    const small = document.createElement('small');
    small.textContent = 'Qualità bassa, ombre spente, metriche attive. Ricarica la città.';
    labelEl.appendChild(small);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mbtn mbtn--small';
    btn.textContent = 'ATTIVA';
    btn.addEventListener('click', () => {
      applyMobilePreset();
      window.location.reload();
    });
    row.append(labelEl, btn);
    return row;
  }

  private rangeRow(
    label: string,
    desc: string,
    key: keyof GameSettings,
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting';
    const labelEl = document.createElement('div');
    labelEl.className = 'setting__label';
    labelEl.textContent = label;
    const small = document.createElement('small');
    const updateSmall = (v: number): void => {
      small.textContent = `${desc} · ${format(v)}`;
    };
    labelEl.appendChild(small);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const value = Number(this.draft[key]);
    input.value = String(value);
    updateSmall(value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      (this.draft as unknown as Record<string, unknown>)[key] = v;
      updateSmall(v);
    });
    row.append(labelEl, input);
    return row;
  }

  private toggleRow(label: string, desc: string, key: keyof GameSettings): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting';
    const labelEl = document.createElement('div');
    labelEl.className = 'setting__label';
    labelEl.textContent = label;
    const small = document.createElement('small');
    small.textContent = desc;
    labelEl.appendChild(small);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `setting__toggle${this.draft[key] ? ' on' : ''}`;
    btn.addEventListener('click', () => {
      const next = !this.draft[key];
      (this.draft as unknown as Record<string, unknown>)[key] = next;
      btn.classList.toggle('on', next);
    });
    row.append(labelEl, btn);
    return row;
  }

  private selectRow(
    label: string,
    desc: string,
    key: keyof GameSettings,
    options: Array<[string, string]>,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting';
    const labelEl = document.createElement('div');
    labelEl.className = 'setting__label';
    labelEl.textContent = label;
    const small = document.createElement('small');
    small.textContent = desc;
    labelEl.appendChild(small);
    const select = document.createElement('select');
    for (const [value, text] of options) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      select.appendChild(opt);
    }
    select.value = String(this.draft[key]);
    select.addEventListener('change', () => {
      (this.draft as unknown as Record<string, unknown>)[key] = select.value;
    });
    row.append(labelEl, select);
    return row;
  }

  private applySettings(): void {
    // Mutate the shared object so systems holding a reference see the changes.
    Object.assign(settings.value, this.draft);
    settings.save();
    this.cb.onSettingsApplied(settings.value);
    hide(this.settingsScreen);
  }

  /* -------------------------------------------------------------- */
  /* Controls                                                        */
  /* -------------------------------------------------------------- */

  private buildControls(): void {
    const sections: Array<[string, Array<[string, string]>]> = [
      [
        'A piedi',
        [
          ['W A S D / Frecce', 'Muoviti'],
          ['Mouse', 'Guarda intorno'],
          ['Shift', 'Corri'],
          ['Spazio', 'Salta'],
          ['E', 'Interagisci / entra / esci'],
          ['F', 'Entra o esci dal veicolo'],
          ['Click sinistro', 'Spara'],
          ['Click destro', 'Mira'],
          ['R', 'Ricarica'],
          ['Q', 'Cambia arma'],
        ],
      ],
      [
        'Veicoli',
        [
          ['W / S', 'Accelera / frena e retromarcia'],
          ['A / D', 'Sterza'],
          ['Spazio', 'Freno a mano / drift'],
          ['H', 'Clacson'],
          ['F / E', 'Scendi dal veicolo'],
          ['C', 'Telecamera'],
        ],
      ],
      [
        'Interfaccia',
        [
          ['Esc / P', 'Pausa'],
          ['M / Tab', 'Mappa'],
          ['G', 'Telefono / officina rapida'],
          ['Mouse rotella', 'Zoom telecamera'],
        ],
      ],
      [
        'Touch',
        [
          ['Joystick', 'Movimento'],
          ['Trascina a destra', 'Guarda / mira'],
          ['ENTRA / ESCI', 'Interazione contestuale'],
          ['SALTA / CORRI / SPARA', 'Azioni a piedi'],
          ['▲ / ▼ / DRIFT', 'Guida'],
        ],
      ],
      [
        'Gamepad',
        [
          ['Stick sinistro', 'Movimento / sterzo'],
          ['Stick destro', 'Telecamera'],
          ['A / ×', 'Salta'],
          ['X / □', 'Spara'],
          ['Y / △', 'Ricarica'],
          ['RT', 'Accelera'],
          ['LT', 'Frena'],
          ['RB', 'Freno a mano'],
          ['Start', 'Pausa'],
        ],
      ],
    ];
    this.controlsBody.innerHTML = '';
    for (const [title, rows] of sections) {
      const h = document.createElement('h3');
      h.textContent = title;
      this.controlsBody.appendChild(h);
      for (const [key, desc] of rows) {
        const row = document.createElement('div');
        row.className = 'ctrl-row';
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        const span = document.createElement('span');
        span.textContent = desc;
        row.append(kbd, span);
        this.controlsBody.appendChild(row);
      }
    }
  }

  openControls(): void {
    show(this.controls);
  }

  closeControls(): void {
    hide(this.controls);
  }

  /* -------------------------------------------------------------- */
  /* Wasted                                                          */
  /* -------------------------------------------------------------- */

  showWasted(reason: string, cost: number): void {
    if (this.wastedSub) this.wastedSub.textContent = reason;
    this.wastedCost.textContent = cost > 0 ? `Costo medico: €${formatCash(cost)}` : 'Nessun costo medico.';
    show(this.wasted);
  }

  hideWasted(): void {
    hide(this.wasted);
  }

  /* -------------------------------------------------------------- */
  /* Dialogue                                                        */
  /* -------------------------------------------------------------- */

  showDialogue(name: string, lines: string[]): void {
    this.dialogueName.textContent = name;
    this.dialogueLines = lines;
    this.dialogueIndex = 0;
    this.dialogueActive = true;
    this.dialogueText.textContent = lines[0] ?? '';
    this.dialogueBtn.textContent = lines.length > 1 ? 'AVANTI' : 'FINE';
    show(this.dialogue);
  }

  advanceDialogue(): void {
    if (!this.dialogueActive) return;
    this.dialogueIndex++;
    if (this.dialogueIndex >= this.dialogueLines.length) {
      this.dialogueActive = false;
      hide(this.dialogue);
      this.cb.onDialogueDone();
      return;
    }
    this.dialogueText.textContent = this.dialogueLines[this.dialogueIndex];
    this.dialogueBtn.textContent =
      this.dialogueIndex >= this.dialogueLines.length - 1 ? 'FINE' : 'AVANTI';
  }

  get isDialogueOpen(): boolean {
    return this.dialogueActive;
  }

  /* -------------------------------------------------------------- */
  /* Misc                                                            */
  /* -------------------------------------------------------------- */

  refreshMenuSummary(): void {
    if (!this.menu.classList.contains('hidden')) this.showMenu();
  }

  hideAllScreens(): void {
    hide(this.menu);
    hide(this.pause);
    hide(this.missions);
    hide(this.garage);
    hide(this.settingsScreen);
    hide(this.controls);
    hide(this.wasted);
    hide(this.dialogue);
  }
}

export function formatPlaytime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export type { QualityLevel };
