import { MAP } from '../config/map';
import { MOVEMENT } from '../config/movement';
import { COLLIDER_BOX, type Collider } from './types';
import type { World } from './world';

/** Walkability grid used by bots (M4) and the map validator (GAME.md 7.8). */
export interface NavGrid {
  cell: number;
  cols: number;
  rows: number;
  originX: number;
  originZ: number;
  /** 1 = walkable. Index = row * cols + col. */
  walkable: Uint8Array;
}

/** True if a vertical player cylinder at (x, z) standing at groundY overlaps a blocking collider. */
export function blockedAt(world: World, x: number, z: number, groundY: number, radius: number, scratch: number[]): boolean {
  const n = world.query(x - radius, z - radius, x + radius, z + radius, scratch);
  const lo = groundY + MOVEMENT.stepHeight;
  const hi = groundY + MOVEMENT.height;
  for (let i = 0; i < n; i++) {
    const c = world.colliders[scratch[i]!]!;
    if (c.maxY <= lo || c.minY >= hi) continue;
    if (circleOverlapsCollider(c, x, z, radius)) return true;
  }
  return false;
}

export function circleOverlapsCollider(c: Collider, x: number, z: number, r: number): boolean {
  if (c.kind === COLLIDER_BOX) {
    const nx = x < c.minX ? c.minX : x > c.maxX ? c.maxX : x;
    const nz = z < c.minZ ? c.minZ : z > c.maxZ ? c.maxZ : z;
    const dx = x - nx;
    const dz = z - nz;
    return dx * dx + dz * dz < r * r;
  }
  const dx = x - c.cx;
  const dz = z - c.cz;
  const rr = r + c.r;
  return dx * dx + dz * dz < rr * rr;
}

const MAX_SLOPE_TAN = Math.tan((MOVEMENT.maxSlopeDeg * Math.PI) / 180);

export function buildNavGrid(world: World): NavGrid {
  const cell = MAP.navCell;
  const extent = world.radius + 6;
  const n = Math.ceil(extent / cell);
  const cols = 2 * n;
  const originX = -n * cell;
  const originZ = -n * cell;
  const walkable = new Uint8Array(cols * cols);
  const scratch: number[] = [];
  const g = { gx: 0, gz: 0 };
  const half = cell / 2;
  for (let row = 0; row < cols; row++) {
    for (let col = 0; col < cols; col++) {
      const x = originX + (col + 0.5) * cell;
      const z = originZ + (row + 0.5) * cell;
      if (x * x + z * z > extent * extent) continue;
      let ok = true;
      for (const [ox, oz] of [
        [0, 0],
        [-half * 0.7, -half * 0.7],
        [half * 0.7, half * 0.7],
      ] as const) {
        world.terrain.gradientAt(x + ox, z + oz, g);
        if (g.gx * g.gx + g.gz * g.gz > MAX_SLOPE_TAN * MAX_SLOPE_TAN) ok = false;
      }
      if (!ok) continue;
      const y = world.terrain.heightAt(x, z);
      if (blockedAt(world, x, z, y, MOVEMENT.radius, scratch)) continue;
      walkable[row * cols + col] = 1;
    }
  }
  return { cell, cols, rows: cols, originX, originZ, walkable };
}

export function navCellOf(nav: NavGrid, x: number, z: number): number {
  const col = Math.floor((x - nav.originX) / nav.cell);
  const row = Math.floor((z - nav.originZ) / nav.cell);
  if (col < 0 || row < 0 || col >= nav.cols || row >= nav.rows) return -1;
  return row * nav.cols + col;
}

/** Nearest walkable cell within `maxRadius` cells of (x, z), or -1. */
export function nearestWalkable(nav: NavGrid, x: number, z: number, maxRadius = 3): number {
  const c0 = navCellOf(nav, x, z);
  if (c0 >= 0 && nav.walkable[c0]) return c0;
  const col0 = Math.floor((x - nav.originX) / nav.cell);
  const row0 = Math.floor((z - nav.originZ) / nav.cell);
  for (let r = 1; r <= maxRadius; r++) {
    for (let dr = -r; dr <= r; dr++) {
      for (let dc = -r; dc <= r; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== r) continue;
        const row = row0 + dr;
        const col = col0 + dc;
        if (col < 0 || row < 0 || col >= nav.cols || row >= nav.rows) continue;
        const idx = row * nav.cols + col;
        if (nav.walkable[idx]) return idx;
      }
    }
  }
  return -1;
}

/** Flood fill from a cell (4-neighbourhood). Returns a visited mask. */
export function floodFill(nav: NavGrid, start: number): Uint8Array {
  const seen = new Uint8Array(nav.walkable.length);
  if (start < 0 || !nav.walkable[start]) return seen;
  const queue = new Int32Array(nav.walkable.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  seen[start] = 1;
  while (head < tail) {
    const idx = queue[head++]!;
    const row = Math.floor(idx / nav.cols);
    const col = idx - row * nav.cols;
    const tryCell = (r: number, c: number): void => {
      if (r < 0 || c < 0 || r >= nav.rows || c >= nav.cols) return;
      const j = r * nav.cols + c;
      if (seen[j] || !nav.walkable[j]) return;
      seen[j] = 1;
      queue[tail++] = j;
    };
    tryCell(row - 1, col);
    tryCell(row + 1, col);
    tryCell(row, col - 1);
    tryCell(row, col + 1);
  }
  return seen;
}
