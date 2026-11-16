import type { ZoneDef } from '../map/types';
import type { ZoneState } from './capture';

/** A team may spawn at a zone it owns that is not contested (GAME.md 4.5). */
export function canSpawnAt(z: ZoneState, team: number): boolean {
  return z.owner === team && !z.contested;
}

export interface EnemyView {
  x: number;
  y: number;
  z: number;
}

/**
 * Choose a spawn point: the one farthest from enemies that no enemy can see;
 * if every point is seen (or there are no enemies), a random one.
 * `visible(enemy, point)` is a line-of-sight test supplied by the caller.
 */
export function pickSpawnPoint(
  zone: ZoneDef,
  enemies: readonly EnemyView[],
  visible: (e: EnemyView, p: { x: number; y: number; z: number }) => boolean,
  rand: () => number,
): number {
  const n = zone.spawns.length;
  if (enemies.length === 0) return Math.floor(rand() * n) % n;
  let best = -1;
  let bestD = -1;
  for (let i = 0; i < n; i++) {
    const p = zone.spawns[i]!;
    let minD = Infinity;
    let seen = false;
    for (const e of enemies) {
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < minD) minD = d;
      if (!seen && visible(e, p)) seen = true;
    }
    if (!seen && minD > bestD) {
      bestD = minD;
      best = i;
    }
  }
  return best >= 0 ? best : Math.floor(rand() * n) % n;
}
