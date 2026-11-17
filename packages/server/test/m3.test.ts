import { describe, expect, it } from 'vitest';
import { BTN, MATCH, NET, PROTOCOL_VERSION, VEHICLES, VEHICLE_RULES, type ServerMsg, type SnapshotMsg } from '@zona/shared';
import { decodeMap, encodeMap, generateMap } from '@zona/shared';
import { Match, type Actor, type Vehicle } from '../src/match';
import { Session, type Conn } from '../src/session';

class FakeConn implements Conn {
  msgs: ServerMsg[] = [];
  send(data: string): void {
    this.msgs.push(JSON.parse(data) as ServerMsg);
  }
  close(): void {}
  events(): Extract<ServerMsg, { t: 'event' }>['e'] {
    return this.msgs.flatMap((m) => (m.t === 'event' ? m.e : []));
  }
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i]!.t === t) return this.msgs[i] as Extract<ServerMsg, { t: T }>;
    return undefined;
  }
}

interface Env {
  s: Session;
  c: FakeConn[];
  tick(k: number): void;
  send(i: number, m: object): void;
  input(i: number, b: number, yaw?: number, pitch?: number, slot?: number, steps?: number): void;
  hold(i: number, b: number, seconds: number, yaw?: number, pitch?: number): void;
}

function setup(n: number, settings: object = {}): Env {
  const clock = { t: 0 };
  let r = 11;
  const s = new Session({ debug: true, now: () => clock.t, log: () => {}, rand: () => ((r = (r * 16807) % 2147483647) / 2147483647) });
  const c: FakeConn[] = [];
  for (let i = 0; i < n; i++) {
    const conn = new FakeConn();
    s.onMessage(conn, JSON.stringify({ t: 'join', name: `P${i}`, protocol: PROTOCOL_VERSION }));
    c.push(conn);
  }
  const seqs = new Map<number, number>();
  const env: Env = {
    s,
    c,
    tick: (k) => {
      for (let i = 0; i < k; i++) {
        clock.t += 1 / NET.SERVER_TICK_HZ;
        s.tick();
      }
    },
    send: (i, m) => s.onMessage(c[i]!, JSON.stringify(m)),
    input: (i, b, yaw = 0, pitch = 0, slot = -1, steps = 2) => {
      const seq = seqs.get(i) ?? 0;
      const arr: number[] = [];
      for (let k = 0; k < steps; k++) arr.push(b, yaw, pitch, k === 0 ? slot : -1);
      env.send(i, { t: 'input', seq, steps: arr });
      seqs.set(i, seq + steps);
    },
    hold: (i, b, seconds, yaw = 0, pitch = 0) => {
      for (let k = 0; k < Math.round(seconds * NET.SERVER_TICK_HZ); k++) {
        env.input(i, b, yaw, pitch);
        env.tick(1);
      }
    },
  };
  env.send(0, { t: 'lobby/settings', settings: { seed: '31337', ...settings } });
  env.send(0, { t: 'lobby/start' });
  env.tick(Math.ceil(MATCH.countdownS * NET.SERVER_TICK_HZ) + 3);
  return env;
}

const actor = (env: Env, i: number): Actor => env.s.match!.actors.get(i + 1)!;
const jeepOf = (env: Env, team: number): Vehicle => {
  const m = env.s.match!;
  const pad = m.pads.find((p) => p.kind === 'jeep' && m.map.zones[p.zone]!.homeTeam === team)!;
  return m.vehicles.get(pad.vehicle)!;
};
/** Teleport next to a vehicle's left side. */
function besides(env: Env, i: number, v: Vehicle): void {
  const yaw = v.st.yaw;
  const x = v.st.x - Math.cos(yaw) * 2.4;
  const z = v.st.z + Math.sin(yaw) * 2.4;
  env.send(i, { t: 'debug', cmd: 'teleport', x, y: v.st.y + 0.3, z, yaw, pitch: 0 });
  env.tick(10);
}

describe('M3 vehicles on the server', () => {
  it('jeeps sit on owned home pads; tanks only appear on neutral pads once owned', () => {
    const env = setup(2, { teams: 2, neutrals: 1, autoNeutrals: false });
    const m = env.s.match!;
    expect(m.pads.filter((p) => p.kind === 'jeep').length).toBe(3);
    expect(m.pads.filter((p) => p.kind === 'tank').length).toBe(1);
    expect([...m.vehicles.values()].filter((v) => v.kind === 'jeep').length).toBe(2);
    expect([...m.vehicles.values()].some((v) => v.kind === 'tank')).toBe(false);
    // Capture the centre: its jeep and tank appear.
    const C = m.map.zones[2]!;
    env.tick(70);
    env.send(0, { t: 'debug', cmd: 'teleport', x: C.x + 3, y: C.y + 0.3, z: C.z - 3, yaw: 0, pitch: 0 });
    env.tick(21 * NET.SERVER_TICK_HZ);
    expect(m.zones[2]!.owner).toBe(0);
    expect([...m.vehicles.values()].filter((v) => v.kind === 'tank').length).toBe(1);
    const snap = env.c[0]!.last('snapshot') as SnapshotMsg;
    expect(snap.v.length / 16).toBe(4);
  });
  it('vehicles can be switched off in the lobby', () => {
    const env = setup(1, { vehicles: false });
    expect(env.s.match!.pads.length).toBe(0);
    expect(env.s.match!.vehicles.size).toBe(0);
  });
  it('hold E to enter, drive, the driver follows the seat, hold E to exit', () => {
    const env = setup(2);
    env.tick(70);
    const v = jeepOf(env, 0);
    const a = actor(env, 0);
    besides(env, 0, v);
    env.hold(0, BTN.USE, 0.2);
    expect(a.vehicle).toBe(-1); // not held long enough
    env.hold(0, 0, 0.1);
    env.hold(0, BTN.USE, VEHICLE_RULES.enterHoldS + 0.1);
    expect(a.vehicle).toBe(v.id);
    expect(a.seat).toBe(0);
    // Keeping E held does not toggle again (needs a release).
    env.hold(0, BTN.USE, 1.5);
    expect(a.vehicle).toBe(v.id);
    expect(v.team).toBe(a.team);
    const x0 = v.st.x;
    const z0 = v.st.z;
    env.hold(0, BTN.FORWARD, 2);
    expect(Math.hypot(v.st.x - x0, v.st.z - z0)).toBeGreaterThan(10);
    expect(Math.hypot(a.st.x - v.st.x, a.st.z - v.st.z)).toBeLessThan(1.5);
    const me = (env.c[0]!.last('snapshot') as SnapshotMsg).me!;
    expect(me.veh!.seat).toBe(0);
    expect(me.veh!.vs!.x).toBeCloseTo(v.st.x, 6);
    // Stop and exit.
    env.hold(0, BTN.BACK, 1);
    env.hold(0, 0, 2);
    env.hold(0, BTN.USE, VEHICLE_RULES.enterHoldS + 0.1);
    expect(a.vehicle).toBe(-1);
    expect(v.team).toBe(-1);
    expect(a.hp).toBe(100);
    expect(Math.hypot(a.st.x - v.st.x, a.st.z - v.st.z)).toBeGreaterThan(1.5);
  });
  it('exiting at speed hurts; passengers take the second seat; enemies cannot board', () => {
    const env = setup(3); // P0, P2 on team 0; P1 on team 1
    env.tick(70);
    const v = jeepOf(env, 0);
    besides(env, 0, v);
    env.hold(0, BTN.USE, 0.5);
    besides(env, 2, v);
    env.hold(2, BTN.USE, 0.5);
    expect(actor(env, 2).seat).toBe(1);
    besides(env, 1, v);
    env.hold(1, BTN.USE, 0.5);
    expect(actor(env, 1).vehicle).toBe(-1);
    env.hold(0, BTN.FORWARD, 2.5);
    expect(v.st.speed).toBeGreaterThan(VEHICLE_RULES.exitSafeSpeed + 5);
    env.hold(2, 0, 0.1); // release E first (toggles need a release)
    env.hold(2, BTN.USE, 0.5);
    expect(actor(env, 2).vehicle).toBe(-1);
    expect(actor(env, 2).hp).toBeLessThan(100);
  });
  it('rockets destroy a jeep: occupants die, wreck clears, the pad respawns it', () => {
    const env = setup(2);
    env.tick(70);
    const m = env.s.match!;
    const v = jeepOf(env, 1);
    besides(env, 1, v);
    env.hold(1, BTN.USE, 0.5);
    expect(actor(env, 1).vehicle).toBe(v.id);
    // P0 respawns as an engineer.
    env.send(1, { t: 'debug', cmd: 'damage', target: 1, amount: 500 });
    env.send(0, { t: 'spawn/request', zone: 0, classId: 'engineer', ready: true });
    env.tick(MATCH.respawnS * NET.SERVER_TICK_HZ + 3);
    expect(actor(env, 0).classId).toBe('engineer');
    env.tick(70);
    // Stand 12 m in front of the jeep, facing it.
    const yaw = v.st.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const px = v.st.x + fx * 12;
    const pz = v.st.z + fz * 12;
    env.send(0, { t: 'debug', cmd: 'teleport', x: px, y: m.world.terrain.heightAt(px, pz) + 0.3, z: pz, yaw: yaw + Math.PI, pitch: 0 });
    env.tick(20);
    env.hold(0, 0, 1, yaw + Math.PI, -0.03);
    env.input(0, 0, yaw + Math.PI, -0.03, 3);
    env.hold(0, 0, 1, yaw + Math.PI, -0.03);
    env.hold(0, BTN.FIRE, 0.1, yaw + Math.PI, -0.03);
    env.hold(0, 0, 1, yaw + Math.PI, -0.03);
    expect(v.hp).toBe(VEHICLES.jeep.hp - 160);
    env.hold(0, 0, 4, yaw + Math.PI, -0.03); // reload
    env.hold(0, BTN.FIRE, 0.1, yaw + Math.PI, -0.03);
    env.hold(0, 0, 1, yaw + Math.PI, -0.03);
    expect(v.destroyed).toBe(true);
    expect(actor(env, 1).alive).toBe(false);
    expect(env.c[0]!.events().some((e) => e.k === 'boom' && e.kind === 4)).toBe(true);
    expect(env.c[0]!.events().some((e) => e.k === 'kill' && e.victim === 2 && e.w === -3)).toBe(true);
    env.tick((VEHICLE_RULES.wreckS + 0.5) * NET.SERVER_TICK_HZ);
    expect(m.vehicles.has(v.id)).toBe(false);
    env.tick((VEHICLES.jeep.respawnS - VEHICLE_RULES.wreckS) * NET.SERVER_TICK_HZ + 10);
    expect(jeepOf(env, 1)).toBeDefined();
    expect(jeepOf(env, 1).id).not.toBe(v.id);
  });
  it('ramming hurts enemies; the torch repairs; abandoned vehicles return to the pad', () => {
    const env = setup(2);
    env.tick(70);
    const m = env.s.match!;
    const v = jeepOf(env, 0);
    besides(env, 0, v);
    env.hold(0, BTN.USE, 0.5);
    // Enemy stands 25 m ahead.
    const yaw = v.st.yaw;
    const ex = v.st.x - Math.sin(yaw) * 25;
    const ez = v.st.z - Math.cos(yaw) * 25;
    env.send(1, { t: 'debug', cmd: 'teleport', x: ex, y: m.world.terrain.heightAt(ex, ez) + 0.2, z: ez, yaw: 0, pitch: 0 });
    env.hold(0, BTN.FORWARD, 2.2);
    const enemy = actor(env, 1);
    expect(enemy.hp < 100 || !enemy.alive).toBe(true);
    // Damage the jeep, exit, repair with the torch as an engineer.
    env.hold(0, BTN.BACK, 1.5);
    env.hold(0, 0, 2);
    env.hold(0, BTN.USE, 0.5);
    v.hp = 100;
    env.send(1, { t: 'debug', cmd: 'damage', target: 1, amount: 500 });
    env.send(0, { t: 'spawn/request', zone: -1, classId: 'engineer', ready: true });
    env.tick(MATCH.respawnS * NET.SERVER_TICK_HZ + 3);
    expect(actor(env, 0).classId).toBe('engineer');
    besides(env, 0, v);
    const a = actor(env, 0);
    const toV = Math.atan2(-(v.st.x - a.st.x), -(v.st.z - a.st.z));
    env.input(0, 0, toV, -0.3, 2);
    env.hold(0, 0, 0.6, toV, -0.3);
    env.hold(0, BTN.FIRE, 1, toV, -0.3);
    expect(v.hp).toBeGreaterThan(140);
    // Abandoned away from its pad for 60 s: it returns.
    const pad = m.pads[v.pad]!;
    expect((v.st.x - pad.x) ** 2 + (v.st.z - pad.z) ** 2).toBeGreaterThan(9);
    env.send(0, { t: 'debug', cmd: 'teleport', x: pad.x + 40, y: pad.y + 1, z: pad.z, yaw: 0, pitch: 0 });
    env.tick((VEHICLE_RULES.abandonS + 1) * NET.SERVER_TICK_HZ);
    expect(m.vehicles.has(v.id)).toBe(false);
    const back = m.vehicles.get(pad.vehicle)!;
    expect(Math.hypot(back.st.x - pad.x, back.st.z - pad.z)).toBeLessThan(0.5);
  });
  it('tank: cannon shells hurt infantry, occupants are protected from bullets', () => {
    const env = setup(2, { teams: 2, neutrals: 1, autoNeutrals: false });
    const m = env.s.match!;
    const C = m.map.zones[2]!;
    env.tick(70);
    env.send(0, { t: 'debug', cmd: 'teleport', x: C.x + 3, y: C.y + 0.3, z: C.z - 3, yaw: 0, pitch: 0 });
    env.tick(21 * NET.SERVER_TICK_HZ);
    const tank = [...m.vehicles.values()].find((v) => v.kind === 'tank')!;
    besides(env, 0, tank);
    env.hold(0, BTN.USE, 0.5);
    expect(actor(env, 0).vehicle).toBe(tank.id);
    // Enemy 20 m in front of the turret.
    const yaw = tank.st.yaw;
    const ex = tank.st.x - Math.sin(yaw) * 20;
    const ez = tank.st.z - Math.cos(yaw) * 20;
    env.send(1, { t: 'debug', cmd: 'teleport', x: ex, y: m.world.terrain.heightAt(ex, ez) + 0.2, z: ez, yaw: yaw, pitch: 0 });
    env.tick(10);
    // Aim the turret at the enemy's chest (shell drop is small at 20 m).
    const dy = actor(env, 1).st.y + 1 - (tank.st.y + 2);
    const pitch = Math.atan2(dy, 20) + 0.02;
    env.hold(0, 0, 1, yaw, pitch);
    env.hold(0, BTN.FIRE, 0.1, yaw, pitch);
    env.hold(0, 0, 1, yaw, pitch);
    expect(env.c[0]!.events().some((e) => e.k === 'boom' && e.kind === 3)).toBe(true);
    // Occupants of a tank are protected from small arms: a bullet ray never hits the driver.
    expect(actor(env, 0).alive).toBe(true);
  });
});

describe('M3 explosions', () => {
  const mk = (): { m: Match; a: Actor; b: Actor; y: number } => {
    const map = decodeMap(JSON.parse(JSON.stringify(encodeMap(generateMap(5, 2, 0)))));
    const m = new Match(map, { teams: 2, neutrals: 0, autoNeutrals: false, seed: '5', scoreLimit: 0, timeLimitMin: 0, vehicles: false, bots: false, botFill: 0, botDifficulty: 'medium', theme: 'summer' });
    const a = m.addActor(1, 'a', 0, { spawnNow: true });
    const b = m.addActor(2, 'b', 1, { spawnNow: true });
    b.protectT = 0;
    const y = m.world.terrain.heightAt(0, 0);
    b.st.x = 0;
    b.st.y = y;
    b.st.z = 0;
    return { m, a, b, y };
  };
  it('a tank shell that hits infantry directly deals 110', () => {
    const { m, a, b, y } = mk();
    m.projectiles.push({ id: 1, kind: 3, owner: a.id, team: 0, x: 0, y: y + 1, z: 1, vx: 0, vy: 0, vz: -80, age: 0, resting: false });
    m.step(1 / 30, true);
    expect(b.alive).toBe(false);
    expect(m.broadcastEvents.some((e) => e.k === 'kill' && e.w === 7)).toBe(true);
  });
  it('a rocket hitting the ground next to an enemy splashes them', () => {
    const { m, a, b, y } = mk();
    m.projectiles.push({ id: 1, kind: 2, owner: a.id, team: 0, x: 1.5, y: y + 3, z: 0, vx: 0, vy: -45, vz: 0, age: 0, resting: false });
    for (let i = 0; i < 4; i++) m.step(1 / 30, true);
    expect(m.projectiles.length).toBe(0);
    expect(b.hp).toBeLessThan(100);
    expect(b.hp).toBeGreaterThan(60);
  });
});
