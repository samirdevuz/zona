import * as THREE from 'three';
import { GADGETS, GRAPHICS, type ItemId } from '@zona/shared';
import { GeoBuilder } from './geom';

const GUN = 0x2b2d2f;
const GUN_LIGHT = 0x3d4044;
const SKIN = 0xd8a77f;
const SLEEVE = 0x4a5530;
const GLOVE = 0x2f3324;
const OLIVE = 0x4f5a34;

/** Overall viewmodel scale (smaller = less screen coverage). */
const SCALE = 0.78;
const SPRINT_ROT = new THREE.Euler(-0.35, 0.7, 0.35);

interface ItemModel {
  group: THREE.Group;
  hip: THREE.Vector3;
  ads: THREE.Vector3;
  /** Muzzle position in item space (for the flash). */
  muzzle: THREE.Vector3;
}

function hands(b: GeoBuilder, frontZ: number): void {
  b.box(0.005, -0.075, 0.06, 0.075, 0.085, 0.1, GLOVE);
  b.box(0.05, -0.13, 0.24, 0.085, 0.085, 0.3, SLEEVE, -1, 0.45, 0.1);
  b.box(0.03, -0.165, 0.42, 0.07, 0.07, 0.12, SKIN, -1, 0.45, 0.1);
  b.box(0, -0.05, frontZ, 0.085, 0.06, 0.13, GLOVE);
  b.box(-0.11, -0.11, frontZ + 0.15, 0.085, 0.085, 0.34, SLEEVE, -1, 0.3, -0.62);
}

function sights(b: GeoBuilder, frontZ: number): void {
  b.box(-0.014, 0.066, 0.07, 0.008, 0.022, 0.02, GUN_LIGHT);
  b.box(0.014, 0.066, 0.07, 0.008, 0.022, 0.02, GUN_LIGHT);
  b.box(0, 0.066, frontZ, 0.008, 0.026, 0.01, GUN_LIGHT);
}

function buildItem(item: ItemId): { geo: THREE.BufferGeometry; muzzleZ: number; hip?: THREE.Vector3; ads?: THREE.Vector3 } {
  const b = new GeoBuilder();
  switch (item) {
    case 'smg1':
      b.box(0, 0, -0.06, 0.07, 0.11, 0.32, GUN);
      b.box(0, 0.02, -0.3, 0.035, 0.035, 0.18, GUN_LIGHT);
      b.box(0, -0.12, -0.08, 0.045, 0.2, 0.06, GUN);
      b.box(0, -0.02, 0.17, 0.05, 0.08, 0.16, GUN_LIGHT);
      b.box(0, -0.085, 0.05, 0.045, 0.1, 0.05, GUN, -1, 0.35);
      sights(b, -0.2);
      hands(b, -0.22);
      return { geo: b.build(), muzzleZ: -0.4 };
    case 'lmg1':
      b.box(0, 0, -0.12, 0.09, 0.13, 0.5, GUN);
      b.box(0, 0.02, -0.55, 0.045, 0.045, 0.4, GUN_LIGHT);
      b.box(0, -0.1, -0.1, 0.16, 0.14, 0.16, OLIVE);
      b.box(0, -0.02, 0.22, 0.06, 0.11, 0.24, GUN);
      b.box(0, -0.085, 0.05, 0.045, 0.1, 0.05, GUN, -1, 0.35);
      b.box(-0.02, -0.04, -0.62, 0.012, 0.012, 0.2, GUN_LIGHT, -1, 0.2);
      b.box(0.02, -0.04, -0.62, 0.012, 0.012, 0.2, GUN_LIGHT, -1, 0.2);
      sights(b, -0.62);
      hands(b, -0.36);
      return { geo: b.build(), muzzleZ: -0.76 };
    case 'bolt1':
      b.box(0, 0, -0.12, 0.065, 0.1, 0.5, 0x5a4632);
      b.box(0, 0.02, -0.6, 0.032, 0.032, 0.5, GUN);
      b.box(0, 0.095, -0.08, 0.06, 0.06, 0.3, 0x15171a); // scope
      b.box(0, 0.095, 0.08, 0.075, 0.075, 0.05, 0x15171a);
      b.box(0.05, 0.02, 0.0, 0.05, 0.02, 0.02, GUN_LIGHT); // bolt handle
      b.box(0, -0.03, 0.22, 0.06, 0.12, 0.24, 0x5a4632);
      hands(b, -0.34);
      return { geo: b.build(), muzzleZ: -0.86 };
    case 'pistol':
      b.box(0, 0.0, -0.08, 0.04, 0.06, 0.2, GUN);
      b.box(0, -0.07, 0.0, 0.035, 0.1, 0.05, GUN, -1, 0.25);
      b.box(0, 0.04, -0.17, 0.006, 0.016, 0.01, GUN_LIGHT);
      b.box(-0.01, 0.04, 0.0, 0.006, 0.016, 0.01, GUN_LIGHT);
      b.box(0.01, 0.04, 0.0, 0.006, 0.016, 0.01, GUN_LIGHT);
      b.box(0.005, -0.075, 0.04, 0.07, 0.085, 0.09, GLOVE);
      b.box(0.05, -0.13, 0.22, 0.085, 0.085, 0.3, SLEEVE, -1, 0.45, 0.1);
      b.box(-0.03, -0.09, 0.05, 0.06, 0.06, 0.08, GLOVE);
      b.box(-0.12, -0.15, 0.2, 0.085, 0.085, 0.3, SLEEVE, -1, 0.4, -0.4);
      return { geo: b.build(), muzzleZ: -0.19, hip: new THREE.Vector3(0.16, -0.17, -0.42), ads: new THREE.Vector3(0, -0.045, -0.38) };
    case 'rocket':
      b.add(new THREE.CylinderGeometry(0.065, 0.065, 0.85, 8), OLIVE, 0, 0.02, -0.15, Math.PI / 2, 0, 0);
      b.add(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 8), GUN, 0, 0.02, -0.58, Math.PI / 2, 0, 0);
      b.box(-0.08, 0.08, -0.15, 0.04, 0.06, 0.08, GUN_LIGHT); // sight
      b.box(0, -0.09, 0.0, 0.04, 0.1, 0.05, GUN, -1, 0.3);
      hands(b, -0.3);
      return { geo: b.build(), muzzleZ: -0.62, hip: new THREE.Vector3(0.24, -0.17, -0.6), ads: new THREE.Vector3(0.1, -0.12, -0.5) };
    case 'medpack':
      b.box(0, -0.02, -0.12, 0.22, 0.14, 0.12, 0xf3f4f6);
      b.box(0, -0.02, -0.185, 0.12, 0.035, 0.004, 0xdc2626);
      b.box(0, -0.02, -0.185, 0.035, 0.1, 0.004, 0xdc2626);
      b.box(0.04, -0.12, 0.05, 0.075, 0.085, 0.1, GLOVE);
      b.box(0.08, -0.17, 0.22, 0.085, 0.085, 0.3, SLEEVE, -1, 0.45, 0.1);
      return { geo: b.build(), muzzleZ: -0.2 };
    case 'ammobox':
      b.box(0, -0.04, -0.12, 0.26, 0.16, 0.14, OLIVE);
      b.box(0, 0.045, -0.12, 0.27, 0.02, 0.15, 0xd9b84a);
      b.box(0.04, -0.14, 0.05, 0.075, 0.085, 0.1, GLOVE);
      b.box(0.08, -0.19, 0.22, 0.085, 0.085, 0.3, SLEEVE, -1, 0.45, 0.1);
      return { geo: b.build(), muzzleZ: -0.2 };
    case 'grenade':
      b.add(new THREE.IcosahedronGeometry(0.045, 1), 0x3f4a2a, 0, 0.01, -0.06);
      b.box(0, 0.06, -0.06, 0.02, 0.025, 0.02, 0x777777);
      b.box(0.005, -0.03, -0.02, 0.075, 0.085, 0.1, GLOVE);
      b.box(0.05, -0.1, 0.16, 0.085, 0.085, 0.3, SLEEVE, -1, 0.45, 0.1);
      return { geo: b.build(), muzzleZ: -0.1, hip: new THREE.Vector3(0.2, -0.17, -0.4) };
    case 'torch':
      b.cylinder(0, 0, 0.05, -0.12, 0.08, 0xb91c1c, 8);
      b.add(new THREE.CylinderGeometry(0.012, 0.016, 0.3, 6), GUN_LIGHT, 0, 0.0, -0.22, Math.PI / 2, 0, 0);
      b.box(0.005, -0.075, 0.06, 0.075, 0.085, 0.1, GLOVE);
      b.box(0.05, -0.13, 0.24, 0.085, 0.085, 0.3, SLEEVE, -1, 0.45, 0.1);
      return { geo: b.build(), muzzleZ: -0.38 };
    default: // ar1
      b.box(0, 0, -0.1, 0.07, 0.11, 0.42, GUN);
      b.box(0, 0.02, -0.47, 0.035, 0.035, 0.34, GUN_LIGHT);
      b.box(0, 0.005, -0.38, 0.068, 0.078, 0.24, GUN_LIGHT);
      b.box(0, -0.115, -0.14, 0.05, 0.16, 0.08, GUN, -1, -0.18);
      b.box(0, -0.02, 0.2, 0.056, 0.1, 0.22, GUN);
      b.box(0, -0.085, 0.05, 0.045, 0.1, 0.05, GUN, -1, 0.35);
      sights(b, -0.56);
      hands(b, -0.37);
      return { geo: b.build(), muzzleZ: -0.68 };
  }
}

const DEFAULT_HIP = new THREE.Vector3(0.19, -0.19, -0.5);
const DEFAULT_ADS = new THREE.Vector3(0, -0.068, -0.42);

export interface ViewmodelState {
  speed: number;
  onGround: boolean;
  ads: boolean;
  sprinting: boolean;
  reloadFrac: number;
  /** 0..1 while the item is being raised after a switch (1 = fully lowered). */
  switchFrac: number;
  /** 0..1 grenade throw progress. */
  throwFrac: number;
  lookDX: number;
  lookDY: number;
  /** Hide while looking through a scope. */
  scoped: boolean;
}

/** First-person items + hands, rendered in their own pass with a fixed FOV (GAME.md 8.2). */
export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly root = new THREE.Group();
  private readonly items = new Map<ItemId, ItemModel>();
  private current: ItemModel | null = null;
  private readonly flash: THREE.Mesh;
  private flashT = 0;
  private kick = 0;
  private kickRot = 0;
  private bobT = 0;
  private swayX = 0;
  private swayY = 0;
  private adsT = 0;
  private sprintT = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  visible = true;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(GRAPHICS.viewmodelFov, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x5a4a35, 2.0));
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
    sun.position.set(0.5, 1, 0.3);
    this.scene.add(sun);
    const fg = new THREE.PlaneGeometry(0.16, 0.16);
    const fg2 = fg.clone().rotateY(Math.PI / 2);
    const fgm = new GeoBuilder().add(fg, 0xffd27a).add(fg2, 0xffd27a).build();
    this.flash = new THREE.Mesh(fgm, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.flash.visible = false;
    this.root.scale.setScalar(SCALE);
    this.scene.add(this.root);
    this.setItem('ar1');
  }

  setItem(item: ItemId): void {
    let m = this.items.get(item);
    if (!m) {
      const built = buildItem(item);
      const group = new THREE.Group();
      group.add(new THREE.Mesh(built.geo, this.mat));
      m = { group, hip: built.hip ?? DEFAULT_HIP, ads: built.ads ?? DEFAULT_ADS, muzzle: new THREE.Vector3(0, 0.02, built.muzzleZ) };
      this.items.set(item, m);
    }
    if (this.current === m) return;
    if (this.current) this.root.remove(this.current.group);
    this.current = m;
    this.root.add(m.group);
    m.group.add(this.flash);
    this.flash.position.copy(m.muzzle);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  fire(strength = 1): void {
    this.kick = Math.min(1, this.kick + 0.55 * strength);
    this.kickRot = Math.min(1.5, this.kickRot + 0.5 * strength);
    this.flashT = 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;
  }

  update(dt: number, s: ViewmodelState): void {
    const m = this.current;
    if (!m) return;
    this.adsT += ((s.ads ? 1 : 0) - this.adsT) * Math.min(1, dt * 14);
    this.sprintT += ((s.sprinting ? 1 : 0) - this.sprintT) * Math.min(1, dt * 8);
    const moving = s.onGround ? Math.min(1, s.speed / 5) : 0;
    this.bobT += dt * (4 + s.speed * 1.4);
    const bobAmt = moving * (1 - this.adsT * 0.85) * (s.sprinting ? 1.8 : 1);
    this.swayX += (-s.lookDX * 0.0006 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (s.lookDY * 0.0006 - this.swayY) * Math.min(1, dt * 10);
    const swayK = 1 - this.adsT * 0.8;
    this.kick *= Math.exp(-dt * 18);
    this.kickRot *= Math.exp(-dt * 14);
    const p = this.tmp.copy(m.hip).lerp(m.ads, this.adsT);
    p.x += Math.sin(this.bobT) * 0.012 * bobAmt + this.swayX * swayK;
    p.y += Math.abs(Math.cos(this.bobT)) * 0.012 * bobAmt + this.swayY * swayK;
    p.z += this.kick * 0.045;
    const r = s.reloadFrac > 0 ? Math.sin(Math.min(1, s.reloadFrac) * Math.PI) : 0;
    p.y -= r * 0.12 + s.switchFrac * 0.3;
    const th = s.throwFrac > 0 ? Math.sin(s.throwFrac * Math.PI) : 0;
    p.z -= th * 0.2;
    p.y += th * 0.08;
    this.root.position.copy(p);
    this.root.rotation.set(
      this.kickRot * 0.06 + SPRINT_ROT.x * this.sprintT - r * 0.5 - s.switchFrac * 0.6 + th * 0.6,
      SPRINT_ROT.y * this.sprintT + r * 0.2,
      SPRINT_ROT.z * this.sprintT + r * 0.6,
    );
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = true;
      this.flash.scale.setScalar(0.7 + Math.random() * 0.6);
    } else {
      this.flash.visible = false;
    }
    this.root.visible = this.visible && !s.scoped;
  }
}

export const THROW_TIME = GADGETS.grenade.throwTimeS;
