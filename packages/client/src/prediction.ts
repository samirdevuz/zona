import {
  CLASSES,
  NET,
  copyPlayerState,
  createMoveScratch,
  createPlayerState,
  stepInventory,
  stepMovement,
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
  private readonly pendSlot = new Int8Array(MAX_PENDING);
  private head = 0;
  private count = 0;
  nextSeq = 0;
  /** Visual-only offset that hides small corrections; decays to zero. */
  readonly err = { x: 0, y: 0, z: 0 };
  lastCorrection = 0;
  private readonly result = { seq: 0, act: 0 };

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

  /** Apply one input step locally. Returns the sequence number and the ACT_* code (reused object). */
  step(buttons: number, yaw: number, pitch: number, slot: number): { seq: number; act: number } {
    const seq = this.nextSeq++;
    copyPlayerState(this.prev, this.state);
    const act = this.apply(this.state, buttons, yaw, pitch, slot);
    if (this.count === MAX_PENDING) {
      this.head = (this.head + 1) % MAX_PENDING;
      this.count--;
    }
    const i = (this.head + this.count) % MAX_PENDING;
    this.pendSeq[i] = seq;
    this.pendB[i] = buttons;
    this.pendYaw[i] = yaw;
    this.pendPitch[i] = pitch;
    this.pendSlot[i] = slot;
    this.count++;
    this.result.seq = seq;
    this.result.act = act;
    return this.result;
  }

  private apply(s: PlayerState, buttons: number, yaw: number, pitch: number, slot: number): number {
    stepMovement(this.world, s, buttons, yaw, pitch, CLASSES[s.classId].speedMult, NET.MOVE_DT, this.scratch);
    return stepInventory(s, buttons, slot, NET.MOVE_DT);
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
      this.apply(r, this.pendB[i]!, this.pendYaw[i]!, this.pendPitch[i]!, this.pendSlot[i]!);
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
      this.prev.x -= dx;
      this.prev.y -= dy;
      this.prev.z -= dz;
    }
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
