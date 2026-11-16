import { MAP } from '../config/map';
import { ZONES } from '../config/zones';
import { PI, TWO_PI, dcos, dsin } from '../math/trig';

/** Allowed (T, N) combinations (GAME.md 4.2). */
export const ALLOWED_NEUTRALS: Record<number, readonly number[]> = {
  2: [0, 1, 2, 3],
  3: [0, 1, 3],
  4: [0, 1, 4],
};

export function isAllowedCombo(teams: number, neutrals: number): boolean {
  return (ALLOWED_NEUTRALS[teams] ?? []).includes(neutrals);
}

/** "Auto" neutral count from participants (GAME.md 4.1). */
export function autoNeutrals(participants: number, teams: number): number {
  if (teams > 2) return 1;
  if (participants <= 3) return 0;
  if (participants <= 6) return 1;
  return 2;
}

export function playableRadius(zoneCount: number): number {
  return MAP.radiusBase + MAP.radiusPerZone * zoneCount;
}

export interface ZoneSlot {
  x: number;
  z: number;
  /** Team that starts owning it, or -1 for neutral. */
  homeTeam: number;
  /** Polar angle of the slot (0 for the centre). */
  angle: number;
  kind: 'home' | 'center' | 'ring';
}

/**
 * Zone positions for T teams and N neutral zones (GAME.md 7.2).
 * Homes first (A = team 0 ...), then the centre zone (if any), then ring neutrals.
 */
export function layoutZones(teams: number, neutrals: number, radius?: number): ZoneSlot[] {
  if (!isAllowedCombo(teams, neutrals)) throw new Error(`Unsupported zone combo T=${teams} N=${neutrals}`);
  const R = radius ?? playableRadius(teams + neutrals);
  const slots: ZoneSlot[] = [];
  const homeR = MAP.homeRadiusFactor * R;
  for (let i = 0; i < teams; i++) {
    const a = (TWO_PI * i) / teams;
    slots.push({ x: homeR * dcos(a), z: homeR * dsin(a), homeTeam: i, angle: a, kind: 'home' });
  }
  const hasCenter = neutrals === 1 || (teams === 2 && neutrals === 3);
  const ringCount = neutrals - (hasCenter ? 1 : 0);
  if (hasCenter) slots.push({ x: 0, z: 0, homeTeam: -1, angle: 0, kind: 'center' });
  if (ringCount > 0) {
    const ringR = MAP.ringNeutralFactor * R;
    for (let i = 0; i < ringCount; i++) {
      const a = (TWO_PI * i) / teams + PI / teams;
      slots.push({ x: ringR * dcos(a), z: ringR * dsin(a), homeTeam: -1, angle: a, kind: 'ring' });
    }
  }
  if (slots.length > ZONES.maxZones) throw new Error('Too many zones');
  return slots;
}
