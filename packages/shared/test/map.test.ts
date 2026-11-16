import { describe, expect, it } from 'vitest';
import {
  ALLOWED_NEUTRALS,
  MOVEMENT,
  PROP_DEFS,
  World,
  ZONES,
  autoNeutrals,
  buildColliders,
  decodeMap,
  encodeMap,
  generateMap,
  generateMapUnvalidated,
  layoutZones,
  playableRadius,
  validateMap,
} from '../src';

describe('layoutZones', () => {
  it('produces T + N zones with homes first', () => {
    for (const [t, ns] of Object.entries(ALLOWED_NEUTRALS)) {
      const T = Number(t);
      for (const N of ns) {
        const slots = layoutZones(T, N);
        expect(slots.length).toBe(T + N);
        slots.slice(0, T).forEach((s, i) => expect(s.homeTeam).toBe(i));
        slots.slice(T).forEach((s) => expect(s.homeTeam).toBe(-1));
        expect(slots.length).toBeLessThanOrEqual(ZONES.maxZones);
      }
    }
  });
  it('places homes at 0.72 R on opposite sides for T=2', () => {
    const R = playableRadius(2);
    const [a, b] = layoutZones(2, 0);
    expect(R).toBe(190);
    expect(Math.hypot(a!.x, a!.z)).toBeCloseTo(0.72 * R, 6);
    expect(a!.x).toBeCloseTo(-b!.x, 6);
    expect(a!.z).toBeCloseTo(-b!.z, 6);
  });
  it('rejects disallowed combos', () => {
    expect(() => layoutZones(3, 2)).toThrow();
    expect(() => layoutZones(4, 3)).toThrow();
  });
  it('auto neutrals follow the participant table', () => {
    expect(autoNeutrals(2, 2)).toBe(0);
    expect(autoNeutrals(3, 2)).toBe(0);
    expect(autoNeutrals(4, 2)).toBe(1);
    expect(autoNeutrals(6, 2)).toBe(1);
    expect(autoNeutrals(7, 2)).toBe(2);
    expect(autoNeutrals(2, 3)).toBe(1);
  });
});

describe('map generator (T=2, N=0)', () => {
  it('passes the validator for 50 seeds', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const map = generateMapUnvalidated(seed * 7919, 2, 0);
      const res = validateMap(map);
      expect(res.errors, `seed ${seed * 7919}`).toEqual([]);
    }
  });
  it('is deterministic for the same seed', () => {
    const a = generateMap(12345, 2, 0);
    const b = generateMap(12345, 2, 0);
    expect(JSON.stringify(encodeMap(a))).toBe(JSON.stringify(encodeMap(b)));
    const c = generateMap(12346, 2, 0);
    expect(JSON.stringify(encodeMap(c))).not.toBe(JSON.stringify(encodeMap(a)));
  });
  it('is point-symmetric: terrain and props match under 180 degree rotation', () => {
    const map = generateMap(777, 2, 0);
    const { cols, heightsCm } = map.terrain;
    for (let i = 0; i < heightsCm.length; i += 37) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const j = (cols - 1 - row) * cols + (cols - 1 - col);
      expect(Math.abs(heightsCm[i]! - heightsCm[j]!)).toBeLessThanOrEqual(1);
    }
    const key = (x: number, z: number, type: string): string => `${type}:${Math.round(x * 10)}:${Math.round(z * 10)}`;
    const set = new Set(map.props.map((p) => key(p.x, p.z, p.type)));
    for (const p of map.props) expect(set.has(key(-p.x, -p.z, p.type))).toBe(true);
  });
  it('survives encode/decode unchanged', () => {
    const map = generateMap(99, 2, 0);
    const back = decodeMap(JSON.parse(JSON.stringify(encodeMap(map))));
    expect(Array.from(back.terrain.heightsCm)).toEqual(Array.from(map.terrain.heightsCm));
    expect(back.props).toEqual(map.props);
    expect(back.zones).toEqual(map.zones);
  });
  it('has zones with 8 spawn points within the spawn ring and flattened ground', () => {
    const map = generateMap(5, 2, 0);
    const world = new World(map);
    for (const z of map.zones) {
      expect(z.spawns.length).toBe(ZONES.spawnPointCount);
      for (const s of z.spawns) {
        const d = Math.hypot(s.x - z.x, s.z - z.z);
        expect(d).toBeGreaterThanOrEqual(ZONES.spawnRingMin - 1e-6);
        expect(d).toBeLessThanOrEqual(ZONES.spawnRingMax + 1e-6);
        expect(Math.abs(world.terrain.heightAt(s.x, s.z) - z.y)).toBeLessThan(0.05);
      }
    }
  });
});

describe('map generator (all allowed combos)', () => {
  it('passes the validator for 5 seeds each', () => {
    for (const [t, ns] of Object.entries(ALLOWED_NEUTRALS)) {
      for (const N of ns) {
        for (let seed = 1; seed <= 5; seed++) {
          const map = generateMapUnvalidated(seed, Number(t), N);
          expect(validateMap(map).errors, `T=${t} N=${N} seed=${seed}`).toEqual([]);
        }
      }
    }
  });
});

describe('props and colliders', () => {
  it('rotated box colliders swap extents and stay axis-aligned', () => {
    const base = { type: 'container' as const, x: 10, y: 0, z: 5, scale: 1, variant: 0 };
    const [c0] = buildColliders([{ ...base, rot: 0 }]);
    const [c1] = buildColliders([{ ...base, rot: 1 }]);
    expect(c0!.maxX - c0!.minX).toBeCloseTo(6.1, 6);
    expect(c1!.maxZ - c1!.minZ).toBeCloseTo(6.1, 6);
    expect(c1!.maxX - c1!.minX).toBeCloseTo(2.44, 6);
  });
  it('tower stairs never rise more than the step height', () => {
    const steps = PROP_DEFS.tower.parts.filter((p) => p.kind === 'box' && p.hx === 0.7);
    const tops = steps.map((s) => s.y1).sort((a, b) => a - b);
    let prev = 0;
    for (const t of tops) {
      expect(t - prev).toBeLessThanOrEqual(MOVEMENT.stepHeight);
      prev = t;
    }
  });
});
