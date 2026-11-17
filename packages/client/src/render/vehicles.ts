import * as THREE from 'three';
import { NEUTRAL_COLOR_HEX, TANK, TEAM_COLOR_HEX, type VehicleKind } from '@zona/shared';
import { GeoBuilder } from './geom';

const OLIVE = 0x5b6a3a;
const OLIVE_DARK = 0x46522c;
const TIRE = 0x1f1f1f;
const METAL = 0x3a3d40;
const SEAT = 0x2f2a25;

interface Geos {
  body: THREE.BufferGeometry;
  marking: THREE.BufferGeometry;
  turret?: THREE.BufferGeometry;
  barrel?: THREE.BufferGeometry;
}

function jeepGeos(): Geos {
  const b = new GeoBuilder();
  b.boxMinMax(-1.0, 0.5, -2.05, 1.0, 1.05, 2.0, OLIVE);
  b.boxMinMax(-0.95, 1.05, -2.0, 0.95, 1.3, -0.7, OLIVE); // hood
  // Low, folded-down windshield frame so the driver looks over it.
  b.boxMinMax(-0.95, 1.3, -0.72, 0.95, 1.34, -0.66, METAL);
  b.boxMinMax(-0.95, 1.34, -0.7, -0.89, 1.52, -0.64, METAL);
  b.boxMinMax(0.89, 1.34, -0.7, 0.95, 1.52, -0.64, METAL);
  b.boxMinMax(-0.95, 1.48, -0.7, 0.95, 1.52, -0.64, METAL);
  for (const x of [-0.45, 0.45]) {
    b.boxMinMax(x - 0.25, 1.05, -0.1, x + 0.25, 1.2, 0.4, SEAT);
    b.boxMinMax(x - 0.25, 1.2, 0.35, x + 0.25, 1.7, 0.45, SEAT);
  }
  // Roll bar.
  b.boxMinMax(-0.95, 1.05, 0.95, -0.87, 2.0, 1.03, METAL);
  b.boxMinMax(0.87, 1.05, 0.95, 0.95, 2.0, 1.03, METAL);
  b.boxMinMax(-0.95, 1.92, 0.95, 0.95, 2.0, 1.03, METAL);
  // Wheels and spare.
  for (const sx of [-1, 1]) {
    for (const sz of [-1.35, 1.35]) b.add(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), TIRE, sx * 0.98, 0.42, sz, 0, 0, Math.PI / 2);
  }
  b.add(new THREE.CylinderGeometry(0.36, 0.36, 0.22, 10), TIRE, 0, 1.15, 2.12, Math.PI / 2, 0, 0);
  b.boxMinMax(-0.7, 1.31, -1.95, -0.5, 1.35, -1.85, 0xfff4c2); // headlights
  b.boxMinMax(0.5, 1.31, -1.95, 0.7, 1.35, -1.85, 0xfff4c2);
  const m = new GeoBuilder();
  m.boxMinMax(-0.25, 1.3, -1.95, 0.25, 1.32, -0.75, 0xffffff); // hood stripe
  m.boxMinMax(-1.01, 0.7, -1.2, -1.0, 0.95, 1.2, 0xffffff); // side panels
  m.boxMinMax(1.0, 0.7, -1.2, 1.01, 0.95, 1.2, 0xffffff);
  return { body: b.build(), marking: m.build() };
}

function tankGeos(): Geos {
  const b = new GeoBuilder();
  b.boxMinMax(-1.55, 0.45, -3.2, 1.55, 1.4, 3.2, OLIVE);
  b.boxMinMax(-1.5, 0.45, -3.6, 1.5, 1.05, -3.2, OLIVE_DARK); // glacis
  for (const sx of [-1, 1]) {
    b.boxMinMax(sx * 1.25 - 0.4, 0.0, -3.4, sx * 1.25 + 0.4, 0.95, 3.4, 0x2b2d2a); // tracks
    for (let i = -3; i <= 3; i++) b.add(new THREE.CylinderGeometry(0.33, 0.33, 0.84, 8), 0x3b3e3a, sx * 1.25, 0.38, i * 0.95, 0, 0, Math.PI / 2);
  }
  const t = new GeoBuilder();
  t.boxMinMax(-1.1, 0, -1.3, 1.1, 0.75, 1.3, OLIVE);
  t.boxMinMax(-0.9, 0.75, -0.9, 0.9, 0.8, 1.1, OLIVE_DARK);
  t.cylinder(0.45, 0.5, 0.33, 0.75, 1.0, METAL, 8);
  t.boxMinMax(-0.35, 0.2, -1.6, 0.35, 0.65, -1.3, OLIVE_DARK); // mantlet
  const br = new GeoBuilder();
  br.add(new THREE.CylinderGeometry(0.11, 0.13, TANK.barrelLength, 8), METAL, 0, 0, -TANK.barrelLength / 2, Math.PI / 2, 0, 0);
  br.add(new THREE.CylinderGeometry(0.16, 0.16, 0.4, 8), METAL, 0, 0, -TANK.barrelLength + 0.2, Math.PI / 2, 0, 0);
  const m = new GeoBuilder();
  m.boxMinMax(-1.11, 0.25, -0.6, -1.1, 0.55, 0.6, 0xffffff); // turret side bands
  m.boxMinMax(1.1, 0.25, -0.6, 1.11, 0.55, 0.6, 0xffffff);
  m.boxMinMax(-0.4, 0.76, 0.3, 0.4, 0.77, 1.0, 0xffffff);
  return { body: b.build(), marking: m.build(), turret: t.build(), barrel: br.build() };
}

/** Turret pivot height on the hull and barrel height on the turret (barrel axis at TANK.turretY). */
const TURRET_BASE = 1.4;
const BARREL_Y = TANK.turretY - TURRET_BASE;

export interface VehiclePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  turretYaw: number;
  turretPitch: number;
  team: number;
  destroyed: boolean;
}

/** One vehicle's meshes: body + team marking (+ turret and barrel for tanks). */
export class VehicleModel {
  readonly root = new THREE.Group();
  private readonly tilt = new THREE.Group();
  private readonly turret: THREE.Group | null;
  private readonly barrel: THREE.Group | null;
  private readonly meshes: THREE.Mesh[] = [];
  private readonly marking: THREE.Mesh;
  private team = -2;
  private destroyed = false;

  constructor(
    readonly kind: VehicleKind,
    geos: Geos,
    private readonly mats: VehicleMaterials,
    castShadow: boolean,
  ) {
    this.root.add(this.tilt);
    const body = new THREE.Mesh(geos.body, mats.body);
    this.marking = new THREE.Mesh(geos.marking, mats.team(-1));
    this.tilt.add(body);
    this.meshes.push(body);
    if (geos.turret && geos.barrel) {
      this.turret = new THREE.Group();
      this.turret.position.y = TURRET_BASE;
      const tm = new THREE.Mesh(geos.turret, mats.body);
      this.turret.add(tm, this.marking);
      this.barrel = new THREE.Group();
      this.barrel.position.set(0, BARREL_Y, -1.3);
      const bm = new THREE.Mesh(geos.barrel, mats.body);
      this.barrel.add(bm);
      this.turret.add(this.barrel);
      this.tilt.add(this.turret);
      this.meshes.push(tm, bm);
    } else {
      this.turret = null;
      this.barrel = null;
      this.tilt.add(this.marking);
    }
    for (const m of [...this.meshes, this.marking]) m.castShadow = castShadow;
  }

  update(p: VehiclePose): void {
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.yaw;
    this.tilt.rotation.set(p.pitch, 0, -p.roll, 'YXZ');
    if (this.turret && this.barrel) {
      this.turret.rotation.y = p.turretYaw - p.yaw;
      this.barrel.rotation.x = p.turretPitch;
    }
    if (p.team !== this.team) {
      this.team = p.team;
      this.marking.material = this.mats.team(p.team);
    }
    if (p.destroyed !== this.destroyed) {
      this.destroyed = p.destroyed;
      for (const m of this.meshes) m.material = p.destroyed ? this.mats.wreck : this.mats.body;
      this.marking.visible = !p.destroyed;
      if (p.destroyed) this.tilt.rotation.z += 0.08;
    }
  }

  /** Barrel tip in world space (tanks), for muzzle effects. */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    if (!this.barrel) return out.copy(this.root.position);
    out.set(0, 0, -TANK.barrelLength);
    return this.barrel.localToWorld(out);
  }
}

export class VehicleMaterials {
  readonly body = new THREE.MeshLambertMaterial({ vertexColors: true });
  readonly wreck = new THREE.MeshLambertMaterial({ color: 0x222222 });
  private readonly teams = new Map<number, THREE.MeshLambertMaterial>();
  team(t: number): THREE.MeshLambertMaterial {
    let m = this.teams.get(t);
    if (!m) {
      const hex = t >= 0 ? (TEAM_COLOR_HEX[t] ?? 0xffffff) : NEUTRAL_COLOR_HEX;
      m = new THREE.MeshLambertMaterial({ color: hex, emissive: new THREE.Color().setHex(hex).multiplyScalar(0.25) });
      this.teams.set(t, m);
    }
    return m;
  }
}

export class VehicleFactory {
  private readonly geos = new Map<VehicleKind, Geos>();
  readonly mats = new VehicleMaterials();
  create(kind: VehicleKind, castShadow: boolean): VehicleModel {
    let g = this.geos.get(kind);
    if (!g) {
      g = kind === 'tank' ? tankGeos() : jeepGeos();
      this.geos.set(kind, g);
    }
    return new VehicleModel(kind, g, this.mats, castShadow);
  }
}
