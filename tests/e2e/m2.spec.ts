import { expect, test } from '@playwright/test';
import { call, openPlayer, shot, state } from './helpers';

test('M2: three teams, spawn screen classes, sniper scope, gadgets, grenade kill, neutral capture', async ({ browser, request }) => {
  await request.get('/__debug/reset');
  const errors: string[] = [];
  const p1 = await openPlayer(browser, 'Aziz', errors);
  const p2 = await openPlayer(browser, 'Bobur', errors);

  // Admin switches to 3 teams; Auto picks one neutral (centre) zone -> 4 zones.
  await p1.getByTestId('teams').selectOption('3');
  await expect(p1.getByText(/4 ta zona|4 zones/)).toBeVisible();
  await expect(p2.getByText('Binafsha').or(p2.getByText('Yashil'))).toBeVisible();
  await shot(p1, 'm2-01-lobby-3-teams');

  await p1.getByTestId('start').click();
  await expect.poll(async () => (await state(p1)).phase, { timeout: 30_000 }).toBe('countdown');
  // Spawn screen during the countdown: p1 clicks the Sniper card, p2 presses 3 (Gunner).
  await expect.poll(async () => (await state(p1)).spawnVisible).toBe(true);
  await p1.locator('button[data-class=sniper]').click();
  await p2.keyboard.press('Digit3');
  await p1.waitForTimeout(400);
  await shot(p1, 'm2-02-spawn-screen');
  await expect.poll(async () => (await state(p1)).phase, { timeout: 30_000 }).toBe('live');
  await expect.poll(async () => (await state(p1)).alive, { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await state(p2)).alive, { timeout: 10_000 }).toBe(true);
  expect((await state(p1)).classId).toBe('sniper');
  expect((await state(p2)).classId).toBe('gunner');
  const s1 = await state(p1);
  const s2 = await state(p2);
  expect(s1.zoneDefs.length).toBe(4);

  // Sniper scope.
  await call(p1, 'setLook', s1.yaw ?? 0, 0.02);
  await call(p1, 'press', ['ADS']);
  await p1.waitForTimeout(900);
  await shot(p1, 'm2-03-sniper-scope');
  await call(p1, 'press', []);

  // Switch to the pistol with the 2 key.
  await p1.keyboard.press('Digit2');
  await expect.poll(async () => (await state(p1)).slot).toBe(1);
  await p1.waitForTimeout(600);
  await shot(p1, 'm2-04-pistol');

  // Gunner deploys an ammo box with Q and looks at it.
  await call(p2, 'setLook', s2.yaw ?? 0, -0.6);
  await p2.keyboard.press('KeyQ');
  await p2.waitForTimeout(800);
  await shot(p2, 'm2-05-ammo-box');

  // p1 dies and comes back as Assault via the spawn screen.
  await p1.waitForTimeout(1500);
  await call(p2, 'damage', s1.myId, 500);
  await expect.poll(async () => (await state(p1)).spawnVisible, { timeout: 5_000 }).toBe(true);
  await shot(p1, 'm2-06-spawn-after-death');
  await call(p1, 'spawn', 'assault', -1);
  await expect.poll(async () => (await state(p1)).alive, { timeout: 15_000 }).toBe(true);
  expect((await state(p1)).classId).toBe('assault');

  // Grenade: p2 (pre-damaged) stands next to p1; p1 throws at their feet with G.
  const A = s1.zoneDefs[0]!;
  await p1.waitForTimeout(2200);
  await call(p1, 'teleport', A.x + 3, A.y + 0.3, A.z + 5, 0, 0);
  await call(p2, 'teleport', A.x + 3, A.y + 0.3, A.z + 3.6, 0, 0);
  await p1.waitForTimeout(1200);
  await call(p1, 'damage', s2.myId, 110); // gunner: 120 HP -> 10
  await call(p1, 'setLook', 0, -1.45);
  await p1.waitForTimeout(300);
  await p1.keyboard.press('KeyG');
  await expect.poll(async () => (await state(p1)).booms.length, { timeout: 8_000 }).toBeGreaterThan(0);
  await p1.waitForTimeout(150);
  await shot(p1, 'm2-07-grenade-explosion');
  await expect.poll(async () => (await state(p1)).kills.some((k) => k.victim === s2.myId && k.w === -2), { timeout: 5_000 }).toBe(true);

  // Capture the neutral centre zone (index 3): 20 s with one player.
  const D = s1.zoneDefs[3]!;
  expect(D.homeTeam).toBe(-1);
  await call(p1, 'teleport', D.x + 4, D.y + 0.3, D.z + 4, 0, 0);
  await expect.poll(async () => (await state(p1)).zones[3]!.owner, { timeout: 30_000 }).toBe(s1.team);
  await call(p1, 'setLook', 0.8, 0.05);
  await p1.waitForTimeout(500);
  await shot(p1, 'm2-08-captured-centre');
  await p1.keyboard.down('Tab');
  await p1.waitForTimeout(400);
  await shot(p1, 'm2-09-scoreboard-3-teams');
  await p1.keyboard.up('Tab');

  const perf = await state(p1);
  expect(perf.drawCalls).toBeLessThanOrEqual(150);
  expect(perf.triangles).toBeLessThanOrEqual(150_000);
  expect(errors).toEqual([]);
});
