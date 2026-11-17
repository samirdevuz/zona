import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHOTS, call, closeAll, shot, state } from './helpers';

test.afterEach(async ({ browser }) => closeAll(browser));

test('M5: rebinding, third-person and top-down cameras, reconnect', async ({ browser, request }) => {
  await request.get('/__debug/reset');
  const errors: string[] = [];
  const mk = async (name: string) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('WebSocket')) errors.push(`${name}: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await page.goto('/?test=1');
    return page;
  };
  const p1 = await mk('Kamol');
  // Rebind "forward" to I before joining.
  await p1.getByRole('button', { name: /Sozlamalar|Settings/ }).click();
  await p1.getByTestId('tab-controls').click();
  await p1.getByTestId('bind-forward').click();
  await p1.keyboard.press('KeyI');
  await expect(p1.getByTestId('bind-forward')).toHaveText('I');
  await shot(p1, 'm5-01-settings-controls');
  await p1.getByTestId('settings-close').click();
  await p1.fill('input', 'Kamol');
  await p1.getByRole('button', { name: /O'yinga kirish|Join game/ }).click();
  const p2 = await mk('Nodir');
  await p2.fill('input', 'Nodir');
  await p2.getByRole('button', { name: /O'yinga kirish|Join game/ }).click();
  await expect(p1.getByText('Nodir')).toBeVisible();
  await p1.getByPlaceholder(/tasodifiy|random/).fill('777');
  await p1.getByPlaceholder(/tasodifiy|random/).press('Enter');
  await p1.waitForTimeout(300);
  await p1.getByTestId('start').click();
  await expect.poll(async () => (await state(p1)).alive, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => (await state(p2)).alive, { timeout: 10_000 }).toBe(true);
  await p1.waitForTimeout(2300);

  // Recorded CC0 sounds are decoded once audio is unlocked (join click).
  await expect.poll(async () => (await state(p1)).audioSamples, { timeout: 10_000 }).toBeGreaterThanOrEqual(14);

  // The rebound key moves the player.
  const s1 = await state(p1);
  const A = s1.zoneDefs[0]!;
  await call(p1, 'teleport', A.x + 4, A.y + 0.3, A.z + 4, 0, 0);
  await p1.waitForTimeout(1000);
  await call(p1, 'setLook', 0, 0);
  const before = (await state(p1)).pos!;
  await p1.keyboard.down('KeyI');
  await p1.waitForTimeout(1200);
  await p1.keyboard.up('KeyI');
  await p1.waitForTimeout(300);
  const after = (await state(p1)).pos!;
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(2.5);

  // Close-up of the other soldier (rigged glTF character): standing, then crouched.
  await call(p1, 'teleport', A.x + 3, A.y + 0.3, A.z + 6, 0, 0);
  await call(p2, 'teleport', A.x + 3, A.y + 0.3, A.z + 2.6, Math.PI, 0);
  await call(p2, 'setLook', Math.PI, 0);
  await p1.waitForTimeout(1200);
  await call(p1, 'setLook', 0, -0.12);
  await p1.waitForTimeout(400);
  await shot(p1, 'm5-06-soldier-front');
  await call(p2, 'press', ['CROUCH']);
  await p1.waitForTimeout(700);
  await shot(p1, 'm5-07-soldier-crouch');
  await call(p2, 'press', []);

  // Third person: V switches; the local body is drawn; shooting still hits what the crosshair shows.
  await p1.keyboard.press('KeyV');
  await expect.poll(async () => (await state(p1)).cameraMode).toBe('third');
  await call(p1, 'teleport', A.x + 3, A.y + 0.3, A.z + 6, 0, 0);
  await call(p2, 'teleport', A.x + 3, A.y + 0.3, A.z - 6, Math.PI, 0);
  await p1.waitForTimeout(1200);
  await call(p1, 'setLook', 0, -0.08);
  await p1.waitForTimeout(500);
  expect((await state(p1)).localBodyVisible).toBe(true);
  await shot(p1, 'm5-02-third-person');
  const perf: Record<string, { drawCalls: number; triangles: number }> = {};
  const rec = async (name: string): Promise<void> => {
    const st = await state(p1);
    perf[name] = { drawCalls: st.drawCalls, triangles: st.triangles };
    expect(st.drawCalls).toBeLessThanOrEqual(150); // Low preset budget (GAME.md 13)
    expect(st.triangles).toBeLessThanOrEqual(150_000);
  };
  await rec('third');
  await call(p1, 'press', ['FIRE']);
  await expect.poll(async () => (await state(p1)).kills.length, { timeout: 20_000 }).toBeGreaterThan(0);
  await call(p1, 'press', []);

  // Top-down: W (here: I) moves north on screen whatever the facing.
  await p1.keyboard.press('KeyV');
  await expect.poll(async () => (await state(p1)).cameraMode).toBe('top');
  await p1.waitForTimeout(600);
  await shot(p1, 'm5-03-top-down');
  await rec('top');
  writeFileSync(join(SHOTS, 'perf-m5.json'), JSON.stringify(perf, null, 2));
  const tb = (await state(p1)).pos!;
  await p1.keyboard.down('KeyI');
  await p1.waitForTimeout(1200);
  await p1.keyboard.up('KeyI');
  await p1.waitForTimeout(300);
  const ta = (await state(p1)).pos!;
  expect(tb.z - ta.z).toBeGreaterThan(2.5);
  await p1.keyboard.press('KeyV');
  await expect.poll(async () => (await state(p1)).cameraMode).toBe('first');

  // Holding M shows the full map.
  await p1.keyboard.down('KeyM');
  await expect(p1.locator('canvas.bigmap')).toBeVisible();
  await p1.waitForTimeout(300);
  await shot(p1, 'm5-05-big-map');
  await p1.keyboard.up('KeyM');
  await expect(p1.locator('canvas.bigmap')).toBeHidden();

  // Reconnect: a dropped socket rejoins the same actor; a reload rejoins too.
  const id2 = (await state(p2)).myId;
  await call(p2, 'dropConnection');
  await expect.poll(async () => (await state(p2)).inMatch && (await state(p2)).myId === id2, { timeout: 15_000 }).toBe(true);
  await p2.reload();
  await expect.poll(async () => (await state(p2)).inMatch, { timeout: 20_000 }).toBe(true);
  expect((await state(p2)).myId).toBe(id2);
  await shot(p2, 'm5-04-after-reload');
  expect(errors).toEqual([]);
});
