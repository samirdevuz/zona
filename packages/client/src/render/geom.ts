import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const tmpColor = new THREE.Color();
const tmpMat = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();

/**
 * Builds one flat-shaded, vertex-coloured geometry from primitives so a whole
 * model is a single draw call (or a single InstancedMesh).
 */
export class GeoBuilder {
  private parts: THREE.BufferGeometry[] = [];
  /** Optional skin index per part (for skinned characters). */
  private skinParts: number[] = [];

  add(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, bone = -1): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    tmpEuler.set(rx, ry, rz);
    tmpQuat.setFromEuler(tmpEuler);
    tmpMat.compose(tmpPos.set(x, y, z), tmpQuat, tmpScale.set(sx, sy, sz));
    g.applyMatrix4(tmpMat);
    tmpColor.setHex(color);
    const n = g.attributes.position!.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = tmpColor.r;
      col[i * 3 + 1] = tmpColor.g;
      col[i * 3 + 2] = tmpColor.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
    this.skinParts.push(bone);
    if (g !== geo) geo.dispose();
    return this;
  }

  /** Axis-aligned box from min/max corners. */
  boxMinMax(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, bone = -1): this {
    return this.add(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), color, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0, 0, 0, 1, 1, 1, bone);
  }

  /** Box centred at (x, y, z) with full sizes. */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, bone = -1, rx = 0, ry = 0, rz = 0): this {
    return this.add(new THREE.BoxGeometry(sx, sy, sz), color, x, y, z, rx, ry, rz, 1, 1, 1, bone);
  }

  cylinder(x: number, z: number, r: number, y0: number, y1: number, color: number, segments = 7, rTop = r, bone = -1): this {
    return this.add(new THREE.CylinderGeometry(rTop, r, y1 - y0, segments, 1), color, x, (y0 + y1) / 2, z, 0, 0, 0, 1, 1, 1, bone);
  }

  cone(x: number, z: number, r: number, y0: number, y1: number, color: number, segments = 7): this {
    return this.add(new THREE.ConeGeometry(r, y1 - y0, segments, 1), color, x, (y0 + y1) / 2, z);
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    if (!merged) throw new Error('merge failed');
    if (this.skinParts.some((b) => b >= 0)) {
      const n = merged.attributes.position!.count;
      const idx = new Uint16Array(n * 4);
      const w = new Float32Array(n * 4);
      let v = 0;
      this.parts.forEach((p, i) => {
        const c = p.attributes.position!.count;
        for (let k = 0; k < c; k++, v++) {
          idx[v * 4] = Math.max(0, this.skinParts[i]!);
          w[v * 4] = 1;
        }
      });
      merged.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
      merged.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
    }
    merged.computeVertexNormals(); // non-indexed -> flat normals
    merged.computeBoundingSphere();
    for (const p of this.parts) p.dispose();
    this.parts = [];
    this.skinParts = [];
    return merged;
  }
}

/** Shared flat-shaded vertex-colour material for static world geometry. */
export function worldMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}

/** Deterministic small colour jitter per index (low-poly look). */
export function jitter(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}
