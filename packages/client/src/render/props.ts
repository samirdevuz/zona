import * as THREE from 'three';
import { BUNKER, MAP, PROP_DEFS, Rng, TOWER, type MapData, type MapTheme, type PropType, type Terrain } from '@zona/shared';
import { assets } from './assets';
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

/** Props switch to their far model beyond this distance (m). */
const PROP_LOD_DISTANCE = 55;

/** Instances of one prop look (type + model variant), split into near/far instanced meshes. */
interface PropSet {
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh | null;
  matrices: THREE.Matrix4[];
  colors: THREE.Color[];
  x: Float32Array;
  z: Float32Array;
  /** Visual radius, so big props are kept a little past the fog line. */
  radius: number;
  /** Draw only within this distance (ground cover); default: up to the fog. */
  maxDist?: number;
}

/**
 * Props (GAME.md 7: InstancedMesh per type). glTF models (scripts/assets) come with a
 * near and a far level of detail; instances are re-sorted by distance when the camera
 * has moved, and nothing beyond the fog is drawn.
 */
export class PropLods {
  readonly group = new THREE.Group();
  private readonly sets: PropSet[] = [];
  private lastX = Infinity;
  private lastZ = Infinity;
  private lastMax = 0;

  add(set: PropSet): void {
    this.sets.push(set);
    this.group.add(set.near);
    if (set.far) this.group.add(set.far);
  }

  /** Re-assign instances when the camera moved more than a few metres (cheap: a few hundred props). */
  update(cx: number, cz: number, maxDist: number, force = false): void {
    if (!force && Math.abs(cx - this.lastX) + Math.abs(cz - this.lastZ) < 4 && maxDist === this.lastMax) return;
    this.lastX = cx;
    this.lastZ = cz;
    this.lastMax = maxDist;
    const near2 = PROP_LOD_DISTANCE * PROP_LOD_DISTANCE;
    for (const s of this.sets) {
      const max = Math.min(maxDist, s.maxDist ?? Infinity) + s.radius;
      const max2 = max * max;
      let n = 0;
      let f = 0;
      for (let i = 0; i < s.matrices.length; i++) {
        const dx = s.x[i]! - cx;
        const dz = s.z[i]! - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > max2) continue;
        if (s.far && d2 > near2) {
          s.far.setMatrixAt(f, s.matrices[i]!);
          s.far.setColorAt(f++, s.colors[i]!);
        } else {
          s.near.setMatrixAt(n, s.matrices[i]!);
          s.near.setColorAt(n++, s.colors[i]!);
        }
      }
      for (const [mesh, count] of [
        [s.near, n],
        [s.far, f],
      ] as const) {
        if (!mesh) continue;
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}

/** Ground cover: drawn only this close (m), one plant per `area` m² (lighter on the Low preset). */
const DECOR = { normal: { distance: 45, area: 26 }, low: { distance: 35, area: 40 } };

/**
 * Non-colliding ground cover (grass, bushes, cacti) for the map theme, scattered
 * deterministically from the map seed away from roads, flags, props and steep slopes.
 */
function addDecor(lods: PropLods, map: MapData, terrain: Terrain, theme: MapTheme, low: boolean): void {
  const cfg = low ? DECOR.low : DECOR.normal;
  const id = `deco@${theme}`;
  const n = assets.variants(id);
  if (n === 0) return;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const rng = new Rng((map.seed ^ 0x5eed) >>> 0);
  // Spatial hash of props (4 m cells) for the clearance test.
  const cellOf = (x: number, z: number): string => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
  const hash = new Map<string, MapData['props']>();
  for (const p of map.props) {
    const k = cellOf(p.x, p.z);
    let l = hash.get(k);
    if (!l) hash.set(k, (l = []));
    l.push(p);
  }
  const clear = (x: number, z: number): boolean => {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (const p of hash.get(`${Math.floor(x / 4) + dx},${Math.floor(z / 4) + dz}`) ?? []) {
          const r = PROP_DEFS[p.type].footprint * (PROP_DEFS[p.type].scalable ? p.scale : 1) + 0.8;
          if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return false;
        }
      }
    }
    for (const r of map.roads) {
      const vx = r.x1 - r.x0;
      const vz = r.z1 - r.z0;
      const l2 = vx * vx + vz * vz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - r.x0) * vx + (z - r.z0) * vz) / l2)) : 0;
      if ((x - r.x0 - vx * t) ** 2 + (z - r.z0 - vz * t) ** 2 < (MAP.roadHalfWidth + 1) ** 2) return false;
    }
    for (const zn of map.zones) if ((zn.x - x) ** 2 + (zn.z - z) ** 2 < 6 * 6) return false;
    for (const zn of map.zones) {
      for (const pd of [zn.jeepPad, zn.resupply, zn.tankPad]) if (pd && (pd.x - x) ** 2 + (pd.z - z) ** 2 < 5 * 5) return false;
    }
    return true;
  };
  const R = map.radius;
  const count = Math.floor((Math.PI * R * R) / cfg.area);
  const per = Array.from({ length: n }, () => ({ m: [] as THREE.Matrix4[], c: [] as THREE.Color[], x: [] as number[], z: [] as number[] }));
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const g = { gx: 0, gz: 0 };
  for (let i = 0; i < count; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = Math.sqrt(rng.next()) * R;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const v = Math.floor(rng.next() * n);
    const s = 0.75 + rng.next() * 0.6;
    const yaw = rng.next() * Math.PI * 2;
    terrain.gradientAt(x, z, g);
    if (g.gx * g.gx + g.gz * g.gz > 0.5 || !clear(x, z)) continue;
    e.set(0, yaw, 0);
    q.setFromEuler(e);
    const o = per[v]!;
    o.m.push(new THREE.Matrix4().compose(new THREE.Vector3(x, terrain.heightAt(x, z), z), q, new THREE.Vector3(s, s, s)));
    const k = 0.9 + rng.next() * 0.2;
    o.c.push(new THREE.Color(k, k, k));
    o.x.push(x);
    o.z.push(z);
  }
  per.forEach((o, v) => {
    const geo = assets.node(id, 'lod0', v)?.geo;
    if (!geo || o.m.length === 0) return;
    const near = new THREE.InstancedMesh(geo.clone(), mat, o.m.length);
    near.name = `decor-${theme}-${v}`;
    near.frustumCulled = false;
    near.count = 0;
    lods.add({ near, far: null, matrices: o.m, colors: o.c, x: Float32Array.from(o.x), z: Float32Array.from(o.z), radius: 1, maxDist: cfg.distance });
  });
}

export function buildProps(map: MapData, castShadow: boolean, theme: MapTheme = 'summer', terrain?: Terrain, lowDetail = false): PropLods {
  const lods = new PropLods();
  lods.group.name = 'props';
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const byType = new Map<PropType, MapData['props']>();
  for (const p of map.props) {
    let list = byType.get(p.type);
    if (!list) byType.set(p.type, (list = []));
    list.push(p);
  }
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const mk = (geo: THREE.BufferGeometry, count: number, name: string): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.name = name;
    mesh.frustumCulled = false; // instances span the whole map; the distance pass culls instead
    mesh.castShadow = castShadow;
    mesh.receiveShadow = castShadow;
    mesh.count = 0;
    return mesh;
  };
  for (const [type, list] of byType) {
    // Themed models (e.g. prop.pine@winter) replace the default ones when present.
    const id = assets.has(`prop.${type}@${theme}`) ? `prop.${type}@${theme}` : `prop.${type}`;
    const scalable = PROP_DEFS[type].scalable;
    // glTF variants with near/far nodes; otherwise one procedural (or hand-added) model.
    const nv = assets.variants(id);
    const looks: { near: THREE.BufferGeometry; far: THREE.BufferGeometry | null }[] = [];
    for (let v = 0; v < nv; v++) {
      const near = assets.node(id, 'lod0', v)?.geo ?? assets.geometry(id, v);
      if (near) looks.push({ near: near.clone(), far: assets.node(id, 'lod1', v)?.geo.clone() ?? null });
    }
    if (looks.length === 0) looks.push({ near: buildPropGeometry(type), far: null });
    const groups = looks.map(() => [] as { p: MapData['props'][number]; i: number }[]);
    list.forEach((p, i) => groups[(p.variant + i) % looks.length]!.push({ p, i }));
    looks.forEach((look, v) => {
      const items = groups[v]!;
      if (items.length === 0) return;
      look.near.computeBoundingSphere();
      const set: PropSet = {
        near: mk(look.near, items.length, `props-${type}-${v}`),
        far: look.far ? mk(look.far, items.length, `props-${type}-${v}-far`) : null,
        matrices: [],
        colors: [],
        x: new Float32Array(items.length),
        z: new Float32Array(items.length),
        radius: look.near.boundingSphere!.radius,
      };
      items.forEach(({ p, i }, k) => {
        // Natural props get a free-looking yaw (colliders are cylinders, so this never misleads).
        const yaw = scalable ? (jitter(i * 31 + p.variant) + 1) * Math.PI : ROT[p.rot % 4]!;
        e.set(0, yaw, 0);
        q.setFromEuler(e);
        const s = scalable ? p.scale : 1;
        set.matrices.push(new THREE.Matrix4().compose(pos.set(p.x, p.y, p.z), q, scl.set(s, s, s)));
        const col = new THREE.Color();
        if (type === 'container') col.setHex(CONTAINER_COLORS[p.variant % CONTAINER_COLORS.length]!);
        else {
          const c = 1 + jitter(i * 7 + 13) * 0.08;
          col.setRGB(c, c, c);
        }
        set.colors.push(col);
        set.x[k] = p.x;
        set.z[k] = p.z;
      });
      lods.add(set);
    });
  }
  if (terrain) addDecor(lods, map, terrain, theme, lowDetail);
  return lods;
}
