import { BOT_DIFFICULTIES, type BotDifficulty } from '../config/bots';
import { CLASS_IDS, type ClassId } from '../config/classes';
import type { Heightfield, MapData } from '../map/types';
import type { PlayerState } from '../sim/player';
import type { VehicleState } from '../sim/vehicle';
import type { WinReason } from '../sim/rules';
import { base64ToInt16, int16ToBase64 } from './base64';


import { NET } from '../config/net';

export const PROTOCOL_VERSION = NET.PROTOCOL_VERSION;

export type Phase = 'lobby' | 'countdown' | 'live' | 'ending' | 'results';

export interface MatchSettings {
  teams: number;
  neutrals: number;
  /** Text or number; "" means random. */
  seed: string;
  /** When true, `neutrals` is chosen at match start from the participant count (GAME.md 4.1). */
  autoNeutrals: boolean;
  /** 0 = off. */
  scoreLimit: number;
  /** Minutes; 0 = off. */
  timeLimitMin: number;
  /** Vehicles on pads (GAME.md 4.1). */
  vehicles: boolean;
  /** Bots fill every team up to `botFill` players (GAME.md 4.1, 9). */
  bots: boolean;
  botFill: number;
  botDifficulty: BotDifficulty;
}

export interface LobbyPlayer {
  id: number;
  name: string;
  team: number;
  admin: boolean;
  connected: boolean;
  ping: number;
}

/** Actor roster entry (humans now, bots in M4). */
export interface ActorInfo {
  id: number;
  name: string;
  team: number;
  bot: boolean;
}

export interface MapBlob extends Omit<MapData, 'terrain'> {
  terrain: Omit<Heightfield, 'heightsCm'> & { heightsB64: string };
}

export function encodeMap(map: MapData): MapBlob {
  const { heightsCm, ...rest } = map.terrain;
  return { ...map, terrain: { ...rest, heightsB64: int16ToBase64(heightsCm) } };
}

export function decodeMap(blob: MapBlob): MapData {
  const { heightsB64, ...rest } = blob.terrain;
  return { ...blob, terrain: { ...rest, heightsCm: base64ToInt16(heightsB64) } };
}

/** Authoritative state of the receiving client's own actor. */
export interface MeNet {
  st: PlayerState;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Seconds until respawn is possible (when dead). */
  respawnT: number;
  protectT: number;
  /** Seconds spent outside the playable radius (0 when inside). */
  oobT: number;
  classId: ClassId;
  /** Vehicle seat, with the vehicle state when driving (for prediction). */
  veh: { id: number; seat: number; vs: VehicleState | null } | null;
}

/** Remote actor fields per entry in SnapshotMsg.a (flat array). */
export const ACTOR_FIELDS = 10; // id, x, y, z, yaw, pitch, flags, speed, class index, slot
export const AF_ALIVE = 1;
export const AF_CROUCH = 2;
export const AF_GROUND = 4;
export const AF_ADS = 8;
export const AF_SPRINT = 16;
export const AF_RELOAD = 32;
export const AF_PROTECT = 64;

/** Shot fields per entry in SnapshotMsg.shots (flat array): actor, end x, y, z, hit kind, weapon index. */
export const SHOT_FIELDS = 6;
/** Projectile fields per entry in SnapshotMsg.p: id, kind, x, y, z. */
export const PROJ_FIELDS = 5;
/** Deployable fields per entry in SnapshotMsg.d: id, kind, team, x, y, z. */
export const DEP_FIELDS = 6;
/** Vehicle fields per entry in SnapshotMsg.v. */
export const VEH_FIELDS = 16; // id, kind, team, x, y, z, yaw, pitch, roll, turretYaw, turretPitch, hp, flags, driver, passenger, speed
export const VF_DESTROYED = 1;
/** Explosion kind for a destroyed vehicle (boom events). */
export const BOOM_VEHICLE = 4;
/** Kill-feed weapon codes. */
export const W_ENV = -1;
export const W_GRENADE = -2;
export const W_VEHICLE_BOOM = -3;
export const W_RAM = -4;
export const DEP_MEDPACK = 1;
export const DEP_AMMOBOX = 2;

export type GameEvent =
  /** w = weapon index (WEAPON_IDS) or a W_* code. */
  | { k: 'kill'; killer: number; victim: number; head: boolean; w: number }
  | { k: 'boom'; x: number; y: number; z: number; r: number; kind: number }
  | { k: 'attack'; zone: number; team: number }
  | { k: 'hit'; target: number; dmg: number; head: boolean; kill: boolean }
  | { k: 'dmg'; from: number; x: number; z: number; dmg: number }
  | { k: 'cap'; zone: number; team: number }
  | { k: 'lost'; zone: number; team: number }
  | { k: 'spawn'; actor: number }
  | { k: 'elim'; team: number };

export interface BoardRow {
  id: number;
  kills: number;
  deaths: number;
  caps: number;
  ping: number;
}

// ---- Client -> server --------------------------------------------------

export type ClientMsg =
  | { t: 'join'; name: string; token?: string; protocol: number }
  /** team -1 = auto-balance. */
  | { t: 'lobby/setTeam'; team: number }
  | { t: 'lobby/shuffle' }
  | { t: 'lobby/settings'; settings: Partial<MatchSettings> }
  | { t: 'lobby/start' }
  | { t: 'lobby/kick'; id: number }
  | { t: 'lobby/return' }
  /** seq = sequence number of the first step; steps = flat [buttons, yaw, pitch, slot] quads (slot -1 = keep). */
  | { t: 'input'; seq: number; steps: number[] }
  | { t: 'spawn/request'; zone: number; classId: ClassId; ready: boolean }
  | { t: 'ping'; t0: number; rtt: number }
  | { t: 'debug'; cmd: 'teleport'; x: number; y: number; z: number; yaw: number; pitch: number }
  | { t: 'debug'; cmd: 'damage'; target: number; amount: number };

// ---- Server -> client --------------------------------------------------

export interface SnapshotMsg {
  t: 'snapshot';
  tick: number;
  /** Last input sequence number processed for this client's actor. */
  ack: number;
  phase: Phase;
  /** Seconds left in the current phase or match (-1 = no limit). */
  timeLeft: number;
  me: MeNet | null;
  /** Flat array, ACTOR_FIELDS per actor. */
  a: number[];
  /** Per zone: owner, contested (0/1), then control per team. */
  z: number[];
  /** Team scores. */
  s: number[];
  shots: number[];
  /** Projectiles, PROJ_FIELDS each. */
  p: number[];
  /** Deployables, DEP_FIELDS each. */
  d: number[];
  /** Total control: [team, seconds held] or [] when no team owns every zone. */
  tc: number[];
  /** Vehicles, VEH_FIELDS each. */
  v: number[];
}

export type ServerMsg =
  | { t: 'welcome'; id: number; token: string; protocol: number; serverTime: number }
  | { t: 'lobby/state'; phase: Phase; players: LobbyPlayer[]; adminId: number; settings: MatchSettings }
  | { t: 'match/start'; map: MapBlob; settings: MatchSettings; you: number; roster: ActorInfo[]; tick: number }
  | { t: 'roster'; roster: ActorInfo[] }
  | SnapshotMsg
  | { t: 'event'; tick: number; e: GameEvent[] }
  | { t: 'board'; rows: BoardRow[]; tickMs: number }
  | { t: 'match/end'; winner: number; reason: WinReason; scores: number[]; rows: BoardRow[] }
  | { t: 'pong'; t0: number; serverTime: number }
  | { t: 'error'; code: string; message: string };

// ---- Encoding ----------------------------------------------------------

/** JSON for M1; kept behind these functions so a binary codec can replace it (GAME.md 3.3). */
export function encodeMsg(m: ClientMsg | ServerMsg): string {
  return JSON.stringify(m);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length <= max;

/** Parse and shape-check an untrusted client message. Returns null if invalid. */
export function parseClientMsg(raw: string): ClientMsg | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null) return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case 'join':
      if (!isStr(o.name, 64) || !isNum(o.protocol)) return null;
      if (o.token !== undefined && !isStr(o.token, 128)) return null;
      return { t: 'join', name: o.name, protocol: o.protocol, ...(o.token ? { token: o.token as string } : {}) };
    case 'lobby/setTeam':
      return isNum(o.team) ? { t: 'lobby/setTeam', team: o.team } : null;
    case 'lobby/shuffle':
      return { t: 'lobby/shuffle' };
    case 'lobby/settings': {
      if (typeof o.settings !== 'object' || o.settings === null) return null;
      const s = o.settings as Record<string, unknown>;
      const out: Partial<MatchSettings> = {};
      if (isNum(s.teams)) out.teams = s.teams;
      if (isNum(s.neutrals)) out.neutrals = s.neutrals;
      if (isStr(s.seed, 32)) out.seed = s.seed;
      if (typeof s.autoNeutrals === 'boolean') out.autoNeutrals = s.autoNeutrals;
      if (typeof s.vehicles === 'boolean') out.vehicles = s.vehicles;
      if (typeof s.bots === 'boolean') out.bots = s.bots;
      if (isNum(s.botFill)) out.botFill = s.botFill;
      if (BOT_DIFFICULTIES.includes(s.botDifficulty as BotDifficulty)) out.botDifficulty = s.botDifficulty as BotDifficulty;
      if (isNum(s.scoreLimit)) out.scoreLimit = s.scoreLimit;
      if (isNum(s.timeLimitMin)) out.timeLimitMin = s.timeLimitMin;
      return { t: 'lobby/settings', settings: out };
    }
    case 'lobby/start':
      return { t: 'lobby/start' };
    case 'lobby/return':
      return { t: 'lobby/return' };
    case 'lobby/kick':
      return isNum(o.id) ? { t: 'lobby/kick', id: o.id } : null;
    case 'input': {
      if (!isNum(o.seq) || !Array.isArray(o.steps) || o.steps.length % 4 !== 0 || o.steps.length > 4 * 64) return null;
      if (!o.steps.every(isNum)) return null;
      return { t: 'input', seq: o.seq, steps: o.steps as number[] };
    }
    case 'spawn/request':
      return isNum(o.zone) && CLASS_IDS.includes(o.classId as ClassId) && typeof o.ready === 'boolean'
        ? { t: 'spawn/request', zone: o.zone, classId: o.classId as ClassId, ready: o.ready }
        : null;
    case 'ping':
      return isNum(o.t0) && isNum(o.rtt) ? { t: 'ping', t0: o.t0, rtt: o.rtt } : null;
    case 'debug':
      if (o.cmd === 'teleport' && isNum(o.x) && isNum(o.y) && isNum(o.z) && isNum(o.yaw) && isNum(o.pitch))
        return { t: 'debug', cmd: 'teleport', x: o.x, y: o.y, z: o.z, yaw: o.yaw, pitch: o.pitch };
      if (o.cmd === 'damage' && isNum(o.target) && isNum(o.amount)) return { t: 'debug', cmd: 'damage', target: o.target, amount: o.amount };
      return null;
    default:
      return null;
  }
}
