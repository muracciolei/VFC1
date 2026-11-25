/** Tiny typed event bus used to decouple gameplay systems from UI/audio. */

export type EventMap = {
  'game:start': { newGame: boolean };
  'game:pause': { paused: boolean };
  'game:respawn': { cost: number };
  'game:death': { reason: string };
  'game:saved': { auto: boolean };

  'player:enterVehicle': { vehicleId: number };
  'player:exitVehicle': { vehicleId: number };
  'player:damaged': { amount: number; health: number };
  'player:healed': { health: number };
  'player:landed': { impact: number };
  'player:shoot': { weapon: string; position: [number, number, number]; direction: [number, number, number] };
  'combat:hit': { x: number; z: number; killed: boolean };

  'vehicle:crash': { vehicleId: number; impact: number; x: number; z: number };
  'vehicle:destroyed': { vehicleId: number; x: number; z: number };
  'vehicle:stolen': { vehicleId: number; x: number; z: number };

  'crime': { type: string; severity: number; x: number; z: number; witnessed: boolean };
  'wanted:changed': { level: number; searchRadius: number };
  'wanted:escape': Record<string, never>;

  'npc:shot': { x: number; z: number; killed: boolean };
  'npc:panic': { x: number; z: number; radius: number };
  'police:radio': { text: string };

  'mission:start': { id: string; title: string };
  'mission:objective': { id: string; text: string };
  'mission:complete': { id: string; reward: number };
  'mission:fail': { id: string; reason: string };
  'mission:checkpoint': { index: number; total: number };

  'ui:toast': { title?: string; text: string; kind?: 'info' | 'good' | 'bad' };
  'ui:prompt': { text: string; key: string } | null;
  'ui:dialogue': { name: string; lines: string[] } | null;
  'ui:missionPanel': { title: string; objective: string; timer: number | null } | null;

  'audio:gunshot': { x: number; z: number; kind: string };
  'audio:explosion': { x: number; z: number };
  'audio:honk': { x: number; z: number };
  'audio:crash': { x: number; z: number; impact: number };
  'audio:siren': { x: number; z: number; active: boolean };

  'world:region': { name: string; style: string };
  'world:weather': { kind: string };
  'shop:open': { kind: string };
  'garage:open': Record<string, never>;
  'map:open': Record<string, never>;
  'waypoint:set': { x: number; z: number; name: string } | null;
};

type Listener<K extends keyof EventMap> = (payload: EventMap[K]) => void;

class EventBus {
  private listeners = new Map<string, Set<(payload: unknown) => void>>();

  on<K extends keyof EventMap>(event: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(event as string);
    if (!set) {
      set = new Set();
      this.listeners.set(event as string, set);
    }
    set.add(fn as (payload: unknown) => void);
    return () => this.off(event, fn);
  }

  off<K extends keyof EventMap>(event: K, fn: Listener<K>): void {
    this.listeners.get(event as string)?.delete(fn as (payload: unknown) => void);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = this.listeners.get(event as string);
    if (!set) return;
    for (const fn of set) {
      try {
        (fn as Listener<K>)(payload);
      } catch (err) {
        console.error(`[event:${String(event)}]`, err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const events = new EventBus();
