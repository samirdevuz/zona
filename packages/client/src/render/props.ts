import * as THREE from 'three';
import { BUNKER, PROP_DEFS, TOWER, type MapData, type PropType } from '@zona/shared';
import { GeoBuilder, jitter } from './geom';

const WOOD = 0x8b6a45;
const WOOD_DARK = 0x6d5236;
const CONCRETE = 0xa9a49a;
const CONCRETE_DARK = 0x8f8a80;
const BARK = 0x6b4f35;
const PINE = 0x2f5d34;
const LEAF = 0x4f8a3a;
const ROCKC = 0x8d8a84;
const SAND = 0xb7a171;
const WHITE = 0xffffff;

/** Container paint colours by variant (instance colour multiplies a white base). */
const CONTAINER_COLORS = [0xb5463a, 0x3d6fa8, 0x4f8a52, 0xc98a2e];

/** Visual models matching the collision shapes in shared/map/props.ts. */
function buildPropGeometry(type: PropType): THREE.BufferGeometry {
  const b = new GeoBuilder();
  switch (type) {
    case 'pine':
      b.cylinder(0, 0, 0.3, 0, 2.4, BARK, 6, 0.22);
      b.cone(0, 0, 2.3, 1.6, 4.6, PINE, 7);
      b.cone(0, 0, 1.8, 3.3, 6.2, PINE, 7);
      b.cone(0, 0, 1.15, 4.9, 7.7, PINE, 7);
      break;
    case 'tree':
      b.cylinder(0, 0, 0.35, 0, 3.4, BARK, 6, 0.26);
      b.add(new THREE.IcosahedronGeometry(2.4, 0), LEAF, 0, 4.4, 0);
      b.add(new THREE.IcosahedronGeometry(1.7, 0), LEAF, 0.6, 5.7, -0.4, 0.4, 0.3, 0);
      break;
    case 'rock':
      b.add(new THREE.DodecahedronGeometry(1.15, 0), ROCKC, 0, 0.25, 0, 0.3, 0.5, 0, 1, 0.68, 1);
      break;
    case 'boulder':
      b.add(new THREE.IcosahedronGeometry(2.3, 0), ROCKC, 0, 0.95, 0, 0.2, 0.7, 0.1, 1, 0.82, 1);
      break;
    case 'container': {
      const hx = 3.05;
      const hz = 1.22;
      b.boxMinMax(-hx, 0, -hz, hx, 2.6, hz, WHITE);
      // Ribs and frame (slightly outside the main box, darker).
      for (let i = -5; i <= 5; i++) b.box(i * 0.55, 1.3, 0, 0.08, 2.5, hz * 2 + 0.06, 0xd8d8d8);
      b.boxMinMax(-hx - 0.04, 2.5, -hz - 0.04, hx + 0.04, 2.62, hz + 0.04, 0x9a9a9a);
      b.boxMinMax(-hx - 0.04, 0, -hz - 0.04, hx + 0.04, 0.12, hz + 0.04, 0x9a9a9a);
      break;
    }
    case 'barrier':
      b.boxMinMax(-1.5, 0, -0.35, 1.5, 0.45, 0.35, CONCRETE);
      b.boxMinMax(-1.5, 0.45, -0.25, 1.5, 1.05, 0.25, CONCRETE);
      b.boxMinMax(-1.45, 0.95, -0.27, 1.45, 1.0, 0.27, 0xd9c84a); // paint stripe
      break;
    case 'sandbags':
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 4; i++) {
          const off = row === 1 ? 0.2 : 0;
          const x0 = -1.6 + i * 0.8 + off * (i === 3 ? 0 : 1);
          const x1 = Math.min(1.6, x0 + 0.76);
          const shade = (row + i) % 2 === 0 ? SAND : 0xa8925f;
          b.boxMinMax(x0, row * 0.475, -0.5, x1, row * 0.475 + 0.47, 0.5, shade);
        }
      }
      break;
    case 'ruin':
      b.boxMinMax(-3, 0, -0.3, -1, 2.8, 0.3, CONCRETE_DARK);
      b.boxMinMax(1, 0, -0.3, 3, 2.8, 0.3, CONCRETE_DARK);
      b.boxMinMax(-1, 0, -0.3, 1, 0.9, 0.3, CONCRETE);
      b.boxMinMax(-2.9, 2.8, -0.25, -1.6, 3.0, 0.25, CONCRETE); // broken top bits (inside pillar footprint)
      b.boxMinMax(1.3, 2.8, -0.25, 2.2, 2.95, 0.25, CONCRETE);
      break;
    case 'tower':
      buildTower(b);
      break;
    case 'bunker':
      buildBunker(b);
      break;
  }
  return b.build();
}

function buildTower(b: GeoBuilder): void {
  const t = TOWER;
  const p = t.platformHalf;
  const top = t.platformTop;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cylinder(sx * (p - 0.2), sz * (p - 0.2), 0.18, 0, top - t.platformThickness, WOOD_DARK, 6);
  b.boxMinMax(-p, top - t.platformThickness, -p, p, top, p, WOOD);
  const ph = top + t.parapetHeight;
  const th = t.parapetThickness;
  b.boxMinMax(-p, top, p - th, p, ph, p, WOOD_DARK);
  b.boxMinMax(-p, top, -p, -p + th, ph, p, WOOD_DARK);
  b.boxMinMax(p - th, top, -p, p, ph, p, WOOD_DARK);
  b.boxMinMax(-p, top, -p, -t.stairHalfWidth, ph, -p + th, WOOD_DARK);
  b.boxMinMax(t.stairHalfWidth, top, -p, p, ph, -p + th, WOOD_DARK);
  for (let k = 1; k <= t.stepCount; k++) {
    const zFar = -p - (t.stepCount - k + 1) * t.stepDepth;
    b.boxMinMax(-t.stairHalfWidth, 0, zFar, t.stairHalfWidth, k * t.stepRise, zFar + t.stepDepth, k % 2 ? WOOD : WOOD_DARK);
  }
  b.boxMinMax(-p - 0.2, t.roofY, -p - 0.2, p + 0.2, t.roofY + 0.2, p + 0.2, 0x5d4a35);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cylinder(sx * (p - 0.12), sz * (p - 0.12), 0.08, ph, t.roofY, WOOD_DARK, 5);
}

function buildBunker(b: GeoBuilder): void {
  const k = BUNKER;
  const h = k.half;
  const w = k.wall;
  b.boxMinMax(-h, 0, h - w, h, k.slitY0, h, CONCRETE);
  b.boxMinMax(-h, k.slitY1, h - w, h, k.height, h, CONCRETE);
  b.boxMinMax(-h, 0, -h + w, -h + w, k.height, h - w, CONCRETE);
  b.boxMinMax(h - w, 0, -h + w, h, k.height, h - w, CONCRETE);
  b.boxMinMax(-h, 0, -h, -k.doorHalf, k.height, -h + w, CONCRETE);
  b.boxMinMax(k.doorHalf, 0, -h, h, k.height, -h + w, CONCRETE);
  b.boxMinMax(-k.doorHalf, k.doorTop, -h, k.doorHalf, k.height, -h + w, CONCRETE_DARK);
  b.boxMinMax(-h, k.height, -h, h, k.height + k.roof, h, CONCRETE_DARK);
  // Dark floor inside so the interior reads as a room.
  b.boxMinMax(-h + w, 0.01, -h + w, h - w, 0.03, h - w, 0x5c5850);
}

const ROT = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

/** One InstancedMesh per prop type (GAME.md 7: props as InstancedMesh per type). */
export function buildProps(map: MapData, castShadow: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'props';
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const byType = new Map<PropType, MapData['props']>();
  for (const p of map.props) {
    let list = byType.get(p.type);
    if (!list) byType.set(p.type, (list = []));
    list.push(p);
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  for (const [type, list] of byType) {
    const geo = buildPropGeometry(type);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.name = `props-${type}`;
    const scalable = PROP_DEFS[type].scalable;
    list.forEach((p, i) => {
      // Natural props get a free-looking yaw (colliders are cylinders, so this never misleads).
      const yaw = scalable ? (jitter(i * 31 + p.variant) + 1) * Math.PI : ROT[p.rot % 4]!;
      e.set(0, yaw, 0);
      q.setFromEuler(e);
      const s = scalable ? p.scale : 1;
      m.compose(pos.set(p.x, p.y, p.z), q, scl.set(s, s, s));
      mesh.setMatrixAt(i, m);
      if (type === 'container') col.setHex(CONTAINER_COLORS[p.variant % CONTAINER_COLORS.length]!);
      else {
        const v = 1 + jitter(i * 7 + 13) * 0.08;
        col.setRGB(v, v, v);
      }
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = castShadow;
    mesh.receiveShadow = castShadow;
    group.add(mesh);
  }
  return group;
}
