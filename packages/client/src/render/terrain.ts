import * as THREE from 'three';
import { MAP, ZONES, smoothstep, type MapData, type Terrain } from '@zona/shared';
import { jitter } from './geom';

import { THEMES, type ThemePalette } from './theme';

const C = (hex: number): THREE.Color => new THREE.Color().setHex(hex);

function segDist(px: number, pz: number, x0: number, z0: number, x1: number, z1: number): number {
  const vx = x1 - x0;
  const vz = z1 - z0;
  const l2 = vx * vx + vz * vz;
  let t = l2 > 0 ? ((px - x0) * vx + (pz - z0) * vz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (x0 + vx * t);
  const dz = pz - (z0 + vz * t);
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Terrain as flat-shaded chunks with per-face vertex colours (GAME.md 7).
 * Triangle split matches shared Terrain.heightAt: diagonal (c,r)-(c+1,r+1).
 */
export function buildTerrain(map: MapData, terrain: Terrain, receiveShadow: boolean, pal: ThemePalette = THEMES.summer): THREE.Group {
  const GRASS_LO = C(pal.grassLo);
  const GRASS_HI = C(pal.grassHi);
  const DRY = C(pal.dry);
  const DIRT = C(pal.dirt);
  const ROAD = C(pal.road);
  const ROCK = C(pal.rock);
  const ZONE = C(pal.zone);
  const RIDGE = C(pal.ridge);
  const group = new THREE.Group();
  group.name = 'terrain';
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const cells = terrain.cols - 1;
  const chunk = MAP.chunkCells;
  const cell = terrain.cell;
  const col = new THREE.Color();
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const R = map.radius;

  const faceColor = (cx: number, cz: number, ny: number, h: number, seed: number): THREE.Color => {
    const slope = 1 - ny; // 0 flat .. 0.29 at 45 deg
    const t = smoothstep(-4, 10, h);
    col.copy(GRASS_LO).lerp(GRASS_HI, t);
    const dryness = 0.5 + 0.5 * jitter(Math.floor(cx / 21) * 7919 + Math.floor(cz / 21) * 104729);
    col.lerp(DRY, dryness * 0.35);
    let road = Infinity;
    for (const r of map.roads) road = Math.min(road, segDist(cx, cz, r.x0, r.z0, r.x1, r.z1));
    if (road < MAP.roadHalfWidth + 1.5) col.lerp(ROAD, 1 - smoothstep(MAP.roadHalfWidth - 0.5, MAP.roadHalfWidth + 1.5, road));
    let zd = Infinity;
    for (const z of map.zones) zd = Math.min(zd, Math.hypot(cx - z.x, cz - z.z));
    if (zd < ZONES.captureRadius + 2) col.lerp(ZONE, 0.55 * (1 - smoothstep(ZONES.captureRadius - 3, ZONES.captureRadius + 2, zd)));
    else if (zd < ZONES.flattenRadius + 4) col.lerp(DIRT, 0.18);
    const rr = Math.hypot(cx, cz);
    if (rr > R) col.lerp(RIDGE, smoothstep(R, R + 30, rr) * 0.6);
    if (slope > 0.12) col.lerp(ROCK, smoothstep(0.12, 0.3, slope));
    const j = 1 + jitter(seed) * 0.045;
    col.r *= j;
    col.g *= j;
    col.b *= j;
    return col;
  };

  for (let cz0 = 0; cz0 < cells; cz0 += chunk) {
    for (let cx0 = 0; cx0 < cells; cx0 += chunk) {
      const cw = Math.min(chunk, cells - cx0);
      const ch = Math.min(chunk, cells - cz0);
      const tris = cw * ch * 2;
      const pos = new Float32Array(tris * 9);
      const nor = new Float32Array(tris * 9);
      const cols = new Float32Array(tris * 9);
      let o = 0;
      const emit = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, seed: number): void => {
        e1.subVectors(b, a);
        e2.subVectors(c, a);
        nrm.crossVectors(e1, e2).normalize();
        const cx = (a.x + b.x + c.x) / 3;
        const cz = (a.z + b.z + c.z) / 3;
        const h = (a.y + b.y + c.y) / 3;
        const fc = faceColor(cx, cz, nrm.y, h, seed);
        for (const v of [a, b, c]) {
          pos[o] = v.x;
          pos[o + 1] = v.y;
          pos[o + 2] = v.z;
          nor[o] = nrm.x;
          nor[o + 1] = nrm.y;
          nor[o + 2] = nrm.z;
          cols[o] = fc.r;
          cols[o + 1] = fc.g;
          cols[o + 2] = fc.b;
          o += 3;
        }
      };
      for (let r = cz0; r < cz0 + ch; r++) {
        for (let c = cx0; c < cx0 + cw; c++) {
          const x0 = terrain.originX + c * cell;
          const z0 = terrain.originZ + r * cell;
          const v00 = p[0]!.set(x0, terrain.vertexHeight(c, r), z0);
          const v11 = p[1]!.set(x0 + cell, terrain.vertexHeight(c + 1, r + 1), z0 + cell);
          const v10 = p[2]!.set(x0 + cell, terrain.vertexHeight(c + 1, r), z0);
          emit(v00, v11, v10, r * 100003 + c * 2);
          const v01 = p[2]!.set(x0, terrain.vertexHeight(c, r + 1), z0 + cell);
          emit(v00, v01, v11, r * 100003 + c * 2 + 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = receiveShadow;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }

  // Far skirt so the horizon never shows the heightfield edge.
  const edgeH = terrain.vertexHeight(0, 0);
  const half = (terrain.cols - 1) * cell * 0.5;
  const skirt = new THREE.Mesh(
    new THREE.RingGeometry(half - 12, 3000, 48, 1),
    new THREE.MeshLambertMaterial({ color: RIDGE.clone().multiplyScalar(0.9) }),
  );
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.y = edgeH - 0.3;
  skirt.updateMatrix();
  skirt.matrixAutoUpdate = false;
  group.add(skirt);
  return group;
}
