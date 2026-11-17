import type { NavGrid } from './nav';

const SQRT2 = Math.SQRT2;

/**
 * A* over the walkability grid (8-neighbour, no corner cutting) with reusable
 * buffers and a generation stamp, so repeated queries do not allocate
 * (GAME.md 9: bots navigate on the nav grid).
 */
export class PathFinder {
  private readonly g: Float32Array;
  private readonly from: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private gen = 0;
  private readonly heapIdx: Int32Array;
  private readonly heapF: Float32Array;
  private heapSize = 0;
  /** Nodes expanded by the last search (for budgets/tests). */
  expanded = 0;

  constructor(private readonly nav: NavGrid) {
    const n = nav.cols * nav.rows;
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heapIdx = new Int32Array(n);
    this.heapF = new Float32Array(n);
  }

  cellOf(x: number, z: number): number {
    const nav = this.nav;
    const c = Math.floor((x - nav.originX) / nav.cell);
    const r = Math.floor((z - nav.originZ) / nav.cell);
    if (c < 0 || r < 0 || c >= nav.cols || r >= nav.rows) return -1;
    return r * nav.cols + c;
  }

  /** Nearest walkable cell within `radius` cells, or -1. */
  nearestWalkable(x: number, z: number, radius = 4): number {
    const nav = this.nav;
    const c0 = Math.floor((x - nav.originX) / nav.cell);
    const r0 = Math.floor((z - nav.originZ) / nav.cell);
    for (let rad = 0; rad <= radius; rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          const c = c0 + dc;
          const r = r0 + dr;
          if (c < 0 || r < 0 || c >= nav.cols || r >= nav.rows) continue;
          const i = r * nav.cols + c;
          if (nav.walkable[i]) return i;
        }
      }
    }
    return -1;
  }

  private push(i: number, f: number): void {
    let k = this.heapSize++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.heapF[p]! <= f) break;
      this.heapIdx[k] = this.heapIdx[p]!;
      this.heapF[k] = this.heapF[p]!;
      k = p;
    }
    this.heapIdx[k] = i;
    this.heapF[k] = f;
  }

  private pop(): number {
    const top = this.heapIdx[0]!;
    const lastI = this.heapIdx[--this.heapSize]!;
    const lastF = this.heapF[this.heapSize]!;
    let k = 0;
    for (;;) {
      const l = 2 * k + 1;
      if (l >= this.heapSize) break;
      const r = l + 1;
      const c = r < this.heapSize && this.heapF[r]! < this.heapF[l]! ? r : l;
      if (this.heapF[c]! >= lastF) break;
      this.heapIdx[k] = this.heapIdx[c]!;
      this.heapF[k] = this.heapF[c]!;
      k = c;
    }
    this.heapIdx[k] = lastI;
    this.heapF[k] = lastF;
    return top;
  }

  /**
   * Find a path from (sx, sz) to (tx, tz). On success writes smoothed waypoints
   * as flat [x, z, ...] (excluding the start) into `out` and returns true.
   */
  find(sx: number, sz: number, tx: number, tz: number, maxNodes: number, out: number[]): boolean {
    out.length = 0;
    const nav = this.nav;
    const start = this.nearestWalkable(sx, sz);
    const goal = this.nearestWalkable(tx, tz);
    this.expanded = 0;
    if (start < 0 || goal < 0) return false;
    this.gen = (this.gen + 1) >>> 0;
    if (this.gen === 0) {
      this.stamp.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    const cols = nav.cols;
    const gc = goal % cols;
    const gr = (goal - gc) / cols;
    const h = (i: number): number => {
      const c = i % cols;
      const r = (i - c) / cols;
      const dx = Math.abs(c - gc);
      const dz = Math.abs(r - gr);
      return dx + dz + (SQRT2 - 2) * Math.min(dx, dz);
    };
    this.heapSize = 0;
    this.g[start] = 0;
    this.from[start] = -1;
    this.stamp[start] = gen;
    this.push(start, h(start));
    let found = false;
    while (this.heapSize > 0) {
      const cur = this.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goal) {
        found = true;
        break;
      }
      if (++this.expanded > maxNodes) break;
      const c = cur % cols;
      const r = (cur - c) / cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= nav.rows) continue;
          const ni = nr * cols + nc;
          if (!nav.walkable[ni] || this.closed[ni] === gen) continue;
          // No corner cutting.
          if (dr !== 0 && dc !== 0 && (!nav.walkable[r * cols + nc] || !nav.walkable[nr * cols + c])) continue;
          const ng = this.g[cur]! + (dr !== 0 && dc !== 0 ? SQRT2 : 1);
          if (this.stamp[ni] === gen && ng >= this.g[ni]!) continue;
          this.stamp[ni] = gen;
          this.g[ni] = ng;
          this.from[ni] = cur;
          this.push(ni, ng + h(ni));
        }
      }
    }
    if (!found) return false;
    // Collect cells goal -> start.
    const cells: number[] = [];
    for (let i = goal; i >= 0; i = this.from[i]!) cells.push(i);
    cells.reverse();
    // String pulling: keep a waypoint only when the straight line to the next one is blocked.
    let anchor = 0;
    for (let k = 2; k <= cells.length; k++) {
      if (k === cells.length || !this.lineWalkable(cells[anchor]!, cells[k]!)) {
        const keep = cells[k - 1]!;
        if (keep !== cells[0]) {
          out.push(nav.originX + ((keep % cols) + 0.5) * nav.cell, nav.originZ + (Math.floor(keep / cols) + 0.5) * nav.cell);
        }
        anchor = k - 1;
      }
    }
    if (out.length === 0) out.push(tx, tz);
    else {
      // Finish at the exact target point (it is within the goal cell's neighbourhood).
      out[out.length - 2] = tx;
      out[out.length - 1] = tz;
    }
    return true;
  }

  /** All cells along the segment between two cell centres are walkable (half-cell steps). */
  lineWalkable(a: number, b: number): boolean {
    const nav = this.nav;
    const cols = nav.cols;
    const ac = a % cols;
    const ar = (a - ac) / cols;
    const bc = b % cols;
    const br = (b - bc) / cols;
    const steps = Math.max(Math.abs(bc - ac), Math.abs(br - ar)) * 2;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const c = Math.round(ac + (bc - ac) * t);
      const r = Math.round(ar + (br - ar) * t);
      if (!nav.walkable[r * cols + c]) return false;
      // Also check the neighbours the line brushes past diagonally.
      const c2 = Math.floor(ac + (bc - ac) * t + 0.5 * Math.sign(bc - ac));
      const r2 = Math.floor(ar + (br - ar) * t + 0.5 * Math.sign(br - ar));
      if (c2 >= 0 && c2 < cols && !nav.walkable[r * cols + c2]) return false;
      if (r2 >= 0 && r2 < nav.rows && !nav.walkable[r2 * cols + c]) return false;
    }
    return true;
  }
}
