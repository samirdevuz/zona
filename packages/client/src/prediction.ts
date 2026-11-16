import {
  CLASSES,
  NET,
  copyPlayerState,
  createMoveScratch,
  createPlayerState,
  stepMovement,
  stepWeapon,
  type ClassId,
  type PlayerState,
  type World,
} from '@zona/shared';

const MAX_PENDING = 256;

/**
 * Client-side prediction and reconciliation for the local player (GAME.md 3.3).
 * Inputs are applied immediately with the shared step; on every snapshot the
 * state is reset to the server's and unacknowledged inputs are replayed.
 */
export class LocalPredictor {
  readonly state: PlayerState = createPlayerState();
  /** State before the latest step (for render interpolation between steps). */
  readonly prev: PlayerState = createPlayerState();
  private readonly scratch = createMoveScratch();
  private readonly replay: PlayerState = createPlayerState();
  private readonly pendSeq = new Int32Array(MAX_PENDING);
  private readonly pendB = new Int32Array(MAX_PENDING);
  private readonly pendYaw = new Float64Array(MAX_PENDING);
  private readonly pendPitch = new Float64Array(MAX_PENDING);
  private head = 0;
  private count = 0;
  nextSeq = 0;
  classId: ClassId = 'assault';
  /** Visual-only offset that hides small corrections; decays to zero. */
  readonly err = { x: 0, y: 0, z: 0 };
  lastCorrection = 0;

  constructor(private world: World) {}

  setWorld(w: World): void {
    this.world = w;
  }

  /** Reset to an authoritative state (spawn, match start). */
  reset(s: PlayerState): void {
    copyPlayerState(this.state, s);
    copyPlayerState(this.prev, s);
    this.count = 0;
    this.err.x = this.err.y = this.err.z = 0;
  }

  private readonly result = { seq: 0, fired: false };

  /** Apply one input step locally. Returns the sequence number and whether a shot fired (reused object). */
  step(buttons: number, yaw: number, pitch: number): { seq: number; fired: boolean } {
    const seq = this.nextSeq++;
    copyPlayerState(this.prev, this.state);
    const fired = this.apply(this.state, buttons, yaw, pitch);
    if (this.count === MAX_PENDING) {
      this.head = (this.head + 1) % MAX_PENDING;
      this.count--;
    }
    const i = (this.head + this.count) % MAX_PENDING;
    this.pendSeq[i] = seq;
    this.pendB[i] = buttons;
    this.pendYaw[i] = yaw;
    this.pendPitch[i] = pitch;
    this.count++;
    this.result.seq = seq;
    this.result.fired = fired;
    return this.result;
  }

  private apply(s: PlayerState, buttons: number, yaw: number, pitch: number): boolean {
    stepMovement(this.world, s, buttons, yaw, pitch, CLASSES[this.classId].speedMult, NET.MOVE_DT, this.scratch);
    return stepWeapon(s, buttons, NET.MOVE_DT);
  }

  /** Server state after processing input `ack`: rewind and replay the rest. */
  reconcile(ack: number, server: PlayerState): void {
    while (this.count > 0 && this.pendSeq[this.head]! <= ack) {
      this.head = (this.head + 1) % MAX_PENDING;
      this.count--;
    }
    const r = copyPlayerState(this.replay, server);
    for (let k = 0; k < this.count; k++) {
      const i = (this.head + k) % MAX_PENDING;
      this.apply(r, this.pendB[i]!, this.pendYaw[i]!, this.pendPitch[i]!);
    }
    const dx = this.state.x - r.x;
    const dy = this.state.y - r.y;
    const dz = this.state.z - r.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    this.lastCorrection = Math.sqrt(d2);
    if (d2 > 1e-10) {
      if (d2 < NET.RECONCILE_SNAP_DISTANCE * NET.RECONCILE_SNAP_DISTANCE) {
        this.err.x += dx;
        this.err.y += dy;
        this.err.z += dz;
      } else {
        this.err.x = this.err.y = this.err.z = 0;
      }
      // Shift the interpolation base too so render interpolation stays continuous.
      this.prev.x -= dx;
      this.prev.y -= dy;
      this.prev.z -= dz;
    }
    // Keep view angles client-owned; everything else follows the server.
    const yaw = this.state.yaw;
    const pitch = this.state.pitch;
    copyPlayerState(this.state, r);
    this.state.yaw = yaw;
    this.state.pitch = pitch;
  }

  decayError(dt: number): void {
    const k = Math.exp(-dt / (NET.RECONCILE_SMOOTH_MS / 1000));
    this.err.x *= k;
    this.err.y *= k;
    this.err.z *= k;
  }

  get pendingCount(): number {
    return this.count;
  }
}
