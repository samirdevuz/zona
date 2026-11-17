import { expect, test } from '@playwright/test';
import { call, closeAll, openPlayer, shot, state } from './helpers';

test.afterEach(async ({ browser }) => closeAll(browser));

test('M4: one human with bots — bots deploy, move to objectives and fight', async ({ browser, request }) => {
  await request.get('/__debug/reset');
  const errors: string[] = [];
  const p1 = await openPlayer(browser, 'Odam', errors);
  await p1.getByTestId('bots').selectOption('1');
  await p1.waitForTimeout(200);
  await p1.getByTestId('botFill').selectOption('4');
  await p1.waitForTimeout(200);
  await p1.getByTestId('botDifficulty').selectOption('hard');
  await expect(p1.getByText('🤖 +4 bot')).toBeVisible();
  await shot(p1, 'm4-01-lobby-bots');
  await p1.getByTestId('theme').selectOption('winter');
  await expect(p1.getByTestId('theme')).toHaveValue('winter');
  await p1.waitForTimeout(200);
  await p1.getByTestId('start').click();
  await expect.poll(async () => (await state(p1)).alive, { timeout: 30_000 }).toBe(true);
  // 3 bots on our team, 4 on the other.
  await expect.poll(async () => (await state(p1)).remotes.length, { timeout: 10_000 }).toBe(7);
  const start = new Map((await state(p1)).remotes.map((r) => [r.id, r]));
  await p1.waitForTimeout(15_000);
  const later = (await state(p1)).remotes;
  const moved = later.filter((r) => {
    const s = start.get(r.id);
    return s && Math.hypot(r.x - s.x, r.z - s.z) > 10;
  });
  expect(moved.length).toBeGreaterThanOrEqual(4);
  // Bots fight: a kill between bots happens within ~90 s.
  await expect.poll(async () => (await state(p1)).kills.length, { timeout: 90_000, intervals: [2000] }).toBeGreaterThan(0);
  // Look at the nearest bot.
  const s = await state(p1);
  const me = s.pos!;
  const near = [...s.remotes].filter((r) => r.alive).sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0]!;
  await call(p1, 'teleport', near.x + 6, near.y + 0.5, near.z + 6, 0, 0);
  await p1.waitForTimeout(1200);
  const s2 = await state(p1);
  const tgt = s2.remotes.find((r) => r.id === near.id)!;
  await call(p1, 'setLook', Math.atan2(-(tgt.x - s2.pos!.x), -(tgt.z - s2.pos!.z)), -0.1);
  await p1.waitForTimeout(400);
  await shot(p1, 'm4-02-bot-close');
  await p1.keyboard.down('Tab');
  await p1.waitForTimeout(400);
  await shot(p1, 'm4-03-scoreboard-bots');
  await p1.keyboard.up('Tab');
  expect(errors).toEqual([]);
});
