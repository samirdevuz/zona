import { BTN, DEG2RAD } from '@zona/shared';

const KEY_BUTTONS: Record<string, number> = {
  KeyW: BTN.FORWARD,
  KeyS: BTN.BACK,
  KeyA: BTN.LEFT,
  KeyD: BTN.RIGHT,
  Space: BTN.JUMP,
  KeyC: BTN.CROUCH,
  ControlLeft: BTN.CROUCH,
  ShiftLeft: BTN.SPRINT,
  ShiftRight: BTN.SPRINT,
  KeyR: BTN.RELOAD,
  KeyE: BTN.USE,
  KeyQ: BTN.GADGET_A,
  KeyG: BTN.GRENADE,
};

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

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.testMode = new URLSearchParams(location.search).has('test');
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => {
      this.buttons = 0;
      this.latched = 0;
      this.tabHeld = false;
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
    if (down && !e.repeat) this.onKey(e.code);
    if (!this.active()) return;
    if (down && /^Digit[1-4]$/.test(e.code)) this.slotReq = Number(e.code.slice(5)) - 1;
    const b = KEY_BUTTONS[e.code];
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
