import { expect, test } from '@playwright/test';
import { call, closeAll, openPlayer, shot, state } from './helpers';

test.afterEach(async ({ browser }) => closeAll(browser));

test('M3: enter a jeep, drive, exit; rockets destroy it', async ({ browser, request }) => {
  await request.get('/__debug/reset');
  const errors: string[] = [];
  const p1 = await openPlayer(browser, 'Driver', errors);
  const p2 = await openPlayer(browser, 'Engineer', errors);
  await p1.getByPlaceholder(/tasodifiy|random/).fill('4242');
  await p1.getByPlaceholder(/tasodifiy|random/).press('Enter');
  await p1.waitForTimeout(300);
  await p1.getByTestId('start').click();
  await expect.poll(async () => (await state(p1)).alive, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => (await state(p2)).alive, { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await state(p1)).vehicles.length, { timeout: 10_000 }).toBe(2);
  const s1 = await state(p1);
  // Our home jeep is the one closest to zone A.
  const A = s1.zoneDefs[0]!;
  const jeep = [...s1.vehicles].sort((a, b) => Math.hypot(a.x - A.x, a.z - A.z) - Math.hypot(b.x - A.x, b.z - A.z))[0]!;
  await p1.waitForTimeout(2200);
  await call(p1, 'teleport', jeep.x + 2.6, jeep.y + 0.4, jeep.z, Math.PI / 2, 0);
  await p1.waitForTimeout(1000);
  await shot(p1, 'm3-01-enter-prompt');
  await p1.keyboard.down('KeyE');
  await p1.waitForTimeout(900);
  await p1.keyboard.up('KeyE');
  await expect.poll(async () => (await state(p1)).mode, { timeout: 5_000 }).toBe(1);
  expect((await state(p1)).myVehicle).toBe(jeep.id);
  await shot(p1, 'm3-02-driver-view');

  // Drive forward: both clients see the jeep move.
  const before = (await state(p2)).vehicles.find((v) => v.id === jeep.id)!;
  await p1.keyboard.down('KeyW');
  await p1.waitForTimeout(1600);
  await p1.keyboard.up('KeyW');
  await p1.keyboard.down('KeyS');
  await p1.waitForTimeout(900);
  await p1.keyboard.up('KeyS');
  await p1.waitForTimeout(1500);
  const after = (await state(p2)).vehicles.find((v) => v.id === jeep.id)!;
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(5);
  const mine = (await state(p1)).vehicles.find((v) => v.id === jeep.id)!;
  expect(Math.hypot(mine.x - after.x, mine.z - after.z)).toBeLessThan(1.5);
  expect((await state(p1)).corrections.max).toBeLessThan(0.5);
  await shot(p2, 'm3-03-jeep-seen-by-other');

  // Exit.
  await p1.keyboard.down('KeyE');
  await p1.waitForTimeout(900);
  await p1.keyboard.up('KeyE');
  await expect.poll(async () => (await state(p1)).mode, { timeout: 5_000 }).toBe(0);

  // p2 becomes an engineer and fires two rockets at the empty jeep.
  await call(p1, 'damage', (await state(p2)).myId, 500);
  await expect.poll(async () => (await state(p2)).spawnVisible, { timeout: 5_000 }).toBe(true);
  await call(p2, 'spawn', 'engineer', -1);
  await expect.poll(async () => (await state(p2)).alive, { timeout: 15_000 }).toBe(true);
  await p2.waitForTimeout(2200);
  const target = (await state(p2)).vehicles.find((v) => v.id === jeep.id)!;
  const sx = target.x + 10;
  const sz = target.z + 3;
  await call(p2, 'teleport', sx, target.y + 0.5, sz, 0, 0);
  await p2.waitForTimeout(1200);
  const me = (await state(p2)).pos!;
  const yaw = Math.atan2(-(target.x - me.x), -(target.z - me.z));
  const pitch = Math.atan2(target.y + 0.9 - (me.y + 1.65), Math.hypot(target.x - me.x, target.z - me.z));
  await call(p2, 'setLook', yaw, pitch);
  await p2.keyboard.press('Digit4');
  await p2.waitForTimeout(900);
  await shot(p2, 'm3-04-rocket-launcher');
  for (let i = 0; i < 2; i++) {
    await call(p2, 'press', ['FIRE']);
    await p2.waitForTimeout(250);
    await call(p2, 'press', []);
    await p2.waitForTimeout(i === 0 ? 4200 : 600);
  }
  await expect.poll(async () => (await state(p2)).booms.length, { timeout: 5_000 }).toBeGreaterThanOrEqual(2);
  await p2.waitForTimeout(400);
  await shot(p2, 'm3-05-jeep-destroyed');
  // The wreck disappears after 5 s.
  await expect.poll(async () => (await state(p1)).vehicles.some((v) => v.id === jeep.id), { timeout: 12_000 }).toBe(false);
  expect(errors).toEqual([]);
});
