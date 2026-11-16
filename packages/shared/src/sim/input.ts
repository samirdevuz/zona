/** Input button bitmask (GAME.md 14). */
export const BTN = {
  FORWARD: 1 << 0,
  BACK: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  JUMP: 1 << 4,
  CROUCH: 1 << 5,
  SPRINT: 1 << 6,
  FIRE: 1 << 7,
  ADS: 1 << 8,
  RELOAD: 1 << 9,
  USE: 1 << 10,
  GADGET_A: 1 << 11,
  GADGET_B: 1 << 12,
  GRENADE: 1 << 13,
} as const;

/** One fixed MOVE_DT step of input. Humans and bots produce the same thing. */
export interface InputStep {
  /** Buttons bitmask. */
  b: number;
  yaw: number;
  pitch: number;
}
