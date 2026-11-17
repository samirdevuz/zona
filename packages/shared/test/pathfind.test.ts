import { describe, expect, it } from 'vitest';
import { BOTS, BOT_DIFFICULTY, PathFinder, World, buildNavGrid, generateMap } from '../src';

describe('pathfinding', () => {
  const map = generateMap(2024, 2, 1);
  const world = new World(map);
  const nav = buildNavGrid(world);
  const pf = new PathFinder(nav);
  it('finds walkable paths between every pair of zones', () => {
    const out: number[] = [];
    for (const a of map.zones) {
      for (const b of map.zones) {
        if (a === b) continue;
        expect(pf.find(a.x + 3, a.z + 3, b.x - 3, b.z - 3, BOTS.maxPathNodes, out)).toBe(true);
        expect(out.length).toBeGreaterThanOrEqual(2);
        // Ends at the target; every leg stays on walkable cells.
        expect(out[out.length - 2]).toBeCloseTo(b.x - 3, 6);
        let px = a.x + 3;
        let pz = a.z + 3;
        for (let i = 0; i < out.length; i += 2) {
          const ca = pf.nearestWalkable(px, pz, 1);
          const cb = pf.nearestWalkable(out[i]!, out[i + 1]!, 1);
          expect(ca).toBeGreaterThanOrEqual(0);
          expect(cb).toBeGreaterThanOrEqual(0);
          px = out[i]!;
          pz = out[i + 1]!;
        }
      }
    }
  });
  it('smoothing removes most grid waypoints on open ground', () => {
    const out: number[] = [];
    const a = map.zones[0]!;
    const b = map.zones[2]!; // centre
    pf.find(a.x, a.z, b.x, b.z, BOTS.maxPathNodes, out);
    const straight = Math.hypot(a.x - b.x, a.z - b.z) / nav.cell;
    expect(out.length / 2).toBeLessThan(straight / 4);
  });
  it('respects the node budget', () => {
    const out: number[] = [];
    const a = map.zones[0]!;
    const b = map.zones[1]!;
    expect(pf.find(a.x, a.z, b.x, b.z, 50, out)).toBe(false);
    expect(pf.expanded).toBeLessThanOrEqual(51);
  });
  it('difficulty table matches the spec', () => {
    expect(BOT_DIFFICULTY.easy).toMatchObject({ reactionS: 0.8, aimErrDeg: 6, accuracy: 0.6 });
    expect(BOT_DIFFICULTY.medium).toMatchObject({ reactionS: 0.5, aimErrDeg: 3.5, accuracy: 0.8 });
    expect(BOT_DIFFICULTY.hard).toMatchObject({ reactionS: 0.3, aimErrDeg: 2, accuracy: 1.0 });
    const w = BOTS.classWeights;
    expect(w.assault + w.engineer + w.gunner + w.sniper).toBeCloseTo(1, 9);
    expect(new Set(BOTS.names).size).toBe(BOTS.names.length);
  });
});
