/** Vehicles (GAME.md 6). Distances in metres, speeds in m/s, angles in degrees unless noted. */
export type VehicleKind = 'jeep' | 'tank';
export const VEHICLE_KINDS: readonly VehicleKind[] = ['jeep', 'tank'];

export interface VehicleDef {
  kind: VehicleKind;
  hp: number;
  seats: number;
  maxSpeed: number;
  reverseSpeed: number;
  accel: number;
  /** Deceleration when throttling against the motion. */
  brake: number;
  /** Deceleration when coasting. */
  drag: number;
  /** Yaw rate in rad/s. */
  turnRate: number;
  /** Jeep: speed at which full steering is available (cars do not turn on the spot). */
  turnSpeedRef: number;
  /** Jeep: steering reduction at top speed (0..1). */
  turnHighSpeedLoss: number;
  /** Body half extents and height (for hits, terrain sampling and seats). */
  halfLength: number;
  halfWidth: number;
  height: number;
  /** Collision: circles of this radius placed along the length axis at these forward offsets. */
  circleRadius: number;
  circles: readonly number[];
  /** Seat positions in vehicle space: x right, y up from the ground, f forward. Seat 0 = driver. */
  seatOffsets: readonly { x: number; y: number; f: number }[];
  /** Occupants of this vehicle can be shot (jeep) or are protected (tank). */
  exposedOccupants: boolean;
  respawnS: number;
  /** Maximum climbable slope in degrees. */
  maxClimbDeg: number;
}

export const VEHICLES: Record<VehicleKind, VehicleDef> = {
  jeep: {
    kind: 'jeep',
    hp: 250,
    seats: 2,
    maxSpeed: 24,
    reverseSpeed: 8,
    accel: 14,
    brake: 26,
    drag: 5,
    turnRate: 1.8,
    turnSpeedRef: 6,
    turnHighSpeedLoss: 0.45,
    halfLength: 2.1,
    halfWidth: 1.0,
    height: 1.7,
    circleRadius: 1.05,
    circles: [-1.05, 1.05],
    seatOffsets: [
      { x: -0.45, y: 1.0, f: 0.1 },
      { x: 0.45, y: 1.0, f: 0.1 },
    ],
    exposedOccupants: true,
    respawnS: 30,
    maxClimbDeg: 36,
  },
  tank: {
    kind: 'tank',
    hp: 700,
    seats: 1,
    maxSpeed: 10,
    reverseSpeed: 4,
    accel: 5,
    brake: 12,
    drag: 4,
    turnRate: 0.9,
    turnSpeedRef: 0,
    turnHighSpeedLoss: 0,
    halfLength: 3.3,
    halfWidth: 1.7,
    height: 2.3,
    circleRadius: 1.75,
    circles: [-1.6, 0, 1.6],
    seatOffsets: [{ x: 0, y: 2.2, f: 0.2 }],
    exposedOccupants: false,
    respawnS: 75,
    maxClimbDeg: 32,
  },
};

/** Tank weapons (GAME.md 6). */
export const TANK = {
  turretRateDegPerS: 90,
  turretPitchMinDeg: -8,
  turretPitchMaxDeg: 20,
  /** Turret pivot height and barrel length (shell spawn point). */
  turretY: 2.0,
  barrelLength: 3.2,
  cannon: { speed: 80, gravity: 12, damageInfantry: 110, splashRadius: 5, damageVehicle: 150, reloadS: 3.0, maxLifeS: 6 },
  coax: { rpm: 600, overheatAfterS: 5, coolPerS: 1, lockS: 3 },
} as const;

/** Shared vehicle rules. */
export const VEHICLE_RULES = {
  enterRange: 3.5,
  enterHoldS: 0.3,
  /** Exiting faster than this deals fall damage per extra m/s. */
  exitSafeSpeed: 8,
  exitDamagePerMs: 8,
  abandonS: 60,
  wreckS: 5,
  explosionRadius: 6,
  explosionDamage: 80,
  /** Obstacles lower than this above the ground can be driven over. */
  passableHeight: 0.6,
  gravity: 20,
  /** Ramming: minimum speed, and damage per m/s above it. */
  ramMinSpeed: 5,
  ramDamagePerMs: 9,
  /** Jeep passengers may shoot within this half-angle of the vehicle's forward direction. */
  passengerArcDeg: 110,
  /** Impact on obstacles keeps this fraction of speed. */
  impactKeep: 0.35,
} as const;
