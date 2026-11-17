import { describe, expect, it } from 'vitest';
import { MATCH, NET, PROTOCOL_VERSION, type ServerMsg } from '@zona/shared';
import { Session, type Conn } from '../src/session';

class NullConn implements Conn {
  msgs: ServerMsg[] = [];
  keep = false;
  send(data: string): void {
    if (this.keep) this.msgs.push(JSON.parse(data) as ServerMsg);
  }
  close(): void {}
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Run a bots-only match until it ends (or maxMinutes of simulated time). */
function runBotsOnly(teams: number, neutrals: number, fill: number, maxMinutes: number, difficulty: 'easy' | 'medium' | 'hard' = 'medium') {
  let now = 0;
  const s = new Session({ log: () => {}, now: () => now, rand: seeded(teams * 31 + neutrals * 7 + fill) });
  Object.assign(s.settings, { teams, neutrals, autoNeutrals: false, seed: String(1000 + teams * 10 + neutrals), scoreLimit: 200, timeLimitMin: 10, bots: true, botFill: fill, botDifficulty: difficulty });
  s.startMatch(true);
  const m = s.match!;
  const tickMs: number[] = [];
  let caps = 0;
  const owners = m.zones.map((z) => z.owner);
  let ended = false;
  const maxTicks = Math.round(maxMinutes * 60 * NET.SERVER_TICK_HZ);
  for (let i = 0; i < maxTicks; i++) {
    now += 1 / NET.SERVER_TICK_HZ;
    const t0 = performance.now();
    s.tick();
    tickMs.push(performance.now() - t0);
    m.zones.forEach((z, zi) => {
      if (z.owner !== owners[zi]) {
        if (z.owner >= 0) caps++;
        owners[zi] = z.owner;
      }
    });
    if (s.phase === 'ending') {
      ended = true;
      break;
    }
  }
  const kills = [...m.actors.values()].reduce((a, x) => a + x.kills, 0);
  const avg = tickMs.reduce((a, b) => a + b, 0) / tickMs.length;
  const sorted = [...tickMs].sort((a, b) => a - b);
  return { s, m, ended, kills, caps, avg, p99: sorted[Math.floor(sorted.length * 0.99)]!, minutes: tickMs.length / NET.SERVER_TICK_HZ / 60 };
}

describe('M4 bots (bot-only simulation)', () => {
  it('2 teams x 12 bots (24 actors): fight, capture, the match ends, tick within budget', () => {
    const r = runBotsOnly(2, 1, 12, 10);
    expect(r.m.actors.size).toBe(NET.MAX_ACTORS);
    expect(r.ended).toBe(true);
    expect(r.kills).toBeGreaterThan(5);
    expect(r.caps).toBeGreaterThan(0);
    expect(r.avg).toBeLessThan(NET.TICK_BUDGET_MS);
    process.stderr.write(`\n[bots 2x12] ended=${r.ended} after ${r.minutes.toFixed(1)} min kills=${r.kills} caps=${r.caps} tick avg=${r.avg.toFixed(2)} ms p99=${r.p99.toFixed(2)} ms result=${JSON.stringify(r.m.result)}\n`);
  }, 240_000);
  for (const [T, N] of [
    [2, 0],
    [3, 1],
    [4, 0],
    [3, 3],
  ] as const) {
    it(`T=${T} N=${N}: no exceptions, bots capture zones, the match ends`, () => {
      const r = runBotsOnly(T, N, Math.floor(NET.MAX_ACTORS / T), 10);
      expect(r.ended).toBe(true);
      expect(r.caps + r.kills).toBeGreaterThan(0);
      expect(r.avg).toBeLessThan(NET.TICK_BUDGET_MS);
    }, 240_000);
  }
  it('class composition is balanced per team', () => {
    let now = 0;
    const s = new Session({ log: () => {}, now: () => now, rand: seeded(5) });
    Object.assign(s.settings, { bots: true, botFill: 8 });
    s.startMatch(true);
    for (let t = 0; t < 2; t++) {
      const counts: Record<string, number> = {};
      for (const a of s.match!.actors.values()) if (a.team === t) counts[a.classId] = (counts[a.classId] ?? 0) + 1;
      expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(3);
      expect(Object.keys(counts).length).toBe(4);
    }
    now++;
  });
  it('fill rule: a human joining replaces a bot of that team; leaving brings one back', () => {
    let now = 0;
    const s = new Session({ log: () => {}, now: () => now, rand: seeded(9) });
    const host = new NullConn();
    s.onMessage(host, JSON.stringify({ t: 'join', name: 'Host', protocol: PROTOCOL_VERSION }));
    s.onMessage(host, JSON.stringify({ t: 'lobby/settings', settings: { bots: true, botFill: 4 } }));
    expect(s.participants()).toBe(8);
    s.onMessage(host, JSON.stringify({ t: 'lobby/start' }));
    const m = s.match!;
    const team = (t: number): number => [...m.actors.values()].filter((a) => a.team === t).length;
    expect(team(0)).toBe(4);
    expect(team(1)).toBe(4);
    expect([...m.actors.values()].filter((a) => a.bot).length).toBe(7);
    for (let i = 0; i < (MATCH.countdownS + 1) * NET.SERVER_TICK_HZ; i++) {
      now += 1 / NET.SERVER_TICK_HZ;
      s.tick();
    }
    const late = new NullConn();
    late.keep = true;
    s.onMessage(late, JSON.stringify({ t: 'join', name: 'Late', protocol: PROTOCOL_VERSION }));
    const lateTeam = m.actors.get(2)!.team;
    expect(team(lateTeam)).toBe(4);
    expect([...m.actors.values()].filter((a) => a.bot).length).toBe(6);
    const roster = late.msgs.find((x) => x.t === 'match/start');
    expect(roster && roster.t === 'match/start' ? roster.roster.some((r) => r.bot) : false).toBe(true);
    // Leaving: after the reconnect grace the slot is refilled with a bot.
    s.onClose(late);
    for (let i = 0; i < (NET.RECONNECT_GRACE_S + 1) * NET.SERVER_TICK_HZ; i++) {
      now += 1 / NET.SERVER_TICK_HZ;
      s.tick();
    }
    expect(team(lateTeam)).toBe(4);
  });
});
