import { BTN, DEG2RAD } from '@zona/shared';

/** Rebindable actions and their default keys (GAME.md 8.1). */
export interface ActionDef {
  id: string;
  btn: number;
  keys: readonly string[];
}
export const ACTIONS: readonly ActionDef[] = [
  { id: 'forward', btn: BTN.FORWARD, keys: ['KeyW'] },
  { id: 'back', btn: BTN.BACK, keys: ['KeyS'] },
  { id: 'left', btn: BTN.LEFT, keys: ['KeyA'] },
  { id: 'right', btn: BTN.RIGHT, keys: ['KeyD'] },
  { id: 'jump', btn: BTN.JUMP, keys: ['Space'] },
  { id: 'crouch', btn: BTN.CROUCH, keys: ['KeyC', 'ControlLeft'] },
  { id: 'sprint', btn: BTN.SPRINT, keys: ['ShiftLeft', 'ShiftRight'] },
  { id: 'reload', btn: BTN.RELOAD, keys: ['KeyR'] },
  { id: 'use', btn: BTN.USE, keys: ['KeyE'] },
  { id: 'gadget', btn: BTN.GADGET_A, keys: ['KeyQ'] },
  { id: 'grenade', btn: BTN.GRENADE, keys: ['KeyG'] },
  { id: 'camera', btn: 0, keys: ['KeyV'] },
  { id: 'shoulder', btn: 0, keys: ['KeyZ'] },
  { id: 'map', btn: 0, keys: ['KeyM'] },
];

/** Keys that cannot be bound to an action (fixed: slots, scoreboard, stats, menu). */
export const FIXED_KEYS = /^(Escape|Tab|F3|Digit[1-4])$/;

/**
 * Bind `code` to `action`. An action that already used `code` takes over the
 * rebound action's previous primary key (a swap), so no key triggers two actions.
 */
export function rebind(
  actions: readonly { id: string; keys: readonly string[] }[],
  overrides: Record<string, string>,
  action: string,
  code: string,
): Record<string, string> {
  const keysOf = (id: string): readonly string[] => (overrides[id] ? [overrides[id]!] : (actions.find((a) => a.id === id)?.keys ?? []));
  const prev = keysOf(action)[0] ?? '';
  const out = { ...overrides, [action]: code };
  for (const a of actions) {
    if (a.id !== action && keysOf(a.id).includes(code)) out[a.id] = prev;
  }
  return out;
}

/** Human-readable key name for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code.replace('Left', ' L').replace('Right', ' R');
}

/** Keyboard + mouse state with pointer lock (GAME.md 8.1). */
export class Input {
  buttons = 0;
  /** Accumulated mouse movement in pixels since the last read. */
  dx = 0;
  dy = 0;
  locked = false;
  /** Test mode: accept input without pointer lock (headless E2E). */
  readonly testMode: boolean;
  onKey: (code: string) => void = () => {};
  onLockChange: (locked: boolean) => void = () => {};
  /** Set to false to ignore game input (menus open). */
  enabled = false;
  tabHeld = false;
  /** Big map key held (GAME.md 8.1 "Map: M"). */
  mapHeld = false;
  private keyButtons = new Map<string, number>();
  private actionKeys = new Map<string, string[]>();
  /** Requested slot (0..3) from number keys, or -1. Consumed by the game. */
  slotReq = -1;
  /** Mouse wheel steps since last read (+1 = next slot). */
  wheel = 0;
  /**
   * Buttons pressed since the last simulation step. A quick tap (down and up
   * between two frames at low FPS) must still reach the simulation once.
   */
  private latched = 0;

  /** Buttons for the next simulation step (current state plus latched taps). */
  takeButtons(): number {
    const b = this.buttons | this.latched;
    this.latched = 0;
    return b;
  }

  /** Apply key overrides (action -> code); other actions keep their defaults. */
  setBindings(overrides: Record<string, string>): void {
    this.keyButtons.clear();
    this.actionKeys.clear();
    for (const a of ACTIONS) {
      const keys = overrides[a.id] ? [overrides[a.id]!] : [...a.keys];
      this.actionKeys.set(a.id, keys);
      if (a.btn) for (const k of keys) this.keyButtons.set(k, (this.keyButtons.get(k) ?? 0) | a.btn);
    }
    this.buttons = 0;
  }

  /** Primary key for an action. */
  codeFor(action: string): string {
    return this.actionKeys.get(action)?.[0] ?? '';
  }

  keysFor(action: string): string[] {
    return this.actionKeys.get(action) ?? [];
  }

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.setBindings({});
    this.testMode = new URLSearchParams(location.search).has('test');
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => {
      this.buttons = 0;
      this.latched = 0;
      this.tabHeld = false;
      this.mapHeld = false;
    });
    canvas.addEventListener('mousedown', (e) => this.mouse(e, true));
    window.addEventListener('mouseup', (e) => this.mouse(e, false));
    window.addEventListener('mousemove', (e) => {
      if (!this.active()) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.active()) return;
        this.wheel += e.deltaY > 0 ? 1 : -1;
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.buttons = 0;
      this.onLockChange(this.locked);
    });
  }

  active(): boolean {
    return this.enabled && (this.locked || this.testMode);
  }

  requestLock(): void {
    if (this.testMode || this.locked) return;
    const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  private key(e: KeyboardEvent, down: boolean): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === 'Tab') {
      e.preventDefault();
      this.tabHeld = down;
      return;
    }
    if (e.code === this.codeFor('map')) this.mapHeld = down && this.enabled;
    if (down && !e.repeat) this.onKey(e.code);
    if (!this.active()) return;
    if (down && /^Digit[1-4]$/.test(e.code)) this.slotReq = Number(e.code.slice(5)) - 1;
    const b = this.keyButtons.get(e.code);
    if (b !== undefined) {
      e.preventDefault();
      if (down) {
        this.buttons |= b;
        this.latched |= b;
      } else this.buttons &= ~b;
    }
  }

  private mouse(e: MouseEvent, down: boolean): void {
    if (down && this.enabled && !this.locked && !this.testMode) {
      this.requestLock();
      return;
    }
    if (!this.active() && down) return;
    const b = e.button === 0 ? BTN.FIRE : e.button === 2 ? BTN.ADS : 0;
    if (down) {
      this.buttons |= b;
      this.latched |= b;
    } else this.buttons &= ~b;
  }

  private readonly look = { dx: 0, dy: 0 };

  /** Mouse delta since the last call (returns a reused object). */
  consumeLook(): { dx: number; dy: number } {
    this.look.dx = this.dx;
    this.look.dy = this.dy;
    this.dx = 0;
    this.dy = 0;
    return this.look;
  }

  /** Testing hook: press/release buttons programmatically. */
  setButtons(b: number): void {
    this.buttons = b;
    this.latched |= b;
  }
}

export const PITCH_LIMIT = 89 * DEG2RAD;
