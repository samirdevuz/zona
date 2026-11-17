import { describe, expect, it } from 'vitest';
import {
  BTN,
  CLASSES,
  MATCH,
  MOVEMENT,
  NET,
  WEAPONS,
  World,
  ZONES,
  addZoneScore,
  aimDir,
  canSpawnAt,
  captureRate,
  checkWin,
  createMoveScratch,
  createPlayerState,
  createZoneState,
  falloffMult,
  generateMap,
  pickSpawnPoint,
  rayActor,
  rayCollider,
  stepMovement,
  stepTotalControl,
  stepWeapon,
  stepZone,
  updateEliminations,
  type CaptureEvents,
  type MapData,
  type PlayerState,
  type TeamStatus,
} from '../src';

const DT = NET.MOVE_DT;

/** Flat test world: generated heightfield flattened to 0 with chosen props. */
function flatWorld(props: MapData['props'] = []): World {
  const base = generateMap(1, 2, 0);
  const heightsCm = new Int16Array(base.terrain.heightsCm.length);
  return new World({ ...base, terrain: { ...base.terrain, heightsCm }, props, zones: [] });
}

function run(world: World, s: PlayerState, buttons: number, steps: number, yaw = 0): void {
  const sc = createMoveScratch();
  for (let i = 0; i < steps; i++) stepMovement(world, s, buttons, yaw, 0, 1, DT, sc);
}

describe('movement', () => {
  it('walks forward at walk speed along -Z for yaw 0', () => {
    const w = flatWorld();
    const s = createPlayerState();
    run(w, s, BTN.FORWARD, 120);
    expect(s.z).toBeLessThan(-8);
    expect(Math.abs(s.x)).toBeLessThan(1e-9);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(MOVEMENT.walkSpeed, 3);
    expect(s.onGround).toBe(true);
  });
  it('sprints faster, crouch is slower', () => {
    const w = flatWorld();
    const a = createPlayerState();
    const b = createPlayerState();
    run(w, a, BTN.FORWARD | BTN.SPRINT, 120);
    run(w, b, BTN.FORWARD | BTN.CROUCH, 120);
    expect(Math.hypot(a.vx, a.vz)).toBeCloseTo(MOVEMENT.sprintSpeed, 3);
    expect(Math.hypot(b.vx, b.vz)).toBeCloseTo(MOVEMENT.crouchSpeed, 3);
    expect(b.crouched).toBe(true);
  });
  it('jumps about 1 m and lands', () => {
    const w = flatWorld();
    const s = createPlayerState();
    const sc = createMoveScratch();
    let maxY = 0;
    stepMovement(w, s, BTN.JUMP, 0, 0, 1, DT, sc);
    for (let i = 0; i < 120; i++) {
      stepMovement(w, s, BTN.JUMP, 0, 0, 1, DT, sc); // held: no bunny hop
      maxY = Math.max(maxY, s.y);
    }
    expect(maxY).toBeGreaterThan(0.9);
    expect(maxY).toBeLessThan(1.2);
    expect(s.y).toBe(0);
    expect(s.onGround).toBe(true);
  });
  it('is deterministic: same inputs give identical state', () => {
    const map = generateMap(4242, 2, 0);
    const w1 = new World(map);
    const w2 = new World(JSON.parse(JSON.stringify({ ...map, terrain: { ...map.terrain, heightsCm: Array.from(map.terrain.heightsCm) } })) as MapData);
    // w2 gets a plain array; rebuild a typed one to mimic decode.
    (w2.map.terrain as { heightsCm: unknown }).heightsCm = Int16Array.from(map.terrain.heightsCm);
    const z = map.zones[0]!;
    const a = createPlayerState();
    const b = createPlayerState();
    for (const s of [a, b]) {
      s.x = z.spawns[0]!.x;
      s.z = z.spawns[0]!.z;
      s.y = z.spawns[0]!.y;
    }
    const sa = createMoveScratch();
    const sb = createMoveScratch();
    for (let i = 0; i < 3000; i++) {
      const b0 = [BTN.FORWARD, BTN.FORWARD | BTN.SPRINT, BTN.FORWARD | BTN.LEFT | BTN.JUMP, BTN.RIGHT | BTN.CROUCH, BTN.BACK][Math.floor(i / 97) % 5]!;
      const yaw = Math.sin(i * 0.01) * 3;
      stepMovement(w1, a, b0, yaw, 0.1, 1, DT, sa);
      stepMovement(w2, b, b0, yaw, 0.1, 1, DT, sb);
    }
    expect(b).toEqual(a);
  });
  it('collides with a box and slides along it', () => {
    // Wall 4 m in front (-Z), wide in X.
    const w = flatWorld([{ type: 'container', x: 0, y: 0, z: -4, rot: 0, scale: 1, variant: 0 }]);
    const s = createPlayerState();
    run(w, s, BTN.FORWARD, 180);
    expect(s.z).toBeGreaterThanOrEqual(-4 + 1.22 + MOVEMENT.radius - 1e-6);
    // Diagonal input slides along the wall in X.
    const s2 = createPlayerState();
    run(w, s2, BTN.FORWARD | BTN.RIGHT, 240);
    expect(s2.x).toBeGreaterThan(4);
  });
  it('collides with a cylinder', () => {
    const w = flatWorld([{ type: 'boulder', x: 0, y: 0, z: -5, rot: 0, scale: 1, variant: 0 }]);
    const s = createPlayerState();
    run(w, s, BTN.FORWARD, 120);
    expect(Math.hypot(s.x, s.z + 5)).toBeGreaterThanOrEqual(2.1 + MOVEMENT.radius - 1e-6);
  });
  it('steps up low obstacles but not high ones, and climbs tower stairs', () => {
    const w = flatWorld([{ type: 'tower', x: 0, y: 0, z: -12, rot: 2, scale: 1, variant: 0 }]);
    // rot 2: stairs lead out along +Z from the platform, starting at z = -12 + 2 + 5.5 = -4.5.
    const s = createPlayerState();
    run(w, s, BTN.FORWARD, 400);
    expect(s.y).toBeCloseTo(4.2, 5);
    expect(s.onGround).toBe(true);
  });
  it('cannot walk through a barrier taller than step height', () => {
    const w = flatWorld([{ type: 'barrier', x: 0, y: 0, z: -3, rot: 0, scale: 1, variant: 0 }]);
    const s = createPlayerState();
    run(w, s, BTN.FORWARD, 200);
    expect(s.z).toBeGreaterThan(-3);
    expect(s.y).toBe(0);
  });
  it('stays inside the world edge', () => {
    const w = flatWorld();
    const s = createPlayerState();
    s.x = w.maxX - 1;
    run(w, s, BTN.RIGHT, 300, 0);
    expect(s.x).toBeLessThanOrEqual(w.maxX);
  });
  it('max slope config is 45 degrees (movement code assumes tan = 1)', () => {
    expect(MOVEMENT.maxSlopeDeg).toBe(45);
  });
});

describe('weapon', () => {
  it('fires at the configured RPM and reloads', () => {
    const s = createPlayerState();
    const w = WEAPONS.ar1;
    let shots = 0;
    for (let i = 0; i < 60; i++) if (stepWeapon(s, BTN.FIRE, DT)) shots++;
    expect(shots).toBe(10); // 600 RPM = 10 shots per second
    for (let i = 0; i < 200; i++) stepWeapon(s, BTN.FIRE, DT);
    expect(s.mag[0]).toBeLessThan(w.magSize);
    // Reload completes after reloadS.
    const r = createPlayerState();
    r.mag[0] = 3;
    stepWeapon(r, BTN.RELOAD, DT);
    expect(r.reloadT).toBeGreaterThan(0);
    for (let i = 0; i < Math.ceil(w.reloadS / DT) + 2; i++) stepWeapon(r, 0, DT);
    expect(r.mag[0]).toBe(w.magSize);
    expect(r.res[0]).toBe(w.reserveMax - (w.magSize - 3));
  });
  it('cannot fire while sprinting or reloading', () => {
    const s = createPlayerState();
    s.sprinting = true;
    expect(stepWeapon(s, BTN.FIRE, DT)).toBe(false);
    s.sprinting = false;
    s.reloadT = 1;
    expect(stepWeapon(s, BTN.FIRE, DT)).toBe(false);
  });
  it('auto-reloads on an empty magazine', () => {
    const s = createPlayerState();
    s.mag[0] = 0;
    stepWeapon(s, BTN.FIRE, DT);
    expect(s.reloadT).toBeGreaterThan(0);
  });
  it('falloff matches the table (full to 40 m, 60% at 100 m)', () => {
    const w = WEAPONS.ar1;
    expect(falloffMult(w, 10)).toBe(1);
    expect(falloffMult(w, 40)).toBe(1);
    expect(falloffMult(w, 70)).toBeCloseTo(0.8, 6);
    expect(falloffMult(w, 100)).toBeCloseTo(0.6, 6);
    expect(falloffMult(w, 300)).toBeCloseTo(0.6, 6);
  });
  it('class and weapon config is sane', () => {
    for (const c of Object.values(CLASSES)) {
      expect(c.hp).toBeGreaterThan(0);
      expect(WEAPONS[c.slots[0]]).toBeDefined();
      expect(c.slots[1]).toBe('pistol');
    }
    expect(CLASSES.gunner.hp).toBe(120);
    expect(CLASSES.gunner.speedMult).toBe(0.88);
    expect(CLASSES.sniper.hp).toBe(85);
    for (const w of Object.values(WEAPONS)) {
      expect(w.damageHead).toBeGreaterThanOrEqual(w.damageBody);
      if (w.id !== 'coax' && w.id !== 'cannon') expect(w.spreadAdsDeg).toBeLessThan(w.spreadHipDeg);
      expect(w.magSize).toBeGreaterThan(0);
    }
  });
});

describe('hitboxes and rays', () => {
  it('ray hits head and body', () => {
    const out = { kind: 0 };
    const d = { x: 0, y: 0, z: 0 };
    aimDir(0, 0, d); // towards -Z
    const tHead = rayActor(0, 1.6, 10, d.x, d.y, d.z, 0, 0, 0, false, out);
    expect(out.kind).toBe(2);
    expect(tHead).toBeCloseTo(10 - 0.18, 5);
    rayActor(0, 1.0, 10, d.x, d.y, d.z, 0, 0, 0, false, out);
    expect(out.kind).toBe(1);
    const miss = rayActor(2, 1.0, 10, d.x, d.y, d.z, 0, 0, 0, false, out);
    expect(miss).toBe(Infinity);
    // Crouched: a ray at standing head height misses.
    expect(rayActor(0, 1.6, 10, d.x, d.y, d.z, 0, 0, 0, true, out)).toBe(Infinity);
  });
  it('ray hits colliders and terrain', () => {
    const w = flatWorld([{ type: 'container', x: 0, y: 0, z: -10, rot: 0, scale: 1, variant: 0 }]);
    const t = w.raycastStatic(0, 1, 0, 0, 0, -1, 100);
    expect(t).toBeCloseTo(10 - 1.22, 5);
    const down = w.raycastStatic(5, 3, 5, 0, -1, 0, 100);
    expect(down).toBeCloseTo(3, 3);
    expect(w.raycastStatic(0, 5, 0, 0, 1, 0, 100)).toBe(Infinity);
    const c = w.colliders[0]!;
    expect(rayCollider(c, 0, 1, 0, 0, 0, 1)).toBe(Infinity);
  });
});

describe('capture (GAME.md 4.3)', () => {
  const ev: CaptureEvents = { captured: -1, lost: -1 };
  const simulate = (z: ReturnType<typeof createZoneState>, present: number[], seconds: number): { cap: number[]; lost: number[] } => {
    const cap: number[] = [];
    const lost: number[] = [];
    const dt = 1 / NET.SERVER_TICK_HZ;
    for (let t = 0; t < seconds * NET.SERVER_TICK_HZ; t++) {
      stepZone(z, present, dt, ev);
      if (ev.captured >= 0) cap.push(ev.captured);
      if (ev.lost >= 0) lost.push(ev.lost);
    }
    return { cap, lost };
  };
  it('one player captures a neutral zone in 20 s', () => {
    const z = createZoneState(2, -1);
    simulate(z, [1, 0], 19.9);
    expect(z.owner).toBe(-1);
    const r = simulate(z, [1, 0], 0.2);
    expect(z.owner).toBe(0);
    expect(r.cap).toEqual([0]);
  });
  it('rate scales with n^0.75', () => {
    expect(captureRate(1)).toBeCloseTo(5, 9);
    expect(100 / captureRate(2)).toBeCloseTo(11.89, 1);
    expect(100 / captureRate(4)).toBeCloseTo(7.07, 1);
  });
  it('drains the owner first, then fills', () => {
    const z = createZoneState(2, 1);
    const r1 = simulate(z, [1, 0], 10);
    expect(z.control[1]).toBeCloseTo(50, 6);
    expect(z.owner).toBe(1);
    expect(r1.lost).toEqual([]);
    const r2 = simulate(z, [1, 0], 10.1);
    expect(z.owner).toBe(-1);
    expect(r2.lost).toEqual([1]);
    simulate(z, [1, 0], 20);
    expect(z.owner).toBe(0);
    expect(z.control).toEqual([100, 0]);
  });
  it('contested zones do not change', () => {
    const z = createZoneState(2, 0);
    z.control[0] = 60;
    simulate(z, [1, 1], 10);
    expect(z.contested).toBe(true);
    expect(z.control).toEqual([60, 0]);
    expect(canSpawnAt(z, 0)).toBe(false);
  });
  it('nobody present: owned stays owned, partial control decays 2%/s', () => {
    const z = createZoneState(2, 0);
    z.control[0] = 70; // owner partially drained earlier
    z.control[1] = 0;
    const n = createZoneState(2, -1);
    n.control[1] = 30;
    simulate(z, [0, 0], 10);
    simulate(n, [0, 0], 10);
    expect(z.owner).toBe(0);
    expect(z.control[0]).toBe(70);
    expect(n.control[1]).toBeCloseTo(10, 6);
    simulate(n, [0, 0], 10);
    expect(n.control[1]).toBe(0);
  });
  it('drains the largest other team first with 3 teams', () => {
    const z = createZoneState(3, -1);
    z.control = [0, 30, 50];
    simulate(z, [1, 0, 0], 4); // 20%
    expect(z.control[2]).toBeCloseTo(30, 6);
    expect(z.control[1]).toBeCloseTo(30, 6);
  });
});

describe('scoring and win conditions (GAME.md 4.4)', () => {
  const status = (n: number): TeamStatus[] => Array.from({ length: n }, () => ({ ownedZones: 1, alive: 1, eliminated: false }));
  it('owned zones give 0.5 points per second', () => {
    const s = [0, 0];
    for (let i = 0; i < 30 * 10; i++) addZoneScore(s, [0, 0, 1], 1 / 30);
    expect(s[0]).toBeCloseTo(10, 6);
    expect(s[1]).toBeCloseTo(5, 6);
  });
  it('score limit picks the highest score', () => {
    const r = checkWin({ scores: [500, 499], scoreLimit: 500, elapsedS: 10, timeLimitS: 900, owners: [0, 1], totalControlS: 0, status: status(2) });
    expect(r).toEqual({ winner: 0, reason: 'score' });
    expect(checkWin({ scores: [499, 499], scoreLimit: 500, elapsedS: 10, timeLimitS: 900, owners: [0, 1], totalControlS: 0, status: status(2) })).toBeNull();
  });
  it('time limit: score, then zones, then draw', () => {
    const base = { scoreLimit: 0, elapsedS: 900, timeLimitS: 900, totalControlS: 0, status: status(2) };
    expect(checkWin({ ...base, scores: [10, 20], owners: [0, 1] })).toEqual({ winner: 1, reason: 'time' });
    expect(checkWin({ ...base, scores: [20, 20], owners: [0, 0] })).toEqual({ winner: 0, reason: 'time' });
    expect(checkWin({ ...base, scores: [20, 20], owners: [0, 1] })).toEqual({ winner: -1, reason: 'time' });
    expect(checkWin({ ...base, elapsedS: 899, scores: [20, 20], owners: [0, 1] })).toBeNull();
  });
  it('total control after 60 s', () => {
    let t = 0;
    for (let i = 0; i < 59 * 30; i++) t = stepTotalControl(t, [1, 1], 1 / 30);
    const inp = { scores: [0, 0], scoreLimit: 0, elapsedS: 0, timeLimitS: 0, owners: [1, 1], status: status(2) };
    expect(checkWin({ ...inp, totalControlS: t })).toBeNull();
    for (let i = 0; i < 31; i++) t = stepTotalControl(t, [1, 1], 1 / 30);
    expect(checkWin({ ...inp, totalControlS: t })).toEqual({ winner: 1, reason: 'totalControl' });
    expect(stepTotalControl(t, [1, -1], 1 / 30)).toBe(0);
  });
  it('elimination: no zones and nobody alive', () => {
    const st = status(2);
    st[1]!.ownedZones = 0;
    st[1]!.alive = 1;
    updateEliminations(st);
    expect(st[1]!.eliminated).toBe(false);
    st[1]!.alive = 0;
    updateEliminations(st);
    expect(st[1]!.eliminated).toBe(true);
    const r = checkWin({ scores: [0, 0], scoreLimit: 500, elapsedS: 0, timeLimitS: 0, owners: [0, 0], totalControlS: 0, status: st });
    expect(r).toEqual({ winner: 0, reason: 'elimination' });
  });
  it('match constants match the spec', () => {
    expect(MATCH.scorePerZonePerS).toBe(0.5);
    expect(MATCH.respawnS).toBe(5);
    expect(MATCH.spawnProtectionS).toBe(2);
    expect(ZONES.captureRadius).toBe(14);
  });
});

describe('spawning (GAME.md 4.5)', () => {
  it('prefers far, unseen spawn points', () => {
    const map = generateMap(3, 2, 0);
    const zone = map.zones[0]!;
    const enemy = { x: zone.spawns[0]!.x + 1, y: zone.y, z: zone.spawns[0]!.z };
    const idx = pickSpawnPoint(zone, [enemy], () => false, () => 0);
    const far = zone.spawns.reduce((best, p, i) => (Math.hypot(p.x - enemy.x, p.z - enemy.z) > Math.hypot(zone.spawns[best]!.x - enemy.x, zone.spawns[best]!.z - enemy.z) ? i : best), 0);
    expect(idx).toBe(far);
    // Every point visible -> random fallback (rand = 0 -> index 0).
    expect(pickSpawnPoint(zone, [enemy], () => true, () => 0)).toBe(0);
  });
});
