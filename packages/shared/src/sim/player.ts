import { CLASSES, type ClassId, type ItemId } from '../config/classes';
import { GADGETS } from '../config/gadgets';
import { MOVEMENT } from '../config/movement';
import { WEAPONS, type WeaponDef } from '../config/weapons';

export const SLOT_COUNT = 4;

/**
 * The part of an actor's state that is simulated identically on client and
 * server (movement + inventory timers) and therefore predicted and reconciled.
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
  classId: ClassId;
  /** Selected slot 0..3 (primary, pistol, gadget A, gadget B). */
  slot: number;
  /** Seconds until the selected item is raised. */
  switchT: number;
  /** Per slot: magazine (guns) or count (grenades). */
  mag: number[];
  /** Per slot: reserve ammunition (guns). */
  res: number[];
  /** Seconds until the next shot may fire (may dip slightly below 0). */
  cooldown: number;
  /** Seconds left in the current reload; 0 when not reloading. */
  reloadT: number;
  /** Extra spread from sustained fire (degrees). */
  bloom: number;
  /** Seconds until the deployable gadget (med pack / ammo box) is ready. */
  gadgetCd: number;
  /** Seconds left in a grenade throw. */
  throwT: number;
  /** Buttons of the previous step (edge detection for semi-auto and quick actions). */
  prevB: number;
  /** Shots fired since spawn. */
  shots: number;
}

export function itemAt(s: PlayerState, slot: number): ItemId {
  return CLASSES[s.classId].slots[slot] ?? 'none';
}

/** Weapon definition of the selected slot, or null for non-gun items. */
export function currentWeapon(s: PlayerState): WeaponDef | null {
  const it = itemAt(s, s.slot);
  return it in WEAPONS ? WEAPONS[it as keyof typeof WEAPONS] : null;
}

/** Fill magazines, reserves and gadget counts for a class. */
export function loadout(s: PlayerState, classId: ClassId): void {
  s.classId = classId;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const it = CLASSES[classId].slots[i]!;
    if (it in WEAPONS) {
      const w = WEAPONS[it as keyof typeof WEAPONS];
      s.mag[i] = w.magSize;
      s.res[i] = w.reserveMax;
    } else if (it === 'grenade') {
      s.mag[i] = GADGETS.grenade.carried;
      s.res[i] = 0;
    } else {
      s.mag[i] = 0;
      s.res[i] = 0;
    }
  }
  s.slot = 0;
  s.switchT = 0;
  s.cooldown = 0;
  s.reloadT = 0;
  s.bloom = 0;
  s.gadgetCd = 0;
  s.throwT = 0;
}

export function createPlayerState(classId: ClassId = 'assault'): PlayerState {
  const s: PlayerState = {
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
    classId,
    slot: 0,
    switchT: 0,
    mag: [0, 0, 0, 0],
    res: [0, 0, 0, 0],
    cooldown: 0,
    reloadT: 0,
    bloom: 0,
    gadgetCd: 0,
    throwT: 0,
    prevB: 0,
    shots: 0,
  };
  loadout(s, classId);
  return s;
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
  out.classId = s.classId;
  out.slot = s.slot;
  out.switchT = s.switchT;
  for (let i = 0; i < SLOT_COUNT; i++) {
    out.mag[i] = s.mag[i]!;
    out.res[i] = s.res[i]!;
  }
  out.cooldown = s.cooldown;
  out.reloadT = s.reloadT;
  out.bloom = s.bloom;
  out.gadgetCd = s.gadgetCd;
  out.throwT = s.throwT;
  out.prevB = s.prevB;
  out.shots = s.shots;
  return out;
}

export function eyeHeight(s: PlayerState): number {
  return s.crouched ? MOVEMENT.crouchEyeHeight : MOVEMENT.eyeHeight;
}
