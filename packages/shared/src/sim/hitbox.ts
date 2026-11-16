import { HITBOX } from '../config/movement';

/** Ray vs sphere; returns distance or Infinity. Direction must be normalised. */
export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const px = ox - cx;
  const py = oy - cy;
  const pz = oz - cz;
  const b = px * dx + py * dy + pz * dz;
  const c = px * px + py * py + pz * pz - r * r;
  if (c > 0 && b > 0) return Infinity;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

/** Ray vs vertical capsule (segment y0..y1 at (cx, cz), radius r). */
export function rayCapsuleY(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cz: number, y0: number, y1: number, r: number): number {
  let best = Infinity;
  const px = ox - cx;
  const pz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a > 1e-12) {
    const b = px * dx + pz * dz;
    const c = px * px + pz * pz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      if (t >= 0) {
        const y = oy + dy * t;
        if (y >= y0 && y <= y1) best = t;
      }
    }
  }
  if (best < Infinity) return best;
  const t0 = raySphere(ox, oy, oz, dx, dy, dz, cx, y0, cz, r);
  const t1 = raySphere(ox, oy, oz, dx, dy, dz, cx, y1, cz, r);
  return Math.min(t0, t1);
}

export const HIT_NONE = 0;
export const HIT_BODY = 1;
export const HIT_HEAD = 2;

/** Ray vs an actor standing at (x, y, z). Writes the hit kind into out.kind. */
export function rayActor(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  x: number,
  y: number,
  z: number,
  crouched: boolean,
  out: { kind: number },
): number {
  const headY = y + (crouched ? HITBOX.crouchHeadY : HITBOX.headY);
  const th = raySphere(ox, oy, oz, dx, dy, dz, x, headY, z, HITBOX.headRadius);
  const tb = rayCapsuleY(ox, oy, oz, dx, dy, dz, x, z, y + HITBOX.bodyY0, y + (crouched ? HITBOX.crouchBodyY1 : HITBOX.bodyY1), HITBOX.bodyRadius);
  if (th === Infinity && tb === Infinity) {
    out.kind = HIT_NONE;
    return Infinity;
  }
  if (th <= tb) {
    out.kind = HIT_HEAD;
    return th;
  }
  out.kind = HIT_BODY;
  return tb;
}
