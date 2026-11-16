import * as THREE from 'three';
import { GRAPHICS } from '@zona/shared';
import { GeoBuilder } from './geom';

const GUN = 0x2b2d2f;
const GUN_LIGHT = 0x3d4044;
const SKIN = 0xd8a77f;
const SLEEVE = 0x4a5530;
const GLOVE = 0x2f3324;

const HIP = new THREE.Vector3(0.19, -0.19, -0.5);
const ADS = new THREE.Vector3(0, -0.068, -0.42);
/** Overall viewmodel scale (smaller = less screen coverage). */
const SCALE = 0.78;
const SPRINT_ROT = new THREE.Euler(-0.35, 0.7, 0.35);

/** First-person weapon + hands, rendered in its own pass with a fixed FOV (GAME.md 8.2). */
export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly gun = new THREE.Group();
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
  visible = true;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(GRAPHICS.viewmodelFov, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x5a4a35, 2.0));
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
    sun.position.set(0.5, 1, 0.3);
    this.scene.add(sun);

    const b = new GeoBuilder();
    b.box(0, 0, -0.1, 0.07, 0.11, 0.42, GUN);
    b.box(0, 0.02, -0.47, 0.035, 0.035, 0.34, GUN_LIGHT);
    b.box(0, 0.005, -0.38, 0.068, 0.078, 0.24, GUN_LIGHT);
    b.box(0, -0.115, -0.14, 0.05, 0.16, 0.08, GUN, -1, -0.18);
    b.box(0, -0.02, 0.2, 0.056, 0.1, 0.22, GUN);
    b.box(0, -0.085, 0.05, 0.045, 0.1, 0.05, GUN, -1, 0.35);
    b.box(-0.014, 0.066, 0.07, 0.008, 0.022, 0.02, GUN_LIGHT);
    b.box(0.014, 0.066, 0.07, 0.008, 0.022, 0.02, GUN_LIGHT);
    b.box(0, 0.066, -0.56, 0.008, 0.026, 0.01, GUN_LIGHT);
    // Hands and sleeves.
    b.box(0.005, -0.075, 0.06, 0.075, 0.085, 0.1, GLOVE);
    b.box(0.05, -0.13, 0.24, 0.085, 0.085, 0.3, SLEEVE, -1, 0.45, 0.1);
    b.box(0.03, -0.165, 0.42, 0.07, 0.07, 0.12, SKIN, -1, 0.45, 0.1);
    b.box(0, -0.05, -0.37, 0.085, 0.06, 0.13, GLOVE);
    b.box(-0.11, -0.11, -0.22, 0.085, 0.085, 0.34, SLEEVE, -1, 0.3, -0.62);
    const mesh = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.gun.add(mesh);

    const fg = new THREE.PlaneGeometry(0.16, 0.16);
    const fg2 = fg.clone().rotateY(Math.PI / 2);
    const fgm = new GeoBuilder().add(fg, 0xffd27a).add(fg2, 0xffd27a).build();
    this.flash = new THREE.Mesh(fgm, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.flash.position.set(0, 0.02, -0.68);
    this.flash.visible = false;
    this.gun.add(this.flash);
    this.gun.scale.setScalar(SCALE);
    this.scene.add(this.gun);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  fire(): void {
    this.kick = Math.min(1, this.kick + 0.55);
    this.kickRot = Math.min(1, this.kickRot + 0.5);
    this.flashT = 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;
  }

  /** Muzzle position in viewmodel-camera space (for the local tracer start). */
  muzzleLocal(out: THREE.Vector3): THREE.Vector3 {
    return this.flash.getWorldPosition(out);
  }

  update(dt: number, s: { speed: number; onGround: boolean; ads: boolean; sprinting: boolean; reloadFrac: number; lookDX: number; lookDY: number }): void {
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

    const p = this.tmp.copy(HIP).lerp(ADS, this.adsT);
    p.x += Math.sin(this.bobT) * 0.012 * bobAmt + this.swayX * swayK;
    p.y += Math.abs(Math.cos(this.bobT)) * 0.012 * bobAmt + this.swayY * swayK;
    p.z += this.kick * 0.045;
    // Reload: dip and roll.
    const r = s.reloadFrac > 0 ? Math.sin(Math.min(1, s.reloadFrac) * Math.PI) : 0;
    p.y -= r * 0.12;
    this.gun.position.copy(p);
    this.gun.rotation.set(
      this.kickRot * 0.06 + SPRINT_ROT.x * this.sprintT - r * 0.5,
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
    this.gun.visible = this.visible;
  }
}
