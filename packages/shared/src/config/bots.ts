import type { ClassId } from './classes';

/** Bots (GAME.md 9). */
export type BotDifficulty = 'easy' | 'medium' | 'hard';
export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['easy', 'medium', 'hard'];

export interface BotDifficultyDef {
  /** Seconds before the first shot at a newly seen target. */
  reactionS: number;
  /** Initial aim error (degrees); it shrinks while the target stays visible. */
  aimErrDeg: number;
  /** 0..1: how far the aim error can shrink (1 = almost perfect). */
  accuracy: number;
  /** Max view turn rate (deg/s). */
  turnRateDeg: number;
}

export const BOT_DIFFICULTY: Record<BotDifficulty, BotDifficultyDef> = {
  easy: { reactionS: 0.8, aimErrDeg: 6, accuracy: 0.6, turnRateDeg: 220 },
  medium: { reactionS: 0.5, aimErrDeg: 3.5, accuracy: 0.8, turnRateDeg: 320 },
  hard: { reactionS: 0.3, aimErrDeg: 2, accuracy: 1.0, turnRateDeg: 450 },
};

export const BOTS = {
  defaultEnabled: false,
  defaultFillTo: 4,
  maxFillTo: 8,
  defaultDifficulty: 'medium' as BotDifficulty,
  /** Objective re-evaluation interval (random in range). */
  decisionMinS: 2,
  decisionMaxS: 4,
  /** Team-level objective assignment interval. */
  teamPlanS: 3,
  viewConeDeg: 120,
  viewRangeM: 80,
  /** Line-of-sight checks per second per bot (staggered). */
  perceptionHz: 8,
  /** Enemies firing within this range are heard (and looked at). */
  hearingRangeM: 35,
  /** Seconds a lost target is remembered. */
  memoryS: 3,
  /** A* requests served per server tick (time slicing). */
  pathsPerTick: 2,
  maxPathNodes: 40000,
  waypointReachM: 1.8,
  stuckCheckS: 1.2,
  stuckMoveM: 0.7,
  retreatHpFrac: 0.35,
  sniperHoldMinM: 25,
  sniperHoldMaxM: 40,
  /** Automatic fire comes in bursts. */
  burstMinS: 0.25,
  burstMaxS: 0.6,
  burstPauseMinS: 0.15,
  burstPauseMaxS: 0.4,
  strafeMinS: 0.5,
  strafeMaxS: 1.2,
  /** Aim error halves roughly every this many seconds while the target is visible. */
  aimSettleS: 0.8,
  /** Wanted share of each class in a team (composition balance). */
  classWeights: { assault: 0.35, engineer: 0.2, gunner: 0.25, sniper: 0.2 } as Record<ClassId, number>,
  /** Uzbek given names for bots (GAME.md 9). */
  names: [
    'Aziz', 'Bekzod', 'Davron', 'Elyor', 'Farrux', "G'ayrat", 'Hamid', 'Ilhom', 'Jasur', 'Kamol',
    'Laziz', 'Mirzo', 'Nodir', 'Otabek', "Po'lat", 'Rustam', 'Sardor', 'Temur', "Ulug'bek", 'Vali',
    'Xurshid', 'Yusuf', 'Zafar', 'Shoxrux', 'Sherzod', 'Anvar', 'Diyor', 'Eldor', 'Islom', 'Javohir',
  ] as readonly string[],
} as const;
