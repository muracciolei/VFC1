/**
 * Unified input: keyboard + mouse, touch joystick/buttons, and gamepad.
 * Gameplay code only ever talks to this facade.
 */

import { clamp, clamp01, TAU } from './math';

export type ActionName =
  | 'jump'
  | 'sprint'
  | 'interact'
  | 'attack'
  | 'aim'
  | 'reload'
  | 'handbrake'
  | 'gas'
  | 'brake'
  | 'horn'
  | 'pause'
  | 'camera'
  | 'map'
  | 'weapon'
  | 'enter'
  | 'phone'
  | 'reset';

const KEY_TO_ACTION: Record<string, ActionName> = {
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyE: 'interact',
  KeyF: 'enter',
  KeyR: 'reload',
  KeyC: 'camera',
  KeyM: 'map',
  KeyQ: 'weapon',
  KeyH: 'horn',
  Tab: 'map',
  Escape: 'pause',
  KeyP: 'pause',
  KeyG: 'phone',
  KeyX: 'reset',
};

export class InputSystem {
  readonly isTouch: boolean;

  /** On-foot / generic movement, analog in [-1,1]. x = right, y = forward. */
  moveX = 0;
  moveY = 0;

  /** Look delta accumulated since last consume (radians-ish). */
  lookX = 0;
  lookY = 0;
  zoomDelta = 0;

  private physicalHeld = new Set<ActionName>();
  private pressed = new Set<ActionName>();
  private released = new Set<ActionName>();

  private keys = new Set<string>();
  private mouseButtons = new Set<number>();
  private pointerLocked = false;
  private suppressClickUntil = 0;

  private joyX = 0;
  private joyY = 0;
  private joyActive = false;
  private virtualHeld = new Set<ActionName>();

  private touchLookPointer = -1;
  private touchLookLastX = 0;
  private touchLookLastY = 0;

  private gamepadIndex = -1;
  private gamepadLookX = 0;
  private gamepadLookY = 0;
  private gamepadButtonsPrev: boolean[] = [];

  private canvas: HTMLCanvasElement;
  private listeners: Array<() => void> = [];
  private enabled = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
    this.isTouch = coarse || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);

    this.bindKeyboard();
    this.bindMouse();
    this.bindTouchLook();
    this.bindGamepad();
  }

  private on<K extends keyof WindowEventMap>(
    target: Window | Document | HTMLElement,
    type: K | string,
    fn: EventListener,
    opts?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type as string, fn, opts);
    this.listeners.push(() => target.removeEventListener(type as string, fn, opts));
  }

  private bindKeyboard(): void {
    this.on(window, 'keydown', (ev) => {
      const e = ev as KeyboardEvent;
      if (e.repeat) return;
      this.keys.add(e.code);
      const action = KEY_TO_ACTION[e.code];
      if (action) {
        if (action === 'pause' || action === 'map') e.preventDefault();
        if (action === 'jump' && this.pointerLocked) e.preventDefault();
        this.pressAction(action);
      }
      if (e.code === 'KeyW' || e.code === 'ArrowUp' || e.code === 'Space') {
        if (this.pointerLocked) e.preventDefault();
      }
    });

    this.on(window, 'keyup', (ev) => {
      const e = ev as KeyboardEvent;
      this.keys.delete(e.code);
      const action = KEY_TO_ACTION[e.code];
      if (action) this.releaseAction(action);
    });

    this.on(window, 'blur', () => {
      this.keys.clear();
      this.mouseButtons.clear();
      this.physicalHeld.clear();
      this.virtualHeld.clear();
    });
  }

  private bindMouse(): void {
    this.on(this.canvas, 'mousedown', (ev) => {
      const e = ev as MouseEvent;
      if (this.isTouch) return;
      if (e.button === 0 && performance.now() > this.suppressClickUntil) {
        if (!this.pointerLocked) {
          this.requestPointerLock();
          this.suppressClickUntil = performance.now() + 250;
          return;
        }
        this.mouseButtons.add(0);
        this.pressAction('attack');
      }
      if (e.button === 2) {
        this.mouseButtons.add(2);
        this.pressAction('aim');
      }
    });

    this.on(window, 'mouseup', (ev) => {
      const e = ev as MouseEvent;
      this.mouseButtons.delete(e.button);
      if (e.button === 0) this.releaseAction('attack');
      if (e.button === 2) this.releaseAction('aim');
    });

    this.on(this.canvas, 'contextmenu', (ev) => ev.preventDefault());

    this.on(document, 'mousemove', (ev) => {
      const e = ev as MouseEvent;
      if (this.isTouch) return;
      if (this.pointerLocked) {
        this.lookX += e.movementX * 0.0026;
        this.lookY += e.movementY * 0.0026;
      }
    });

    this.on(this.canvas, 'wheel', (ev) => {
      const e = ev as WheelEvent;
      e.preventDefault();
      this.zoomDelta += Math.sign(e.deltaY);
    }, { passive: false });

    this.on(document, 'pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) {
        this.mouseButtons.clear();
        this.releaseAction('attack');
        this.releaseAction('aim');
      }
    });
  }

  private bindTouchLook(): void {
    this.on(this.canvas, 'pointerdown', (ev) => {
      const e = ev as PointerEvent;
      if (e.pointerType !== 'touch') return;
      if (this.touchLookPointer !== -1) return;
      this.touchLookPointer = e.pointerId;
      this.touchLookLastX = e.clientX;
      this.touchLookLastY = e.clientY;
      this.canvas.setPointerCapture?.(e.pointerId);
    });

    this.on(this.canvas, 'pointermove', (ev) => {
      const e = ev as PointerEvent;
      if (e.pointerId !== this.touchLookPointer) return;
      const dx = e.clientX - this.touchLookLastX;
      const dy = e.clientY - this.touchLookLastY;
      this.touchLookLastX = e.clientX;
      this.touchLookLastY = e.clientY;
      this.lookX += dx * 0.006;
      this.lookY += dy * 0.006;
    });

    const end = (ev: PointerEvent): void => {
      if (ev.pointerId === this.touchLookPointer) this.touchLookPointer = -1;
    };
    this.on(this.canvas, 'pointerup', end as EventListener);
    this.on(this.canvas, 'pointercancel', end as EventListener);
  }

  private bindGamepad(): void {
    this.on(window, 'gamepadconnected', (ev) => {
      const e = ev as GamepadEvent;
      this.gamepadIndex = e.gamepad.index;
    });
    this.on(window, 'gamepaddisconnected', (ev) => {
      const e = ev as GamepadEvent;
      if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = -1;
    });
  }

  requestPointerLock(): void {
    if (this.isTouch) return;
    if (document.pointerLockElement !== this.canvas) {
      this.canvas.requestPointerLock?.();
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  get isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  /** Called by touch UI. */
  setJoystick(x: number, y: number, active: boolean): void {
    this.joyX = x;
    this.joyY = y;
    this.joyActive = active;
  }

  /** Called by touch UI buttons. */
  virtualPress(action: ActionName): void {
    if (!this.virtualHeld.has(action)) this.pressed.add(action);
    this.virtualHeld.add(action);
  }

  virtualRelease(action: ActionName): void {
    if (this.virtualHeld.has(action)) this.released.add(action);
    this.virtualHeld.delete(action);
  }

  private pressAction(action: ActionName): void {
    if (!this.physicalHeld.has(action)) this.pressed.add(action);
    this.physicalHeld.add(action);
  }

  private releaseAction(action: ActionName): void {
    if (this.physicalHeld.has(action)) this.released.add(action);
    this.physicalHeld.delete(action);
  }

  /** Poll gamepad and compute final movement values. Call once per frame before gameplay. */
  update(dt: number): void {
    if (!this.enabled) {
      this.moveX = 0;
      this.moveY = 0;
      return;
    }

    // virtual edge events are recorded directly in pressed/released

    let kx = 0;
    let ky = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ky += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ky -= 1;

    let gx = 0;
    let gy = 0;
    this.pollGamepad(dt);
    const pad = this.gamepadIndex >= 0 ? navigator.getGamepads()[this.gamepadIndex] : null;
    if (pad) {
      const dz = (v: number): number => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
      gx = dz(pad.axes[0] ?? 0);
      gy = -dz(pad.axes[1] ?? 0);
    }

    if (this.joyActive) {
      // Radial dead zone: thumbs never rest exactly on center, and drift would
      // make the player creep forward on a phone.
      const raw = Math.hypot(this.joyX, this.joyY);
      const dead = 0.14;
      if (raw <= dead) {
        this.moveX = 0;
        this.moveY = 0;
      } else {
        const magnitude = Math.min(1, (raw - dead) / (1 - dead));
        this.moveX = (this.joyX / raw) * magnitude;
        this.moveY = (this.joyY / raw) * magnitude;
      }
    } else if (Math.abs(gx) + Math.abs(gy) > 0.02) {
      this.moveX = clamp(gx, -1, 1);
      this.moveY = clamp(gy, -1, 1);
    } else {
      this.moveX = kx;
      this.moveY = ky;
    }

    const len = Math.hypot(this.moveX, this.moveY);
    if (len > 1) {
      this.moveX /= len;
      this.moveY /= len;
    }
  }

  private pollGamepad(dt: number): void {
    if (this.gamepadIndex < 0) return;
    const pads = navigator.getGamepads();
    const pad = pads[this.gamepadIndex];
    if (!pad) return;

    const dz = (v: number): number => (Math.abs(v) < 0.2 ? 0 : (v - Math.sign(v) * 0.2) / 0.8);
    this.gamepadLookX = dz(pad.axes[2] ?? 0);
    this.gamepadLookY = dz(pad.axes[3] ?? 0);
    this.lookX += this.gamepadLookX * 2.6 * dt;
    this.lookY += this.gamepadLookY * 2.0 * dt;

    const map: Array<[number, ActionName]> = [
      [0, 'jump'],
      [1, 'interact'],
      [2, 'attack'],
      [3, 'reload'],
      [4, 'aim'],
      [5, 'handbrake'],
      [7, 'gas'],
      [6, 'brake'],
      [9, 'pause'],
      [10, 'camera'],
      [8, 'map'],
      [12, 'phone'],
      [13, 'weapon'],
    ];

    for (const [index, action] of map) {
      const down = !!pad.buttons[index]?.pressed;
      const prev = this.gamepadButtonsPrev[index] ?? false;
      if (down && !prev) this.pressAction(action);
      if (!down && prev) this.releaseAction(action);
      this.gamepadButtonsPrev[index] = down;
    }
  }

  isDown(action: ActionName): boolean {
    return this.physicalHeld.has(action) || this.virtualHeld.has(action);
  }

  wasPressed(action: ActionName): boolean {
    return this.pressed.has(action);
  }

  wasReleased(action: ActionName): boolean {
    return this.released.has(action);
  }

  /** Consume accumulated look rotation. */
  consumeLook(): { x: number; y: number } {
    const x = this.lookX;
    const y = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    return { x, y };
  }

  consumeZoom(): number {
    const z = this.zoomDelta;
    this.zoomDelta = 0;
    return z;
  }

  /** Clear per-frame edge state. Call at the very end of the frame. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
  }

  get throttle(): number {
    if (this.isDown('gas')) return 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) return 1;
    return 0;
  }

  get brake(): number {
    if (this.isDown('brake')) return 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) return 1;
    return 0;
  }

  get steer(): number {
    return clamp(this.moveX, -1, 1);
  }

  get handbrake(): boolean {
    return this.isDown('handbrake') || this.keys.has('Space');
  }

  rumble(durationMs: number, strong = 0.6): void {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(Math.min(80, durationMs));
      } catch {
        /* ignore */
      }
    }
    const pads = navigator.getGamepads?.();
    if (pads && this.gamepadIndex >= 0) {
      const pad = pads[this.gamepadIndex];
      const actuator = (pad as unknown as { vibrationActuator?: { playEffect: (t: string, p: { duration: number; strongMagnitude: number; weakMagnitude: number }) => void } })?.vibrationActuator;
      actuator?.playEffect('dual-rumble', {
        duration: durationMs,
        strongMagnitude: strong,
        weakMagnitude: strong * 0.6,
      });
    }
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) {
      this.physicalHeld.clear();
      this.virtualHeld.clear();
      this.mouseButtons.clear();
      this.moveX = 0;
      this.moveY = 0;
    }
  }

  dispose(): void {
    for (const off of this.listeners) off();
    this.listeners = [];
  }
}

/** Converts a direction vector to a compass bearing (radians). */
export function bearing(x: number, z: number): number {
  return Math.atan2(x, -z);
}

/** Signed shortest rotation between two bearings. */
export function bearingDelta(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
