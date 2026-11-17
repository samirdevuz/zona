import { MOVEMENT } from '../config/movement';
import { TANK, VEHICLES, VEHICLE_RULES, type VehicleKind } from '../config/vehicles';
import { COLLIDER_BOX } from '../map/types';
import type { World } from '../map/world';
import { DEG2RAD, datan2, dcos, dsin, wrapAngle } from '../math/trig';
import { BTN } from './input';

/** Vehicle state simulated identically on server and driving client (GAME.md 3.4, 6). */
export interface VehicleState {
  kind: VehicleKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Signed forward speed. */
  speed: number;
  vy: number;
  airborne: boolean;
  /** Body tilt from terrain (nose up / left side up), radians. */
  pitch: number;
  roll: number;
  /** Tank turret world yaw and barrel pitch. */
  turretYaw: number;
  turretPitch: number;
  cannonCd: number;
  mgCd: number;
  /** Seconds of continuous coax fire (overheats at TANK.coax.overheatAfterS). */
  heat: number;
  overheatT: number;
  prevB: number;
}

export const VACT_CANNON = 1;
export const VACT_MG = 2;

export function createVehicleState(kind: VehicleKind, x: number, y: number, z: number, yaw: number): VehicleState {
  return {
    kind,
    x,
    y,
    z,
    yaw,
    speed: 0,
    vy: 0,
    airborne: false,
    pitch: 0,
    roll: 0,
    turretYaw: yaw,
    turretPitch: 0,
    cannonCd: 0,
    mgCd: 0,
    heat: 0,
    overheatT: 0,
    prevB: 0,
  };
}

export function copyVehicleState(out: VehicleState, v: VehicleState): VehicleState {
  out.kind = v.kind;
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
  out.yaw = v.yaw;
  out.speed = v.speed;
  out.vy = v.vy;
  out.airborne = v.airborne;
  out.pitch = v.pitch;
  out.roll = v.roll;
  out.turretYaw = v.turretYaw;
  out.turretPitch = v.turretPitch;
  out.cannonCd = v.cannonCd;
  out.mgCd = v.mgCd;
  out.heat = v.heat;
  out.overheatT = v.overheatT;
  out.prevB = v.prevB;
  return out;
}

export interface VehicleScratch {
  ids: number[];
}
export function createVehicleScratch(): VehicleScratch {
  return { ids: [] };
}

/** World position of a point given in vehicle space (x right, f forward), ignoring tilt. */
export function vehiclePoint(v: VehicleState, lx: number, ly: number, lf: number, out: { x: number; y: number; z: number }): void {
  const s = dsin(v.yaw);
  const c = dcos(v.yaw);
  // right = (cos, -sin), forward = (-sin, -cos)
  out.x = v.x + c * lx - s * lf;
  out.y = v.y + ly;
  out.z = v.z - s * lx - c * lf;
}

function approach(cur: number, target: number, maxDelta: number): number {
  if (cur < target) return Math.min(target, cur + maxDelta);
  return Math.max(target, cur - maxDelta);
}

/**
 * Advance a vehicle by one fixed step. `driving` = a driver is inputting.
 * Returns a VACT_* bitmask of weapons fired (tank only).
 */
export function stepVehicle(world: World, v: VehicleState, buttons: number, aimYaw: number, aimPitch: number, dt: number, driving: boolean, sc: VehicleScratch): number {
  const def = VEHICLES[v.kind];
  const b = driving ? buttons : 0;
  const pressed = b & ~v.prevB;
  v.prevB = b;
  const throttle = ((b & BTN.FORWARD) !== 0 ? 1 : 0) - ((b & BTN.BACK) !== 0 ? 1 : 0);
  const steer = ((b & BTN.LEFT) !== 0 ? 1 : 0) - ((b & BTN.RIGHT) !== 0 ? 1 : 0);

  // Longitudinal speed.
  if (!v.airborne) {
    if (throttle > 0) v.speed = v.speed < 0 ? Math.min(0, v.speed + def.brake * dt) : Math.min(def.maxSpeed, v.speed + def.accel * dt);
    else if (throttle < 0) v.speed = v.speed > 0 ? Math.max(0, v.speed - def.brake * dt) : Math.max(-def.reverseSpeed, v.speed - def.accel * 0.6 * dt);
    else v.speed = approach(v.speed, 0, def.drag * dt);
  }
  // Steering.
  if (steer !== 0 && !v.airborne) {
    if (v.kind === 'tank') {
      v.yaw = wrapAngle(v.yaw + steer * def.turnRate * dt);
    } else {
      const sp = Math.abs(v.speed);
      const k = Math.min(1, sp / def.turnSpeedRef) * (1 - def.turnHighSpeedLoss * (sp / def.maxSpeed));
      v.yaw = wrapAngle(v.yaw + steer * def.turnRate * k * (v.speed >= 0 ? 1 : -1) * dt);
    }
  }

  // Horizontal move + push-out against static colliders (circles along the body axis).
  const s = dsin(v.yaw);
  const c = dcos(v.yaw);
  let nx = v.x - s * v.speed * dt;
  let nz = v.z - c * v.speed * dt;
  const r = def.circleRadius;
  const lo = v.y + VEHICLE_RULES.passableHeight;
  const hi = v.y + def.height;
  let impact = false;
  for (let it = 0; it < 3; it++) {
    let pushed = false;
    for (const off of def.circles) {
      const cx = nx - s * off;
      const cz = nz - c * off;
      const n = world.query(cx - r, cz - r, cx + r, cz + r, sc.ids);
      for (let i = 0; i < n; i++) {
        const col = world.colliders[sc.ids[i]!]!;
        if (col.maxY <= lo || col.minY >= hi) continue;
        let dx: number;
        let dz: number;
        let pen: number;
        if (col.kind === COLLIDER_BOX) {
          const qx = cx < col.minX ? col.minX : cx > col.maxX ? col.maxX : cx;
          const qz = cz < col.minZ ? col.minZ : cz > col.maxZ ? col.maxZ : cz;
          dx = cx - qx;
          dz = cz - qz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          const d = Math.sqrt(d2);
          if (d > 1e-6) {
            dx /= d;
            dz /= d;
            pen = r - d;
          } else {
            // Centre inside the box: push along the shortest axis.
            const left = cx - col.minX;
            const right = col.maxX - cx;
            const back = cz - col.minZ;
            const front = col.maxZ - cz;
            const m = Math.min(left, right, back, front);
            dx = m === left ? -1 : m === right ? 1 : 0;
            dz = dx !== 0 ? 0 : m === back ? -1 : 1;
            pen = m + r;
          }
        } else {
          dx = cx - col.cx;
          dz = cz - col.cz;
          const rr = r + col.r;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr) continue;
          const d = Math.sqrt(d2);
          if (d > 1e-6) {
            dx /= d;
            dz /= d;
          } else {
            dx = 1;
            dz = 0;
          }
          pen = rr - d;
        }
        nx += dx * pen;
        nz += dz * pen;
        pushed = true;
        // Hitting something head-on kills most of the speed.
        const fwdDot = (-s * dx - c * dz) * (v.speed >= 0 ? 1 : -1);
        if (fwdDot < -0.5) impact = true;
      }
    }
    if (!pushed) break;
  }
  if (impact) v.speed *= VEHICLE_RULES.impactKeep;
  const m = def.circleRadius + MOVEMENT.worldEdgeMargin;
  const minX = world.minX + m;
  const maxX = world.maxX - m;
  const minZ = world.minZ + m;
  const maxZ = world.maxZ - m;
  if (nx < minX) nx = minX;
  else if (nx > maxX) nx = maxX;
  if (nz < minZ) nz = minZ;
  else if (nz > maxZ) nz = maxZ;
  v.x = nx;
  v.z = nz;

  // Terrain following from four sampled corners.
  const hl = def.halfLength * 0.85;
  const hw = def.halfWidth * 0.85;
  const t = world.terrain;
  const hFL = t.heightAt(nx - s * hl - c * hw, nz - c * hl + s * hw);
  const hFR = t.heightAt(nx - s * hl + c * hw, nz - c * hl - s * hw);
  const hRL = t.heightAt(nx + s * hl - c * hw, nz + c * hl + s * hw);
  const hRR = t.heightAt(nx + s * hl + c * hw, nz + c * hl - s * hw);
  const groundY = (hFL + hFR + hRL + hRR) * 0.25;
  if (v.airborne) {
    v.vy -= VEHICLE_RULES.gravity * dt;
    v.y += v.vy * dt;
    if (v.y <= groundY) {
      v.y = groundY;
      v.vy = 0;
      v.airborne = false;
    }
  } else if (groundY < v.y - 0.6) {
    v.airborne = true;
    v.vy = 0;
  } else {
    v.y = groundY;
  }
  v.pitch = datan2((hFL + hFR) * 0.5 - (hRL + hRR) * 0.5, 2 * hl);
  v.roll = datan2((hFL + hRL) * 0.5 - (hFR + hRR) * 0.5, 2 * hw);
  // Too steep to climb: the vehicle stalls.
  const maxClimb = def.maxClimbDeg * DEG2RAD;
  if ((v.speed > 0 && v.pitch > maxClimb) || (v.speed < 0 && v.pitch < -maxClimb)) v.speed *= 0.85;

  // Tank turret and weapons.
  let act = 0;
  if (v.kind === 'tank') {
    const rate = TANK.turretRateDegPerS * DEG2RAD * dt;
    const dyaw = wrapAngle(aimYaw - v.turretYaw);
    v.turretYaw = wrapAngle(v.turretYaw + (dyaw > rate ? rate : dyaw < -rate ? -rate : dyaw));
    const pmin = TANK.turretPitchMinDeg * DEG2RAD;
    const pmax = TANK.turretPitchMaxDeg * DEG2RAD;
    const tp = aimPitch < pmin ? pmin : aimPitch > pmax ? pmax : aimPitch;
    v.turretPitch = approach(v.turretPitch, tp, rate);
    if (v.cannonCd > 0) v.cannonCd = Math.max(0, v.cannonCd - dt);
    if (v.mgCd > 0) v.mgCd -= dt;
    if (v.overheatT > 0) v.overheatT = Math.max(0, v.overheatT - dt);
    if (driving && (pressed & BTN.FIRE) !== 0 && v.cannonCd <= 0) {
      v.cannonCd = TANK.cannon.reloadS;
      act |= VACT_CANNON;
    }
    const mgHeld = driving && (b & BTN.ADS) !== 0 && v.overheatT <= 0;
    if (mgHeld) {
      v.heat += dt;
      if (v.heat >= TANK.coax.overheatAfterS) {
        v.heat = TANK.coax.overheatAfterS;
        v.overheatT = TANK.coax.lockS;
      } else if (v.mgCd <= 1e-9) {
        v.mgCd = (v.mgCd < 0 ? v.mgCd : 0) + 60 / TANK.coax.rpm;
        act |= VACT_MG;
      }
    } else {
      if (v.mgCd < 0) v.mgCd = 0;
      v.heat = Math.max(0, v.heat - TANK.coax.coolPerS * dt);
    }
  }
  return act;
}

/** Ray vs the vehicle's body box (yaw only). Returns distance or Infinity. */
export function rayVehicle(v: VehicleState, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
  const def = VEHICLES[v.kind];
  const s = dsin(v.yaw);
  const c = dcos(v.yaw);
  // Into vehicle space: lx = right component, lf = forward component.
  const px = ox - v.x;
  const pz = oz - v.z;
  const lx = c * px - s * pz;
  const lf = -s * px - c * pz;
  const ly = oy - v.y;
  const dlx = c * dx - s * dz;
  const dlf = -s * dx - c * dz;
  let tmin = 0;
  let tmax = Infinity;
  const slab = (o: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    return tmin <= tmax;
  };
  if (!slab(lx, dlx, -def.halfWidth, def.halfWidth)) return Infinity;
  if (!slab(lf, dlf, -def.halfLength, def.halfLength)) return Infinity;
  if (!slab(ly, dy, 0.2, def.height)) return Infinity;
  return tmin;
}

/** Distance from a point to the vehicle's body box (0 inside). */
export function distToVehicle(v: VehicleState, x: number, y: number, z: number): number {
  const def = VEHICLES[v.kind];
  const s = dsin(v.yaw);
  const c = dcos(v.yaw);
  const px = x - v.x;
  const pz = z - v.z;
  const lx = c * px - s * pz;
  const lf = -s * px - c * pz;
  const ly = y - v.y;
  const ex = Math.max(0, Math.abs(lx) - def.halfWidth);
  const ef = Math.max(0, Math.abs(lf) - def.halfLength);
  const ey = ly < 0.2 ? 0.2 - ly : ly > def.height ? ly - def.height : 0;
  return Math.sqrt(ex * ex + ef * ef + ey * ey);
}

/**
 * Push a vertical circle (an infantry player) out of the vehicle's collision
 * circles. Returns true if it moved. Server-side only (DECISIONS.md).
 */
export function pushOutOfVehicle(v: VehicleState, p: { x: number; z: number }, radius: number): boolean {
  const def = VEHICLES[v.kind];
  const s = dsin(v.yaw);
  const c = dcos(v.yaw);
  let moved = false;
  for (const off of def.circles) {
    const cx = v.x - s * off;
    const cz = v.z - c * off;
    let dx = p.x - cx;
    let dz = p.z - cz;
    const rr = def.circleRadius + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2);
    if (d > 1e-6) {
      dx /= d;
      dz /= d;
    } else {
      dx = c;
      dz = -s;
    }
    p.x = cx + dx * rr;
    p.z = cz + dz * rr;
    moved = true;
  }
  return moved;
}
