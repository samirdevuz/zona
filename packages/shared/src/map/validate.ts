import { MOVEMENT } from '../config/movement';
import { ZONES } from '../config/zones';
import { datan2 } from '../math/trig';
import { blockedAt, buildNavGrid, floodFill, nearestWalkable } from './nav';
import type { MapData, Pad } from './types';
import { World } from './world';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Map validator (GAME.md 7.9). Runs in tests and at runtime. */
export function validateMap(map: MapData, world: World = new World(map)): ValidationResult {
  const errors: string[] = [];
  const scratch: number[] = [];
  const t = world.terrain;

  // 1. Reachability between all zones.
  const nav = buildNavGrid(world);
  const starts = map.zones.map((z) => nearestWalkable(nav, z.x, z.z, 3));
  starts.forEach((s, i) => {
    if (s < 0) errors.push(`zone ${map.zones[i]!.letter}: centre not walkable`);
  });
  if (starts[0]! >= 0) {
    const seen = floodFill(nav, starts[0]!);
    starts.forEach((s, i) => {
      if (s >= 0 && !seen[s]) errors.push(`zone ${map.zones[i]!.letter} unreachable from ${map.zones[0]!.letter}`);
    });
  }

  // 2. Spawn points and pads are free of colliders and inside the playable area.
  for (const z of map.zones) {
    z.spawns.forEach((s, i) => {
      if (blockedAt(world, s.x, s.z, t.heightAt(s.x, s.z), MOVEMENT.radius + 0.1, scratch)) errors.push(`zone ${z.letter} spawn ${i} blocked`);
      if (Math.hypot(s.x, s.z) > map.radius) errors.push(`zone ${z.letter} spawn ${i} out of bounds`);
    });
    const pads: [string, Pad][] = [
      ['jeep', z.jeepPad],
      ['resupply', z.resupply],
    ];
    if (z.tankPad) pads.push(['tank', z.tankPad]);
    for (const [name, pad] of pads) {
      const hs = name === 'resupply' ? 0.8 : ZONES.padHalfSize;
      let minY = Infinity;
      let maxY = -Infinity;
      let blocked = false;
      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
          const x = pad.x + (i / 2) * hs;
          const zz = pad.z + (j / 2) * hs;
          const y = t.heightAt(x, zz);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          if (blockedAt(world, x, zz, y, 0.3, scratch)) blocked = true;
        }
      }
      if (blocked) errors.push(`zone ${z.letter} ${name} pad blocked`);
      if (maxY - minY > ZONES.padMaxHeightDiff) errors.push(`zone ${z.letter} ${name} pad not flat (${(maxY - minY).toFixed(2)} m)`);
    }
  }

  // 3. Symmetry: per-home zone distance multisets and prop counts per team sector.
  const homes = map.zones.filter((z) => z.homeTeam >= 0);
  const distSig = (h: (typeof homes)[number]): number[] =>
    map.zones
      .filter((z) => z !== h)
      .map((z) => Math.hypot(z.x - h.x, z.z - h.z))
      .sort((a, b) => a - b);
  const ref = distSig(homes[0]!);
  for (const h of homes.slice(1)) {
    const sig = distSig(h);
    if (sig.some((d, i) => Math.abs(d - ref[i]!) > 0.5)) errors.push(`zone distances differ for ${h.letter}`);
  }
  const sector = (2 * Math.PI) / map.teams;
  const counts = new Array<number>(map.teams).fill(0);
  for (const p of map.props) {
    // Sector i is centred on home i; shift by half a sector so boundaries fall between homes.
    let a = datan2(p.z, p.x) + sector / 2;
    a -= 2 * Math.PI * Math.floor(a / (2 * Math.PI));
    counts[Math.min(map.teams - 1, Math.floor(a / sector))]!++;
  }
  if (counts.some((c) => c !== counts[0])) errors.push(`prop counts per sector differ: ${counts.join(',')}`);
  for (let i = 1; i < homes.length; i++) {
    if (Math.abs(homes[i]!.y - homes[0]!.y) > 0.05) errors.push(`home zone heights differ (${homes[i]!.letter})`);
  }

  return { ok: errors.length === 0, errors };
}
