// How each game model is made from its CC0 source (see build.mjs and sources.json).
// Conventions (GAME.md 7.6): metres, +Y up, forward -Z, origin on the ground.
import * as THREE from 'three';
import { simplifyPart } from './lib.mjs';

const hexOf = (palette, fallback) => (name, _mesh, hex) => {
  if (name in palette) return palette[name];
  return fallback === undefined ? hex : fallback;
};

/** Simplify parts so the whole set has about `target` triangles (each part keeps its colour). */
function simplifyTo(t, parts, target, opts = {}) {
  const total = parts.reduce((s, p) => s + t.triCount(p.geo), 0);
  const ratio = Math.min(1, target / total);
  return parts.map((p) => ({ ...p, geo: simplifyPart(p.geo, ratio, opts) }));
}

/** Simplify each part by its own ratio (`ratioOf(part)`), e.g. keep round wheels, crush hidden frames. */
function simplifyBy(parts, ratioOf, opts = {}) {
  return parts.map((p) => ({ ...p, geo: simplifyPart(p.geo, ratioOf(p), opts) }));
}

/**
 * Far LOD: drop parts smaller than `minSize` metres (bolts, lamps), then simplify the rest
 * towards `target` triangles with a loose error bound (topology-preserving, never sloppy).
 */
function farLod(t, parts, target, minSize = 0.25) {
  const big = parts.filter((p) => {
    p.geo.computeBoundingBox();
    return p.geo.boundingBox.getSize(new THREE.Vector3()).length() >= minSize;
  });
  return t.mergeParts(simplifyTo(t, big, target, { error: 0.25 }));
}

/** Uniformly scale and move parts: centre x/z at the origin, lowest point on y = 0. */
function normalise(t, parts, scale, { rotY = 0, centre = true } = {}) {
  const m = new THREE.Matrix4().makeRotationY(rotY).premultiply(new THREE.Matrix4().makeScale(scale, scale, scale));
  t.transformParts(parts, m);
  const box = t.partsBox(parts);
  const off = new THREE.Vector3(centre ? -(box.min.x + box.max.x) / 2 : 0, -box.min.y, centre ? -(box.min.z + box.max.z) / 2 : 0);
  t.transformParts(parts, new THREE.Matrix4().makeTranslation(off.x, off.y, off.z));
  return off;
}

/** Max |coordinate| of part vertices inside a box filter (used to fit team markings). */
function extent(parts, filter, axis) {
  let best = -Infinity;
  for (const p of parts) {
    const a = p.geo.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      const v = { x: a[i], y: a[i + 1], z: a[i + 2] };
      if (filter(v)) best = Math.max(best, axis === 'y' ? v.y : Math.abs(v[axis]));
    }
  }
  return best;
}

function boxGeo(x0, y0, z0, x1, y1, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const n = g.toNonIndexed();
  n.deleteAttribute('uv');
  return n;
}

/** White boxes merged into one geometry (tinted with the team colour at runtime). */
function markingGeo(t, boxes) {
  return t.mergeParts(boxes.map((b) => ({ geo: boxGeo(...b), hex: 0xffffff })));
}

/** A mesh node placed at a pivot (writeGlb keeps its position). */
function pivotNode(geo, x, y, z) {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true }));
  m.position.set(x, y, z);
  return m;
}

const JEEP_COLORS = {
  'GAZ 67 khaki': 0x5d6a3c,
  'GAZ 67 rubber': 0x232323,
  'GAZ 67 black plastic': 0x1d1d1d,
  'GAZ 67 black metal': 0x34373a,
  'GAZ 67 leather': 0x4f4036,
  'GAZ 67 white light': 0xfff1c2,
  'GAZ 67 clear metal': 0x9a9da0,
  'GAZ 67 red light': 0xb0302c,
  'GAZ 67 untransparent glass': 0x8a9196,
  'GAZ 67 glass': null, // see-through in the source: dropped
  glass: null,
};

const TANK_COLORS = {
  camo: 0x5a6538,
  'black metal': 0x2a2c29,
  'brown metal': 0x6b4c36,
  'grey metal': 0x4a4d4f,
};

export const RECIPES = [
  {
    id: 'vehicle.jeep',
    source: 'gaz67',
    file: 'jeep',
    async build(t) {
      const root = await t.load('gaz67/GAZ 67.fbx');
      // Source is in centimetres, forward -Z, driver on the left. 3.35 m -> 4.1 m (jeep collider 4.2 m).
      const parts = t.bakeParts(root, hexOf(JEEP_COLORS));
      normalise(t, parts, 0.0122);
      const hoodY = extent(parts, (v) => v.z < -0.9 && v.z > -1.6 && Math.abs(v.x) < 0.2, 'y');
      const sideX = extent(parts, (v) => v.y > 0.75 && v.y < 1.0 && Math.abs(v.z) < 0.6, 'x');
      const marking = markingGeo(t, [
        [-0.22, hoodY + 0.005, -1.55, 0.22, hoodY + 0.02, -0.95],
        [-sideX - 0.012, 0.78, -0.5, -sideX + 0.01, 0.98, 0.5],
        [sideX - 0.01, 0.78, -0.5, sideX + 0.012, 0.98, 0.5],
      ]);
      return [
        {
          body: t.mergeParts([
            ...simplifyBy(parts.filter((p) => p.mesh.startsWith('wheel')), () => 0.45, { error: 0.01 }),
            ...simplifyBy(parts.filter((p) => p.mesh === 'frame'), () => 0.1, { error: 0.1 }),
            ...simplifyBy(parts.filter((p) => !p.mesh.startsWith('wheel') && p.mesh !== 'frame'), () => 0.3, { error: 0.035 }),
          ]),
          body_lod1: t.mergeParts([
            ...simplifyBy(parts.filter((p) => p.mesh.startsWith('wheel')), () => 0.15, { error: 0.05 }),
            ...simplifyBy(parts.filter((p) => !p.mesh.startsWith('wheel') && p.mesh !== 'frame' && p.mesh !== 'details'), () => 0.12, { error: 0.06 }),
          ]),
          marking,
        },
      ];
    },
  },
  {
    id: 'vehicle.tank',
    source: 't12',
    file: 'tank',
    async build(t) {
      const root = await t.load('t12/T-12 soviet tank.fbx');
      const all = t.bakeParts(root, hexOf(TANK_COLORS));
      // Source faces +Z in centimetres: turn it around; 6.27 m -> 6.6 m (tank collider).
      const s = 0.01053;
      normalise(t, all, s, { rotY: Math.PI });
      const hull = all.filter((p) => p.mesh === 'T-26_BODY');
      const tower = all.filter((p) => p.mesh === 'T-26_TOWER');
      // Split the gun barrel (thin cylinder ahead of the mantlet) from the turret.
      // Measured with scripts/assets/dev/tankdbg.mjs: the turret body spans z -2.0..0 m,
      // the mantlet front is at z -2.1 m and the 45 mm barrel (axis y 1.97 m, x 0) reaches z -3.05 m.
      const tb = t.partsBox(tower);
      const pivotX = 0;
      const pivotY = tb.min.y;
      const barrelY = 1.97;
      const mantletZ = -2.1;
      let pivotZ = 0;
      {
        // Turret ring centre: middle of the turret body (without the barrel).
        let zMin = Infinity;
        let zMax = -Infinity;
        for (const p of tower) {
          const a = p.geo.attributes.position.array;
          for (let i = 2; i < a.length; i += 3) {
            if (a[i] <= -2.0) continue;
            zMin = Math.min(zMin, a[i]);
            zMax = Math.max(zMax, a[i]);
          }
        }
        pivotZ = (zMin + zMax) / 2;
      }
      const turret = [];
      const barrel = [];
      for (const p of tower) {
        const a = p.geo.attributes.position.array;
        const keep = [];
        const gun = [];
        for (let i = 0; i < a.length; i += 9) {
          const cx = (a[i] + a[i + 3] + a[i + 6]) / 3;
          const cy = (a[i + 1] + a[i + 4] + a[i + 7]) / 3;
          const cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3;
          const isGun = cz < -2.15 && Math.abs(cx - pivotX) < 0.07 && Math.abs(cy - barrelY) < 0.07;
          (isGun ? gun : keep).push(...a.slice(i, i + 9));
        }
        const mk = (arr) => {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
          return { ...p, geo: g };
        };
        if (keep.length) turret.push(mk(keep));
        if (gun.length) barrel.push(mk(gun));
      }
      // Barrel in its own space: trunnion at the mantlet, pointing -Z, stretched to the
      // gameplay barrel length (TANK.barrelLength = 3.2 m from the turret pivot).
      const trunnionZ = mantletZ;
      const bb = t.partsBox(barrel);
      const tipFromTrunnion = trunnionZ - bb.min.z;
      const wantTip = 3.2 - (pivotZ - trunnionZ);
      const stretch = wantTip / tipFromTrunnion;
      t.transformParts(barrel, new THREE.Matrix4().makeTranslation(-pivotX, -barrelY, -trunnionZ));
      t.transformParts(barrel, new THREE.Matrix4().makeScale(1.5, 1.5, stretch)); // a bit thicker: reads better at range
      t.transformParts(turret, new THREE.Matrix4().makeTranslation(-pivotX, -pivotY, -pivotZ));
      // Team bands on the turret side walls (turret body half-width 0.75 m, measured).
      const midY = (barrelY - pivotY) * 0.75;
      const sideX = 0.765;
      const marking = markingGeo(t, [
        [-sideX - 0.012, midY - 0.14, -0.4, -sideX + 0.01, midY + 0.12, 0.4],
        [sideX - 0.01, midY - 0.14, -0.4, sideX + 0.012, midY + 0.12, 0.4],
      ]);
      // Hierarchy: turret (pivot in hull space) > barrel (trunnion in turret space) + marking.
      const turretNode = pivotNode(t.mergeParts(simplifyTo(t, turret, 1400, { error: 0.03 })), pivotX, pivotY, pivotZ);
      const barrelNode = pivotNode(t.mergeParts(barrel), 0, barrelY - pivotY, trunnionZ - pivotZ);
      barrelNode.name = 'barrel';
      const markingNode = pivotNode(marking, 0, 0, 0);
      markingNode.name = 'marking';
      turretNode.add(barrelNode, markingNode);
      return [
        {
          hull: t.mergeParts(simplifyTo(t, hull, 3600, { error: 0.03 })),
          hull_lod1: farLod(t, hull, 700),
          turret: turretNode,
          turret_lod1: pivotNode(farLod(t, turret, 260), pivotX, pivotY, pivotZ),
        },
      ];
    },
  },
];
