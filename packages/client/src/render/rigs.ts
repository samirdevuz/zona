import * as THREE from 'three';
import type { World } from '@zona/shared';

/** Camera modes (GAME.md 8.2). */
export type CameraMode = 'first' | 'third' | 'top';
export const CAMERA_MODES: readonly CameraMode[] = ['first', 'third', 'top'];

export interface RigVehicle {
  kind: 'jeep' | 'tank';
  x: number;
  y: number;
  z: number;
}

/** Everything a rig needs to place the camera this frame. */
export interface RigFrame {
  /** First-person eye (player head or seat). */
  eye: THREE.Vector3;
  /** View angles: mouse look (or turret direction in the tank sight). */
  yaw: number;
  pitch: number;
  world: World;
  vehicle: RigVehicle | null;
  /** Looking through a scope: third person temporarily uses the first-person view. */
  scoped: boolean;
  /** 0..1 aim-down-sights blend. */
  adsT: number;
  /** +1 right shoulder, -1 left. */
  shoulder: number;
  /** Top-down zoom factor (>1 = higher camera; sniper ADS). */
  topZoom: number;
}

/** Camera rig abstraction (GAME.md 3.2): the server never sees which one is used. */
export interface CameraRig {
  readonly id: CameraMode;
  /** First-person weapon model visible. */
  showViewmodel(f: RigFrame): boolean;
  /** The local player's full-body character visible. */
  showLocalBody(f: RigFrame): boolean;
  apply(camera: THREE.PerspectiveCamera, f: RigFrame, dt: number): void;
}

export class FirstPersonRig implements CameraRig {
  readonly id = 'first' as const;
  showViewmodel(): boolean {
    return true;
  }
  showLocalBody(): boolean {
    return false;
  }
  apply(camera: THREE.PerspectiveCamera, f: RigFrame): void {
    camera.position.copy(f.eye);
    camera.rotation.set(f.pitch, f.yaw, 0, 'YXZ');
  }
}

const tmpFwd = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpPivot = new THREE.Vector3();
const tmpWant = new THREE.Vector3();
const tmpShoulder = new THREE.Vector3();

/** Pull a camera back towards its pivot if static geometry is in the way. */
function collide(world: World, pivot: THREE.Vector3, want: THREE.Vector3, out: THREE.Vector3): void {
  const dx = want.x - pivot.x;
  const dy = want.y - pivot.y;
  const dz = want.z - pivot.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-4) {
    out.copy(want);
    return;
  }
  const t = world.raycastStatic(pivot.x, pivot.y, pivot.z, dx / len, dy / len, dz / len, len);
  const d = t < len ? Math.max(0.25, t - 0.3) : len;
  out.set(pivot.x + (dx / len) * d, pivot.y + (dy / len) * d, pivot.z + (dz / len) * d);
  const g = world.terrain.heightAt(out.x, out.z) + 0.3;
  if (out.y < g) out.y = g;
}

/** Over-the-shoulder camera with shoulder swap and collision (GAME.md 8.2). */
export class ThirdPersonRig implements CameraRig {
  readonly id = 'third' as const;
  private dist = 2.8;
  showViewmodel(f: RigFrame): boolean {
    return f.scoped;
  }
  showLocalBody(f: RigFrame): boolean {
    return !f.scoped;
  }
  apply(camera: THREE.PerspectiveCamera, f: RigFrame, dt: number): void {
    if (f.scoped) {
      camera.position.copy(f.eye);
      camera.rotation.set(f.pitch, f.yaw, 0, 'YXZ');
      return;
    }
    camera.rotation.set(f.pitch, f.yaw, 0, 'YXZ');
    camera.updateMatrixWorld();
    tmpFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    tmpRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    let want: number;
    let side: number;
    if (f.vehicle) {
      // Chase camera around the vehicle.
      const tank = f.vehicle.kind === 'tank';
      tmpPivot.set(f.vehicle.x, f.vehicle.y + (tank ? 3.4 : 2.6), f.vehicle.z);
      want = tank ? 9 : 7;
      side = 0;
    } else {
      tmpPivot.copy(f.eye);
      want = 2.8 - 1.4 * f.adsT;
      side = (0.55 - 0.1 * f.adsT) * f.shoulder;
    }
    this.dist += (want - this.dist) * Math.min(1, dt * 10);
    tmpWant.copy(tmpPivot).addScaledVector(tmpRight, side).addScaledVector(tmpFwd, -this.dist);
    tmpWant.y += f.vehicle ? 0 : 0.25;
    // The shoulder offset itself must not poke through walls either.
    tmpShoulder.copy(tmpPivot).addScaledVector(tmpRight, side);
    collide(f.world, tmpPivot, tmpShoulder, tmpShoulder);
    collide(f.world, tmpShoulder, tmpWant, camera.position);
  }
}

/** Angled top-down camera, north-up; the mouse moves a cursor on the ground (GAME.md 8.2). */
export class TopDownRig implements CameraRig {
  readonly id = 'top' as const;
  private zoom = 1;
  showViewmodel(): boolean {
    return false;
  }
  showLocalBody(): boolean {
    return true;
  }
  apply(camera: THREE.PerspectiveCamera, f: RigFrame, dt: number): void {
    const base = f.vehicle ? f.vehicle : f.eye;
    const groundY = f.vehicle ? f.vehicle.y : f.eye.y - 1.6;
    const want = f.topZoom * (f.vehicle?.kind === 'tank' ? 1.25 : 1);
    this.zoom += (want - this.zoom) * Math.min(1, dt * 6);
    const h = 26 * this.zoom;
    const back = 13 * this.zoom;
    camera.position.set(base.x, groundY + h, base.z + back);
    camera.rotation.set(-Math.atan2(h, back), 0, 0, 'YXZ');
  }
}

export function createRig(mode: CameraMode): CameraRig {
  return mode === 'third' ? new ThirdPersonRig() : mode === 'top' ? new TopDownRig() : new FirstPersonRig();
}
