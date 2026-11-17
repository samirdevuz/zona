import { describe, expect, it } from 'vitest';
import { BTN, MOVEMENT, NET, decodeMap, encodeMap, generateMap } from '@zona/shared';
import { Match } from '../src/match';

const TICK_MS = 1000 / NET.SERVER_TICK_HZ;

/**
 * Lag compensation (GAME.md M6): a human's hitscan shot is tested against where the
 * targets were at the time the shooter was looking at (input `rt`), capped at LAG_COMP_MAX_MS.
 */
describe('lag compensation', () => {
  const setup = (ticks = 10) => {
    const map = decodeMap(JSON.parse(JSON.stringify(encodeMap(generateMap(5, 2, 0)))));
    const m = new Match(map, { teams: 2, neutrals: 0, autoNeutrals: false, seed: '5', scoreLimit: 0, timeLimitMin: 0, vehicles: false, bots: false, botFill: 0, botDifficulty: 'medium', theme: 'summer' });
    const a = m.addActor(1, 'shooter', 0, { spawnNow: true });
    const b = m.addActor(2, 'target', 1, { spawnNow: true });
    a.protectT = 0;
    b.protectT = 0;
    m.tick = 300; // 10 s into the match
    const y = m.world.terrain.heightAt(0, 0);
    a.st.x = 0;
    // 5 m away: hip-fire spread stays well inside the body, so hits and misses are deterministic.
    a.st.y = m.world.terrain.heightAt(0, 5);
    a.st.z = 5;
    // The target runs along +x at 6 m/s; remember the time when it was at x = 0.4.
    let seenAt = 0;
    for (let i = 0; i < ticks; i++) {
      b.st.x = i * 0.2;
      b.st.y = y;
      b.st.z = 0;
      m.step(1 / NET.SERVER_TICK_HZ, true);
      if (i === 2) seenAt = m.tick * TICK_MS;
    }
    return { m, a, b, y, seenAt };
  };
  const shootAt = (m: Match, a: { st: { x: number; y: number; z: number } }, x: number, y: number, z: number, rt: number): void => {
    const ex = a.st.x;
    const ey = a.st.y + MOVEMENT.eyeHeight;
    const ez = a.st.z;
    const dx = x - ex;
    const dz = z - ez;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(y - ey, Math.hypot(dx, dz));
    m.queueInput(1, 0, [BTN.FIRE, yaw, pitch, 0], rt);
    m.step(1 / NET.SERVER_TICK_HZ, true);
  };

  it('hits a target where the shooter saw it', () => {
    const { m, a, b, y, seenAt } = setup();
    expect(b.st.x).toBeCloseTo(1.8);
    shootAt(m, a, 0.4, y + 1.3, 0, seenAt);
    expect(b.hp).toBeLessThan(100);
  });

  it('without a view time (bots, old clients) the shot tests the current position', () => {
    const { m, a, b, y } = setup();
    shootAt(m, a, 0.4, y + 1.3, 0, 0);
    expect(b.hp).toBe(100);
  });

  it('does not rewind further than LAG_COMP_MAX_MS', () => {
    // 30 ticks at 6 m/s: x = 0 .. 5.8. A claim of "I saw it 2 s ago" is clamped to 300 ms.
    const back = NET.LAG_COMP_MAX_MS / TICK_MS; // 9 ticks
    {
      const { m, a, b, y } = setup(30);
      shootAt(m, a, 0.4, y + 1.3, 0, (m.tick + 1) * TICK_MS - 2000);
      expect(b.hp).toBe(100); // where it was long ago: no hit
    }
    {
      const { m, a, b, y } = setup(30);
      // The shot resolves 31 ticks after the start; 9 ticks earlier the target was at x = 21 * 0.2.
      const x300 = (31 - back - 1) * 0.2;
      shootAt(m, a, x300, y + 1.3, 0, (m.tick + 1) * TICK_MS - 2000);
      expect(b.hp).toBeLessThan(100); // where it was 300 ms ago: hit
    }
  });

  it('rewound() interpolates between recorded ticks', () => {
    const { m, b } = setup();
    const out = { x: 0, y: 0, z: 0, crouched: false };
    const t5 = (m.tick - 4) * TICK_MS; // the record where x = 1.0
    expect(m.rewound(b, t5, out).x).toBeCloseTo(1.0);
    expect(m.rewound(b, t5 + TICK_MS / 2, out).x).toBeCloseTo(1.1);
    expect(m.rewound(b, m.tick * TICK_MS + 1000, out).x).toBeCloseTo(b.st.x);
  });
});
