import { expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '../../test-results/e2e-shots');
mkdirSync(SHOTS, { recursive: true });

export interface ZState {
  phase: string;
  inMatch: boolean;
  myId: number;
  team: number;
  alive: boolean;
  hp: number;
  pos: { x: number; y: number; z: number } | null;
  yaw: number;
  pitch: number;
  remotes: { id: number; x: number; y: number; z: number; alive: boolean }[];
  zones: { owner: number; contested: boolean; control: number[] }[];
  zoneDefs: { x: number; y: number; z: number; homeTeam: number }[];
  spawnVisible: boolean;
  classId: string | null;
  slot: number;
  mags: number[];
  booms: { x: number; z: number }[];
  mode: number;
  cameraMode: string;
  localBodyVisible: boolean;
  aim: { yaw: number; pitch: number };
  myVehicle: number;
  vehicles: { id: number; kind: string; x: number; y: number; z: number; visible: boolean }[];
  scores: number[];
  kills: { killer: number; victim: number; w: number }[];
  captures: { zone: number; team: number }[];
  result: { winner: number; reason: string } | null;
  lobbyPhase: string | null;
  drawCalls: number;
  audioSamples: number;
  triangles: number;
  corrections: { count: number; max: number; sum: number };
}

export const state = (p: Page): Promise<ZState> => p.evaluate(() => (window as unknown as { __zona: { state(): ZState } }).__zona.state());
export const call = (p: Page, fn: string, ...args: unknown[]): Promise<void> =>
  p.evaluate(([f, a]) => (window as unknown as { __zona: Record<string, (...x: unknown[]) => void> }).__zona[f as string]!(...(a as unknown[])), [fn, args] as const);
export const shot = (p: Page, name: string): Promise<Buffer> => p.screenshot({ path: join(SHOTS, `${name}.png`) });

export async function openPlayer(browser: Browser, name: string, errors: string[]): Promise<Page> {
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

/** Close every browser context a test opened, so its pages cannot reconnect into the next test. */
export const closeAll = async (browser: Browser): Promise<void> => {
  await Promise.all(browser.contexts().map((c) => c.close()));
};
