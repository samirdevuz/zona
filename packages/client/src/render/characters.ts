import * as THREE from 'three';
import { CLASS_IDS, TEAM_COLOR_HEX, type ClassId } from '@zona/shared';
import { GeoBuilder } from './geom';

const PANTS = 0x4b5320;
const SHIRT = 0x5f6b3a;
const SKIN = 0xd8a77f;
const BOOTS = 0x2b2b2b;
const GUN = 0x262626;
const POUCH = 0x3f4a2a;
const HOOD = 0x56603a;

const B_HIPS = 0;
const B_SPINE = 1;
const B_HEAD = 2;
const B_THIGH_L = 3;
const B_SHIN_L = 4;
const B_THIGH_R = 5;
const B_SHIN_R = 6;

function shade(hex: number, k: number): number {
  return new THREE.Color().setHex(hex).multiplyScalar(k).getHex();
}

/**
 * Low-poly humanoid as one skinned geometry (a single draw call per character).
 * Class silhouettes (GAME.md 11): Assault standard, Engineer backpack, Gunner bulky,
 * Sniper hooded with a long rifle.
 */
function buildCharacterGeometry(team: number, cls: ClassId): THREE.BufferGeometry {
  const vest = shade(TEAM_COLOR_HEX[team] ?? 0xffffff, 0.85);
  const helmet = shade(TEAM_COLOR_HEX[team] ?? 0xffffff, 0.6);
  const bulk = cls === 'gunner' ? 1.18 : 1;
  const b = new GeoBuilder();
  b.box(0, 0.92, 0, 0.38 * bulk, 0.2, 0.24 * bulk, PANTS, B_HIPS);
  b.box(0, 1.25, 0, 0.44 * bulk, 0.5, 0.26 * bulk, SHIRT, B_SPINE);
  b.box(0, 1.24, 0, 0.48 * bulk, 0.4, 0.31 * bulk, vest, B_SPINE);
  if (cls === 'engineer') {
    b.box(0, 1.28, 0.27, 0.38, 0.5, 0.22, POUCH, B_SPINE); // big backpack
    b.box(0.16, 1.55, 0.3, 0.04, 0.3, 0.04, 0x777777, B_SPINE); // antenna/tube
  } else if (cls === 'gunner') {
    b.box(0, 1.22, 0.22, 0.4, 0.34, 0.14, POUCH, B_SPINE);
    b.box(0, 1.47, 0, 0.62, 0.12, 0.34, vest, B_SPINE); // shoulder pads
  } else {
    b.box(0, 1.26, 0.2, 0.3, 0.32, 0.12, POUCH, B_SPINE);
  }
  // Arms holding the weapon (rigid with the upper body so aim pitch moves them together).
  b.box(0.27 * bulk, 1.32, -0.06, 0.12 * bulk, 0.3, 0.12 * bulk, SHIRT, B_SPINE, 0.6, 0, 0);
  b.box(0.17, 1.21, -0.3, 0.1, 0.1, 0.34, SHIRT, B_SPINE, 0, 0.35, 0);
  b.box(-0.26 * bulk, 1.32, -0.1, 0.12 * bulk, 0.3, 0.12 * bulk, SHIRT, B_SPINE, 0.9, 0, 0);
  b.box(-0.1, 1.25, -0.42, 0.1, 0.1, 0.38, SHIRT, B_SPINE, 0, -0.65, 0);
  b.box(0.08, 1.23, -0.44, 0.09, 0.09, 0.1, SKIN, B_SPINE);
  b.box(0.04, 1.27, -0.62, 0.09, 0.09, 0.1, SKIN, B_SPINE);
  // Primary weapon.
  if (cls === 'sniper') {
    b.box(0.05, 1.29, -0.55, 0.06, 0.1, 0.9, GUN, B_SPINE);
    b.box(0.05, 1.31, -1.15, 0.035, 0.035, 0.5, GUN, B_SPINE);
    b.box(0.05, 1.39, -0.45, 0.06, 0.07, 0.3, 0x111111, B_SPINE); // scope
  } else if (cls === 'gunner') {
    b.box(0.05, 1.27, -0.5, 0.1, 0.15, 0.78, GUN, B_SPINE);
    b.box(0.05, 1.29, -1.02, 0.05, 0.05, 0.34, GUN, B_SPINE);
    b.box(0.05, 1.14, -0.42, 0.16, 0.14, 0.16, 0x3a3f2a, B_SPINE); // box magazine
  } else if (cls === 'engineer') {
    b.box(0.05, 1.29, -0.42, 0.07, 0.12, 0.5, GUN, B_SPINE);
    b.box(0.05, 1.31, -0.75, 0.04, 0.04, 0.18, GUN, B_SPINE);
    b.box(0.05, 1.16, -0.38, 0.05, 0.22, 0.06, GUN, B_SPINE);
    // Launcher strapped on the back.
    b.box(0.12, 1.4, 0.36, 0.12, 0.12, 0.95, 0x3d4a2f, B_SPINE, 0, 0, 0.5);
  } else {
    b.box(0.05, 1.29, -0.5, 0.07, 0.12, 0.7, GUN, B_SPINE);
    b.box(0.05, 1.31, -0.98, 0.04, 0.04, 0.3, GUN, B_SPINE);
    b.box(0.05, 1.16, -0.46, 0.05, 0.18, 0.08, GUN, B_SPINE, -0.2, 0, 0);
  }
  b.box(0.05, 1.27, -0.09, 0.06, 0.13, 0.22, GUN, B_SPINE);
  // Head: helmet (team colour) or hood (sniper).
  b.box(0, 1.62, 0, 0.22, 0.24, 0.24, SKIN, B_HEAD);
  if (cls === 'sniper') {
    b.box(0, 1.68, 0.03, 0.29, 0.3, 0.3, HOOD, B_HEAD);
    b.box(0, 1.6, -0.13, 0.2, 0.05, 0.03, helmet, B_HEAD); // team-coloured band
  } else {
    b.box(0, 1.76, 0.01, 0.28, 0.12, 0.3, helmet, B_HEAD);
    b.box(0, 1.71, -0.14, 0.26, 0.04, 0.06, helmet, B_HEAD);
  }
  for (const [sx, thigh, shin] of [
    [-1, B_THIGH_L, B_SHIN_L],
    [1, B_THIGH_R, B_SHIN_R],
  ] as const) {
    b.box(sx * 0.12 * bulk, 0.69, 0, 0.16 * bulk, 0.44, 0.18 * bulk, PANTS, thigh);
    b.box(sx * 0.12 * bulk, 0.28, 0, 0.14 * bulk, 0.42, 0.16 * bulk, PANTS, shin);
    b.box(sx * 0.12 * bulk, 0.05, -0.04, 0.15 * bulk, 0.1, 0.26, BOOTS, shin);
  }
  return b.build();
}

function buildSkeleton(): { bones: THREE.Bone[]; skeleton: THREE.Skeleton } {
  const mk = (x: number, y: number, z: number): THREE.Bone => {
    const bone = new THREE.Bone();
    bone.position.set(x, y, z);
    return bone;
  };
  const hips = mk(0, 0.95, 0);
  const spine = mk(0, 0.1, 0);
  const head = mk(0, 0.5, 0);
  const thighL = mk(-0.12, -0.05, 0);
  const shinL = mk(0, -0.42, 0);
  const thighR = mk(0.12, -0.05, 0);
  const shinR = mk(0, -0.42, 0);
  hips.add(spine, thighL, thighR);
  spine.add(head);
  thighL.add(shinL);
  thighR.add(shinR);
  const bones = [hips, spine, head, thighL, shinL, thighR, shinR];
  return { bones, skeleton: new THREE.Skeleton(bones) };
}

export interface CharacterPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  speed: number;
  crouched: boolean;
  onGround: boolean;
  sprinting: boolean;
  alive: boolean;
}

/** One remote actor's model and procedural animation state. */
export class Character {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  private readonly bones: THREE.Bone[];
  private phase = 0;
  private crouch = 0;
  private deathT = -1;
  /** Distance walked (for footsteps). */
  stride = 0;
  team: number;
  cls: ClassId;

  constructor(team: number, cls: ClassId, geo: THREE.BufferGeometry, mat: THREE.Material, castShadow: boolean) {
    this.team = team;
    this.cls = cls;
    const { bones, skeleton } = buildSkeleton();
    this.bones = bones;
    this.mesh = new THREE.SkinnedMesh(geo, mat);
    this.mesh.add(bones[0]!);
    this.mesh.bind(skeleton);
    this.mesh.castShadow = castShadow;
    this.body.add(this.mesh);
    this.root.add(this.body);
  }

  /** Muzzle position in world space (for tracers). */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    out.set(0.05, 1.31 - 1.05, this.cls === 'sniper' ? -1.4 : -1.15);
    return this.bones[B_SPINE]!.localToWorld(out);
  }

  update(p: CharacterPose, dt: number): void {
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.yaw;
    const b = this.bones;
    if (!p.alive) {
      if (this.deathT < 0) this.deathT = 0;
      this.deathT = Math.min(1, this.deathT + dt * 2.5);
      const e = this.deathT * this.deathT;
      this.body.rotation.x = e * (Math.PI / 2 - 0.08);
      this.body.position.y = -e * 0.1;
      return;
    }
    if (this.deathT >= 0) {
      this.deathT = -1;
      this.body.rotation.x = 0;
      this.body.position.y = 0;
    }
    this.crouch += ((p.crouched ? 1 : 0) - this.crouch) * Math.min(1, dt * 12);
    const c = this.crouch;
    const speed = Math.min(p.speed, 8);
    if (p.onGround) this.stride += speed * dt;
    this.phase += dt * (speed * 1.9 + 0.01);
    const swing = Math.min(1, speed / 5) * (p.sprinting ? 0.85 : 0.6) * (1 - c * 0.5);
    const s = Math.sin(this.phase);
    let thighL = s * swing;
    let thighR = -s * swing;
    let shinL = Math.max(0, Math.sin(this.phase + Math.PI / 2)) * swing * 1.3;
    let shinR = Math.max(0, Math.sin(this.phase - Math.PI / 2)) * swing * 1.3;
    if (!p.onGround) {
      thighL = thighR = -0.5;
      shinL = shinR = 0.8;
    }
    b[B_HIPS]!.position.y = 0.95 - c * 0.4;
    b[B_THIGH_L]!.rotation.x = thighL - c * 1.25;
    b[B_THIGH_R]!.rotation.x = thighR - c * 1.25;
    b[B_SHIN_L]!.rotation.x = shinL + c * 2.0;
    b[B_SHIN_R]!.rotation.x = shinR + c * 2.0;
    const lean = p.sprinting ? -0.22 : 0;
    b[B_SPINE]!.rotation.x = p.pitch * 0.8 + lean + c * 0.1;
    b[B_HEAD]!.rotation.x = p.pitch * 0.2;
  }

  dispose(): void {
    this.mesh.skeleton.dispose();
  }
}

/** Shared geometry per (team, class) and one material for all characters. */
export class CharacterFactory {
  private readonly geos = new Map<string, THREE.BufferGeometry>();
  readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });

  create(team: number, cls: ClassId, castShadow: boolean): Character {
    const key = `${team}:${cls}`;
    let g = this.geos.get(key);
    if (!g) {
      g = buildCharacterGeometry(team, cls);
      this.geos.set(key, g);
    }
    return new Character(team, cls, g, this.material, castShadow);
  }

  dispose(): void {
    for (const g of this.geos.values()) g.dispose();
    this.geos.clear();
    this.material.dispose();
  }
}

export const classFromIndex = (i: number): ClassId => CLASS_IDS[i] ?? 'assault';

/** Instanced blob shadows under characters (Low preset, GAME.md 13). */
export class BlobShadows {
  readonly mesh: THREE.InstancedMesh;
  private count = 0;
  private readonly m = new THREE.Matrix4();

  constructor(max: number) {
    const geo = new THREE.CircleGeometry(0.55, 12);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 1;
  }
  begin(): void {
    this.count = 0;
  }
  add(x: number, y: number, z: number): void {
    if (this.count >= this.mesh.instanceMatrix.count) return;
    this.m.makeTranslation(x, y + 0.04, z);
    this.mesh.setMatrixAt(this.count++, this.m);
  }
  end(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
