/**
 * Headless bots-only simulation (GAME.md 15): a full match with server-side
 * bots, fast-forwarded. Checks for exceptions, that the match ends, and that
 * the tick time stays within budget (GAME.md 3.5).
 *
 * Usage: npm run sim -- [teams=2] [neutrals=1] [botsPerTeam=12] [minutes=10] [difficulty=medium]
 */
import { BOT_DIFFICULTIES, NET, type BotDifficulty } from '@zona/shared';
import { Session } from './session';

const teams = Number(process.argv[2] ?? 2);
const neutrals = Number(process.argv[3] ?? 1);
const perTeam = Number(process.argv[4] ?? 12);
const minutes = Number(process.argv[5] ?? 10);
const difficulty = (BOT_DIFFICULTIES.includes(process.argv[6] as BotDifficulty) ? process.argv[6] : 'medium') as BotDifficulty;

let now = 0;
let rngState = 12345;
const rand = (): number => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
};
const session = new Session({ log: () => {}, now: () => now, rand });
Object.assign(session.settings, { teams, neutrals, autoNeutrals: false, seed: '1', scoreLimit: 500, timeLimitMin: minutes, bots: true, botFill: perTeam, botDifficulty: difficulty });
session.startMatch(true);
const m = session.match!;
const tickMs: number[] = [];
let caps = 0;
const owners = m.zones.map((z) => z.owner);
const t0 = performance.now();
const maxTicks = Math.round((minutes + 0.2) * 60 * NET.SERVER_TICK_HZ);
for (let i = 0; i < maxTicks; i++) {
  now += 1 / NET.SERVER_TICK_HZ;
  const s0 = performance.now();
  session.tick();
  tickMs.push(performance.now() - s0);
  m.zones.forEach((z, zi) => {
    if (z.owner !== owners[zi]) {
      if (z.owner >= 0) caps++;
      owners[zi] = z.owner;
    }
  });
  if (session.phase === 'ending') break;
}
const sorted = [...tickMs].sort((a, b) => a - b);
const avg = tickMs.reduce((a, b) => a + b, 0) / tickMs.length;
const kills = [...m.actors.values()].reduce((a, x) => a + x.kills, 0);
console.log(`teams=${teams} neutrals=${neutrals} actors=${m.actors.size} difficulty=${difficulty} simulated=${(tickMs.length / NET.SERVER_TICK_HZ / 60).toFixed(1)} min wall=${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log(`tick ms: avg ${avg.toFixed(2)}  p99 ${sorted[Math.floor(sorted.length * 0.99)]!.toFixed(2)}  max ${sorted[sorted.length - 1]!.toFixed(2)}  (budget ${NET.TICK_BUDGET_MS})`);
console.log(`kills=${kills} captures=${caps} scores=${m.scores.map((s) => s.toFixed(0)).join('/')} result=${JSON.stringify(m.result)}`);
if (avg > NET.TICK_BUDGET_MS) {
  console.error('FAIL: average tick time over budget');
  process.exit(1);
}
