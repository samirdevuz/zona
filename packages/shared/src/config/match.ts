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
  teamOptions: [2, 3, 4] as readonly number[],

  countdownS: 5,
  endingS: 5,
  /** RESULTS returns to LOBBY automatically after this long if the admin does nothing. */
  resultsS: 30,

  respawnS: 5,
  /** A dead player who never presses Deploy is deployed automatically this long after the timer. */
  autoDeployS: 10,
  /** "Zone under attack" announcements are throttled per zone. */
  attackAnnounceS: 12,
  spawnProtectionS: 2,
  regenDelayS: 8,
  regenPerS: 8,
  totalControlS: 60,

  oobGraceS: 8,
  oobDamagePerS: 15,
} as const;
