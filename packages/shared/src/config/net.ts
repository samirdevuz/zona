/** Networking and timing constants (GAME.md 3.3). */
export const NET = {
  PROTOCOL_VERSION: 1,
  /** Fixed movement step for players (client and server). */
  MOVE_DT: 1 / 60,
  SERVER_TICK_HZ: 30,
  SNAPSHOT_HZ: 30,
  INPUT_SEND_HZ: 30,
  /** Input steps the server consumes per actor per tick in steady state (60 Hz / 30 Hz). */
  STEPS_PER_TICK: 2,
  /** When an actor's input backlog exceeds this, the server consumes more steps to catch up. */
  INPUT_BACKLOG_CATCHUP: 6,
  MAX_STEPS_PER_TICK_CATCHUP: 4,
  /** Inputs older than this backlog are dropped (protects against a stalled tab flooding). */
  MAX_INPUT_QUEUE: 30,
  INTERP_DELAY_MS: 100,
  MAX_EXTRAPOLATION_MS: 100,
  MAX_HUMANS: 12,
  MAX_ACTORS: 24,
  /** Lag compensation window in ms. 0 = off (M1, LAN). */
  LAG_COMP_MS: 0,
  RECONNECT_GRACE_S: 60,
  DEFAULT_PORT: 3000,
  PING_INTERVAL_MS: 1000,
  /** Scoreboard (kills/deaths/ping/tick time) broadcast interval in server ticks. */
  BOARD_INTERVAL_TICKS: 15,
  TICK_BUDGET_MS: 8,
  TICK_WARN_MS: 15,
  MAX_MESSAGE_BYTES: 256 * 1024,
  MAX_NAME_LENGTH: 16,
  /** Client: duration over which a small reconciliation error is visually smoothed. */
  RECONCILE_SMOOTH_MS: 120,
  /** Client: errors larger than this (m) snap instead of smoothing. */
  RECONCILE_SNAP_DISTANCE: 1.5,
} as const;
