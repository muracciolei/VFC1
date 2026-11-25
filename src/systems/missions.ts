/**
 * Story missions: six original jobs across Italy, with waypoints, timers,
 * scripted police heat, target vehicles and progress persistence.
 */

import * as THREE from 'three';
import { clamp, dist2D } from '../core/math';
import { events } from '../core/events';
import { World } from '../world/world';
import { Player } from '../entities/player';
import { Vehicle, VehicleTypeId } from '../entities/vehicle';
import { VehicleSystem } from './vehicles';
import { PoliceSystem } from './police';

export type MissionState = 'locked' | 'available' | 'active' | 'done';

export type StepKind = 'reach' | 'steal' | 'destroy' | 'survive' | 'escape';

export interface MissionStep {
  text: string;
  kind: StepKind;
  poiId?: string;
  radius?: number;
  requireVehicle?: boolean;
  timer?: number;
  wanted?: number;
}

/** Serializable snapshot of the active mission, persisted with the save file. */
export interface MissionProgress {
  id: string;
  /** Display fields are optional so saves written before they existed still load. */
  title?: string;
  stepIndex: number;
  stepTotal?: number;
  stepTimer: number;
  timeLeft: number | null;
  targetDestroyed: boolean;
  timer?: number | null;
}

export interface MissionDef {
  id: string;
  title: string;
  giverPoi: string;
  giverName: string;
  description: string;
  reward: number;
  steps: MissionStep[];
  timeLimit?: number;
  requires?: string;
  targetVehicle?: { type: VehicleTypeId; color: string; poiId: string; ox: number; oz: number };
}

const MISSIONS: MissionDef[] = [
  {
    id: 'primo_giro',
    title: 'PRIMO GIRO',
    giverPoi: 'milano_mission',
    giverName: 'SERGIO “IL CONTABILE”',
    description:
      'Un favore semplice: prendi un’auto in centro e portala al garage. Senza domande, senza incidenti.',
    reward: 900,
    steps: [
      { text: 'Raggiungi il garage di Milano', kind: 'reach', poiId: 'milano_garage', radius: 14 },
      { text: 'Entra in un veicolo qualsiasi', kind: 'steal' },
      {
        text: 'Porta l’auto all’armeria di Milano',
        kind: 'reach',
        poiId: 'milano_gunshop',
        radius: 14,
        requireVehicle: true,
      },
    ],
  },
  {
    id: 'consegna_speciale',
    title: 'CONSEGNA SPECIALE',
    giverPoi: 'milano_mission',
    giverName: 'SERGIO “IL CONTABILE”',
    description:
      'Un pacco riservato deve arrivare a Torino prima che faccia buio. Guida veloce e non farti fermare.',
    reward: 1500,
    timeLimit: 280,
    requires: 'primo_giro',
    steps: [
      { text: 'Ritira il pacco all’armeria di Milano', kind: 'reach', poiId: 'milano_gunshop', radius: 12 },
      {
        text: 'Consegna il pacco alla casa sicura di Torino',
        kind: 'reach',
        poiId: 'torino_safehouse',
        radius: 14,
        requireVehicle: true,
      },
    ],
  },
  {
    id: 'sirene',
    title: 'SIRENE',
    giverPoi: 'torino_mission',
    giverName: 'COMMISSARIO BRUNO',
    description:
      'La polizia ti sta cercando. Sopravvivi abbastanza a lungo da far parlare i giornali, poi sparisci.',
    reward: 2400,
    requires: 'consegna_speciale',
    steps: [
      { text: 'Sopravvivi alla caccia della polizia', kind: 'survive', timer: 40, wanted: 2 },
      { text: 'Semina le volanti', kind: 'escape', timer: 150 },
      { text: 'Raggiungi la casa sicura di Torino', kind: 'reach', poiId: 'torino_safehouse', radius: 14 },
    ],
  },
  {
    id: 'demolizione',
    title: 'DEMOLIZIONE',
    giverPoi: 'roma_mission',
    giverName: 'LUCIA “LA CHIOMA”',
    description:
      'Una sportiva rossa parcheggiata al garage di Roma appartiene alla persona sbagliata. Distruggila.',
    reward: 2600,
    requires: 'sirene',
    targetVehicle: { type: 'sportiva', color: '#b02a24', poiId: 'roma_garage', ox: 22, oz: 12 },
    steps: [
      { text: 'Trova la sportiva rossa al garage di Roma', kind: 'reach', poiId: 'roma_garage', radius: 22 },
      { text: 'Distruggi la sportiva rossa', kind: 'destroy' },
    ],
  },
  {
    id: 'gran_premio',
    title: 'GRAN PREMIO DI FIRENZE',
    giverPoi: 'firenze_mission',
    giverName: 'MASSIMO “IL CONTE”',
    description:
      'Tre punti di controllo tra le colline toscane. Un giro solo, cronometro implacabile. La macchina la metti tu.',
    reward: 3200,
    requires: 'demolizione',
    timeLimit: 170,
    steps: [
      {
        text: 'Checkpoint 1 — Casa sicura di Firenze',
        kind: 'reach',
        poiId: 'firenze_safehouse',
        radius: 16,
        requireVehicle: true,
      },
      {
        text: 'Checkpoint 2 — Garage di Firenze',
        kind: 'reach',
        poiId: 'firenze_garage',
        radius: 16,
        requireVehicle: true,
      },
      {
        text: 'Checkpoint 3 — Emporio di Firenze',
        kind: 'reach',
        poiId: 'firenze_shop',
        radius: 16,
        requireVehicle: true,
      },
    ],
  },
  {
    id: 'ultima_fuga',
    title: 'ULTIMA FUGA',
    giverPoi: 'palermo_mission',
    giverName: 'DON CALOGERO',
    description:
      'La tua ultima consegna: arriva al porto di Palermo, resisti alla Polizia e raggiungi la casa sicura. Poi sarai libero.',
    reward: 6000,
    requires: 'gran_premio',
    steps: [
      { text: 'Raggiungi il porto di Palermo', kind: 'reach', poiId: 'palermo_port', radius: 18 },
      { text: 'Resisti all’assedio della Polizia', kind: 'survive', timer: 60, wanted: 3 },
      { text: 'Semina tutte le unità', kind: 'escape', timer: 180 },
      { text: 'Raggiungi la casa sicura di Palermo', kind: 'reach', poiId: 'palermo_safehouse', radius: 14 },
    ],
  },
];

interface ActiveMission {
  def: MissionDef;
  stepIndex: number;
  stepTimer: number;
  timeLeft: number | null;
  targetVehicle: Vehicle | null;
  targetDestroyed: boolean;
}

export class MissionSystem {
  readonly defs = MISSIONS;
  states: Record<string, MissionState> = {};
  storyStage = 0;
  active: ActiveMission | null = null;

  private lastFailure: { id: string; stepIndex: number } | null = null;

  private scene: THREE.Scene;
  private world: World;
  private player: Player;
  private vehicles: VehicleSystem;
  private police: PoliceSystem;
  private marker: THREE.Group;
  private markerBeam: THREE.Mesh;
  private markerRing: THREE.Mesh;
  private markerVisible = false;
  private markerX = 0;
  private markerZ = 0;
  private markerY = 0;
  private markerIsGiver = false;
  private elapsed = 0;
  private offDestroyed: () => void;

  constructor(
    scene: THREE.Scene,
    world: World,
    player: Player,
    vehicles: VehicleSystem,
    police: PoliceSystem,
  ) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.vehicles = vehicles;
    this.police = police;

    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xe8b25a,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const beamGeo = new THREE.CylinderGeometry(1.5, 1.5, 26, 16, 1, true);
    beamGeo.translate(0, 13, 0);
    this.markerBeam = new THREE.Mesh(beamGeo, beamMat);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd28a,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.markerRing = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.7, 28), ringMat);
    this.markerRing.rotation.x = -Math.PI / 2;
    this.markerRing.position.y = 0.1;
    this.marker = new THREE.Group();
    this.marker.add(this.markerBeam, this.markerRing);
    this.marker.visible = false;
    scene.add(this.marker);

    this.offDestroyed = events.on('vehicle:destroyed', ({ vehicleId }) => {
      if (this.active?.targetVehicle && this.active.targetVehicle.id === vehicleId) {
        this.active.targetDestroyed = true;
      }
    });
  }

  load(
    states: Record<string, MissionState>,
    storyStage: number,
    progress: MissionProgress | null = null,
  ): void {
    this.states = { ...states };
    this.storyStage = storyStage;
    this.active = null;
    this.lastFailure = null;
    this.hideMarker();

    const restoreDef =
      progress && typeof progress.id === 'string'
        ? this.defs.find((def) => def.id === progress.id) ?? null
        : null;
    const restoreId =
      restoreDef &&
      progress &&
      this.states[restoreDef.id] === 'active' &&
      Number.isFinite(progress.stepIndex)
        ? restoreDef.id
        : null;

    for (const def of this.defs) {
      if (!this.states[def.id]) this.states[def.id] = 'locked';
      if (this.states[def.id] === 'active' && def.id !== restoreId) {
        this.states[def.id] = 'available';
      }
    }

    if (restoreId && restoreDef && progress) {
      const stepIndex = clamp(
        Math.round(progress.stepIndex),
        0,
        Math.max(0, restoreDef.steps.length - 1),
      );
      const stepTimer = Number.isFinite(progress.stepTimer)
        ? Math.max(0, progress.stepTimer)
        : 0;
      const timeLeft =
        typeof progress.timeLeft === 'number' && Number.isFinite(progress.timeLeft)
          ? Math.max(0, progress.timeLeft)
          : restoreDef.timeLimit ?? null;
      this.active = {
        def: restoreDef,
        stepIndex,
        stepTimer,
        timeLeft,
        targetVehicle: null,
        targetDestroyed: !!progress.targetDestroyed,
      };
      this.elapsed = 0;
      // Restore the elapsed time of timed steps instead of resetting them.
      this.enterStep({ stepTimer });
    }

    this.refreshAvailability();
  }

  private refreshAvailability(): void {
    for (let i = 0; i < this.defs.length; i++) {
      const def = this.defs[i];
      const state = this.states[def.id];
      if (state === 'done' || state === 'active') continue;
      const req = def.requires;
      if (!req || this.states[req] === 'done') {
        this.states[def.id] = 'available';
      } else {
        this.states[def.id] = 'locked';
      }
    }
  }

  stateOf(id: string): MissionState {
    return this.states[id] ?? 'locked';
  }

  availableMissions(): MissionDef[] {
    return this.defs.filter((d) => this.states[d.id] === 'available');
  }

  poiPosition(poiId: string): { x: number; z: number } | null {
    const poi = this.world.pois.find((p) => p.id === poiId);
    return poi ? { x: poi.x, z: poi.z } : null;
  }

  giverPosition(def: MissionDef): { x: number; z: number } | null {
    return this.poiPosition(def.giverPoi);
  }

  /** Returns the available mission whose giver is within `radius`. */
  missionNear(x: number, z: number, radius = 9): MissionDef | null {
    let best: MissionDef | null = null;
    let bestD = radius;
    for (const def of this.availableMissions()) {
      const p = this.giverPosition(def);
      if (!p) continue;
      const d = dist2D(x, z, p.x, p.z);
      if (d < bestD) {
        bestD = d;
        best = def;
      }
    }
    return best;
  }

  tryStartNearby(x: number, z: number): MissionDef | null {
    if (this.active) return null;
    const def = this.missionNear(x, z);
    if (!def) return null;
    this.start(def.id);
    return def;
  }

  start(id: string, fromStep = 0): boolean {
    if (this.active) return false;
    const def = this.defs.find((d) => d.id === id);
    if (!def || this.states[id] !== 'available') return false;
    this.states[id] = 'active';
    const stepIndex = clamp(Math.round(fromStep), 0, Math.max(0, def.steps.length - 1));
    this.active = {
      def,
      stepIndex,
      stepTimer: 0,
      timeLeft: def.timeLimit ?? null,
      targetVehicle: null,
      targetDestroyed: false,
    };
    this.lastFailure = null;
    this.elapsed = 0;
    events.emit('mission:start', { id: def.id, title: def.title });
    events.emit('ui:toast', {
      title: 'MISSIONE',
      text: `${def.title} — ${def.giverName}`,
      kind: 'info',
    });
    this.enterStep();
    return true;
  }

  /** Checkpoint information for the last failed mission, if any. */
  get retryInfo(): { id: string; stepIndex: number } | null {
    return this.lastFailure ? { ...this.lastFailure } : null;
  }

  /** Restart the failed mission from its last reached objective. */
  retryLastFailure(): boolean {
    const failure = this.lastFailure;
    if (!failure) return false;
    if (this.states[failure.id] !== 'available') return false;
    return this.start(failure.id, failure.stepIndex);
  }

  discardFailure(): void {
    this.lastFailure = null;
  }

  private enterStep(restore?: { stepTimer: number }): void {
    const active = this.active;
    if (!active) return;
    const step = active.def.steps[active.stepIndex];
    if (!step) {
      this.complete();
      return;
    }
    active.stepTimer = restore
      ? Math.max(0, restore.stepTimer)
      : step.timer ?? 0;

    if (step.kind === 'survive' && step.wanted) {
      this.police.forceLevel(step.wanted);
      this.police.setEscapeMode(false);
    }
    if (step.kind === 'escape') {
      this.police.setEscapeMode(true);
    }
    if (
      step.kind === 'destroy' &&
      active.def.targetVehicle &&
      !active.targetVehicle &&
      !active.targetDestroyed
    ) {
      this.spawnTarget(active.def);
    }

    events.emit('mission:objective', { id: active.def.id, text: step.text });
    // A restored mission is already a checkpoint: emitting it again would
    // autosave while the new session is still being assembled.
    if (!restore) {
      events.emit('mission:checkpoint', {
        index: active.stepIndex + 1,
        total: active.def.steps.length,
      });
    }
    events.emit('ui:missionPanel', {
      title: active.def.title,
      objective: step.text,
      timer: this.timerValue(),
    });
    this.updateMarkerForStep();
  }

  private spawnTarget(def: MissionDef): void {
    const cfg = def.targetVehicle;
    if (!cfg || !this.active) return;
    const poi = this.poiPosition(cfg.poiId);
    if (!poi) return;
    const x = poi.x + cfg.ox;
    const z = poi.z + cfg.oz;
    const v = this.vehicles.spawnAt(cfg.type, x, z, Math.random() * Math.PI * 2, cfg.color);
    this.active.targetVehicle = v;
    this.active.targetDestroyed = false;
    events.emit('ui:toast', {
      title: 'OBIETTIVO',
      text: 'La sportiva rossa è stata segnata sulla mappa.',
      kind: 'info',
    });
  }

  update(dt: number): void {
    this.elapsed += dt;
    const active = this.active;

    if (!active) {
      this.updateGiverMarker();
      this.animateMarker(dt);
      return;
    }

    if (active.timeLeft !== null) {
      active.timeLeft -= dt;
      if (active.timeLeft <= 0) {
        this.fail('Tempo scaduto.');
        return;
      }
    }

    const step = active.def.steps[active.stepIndex];
    if (!step) {
      this.complete();
      return;
    }

    if (active.stepTimer > 0) active.stepTimer = Math.max(0, active.stepTimer - dt);

    if (step.kind === 'reach') {
      const pos = step.poiId ? this.poiPosition(step.poiId) : null;
      if (pos) {
        const radius = step.radius ?? 14;
        const inVehicle = this.player.inVehicle;
        const okVehicle = !step.requireVehicle || inVehicle;
        if (okVehicle && dist2D(this.player.position.x, this.player.position.z, pos.x, pos.z) < radius) {
          this.advance();
        }
      }
    } else if (step.kind === 'steal') {
      if (this.player.inVehicle) this.advance();
    } else if (step.kind === 'destroy') {
      if (active.targetDestroyed || (active.targetVehicle && active.targetVehicle.destroyed)) {
        this.advance();
      }
    } else if (step.kind === 'survive') {
      if (step.wanted) {
        const min = Math.max(1, step.wanted - 1);
        if (this.police.level < min) this.police.forceLevel(step.wanted);
      }
      if (active.stepTimer <= 0) this.advance();
    } else if (step.kind === 'escape') {
      if (this.police.level === 0) {
        this.advance();
      } else if (active.stepTimer <= 0) {
        this.fail('Non sei riuscito a seminarli.');
        return;
      }
    }

    this.updateMarkerForStep();
    this.animateMarker(dt);
  }

  private advance(): void {
    const active = this.active;
    if (!active) return;
    active.stepIndex++;
    if (active.stepIndex >= active.def.steps.length) {
      this.complete();
    } else {
      this.enterStep();
    }
  }

  private complete(): void {
    const active = this.active;
    if (!active) return;
    const def = active.def;
    this.states[def.id] = 'done';
    this.storyStage++;
    this.active = null;
    this.lastFailure = null;
    this.hideMarker();
    events.emit('mission:complete', { id: def.id, reward: def.reward });
    events.emit('ui:missionPanel', null);
    events.emit('ui:toast', {
      title: 'MISSIONE COMPLETATA',
      text: `${def.title} · €${def.reward}`,
      kind: 'good',
    });
    this.refreshAvailability();
    this.police.setEscapeMode(false);
  }

  /** Abort the current mission from outside (death, menu, etc.). */
  failActive(reason: string): void {
    if (this.active) this.fail(reason);
  }

  get isActive(): boolean {
    return this.active !== null;
  }

  /** Serializable state of the active mission, used by the save system. */
  snapshot(): MissionProgress | null {
    const active = this.active;
    if (!active) return null;
    return {
      id: active.def.id,
      title: active.def.title,
      stepIndex: active.stepIndex,
      stepTotal: active.def.steps.length,
      stepTimer: active.stepTimer,
      timeLeft: active.timeLeft,
      targetDestroyed: active.targetDestroyed,
      timer: this.timerValue(),
    };
  }

  private fail(reason: string): void {
    const active = this.active;
    if (!active) return;
    const def = active.def;
    this.lastFailure = { id: def.id, stepIndex: active.stepIndex };
    this.states[def.id] = 'available';
    this.active = null;
    this.hideMarker();
    events.emit('mission:fail', { id: def.id, reason });
    events.emit('ui:missionPanel', null);
    events.emit('ui:toast', { title: 'MISSIONE FALLITA', text: reason, kind: 'bad' });
    this.police.setEscapeMode(true);
    this.refreshAvailability();
  }

  private timerValue(): number | null {
    const active = this.active;
    if (!active) return null;
    const step = active.def.steps[active.stepIndex];
    if (step?.timer) return active.stepTimer;
    if (active.timeLeft !== null) return active.timeLeft;
    return null;
  }

  get currentTimer(): number | null {
    return this.timerValue();
  }

  /* -------------------------------------------------------------- */
  /* Markers                                                         */
  /* -------------------------------------------------------------- */

  private updateMarkerForStep(): void {
    const active = this.active;
    if (!active) {
      this.updateGiverMarker();
      return;
    }
    const step = active.def.steps[active.stepIndex];
    if (!step) {
      this.hideMarker();
      return;
    }
    if (step.kind === 'reach' && step.poiId) {
      const pos = this.poiPosition(step.poiId);
      if (pos) {
        this.setMarker(pos.x, pos.z, false);
        return;
      }
    }
    if (step.kind === 'destroy' && active.targetVehicle) {
      this.setMarker(active.targetVehicle.position.x, active.targetVehicle.position.z, false);
      return;
    }
    this.hideMarker();
  }

  private updateGiverMarker(): void {
    const missions = this.availableMissions();
    if (missions.length === 0) {
      this.hideMarker();
      return;
    }
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (const def of missions) {
      const pos = this.giverPosition(def);
      if (!pos) continue;
      const d = dist2D(pos.x, pos.z, this.player.position.x, this.player.position.z);
      if (d < bestD) {
        bestD = d;
        best = pos;
      }
    }
    if (!best || bestD > 900) {
      this.hideMarker();
      return;
    }
    this.setMarker(best.x, best.z, true);
  }

  private setMarker(x: number, z: number, giver: boolean): void {
    this.markerX = x;
    this.markerZ = z;
    this.markerY = this.world.groundHeight(x, z) + 0.05;
    this.markerIsGiver = giver;
    this.marker.position.set(x, this.markerY, z);
    this.marker.visible = true;
    this.markerVisible = true;
    const color = giver ? 0xffd28a : 0xe8b25a;
    (this.markerBeam.material as THREE.MeshBasicMaterial).color.setHex(color);
    (this.markerRing.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  private hideMarker(): void {
    this.marker.visible = false;
    this.markerVisible = false;
  }

  private animateMarker(dt: number): void {
    if (!this.markerVisible) return;
    this.markerRing.rotation.z += dt * 0.7;
    const pulse = 0.7 + Math.sin(this.elapsed * 2.4) * 0.15;
    (this.markerBeam.material as THREE.MeshBasicMaterial).opacity = this.markerIsGiver
      ? 0.1 + pulse * 0.06
      : 0.14 + pulse * 0.08;
    if (this.active?.def.steps[this.active.stepIndex]?.kind === 'destroy') {
      const target = this.active.targetVehicle;
      if (target) {
        this.marker.position.set(
          target.position.x,
          target.position.y + 0.05,
          target.position.z,
        );
      }
    }
  }

  get objectiveMarker(): { x: number; z: number; giver: boolean } | null {
    if (!this.markerVisible) return null;
    return { x: this.markerX, z: this.markerZ, giver: this.markerIsGiver };
  }

  get activeTitle(): string | null {
    return this.active?.def.title ?? null;
  }

  get activeObjective(): string | null {
    if (!this.active) return null;
    return this.active.def.steps[this.active.stepIndex]?.text ?? null;
  }

  dispose(): void {
    this.offDestroyed();
    this.scene.remove(this.marker);
    this.marker.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }
}
