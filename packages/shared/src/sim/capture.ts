import { ZONES } from '../config/zones';

/** Runtime state of one zone (GAME.md 4.3). */
export interface ZoneState {
  /** control[team] in [0, 100]. */
  control: number[];
  /** Owning team or -1. Gained at 100 control, lost when the owner's control drains to 0. */
  owner: number;
  contested: boolean;
}

export interface CaptureEvents {
  /** Team that gained ownership this step, or -1. */
  captured: number;
  /** Team that lost ownership this step, or -1. */
  lost: number;
}

export function createZoneState(teams: number, owner: number): ZoneState {
  const control = new Array<number>(teams).fill(0);
  if (owner >= 0) control[owner] = 100;
  return { control, owner, contested: false };
}

/** Capture speed in percent per second for n actors of one team present. */
export function captureRate(n: number): number {
  return n <= 0 ? 0 : ZONES.baseRatePctPerS * Math.pow(n, ZONES.presenceExponent);
}

/**
 * Advance one zone by dt seconds given the number of alive actors per team
 * inside the capture cylinder. Writes ownership changes into `ev`.
 */
export function stepZone(z: ZoneState, present: readonly number[], dt: number, ev: CaptureEvents): void {
  ev.captured = -1;
  ev.lost = -1;
  let presentTeam = -1;
  let presentCount = 0;
  for (let t = 0; t < present.length; t++) {
    if (present[t]! > 0) {
      presentCount++;
      presentTeam = t;
    }
  }
  if (presentCount >= 2) {
    z.contested = true;
    return;
  }
  z.contested = false;
  if (presentCount === 0) {
    const decay = ZONES.decayPctPerS * dt;
    for (let t = 0; t < z.control.length; t++) {
      if (t === z.owner) continue;
      const c = z.control[t]!;
      if (c > 0) z.control[t] = c > decay ? c - decay : 0;
    }
    return;
  }
  let amount = captureRate(present[presentTeam]!) * dt;
  // Drain other teams, largest first.
  while (amount > 0) {
    let other = -1;
    let otherC = 0;
    for (let t = 0; t < z.control.length; t++) {
      if (t !== presentTeam && z.control[t]! > otherC) {
        otherC = z.control[t]!;
        other = t;
      }
    }
    if (other < 0) break;
    const d = amount < otherC ? amount : otherC;
    z.control[other] = otherC - d;
    amount -= d;
    if (z.control[other]! <= 0) {
      z.control[other] = 0;
      if (z.owner === other) {
        z.owner = -1;
        ev.lost = other;
      }
    }
  }
  if (amount > 0) {
    const c = z.control[presentTeam]! + amount;
    z.control[presentTeam] = c >= 100 ? 100 : c;
    if (z.control[presentTeam] === 100 && z.owner !== presentTeam) {
      z.owner = presentTeam;
      ev.captured = presentTeam;
    }
  }
}
