import { MAP } from '../config/map';
import { ZONES } from '../config/zones';
import { clamp, lerp, smoothstep } from '../math/vec';
import { HALF_PI, PI, TWO_PI, datan2, dcos, dsin } from '../math/trig';
import { Rng, hash2i } from '../rng/rng';
import { fbm2 } from '../rng/noise';
import { Terrain } from './heightfield';
import { layoutZones, playableRadius, type ZoneSlot } from './layout';
import { PROP_DEFS } from './props';
import type { Heightfield, MapData, Pad, Prop, PropType, Road, SpawnPoint, ZoneDef } from './types';
import { validateMap } from './validate';

/** Yaw (three.js convention: forward = (-sin yaw, 0, -cos yaw)) that faces direction (dx, dz). */
export function yawFromDir(dx: number, dz: number): number {
  return datan2(-dx, -dz);
}

/**
 * Generate a validated map. On validation failure the seed is incremented and
 * generation retried (GAME.md 7.9).
 */
export function generateMap(requestedSeed: number, teams: number, neutrals: number): MapData {
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < MAP.maxGenerateAttempts; attempt++) {
    const seed = (requestedSeed + attempt) >>> 0;
    const map = generateMapUnvalidated(seed, teams, neutrals);
    map.requestedSeed = requestedSeed >>> 0;
    const res = validateMap(map);
    if (res.ok) return map;
    lastErrors = res.errors;
  }
  throw new Error(`Map generation failed for seed ${requestedSeed}: ${lastErrors.slice(0, 5).join('; ')}`);
}

interface Circle {
  x: number;
  z: number;
  r: number;
}

/** Map symmetry: T-fold rotation, optionally combined with mirroring across the home-0 axis. */
class Symmetry {
  readonly sector: number;
  constructor(readonly teams: number) {
    this.sector = TWO_PI / teams;
  }

  /** Polar folding into the fundamental half-sector [0, sector/2]. */
  fold(x: number, z: number, out: { x: number; z: number }): void {
    const r = Math.sqrt(x * x + z * z);
    if (r < 1e-9) {
      out.x = 0;
      out.z = 0;
      return;
    }
    let th = datan2(z, x);
    th = th - this.sector * Math.floor(th / this.sector);
    if (th > this.sector / 2) th = this.sector - th;
    out.x = r * dcos(th);
    out.z = r * dsin(th);
  }

  /** All symmetric copies of (x, z, rot): rotations i*sector, and mirrors if `mirror`. */
  copies(x: number, z: number, rot: number, mirror: boolean): { x: number; z: number; rot: number }[] {
    const out: { x: number; z: number; rot: number }[] = [];
    for (let m = 0; m < (mirror ? 2 : 1); m++) {
      const bx = x;
      const bz = m === 1 ? -z : z;
      const brot = m === 1 ? 2 - rot : rot;
      for (let i = 0; i < this.teams; i++) {
        const phi = i * this.sector;
        const c = dcos(phi);
        const s = dsin(phi);
        const quarter = Math.round(phi / HALF_PI);
        out.push({ x: bx * c - bz * s, z: bx * s + bz * c, rot: (((brot - quarter) % 4) + 4) % 4 });
      }
    }
    return out;
  }
}

function segDist(px: number, pz: number, r: Road, out?: { t: number; x: number; z: number }): number {
  const vx = r.x1 - r.x0;
  const vz = r.z1 - r.z0;
  const l2 = vx * vx + vz * vz;
  let t = l2 > 0 ? ((px - r.x0) * vx + (pz - r.z0) * vz) / l2 : 0;
  t = clamp(t, 0, 1);
  const cx = r.x0 + vx * t;
  const cz = r.z0 + vz * t;
  if (out) {
    out.t = t;
    out.x = cx;
    out.z = cz;
  }
  const dx = px - cx;
  const dz = pz - cz;
  return Math.sqrt(dx * dx + dz * dz);
}

function roadLinks(slots: ZoneSlot[], teams: number): [number, number][] {
  const homes = slots.map((s, i) => (s.kind === 'home' ? i : -1)).filter((i) => i >= 0);
  const center = slots.findIndex((s) => s.kind === 'center');
  const ring = slots.map((s, i) => (s.kind === 'ring' ? i : -1)).filter((i) => i >= 0);
  const links: [number, number][] = [];
  const add = (a: number, b: number): void => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (lo !== hi && !links.some(([x, y]) => x === lo && y === hi)) links.push([lo, hi]);
  };
  for (let i = 0; i < homes.length; i++) {
    if (center >= 0) add(homes[i]!, center);
    if (ring.length > 0) {
      add(homes[i]!, ring[i % ring.length]!);
      add(homes[i]!, ring[(i - 1 + ring.length) % ring.length]!);
    }
    if (center < 0 && ring.length === 0) add(homes[i]!, homes[(i + 1) % teams]!);
  }
  return links;
}

export function generateMapUnvalidated(seed: number, teams: number, neutrals: number): MapData {
  const zoneCount = teams + neutrals;
  const R = playableRadius(zoneCount);
  const slots = layoutZones(teams, neutrals, R);
  const rng = new Rng(seed);
  const noiseSeed = hash2i(seed, 7, 0x9e3779b9);
  const ridgeSeed = hash2i(seed, 13, 0x85ebca6b);
  const amp = rng.range(MAP.amplitudeMin, MAP.amplitudeMax);
  const sym = new Symmetry(teams);
  const folded = { x: 0, z: 0 };
  const wl = MAP.noiseWavelength;

  const natural = (x: number, z: number, octaves: number): number => {
    sym.fold(x, z, folded);
    return amp * fbm2(folded.x / wl + 17.3, folded.z / wl - 5.1, noiseSeed, octaves);
  };

  // Zones: heights are the natural terrain height at their centres (equal by symmetry).
  const zoneH = slots.map((s) => natural(s.x, s.z, MAP.noiseOctaves));
  const roads: Road[] = roadLinks(slots, teams).map(([a, b]) => ({ x0: slots[a]!.x, z0: slots[a]!.z, x1: slots[b]!.x, z1: slots[b]!.z }));

  // Heightfield.
  const cell = MAP.terrainCell;
  const n = Math.ceil((R + MAP.borderWidth) / cell);
  const half = n * cell;
  const cols = 2 * n + 1;
  const heightsCm = new Int16Array(cols * cols);
  const edgeH = MAP.ridgeHeight * 0.95;
  const segOut = { t: 0, x: 0, z: 0 };
  for (let row = 0; row < cols; row++) {
    const z = -half + row * cell;
    for (let col = 0; col < cols; col++) {
      const x = -half + col * cell;
      const r = Math.sqrt(x * x + z * z);
      let h = natural(x, z, MAP.noiseOctaves);
      let bestW = 0;
      let bestH = 0;
      for (const road of roads) {
        const d = segDist(x, z, road, segOut);
        if (d < MAP.roadHalfWidth + MAP.roadShoulder) {
          const w = 1 - smoothstep(MAP.roadHalfWidth, MAP.roadHalfWidth + MAP.roadShoulder, d);
          if (w > bestW) {
            bestW = w;
            bestH = natural(segOut.x, segOut.z, 2);
          }
        }
      }
      if (bestW > 0) h = lerp(h, bestH, bestW);
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i]!;
        const d = Math.sqrt((x - s.x) * (x - s.x) + (z - s.z) * (z - s.z));
        if (d < ZONES.flattenRadius + ZONES.flattenBlend) {
          const w = 1 - smoothstep(ZONES.flattenRadius, ZONES.flattenRadius + ZONES.flattenBlend, d);
          h = lerp(h, zoneH[i]!, w);
        }
      }
      const ridge = smoothstep(R - MAP.ridgeInset, R - MAP.ridgeInset + MAP.ridgeWidth, r);
      if (ridge > 0) {
        sym.fold(x, z, folded);
        const rn = fbm2(folded.x / 40, folded.z / 40, ridgeSeed, 2);
        h += ridge * MAP.ridgeHeight * (0.8 + 0.25 * rn);
      }
      const edge = smoothstep(half - 20, half - 6, Math.max(Math.abs(x), Math.abs(z)));
      if (edge > 0) h = lerp(h, edgeH, edge);
      heightsCm[row * cols + col] = clamp(Math.round(h * 100), -32000, 32000);
    }
  }
  const hf: Heightfield = { cell, cols, rows: cols, originX: -half, originZ: -half, heightsCm };
  const terrain = new Terrain(hf);

  // Zone interiors.
  const reserved: Circle[] = [];
  const zones: ZoneDef[] = slots.map((s, i) => {
    const a0 = s.kind === 'center' ? 0 : datan2(-s.z, -s.x);
    const y = terrain.heightAt(s.x, s.z);
    const spawns: SpawnPoint[] = [];
    for (let j = 0; j < ZONES.spawnPointCount; j++) {
      const a = a0 + ((j + 0.5) * TWO_PI) / ZONES.spawnPointCount;
      const r = j % 2 === 0 ? ZONES.spawnRingMin + 0.5 : ZONES.spawnRingMax - 0.5;
      const sx = s.x + r * dcos(a);
      const sz = s.z + r * dsin(a);
      const faceX = s.kind === 'center' ? sx - s.x : -s.x;
      const faceZ = s.kind === 'center' ? sz - s.z : -s.z;
      spawns.push({ x: sx, y: terrain.heightAt(sx, sz), z: sz, yaw: yawFromDir(faceX, faceZ) });
      reserved.push({ x: sx, z: sz, r: MAP.spawnClearance });
    }
    const pad = (angle: number, dist: number): Pad => {
      const px = s.x + dist * dcos(a0 + angle);
      const pz = s.z + dist * dsin(a0 + angle);
      return { x: px, y: terrain.heightAt(px, pz), z: pz, yaw: yawFromDir(-dcos(a0 + angle), -dsin(a0 + angle)) };
    };
    const jeepPad = pad(0.55 * PI, ZONES.padDistance);
    const tankPad = s.homeTeam < 0 ? pad(-0.55 * PI, ZONES.padDistance) : null;
    const resupply = pad(-0.3 * PI, ZONES.resupplyDistance);
    const padR = ZONES.padHalfSize * 1.42 + 0.5;
    reserved.push({ x: jeepPad.x, z: jeepPad.z, r: padR });
    if (tankPad) reserved.push({ x: tankPad.x, z: tankPad.z, r: padR });
    reserved.push({ x: resupply.x, z: resupply.z, r: 1.8 });
    reserved.push({ x: s.x, z: s.z, r: 2.2 });
    return { id: i, letter: ZONES.letters[i]!, x: s.x, y, z: s.z, homeTeam: s.homeTeam, spawns, resupply, jeepPad, tankPad };
  });

  // Prop placement.
  const props: Prop[] = [];
  const outerLimit = half - 10;
  const zoneDist = (x: number, z: number): number => {
    let best = Infinity;
    for (const s of slots) {
      const d = Math.sqrt((x - s.x) * (x - s.x) + (z - s.z) * (z - s.z));
      if (d < best) best = d;
    }
    return best;
  };
  const fits = (x: number, z: number, fp: number, pending: Circle[]): boolean => {
    if (Math.sqrt(x * x + z * z) + fp > outerLimit) return false;
    for (const c of reserved) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + fp) ** 2) return false;
    for (const road of roads) if (segDist(x, z, road) < MAP.roadHalfWidth + 1 + fp) return false;
    const gap = MAP.propGap;
    for (const p of props) {
      const pf = PROP_DEFS[p.type].footprint * (PROP_DEFS[p.type].scalable ? p.scale : 1);
      if ((x - p.x) ** 2 + (z - p.z) ** 2 < (pf + fp + gap) ** 2) return false;
    }
    for (const c of pending) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + fp + gap) ** 2) return false;
    return true;
  };
  const baseY = (type: PropType, x: number, z: number, rot: number, scale: number): number => {
    const def = PROP_DEFS[type];
    if (def.scalable) return terrain.heightAt(x, z) - 0.15 * scale;
    // Lowest ground under the footprint so man-made props never float.
    const fp = def.footprint * 0.8;
    let y = terrain.heightAt(x, z);
    for (const [ox, oz] of [
      [-fp, -fp],
      [fp, -fp],
      [-fp, fp],
      [fp, fp],
      [0, fp],
      [0, -fp],
      [fp, 0],
      [-fp, 0],
    ] as const) {
      y = Math.min(y, terrain.heightAt(x + ox, z + oz));
    }
    void rot;
    return y - 0.05;
  };
  /** Try to place a prop and all its symmetric copies; all-or-nothing. */
  const tryPlace = (type: PropType, x: number, z: number, rot: number, scale: number, variant: number, mirror: boolean): boolean => {
    const def = PROP_DEFS[type];
    const fp = def.footprint * (def.scalable ? scale : 1);
    const copies = sym.copies(x, z, rot, mirror);
    const pending: Circle[] = [];
    for (const c of copies) {
      if (!fits(c.x, c.z, fp, pending)) return false;
      pending.push({ x: c.x, z: c.z, r: fp });
    }
    for (const c of copies) props.push({ type, x: c.x, y: baseY(type, c.x, c.z, c.rot, scale), z: c.z, rot: c.rot, scale, variant });
    return true;
  };
  const halfSector = sym.sector / 2;
  const sampleWedge = (rMin: number, rMax: number, out: { x: number; z: number }): void => {
    const r = Math.sqrt(rMin * rMin + rng.next() * (rMax * rMax - rMin * rMin));
    const th = rng.next() * halfSector;
    out.x = r * dcos(th);
    out.z = r * dsin(th);
  };
  const wedgeArea = (rMin: number, rMax: number): number => (sym.sector / 4) * (rMax * rMax - rMin * rMin);
  const countFor = (per10k: number, rMin: number, rMax: number): number => {
    const exact = (per10k * wedgeArea(rMin, rMax)) / 10000;
    const base = Math.floor(exact);
    return base + (rng.next() < exact - base ? 1 : 0);
  };
  const p = { x: 0, z: 0 };
  const scatter = (count: number, rMin: number, rMax: number, accept: (x: number, z: number) => boolean, place: (x: number, z: number) => boolean): void => {
    for (let placed = 0, tries = 0; placed < count && tries < count * 40; tries++) {
      sampleWedge(rMin, rMax, p);
      if (!accept(p.x, p.z)) continue;
      if (place(p.x, p.z)) placed++;
    }
  };

  // 1. Zone cover (rotation symmetry only: zone interiors carry pads that are not mirrored).
  const coverTypes: PropType[] = ['barrier', 'barrier', 'sandbags', 'sandbags', 'container', 'rock'];
  const orbitReps = slots.filter((s, i) => s.kind === 'center' || (s.kind === 'home' && s.homeTeam === 0) || (s.kind === 'ring' && i === slots.findIndex((q) => q.kind === 'ring')));
  for (const s of orbitReps) {
    let count = rng.int(ZONES.coverPropsMin, ZONES.coverPropsMax);
    if (s.kind === 'center') count = Math.ceil(count / teams);
    for (let placed = 0, tries = 0; placed < count && tries < 60 * count; tries++) {
      const a = rng.next() * TWO_PI;
      const r = rng.range(4.5, 16);
      const type = rng.pick(coverTypes);
      const rot = rng.int(0, 3);
      const scale = type === 'rock' ? rng.range(0.9, 1.3) : 1;
      if (tryPlace(type, s.x + r * dcos(a), s.z + r * dsin(a), rot, scale, rng.int(0, 3), false)) placed++;
    }
  }

  // 2. Structures.
  const playR = R - 6;
  for (let i = 0; i < MAP.towersPerHalfSector; i++) {
    scatter(1, 0.3 * R, 0.85 * R, (x, z) => zoneDist(x, z) > 45, (x, z) => tryPlace('tower', x, z, rng.int(0, 3), 1, 0, true));
  }
  for (let i = 0; i < MAP.bunkersPerHalfSector; i++) {
    scatter(1, 0, playR - 4, (x, z) => {
      const d = zoneDist(x, z);
      return d > 24 && d < 42;
    }, (x, z) => tryPlace('bunker', x, z, rng.int(0, 3), 1, 0, true));
  }
  scatter(countFor(MAP.ruinsPer10k, 0, playR), 0, playR - 4, (x, z) => {
    const d = zoneDist(x, z);
    return d > 24 && d < 90;
  }, (x, z) => tryPlace('ruin', x, z, rng.int(0, 3), 1, rng.int(0, 3), true));

  // 3. Near-zone man-made cover.
  const nearTypes: PropType[] = ['container', 'container', 'barrier', 'sandbags'];
  scatter(countFor(MAP.nearZonePropsPer10k, 0, playR), 0, playR, (x, z) => {
    const d = zoneDist(x, z);
    return d > MAP.nearZoneMin && d < MAP.nearZoneMax;
  }, (x, z) => tryPlace(rng.pick(nearTypes), x, z, rng.int(0, 3), 1, rng.int(0, 3), true));

  // 4. Natural props.
  const clusters = countFor(MAP.treeClustersPer10k, 0, playR);
  for (let c = 0, tries = 0; c < clusters && tries < clusters * 30; tries++) {
    sampleWedge(0, playR, p);
    if (zoneDist(p.x, p.z) < 26) continue;
    const cx = p.x;
    const cz = p.z;
    const kind: PropType = rng.next() < 0.6 ? 'pine' : 'tree';
    const nTrees = rng.int(MAP.treesPerClusterMin, MAP.treesPerClusterMax);
    let placed = 0;
    for (let t = 0; t < nTrees * 6 && placed < nTrees; t++) {
      const a = rng.next() * TWO_PI;
      const r = rng.next() * MAP.treeClusterRadius;
      const x = cx + r * dcos(a);
      const z = cz + r * dsin(a);
      if (zoneDist(x, z) < 22) continue;
      if (tryPlace(rng.next() < 0.8 ? kind : 'rock', x, z, rng.int(0, 3), rng.range(0.8, 1.3), rng.int(0, 3), true)) placed++;
    }
    c++;
  }
  scatter(countFor(MAP.rocksPer10k, 0, playR), 0, playR, (x, z) => zoneDist(x, z) > 18, (x, z) =>
    tryPlace('rock', x, z, rng.int(0, 3), rng.range(0.7, 1.5), rng.int(0, 3), true),
  );
  scatter(countFor(MAP.bouldersPer10k, 0, playR), 0, playR, (x, z) => zoneDist(x, z) > 30, (x, z) =>
    tryPlace('boulder', x, z, rng.int(0, 3), rng.range(0.8, 1.3), rng.int(0, 3), true),
  );

  // 5. Decoration on the hill ring beyond the playable radius.
  const ridgeTypes: PropType[] = ['pine', 'pine', 'pine', 'tree', 'rock', 'boulder'];
  scatter(countFor(MAP.ridgeDecorPer10k, R + 2, outerLimit), R + 2, outerLimit, () => true, (x, z) =>
    tryPlace(rng.pick(ridgeTypes), x, z, rng.int(0, 3), rng.range(0.9, 1.5), rng.int(0, 3), true),
  );

  // Round to millimetres: compact JSON, and identical numbers on every machine.
  const mm = (v: number): number => Math.round(v * 1000) / 1000;
  for (const pr of props) {
    pr.x = mm(pr.x);
    pr.y = mm(pr.y);
    pr.z = mm(pr.z);
    pr.scale = mm(pr.scale);
  }
  const roundPad = (q: Pad | SpawnPoint): void => {
    q.x = mm(q.x);
    q.y = mm(q.y);
    q.z = mm(q.z);
    q.yaw = mm(q.yaw);
  };
  for (const z of zones) {
    z.x = mm(z.x);
    z.y = mm(z.y);
    z.z = mm(z.z);
    z.spawns.forEach(roundPad);
    roundPad(z.jeepPad);
    roundPad(z.resupply);
    if (z.tankPad) roundPad(z.tankPad);
  }
  for (const r of roads) {
    r.x0 = mm(r.x0);
    r.z0 = mm(r.z0);
    r.x1 = mm(r.x1);
    r.z1 = mm(r.z1);
  }
  return { seed, requestedSeed: seed, teams, neutrals, radius: R, terrain: hf, zones, props, roads };
}
