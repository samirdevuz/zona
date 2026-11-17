import { describe, expect, it } from 'vitest';
import {
  ACT_AMMOBOX,
  ACT_GRENADE,
  ACT_MEDPACK,
  ACT_NONE,
  ACT_ROCKET,
  ACT_SHOOT,
  ACT_TORCH,
  BTN,
  GADGETS,
  MAP,
  NET,
  PROJ_GRENADE,
  PROJ_ROCKET,
  SLOT_KEEP,
  WEAPONS,
  World,
  createPlayerState,
  generateMap,
  refillAmmo,
  splashDamage,
  spreadDeg,
  stepInventory,
  stepProjectile,
  type MapData,
  type Projectile,
} from '../src';

const DT = NET.MOVE_DT;

function flatWorld(props: MapData['props'] = []): World {
  const base = generateMap(1, 2, 0);
  return new World({ ...base, terrain: { ...base.terrain, heightsCm: new Int16Array(base.terrain.heightsCm.length) }, props, zones: [] });
}

/** Run steps with a button mask; returns the action codes. */
function run(s: ReturnType<typeof createPlayerState>, b: number, steps: number, slot = SLOT_KEEP): number[] {
  const acts: number[] = [];
  for (let i = 0; i < steps; i++) acts.push(stepInventory(s, b, i === 0 ? slot : SLOT_KEEP, DT));
  return acts;
}

describe('inventory and slots', () => {
  it('switching slots takes switchTimeS and blocks firing meanwhile', () => {
    const s = createPlayerState('assault');
    const acts = run(s, BTN.FIRE, Math.ceil(GADGETS.switchTimeS / DT) - 1, 1);
    expect(s.slot).toBe(1);
    expect(acts.every((a) => a === ACT_NONE)).toBe(true);
    stepInventory(s, 0, SLOT_KEEP, DT);
    stepInventory(s, 0, SLOT_KEEP, DT);
    expect(stepInventory(s, BTN.FIRE, SLOT_KEEP, DT)).toBe(ACT_SHOOT);
  });
  it('ignores empty slots', () => {
    const s = createPlayerState('sniper');
    stepInventory(s, 0, 2, DT);
    expect(s.slot).toBe(0);
  });
  it('pistol and bolt-action are semi-automatic', () => {
    const s = createPlayerState('assault');
    run(s, 0, 40, 1);
    const acts = run(s, BTN.FIRE, 120);
    expect(acts.filter((a) => a === ACT_SHOOT).length).toBe(1);
    const sn = createPlayerState('sniper');
    let shots = 0;
    for (let i = 0; i < 6 * 60; i++) if (stepInventory(sn, i % 2 === 0 ? BTN.FIRE : 0, SLOT_KEEP, DT) === ACT_SHOOT) shots++;
    // 42 RPM bolt: one shot every ~1.43 s -> 5 shots in 6 s (first immediately).
    expect(shots).toBe(5);
  });
  it('LMG spread blooms per shot up to the cap and decays', () => {
    const s = createPlayerState('gunner');
    const base = spreadDeg(s);
    run(s, BTN.FIRE, 60);
    expect(spreadDeg(s)).toBeGreaterThan(base + 1);
    run(s, BTN.FIRE, 600);
    expect(spreadDeg(s)).toBeLessThanOrEqual(WEAPONS.lmg1.bloomMaxDeg);
    run(s, 0, 120);
    expect(s.bloom).toBe(0);
    // Crouched and still: half spread.
    s.crouched = true;
    expect(spreadDeg(s)).toBeCloseTo(WEAPONS.lmg1.spreadHipDeg * 0.5, 9);
  });
  it('Assault quick grenade: 2 carried, then none', () => {
    const s = createPlayerState('assault');
    const a1 = run(s, BTN.GRENADE, 1);
    expect(a1[0]).toBe(ACT_GRENADE);
    run(s, 0, 60);
    expect(run(s, BTN.GRENADE, 1)[0]).toBe(ACT_GRENADE);
    run(s, 0, 60);
    expect(run(s, BTN.GRENADE, 1)[0]).toBe(ACT_NONE);
    expect(s.mag[3]).toBe(0);
    // Other classes have no quick grenade.
    const e = createPlayerState('engineer');
    expect(run(e, BTN.GRENADE, 1)[0]).toBe(ACT_NONE);
  });
  it('med pack and ammo box respect their cooldowns', () => {
    const a = createPlayerState('assault');
    expect(run(a, BTN.GADGET_A, 1)[0]).toBe(ACT_MEDPACK);
    run(a, 0, 1);
    expect(run(a, BTN.GADGET_A, 1)[0]).toBe(ACT_NONE);
    run(a, 0, Math.ceil(GADGETS.medpack.cooldownS / DT) + 1);
    expect(run(a, BTN.GADGET_A, 1)[0]).toBe(ACT_MEDPACK);
    const g = createPlayerState('gunner');
    run(g, 0, 40, 2);
    expect(run(g, BTN.FIRE, 1)[0]).toBe(ACT_AMMOBOX);
    expect(g.gadgetCd).toBeCloseTo(GADGETS.ammobox.cooldownS, 6);
  });
  it('engineer: rocket launcher fires one rocket then reloads; torch acts while held', () => {
    const e = createPlayerState('engineer');
    run(e, 0, 40, 3);
    expect(run(e, BTN.FIRE, 1)[0]).toBe(ACT_ROCKET);
    expect(e.mag[3]).toBe(0);
    run(e, BTN.FIRE, 2);
    expect(e.reloadT).toBeGreaterThan(0);
    run(e, 0, Math.ceil(WEAPONS.rocket.reloadS / DT) + 2);
    expect(e.mag[3]).toBe(1);
    expect(e.res[3]).toBe(2);
    run(e, 0, 40, 2);
    expect(run(e, BTN.FIRE, 3)).toEqual([ACT_TORCH, ACT_TORCH, ACT_TORCH]);
  });
  it('refillAmmo restores reserves and grenades with fractional carry', () => {
    const s = createPlayerState('assault');
    s.res[0] = 0;
    s.res[1] = 0;
    s.mag[3] = 0;
    const acc: number[] = [];
    for (let i = 0; i < 60; i++) refillAmmo(s, 0.2 / 60, acc); // 1 s at 20 %/s
    expect(s.res[0]).toBe(24);
    expect(s.res[1]).toBe(7);
    for (let i = 0; i < 600; i++) refillAmmo(s, 0.2 / 60, acc);
    expect(s.res[0]).toBe(WEAPONS.ar1.reserveMax);
    expect(s.mag[3]).toBe(GADGETS.grenade.carried);
  });
  it('splash falls off linearly', () => {
    expect(splashDamage(100, 5, 0)).toBe(100);
    expect(splashDamage(100, 5, 2.5)).toBe(50);
    expect(splashDamage(100, 5, 5)).toBe(0);
  });
});

describe('projectiles', () => {
  const mk = (kind: number, vx: number, vy: number, vz: number, y = 1): Projectile => ({ id: 1, kind, owner: 1, team: 0, x: 0, y, z: 0, vx, vy, vz, age: 0, resting: false });
  const out = { exploded: false, bounced: false };
  it('grenade arcs, bounces, comes to rest and explodes after the fuse', () => {
    const w = flatWorld();
    const p = mk(PROJ_GRENADE, 0, 6, -12);
    let bounces = 0;
    let t = 0;
    while (!out.exploded && t < 5) {
      stepProjectile(w, p, DT, out);
      if (out.bounced) bounces++;
      t += DT;
    }
    expect(t).toBeCloseTo(GADGETS.grenade.fuseS, 1);
    expect(bounces).toBeGreaterThan(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeLessThan(0.3);
    expect(p.z).toBeLessThan(-5);
  });
  it('grenade bounces off a wall instead of passing through', () => {
    const w = flatWorld([{ type: 'container', x: 0, y: 0, z: -4, rot: 0, scale: 1, variant: 0 }]);
    const p = mk(PROJ_GRENADE, 0, 0, -20, 1.2);
    for (let i = 0; i < 60; i++) stepProjectile(w, p, DT, out);
    expect(p.z).toBeGreaterThan(-4 + 1.22 - 0.01);
  });
  it('rocket explodes on a wall without tunnelling', () => {
    const w = flatWorld([{ type: 'barrier', x: 0, y: 0, z: -10, rot: 0, scale: 1, variant: 0 }]);
    const p = mk(PROJ_ROCKET, 0, 0, -45, 0.6);
    let exploded = false;
    for (let i = 0; i < 60 && !exploded; i++) {
      stepProjectile(w, p, DT, out);
      exploded = out.exploded;
    }
    expect(exploded).toBe(true);
    expect(p.z).toBeCloseTo(-10 + 0.35, 1);
  });
});

describe('map generator (all combos, 20 seeds)', () => {
  it('passes the validator', async () => {
    const { ALLOWED_NEUTRALS, generateMapUnvalidated, validateMap } = await import('../src');
    for (const [t, ns] of Object.entries(ALLOWED_NEUTRALS)) {
      for (const N of ns) {
        for (let seed = 1; seed <= 20; seed++) {
          const map = generateMapUnvalidated(seed * 101, Number(t), N);
          expect(validateMap(map).errors, `T=${t} N=${N} seed=${seed * 101}`).toEqual([]);
        }
      }
    }
    expect(MAP.maxGenerateAttempts).toBeGreaterThan(0);
  }, 120_000);
});
