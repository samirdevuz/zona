import { CLASSES, type ClassId } from '../config/classes';
import { MOVEMENT } from '../config/movement';
import { WEAPONS, type WeaponId } from '../config/weapons';

/**
 * The part of an actor's state that is simulated identically on client and
 * server (movement + weapon timers) and therefore predicted and reconciled.
 */
export interface PlayerState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
  crouched: boolean;
  sprinting: boolean;
  ads: boolean;
  jumpHeld: boolean;
  weapon: WeaponId;
  ammo: number;
  reserve: number;
  /** Seconds until the next shot may fire (may dip slightly below 0). */
  cooldown: number;
  /** Seconds left in the current reload; 0 when not reloading. */
  reloadT: number;
  /** Shots fired since spawn (used for client-side effects). */
  shots: number;
}

export function createPlayerState(classId: ClassId = 'assault'): PlayerState {
  const w = WEAPONS[CLASSES[classId].primary];
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    onGround: true,
    crouched: false,
    sprinting: false,
    ads: false,
    jumpHeld: false,
    weapon: w.id,
    ammo: w.magSize,
    reserve: w.reserveMax,
    cooldown: 0,
    reloadT: 0,
    shots: 0,
  };
}

export function copyPlayerState(out: PlayerState, s: PlayerState): PlayerState {
  out.x = s.x;
  out.y = s.y;
  out.z = s.z;
  out.vx = s.vx;
  out.vy = s.vy;
  out.vz = s.vz;
  out.yaw = s.yaw;
  out.pitch = s.pitch;
  out.onGround = s.onGround;
  out.crouched = s.crouched;
  out.sprinting = s.sprinting;
  out.ads = s.ads;
  out.jumpHeld = s.jumpHeld;
  out.weapon = s.weapon;
  out.ammo = s.ammo;
  out.reserve = s.reserve;
  out.cooldown = s.cooldown;
  out.reloadT = s.reloadT;
  out.shots = s.shots;
  return out;
}

export function eyeHeight(s: PlayerState): number {
  return s.crouched ? MOVEMENT.crouchEyeHeight : MOVEMENT.eyeHeight;
}
