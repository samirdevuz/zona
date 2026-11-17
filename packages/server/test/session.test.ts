import { describe, expect, it } from 'vitest';
import { BTN, MATCH, NET, PROTOCOL_VERSION, ZONES, type ServerMsg, type SnapshotMsg } from '@zona/shared';
import { Session, sanitizeName, type Conn } from '../src/session';

class FakeConn implements Conn {
  msgs: ServerMsg[] = [];
  closed = false;
  send(data: string): void {
    this.msgs.push(JSON.parse(data) as ServerMsg);
  }
  close(): void {
    this.closed = true;
  }
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i]!.t === t) return this.msgs[i] as Extract<ServerMsg, { t: T }>;
    return undefined;
  }
}

function setup(n: number, opts: { debug?: boolean } = {}): { s: Session; conns: FakeConn[]; clock: { t: number } } {
  const clock = { t: 0 };
  const s = new Session({ debug: opts.debug ?? true, now: () => clock.t, log: () => {} });
  const conns: FakeConn[] = [];
  for (let i = 0; i < n; i++) {
    const c = new FakeConn();
    s.onConnect(c);
    s.onMessage(c, JSON.stringify({ t: 'join', name: `P${i}`, protocol: PROTOCOL_VERSION }));
    conns.push(c);
  }
  return { s, conns, clock };
}

function ticks(s: Session, clock: { t: number }, n: number): void {
  for (let i = 0; i < n; i++) {
    clock.t += 1 / NET.SERVER_TICK_HZ;
    s.tick();
  }
}

function startLive(s: Session, conns: FakeConn[], clock: { t: number }): void {
  s.settings.seed = '777';
  s.onMessage(conns[0]!, JSON.stringify({ t: 'lobby/start' }));
  ticks(s, clock, Math.ceil(MATCH.countdownS * NET.SERVER_TICK_HZ) + 1);
  expect(s.phase).toBe('live');
  ticks(s, clock, 1); // everyone deploys on the first LIVE tick
}

describe('session lobby', () => {
  it('welcomes players, first is admin, teams are balanced', () => {
    const { s, conns } = setup(3);
    expect(conns[0]!.last('welcome')!.id).toBe(1);
    const lobby = conns[2]!.last('lobby/state')!;
    expect(lobby.adminId).toBe(1);
    expect(lobby.players.map((p) => p.team)).toEqual([0, 1, 0]);
    expect(s.players.size).toBe(3);
  });
  it('debug reset tells clients they were kicked (so they do not auto-reconnect)', () => {
    const { s, conns } = setup(2);
    s.reset();
    for (const c of conns) {
      expect(c.last('error')!.code).toBe('kicked');
      expect(c.closed).toBe(true);
    }
    expect(s.players.size).toBe(0);
  });
  it('rejects protocol mismatch with a friendly error', () => {
    const s = new Session({ log: () => {} });
    const c = new FakeConn();
    s.onMessage(c, JSON.stringify({ t: 'join', name: 'x', protocol: PROTOCOL_VERSION + 1 }));
    expect(c.last('error')!.code).toBe('protocol');
    expect(c.closed).toBe(true);
  });
  it('reassigns admin to the oldest player when the admin leaves', () => {
    const { s, conns } = setup(3);
    s.onClose(conns[0]!);
    expect(s.adminId).toBe(2);
  });
  it('only the admin can start and change settings', () => {
    const { s, conns } = setup(2);
    s.onMessage(conns[1]!, JSON.stringify({ t: 'lobby/start' }));
    expect(s.phase).toBe('lobby');
    s.onMessage(conns[1]!, JSON.stringify({ t: 'lobby/settings', settings: { scoreLimit: 200 } }));
    expect(s.settings.scoreLimit).toBe(MATCH.defaultScoreLimit);
    s.onMessage(conns[0]!, JSON.stringify({ t: 'lobby/settings', settings: { scoreLimit: 200, timeLimitMin: 7 } }));
    expect(s.settings.scoreLimit).toBe(200);
    expect(s.settings.timeLimitMin).toBe(MATCH.defaultTimeLimitMin); // 7 is not an allowed option
    s.onMessage(conns[0]!, JSON.stringify({ t: 'lobby/start' }));
    expect(s.phase).toBe('countdown');
    expect(conns[1]!.last('match/start')!.map.zones.length).toBe(2);
    // Nobody is deployed during the countdown (players choose class and zone).
    expect([...s.match!.actors.values()].every((a) => !a.alive)).toBe(true);
  });
  it('sanitizes names', () => {
    expect(sanitizeName('  <b>Ali</b>\u0007 ', 3)).toBe('bAli/b');
    expect(sanitizeName('   ', 3)).toBe('Player 3');
    expect(sanitizeName('x'.repeat(40), 1).length).toBe(NET.MAX_NAME_LENGTH);
  });
});

describe('session match', () => {
  it('spawns actors at their home zones and goes live after the countdown', () => {
    const { s, conns, clock } = setup(2);
    startLive(s, conns, clock);
    const m = s.match!;
    for (const a of m.actors.values()) {
      expect(a.alive).toBe(true);
      const home = m.map.zones.find((z) => z.homeTeam === a.team)!;
      expect(Math.hypot(a.st.x - home.x, a.st.z - home.z)).toBeLessThanOrEqual(ZONES.spawnRingMax + 0.01);
    }
  });
  it('processes inputs, acks the sequence and both clients see the mover', () => {
    const { s, conns, clock } = setup(2);
    startLive(s, conns, clock);
    const a = s.match!.actors.get(1)!;
    const x0 = a.st.x;
    const z0 = a.st.z;
    for (let k = 0; k < 30; k++) {
      s.onMessage(conns[0]!, JSON.stringify({ t: 'input', seq: k * 2, steps: [BTN.FORWARD, a.st.yaw, 0, -1, BTN.FORWARD, a.st.yaw, 0, -1] }));
      ticks(s, clock, 1);
    }
    expect(Math.hypot(a.st.x - x0, a.st.z - z0)).toBeGreaterThan(3);
    const snap0 = conns[0]!.last('snapshot') as SnapshotMsg;
    expect(snap0.ack).toBe(59);
    expect(snap0.me!.st.x).toBeCloseTo(a.st.x, 9);
    const snap1 = conns[1]!.last('snapshot') as SnapshotMsg;
    const i = snap1.a.indexOf(1);
    expect(snap1.a[i + 1]).toBeCloseTo(a.st.x, 1);
  });
  it('kills via damage, respawns after the timer', () => {
    const { s, conns, clock } = setup(2);
    startLive(s, conns, clock);
    ticks(s, clock, 70); // spawn protection over
    s.onMessage(conns[0]!, JSON.stringify({ t: 'debug', cmd: 'damage', target: 2, amount: 150 }));
    const victim = s.match!.actors.get(2)!;
    expect(victim.alive).toBe(false);
    ticks(s, clock, 1);
    expect(conns[1]!.msgs.some((m) => m.t === 'event' && m.e.some((e) => e.k === 'kill' && e.victim === 2))).toBe(true);
    s.onMessage(conns[1]!, JSON.stringify({ t: 'spawn/request', zone: 1, classId: 'assault', ready: true }));
    ticks(s, clock, MATCH.respawnS * NET.SERVER_TICK_HZ + 2);
    expect(victim.alive).toBe(true);
    expect(s.match!.actors.get(1)!.kills).toBe(1);
  });
  it('shooting an enemy in front deals damage and kills', () => {
    const { s, conns, clock } = setup(2);
    startLive(s, conns, clock);
    ticks(s, clock, 70);
    const m = s.match!;
    const zone = m.map.zones[0]!;
    // Place both players on flat ground in zone A, 8 m apart along -Z, shooter facing the target.
    s.onMessage(conns[0]!, JSON.stringify({ t: 'debug', cmd: 'teleport', x: zone.x + 3, y: zone.y + 0.1, z: zone.z + 4, yaw: 0, pitch: 0 }));
    s.onMessage(conns[1]!, JSON.stringify({ t: 'debug', cmd: 'teleport', x: zone.x + 3, y: zone.y + 0.1, z: zone.z - 4, yaw: 0, pitch: 0 }));
    let seq = 0;
    for (let k = 0; k < 60 && m.actors.get(2)!.alive; k++) {
      s.onMessage(conns[0]!, JSON.stringify({ t: 'input', seq, steps: [BTN.FIRE | BTN.CROUCH | BTN.ADS, 0, -0.03, -1, BTN.FIRE | BTN.CROUCH | BTN.ADS, 0, -0.03, -1] }));
      seq += 2;
      ticks(s, clock, 1);
    }
    expect(m.actors.get(2)!.alive).toBe(false);
    expect(conns[0]!.msgs.some((x) => x.t === 'event' && x.e.some((e) => e.k === 'hit'))).toBe(true);
  });
  it('captures the enemy zone: drain 20 s, then fill 20 s', () => {
    const { s, conns, clock } = setup(2);
    startLive(s, conns, clock);
    ticks(s, clock, 70);
    const m = s.match!;
    const b = m.map.zones[1]!;
    const mid = m.world.terrain.heightAt(0, 0);
    s.onMessage(conns[1]!, JSON.stringify({ t: 'debug', cmd: 'teleport', x: 0, y: mid + 0.5, z: 0, yaw: 0, pitch: 0 }));
    s.onMessage(conns[0]!, JSON.stringify({ t: 'debug', cmd: 'teleport', x: b.x + 2, y: b.y + 0.5, z: b.z + 2, yaw: 0, pitch: 0 }));
    ticks(s, clock, 21 * NET.SERVER_TICK_HZ);
    expect(m.zones[1]!.owner).toBe(-1);
    expect(conns[0]!.msgs.some((x) => x.t === 'event' && x.e.some((e) => e.k === 'lost' && e.zone === 1 && e.team === 1))).toBe(true);
    ticks(s, clock, 20 * NET.SERVER_TICK_HZ);
    expect(m.zones[1]!.owner).toBe(0);
    expect(conns[0]!.msgs.some((x) => x.t === 'event' && x.e.some((e) => e.k === 'cap' && e.zone === 1 && e.team === 0))).toBe(true);
    expect(m.actors.get(1)!.caps).toBe(1);
    expect(s.phase).toBe('live');
  });
  it('a team with no zones and nobody alive is eliminated', () => {
    const { s, conns, clock } = setup(1);
    startLive(s, conns, clock);
    ticks(s, clock, 70);
    const m = s.match!;
    const b = m.map.zones[1]!;
    s.onMessage(conns[0]!, JSON.stringify({ t: 'debug', cmd: 'teleport', x: b.x + 2, y: b.y + 0.5, z: b.z + 2, yaw: 0, pitch: 0 }));
    ticks(s, clock, 21 * NET.SERVER_TICK_HZ);
    expect(s.phase).toBe('ending');
    const end = conns[0]!.last('match/end')!;
    expect(end.winner).toBe(0);
    expect(end.reason).toBe('elimination');
    ticks(s, clock, (MATCH.endingS + 0.2) * NET.SERVER_TICK_HZ);
    expect(s.phase).toBe('results');
    s.onMessage(conns[0]!, JSON.stringify({ t: 'lobby/return' }));
    expect(s.phase).toBe('lobby');
  });
  it('score limit ends the match', () => {
    const { s, conns, clock } = setup(2);
    s.onMessage(conns[0]!, JSON.stringify({ t: 'lobby/settings', settings: { scoreLimit: 200 } }));
    startLive(s, conns, clock);
    s.match!.scores[1] = 199.99;
    ticks(s, clock, 2);
    expect(s.phase).toBe('ending');
    expect(conns[0]!.last('match/end')!.winner).toBe(1);
  });
  it('late joiners get the match and spawn after the timer; reconnect keeps the actor', () => {
    const { s, conns, clock } = setup(2);
    startLive(s, conns, clock);
    const late = new FakeConn();
    s.onMessage(late, JSON.stringify({ t: 'join', name: 'Late', protocol: PROTOCOL_VERSION }));
    expect(late.last('match/start')).toBeDefined();
    const id = late.last('welcome')!.id;
    expect(s.match!.actors.get(id)!.alive).toBe(false);
    s.onMessage(late, JSON.stringify({ t: 'spawn/request', zone: -1, classId: 'sniper', ready: true }));
    ticks(s, clock, (MATCH.respawnS + 0.2) * NET.SERVER_TICK_HZ);
    expect(s.match!.actors.get(id)!.classId).toBe('sniper');
    expect(s.match!.actors.get(id)!.alive).toBe(true);
    // Reconnect with the token.
    const token = late.last('welcome')!.token;
    s.onClose(late);
    const again = new FakeConn();
    s.onMessage(again, JSON.stringify({ t: 'join', name: 'Late', token, protocol: PROTOCOL_VERSION }));
    expect(again.last('welcome')!.id).toBe(id);
    expect(again.last('match/start')!.you).toBe(id);
    // The reconnected client restarts its input sequence at 0 and is still simulated.
    const actor = s.match!.actors.get(id)!;
    const x0 = actor.st.x;
    const z0 = actor.st.z;
    for (let k = 0; k < 20; k++) {
      s.onMessage(again, JSON.stringify({ t: 'input', seq: k * 2, steps: [BTN.FORWARD, actor.st.yaw, 0, -1, BTN.FORWARD, actor.st.yaw, 0, -1] }));
      ticks(s, clock, 1);
    }
    expect(Math.hypot(actor.st.x - x0, actor.st.z - z0)).toBeGreaterThan(2);
    // Grace period expiry removes a disconnected player.
    s.onClose(again);
    ticks(s, clock, (NET.RECONNECT_GRACE_S + 1) * NET.SERVER_TICK_HZ);
    expect(s.match?.actors.has(id) ?? false).toBe(false);
  });
  it('ignores debug commands when debug is off', () => {
    const { s, conns, clock } = setup(2, { debug: false });
    startLive(s, conns, clock);
    ticks(s, clock, 70);
    s.onMessage(conns[0]!, JSON.stringify({ t: 'debug', cmd: 'damage', target: 2, amount: 150 }));
    expect(s.match!.actors.get(2)!.alive).toBe(true);
  });
});
