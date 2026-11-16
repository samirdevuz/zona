import { describe, expect, it } from 'vitest';
import { Rng, base64ToInt16, datan2, dcos, dsin, fbm2, int16ToBase64, seedFromString, valueNoise2 } from '../src';

describe('deterministic trig', () => {
  it('matches Math within 1e-9', () => {
    for (let a = -20; a <= 20; a += 0.0137) {
      expect(Math.abs(dsin(a) - Math.sin(a))).toBeLessThan(1e-9);
      expect(Math.abs(dcos(a) - Math.cos(a))).toBeLessThan(1e-9);
    }
  });
  it('atan2 matches Math within 1e-9 in all quadrants', () => {
    for (let y = -3; y <= 3; y += 0.173) {
      for (let x = -3; x <= 3; x += 0.191) {
        expect(Math.abs(datan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-9);
      }
    }
    expect(datan2(1, 0)).toBeCloseTo(Math.PI / 2, 12);
    expect(datan2(0, -1)).toBeCloseTo(Math.PI, 12);
  });
});

describe('rng and noise', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('noise is deterministic and bounded', () => {
    for (let i = 0; i < 500; i++) {
      const x = i * 0.37 - 50;
      const y = i * 0.11 + 3;
      const v = valueNoise2(x, y, 7);
      expect(v).toBe(valueNoise2(x, y, 7));
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(fbm2(x, y, 9, 4))).toBeLessThanOrEqual(1);
    }
  });
  it('seedFromString keeps numbers and hashes text', () => {
    expect(seedFromString('1234')).toBe(1234);
    expect(seedFromString('zona')).toBe(seedFromString('zona'));
    expect(seedFromString('zona')).not.toBe(seedFromString('anoz'));
  });
});

describe('base64', () => {
  it('round-trips Int16 arrays', () => {
    for (const n of [0, 1, 2, 3, 100, 1001]) {
      const a = new Int16Array(n);
      for (let i = 0; i < n; i++) a[i] = ((i * 7919) % 65536) - 32768;
      expect(Array.from(base64ToInt16(int16ToBase64(a)))).toEqual(Array.from(a));
    }
  });
});
