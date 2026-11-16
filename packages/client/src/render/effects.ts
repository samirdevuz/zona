import * as THREE from 'three';

const MAX_TRACERS = 64;
const MAX_PUFFS = 64;
const TRACER_SPEED = 380;
const TRACER_LEN = 7;

interface Tracer {
  sx: number;
  sy: number;
  sz: number;
  dx: number;
  dy: number;
  dz: number;
  len: number;
  t: number;
  active: boolean;
}

interface Puff {
  x: number;
  y: number;
  z: number;
  t: number;
  life: number;
  size: number;
  active: boolean;
}

/** Pooled tracers, impact puffs and remote muzzle flashes: 3 draw calls total, no per-frame allocation. */
export class Effects {
  readonly group = new THREE.Group();
  private readonly tracers: Tracer[] = [];
  private readonly tracerGeo: THREE.BufferGeometry;
  private readonly tracerPos: Float32Array;
  private readonly puffs: Puff[] = [];
  private readonly puffMesh: THREE.InstancedMesh;
  private readonly flashes: Puff[] = [];
  private readonly flashMesh: THREE.InstancedMesh;
  private nextTracer = 0;
  private nextPuff = 0;
  private nextFlash = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  readonly light: THREE.PointLight | null;
  private lightT = 0;

  constructor(dynamicLights: number) {
    this.group.name = 'effects';
    this.tracerPos = new Float32Array(MAX_TRACERS * 6);
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    const lines = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    lines.frustumCulled = false;
    this.group.add(lines);
    for (let i = 0; i < MAX_TRACERS; i++) this.tracers.push({ sx: 0, sy: 0, sz: 0, dx: 0, dy: 0, dz: 0, len: 0, t: 0, active: false });

    this.puffMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.14, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_PUFFS);
    this.puffMesh.frustumCulled = false;
    this.puffMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_PUFFS; i++) {
      this.puffs.push({ x: 0, y: 0, z: 0, t: 0, life: 0, size: 1, active: false });
      this.puffMesh.setColorAt(i, this.c.setHex(0xffffff));
    }
    this.group.add(this.puffMesh);

    this.flashMesh = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.16, 0),
      new THREE.MeshBasicMaterial({ color: 0xffcf70, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      24,
    );
    this.flashMesh.frustumCulled = false;
    for (let i = 0; i < 24; i++) this.flashes.push({ x: 0, y: 0, z: 0, t: 0, life: 0, size: 1, active: false });
    this.group.add(this.flashMesh);

    if (dynamicLights > 0) {
      this.light = new THREE.PointLight(0xffc870, 0, 9, 2);
      this.group.add(this.light);
    } else {
      this.light = null;
    }
  }

  tracer(sx: number, sy: number, sz: number, ex: number, ey: number, ez: number): void {
    const dx = ex - sx;
    const dy = ey - sy;
    const dz = ez - sz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1) return;
    const t = this.tracers[this.nextTracer]!;
    this.nextTracer = (this.nextTracer + 1) % MAX_TRACERS;
    t.sx = sx;
    t.sy = sy;
    t.sz = sz;
    t.dx = dx / len;
    t.dy = dy / len;
    t.dz = dz / len;
    t.len = len;
    t.t = 0;
    t.active = true;
  }

  /** Impact puff: kind 1 = world (dust), 2/3 = body/head hit. */
  impact(x: number, y: number, z: number, kind: number): void {
    const p = this.puffs[this.nextPuff]!;
    const i = this.nextPuff;
    this.nextPuff = (this.nextPuff + 1) % MAX_PUFFS;
    p.x = x;
    p.y = y;
    p.z = z;
    p.t = 0;
    p.life = kind >= 2 ? 0.25 : 0.4;
    p.size = kind >= 2 ? 1.4 : 1.1;
    p.active = true;
    this.puffMesh.setColorAt(i, this.c.setHex(kind === 3 ? 0xff3b30 : kind === 2 ? 0xc0392b : 0xb9ab8f));
    if (this.puffMesh.instanceColor) this.puffMesh.instanceColor.needsUpdate = true;
  }

  muzzleFlash(x: number, y: number, z: number, local: boolean): void {
    if (!local) {
      const f = this.flashes[this.nextFlash]!;
      this.nextFlash = (this.nextFlash + 1) % this.flashes.length;
      f.x = x;
      f.y = y;
      f.z = z;
      f.t = 0;
      f.life = 0.06;
      f.active = true;
    }
    if (this.light && local) {
      this.light.position.set(x, y, z);
      this.lightT = 0.05;
    }
  }

  update(dt: number): void {
    const pos = this.tracerPos;
    for (let i = 0; i < MAX_TRACERS; i++) {
      const t = this.tracers[i]!;
      const o = i * 6;
      if (!t.active) {
        pos[o] = pos[o + 1] = pos[o + 2] = pos[o + 3] = pos[o + 4] = pos[o + 5] = 0;
        continue;
      }
      t.t += dt;
      const head = t.t * TRACER_SPEED;
      const tail = head - TRACER_LEN;
      if (tail >= t.len) {
        t.active = false;
        pos[o] = pos[o + 1] = pos[o + 2] = pos[o + 3] = pos[o + 4] = pos[o + 5] = 0;
        continue;
      }
      const a = Math.max(0, tail);
      const b = Math.min(t.len, head);
      pos[o] = t.sx + t.dx * a;
      pos[o + 1] = t.sy + t.dy * a;
      pos[o + 2] = t.sz + t.dz * a;
      pos[o + 3] = t.sx + t.dx * b;
      pos[o + 4] = t.sy + t.dy * b;
      pos[o + 5] = t.sz + t.dz * b;
    }
    (this.tracerGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    for (let i = 0; i < MAX_PUFFS; i++) {
      const p = this.puffs[i]!;
      let sc = 0;
      if (p.active) {
        p.t += dt;
        if (p.t >= p.life) p.active = false;
        else {
          const k = p.t / p.life;
          sc = p.size * (0.6 + k * 1.6) * (1 - k);
        }
      }
      this.m.compose(this.v.set(p.x, p.y + (p.active ? p.t * 0.6 : 0), p.z), this.q, this.s.set(sc, sc, sc));
      this.puffMesh.setMatrixAt(i, this.m);
    }
    this.puffMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.flashes.length; i++) {
      const f = this.flashes[i]!;
      let sc = 0;
      if (f.active) {
        f.t += dt;
        if (f.t >= f.life) f.active = false;
        else sc = 1 + Math.random() * 0.8;
      }
      this.m.compose(this.v.set(f.x, f.y, f.z), this.q, this.s.set(sc, sc, sc));
      this.flashMesh.setMatrixAt(i, this.m);
    }
    this.flashMesh.instanceMatrix.needsUpdate = true;

    if (this.light) {
      this.lightT -= dt;
      this.light.intensity = this.lightT > 0 ? 6 : 0;
    }
  }

  dispose(): void {
    this.tracerGeo.dispose();
    this.puffMesh.geometry.dispose();
    this.flashMesh.geometry.dispose();
  }
}
