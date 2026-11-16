import { DEG2RAD, dcos, dsin } from '../math/trig';
import type { Vec3 } from '../math/vec';

/** Forward vector for yaw/pitch (three.js camera convention, Euler order YXZ). */
export function aimDir(yaw: number, pitch: number, out: Vec3): Vec3 {
  const cp = dcos(pitch);
  out.x = -dsin(yaw) * cp;
  out.y = dsin(pitch);
  out.z = -dcos(yaw) * cp;
  return out;
}

/**
 * Perturb a normalised direction within a cone of half-angle `deg`, using two
 * uniform numbers u1, u2 in [0, 1) (uniform over the cone's disc).
 */
export function applySpread(dir: Vec3, deg: number, u1: number, u2: number): Vec3 {
  if (deg <= 0) return dir;
  // Orthonormal basis around dir.
  let rx: number;
  let ry: number;
  let rz: number;
  if (Math.abs(dir.y) < 0.99) {
    // right = dir x up(0,1,0) = (-dir.z, 0, dir.x)
    rx = -dir.z;
    ry = 0;
    rz = dir.x;
  } else {
    rx = 1;
    ry = 0;
    rz = 0;
  }
  const rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
  rx /= rl;
  ry /= rl;
  rz /= rl;
  // up = right x dir
  const ux = ry * dir.z - rz * dir.y;
  const uy = rz * dir.x - rx * dir.z;
  const uz = rx * dir.y - ry * dir.x;
  const ang = u1 * 2 * Math.PI;
  const rad = Math.sqrt(u2) * Math.tan(deg * DEG2RAD);
  const ox = Math.cos(ang) * rad;
  const oy = Math.sin(ang) * rad;
  dir.x += rx * ox + ux * oy;
  dir.y += ry * ox + uy * oy;
  dir.z += rz * ox + uz * oy;
  const l = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  dir.x /= l;
  dir.y /= l;
  dir.z /= l;
  return dir;
}
