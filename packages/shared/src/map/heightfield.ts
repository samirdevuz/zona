import type { Heightfield } from './types';

/**
 * Terrain sampling. Each grid cell is split into two triangles along the
 * (col,row)-(col+1,row+1) diagonal; the renderer uses the same split so the
 * collision surface matches what players see.
 */
export class Terrain {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly originX: number;
  readonly originZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  /** Heights in metres. */
  readonly h: Float64Array;

  constructor(hf: Heightfield) {
    this.cell = hf.cell;
    this.cols = hf.cols;
    this.rows = hf.rows;
    this.originX = hf.originX;
    this.originZ = hf.originZ;
    this.maxX = hf.originX + (hf.cols - 1) * hf.cell;
    this.maxZ = hf.originZ + (hf.rows - 1) * hf.cell;
    this.h = new Float64Array(hf.heightsCm.length);
    for (let i = 0; i < hf.heightsCm.length; i++) this.h[i] = hf.heightsCm[i]! * 0.01;
  }

  vertexHeight(col: number, row: number): number {
    return this.h[row * this.cols + col]!;
  }

  heightAt(x: number, z: number): number {
    let gx = (x - this.originX) / this.cell;
    let gz = (z - this.originZ) / this.cell;
    const maxC = this.cols - 1;
    const maxR = this.rows - 1;
    if (gx < 0) gx = 0;
    else if (gx > maxC) gx = maxC;
    if (gz < 0) gz = 0;
    else if (gz > maxR) gz = maxR;
    let ix = Math.floor(gx);
    let iz = Math.floor(gz);
    if (ix >= maxC) ix = maxC - 1;
    if (iz >= maxR) iz = maxR - 1;
    const fx = gx - ix;
    const fz = gz - iz;
    const i00 = iz * this.cols + ix;
    const h00 = this.h[i00]!;
    const h11 = this.h[i00 + this.cols + 1]!;
    if (fx > fz) {
      const h10 = this.h[i00 + 1]!;
      return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
    }
    const h01 = this.h[i00 + this.cols]!;
    return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  }

  /**
   * Height gradient (dh/dx, dh/dz) at a point, written to out[0], out[1].
   * Slope angle = atan(sqrt(gx^2 + gz^2)).
   */
  gradientAt(x: number, z: number, out: { gx: number; gz: number }): void {
    let gx = (x - this.originX) / this.cell;
    let gz = (z - this.originZ) / this.cell;
    const maxC = this.cols - 1;
    const maxR = this.rows - 1;
    if (gx < 0) gx = 0;
    else if (gx > maxC) gx = maxC;
    if (gz < 0) gz = 0;
    else if (gz > maxR) gz = maxR;
    let ix = Math.floor(gx);
    let iz = Math.floor(gz);
    if (ix >= maxC) ix = maxC - 1;
    if (iz >= maxR) iz = maxR - 1;
    const fx = gx - ix;
    const fz = gz - iz;
    const i00 = iz * this.cols + ix;
    const h00 = this.h[i00]!;
    const h11 = this.h[i00 + this.cols + 1]!;
    if (fx > fz) {
      const h10 = this.h[i00 + 1]!;
      out.gx = (h10 - h00) / this.cell;
      out.gz = (h11 - h10) / this.cell;
    } else {
      const h01 = this.h[i00 + this.cols]!;
      out.gx = (h11 - h01) / this.cell;
      out.gz = (h01 - h00) / this.cell;
    }
  }

  inside(x: number, z: number): boolean {
    return x >= this.originX && x <= this.maxX && z >= this.originZ && z <= this.maxZ;
  }
}
