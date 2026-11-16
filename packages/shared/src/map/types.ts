export type PropType =
  | 'pine'
  | 'tree'
  | 'rock'
  | 'boulder'
  | 'container'
  | 'barrier'
  | 'sandbags'
  | 'ruin'
  | 'tower'
  | 'bunker';

export interface Prop {
  type: PropType;
  x: number;
  y: number;
  z: number;
  /** Quarter turns (0..3) around +Y, same convention as three.js rotation.y = rot * PI/2. */
  rot: number;
  scale: number;
  /** Visual variant index (colour etc.). */
  variant: number;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface Pad {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface ZoneDef {
  id: number;
  letter: string;
  x: number;
  y: number;
  z: number;
  /** Team that starts owning this zone, or -1 for neutral zones. */
  homeTeam: number;
  spawns: SpawnPoint[];
  resupply: Pad;
  jeepPad: Pad;
  tankPad: Pad | null;
}

export interface Road {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Heightfield {
  cell: number;
  /** Vertex counts along X and Z. */
  cols: number;
  rows: number;
  originX: number;
  originZ: number;
  /** Vertex heights in centimetres, row-major (index = row * cols + col). */
  heightsCm: Int16Array;
}

export interface MapData {
  /** Seed actually used (may differ from the requested one after validator retries). */
  seed: number;
  requestedSeed: number;
  teams: number;
  neutrals: number;
  /** Playable radius R. */
  radius: number;
  terrain: Heightfield;
  zones: ZoneDef[];
  props: Prop[];
  roads: Road[];
}

export const COLLIDER_BOX = 0;
export const COLLIDER_CYL = 1;

/** Static collider: axis-aligned box or vertical cylinder. Uniform shape for fast iteration. */
export interface Collider {
  kind: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  /** Cylinder centre and radius (unused for boxes). */
  cx: number;
  cz: number;
  r: number;
}
