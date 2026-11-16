/** Player movement and capsule dimensions (GAME.md 3.4). Distances in metres, time in seconds. */
export const MOVEMENT = {
  height: 1.8,
  crouchHeight: 1.2,
  radius: 0.4,
  eyeHeight: 1.65,
  crouchEyeHeight: 1.1,

  walkSpeed: 5.0,
  sprintSpeed: 7.4,
  crouchSpeed: 2.6,
  adsSpeed: 3.2,
  backwardMult: 0.85,

  /** Ground acceleration in "wish speeds per second" (Quake-style). */
  groundAccel: 10,
  airAccel: 1.6,
  friction: 8,
  /** Friction uses at least this speed so the player stops crisply. */
  stopSpeed: 1.5,
  gravity: 20,
  jumpSpeed: 6.4,
  terminalVelocity: 40,

  stepHeight: 0.45,
  maxSlopeDeg: 45,
  /** How far below the feet the ground may be and still be snapped to while walking. */
  groundSnap: 0.45,
  /** Push-out iterations for collide-and-slide. */
  collisionIterations: 4,
  /** Horizontal push applied per second on slopes steeper than maxSlopeDeg. */
  steepSlideAccel: 14,
  /** Keep the player this far inside the heightfield edge. */
  worldEdgeMargin: 2,
} as const;

/** Hitboxes: a head sphere and a body capsule (vertical segment), relative to the feet. */
export const HITBOX = {
  headRadius: 0.18,
  headY: 1.6,
  crouchHeadY: 1.02,
  bodyRadius: 0.32,
  bodyY0: 0.32,
  bodyY1: 1.22,
  crouchBodyY1: 0.72,
} as const;
