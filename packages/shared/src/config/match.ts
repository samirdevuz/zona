/** Match rules, flow and limits (GAME.md 4.1, 4.4, 4.5, 4.7, 4.8). */
export const MATCH = {
  scorePerZonePerS: 0.5,
  /** 0 = off. */
  scoreLimitOptions: [200, 500, 1000, 0] as readonly number[],
  defaultScoreLimit: 500,
  /** Minutes; 0 = off. */
  timeLimitOptionsMin: [10, 15, 20, 0] as readonly number[],
  defaultTimeLimitMin: 15,
  defaultTeams: 2,
  minPlayersToStart: 1,

  countdownS: 5,
  endingS: 5,
  /** RESULTS returns to LOBBY automatically after this long if the admin does nothing. */
  resultsS: 30,

  respawnS: 5,
  spawnProtectionS: 2,
  regenDelayS: 8,
  regenPerS: 8,
  totalControlS: 60,

  oobGraceS: 8,
  oobDamagePerS: 15,
} as const;
