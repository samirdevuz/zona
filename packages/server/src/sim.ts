/**
 * Headless simulation: a full match with scripted actors that wander between
 * zones and shoot, fast-forwarded. Checks for exceptions, that the match ends,
 * and that the tick time stays within budget (GAME.md 3.5, 15).
 * Bots proper arrive in M4; these scripted actors only exercise the server.
 *
 * Usage: npm run sim -- [actors=24] [minutes=10] [seed=1]
 */
import { BTN, MATCH, NET, PROTOCOL_VERSION, datan2 } from '@zona/shared';
import { Session, type Conn } from './session';

const actors = Number(process.argv[2] ?? 24);
const minutes = Number(process.argv[3] ?? 10);
const seed = String(process.argv[4] ?? '1');

class NullConn implements Conn {
  bytes = 0;
  send(data: string): void {
    this.bytes += data.length;
  }
  close(): void {}
}

let rngState = 12345;
const rand = (): number => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
};

const session = new Session({ log: () => {}, rand, now: () => simTime });
let simTime = 0;
const conns: NullConn[] = [];
for (let i = 0; i < Math.min(actors, NET.MAX_HUMANS * 2); i++) {
  const c = new NullConn();
  conns.push(c);
  session.onMessage(c, JSON.stringify({ t: 'join', name: `Sim${i}`, protocol: PROTOCOL_VERSION }));
}
// The session caps humans at MAX_HUMANS; the sim lifts the cap by adding the rest directly.
session.settings.seed = seed;
session.settings.timeLimitMin = minutes > 0 ? 10 : 0;
session.onMessage(conns[0]!, JSON.stringify({ t: 'lobby/start' }));
const m = session.match!;
let extraId = 1000;
while (m.actors.size < actors) m.addActor(extraId++, `Extra${extraId}`, m.actors.size % m.teams, { spawnNow: true });

const seqs = new Map<number, number>();
const targets = new Map<number, number>();
const tickMs: number[] = [];
const totalTicks = Math.round(minutes * 60 * NET.SERVER_TICK_HZ);
let ended = false;
let caps = 0;
const lastOwners = m.zones.map((z) => z.owner);
const t0 = performance.now();
for (let tick = 0; tick < totalTicks + MATCH.countdownS * NET.SERVER_TICK_HZ; tick++) {
  simTime += 1 / NET.SERVER_TICK_HZ;
  if (session.phase === 'live') {
    for (const a of m.actors.values()) {
      if (!a.alive) continue;
      let target = targets.get(a.id) ?? -1;
      if (target < 0 || rand() < 0.002) {
        target = Math.floor(rand() * m.map.zones.length);
        targets.set(a.id, target);
      }
      const z = m.map.zones[target]!;
      const yaw = datan2(-(z.x - a.st.x), -(z.z - a.st.z)) + (rand() - 0.5) * 0.6;
      let b = BTN.FORWARD;
      if (rand() < 0.3) b |= BTN.SPRINT;
      if (rand() < 0.02) b |= BTN.JUMP;
      if (rand() < 0.25) b = BTN.FIRE | BTN.FORWARD;
      const seq = (seqs.get(a.id) ?? -1) + 1;
      seqs.set(a.id, seq + 1);
      m.queueInput(a.id, seq, [b, yaw, (rand() - 0.5) * 0.1, -1, b, yaw, (rand() - 0.5) * 0.1, -1]);
    }
  }
  const s0 = performance.now();
  session.tick();
  tickMs.push(performance.now() - s0);
  m.zones.forEach((z, i) => {
    if (z.owner !== lastOwners[i]) {
      if (z.owner >= 0) caps++;
      lastOwners[i] = z.owner;
    }
  });
  if (session.phase === 'ending' && !ended) {
    ended = true;
    break;
  }
}
const sorted = [...tickMs].sort((a, b) => a - b);
const avg = tickMs.reduce((a, b) => a + b, 0) / tickMs.length;
const p99 = sorted[Math.floor(sorted.length * 0.99)]!;
const max = sorted[sorted.length - 1]!;
const bytesPerS = conns.reduce((a, c) => a + c.bytes, 0) / (tickMs.length / NET.SERVER_TICK_HZ) / conns.length;
const kills = [...m.actors.values()].reduce((a, x) => a + x.kills, 0);
const moved = [...m.actors.values()].filter((a) => Math.hypot(a.st.x, a.st.z) < m.map.radius * 0.6).length;
console.log(`actors=${m.actors.size} simulated=${(tickMs.length / NET.SERVER_TICK_HZ / 60).toFixed(1)} min wall=${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log(`tick ms: avg ${avg.toFixed(2)}  p99 ${p99.toFixed(2)}  max ${max.toFixed(2)}  (budget ${NET.TICK_BUDGET_MS})`);
console.log(`actors near centre=${moved} kills=${kills} captures=${caps} scores=${m.scores.map((s) => s.toFixed(0)).join('/')} ended=${ended} result=${JSON.stringify(m.result)}`);
console.log(`downstream per client: ${(bytesPerS / 1024).toFixed(1)} KiB/s`);
if (avg > NET.TICK_BUDGET_MS) {
  console.error('FAIL: average tick time over budget');
  process.exit(1);
}
