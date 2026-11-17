import { GADGETS } from '../config/gadgets';
import type { World } from '../map/world';

export const PROJ_GRENADE = 1;
export const PROJ_ROCKET = 2;

/** Server projectile (GAME.md 3.3): swept raycasts every step to prevent tunnelling. */
export interface Projectile {
  id: number;
  kind: number;
  owner: number;
  team: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds since launch. */
  age: number;
  /** Grenade resting on the ground. */
  resting: boolean;
}

export interface ProjectileStep {
  /** True when the projectile exploded this step (position = explosion point). */
  exploded: boolean;
  /** Bounced off a surface this step (grenades; for sounds). */
  bounced: boolean;
}

const n = { x: 0, y: 0, z: 0 };

/**
 * Advance a projectile by dt against the static world. Actor hits for rockets
 * are checked by the caller along the same segment before calling this.
 */
export function stepProjectile(world: World, p: Projectile, dt: number, out: ProjectileStep): void {
  out.exploded = false;
  out.bounced = false;
  p.age += dt;
  if (p.kind === PROJ_GRENADE) {
    if (p.age >= GADGETS.grenade.fuseS) {
      out.exploded = true;
      return;
    }
    if (p.resting) return;
    p.vy -= GADGETS.grenade.gravity * dt;
  } else {
    if (p.age >= GADGETS.rocket.maxLifeS) {
      out.exploded = true;
      return;
    }
    p.vy -= GADGETS.rocket.gravity * dt;
  }
  let remaining = dt;
  for (let iter = 0; iter < 3 && remaining > 0; iter++) {
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
    if (speed < 1e-6) break;
    const dist = speed * remaining;
    const dx = p.vx / speed;
    const dy = p.vy / speed;
    const dz = p.vz / speed;
    const t = world.raycastStaticNormal(p.x, p.y, p.z, dx, dy, dz, dist, n);
    if (t === Infinity || t > dist) {
      p.x += dx * dist;
      p.y += dy * dist;
      p.z += dz * dist;
      break;
    }
    // Hit something.
    p.x += dx * t;
    p.y += dy * t;
    p.z += dz * t;
    if (p.kind === PROJ_ROCKET) {
      out.exploded = true;
      return;
    }
    // Grenade bounce: reflect the normal component with restitution, damp the tangent.
    const vn = p.vx * n.x + p.vy * n.y + p.vz * n.z;
    const tx = p.vx - vn * n.x;
    const ty = p.vy - vn * n.y;
    const tz = p.vz - vn * n.z;
    const e = GADGETS.grenade.restitution;
    const f = GADGETS.grenade.friction;
    p.vx = tx * f - vn * e * n.x;
    p.vy = ty * f - vn * e * n.y;
    p.vz = tz * f - vn * e * n.z;
    p.x += n.x * 0.03;
    p.y += n.y * 0.03;
    p.z += n.z * 0.03;
    out.bounced = Math.abs(vn) > 1.5;
    remaining -= t / speed;
    if (n.y > 0.7 && Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) < 1.2) {
      p.vx = p.vy = p.vz = 0;
      p.resting = true;
      break;
    }
  }
  // Never fall through the terrain.
  const g = world.terrain.heightAt(p.x, p.z);
  if (p.y < g + 0.05) {
    p.y = g + 0.05;
    if (p.kind === PROJ_ROCKET) out.exploded = true;
    else if (p.vy < 0) p.vy = 0;
  }
}
