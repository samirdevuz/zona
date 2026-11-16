/** Map generation parameters (GAME.md 7). Distances in metres. */
export const MAP = {
  radiusBase: 120,
  radiusPerZone: 35,
  /** The heightfield extends this far beyond the playable radius (hill ring). */
  borderWidth: 70,
  terrainCell: 3,
  /** Terrain noise amplitude range (picked per seed). */
  amplitudeMin: 6,
  amplitudeMax: 10,
  /** Wavelength of the lowest noise octave. */
  noiseWavelength: 110,
  noiseOctaves: 4,
  ridgeHeight: 26,
  /** The ridge starts rising this far inside R and reaches full height ridgeWidth later. */
  ridgeInset: 4,
  ridgeWidth: 46,
  homeRadiusFactor: 0.72,
  ringNeutralFactor: 0.38,
  roadHalfWidth: 3.5,
  roadShoulder: 7,
  colliderGridCell: 8,
  navCell: 2,
  /** Rendering chunk size in terrain cells. */
  chunkCells: 32,
  /**
   * Prop counts per 10 000 m^2 of the fundamental half-sector (the generator
   * places props there and replicates them with the map symmetry).
   */
  treeClustersPer10k: 2.2,
  treesPerClusterMin: 3,
  treesPerClusterMax: 6,
  treeClusterRadius: 9,
  rocksPer10k: 2.2,
  bouldersPer10k: 0.8,
  ruinsPer10k: 0.9,
  /** Containers, barriers and sandbags in the band 20..60 m around zones. */
  nearZonePropsPer10k: 3.0,
  nearZoneMin: 20,
  nearZoneMax: 60,
  towersPerHalfSector: 1,
  bunkersPerHalfSector: 1,
  ridgeDecorPer10k: 5,
  /** Gap kept between prop footprints so players can walk between them. */
  propGap: 1.4,
  /** Clearance kept free around spawn points, pads and the flag. */
  spawnClearance: 1.6,
  maxGenerateAttempts: 8,
} as const;
