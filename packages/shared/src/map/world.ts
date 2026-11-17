import { MAP } from '../config/map';
import { MOVEMENT } from '../config/movement';
import { Terrain } from './heightfield';
import { FLAG_POLE, buildColliders, makeCollider } from './props';
import { COLLIDER_BOX, COLLIDER_CYL, type Collider, type MapData } from './types';

/** Static world used by the simulation: terrain + colliders in a uniform grid (GAME.md 3.4). */
export class World {
  readonly map: MapData;
  readonly terrain: Terrain;
  readonly colliders: Collider[];
  readonly radius: number;
  /** Hard clamp for positions (inside the heightfield). */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly maxTerrainY: number;

  private readonly gCell: number;
  private readonly gCols: number;
  private readonly gRows: number;
  private readonly gOriginX: number;
  private readonly gOriginZ: number;
  private readonly cellStart: Int32Array;
  private readonly cellItems: Int32Array;
  private readonly stamp: Uint32Array;
  private stampId = 0;

  constructor(map: MapData) {
    this.map = map;
    this.terrain = new Terrain(map.terrain);
    this.radius = map.radius;
    this.colliders = buildWorldColliders(map);
    const m = MOVEMENT.worldEdgeMargin;
    this.minX = this.terrain.originX + m;
    this.maxX = this.terrain.maxX - m;
    this.minZ = this.terrain.originZ + m;
    this.maxZ = this.terrain.maxZ - m;
    let maxY = -Infinity;
    for (let i = 0; i < this.terrain.h.length; i++) if (this.terrain.h[i]! > maxY) maxY = this.terrain.h[i]!;
    this.maxTerrainY = maxY;

    this.gCell = MAP.colliderGridCell;
    this.gOriginX = this.terrain.originX;
    this.gOriginZ = this.terrain.originZ;
    this.gCols = Math.ceil((this.terrain.maxX - this.gOriginX) / this.gCell) + 1;
    this.gRows = Math.ceil((this.terrain.maxZ - this.gOriginZ) / this.gCell) + 1;
    const n = this.gCols * this.gRows;
    const counts = new Int32Array(n + 1);
    const forEachCell = (c: Collider, fn: (cell: number) => void): void => {
      const x0 = this.cellX(c.minX);
      const x1 = this.cellX(c.maxX);
      const z0 = this.cellZ(c.minZ);
      const z1 = this.cellZ(c.maxZ);
      for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) fn(gz * this.gCols + gx);
    };
    for (const c of this.colliders) forEachCell(c, (cell) => counts[cell + 1]!++);
    for (let i = 0; i < n; i++) counts[i + 1]! += counts[i]!;
    this.cellStart = counts;
    this.cellItems = new Int32Array(counts[n]!);
    const fill = new Int32Array(n);
    this.colliders.forEach((c, idx) =>
      forEachCell(c, (cell) => {
        this.cellItems[counts[cell]! + fill[cell]!++] = idx;
      }),
    );
    this.stamp = new Uint32Array(this.colliders.length);
  }

  private cellX(x: number): number {
    const g = Math.floor((x - this.gOriginX) / this.gCell);
    return g < 0 ? 0 : g >= this.gCols ? this.gCols - 1 : g;
  }
  private cellZ(z: number): number {
    const g = Math.floor((z - this.gOriginZ) / this.gCell);
    return g < 0 ? 0 : g >= this.gRows ? this.gRows - 1 : g;
  }

  /**
   * Collect indices of colliders whose XZ bounds overlap the rectangle into `out`
   * (cleared first). Returns the count.
   */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: number[]): number {
    out.length = 0;
    const id = this.nextStamp();
    const x0 = this.cellX(minX);
    const x1 = this.cellX(maxX);
    const z0 = this.cellZ(minZ);
    const z1 = this.cellZ(maxZ);
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const cell = gz * this.gCols + gx;
        for (let k = this.cellStart[cell]!; k < this.cellStart[cell + 1]!; k++) {
          const idx = this.cellItems[k]!;
          if (this.stamp[idx] === id) continue;
          this.stamp[idx] = id;
          const c = this.colliders[idx]!;
          if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
          out.push(idx);
        }
      }
    }
    return out.length;
  }

  private nextStamp(): number {
    this.stampId = (this.stampId + 1) >>> 0;
    if (this.stampId === 0) {
      this.stamp.fill(0);
      this.stampId = 1;
    }
    return this.stampId;
  }

  /**
   * Distance along a normalised ray to the first static hit (terrain or collider),
   * or Infinity when nothing is hit within maxDist.
   */
  raycastStatic(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number {
    const tc = this.raycastColliders(ox, oy, oz, dx, dy, dz, maxDist);
    const tt = this.raycastTerrain(ox, oy, oz, dx, dy, dz, Math.min(maxDist, tc));
    return Math.min(tc, tt);
  }

  /** Index of the collider hit by the last raycastColliders call (-1 if none). */
  lastHitCollider = -1;
  private readonly gradScratch = { gx: 0, gz: 0 };

  /**
   * Like raycastStatic but also writes the surface normal of the hit into `n`.
   * Returns Infinity (and leaves `n` untouched) when nothing is hit.
   */
  raycastStaticNormal(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, n: { x: number; y: number; z: number }): number {
    const tc = this.raycastColliders(ox, oy, oz, dx, dy, dz, maxDist);
    const ci = this.lastHitCollider;
    const tt = this.raycastTerrain(ox, oy, oz, dx, dy, dz, Math.min(maxDist, tc));
    if (tt === Infinity && tc === Infinity) return Infinity;
    if (tt <= tc) {
      const hx = ox + dx * tt;
      const hz = oz + dz * tt;
      this.terrain.gradientAt(hx, hz, this.gradScratch);
      const l = Math.sqrt(this.gradScratch.gx * this.gradScratch.gx + 1 + this.gradScratch.gz * this.gradScratch.gz);
      n.x = -this.gradScratch.gx / l;
      n.y = 1 / l;
      n.z = -this.gradScratch.gz / l;
      return tt;
    }
    const c = this.colliders[ci]!;
    const hx = ox + dx * tc;
    const hy = oy + dy * tc;
    const hz = oz + dz * tc;
    colliderNormal(c, hx, hy, hz, n);
    return tc;
  }

  raycastColliders(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number {
    // 2D DDA over the collider grid (Amanatides & Woo).
    const id = this.nextStamp();
    let best = Infinity;
    this.lastHitCollider = -1;
    const cell = this.gCell;
    let gx = Math.floor((ox - this.gOriginX) / cell);
    let gz = Math.floor((oz - this.gOriginZ) / cell);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDeltaX = stepX !== 0 ? cell / Math.abs(dx) : Infinity;
    const tDeltaZ = stepZ !== 0 ? cell / Math.abs(dz) : Infinity;
    const nextBX = this.gOriginX + (gx + (stepX > 0 ? 1 : 0)) * cell;
    const nextBZ = this.gOriginZ + (gz + (stepZ > 0 ? 1 : 0)) * cell;
    let tMaxX = stepX !== 0 ? (nextBX - ox) / dx : Infinity;
    let tMaxZ = stepZ !== 0 ? (nextBZ - oz) / dz : Infinity;
    let tCell = 0;
    for (let iter = 0; iter < 4096; iter++) {
      if (gx >= 0 && gz >= 0 && gx < this.gCols && gz < this.gRows) {
        const c = gz * this.gCols + gx;
        for (let k = this.cellStart[c]!; k < this.cellStart[c + 1]!; k++) {
          const idx = this.cellItems[k]!;
          if (this.stamp[idx] === id) continue;
          this.stamp[idx] = id;
          const t = rayCollider(this.colliders[idx]!, ox, oy, oz, dx, dy, dz);
          if (t < best) {
            best = t;
            this.lastHitCollider = idx;
          }
        }
      } else if ((gx < 0 && stepX <= 0) || (gz < 0 && stepZ <= 0) || (gx >= this.gCols && stepX >= 0) || (gz >= this.gRows && stepZ >= 0)) {
        break;
      }
      const tNext = Math.min(tMaxX, tMaxZ);
      if (best <= tNext || tCell > maxDist) break;
      tCell = tNext;
      if (tMaxX < tMaxZ) {
        gx += stepX;
        tMaxX += tDeltaX;
      } else {
        gz += stepZ;
        tMaxZ += tDeltaZ;
      }
      if (tNext === Infinity) break;
    }
    return best <= maxDist ? best : Infinity;
  }

  raycastTerrain(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number {
    const step = this.terrain.cell * 0.5;
    let prevT = 0;
    let prevAbove = oy - this.terrain.heightAt(ox, oz);
    if (prevAbove < 0) return 0;
    const limit = Math.min(maxDist, 2000);
    for (let t = step; ; t += step) {
      const tt = t > limit ? limit : t;
      const y = oy + dy * tt;
      if (y > this.maxTerrainY + 0.01 && dy >= 0) return Infinity;
      const above = y - this.terrain.heightAt(ox + dx * tt, oz + dz * tt);
      if (above < 0) {
        // Refine by bisection.
        let lo = prevT;
        let hi = tt;
        for (let i = 0; i < 14; i++) {
          const mid = (lo + hi) * 0.5;
          const my = oy + dy * mid - this.terrain.heightAt(ox + dx * mid, oz + dz * mid);
          if (my < 0) hi = mid;
          else lo = mid;
        }
        return hi;
      }
      prevT = tt;
      prevAbove = above;
      if (tt >= limit) return Infinity;
    }
  }
}

/** Outward normal of a collider surface at a point on (or very near) it. */
export function colliderNormal(c: Collider, x: number, y: number, z: number, n: { x: number; y: number; z: number }): void {
  const eps = 0.02;
  if (y >= c.maxY - eps) {
    n.x = 0;
    n.y = 1;
    n.z = 0;
    return;
  }
  if (y <= c.minY + eps) {
    n.x = 0;
    n.y = -1;
    n.z = 0;
    return;
  }
  if (c.kind === COLLIDER_BOX) {
    const dxm = Math.abs(x - c.minX);
    const dxp = Math.abs(x - c.maxX);
    const dzm = Math.abs(z - c.minZ);
    const dzp = Math.abs(z - c.maxZ);
    const m = Math.min(dxm, dxp, dzm, dzp);
    n.y = 0;
    n.x = m === dxm ? -1 : m === dxp ? 1 : 0;
    n.z = n.x !== 0 ? 0 : m === dzm ? -1 : 1;
    return;
  }
  const dx = x - c.cx;
  const dz = z - c.cz;
  const l = Math.sqrt(dx * dx + dz * dz) || 1;
  n.x = dx / l;
  n.y = 0;
  n.z = dz / l;
}

/** Ray vs a static collider. Returns hit distance or Infinity. Direction must be normalised. */
export function rayCollider(c: Collider, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
  let tmin = 0;
  let tmax = Infinity;
  // Y slab (both shapes).
  if (Math.abs(dy) < 1e-12) {
    if (oy < c.minY || oy > c.maxY) return Infinity;
  } else {
    let t1 = (c.minY - oy) / dy;
    let t2 = (c.maxY - oy) / dy;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  if (c.kind === COLLIDER_BOX) {
    if (Math.abs(dx) < 1e-12) {
      if (ox < c.minX || ox > c.maxX) return Infinity;
    } else {
      let t1 = (c.minX - ox) / dx;
      let t2 = (c.maxX - ox) / dx;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
    if (Math.abs(dz) < 1e-12) {
      if (oz < c.minZ || oz > c.maxZ) return Infinity;
    } else {
      let t1 = (c.minZ - oz) / dz;
      let t2 = (c.maxZ - oz) / dz;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
    return tmin;
  }
  // Vertical cylinder: circle in XZ.
  const px = ox - c.cx;
  const pz = oz - c.cz;
  const a = dx * dx + dz * dz;
  const cc = px * px + pz * pz - c.r * c.r;
  if (a < 1e-12) {
    if (cc > 0) return Infinity;
    return tmin;
  }
  const b = px * dx + pz * dz;
  const disc = b * b - a * cc;
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / a;
  const t2 = (-b + sq) / a;
  if (t1 > tmin) tmin = t1;
  if (t2 < tmax) tmax = t2;
  if (tmin > tmax) return Infinity;
  return tmin;
}

export function buildWorldColliders(map: MapData): Collider[] {
  const cols = buildColliders(map.props);
  for (const z of map.zones) {
    const c = makeCollider();
    c.kind = COLLIDER_CYL;
    c.cx = z.x;
    c.cz = z.z;
    c.r = FLAG_POLE.radius;
    c.minX = z.x - c.r;
    c.maxX = z.x + c.r;
    c.minZ = z.z - c.r;
    c.maxZ = z.z + c.r;
    c.minY = z.y - 0.5;
    c.maxY = z.y + FLAG_POLE.height;
    cols.push(c);
  }
  return cols;
}
