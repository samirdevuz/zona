import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CLASSES, TEAM_COLOR_HEX, type ClassId } from '@zona/shared';
import { assets } from './assets';
import type { CharacterPose } from './characters';
import { GeoBuilder } from './geom';

/** Rigged CC0 soldier (Quaternius' Animated Human, built by scripts/assets). */
export const SOLDIER_ID = 'character.soldier';

const RIGHT = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const q3 = new THREE.Quaternion();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();

/** Rotate a bone by `angle` about a world-space axis (matrices of its parent must be current). */
function rotateWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
  if (angle === 0) return;
  bone.parent!.getWorldQuaternion(q1);
  q2.setFromAxisAngle(axis, angle);
  // local' = parent^-1 * axisRot * parent * local
  const inv = q1.clone().invert();
  bone.quaternion.premultiply(inv.multiply(q2).multiply(q1));
  bone.updateMatrixWorld(true);
}

/** Turn `bone` so that the direction to its child `tip` points along `dirWorld`. */
function aimBone(bone: THREE.Object3D, tip: THREE.Object3D, dirWorld: THREE.Vector3): void {
  bone.getWorldPosition(v1);
  tip.getWorldPosition(v2);
  const cur = v2.sub(v1).normalize();
  q2.setFromUnitVectors(cur, v3.copy(dirWorld).normalize());
  bone.getWorldQuaternion(q1);
  q1.premultiply(q2); // new world rotation
  const parentInv = bone.parent!.getWorldQuaternion(q3).invert();
  bone.quaternion.copy(parentInv.multiply(q1));
  bone.updateMatrixWorld(true);
}

/**
 * Two-bone IK: place the hand of upper -> lower -> hand at `target`, elbow bent
 * towards `pole` (world direction).
 */
function solveArm(upper: THREE.Object3D, lower: THREE.Object3D, hand: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3): void {
  const s = upper.getWorldPosition(new THREE.Vector3());
  const e = lower.getWorldPosition(new THREE.Vector3());
  const h = hand.getWorldPosition(new THREE.Vector3());
  const a = s.distanceTo(e);
  const b = e.distanceTo(h);
  const toT = target.clone().sub(s);
  const d = Math.min(Math.max(toT.length(), Math.abs(a - b) + 1e-3), a + b - 1e-3);
  const dir = toT.normalize();
  const along = (a * a - b * b + d * d) / (2 * d);
  const hgt = Math.sqrt(Math.max(0, a * a - along * along));
  const p = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  const elbow = s.clone().addScaledVector(dir, along).addScaledVector(p, hgt);
  aimBone(upper, lower, elbow.clone().sub(s));
  const e2 = lower.getWorldPosition(new THREE.Vector3());
  const end = s.clone().addScaledVector(dir, d);
  aimBone(lower, hand, end.sub(e2));
}

interface Bones {
  hips: THREE.Bone;
  spine1: THREE.Bone;
  spine2: THREE.Bone;
  head: THREE.Bone;
  rArm: THREE.Bone;
  rFore: THREE.Bone;
  rHand: THREE.Bone;
  lArm: THREE.Bone;
  lFore: THREE.Bone;
  lHand: THREE.Bone;
  lUpLeg: THREE.Bone;
  lLeg: THREE.Bone;
  rUpLeg: THREE.Bone;
  rLeg: THREE.Bone;
}

/** Gun grip and support-hand points in the gun's (viewmodel) frame, and the muzzle. */
const GRIP = new THREE.Vector3(0, -0.07, 0.05);
const SUPPORT: Record<string, number> = { ar1: -0.37, smg1: -0.22, lmg1: -0.4, bolt1: -0.38 };
const MUZZLE: Record<string, number> = { ar1: -0.68, smg1: -0.42, lmg1: -0.78, bolt1: -0.9 };
/** Gun origin relative to the chest bone, in aim space (x right, y up, z forward=-). */
const GUN_AT = new THREE.Vector3(0.13, 0.03, -0.24);

/** Animated soldier: mixer for the legs, procedural crouch/aim, IK arms on the gun. */
export class SoldierCharacter {
  readonly root = new THREE.Group();
  /** Kept for API compatibility with the procedural character. */
  readonly body = new THREE.Group();
  stride = 0;
  dead = false;
  private readonly model: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private readonly b: Bones;
  private readonly gun = new THREE.Group();
  private readonly gear = new THREE.Group();
  private readonly weapon: string;
  private crouch = 0;
  private readonly chest = new THREE.Vector3();
  private readonly tR = new THREE.Vector3();
  private readonly tL = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private lastX = NaN;
  private lastZ = NaN;

  constructor(
    readonly team: number,
    readonly cls: ClassId,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    castShadow: boolean,
    gunGeo: THREE.BufferGeometry | null,
    gunMat: THREE.Material,
  ) {
    const g = assets.gltf(SOLDIER_ID)!;
    this.model = cloneSkinned(g.scene);
    this.model.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) {
        o.geometry = geo;
        o.material = mat;
        o.castShadow = castShadow;
        o.frustumCulled = false; // bounds of the bind pose do not follow the animation
      }
    });
    this.body.add(this.model);
    this.root.add(this.body, this.gun, this.gear);
    const find = (n: string): THREE.Bone => this.model.getObjectByName(n) as THREE.Bone;
    this.b = {
      hips: find('Hips'),
      spine1: find('Spine1'),
      spine2: find('Spine2'),
      head: find('Head'),
      rArm: find('RightArm'),
      rFore: find('RightForeArm'),
      rHand: find('RightHand'),
      lArm: find('LeftArm'),
      lFore: find('LeftForeArm'),
      lHand: find('LeftHand'),
      lUpLeg: find('LeftUpLeg'),
      lLeg: find('LeftLeg'),
      rUpLeg: find('RightUpLeg'),
      rLeg: find('RightLeg'),
    };
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of g.animations) {
      const a = this.mixer.clipAction(clip);
      if (clip.name === 'death' || clip.name === 'jump') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions.set(clip.name, a);
    }
    this.weapon = CLASSES[cls].slots[0];
    if (gunGeo) {
      const m = new THREE.Mesh(gunGeo, gunMat);
      m.castShadow = castShadow;
      this.gun.add(m);
    }
    // Class gear (GAME.md 11 silhouettes): engineer backpack, gunner ammo pouch.
    const gb = new GeoBuilder();
    if (cls === 'engineer') {
      gb.box(0, -0.02, 0.24, 0.36, 0.46, 0.2, 0x3f4a2a);
      gb.box(0.12, 0.3, 0.3, 0.04, 0.3, 0.04, 0x777777);
    } else if (cls === 'gunner') gb.box(0, -0.12, -0.17, 0.3, 0.16, 0.1, 0x3a3f2a);
    else gb.box(0, -0.04, 0.17, 0.26, 0.28, 0.1, 0x3f4a2a);
    const gm = new THREE.Mesh(gb.build(), gunMat);
    gm.castShadow = castShadow;
    this.gear.add(gm);
    this.play('idle', 0);
  }

  private play(name: string, fade = 0.18, timeScale = 1): void {
    const a = this.actions.get(name);
    if (!a) return;
    a.timeScale = timeScale;
    if (this.current === a) return;
    a.reset();
    a.play();
    if (this.current && fade > 0) a.crossFadeFrom(this.current, fade, false);
    else if (this.current) this.current.stop();
    this.current = a;
  }

  /** Muzzle position in world space (for tracers). */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0.02, MUZZLE[this.weapon] ?? -0.68);
    return this.gun.localToWorld(out);
  }

  update(p: CharacterPose, dt: number): void {
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.yaw;
    // Movement direction (backwards plays the cycle in reverse).
    let back = false;
    if (!Number.isNaN(this.lastX) && dt > 0) {
      const vx = (p.x - this.lastX) / dt;
      const vz = (p.z - this.lastZ) / dt;
      back = -Math.sin(p.yaw) * vx - Math.cos(p.yaw) * vz < -0.5;
    }
    this.lastX = p.x;
    this.lastZ = p.z;
    const speed = Math.min(p.speed, 9);
    if (!p.alive) {
      if (!this.dead) {
        this.dead = true;
        this.play('death', 0.1);
      }
      this.gun.visible = false;
      this.gear.visible = false;
      this.mixer.update(dt);
      return;
    }
    if (this.dead) {
      this.dead = false;
      this.current?.stop();
      this.current = null;
    }
    this.gun.visible = true;
    this.gear.visible = true;
    if (p.onGround) this.stride += speed * dt;
    if (!p.onGround) this.play('jump', 0.1, 1.2);
    else if (speed > 3.2) this.play('run', 0.2, (back ? -1 : 1) * Math.max(0.6, speed / 6.5));
    else if (speed > 0.4) this.play('walk', 0.2, (back ? -1 : 1) * Math.max(0.5, speed / 1.8));
    else this.play('idle', 0.25);
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);

    const b = this.b;
    RIGHT.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    // Crouch: drop the body and fold the legs.
    this.crouch += ((p.crouched ? 1 : 0) - this.crouch) * Math.min(1, dt * 12);
    const c = this.crouch;
    this.body.position.y = -c * 0.42;
    if (c > 0.01) {
      this.body.updateMatrixWorld(true);
      for (const [up, low] of [
        [b.lUpLeg, b.lLeg],
        [b.rUpLeg, b.rLeg],
      ] as const) {
        rotateWorld(up, RIGHT, c * 1.35);
        rotateWorld(low, RIGHT, -c * 1.9);
      }
    }
    // Aim pitch through the upper body, sprint lean.
    const lean = p.sprinting ? -0.2 : 0;
    rotateWorld(b.spine1, RIGHT, p.pitch * 0.4 + lean * 0.5);
    rotateWorld(b.spine2, RIGHT, p.pitch * 0.4 + lean * 0.5);
    rotateWorld(b.head, RIGHT, p.pitch * 0.2);
    // Gun and gear follow the chest in aim space.
    const chest = b.spine2.getWorldPosition(this.chest);
    this.root.worldToLocal(chest);
    const aimPitch = p.sprinting ? -0.45 : p.pitch;
    this.gun.rotation.set(aimPitch, 0, 0);
    this.gun.position.copy(GUN_AT).applyEuler(this.gun.rotation).add(chest);
    this.gear.position.copy(chest);
    this.gear.rotation.set(p.pitch * 0.8 + lean, 0, 0);
    this.gun.updateMatrixWorld(true);
    this.gear.updateMatrixWorld(true);
    // Hands on the gun: right on the grip, left on the handguard.
    this.gun.localToWorld(this.tR.copy(GRIP));
    this.gun.localToWorld(this.tL.set(-0.01, -0.05, SUPPORT[this.weapon] ?? -0.3));
    this.pole.set(0, -1, 0).addScaledVector(RIGHT, 0.6);
    solveArm(b.rArm, b.rFore, b.rHand, this.tR, this.pole);
    this.pole.set(0, -1, 0).addScaledVector(RIGHT, -0.6);
    solveArm(b.lArm, b.lFore, b.lHand, this.tL, this.pole);
  }

  /** Test hook: world positions of the rig's key points. */
  debug(): Record<string, number[]> {
    const w = (o: THREE.Object3D): number[] => o.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Math.round(v * 100) / 100);
    return { root: w(this.root), gun: w(this.gun), chest: w(this.b.spine2), rHand: w(this.b.rHand), lHand: w(this.b.lHand), rArm: w(this.b.rArm), lArm: w(this.b.lArm), head: w(this.b.head), tR: this.tR.toArray(), tL: this.tL.toArray(), gunKids: [this.gun.children.length] };
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
  }
}

/** Per-team geometry of the rigged soldier (vest and helmet in team colours). */
export function soldierGeometry(team: number): THREE.BufferGeometry | null {
  const g = assets.gltf(SOLDIER_ID);
  let base: THREE.BufferGeometry | null = null;
  g?.scene.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) base = o.geometry as THREE.BufferGeometry;
  });
  if (!base) return null;
  const geo = (base as THREE.BufferGeometry).clone();
  const mask = geo.getAttribute('_team');
  const col = geo.getAttribute('color');
  if (!mask || !col) return geo;
  const vest = new THREE.Color().setHex(TEAM_COLOR_HEX[team] ?? 0xffffff).multiplyScalar(0.85);
  const helmet = new THREE.Color().setHex(TEAM_COLOR_HEX[team] ?? 0xffffff).multiplyScalar(0.6);
  for (let i = 0; i < mask.count; i++) {
    const m = mask.getX(i);
    if (m === 1) col.setXYZ(i, vest.r, vest.g, vest.b);
    else if (m === 2) col.setXYZ(i, helmet.r, helmet.g, helmet.b);
  }
  col.needsUpdate = true;
  return geo;
}
