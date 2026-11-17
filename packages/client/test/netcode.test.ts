import { describe, expect, it } from 'vitest';
import { ACTOR_FIELDS, BTN, NET, World, copyPlayerState, createMoveScratch, createPlayerState, generateMap, stepMovement, stepWeapon } from '@zona/shared';
import { allKeys } from '../src/i18n';
import { SnapshotBuffer } from '../src/interp';
import { LocalPredictor } from '../src/prediction';

const map = generateMap(2024, 2, 0);
const world = new World(map);
const spawn = map.zones[0]!.spawns[0]!;

describe('client prediction + reconciliation', () => {
  it('replaying unacknowledged inputs reproduces the prediction exactly', () => {
    const p = new LocalPredictor(world);
    const start = createPlayerState();
    start.x = spawn.x;
    start.y = spawn.y;
    start.z = spawn.z;
    p.reset(start);
    // A "server" simulates the same inputs but acknowledges them 6 steps late.
    const server = copyPlayerState(createPlayerState(), start);
    const sc = createMoveScratch();
    const inputs: [number, number, number][] = [];
    let serverDone = -1;
    for (let i = 0; i < 300; i++) {
      const b = i % 50 < 30 ? BTN.FORWARD | BTN.SPRINT : BTN.LEFT | BTN.FIRE;
      const yaw = 0.3 + Math.sin(i / 40);
      inputs.push([b, yaw, 0.05]);
      p.step(b, yaw, 0.05, -1);
      if (i >= 6 && i % 4 === 0) {
        const ack = i - 6;
        for (let k = serverDone + 1; k <= ack; k++) {
          const [bb, yy, pp] = inputs[k]!;
          stepMovement(world, server, bb, yy, pp, 1, NET.MOVE_DT, sc);
          stepWeapon(server, bb, NET.MOVE_DT);
        }
        serverDone = ack;
        p.reconcile(ack, copyPlayerState(createPlayerState(), server));
        expect(p.lastCorrection).toBeLessThan(1e-9);
      }
    }
    expect(p.pendingCount).toBeLessThanOrEqual(10);
  });

  it('a server-side correction moves the state and is visually smoothed', () => {
    const p = new LocalPredictor(world);
    const start = createPlayerState();
    start.x = spawn.x;
    start.y = spawn.y;
    start.z = spawn.z;
    p.reset(start);
    p.step(BTN.FORWARD, 0, 0, -1);
    const server = copyPlayerState(createPlayerState(), p.state);
    server.x += 0.5; // server disagrees by 0.5 m
    p.reconcile(0, server);
    expect(p.state.x).toBeCloseTo(server.x, 9);
    expect(p.err.x).toBeCloseTo(-0.5, 9);
    for (let i = 0; i < 60; i++) p.decayError(1 / 60);
    expect(Math.abs(p.err.x)).toBeLessThan(0.01);
  });
});

describe('snapshot interpolation', () => {
  const TICK_MS = 1000 / NET.SERVER_TICK_HZ;
  const snap = (id: number, x: number, yaw: number): number[] => {
    const a = new Array<number>(ACTOR_FIELDS).fill(0);
    a[0] = id;
    a[1] = x;
    a[4] = yaw;
    return a;
  };
  it('interpolates between snapshots INTERP_DELAY_MS in the past', () => {
    const b = new SnapshotBuffer();
    for (let tick = 0; tick < 10; tick++) b.push(tick, snap(7, tick, 0), tick * TICK_MS);
    const now = 9 * TICK_MS;
    const out = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0, speed: 0 };
    expect(b.sample(7, b.renderTime(now), out)).toBe(true);
    expect(out.x).toBeCloseTo(9 - NET.INTERP_DELAY_MS / TICK_MS, 6);
    expect(b.sample(8, b.renderTime(now), out)).toBe(false);
  });
  it('takes the short way around for yaw and caps extrapolation', () => {
    const b = new SnapshotBuffer();
    b.push(0, snap(1, 0, 3.1), 0);
    b.push(1, snap(1, 1, -3.1), TICK_MS);
    const out = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0, speed: 0 };
    b.sample(1, TICK_MS / 2, out);
    expect(Math.abs(Math.abs(out.yaw) - Math.PI)).toBeLessThan(0.05);
    b.sample(1, TICK_MS + 1000, out);
    expect(out.x).toBeLessThanOrEqual(1 + NET.MAX_EXTRAPOLATION_MS / TICK_MS + 1e-9);
  });
});

describe('i18n', () => {
  it('uz and en dictionaries have the same keys', () => {
    const k = allKeys();
    expect([...k.uz].sort()).toEqual([...k.en].sort());
  });
});
