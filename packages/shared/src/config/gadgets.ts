/** Gadgets and throwables (GAME.md 5.2). */
export const GADGETS = {
  medpack: { healPerS: 10, radius: 3, durationS: 15, cooldownS: 25 },
  ammobox: { refillPctPerS: 25, radius: 3, durationS: 15, cooldownS: 30 },
  grenade: {
    fuseS: 3,
    radius: 5,
    damage: 100,
    carried: 2,
    throwSpeed: 17,
    /** Extra upward angle added to the aim when throwing (radians). */
    throwLift: 0.16,
    restitution: 0.35,
    /** Fraction of tangential speed kept per bounce. */
    friction: 0.65,
    gravity: 15,
    /** Exponential speed decay per second while rolling on the ground. */
    rollDamping: 4,
    /** Time after a throw before the next action. */
    throwTimeS: 0.6,
    vehicleDamageMult: 0.6,
  },
  rocket: {
    speed: 45,
    gravity: 0,
    /** Splash added to the direct hit; the direct-hit target therefore takes at most 60 + 40 = 100. */
    splashRadius: 4,
    splashDamage: 40,
    vehicleDamage: 160,
    maxLifeS: 8,
  },
  torch: { repairPerS: 60, range: 3 },
  /** Time to raise a newly selected item. */
  switchTimeS: 0.45,
  /** Deployables are placed this far in front of the player. */
  deployForward: 1.0,
} as const;

/** Zone resupply (GAME.md 4.6). */
export const RESUPPLY = {
  radius: 12,
  healPerS: 8,
  ammoPctPerS: 20,
  vehicleRepairPerS: 10,
} as const;
