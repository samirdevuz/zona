import { describe, expect, it } from 'vitest';
import { BTN, CLASSES, GADGETS, MATCH, NET, PROTOCOL_VERSION, RESUPPLY, type ServerMsg, type SnapshotMsg } from '@zona/shared';
import { Session, type Conn } from '../src/session';

class FakeConn implements Conn {
  msgs: ServerMsg[] = [];
  send(data: string): void {
    this.msgs.push(JSON.parse(data) as ServerMsg);
  }
  close(): void {}
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i]!.t === t) return this.msgs[i] as Extract<ServerMsg, { t: T }>;
    return undefined;
  }
  events(): Extract<ServerMsg, { t: 'event' }>['e'] {
    return this.msgs.flatMap((m) => (m.t === 'event' ? m.e : []));
  }
}

function setup(n: number): { s: Session; c: FakeConn[]; clock: { t: number }; tick: (k: number) => void; send: (i: number, m: object) => void } {
  const clock = { t: 0 };
  let r = 7;
  const s = new Session({ debug: true, now: () => clock.t, log: () => {}, rand: () => ((r = (r * 16807) % 2147483647) / 2147483647) });
  const c: FakeConn[] = [];
  for (let i = 0; i < n; i++) {
    const conn = new FakeConn();
    s.onMessage(conn, JSON.stringify({ t: 'join', name: `P${i}`, protocol: PROTOCOL_VERSION }));
    c.push(conn);
  }
  const tick = (k: number): void => {
    for (let i = 0; i < k; i++) {
      clock.t += 1 / NET.SERVER_TICK_HZ;
      s.tick();
    }
  };
  const send = (i: number, m: object): void => s.onMessage(c[i]!, JSON.stringify(m));
  return { s, c, clock, tick, send };
}

function goLive(env: ReturnType<typeof setup>, settings: object = {}): void {
  env.send(0, { t: 'lobby/settings', settings: { seed: '4242', ...settings } });
  env.send(0, { t: 'lobby/start' });
  env.tick(Math.ceil(MATCH.countdownS * NET.SERVER_TICK_HZ) + 2);
  expect(env.s.phase).toBe('live');
}

let seqs = new Map<number, number>();
function input(env: ReturnType<typeof setup>, i: number, b: number, yaw: number, pitch: number, slot = -1, steps = 2): void {
  const id = env.c[i]!.last('welcome')!.id;
  const seq = seqs.get(id) ?? 0;
  const arr: number[] = [];
  for (let k = 0; k < steps; k++) arr.push(b, yaw, pitch, k === 0 ? slot : -1);
  env.send(i, { t: 'input', seq, steps: arr });
  seqs.set(id, seq + steps);
}

describe('M2 lobby settings', () => {
  it('teams 2-4, auto neutrals from participants, custom neutrals validated', () => {
    seqs = new Map();
    const env = setup(5);
    expect(env.s.settings.neutrals).toBe(1); // 5 participants -> N=1
    env.send(0, { t: 'lobby/settings', settings: { teams: 3 } });
    expect(env.s.settings.teams).toBe(3);
    expect(env.s.lobbyPlayers().every((p) => p.team >= 0 && p.team < 3)).toBe(true);
    env.send(4, { t: 'lobby/setTeam', team: 2 });
    expect(env.s.lobbyPlayers().find((p) => p.name === 'P4')!.team).toBe(2);
    env.send(0, { t: 'lobby/settings', settings: { neutrals: 2 } }); // not allowed for T=3
    expect(env.s.settings.neutrals).toBe(1);
    env.send(0, { t: 'lobby/settings', settings: { neutrals: 3, autoNeutrals: false } });
    expect(env.s.settings.neutrals).toBe(3);
    expect(env.s.settings.autoNeutrals).toBe(false);
    env.send(0, { t: 'lobby/settings', settings: { teams: 4 } });
    expect(env.s.settings.neutrals).toBe(1); // 3 is invalid for T=4 -> back to Auto
    env.send(0, { t: 'lobby/settings', settings: { teams: 2 } });
    expect(env.s.lobbyPlayers().every((p) => p.team < 2)).toBe(true);
  });
  it('shuffle keeps teams balanced; auto-team picks the smallest team', () => {
    const env = setup(4);
    env.send(1, { t: 'lobby/setTeam', team: 0 });
    env.send(3, { t: 'lobby/setTeam', team: 0 });
    expect(env.s.lobbyPlayers().filter((p) => p.team === 0).length).toBe(4);
    env.send(0, { t: 'lobby/shuffle' });
    const counts = [0, 0];
    for (const p of env.s.lobbyPlayers()) counts[p.team]!++;
    expect(counts).toEqual([2, 2]);
    env.send(2, { t: 'lobby/setTeam', team: -1 });
    expect(env.s.lobbyPlayers().find((p) => p.name === 'P2')!.team).toBeGreaterThanOrEqual(0);
  });
  it('a 3-team match with a centre zone starts and everyone deploys at home', () => {
    seqs = new Map();
    const env = setup(3);
    env.send(0, { t: 'lobby/settings', settings: { teams: 3 } });
    goLive(env);
    const m = env.s.match!;
    expect(m.map.zones.length).toBe(4);
    for (const a of m.actors.values()) {
      expect(a.alive).toBe(true);
      const home = m.map.zones.find((z) => z.homeTeam === a.team)!;
      expect(Math.hypot(a.st.x - home.x, a.st.z - home.z)).toBeLessThan(12);
    }
  });
});

describe('M2 classes and gadgets on the server', () => {
  it('spawns with the chosen class after Deploy', () => {
    seqs = new Map();
    const env = setup(2);
    goLive(env);
    const victim = env.s.match!.actors.get(2)!;
    env.tick(70);
    env.send(0, { t: 'debug', cmd: 'damage', target: 2, amount: 500 });
    env.send(1, { t: 'spawn/request', zone: 1, classId: 'gunner', ready: true });
    env.tick(MATCH.respawnS * NET.SERVER_TICK_HZ + 2);
    expect(victim.alive).toBe(true);
    expect(victim.classId).toBe('gunner');
    expect(victim.maxHp).toBe(CLASSES.gunner.hp);
    expect(victim.st.mag[0]).toBe(100);
  });
  it('without Deploy a dead player waits, then is auto-deployed', () => {
    seqs = new Map();
    const env = setup(2);
    goLive(env);
    env.tick(70);
    env.send(0, { t: 'debug', cmd: 'damage', target: 2, amount: 500 });
    const v = env.s.match!.actors.get(2)!;
    env.tick((MATCH.respawnS + 2) * NET.SERVER_TICK_HZ);
    expect(v.alive).toBe(false);
    env.tick(MATCH.autoDeployS * NET.SERVER_TICK_HZ);
    expect(v.alive).toBe(true);
  });
  it('a thrown grenade explodes after the fuse and kills a nearby enemy', () => {
    seqs = new Map();
    const env = setup(2);
    goLive(env);
    env.tick(70);
    const m = env.s.match!;
    const A = m.map.zones[0]!;
    env.send(0, { t: 'debug', cmd: 'teleport', x: A.x + 3, y: A.y + 0.2, z: A.z + 4, yaw: 0, pitch: 0 });
    env.send(1, { t: 'debug', cmd: 'teleport', x: A.x + 3, y: A.y + 0.2, z: A.z + 2.5, yaw: 0, pitch: 0 });
    env.tick(30);
    env.send(0, { t: 'debug', cmd: 'damage', target: 2, amount: 70 });
    // Throw at our own feet; the thrower is not hurt, the enemy 1.5 m away is.
    input(env, 0, BTN.GRENADE, 0, -1.5);
    input(env, 0, 0, 0, -1.5);
    env.tick(2);
    expect(m.projectiles.length).toBe(1);
    env.tick(GADGETS.grenade.fuseS * NET.SERVER_TICK_HZ + 5);
    expect(env.c[0]!.events().some((e) => e.k === 'boom')).toBe(true);
    const kill = env.c[1]!.events().find((e) => e.k === 'kill');
    expect(kill).toBeDefined();
    expect(kill && kill.k === 'kill' ? kill.w : 0).toBe(-2);
  });
  it('a rocket hits an enemy directly for 100 damage', () => {
    seqs = new Map();
    const env = setup(2);
    env.send(0, { t: 'lobby/settings', settings: { seed: '99' } });
    goLive(env);
    env.tick(10);
    const m = env.s.match!;
    const shooter = m.actors.get(1)!;
    // Respawn the shooter as an engineer.
    env.send(1, { t: 'debug', cmd: 'damage', target: 1, amount: 500 });
    env.tick(70);
    env.send(1, { t: 'debug', cmd: 'damage', target: 1, amount: 500 });
    env.send(0, { t: 'spawn/request', zone: 0, classId: 'engineer', ready: true });
    env.tick(MATCH.respawnS * NET.SERVER_TICK_HZ + 2);
    expect(shooter.classId).toBe('engineer');
    env.tick(70);
    const A = m.map.zones[0]!;
    env.send(0, { t: 'debug', cmd: 'teleport', x: A.x + 3, y: A.y + 0.2, z: A.z + 6, yaw: 0, pitch: 0 });
    env.send(1, { t: 'debug', cmd: 'teleport', x: A.x + 3, y: A.y + 0.2, z: A.z - 6, yaw: 0, pitch: 0 });
    env.tick(30);
    input(env, 0, 0, 0, -0.06, 3, 2);
    env.tick(1);
    for (let k = 0; k < 15; k++) {
      input(env, 0, 0, 0, -0.06);
      env.tick(1);
    }
    input(env, 0, BTN.FIRE, 0, -0.06);
    env.tick(20);
    const victim = m.actors.get(2)!;
    const hit = env.c[0]!.events().find((e) => e.k === 'hit');
    expect(hit && hit.k === 'hit' ? hit.dmg : 0).toBeGreaterThanOrEqual(95);
    expect(victim.alive).toBe(false);
  });
  it('med pack heals teammates nearby; ammo box refills', () => {
    seqs = new Map();
    const env = setup(3); // P0 and P2 on team 0
    goLive(env);
    env.tick(70);
    const m = env.s.match!;
    const mate = m.actors.get(3)!;
    expect(mate.team).toBe(0);
    const A = m.map.zones[0]!;
    // Away from the zone resupply so only the med pack heals.
    const x = A.x * 0.5;
    const z = A.z * 0.5 + 30;
    const y = m.world.terrain.heightAt(x, z);
    env.send(0, { t: 'debug', cmd: 'teleport', x, y: y + 0.2, z, yaw: 0, pitch: 0 });
    env.send(2, { t: 'debug', cmd: 'teleport', x: x + 0.5, y: y + 0.2, z: z - 1, yaw: 0, pitch: 0 });
    env.tick(20);
    env.send(1, { t: 'debug', cmd: 'damage', target: 3, amount: 60 });
    expect(mate.hp).toBe(40);
    input(env, 0, BTN.GADGET_A, 0, 0);
    env.tick(2);
    expect(m.deployables.length).toBe(1);
    env.tick(3 * NET.SERVER_TICK_HZ);
    expect(mate.hp).toBeGreaterThan(40 + GADGETS.medpack.healPerS * 2.5);
    const snap = env.c[0]!.last('snapshot') as SnapshotMsg;
    expect(snap.d.length).toBe(6);
  });
  it('zone resupply heals owners near the station', () => {
    seqs = new Map();
    const env = setup(2);
    goLive(env);
    env.tick(70);
    const m = env.s.match!;
    const pad = m.map.zones[0]!.resupply;
    env.send(0, { t: 'debug', cmd: 'teleport', x: pad.x + 2, y: pad.y + 0.2, z: pad.z, yaw: 0, pitch: 0 });
    env.tick(5);
    const a = m.actors.get(1)!;
    a.hp = 30;
    env.tick(2 * NET.SERVER_TICK_HZ);
    expect(a.hp).toBeCloseTo(30 + RESUPPLY.healPerS * 2, 0);
  });
  it('announces an attack on an owned zone once (throttled)', () => {
    seqs = new Map();
    const env = setup(2);
    goLive(env);
    env.tick(70);
    const m = env.s.match!;
    const B = m.map.zones[1]!;
    env.send(1, { t: 'debug', cmd: 'teleport', x: 0, y: m.world.terrain.heightAt(0, 0) + 1, z: 0, yaw: 0, pitch: 0 });
    env.send(0, { t: 'debug', cmd: 'teleport', x: B.x + 4, y: B.y + 0.3, z: B.z + 4, yaw: 0, pitch: 0 });
    env.tick(5 * NET.SERVER_TICK_HZ);
    const attacks = env.c[1]!.events().filter((e) => e.k === 'attack');
    expect(attacks.length).toBe(1);
    const snap = env.c[0]!.last('snapshot') as SnapshotMsg;
    expect(snap.tc).toEqual([]);
  });
});
