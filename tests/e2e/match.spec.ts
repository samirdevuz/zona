import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '../../test-results/e2e-shots');
mkdirSync(SHOTS, { recursive: true });

interface ZState {
  phase: string;
  inMatch: boolean;
  myId: number;
  team: number;
  alive: boolean;
  hp: number;
  pos: { x: number; y: number; z: number } | null;
  remotes: { id: number; x: number; y: number; z: number; alive: boolean }[];
  zones: { owner: number; contested: boolean; control: number[] }[];
  zoneDefs: { x: number; y: number; z: number; homeTeam: number }[];
  scores: number[];
  kills: { killer: number; victim: number }[];
  captures: { zone: number; team: number }[];
  result: { winner: number; reason: string } | null;
  lobbyPhase: string | null;
  drawCalls: number;
  triangles: number;
  corrections: { count: number; max: number; sum: number };
}

const state = (p: Page): Promise<ZState> => p.evaluate(() => (window as unknown as { __zona: { state(): ZState } }).__zona.state());
const call = (p: Page, fn: string, ...args: unknown[]): Promise<void> =>
  p.evaluate(([f, a]) => (window as unknown as { __zona: Record<string, (...x: unknown[]) => void> }).__zona[f as string]!(...(a as unknown[])), [fn, args] as const);
const shot = (p: Page, name: string): Promise<Buffer> => p.screenshot({ path: join(SHOTS, `${name}.png`) });

async function openPlayer(browser: Browser, name: string, errors: string[]): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto('/?test=1');
  await page.fill('input', name);
  await page.getByRole('button', { name: /O'yinga kirish|Join game/ }).click();
  await expect(page.getByText(/Lobbi|Lobby/)).toBeVisible();
  return page;
}

test('two players: join, see each other, move, shoot, capture, win, back to lobby', async ({ browser }) => {
  const errors: string[] = [];
  const p1 = await openPlayer(browser, 'Ali', errors);
  const p2 = await openPlayer(browser, 'Vali', errors);
  await expect(p1.getByText('Vali')).toBeVisible();
  await shot(p1, '01-lobby');

  // Admin starts the match.
  await p1.getByTestId('start').click();
  await expect.poll(async () => (await state(p1)).phase, { timeout: 30_000 }).toBe('countdown');
  await shot(p2, '02-countdown');
  await expect.poll(async () => (await state(p1)).phase, { timeout: 30_000 }).toBe('live');
  await expect.poll(async () => (await state(p2)).alive, { timeout: 10_000 }).toBe(true);

  // Both see each other.
  await expect.poll(async () => (await state(p1)).remotes.length).toBe(1);
  await expect.poll(async () => (await state(p2)).remotes.length).toBe(1);
  const s1 = await state(p1);
  const s2 = await state(p2);
  expect(s1.team).not.toBe(s2.team);
  await shot(p1, '03-live-p1');

  // p2 walks forward; p1 sees the movement.
  const before = (await state(p1)).remotes[0]!;
  await p2.keyboard.down('KeyW');
  await p2.waitForTimeout(2000);
  await p2.keyboard.up('KeyW');
  await p2.waitForTimeout(600);
  const after = (await state(p1)).remotes[0]!;
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  expect(moved).toBeGreaterThan(4);
  const own = (await state(p2)).pos!;
  expect(Math.hypot(own.x - after.x, own.z - after.z)).toBeLessThan(0.5);
  // Prediction matched the server: no meaningful corrections while walking.
  const corr = (await state(p2)).corrections;
  expect(corr.max).toBeLessThan(0.05);

  // Put both in zone A, facing each other 12 m apart, and let p1 shoot p2.
  const A = s1.zoneDefs[0]!;
  await call(p1, 'teleport', A.x + 3, A.y + 0.3, A.z + 6, 0, 0);
  await call(p2, 'teleport', A.x + 3, A.y + 0.3, A.z - 6, Math.PI, 0);
  await p1.waitForTimeout(1200);
  await call(p1, 'setLook', 0, -0.07);
  await call(p2, 'setLook', Math.PI, 0);
  await p1.waitForTimeout(500);
  await shot(p1, '04-aim-at-enemy');
  await call(p1, 'press', ['FIRE', 'ADS']);
  await expect.poll(async () => (await state(p1)).kills.length, { timeout: 20_000 }).toBeGreaterThan(0);
  await call(p1, 'press', []);
  const kill = (await state(p1)).kills[0]!;
  expect(kill.killer).toBe(s1.myId);
  expect(kill.victim).toBe(s2.myId);
  await shot(p1, '05-after-kill-p1');
  await shot(p2, '06-dead-p2');

  // p2 respawns at its home zone B after the timer.
  await expect.poll(async () => (await state(p2)).alive, { timeout: 15_000 }).toBe(true);
  // Move p2 away (to the map centre) and p1 into zone B; capture takes 20 s drain + 20 s fill.
  const B = s1.zoneDefs[1]!;
  await call(p2, 'teleport', 0, 30, 0, 0, 0);
  await call(p1, 'teleport', B.x + 4, B.y + 0.3, B.z + 4, 0, 0);
  await expect.poll(async () => (await state(p1)).zones[1]!.owner, { timeout: 30_000 }).toBe(-1);
  await shot(p1, '07-neutralized-B');
  await expect.poll(async () => (await state(p1)).zones[1]!.owner, { timeout: 30_000 }).toBe(s1.team);
  expect((await state(p1)).captures.some((c) => c.zone === 1 && c.team === s1.team)).toBe(true);
  await shot(p1, '08-captured-B');

  // Perf proxy on the Low preset (GAME.md 13/15).
  const perf = await state(p1);
  writeFileSync(join(SHOTS, 'perf.json'), JSON.stringify({ drawCalls: perf.drawCalls, triangles: perf.triangles }, null, 2));
  expect(perf.drawCalls).toBeLessThanOrEqual(150);
  expect(perf.triangles).toBeLessThanOrEqual(150_000);

  // p2's team owns no zone now; killing p2 eliminates it and p1's team wins.
  await call(p1, 'damage', s2.myId, 500);
  await expect.poll(async () => (await state(p1)).result?.winner, { timeout: 10_000 }).toBe(s1.team);
  expect((await state(p1)).result!.reason).toBe('elimination');
  await p1.waitForTimeout(800);
  await shot(p1, '09-winner-banner');
  await expect.poll(async () => (await state(p1)).lobbyPhase, { timeout: 15_000 }).toBe('results');
  await shot(p1, '10-results');
  await shot(p2, '11-results-p2');

  // Admin returns everyone to the lobby.
  await p1.getByRole('button', { name: /Lobbiga qaytish|Back to lobby/ }).click();
  await expect.poll(async () => (await state(p2)).lobbyPhase, { timeout: 10_000 }).toBe('lobby');
  await expect(p2.getByText(/Lobbi|Lobby/)).toBeVisible();
  await shot(p2, '12-back-in-lobby');

  expect(errors).toEqual([]);
});
