import * as THREE from 'three';
import { DEP_AMMOBOX, DEP_FIELDS, DEP_MEDPACK, GADGETS, PROJ_FIELDS, PROJ_GRENADE, PROJ_ROCKET, PROJ_SHELL, TEAM_COLOR_HEX } from '@zona/shared';
import { GeoBuilder } from './geom';
import type { Effects } from './effects';

const MAX_PROJ = 32;
const MAX_DEP = 24;

interface ProjTrack {
  kind: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  recv: number;
  seen: number;
}

/**
 * Server projectiles (grenades, rockets) and deployables (med packs, ammo boxes).
 * Projectiles are drawn at their latest position, extrapolated up to 100 ms,
 * so they line up with explosion events that arrive without interpolation delay.
 */
export class Entities {
  readonly group = new THREE.Group();
  private readonly tracks = new Map<number, ProjTrack>();
  private readonly grenades: THREE.InstancedMesh;
  private readonly rockets: THREE.InstancedMesh;
  private readonly medpacks: THREE.InstancedMesh;
  private readonly ammoboxes: THREE.InstancedMesh;
  private readonly rings: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 0, 1);
  private readonly dir = new THREE.Vector3();
  private readonly col = new THREE.Color();
  private frame = 0;
  private trailT = 0;
  /** Projectiles first seen in the last snapshot: kind, x, y, z (for launch sounds/flashes). */
  readonly fresh: number[] = [];

  constructor() {
    this.group.name = 'entities';
    this.grenades = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.08, 0), new THREE.MeshLambertMaterial({ color: 0x3f4a2a }), MAX_PROJ);
    const rg = new GeoBuilder().add(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6), 0x4f5a34, 0, 0, 0, Math.PI / 2).add(new THREE.ConeGeometry(0.06, 0.14, 6), 0x2b2d2f, 0, 0, -0.33, -Math.PI / 2).build();
    this.rockets = new THREE.InstancedMesh(rg, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x331a00 }), MAX_PROJ);
    const mp = new GeoBuilder()
      .boxMinMax(-0.25, 0, -0.17, 0.25, 0.22, 0.17, 0xf3f4f6)
      .boxMinMax(-0.04, 0.221, -0.12, 0.04, 0.23, 0.12, 0xdc2626)
      .boxMinMax(-0.12, 0.221, -0.04, 0.12, 0.23, 0.04, 0xdc2626)
      .build();
    this.medpacks = new THREE.InstancedMesh(mp, new THREE.MeshLambertMaterial({ vertexColors: true }), MAX_DEP);
    const ab = new GeoBuilder().boxMinMax(-0.3, 0, -0.2, 0.3, 0.3, 0.2, 0x4f5a34).boxMinMax(-0.31, 0.24, -0.21, 0.31, 0.28, 0.21, 0xd9b84a).build();
    this.ammoboxes = new THREE.InstancedMesh(ab, new THREE.MeshLambertMaterial({ vertexColors: true }), MAX_DEP);
    const ringGeo = new THREE.RingGeometry(GADGETS.medpack.radius - 0.12, GADGETS.medpack.radius, 32, 1);
    ringGeo.rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }), MAX_DEP * 2);
    for (const mesh of [this.grenades, this.rockets, this.medpacks, this.ammoboxes, this.rings]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.rings.renderOrder = 1;
  }

  /** Update from a snapshot's projectile and deployable arrays. */
  onSnapshot(p: number[], d: number[], now: number): void {
    this.frame++;
    this.fresh.length = 0;
    for (let i = 0; i + PROJ_FIELDS - 1 < p.length; i += PROJ_FIELDS) {
      const id = p[i]!;
      const x = p[i + 2]!;
      const y = p[i + 3]!;
      const z = p[i + 4]!;
      let t = this.tracks.get(id);
      if (!t) {
        t = { kind: p[i + 1]!, x, y, z, vx: 0, vy: 0, vz: 0, recv: now, seen: this.frame };
        this.tracks.set(id, t);
        this.fresh.push(t.kind, x, y, z);
      } else {
        const dt = Math.max(0.001, (now - t.recv) / 1000);
        t.vx = (x - t.x) / dt;
        t.vy = (y - t.y) / dt;
        t.vz = (z - t.z) / dt;
        t.x = x;
        t.y = y;
        t.z = z;
        t.recv = now;
        t.seen = this.frame;
      }
    }
    for (const [id, t] of this.tracks) if (t.seen !== this.frame) this.tracks.delete(id);

    // Deployables: rebuild instances (few, small).
    let nm = 0;
    let na = 0;
    let nr = 0;
    for (let i = 0; i + DEP_FIELDS - 1 < d.length; i += DEP_FIELDS) {
      const kind = d[i + 1]!;
      const team = d[i + 2]!;
      this.m.makeTranslation(d[i + 3]!, d[i + 4]!, d[i + 5]!);
      if (kind === DEP_MEDPACK && nm < MAX_DEP) this.medpacks.setMatrixAt(nm++, this.m);
      else if (kind === DEP_AMMOBOX && na < MAX_DEP) this.ammoboxes.setMatrixAt(na++, this.m);
      if (nr < MAX_DEP * 2) {
        this.m.makeTranslation(d[i + 3]!, d[i + 4]! + 0.06, d[i + 5]!);
        this.rings.setMatrixAt(nr, this.m);
        this.col.setHex(kind === DEP_MEDPACK ? 0x4ade80 : 0xfacc15).lerp(this.col.clone().setHex(TEAM_COLOR_HEX[team] ?? 0xffffff), 0.25);
        this.rings.setColorAt(nr++, this.col);
      }
    }
    this.medpacks.count = nm;
    this.ammoboxes.count = na;
    this.rings.count = nr;
    this.medpacks.instanceMatrix.needsUpdate = true;
    this.ammoboxes.instanceMatrix.needsUpdate = true;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }

  update(now: number, dt: number, effects: Effects): void {
    let ng = 0;
    let nr = 0;
    this.trailT += dt;
    const emitTrail = this.trailT > 0.03;
    if (emitTrail) this.trailT = 0;
    for (const t of this.tracks.values()) {
      const age = Math.min(0.1, (now - t.recv) / 1000);
      const x = t.x + t.vx * age;
      const y = t.y + t.vy * age;
      const z = t.z + t.vz * age;
      if (t.kind === PROJ_GRENADE && ng < MAX_PROJ) {
        this.m.makeTranslation(x, y, z);
        this.grenades.setMatrixAt(ng++, this.m);
      } else if ((t.kind === PROJ_ROCKET || t.kind === PROJ_SHELL) && nr < MAX_PROJ) {
        this.dir.set(t.vx, t.vy, t.vz);
        if (this.dir.lengthSq() > 1e-6) this.q.setFromUnitVectors(this.up, this.dir.normalize().negate());
        this.m.compose(this.v.set(x, y, z), this.q, this.s);
        this.rockets.setMatrixAt(nr++, this.m);
        if (emitTrail) effects.smoke(x, y, z, 0.5, 0.6);
      }
    }
    this.grenades.count = ng;
    this.rockets.count = nr;
    this.grenades.instanceMatrix.needsUpdate = true;
    this.rockets.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.tracks.clear();
    for (const mesh of [this.grenades, this.rockets, this.medpacks, this.ammoboxes, this.rings]) mesh.count = 0;
  }
}
