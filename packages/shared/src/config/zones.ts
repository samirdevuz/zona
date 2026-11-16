/** Zone rules and anatomy (GAME.md 4.2, 4.3). */
export const ZONES = {
  /** T=4, N=4 needs 8 zones (see DECISIONS.md). */
  maxZones: 8,
  letters: 'ABCDEFGH',
  captureRadius: 14,
  /** Capture cylinder extends this far above and below the zone centre height. */
  captureHalfHeight: 8,
  /** Percent per second for one actor; scales with n^presenceExponent. */
  baseRatePctPerS: 5,
  presenceExponent: 0.75,
  /** Partial control of non-owners decays this fast when nobody is present. */
  decayPctPerS: 2,
  spawnPointCount: 8,
  spawnRingMin: 8,
  spawnRingMax: 11,
  coverPropsMin: 6,
  coverPropsMax: 10,
  /** Terrain is flattened within this radius of a zone centre... */
  flattenRadius: 22,
  /** ...and blended back to natural terrain over this distance. */
  flattenBlend: 16,
  /** Distance from the zone centre to the jeep pad / resupply station. */
  padDistance: 17,
  resupplyDistance: 6,
  padHalfSize: 3,
  /** Max height difference across a pad footprint. */
  padMaxHeightDiff: 0.6,
} as const;
