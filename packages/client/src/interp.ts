import { ACTOR_FIELDS, NET } from '@zona/shared';

const SLOTS = 40;
const MAX_ACTORS = 64;
const TICK_MS = 1000 / NET.SERVER_TICK_HZ;

/** Interpolated remote actor sample. */
export interface RemoteSample {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  speed: number;
}

/**
 * Buffered snapshots for remote entities (GAME.md 3.3): linear interpolation
 * INTERP_DELAY_MS in the past, slerp-style shortest-arc yaw, and short
 * extrapolation on starvation. Fixed-size ring buffer, no per-frame allocation.
 */
export class SnapshotBuffer {
  private readonly times = new Float64Array(SLOTS);
  private readonly data: Float64Array[] = [];
  private readonly counts = new Int32Array(SLOTS);
  private head = 0;
  private size = 0;
  /** Estimated (serverTimeMs - localTimeMs). */
  private offset = 0;
  private synced = false;

  constructor() {
    for (let i = 0; i < SLOTS; i++) this.data.push(new Float64Array(MAX_ACTORS * ACTOR_FIELDS));
  }

  clear(): void {
    this.size = 0;
    this.synced = false;
  }

  push(tick: number, actors: number[], nowMs: number): void {
    const t = tick * TICK_MS;
    // Clock offset: track the earliest-arriving packets (smoothed), reset on big jumps.
    const sample = t - nowMs;
    if (!this.synced || Math.abs(sample - this.offset) > 500) {
      this.offset = sample;
      this.synced = true;
    } else if (sample > this.offset) {
      this.offset += (sample - this.offset) * 0.2;
    } else {
      this.offset += (sample - this.offset) * 0.02;
    }
    const slot = (this.head + this.size) % SLOTS;
    if (this.size === SLOTS) this.head = (this.head + 1) % SLOTS;
    else this.size++;
    this.times[slot] = t;
    const n = Math.min(actors.length, MAX_ACTORS * ACTOR_FIELDS);
    const d = this.data[slot]!;
    for (let i = 0; i < n; i++) d[i] = actors[i]!;
    this.counts[slot] = n / ACTOR_FIELDS;
  }

  renderTime(nowMs: number): number {
    return nowMs + this.offset - NET.INTERP_DELAY_MS;
  }

  private find(slot: number, id: number): number {
    const d = this.data[slot]!;
    const n = this.counts[slot]!;
    for (let i = 0; i < n; i++) if (d[i * ACTOR_FIELDS] === id) return i * ACTOR_FIELDS;
    return -1;
  }

  /** Sample actor `id` at render time. Returns false if unknown. */
  sample(id: number, renderT: number, out: RemoteSample): boolean {
    if (this.size === 0) return false;
    // Find the newest snapshot with time <= renderT.
    let a = -1;
    for (let k = this.size - 1; k >= 0; k--) {
      const s = (this.head + k) % SLOTS;
      if (this.times[s]! <= renderT) {
        a = k;
        break;
      }
    }
    const last = (this.head + this.size - 1) % SLOTS;
    if (a < 0) {
      // Older than everything we have: use the oldest.
      const s = this.head;
      const i = this.find(s, id);
      if (i < 0) return false;
      this.write(this.data[s]!, i, out);
      return true;
    }
    const sa = (this.head + a) % SLOTS;
    const ia = this.find(sa, id);
    if (ia < 0) {
      const il = this.find(last, id);
      if (il < 0) return false;
      this.write(this.data[last]!, il, out);
      return true;
    }
    if (a < this.size - 1) {
      const sb = (this.head + a + 1) % SLOTS;
      const ib = this.find(sb, id);
      if (ib >= 0) {
        const t = (renderT - this.times[sa]!) / (this.times[sb]! - this.times[sa]!);
        this.lerp(this.data[sa]!, ia, this.data[sb]!, ib, t, out);
        return true;
      }
      this.write(this.data[sa]!, ia, out);
      return true;
    }
    // Starved: extrapolate from the previous snapshot, at most MAX_EXTRAPOLATION_MS.
    if (this.size >= 2) {
      const sp = (this.head + this.size - 2) % SLOTS;
      const ip = this.find(sp, id);
      if (ip >= 0) {
        const span = this.times[sa]! - this.times[sp]!;
        const ahead = Math.min(renderT - this.times[sa]!, NET.MAX_EXTRAPOLATION_MS);
        this.lerp(this.data[sp]!, ip, this.data[sa]!, ia, 1 + ahead / span, out);
        return true;
      }
    }
    this.write(this.data[sa]!, ia, out);
    return true;
  }

  private write(d: Float64Array, i: number, out: RemoteSample): void {
    out.x = d[i + 1]!;
    out.y = d[i + 2]!;
    out.z = d[i + 3]!;
    out.yaw = d[i + 4]!;
    out.pitch = d[i + 5]!;
    out.flags = d[i + 6]!;
    out.speed = d[i + 7]!;
  }

  private lerp(da: Float64Array, ia: number, db: Float64Array, ib: number, t: number, out: RemoteSample): void {
    out.x = da[ia + 1]! + (db[ib + 1]! - da[ia + 1]!) * t;
    out.y = da[ia + 2]! + (db[ib + 2]! - da[ia + 2]!) * t;
    out.z = da[ia + 3]! + (db[ib + 3]! - da[ia + 3]!) * t;
    let dyaw = db[ib + 4]! - da[ia + 4]!;
    dyaw -= Math.round(dyaw / (Math.PI * 2)) * Math.PI * 2;
    out.yaw = da[ia + 4]! + dyaw * t;
    out.pitch = da[ia + 5]! + (db[ib + 5]! - da[ia + 5]!) * t;
    // Discrete fields: take the later sample once halfway.
    out.flags = t < 0.5 ? da[ia + 6]! : db[ib + 6]!;
    out.speed = da[ia + 7]! + (db[ib + 7]! - da[ia + 7]!) * t;
  }
}

/**
 * Generic buffered interpolation for entities with a flat field layout
 * (field 0 = id). Fields listed in `angles` take the shortest arc; fields
 * listed in `discrete` switch at the midpoint. Used for vehicles.
 */
export class EntityBuffer {
  private readonly times = new Float64Array(SLOTS);
  private readonly data: Float64Array[] = [];
  private readonly counts = new Int32Array(SLOTS);
  private head = 0;
  private size = 0;

  constructor(
    private readonly stride: number,
    private readonly angles: readonly number[],
    private readonly discrete: readonly number[],
    maxEntities = 32,
  ) {
    for (let i = 0; i < SLOTS; i++) this.data.push(new Float64Array(maxEntities * stride));
  }

  clear(): void {
    this.size = 0;
  }

  push(tick: number, arr: number[]): void {
    const slot = (this.head + this.size) % SLOTS;
    if (this.size === SLOTS) this.head = (this.head + 1) % SLOTS;
    else this.size++;
    this.times[slot] = tick * TICK_MS;
    const d = this.data[slot]!;
    const n = Math.min(arr.length, d.length);
    for (let i = 0; i < n; i++) d[i] = arr[i]!;
    this.counts[slot] = Math.floor(n / this.stride);
  }

  private find(slot: number, id: number): number {
    const d = this.data[slot]!;
    const n = this.counts[slot]!;
    for (let i = 0; i < n; i++) if (d[i * this.stride] === id) return i * this.stride;
    return -1;
  }

  /** Ids present in the newest snapshot. */
  latestIds(out: number[]): number[] {
    out.length = 0;
    if (this.size === 0) return out;
    const s = (this.head + this.size - 1) % SLOTS;
    const d = this.data[s]!;
    for (let i = 0; i < this.counts[s]!; i++) out.push(d[i * this.stride]!);
    return out;
  }

  /** Sample entity `id` at render time into `out` (length >= stride). */
  sample(id: number, renderT: number, out: Float64Array): boolean {
    if (this.size === 0) return false;
    let a = -1;
    for (let k = this.size - 1; k >= 0; k--) {
      if (this.times[(this.head + k) % SLOTS]! <= renderT) {
        a = k;
        break;
      }
    }
    if (a < 0) a = 0;
    const sa = (this.head + a) % SLOTS;
    const ia = this.find(sa, id);
    if (ia < 0) {
      const last = (this.head + this.size - 1) % SLOTS;
      const il = this.find(last, id);
      if (il < 0) return false;
      for (let f = 0; f < this.stride; f++) out[f] = this.data[last]![il + f]!;
      return true;
    }
    const da = this.data[sa]!;
    if (a < this.size - 1) {
      const sb = (this.head + a + 1) % SLOTS;
      const ib = this.find(sb, id);
      if (ib >= 0) {
        const db = this.data[sb]!;
        const t = Math.max(0, Math.min(1, (renderT - this.times[sa]!) / (this.times[sb]! - this.times[sa]!)));
        for (let f = 0; f < this.stride; f++) {
          const va = da[ia + f]!;
          const vb = db[ib + f]!;
          if (this.discrete.includes(f)) out[f] = t < 0.5 ? va : vb;
          else if (this.angles.includes(f)) {
            let d = vb - va;
            d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
            out[f] = va + d * t;
          } else out[f] = va + (vb - va) * t;
        }
        return true;
      }
    }
    for (let f = 0; f < this.stride; f++) out[f] = da[ia + f]!;
    return true;
  }
}
