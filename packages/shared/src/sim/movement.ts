import { MOVEMENT } from '../config/movement';
import { COLLIDER_BOX, type Collider } from '../map/types';
import type { World } from '../map/world';
import { dcos, dsin, DEG2RAD } from '../math/trig';
import { BTN } from './input';
import type { PlayerState } from './player';

const MAX_SLOPE_TAN = 1.0; // tan(45 deg); MOVEMENT.maxSlopeDeg is 45 (checked in tests)
const PITCH_LIMIT = 89 * DEG2RAD;
const EPS = 1e-6;

/** Reusable scratch to avoid allocations in the per-step hot path. */
export interface MoveScratch {
  ids: number[];
  grad: { gx: number; gz: number };
}
export function createMoveScratch(): MoveScratch {
  return { ids: [], grad: { gx: 0, gz: 0 } };
}

function playerHeight(s: PlayerState): number {
  return s.crouched ? MOVEMENT.crouchHeight : MOVEMENT.height;
}

/** True if any collider overlapping the circle intersects the vertical range (lo, hi). */
function solidInRange(world: World, x: number, z: number, r: number, lo: number, hi: number, ids: number[]): boolean {
  const n = world.query(x - r, z - r, x + r, z + r, ids);
  for (let i = 0; i < n; i++) {
    const c = world.colliders[ids[i]!]!;
    if (c.maxY <= lo || c.minY >= hi) continue;
    if (circleHits(c, x, z, r)) return true;
  }
  return false;
}

function circleHits(c: Collider, x: number, z: number, r: number): boolean {
  if (c.kind === COLLIDER_BOX) {
    const nx = x < c.minX ? c.minX : x > c.maxX ? c.maxX : x;
    const nz = z < c.minZ ? c.minZ : z > c.maxZ ? c.maxZ : z;
    const dx = x - nx;
    const dz = z - nz;
    return dx * dx + dz * dz < r * r;
  }
  const dx = x - c.cx;
  const dz = z - c.cz;
  const rr = r + c.r;
  return dx * dx + dz * dz < rr * rr;
}

/**
 * Advance a player's movement by one fixed step (GAME.md 3.4): Quake-style
 * acceleration and friction, collide-and-slide against boxes and cylinders,
 * step-up, ground snapping, slope limits and the world edge.
 * Pure function of (world, state, input); identical on client and server.
 */
export function stepMovement(
  world: World,
  s: PlayerState,
  buttons: number,
  yaw: number,
  pitch: number,
  speedMult: number,
  dt: number,
  scratch: MoveScratch,
): void {
  const ids = scratch.ids;
  s.yaw = yaw;
  s.pitch = pitch > PITCH_LIMIT ? PITCH_LIMIT : pitch < -PITCH_LIMIT ? -PITCH_LIMIT : pitch;
  const r = MOVEMENT.radius;

  // Stance.
  const wantCrouch = (buttons & BTN.CROUCH) !== 0;
  if (wantCrouch) {
    s.crouched = true;
  } else if (s.crouched) {
    if (!solidInRange(world, s.x, s.z, r - 0.02, s.y + MOVEMENT.crouchHeight - EPS, s.y + MOVEMENT.height, ids)) s.crouched = false;
  }

  const fwdIn = ((buttons & BTN.FORWARD) !== 0 ? 1 : 0) - ((buttons & BTN.BACK) !== 0 ? 1 : 0);
  const rightIn = ((buttons & BTN.RIGHT) !== 0 ? 1 : 0) - ((buttons & BTN.LEFT) !== 0 ? 1 : 0);

  if (s.onGround) {
    s.sprinting = (buttons & BTN.SPRINT) !== 0 && fwdIn > 0 && !s.crouched && (buttons & BTN.FIRE) === 0;
  } else if ((buttons & BTN.SPRINT) === 0 || fwdIn <= 0) {
    s.sprinting = false;
  }
  s.ads = (buttons & BTN.ADS) !== 0 && !s.sprinting;

  // Wish direction from yaw (forward = (-sin, -cos), right = (cos, -sin)).
  const sy = dsin(s.yaw);
  const cy = dcos(s.yaw);
  let wx = fwdIn * -sy + rightIn * cy;
  let wz = fwdIn * -cy + rightIn * -sy;
  const wl = Math.sqrt(wx * wx + wz * wz);
  let wishSpeed = 0;
  if (wl > EPS) {
    wx /= wl;
    wz /= wl;
    wishSpeed = s.sprinting ? MOVEMENT.sprintSpeed : s.crouched ? MOVEMENT.crouchSpeed : s.ads ? MOVEMENT.adsSpeed : MOVEMENT.walkSpeed;
    if (fwdIn < 0) wishSpeed *= MOVEMENT.backwardMult;
    wishSpeed *= speedMult;
  }

  const jumpDown = (buttons & BTN.JUMP) !== 0;
  const jumpPressed = jumpDown && !s.jumpHeld;
  s.jumpHeld = jumpDown;

  if (s.onGround) {
    const speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
    if (speed > EPS) {
      const drop = (speed < MOVEMENT.stopSpeed ? MOVEMENT.stopSpeed : speed) * MOVEMENT.friction * dt;
      const ns = speed - drop > 0 ? speed - drop : 0;
      s.vx *= ns / speed;
      s.vz *= ns / speed;
    }
    accelerate(s, wx, wz, wishSpeed, MOVEMENT.groundAccel, dt);
    if (jumpPressed) {
      s.vy = MOVEMENT.jumpSpeed;
      s.onGround = false;
    } else {
      s.vy = 0;
    }
  } else {
    accelerate(s, wx, wz, wishSpeed, MOVEMENT.airAccel, dt);
  }
  if (!s.onGround) {
    s.vy -= MOVEMENT.gravity * dt;
    if (s.vy < -MOVEMENT.terminalVelocity) s.vy = -MOVEMENT.terminalVelocity;
  }

  // Horizontal move + collide-and-slide (position push-out, velocity clipping).
  const h = playerHeight(s);
  let nx = s.x + s.vx * dt;
  let nz = s.z + s.vz * dt;
  const wallLo = s.y + (s.onGround ? MOVEMENT.stepHeight : 0.05);
  const wallHi = s.y + h;
  for (let it = 0; it < MOVEMENT.collisionIterations; it++) {
    let pushed = false;
    const n = world.query(nx - r, nz - r, nx + r, nz + r, ids);
    for (let i = 0; i < n; i++) {
      const c = world.colliders[ids[i]!]!;
      if (c.maxY <= wallLo || c.minY >= wallHi) continue;
      let px: number;
      let pz: number;
      if (c.kind === COLLIDER_BOX) {
        const cx = nx < c.minX ? c.minX : nx > c.maxX ? c.maxX : nx;
        const cz = nz < c.minZ ? c.minZ : nz > c.maxZ ? c.maxZ : nz;
        let dx = nx - cx;
        let dz = nz - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > EPS * EPS) {
          const d = Math.sqrt(d2);
          dx /= d;
          dz /= d;
          px = dx * (r - d);
          pz = dz * (r - d);
        } else {
          // Centre inside the box: push out along the axis of least penetration.
          const left = nx - c.minX;
          const right = c.maxX - nx;
          const back = nz - c.minZ;
          const front = c.maxZ - nz;
          const m = Math.min(left, right, back, front);
          if (m === left) {
            dx = -1;
            dz = 0;
            px = -(left + r);
            pz = 0;
          } else if (m === right) {
            dx = 1;
            dz = 0;
            px = right + r;
            pz = 0;
          } else if (m === back) {
            dx = 0;
            dz = -1;
            px = 0;
            pz = -(back + r);
          } else {
            dx = 0;
            dz = 1;
            px = 0;
            pz = front + r;
          }
        }
        nx += px;
        nz += pz;
        const vn = s.vx * dx + s.vz * dz;
        if (vn < 0) {
          s.vx -= vn * dx;
          s.vz -= vn * dz;
        }
        pushed = true;
      } else {
        let dx = nx - c.cx;
        let dz = nz - c.cz;
        const rr = r + c.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2);
        if (d > EPS) {
          dx /= d;
          dz /= d;
        } else {
          dx = 1;
          dz = 0;
        }
        nx += dx * (rr - d);
        nz += dz * (rr - d);
        const vn = s.vx * dx + s.vz * dz;
        if (vn < 0) {
          s.vx -= vn * dx;
          s.vz -= vn * dz;
        }
        pushed = true;
      }
    }
    if (!pushed) break;
  }

  // World edge (hard clamp inside the heightfield).
  if (nx < world.minX) {
    nx = world.minX;
    if (s.vx < 0) s.vx = 0;
  } else if (nx > world.maxX) {
    nx = world.maxX;
    if (s.vx > 0) s.vx = 0;
  }
  if (nz < world.minZ) {
    nz = world.minZ;
    if (s.vz < 0) s.vz = 0;
  } else if (nz > world.maxZ) {
    nz = world.maxZ;
    if (s.vz > 0) s.vz = 0;
  }

  // Vertical move.
  let ny = s.y + s.vy * dt;
  // Ceiling.
  if (s.vy > 0) {
    const n = world.query(nx - r, nz - r, nx + r, nz + r, ids);
    for (let i = 0; i < n; i++) {
      const c = world.colliders[ids[i]!]!;
      if (c.minY >= s.y + h - EPS && c.minY < ny + h && circleHits(c, nx, nz, r * 0.9)) {
        ny = c.minY - h;
        s.vy = 0;
      }
    }
  }
  // Ground: terrain under the feet or the highest collider top we may stand on.
  const standLimit = s.onGround ? s.y + MOVEMENT.stepHeight : (s.y > ny ? s.y : ny) + 0.05;
  let ground = world.terrain.heightAt(nx, nz);
  let groundIsTerrain = true;
  {
    const rf = r * 0.9;
    const n = world.query(nx - rf, nz - rf, nx + rf, nz + rf, ids);
    for (let i = 0; i < n; i++) {
      const c = world.colliders[ids[i]!]!;
      if (c.maxY > ground && c.maxY <= standLimit && circleHits(c, nx, nz, rf)) {
        ground = c.maxY;
        groundIsTerrain = false;
      }
    }
  }

  let landed = false;
  if (s.onGround && s.vy <= 0) {
    if (ground >= ny - MOVEMENT.groundSnap) {
      ny = ground;
      landed = true;
    } else {
      s.onGround = false;
    }
  } else if (ny <= ground) {
    ny = ground;
    if (s.vy < 0) s.vy = 0;
    landed = true;
  } else {
    s.onGround = false;
  }

  if (landed) {
    s.onGround = true;
    if (groundIsTerrain) {
      const g = scratch.grad;
      world.terrain.gradientAt(nx, nz, g);
      const slope2 = g.gx * g.gx + g.gz * g.gz;
      if (slope2 > MAX_SLOPE_TAN * MAX_SLOPE_TAN) {
        // Too steep: slide downhill instead of standing.
        s.onGround = false;
        const sl = Math.sqrt(slope2);
        s.vx -= (g.gx / sl) * MOVEMENT.steepSlideAccel * dt;
        s.vz -= (g.gz / sl) * MOVEMENT.steepSlideAccel * dt;
        if (s.vy > 0) s.vy = 0;
      }
    }
  }

  s.x = nx;
  s.y = ny;
  s.z = nz;
}

function accelerate(s: PlayerState, wx: number, wz: number, wishSpeed: number, accel: number, dt: number): void {
  if (wishSpeed <= 0) return;
  const current = s.vx * wx + s.vz * wz;
  const add = wishSpeed - current;
  if (add <= 0) return;
  let a = accel * dt * wishSpeed;
  if (a > add) a = add;
  s.vx += a * wx;
  s.vz += a * wz;
}

/** Can a standing player occupy (x, y, z)? Used for spawning and tests. */
export function standingClear(world: World, x: number, y: number, z: number, scratch: MoveScratch): boolean {
  return !solidInRange(world, x, z, MOVEMENT.radius, y + MOVEMENT.stepHeight, y + MOVEMENT.height, scratch.ids);
}
