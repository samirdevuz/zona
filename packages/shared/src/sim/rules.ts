import { MATCH } from '../config/match';

export type WinReason = 'score' | 'time' | 'totalControl' | 'elimination';

export interface MatchResult {
  /** Winning team, or -1 for a draw. */
  winner: number;
  reason: WinReason;
}

/** Per-team situation needed for elimination checks. */
export interface TeamStatus {
  ownedZones: number;
  /** Actors of this team that are currently alive. */
  alive: number;
  /** Already eliminated earlier in the match. */
  eliminated: boolean;
}

/** Add 0.5 points per second per owned zone (GAME.md 4.4). */
export function addZoneScore(scores: number[], owners: readonly number[], dt: number): void {
  for (const o of owners) if (o >= 0 && o < scores.length) scores[o]! += MATCH.scorePerZonePerS * dt;
}

/** Teams with no zones and nobody alive are eliminated (they can never respawn). */
export function updateEliminations(status: TeamStatus[]): void {
  for (const s of status) if (!s.eliminated && s.ownedZones === 0 && s.alive === 0) s.eliminated = true;
}

function bestByScoreThenZones(scores: readonly number[], owners: readonly number[], candidates: number[]): number {
  let best = -1;
  let tie = false;
  for (const t of candidates) {
    if (best < 0) {
      best = t;
      continue;
    }
    const ds = scores[t]! - scores[best]!;
    if (ds > 1e-9) {
      best = t;
      tie = false;
    } else if (Math.abs(ds) <= 1e-9) {
      const zt = owners.filter((o) => o === t).length;
      const zb = owners.filter((o) => o === best).length;
      if (zt > zb) {
        best = t;
        tie = false;
      } else if (zt === zb) tie = true;
    }
  }
  return tie ? -1 : best;
}

export interface WinCheckInput {
  scores: readonly number[];
  /** 0 = off. */
  scoreLimit: number;
  /** Seconds elapsed in LIVE and the limit in seconds (0 = off). */
  elapsedS: number;
  timeLimitS: number;
  owners: readonly number[];
  /** Seconds the current single owner of every zone has held them all. */
  totalControlS: number;
  status: readonly TeamStatus[];
}

/** First win condition that triggers (GAME.md 4.4), or null. */
export function checkWin(inp: WinCheckInput): MatchResult | null {
  const teams = inp.scores.length;
  const all = [...Array(teams).keys()];
  if (inp.scoreLimit > 0 && inp.scores.some((s) => s >= inp.scoreLimit)) {
    const crossed = all.filter((t) => inp.scores[t]! >= inp.scoreLimit);
    return { winner: bestByScoreThenZones(inp.scores, inp.owners, crossed), reason: 'score' };
  }
  if (inp.totalControlS >= MATCH.totalControlS && inp.owners.length > 0) {
    const o = inp.owners[0]!;
    if (o >= 0 && inp.owners.every((x) => x === o)) return { winner: o, reason: 'totalControl' };
  }
  const standing = all.filter((t) => !inp.status[t]!.eliminated);
  if (standing.length <= 1 && teams > 1) return { winner: standing.length === 1 ? standing[0]! : -1, reason: 'elimination' };
  if (inp.timeLimitS > 0 && inp.elapsedS >= inp.timeLimitS) {
    return { winner: bestByScoreThenZones(inp.scores, inp.owners, all), reason: 'time' };
  }
  return null;
}

/** Track how long one team has owned every zone. Returns the new duration. */
export function stepTotalControl(prevS: number, owners: readonly number[], dt: number): number {
  if (owners.length === 0) return 0;
  const o = owners[0]!;
  if (o < 0 || !owners.every((x) => x === o)) return 0;
  return prevS + dt;
}
