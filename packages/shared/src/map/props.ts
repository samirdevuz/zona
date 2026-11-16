import { COLLIDER_BOX, COLLIDER_CYL, type Collider, type Prop, type PropType } from './types';

/**
 * Prop collision shapes in local space (origin on the ground, +Y up).
 * Boxes are centred on (x, z) with half extents (hx, hz) and span y0..y1.
 * Every shape is symmetric under local x -> -x so mirrored copies stay exact.
 * The client builds visual meshes that match these shapes (GAME.md 7.6).
 */
export interface BoxPart {
  kind: 'box';
  x: number;
  z: number;
  hx: number;
  hz: number;
  y0: number;
  y1: number;
}
export interface CylPart {
  kind: 'cyl';
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
}
export type PropPart = BoxPart | CylPart;

export interface PropDef {
  /** Radius of the circle used for spacing during placement. */
  footprint: number;
  /** Natural props may be uniformly scaled; man-made ones never are. */
  scalable: boolean;
  /** Used as zone cover. */
  cover: boolean;
  parts: PropPart[];
}

const box = (x: number, z: number, hx: number, hz: number, y0: number, y1: number): BoxPart => ({ kind: 'box', x, z, hx, hz, y0, y1 });
const cyl = (x: number, z: number, r: number, y0: number, y1: number): CylPart => ({ kind: 'cyl', x, z, r, y0, y1 });

/** Tower: 4x4 m platform at 4.2 m, low parapet, stairs of 0.42 m steps leading out along -z. */
export const TOWER = {
  platformHalf: 2,
  platformTop: 4.2,
  platformThickness: 0.3,
  parapetHeight: 0.95,
  parapetThickness: 0.14,
  stairHalfWidth: 0.7,
  stepCount: 10,
  stepRise: 0.42,
  stepDepth: 0.55,
  roofY: 6.6,
} as const;

/** Bunker: 6x6 m concrete box, door on -z, firing slit on +z. */
export const BUNKER = {
  half: 3,
  wall: 0.5,
  height: 2.5,
  roof: 0.4,
  doorHalf: 0.9,
  doorTop: 2.0,
  slitY0: 1.45,
  slitY1: 1.8,
} as const;

function towerParts(): PropPart[] {
  const t = TOWER;
  const p = t.platformHalf;
  const top = t.platformTop;
  const parts: PropPart[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(cyl(sx * (p - 0.2), sz * (p - 0.2), 0.18, 0, top - t.platformThickness));
  parts.push(box(0, 0, p, p, top - t.platformThickness, top));
  const ph = top + t.parapetHeight;
  const th = t.parapetThickness / 2;
  parts.push(box(0, p - th, p, th, top, ph)); // back
  parts.push(box(-p + th, 0, th, p, top, ph)); // left
  parts.push(box(p - th, 0, th, p, top, ph)); // right
  const segHalf = (p - t.stairHalfWidth) / 2;
  parts.push(box(-(t.stairHalfWidth + segHalf), -p + th, segHalf, th, top, ph)); // front-left
  parts.push(box(t.stairHalfWidth + segHalf, -p + th, segHalf, th, top, ph)); // front-right
  for (let k = 1; k <= t.stepCount; k++) {
    const zFar = -p - (t.stepCount - k + 1) * t.stepDepth;
    const zNear = zFar + t.stepDepth;
    parts.push(box(0, (zFar + zNear) / 2, t.stairHalfWidth, t.stepDepth / 2, 0, k * t.stepRise));
  }
  parts.push(box(0, 0, p + 0.2, p + 0.2, t.roofY, t.roofY + 0.2)); // roof
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(cyl(sx * (p - 0.12), sz * (p - 0.12), 0.08, ph, t.roofY));
  return parts;
}

function bunkerParts(): PropPart[] {
  const b = BUNKER;
  const h = b.half;
  const w = b.wall / 2;
  const sideHalf = (h - b.doorHalf) / 2;
  return [
    box(0, h - w, h, w, 0, b.slitY0), // back wall below slit
    box(0, h - w, h, w, b.slitY1, b.height), // back wall above slit
    box(-h + w, 0, w, h - b.wall, 0, b.height), // left
    box(h - w, 0, w, h - b.wall, 0, b.height), // right
    box(-(b.doorHalf + sideHalf), -h + w, sideHalf, w, 0, b.height), // front-left
    box(b.doorHalf + sideHalf, -h + w, sideHalf, w, 0, b.height), // front-right
    box(0, -h + w, b.doorHalf, w, b.doorTop, b.height), // lintel
    box(0, 0, h, h, b.height, b.height + b.roof), // roof
  ];
}

export const PROP_DEFS: Record<PropType, PropDef> = {
  pine: { footprint: 1.4, scalable: true, cover: false, parts: [cyl(0, 0, 0.3, 0, 7.5)] },
  tree: { footprint: 1.8, scalable: true, cover: false, parts: [cyl(0, 0, 0.35, 0, 6)] },
  rock: { footprint: 1.4, scalable: true, cover: true, parts: [cyl(0, 0, 1.05, -0.4, 1.0)] },
  boulder: { footprint: 2.6, scalable: true, cover: false, parts: [cyl(0, 0, 2.1, -0.6, 2.6)] },
  container: { footprint: 3.3, scalable: false, cover: true, parts: [box(0, 0, 3.05, 1.22, 0, 2.6)] },
  barrier: { footprint: 1.6, scalable: false, cover: true, parts: [box(0, 0, 1.5, 0.35, 0, 1.05)] },
  sandbags: { footprint: 1.7, scalable: false, cover: true, parts: [box(0, 0, 1.6, 0.5, 0, 0.95)] },
  ruin: {
    footprint: 3.2,
    scalable: false,
    cover: false,
    parts: [box(-2, 0, 1, 0.3, 0, 2.8), box(2, 0, 1, 0.3, 0, 2.8), box(0, 0, 1, 0.3, 0, 0.9)],
  },
  tower: { footprint: 7.8, scalable: false, cover: false, parts: towerParts() },
  bunker: { footprint: 4.4, scalable: false, cover: false, parts: bunkerParts() },
};

/** Rotate a local (x, z) by quarter turns, matching three.js rotation.y = rot * PI/2. */
export function rotateQuarter(x: number, z: number, rot: number, out: { x: number; z: number }): void {
  switch (((rot % 4) + 4) % 4) {
    case 0:
      out.x = x;
      out.z = z;
      break;
    case 1:
      out.x = z;
      out.z = -x;
      break;
    case 2:
      out.x = -x;
      out.z = -z;
      break;
    default:
      out.x = -z;
      out.z = x;
      break;
  }
}

export function makeCollider(): Collider {
  return { kind: COLLIDER_BOX, minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, cx: 0, cz: 0, r: 0 };
}

/** Build world-space colliders for a list of props (deterministic arithmetic only). */
export function buildColliders(props: readonly Prop[]): Collider[] {
  const out: Collider[] = [];
  const p = { x: 0, z: 0 };
  for (const prop of props) {
    const def = PROP_DEFS[prop.type];
    const s = def.scalable ? prop.scale : 1;
    for (const part of def.parts) {
      rotateQuarter(part.x * s, part.z * s, prop.rot, p);
      const c = makeCollider();
      const cx = prop.x + p.x;
      const cz = prop.z + p.z;
      c.minY = prop.y + part.y0 * s;
      c.maxY = prop.y + part.y1 * s;
      if (part.kind === 'box') {
        const odd = (((prop.rot % 4) + 4) % 4) % 2 === 1;
        const hx = (odd ? part.hz : part.hx) * s;
        const hz = (odd ? part.hx : part.hz) * s;
        c.kind = COLLIDER_BOX;
        c.minX = cx - hx;
        c.maxX = cx + hx;
        c.minZ = cz - hz;
        c.maxZ = cz + hz;
      } else {
        const r = part.r * s;
        c.kind = COLLIDER_CYL;
        c.cx = cx;
        c.cz = cz;
        c.r = r;
        c.minX = cx - r;
        c.maxX = cx + r;
        c.minZ = cz - r;
        c.maxZ = cz + r;
      }
      out.push(c);
    }
  }
  return out;
}

/** Flag pole collider at each zone centre. */
export const FLAG_POLE = { radius: 0.12, height: 9 } as const;
